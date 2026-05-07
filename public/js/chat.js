import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, updateDoc,
  query, where, orderBy, limit, startAfter, onSnapshot, serverTimestamp, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

let currentUser = null;
let currentRoomId = null;
let unsubscribeMessages = null;
let allMessages = []; // for search
let blockedBySet = new Set(); // UIDs who have blocked me
let blockedByAt = {}; // timestamp when they blocked me {uid: seconds}

// Auth check
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  currentUser = user;
  loadUserData();
  loadRooms();
  requestNotificationPermission();
});

// Load current user data from Firestore (real-time, stays in sync)
let currentUserData = {};
let unsubscribeUserData = null;

function loadUserData() {
  if (unsubscribeUserData) unsubscribeUserData();
  unsubscribeUserData = onSnapshot(doc(db, "users", currentUser.uid), (snap) => {
    if (snap.exists()) currentUserData = snap.data();
  });
}

// Logout
document.getElementById("logout-btn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

// Profile
document.getElementById("profile-btn").addEventListener("click", () => {
  window.location.href = "profile.html";
});

// Find the most recent message visible to the current user in a room.
// alsoSkipAfter: { uid: blockTimestamp } — senders who blocked ME, skip their post-block msgs
async function findLastVisibleMsg(roomId, alsoSkipAfter = {}) {
  const myBlocked = currentUserData.blockedUsers || [];
  const myBlockedAt = currentUserData.blockedAt || {};
  const BATCH = 20;
  let lastDoc = null;

  try {
    while (true) {
      const constraints = [orderBy("createdAt", "desc"), limit(BATCH)];
      if (lastDoc) constraints.push(startAfter(lastDoc));
      const q = query(collection(db, "rooms", roomId, "messages"), ...constraints);

      const snap = await getDocs(q);
      if (snap.empty) break;

      for (const d of snap.docs) {
        const msg = d.data();
        if (msg.unsent) continue;
        const sid = msg.senderId;
        const msgTime = msg.createdAt?.seconds || 0;

        // Skip post-block msgs from users I've blocked
        if (sid && myBlocked.includes(sid)) {
          if (msgTime >= (myBlockedAt[sid] || 0)) continue;
        }
        // Skip post-block msgs from users who blocked me
        if (sid && alsoSkipAfter[sid] !== undefined) {
          if (msgTime >= alsoSkipAfter[sid]) continue;
        }

        // This message is visible
        if (msg.imageBase64) return "[Image]";
        if (msg.gifUrl) return "[GIF]";
        return msg.text || "";
      }

      if (snap.docs.length < BATCH) break; // reached the very beginning
      lastDoc = snap.docs[snap.docs.length - 1];
    }
  } catch (e) { /* ignore */ }
  return "";
}

// Build a single room list item (returns { item, displayName })
async function buildRoomItem(roomId, room) {
  let displayName = room.name || "Chat";
  let otherPhoto = room.photoURL || "";
  let lastMsg = room.lastMessage || "";
  const myBlocked = currentUserData.blockedUsers || [];

  if (!room.isGroup) {
    // ── DM ──
    const otherId = room.members.find(id => id !== currentUser.uid);
    if (otherId) {
      const otherSnap = await getDoc(doc(db, "users", otherId));
      if (otherSnap.exists()) {
        const otherData = otherSnap.data();
        displayName = otherData.username;
        otherPhoto = otherData.photoURL || "";
        const theyBlockedMe = (otherData.blockedUsers || []).includes(currentUser.uid);
        if (myBlocked.includes(otherId) || theyBlockedMe) {
          // Pass their block-me timestamp so we also skip their post-block messages
          const theirBlockAt = (otherData.blockedAt || {})[currentUser.uid] || 0;
          lastMsg = await findLastVisibleMsg(roomId, { [otherId]: theirBlockAt });
        }
      }
    }
  } else {
    // ── Group ──
    const senderId = room.lastMessageSenderId;
    if (senderId && senderId !== currentUser.uid) {
      let alsoSkipAfter = {};
      if (myBlocked.includes(senderId)) {
        // I blocked the sender — findLastVisibleMsg already handles this via myBlockedAt
      } else {
        const senderSnap = await getDoc(doc(db, "users", senderId));
        if (senderSnap.exists()) {
          const senderData = senderSnap.data();
          if ((senderData.blockedUsers || []).includes(currentUser.uid)) {
            // Sender blocked me — pass their block timestamp
            const theirBlockAt = (senderData.blockedAt || {})[currentUser.uid] || 0;
            alsoSkipAfter[senderId] = theirBlockAt;
          }
        }
      }
      const shouldHide = myBlocked.includes(senderId) || Object.keys(alsoSkipAfter).length > 0;
      if (shouldHide) lastMsg = await findLastVisibleMsg(roomId, alsoSkipAfter);
    }
  }

  const avatarHtml = otherPhoto
    ? `<img src="${otherPhoto}" class="room-avatar-img" />`
    : `<div class="room-avatar">${displayName[0].toUpperCase()}</div>`;

  const item = document.createElement("div");
  item.className = "room-item" + (roomId === currentRoomId ? " active" : "");
  item.dataset.roomId = roomId;
  item.innerHTML = `
    ${avatarHtml}
    <div class="room-info">
      <div class="room-name">${displayName}</div>
      <div class="room-last-msg">${lastMsg}</div>
    </div>
  `;
  item.addEventListener("click", () => openRoom(roomId, displayName));
  return { item, displayName, lastMsg, otherPhoto };
}

// Load chat rooms (incremental — no full re-render on every message)
function loadRooms() {
  const q = query(
    collection(db, "rooms"),
    where("members", "array-contains", currentUser.uid)
  );

  onSnapshot(q, async (snapshot) => {
    const roomList = document.getElementById("room-list");

    for (const change of snapshot.docChanges()) {
      const room = change.doc.data();
      const roomId = change.doc.id;

      if (change.type === "removed") {
        roomList.querySelector(`[data-room-id="${roomId}"]`)?.remove();
        continue;
      }

      // Build item for "added" or "modified"
      const { item, displayName, lastMsg, otherPhoto } = await buildRoomItem(roomId, room);

      if (change.type === "added") {
        roomList.appendChild(item);
        setupRoomNotification(roomId, displayName);
      } else if (change.type === "modified") {
        const existing = roomList.querySelector(`[data-room-id="${roomId}"]`);
        if (existing) {
          // Update text/avatar in-place — no DOM replacement, no animation, no flicker
          existing.querySelector(".room-name").textContent = displayName;
          existing.querySelector(".room-last-msg").textContent = lastMsg;
          // Update avatar src if it's an img
          const avatarImg = existing.querySelector(".room-avatar-img");
          if (avatarImg && otherPhoto) avatarImg.src = otherPhoto;
        } else {
          roomList.appendChild(item);
          setupRoomNotification(roomId, displayName);
        }
      }
    }
  });
}

// Track listeners to avoid duplicates
const notifListeners = {};

// Check if a specific user has blocked me (fetches Firestore)
async function senderHasBlockedMe(senderId) {
  try {
    const snap = await getDoc(doc(db, "users", senderId));
    return snap.exists() && (snap.data().blockedUsers || []).includes(currentUser.uid);
  } catch {
    return false;
  }
}

function setupRoomNotification(roomId, displayName) {
  if (notifListeners[roomId]) return;

  const msgQuery = query(
    collection(db, "rooms", roomId, "messages"),
    orderBy("createdAt", "desc")
  );

  let initialized = false;
  notifListeners[roomId] = onSnapshot(msgQuery, async (snapshot) => {
    if (!initialized) { initialized = true; return; } // skip initial load

    for (const change of snapshot.docChanges()) {
      if (change.type !== "added") continue;
      const msg = change.doc.data();

      // Skip own messages
      if (msg.senderId === currentUser.uid) continue;

      // Skip if room is open and in focus
      if (roomId === currentRoomId && document.hasFocus()) continue;

      // Skip if I blocked the sender
      const myBlocked = currentUserData.blockedUsers || [];
      if (myBlocked.includes(msg.senderId)) continue;

      // Skip if the sender has blocked me
      if (await senderHasBlockedMe(msg.senderId)) continue;

      const notifBody = msg.imageBase64 ? "📷 Image" : msg.gifUrl ? "🎞️ GIF" : msg.text;
      showNotification(displayName, notifBody);
    }
  });
}

// Open a chat room
async function openRoom(roomId, displayName) {
  currentRoomId = roomId;
  document.getElementById("chat-title").textContent = displayName;
  document.getElementById("msg-input").disabled = false;
  document.getElementById("send-btn").disabled = false;

  // Update active state
  document.querySelectorAll(".room-item").forEach(el => {
    el.classList.toggle("active", el.dataset.roomId === roomId);
  });

  // Mobile: show chat area
  if (window.innerWidth <= 600) {
    document.getElementById("chat-area").classList.add("active");
  }

  // Show invite button only for group chats
  const roomSnap = await getDoc(doc(db, "rooms", roomId));
  currentRoomIsGroup = roomSnap.exists() && roomSnap.data().isGroup;

  // Load who has blocked me among room members
  blockedBySet = new Set();
  blockedByAt = {};
  const members = roomSnap.data()?.members || [];
  for (const uid of members) {
    if (uid === currentUser.uid) continue;
    const memberSnap = await getDoc(doc(db, "users", uid));
    if (memberSnap.exists()) {
      const data = memberSnap.data();
      const theirBlocked = data.blockedUsers || [];
      if (theirBlocked.includes(currentUser.uid)) {
        blockedBySet.add(uid);
        blockedByAt[uid] = (data.blockedAt || {})[currentUser.uid] || 0;
      }
    }
  }
  document.getElementById("invite-member-btn").classList.toggle("hidden", !currentRoomIsGroup);
  document.getElementById("members-btn").classList.toggle("hidden", !currentRoomIsGroup);
  document.getElementById("group-settings-btn").classList.toggle("hidden", !currentRoomIsGroup);
  document.getElementById("block-btn").classList.toggle("hidden", currentRoomIsGroup);
  document.getElementById("search-btn").classList.remove("hidden");
  document.getElementById("search-bar").classList.add("hidden");
  document.getElementById("search-input").value = "";
  // Clear reply state
  replyToMsg = null;
  document.getElementById("reply-preview").classList.add("hidden");

  // Check block status for DM
  if (!currentRoomIsGroup) {
    await checkBlockStatus(roomSnap.data().members);
  } else {
    document.getElementById("blocked-warning").classList.add("hidden");
    document.getElementById("input-area").classList.remove("hidden");
  }

  // Unsubscribe previous listener
  if (unsubscribeMessages) unsubscribeMessages();

  // Load messages
  const msgQuery = query(
    collection(db, "rooms", roomId, "messages"),
    orderBy("createdAt", "asc")
  );

  const container = document.getElementById("messages-container");
  container.innerHTML = "";
  allMessages = [];

  unsubscribeMessages = onSnapshot(msgQuery, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added" || change.type === "modified") {
        const msg = { ...change.doc.data(), id: change.doc.id };
        const idx = allMessages.findIndex(m => m.id === change.doc.id);
        if (idx >= 0) allMessages[idx] = msg;
        else allMessages.push(msg);
        renderMessage(msg, change.doc.id);
      }
    });
    container.scrollTop = container.scrollHeight;
  });
}

// Render a message bubble
function renderMessage(msg, msgId) {
  const container = document.getElementById("messages-container");
  const isMine = msg.senderId === currentUser.uid;

  // Hide messages from blocked users (bidirectional)
  const myBlocked = currentUserData.blockedUsers || [];
  const myBlockedAt = currentUserData.blockedAt || {};
  if (!isMine) {
    const msgTime = msg.createdAt?.seconds || 0;
    // I blocked them: only hide post-block messages
    if (myBlocked.includes(msg.senderId)) {
      const blockTime = myBlockedAt[msg.senderId] || 0;
      if (msgTime >= blockTime) return;
    }
    // They blocked me: only hide post-block messages
    if (blockedBySet.has(msg.senderId)) {
      const blockTime = blockedByAt[msg.senderId] || 0;
      if (msgTime >= blockTime) return;
    }
  }

  // Keep track of position if updating
  const existing = container.querySelector(`[data-msg-id="${msgId}"]`);
  const insertBefore = existing ? existing.nextSibling : null;

  if (msg.unsent) {
    const row = document.createElement("div");
    row.className = "message-row" + (isMine ? " mine" : "");
    row.dataset.msgId = msgId;
    row.innerHTML = `<div class="msg-content"><div class="msg-unsent">Message unsent</div></div>`;
    if (existing) existing.remove();
    if (insertBefore) container.insertBefore(row, insertBefore);
    else container.appendChild(row);
    return;
  }

  const row = document.createElement("div");
  row.className = "message-row" + (isMine ? " mine" : "") + (msg.isBot ? " msg-bot" : "");
  row.dataset.msgId = msgId;

  const time = msg.createdAt
    ? new Date(msg.createdAt.seconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  const avatarContent = msg.senderPhoto
    ? `<img src="${msg.senderPhoto}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;" />`
    : `<div class="msg-avatar">${(msg.senderName || "?")[0].toUpperCase()}</div>`;

  // Reply quote block
  let replyQuoteHtml = "";
  if (msg.replyTo) {
    const safeReplyText = (msg.replyTo.text || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    replyQuoteHtml = `
      <div class="reply-quote">
        <div class="reply-quote-sender">${msg.replyTo.senderName || "User"}</div>
        <div class="reply-quote-text">${safeReplyText}</div>
      </div>`;
  }

  let bubbleContent = "";
  if (msg.imageBase64) {
    bubbleContent = `<img src="${msg.imageBase64}" class="msg-image" />`;
  } else if (msg.gifUrl) {
    bubbleContent = `<img src="${msg.gifUrl}" class="msg-image" style="max-height:180px;" />`;
  } else {
    bubbleContent = (msg.text || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
  }

  const editedLabel = msg.edited ? `<div class="edited-label">(edited)</div>` : "";

  const senderLabel = !isMine
    ? `<div class="msg-sender-label">
        <span class="msg-sender-name">${msg.senderName || "User"}</span>
        <span class="msg-sender-email">${msg.senderEmail || ""}</span>
       </div>`
    : "";

  row.innerHTML = `
    ${!isMine ? avatarContent : ""}
    <div class="msg-content">
      ${senderLabel}
      <div class="msg-bubble">${replyQuoteHtml}${bubbleContent}</div>
      ${editedLabel}
      <div class="msg-time">${time}</div>
    </div>
  `;

  // Right-click context menu (Reply for all; Edit/Unsend only for own)
  const openCtxMenu = (x, y) => {
    const isMedia = !!(msg.imageBase64 || msg.gifUrl);
    document.getElementById("ctx-edit").classList.toggle("hidden", !isMine || isMedia);
    document.getElementById("ctx-unsend").classList.toggle("hidden", !isMine);
    showContextMenu(x, y, msgId, msg.text || "");
  };

  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openCtxMenu(e.clientX, e.clientY);
  });

  // Long press for mobile
  let pressTimer;
  row.addEventListener("touchstart", (e) => {
    pressTimer = setTimeout(() => {
      const t = e.touches[0];
      openCtxMenu(t.clientX, t.clientY);
    }, 600);
  });
  row.addEventListener("touchend", () => clearTimeout(pressTimer));

  if (existing) existing.remove();
  if (insertBefore) {
    container.insertBefore(row, insertBefore);
  } else {
    container.appendChild(row);
  }
}

// Auto resize textarea
const msgInput = document.getElementById("msg-input");
msgInput.addEventListener("input", () => {
  msgInput.style.height = "auto";
  msgInput.style.height = msgInput.scrollHeight + "px";
});

// Send message
document.getElementById("send-btn").addEventListener("click", sendMessage);
msgInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

async function sendMessage() {
  const input = document.getElementById("msg-input");
  const text = input.value.trim();
  if (!text || !currentRoomId) return;

  input.value = "";
  input.style.height = "auto";

  const msgData = {
    text,
    senderId: currentUser.uid,
    senderName: currentUserData.username || "User",
    senderEmail: currentUserData.email || "",
    senderPhoto: currentUserData.photoURL || "",
    createdAt: serverTimestamp()
  };

  if (replyToMsg) {
    msgData.replyTo = { id: replyToMsg.id, text: replyToMsg.text, senderName: replyToMsg.senderName };
    replyToMsg = null;
    document.getElementById("reply-preview").classList.add("hidden");
  }

  await addDoc(collection(db, "rooms", currentRoomId, "messages"), msgData);

  // Update last message in room
  await setDoc(doc(db, "rooms", currentRoomId), {
    lastMessage: text,
    lastMessageSenderId: currentUser.uid
  }, { merge: true });
}

// New Chat Modal
const modal = document.getElementById("new-chat-modal");
let isGroupMode = false;

document.getElementById("new-chat-btn").addEventListener("click", () => {
  modal.classList.remove("hidden");
});

function resetModal() {
  modal.classList.add("hidden");
  document.getElementById("invite-email").value = "";
  document.getElementById("group-name").value = "";
  document.getElementById("invite-error").textContent = "";
  const memberInputs = document.getElementById("member-inputs");
  memberInputs.innerHTML = `<input type="text" class="member-email" placeholder="Member username or email" />`;
  isGroupMode = false;
  document.getElementById("type-dm").classList.add("active");
  document.getElementById("type-group").classList.remove("active");
  document.getElementById("dm-section").classList.remove("hidden");
  document.getElementById("group-section").classList.add("hidden");
}

document.getElementById("cancel-chat-btn").addEventListener("click", resetModal);

// Tab switching
document.getElementById("type-dm").addEventListener("click", () => {
  isGroupMode = false;
  document.getElementById("type-dm").classList.add("active");
  document.getElementById("type-group").classList.remove("active");
  document.getElementById("dm-section").classList.remove("hidden");
  document.getElementById("group-section").classList.add("hidden");
});

document.getElementById("type-group").addEventListener("click", () => {
  isGroupMode = true;
  document.getElementById("type-group").classList.add("active");
  document.getElementById("type-dm").classList.remove("active");
  document.getElementById("group-section").classList.remove("hidden");
  document.getElementById("dm-section").classList.add("hidden");
});

// Add member input field
document.getElementById("add-member-btn").addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "member-email";
  input.placeholder = "Member username or email";
  document.getElementById("member-inputs").appendChild(input);
});

// Find user by username or email helper
async function findUserByUsername(input) {
  // Try username first
  let q = query(collection(db, "users"), where("username", "==", input));
  let result = await getDocs(q);
  if (!result.empty) return result.docs[0].data();

  // Try email
  q = query(collection(db, "users"), where("email", "==", input));
  result = await getDocs(q);
  if (!result.empty) return result.docs[0].data();

  return null;
}

document.getElementById("confirm-chat-btn").addEventListener("click", async () => {
  const errorEl = document.getElementById("invite-error");
  errorEl.textContent = "";

  if (isGroupMode) {
    // Group chat
    const groupName = document.getElementById("group-name").value.trim();
    if (!groupName) { errorEl.textContent = "Please enter a group name."; return; }

    const emailInputs = document.querySelectorAll(".member-email");
    const memberIds = [currentUser.uid];

    for (const input of emailInputs) {
      const email = input.value.trim();
      if (!email) continue;
      const user = await findUserByUsername(email);
      if (!user) { errorEl.textContent = `User not found: ${email}`; return; }
      if (!memberIds.includes(user.uid)) memberIds.push(user.uid);
    }

    if (memberIds.length < 2) { errorEl.textContent = "Add at least one member."; return; }

    const roomRef = await addDoc(collection(db, "rooms"), {
      name: groupName,
      members: memberIds,
      isGroup: true,
      lastMessage: "",
      createdAt: serverTimestamp()
    });

    resetModal();
    openRoom(roomRef.id, groupName);

  } else {
    // Private chat
    const email = document.getElementById("invite-email").value.trim();
    if (!email) return;

    const otherUser = await findUserByUsername(email);
    if (!otherUser) { errorEl.textContent = "User not found."; return; }
    if (otherUser.uid === currentUser.uid) { errorEl.textContent = "You can't chat with yourself."; return; }

    // Check if DM already exists
    const existingQuery = query(collection(db, "rooms"), where("members", "array-contains", currentUser.uid));
    const existing = await getDocs(existingQuery);
    let existingRoomId = null;
    existing.forEach((docSnap) => {
      const data = docSnap.data();
      if (!data.isGroup && data.members.includes(otherUser.uid)) existingRoomId = docSnap.id;
    });

    if (existingRoomId) { resetModal(); openRoom(existingRoomId, otherUser.username); return; }

    const roomRef = await addDoc(collection(db, "rooms"), {
      members: [currentUser.uid, otherUser.uid],
      isGroup: false,
      lastMessage: "",
      createdAt: serverTimestamp()
    });

    resetModal();
    openRoom(roomRef.id, otherUser.username);
  }
});

// Invite member to group
let currentRoomIsGroup = false;
const inviteModal = document.getElementById("invite-modal");

document.getElementById("invite-member-btn").addEventListener("click", () => {
  inviteModal.classList.remove("hidden");
});

document.getElementById("cancel-invite-btn").addEventListener("click", () => {
  inviteModal.classList.add("hidden");
  document.getElementById("invite-group-email").value = "";
  document.getElementById("invite-group-error").textContent = "";
});

document.getElementById("confirm-invite-btn").addEventListener("click", async () => {
  const email = document.getElementById("invite-group-email").value.trim();
  const errorEl = document.getElementById("invite-group-error");
  errorEl.textContent = "";

  const user = await findUserByUsername(email);
  if (!user) { errorEl.textContent = "User not found."; return; }

  await setDoc(doc(db, "rooms", currentRoomId), {
    members: arrayUnion(user.uid)
  }, { merge: true });

  inviteModal.classList.add("hidden");
  document.getElementById("invite-group-email").value = "";
});

// Members Panel
document.getElementById("members-btn").addEventListener("click", async () => {
  const panel = document.getElementById("members-panel");
  panel.classList.toggle("hidden");
  if (!panel.classList.contains("hidden")) await loadMembers();
});

document.getElementById("close-members-btn").addEventListener("click", () => {
  document.getElementById("members-panel").classList.add("hidden");
});

async function loadMembers() {
  const roomSnap = await getDoc(doc(db, "rooms", currentRoomId));
  if (!roomSnap.exists()) return;
  const memberIds = roomSnap.data().members || [];

  const list = document.getElementById("members-list");
  list.innerHTML = "";

  for (const uid of memberIds) {
    const userSnap = await getDoc(doc(db, "users", uid));
    if (!userSnap.exists()) continue;
    const userData = userSnap.data();

    const item = document.createElement("div");
    item.className = "member-item";
    item.innerHTML = userData.photoURL
      ? `<img src="${userData.photoURL}" /><span class="member-name">${userData.username}${uid === currentUser.uid ? " (me)" : ""}</span>`
      : `<div class="member-avatar-sm">${userData.username[0].toUpperCase()}</div><span class="member-name">${userData.username}${uid === currentUser.uid ? " (me)" : ""}</span>`;
    list.appendChild(item);
  }
}

// Group Settings
const groupSettingsModal = document.getElementById("group-settings-modal");

document.getElementById("group-settings-btn").addEventListener("click", async () => {
  const roomSnap = await getDoc(doc(db, "rooms", currentRoomId));
  if (!roomSnap.exists()) return;
  const data = roomSnap.data();
  document.getElementById("group-name-edit").value = data.name || "";
  document.getElementById("group-avatar-preview").src = data.photoURL || "";
  document.getElementById("group-settings-error").textContent = "";
  groupSettingsModal.classList.remove("hidden");
});

document.getElementById("cancel-group-settings-btn").addEventListener("click", () => {
  groupSettingsModal.classList.add("hidden");
});

document.getElementById("group-avatar-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const base64 = await compressImage(file);
  document.getElementById("group-avatar-preview").src = base64;
});

document.getElementById("save-group-settings-btn").addEventListener("click", async () => {
  const errorEl = document.getElementById("group-settings-error");
  const newName = document.getElementById("group-name-edit").value.trim();
  if (!newName) { errorEl.textContent = "Group name cannot be empty."; return; }

  const avatarFile = document.getElementById("group-avatar-input").files[0];
  const updateData = { name: newName };

  if (avatarFile) {
    const base64 = await compressImage(avatarFile);
    updateData.photoURL = base64;
  }

  await setDoc(doc(db, "rooms", currentRoomId), updateData, { merge: true });
  document.getElementById("chat-title").textContent = newName;
  groupSettingsModal.classList.add("hidden");
});

// Compress image (reuse from profile)
function compressImage(file, maxSize = 150) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── Context Menu ──
let ctxMsgId = null;
let ctxMsgText = null;
const contextMenu = document.getElementById("context-menu");

function showContextMenu(x, y, msgId, text) {
  ctxMsgId = msgId;
  ctxMsgText = text;
  contextMenu.classList.remove("hidden");

  const menuW = contextMenu.offsetWidth;
  const menuH = contextMenu.offsetHeight;
  const left = x + menuW > window.innerWidth ? x - menuW : x;
  const top = y + menuH > window.innerHeight ? y - menuH : y;

  contextMenu.style.left = left + "px";
  contextMenu.style.top = top + "px";
}

document.addEventListener("click", () => contextMenu.classList.add("hidden"));

document.getElementById("ctx-unsend").addEventListener("click", async (e) => {
  e.stopPropagation();
  if (!ctxMsgId || !currentRoomId) return;
  try {
    await updateDoc(doc(db, "rooms", currentRoomId, "messages", ctxMsgId), { unsent: true });
  } catch (err) {
    console.error("Unsend failed:", err);
  }
});

document.getElementById("ctx-edit").addEventListener("click", (e) => {
  e.stopPropagation();
  if (!ctxMsgId) return;
  document.getElementById("edit-input").value = ctxMsgText;
  document.getElementById("edit-modal").classList.remove("hidden");
});

document.getElementById("cancel-edit-btn").addEventListener("click", () => {
  document.getElementById("edit-modal").classList.add("hidden");
});

document.getElementById("save-edit-btn").addEventListener("click", async () => {
  const newText = document.getElementById("edit-input").value.trim();
  if (!newText || !ctxMsgId) return;
  await updateDoc(doc(db, "rooms", currentRoomId, "messages", ctxMsgId), {
    text: newText,
    edited: true
  });
  document.getElementById("edit-modal").classList.add("hidden");
});

// ── Send Image ──
document.getElementById("img-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || !currentRoomId) return;
  e.target.value = "";

  const base64 = await compressImage(file, 800);
  await addDoc(collection(db, "rooms", currentRoomId, "messages"), {
    text: "",
    imageBase64: base64,
    senderId: currentUser.uid,
    senderName: currentUserData.username || "User",
    senderEmail: currentUserData.email || "",
    senderPhoto: currentUserData.photoURL || "",
    createdAt: serverTimestamp()
  });
  await setDoc(doc(db, "rooms", currentRoomId), {
    lastMessage: "[Image]",
    lastMessageSenderId: currentUser.uid
  }, { merge: true });
});

// ── Search Messages ──
document.getElementById("search-btn").addEventListener("click", () => {
  document.getElementById("search-bar").classList.toggle("hidden");
  document.getElementById("search-results").classList.add("hidden");
  document.getElementById("search-input").value = "";
  document.getElementById("search-input").focus();
});

document.getElementById("close-search-btn").addEventListener("click", () => {
  document.getElementById("search-bar").classList.add("hidden");
  document.getElementById("search-results").classList.add("hidden");
  document.getElementById("search-input").value = "";
});

document.getElementById("search-input").addEventListener("input", (e) => {
  const keyword = e.target.value.trim().toLowerCase();
  const resultsEl = document.getElementById("search-results");

  if (!keyword) {
    resultsEl.classList.add("hidden");
    return;
  }

  const matches = allMessages.filter(m =>
    !m.unsent && m.text && m.text.toLowerCase().includes(keyword)
  );

  resultsEl.innerHTML = "";
  resultsEl.classList.remove("hidden");

  if (matches.length === 0) {
    resultsEl.innerHTML = `<div class="search-no-result">No results found</div>`;
    return;
  }

  matches.forEach((msg) => {
    const item = document.createElement("div");
    item.className = "search-result-item";

    const safe = msg.text
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const highlighted = safe.replace(
      new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"),
      `<span class="highlight">$1</span>`
    );

    item.innerHTML = `
      <div class="search-result-sender">${msg.senderName || "User"}</div>
      <div class="search-result-text">${highlighted}</div>
    `;

    item.addEventListener("click", () => {
      resultsEl.classList.add("hidden");
      document.getElementById("search-input").value = "";
      const row = document.querySelector(`[data-msg-id="${msg.id}"]`);
      if (row) {
        row.scrollIntoView({ behavior: "smooth", block: "center" });
        row.classList.add("msg-flash");
        setTimeout(() => row.classList.remove("msg-flash"), 1500);
      }
    });

    resultsEl.appendChild(item);
  });
});

// Mobile: back to room list
document.getElementById("back-to-list-btn").addEventListener("click", () => {
  document.getElementById("chat-area").classList.remove("active");
});

// ── Block User ──
let currentOtherUserId = null;

async function checkBlockStatus(members) {
  currentOtherUserId = members.find(id => id !== currentUser.uid);
  const myBlocked = currentUserData.blockedUsers || [];
  const warningEl = document.getElementById("blocked-warning");
  const inputEl = document.getElementById("input-area");

  if (!currentOtherUserId) return;

  // Check if other user blocked me
  const otherSnap = await getDoc(doc(db, "users", currentOtherUserId));
  const otherBlocked = otherSnap.exists() ? (otherSnap.data().blockedUsers || []) : [];

  const isBlocked = myBlocked.includes(currentOtherUserId) || otherBlocked.includes(currentUser.uid);

  // Update block button label
  const blockBtn = document.getElementById("block-btn");
  blockBtn.textContent = myBlocked.includes(currentOtherUserId) ? "✅ Unblock" : "🚫";
  blockBtn.title = myBlocked.includes(currentOtherUserId) ? "Unblock User" : "Block User";

  if (isBlocked) {
    warningEl.classList.remove("hidden");
    inputEl.classList.add("hidden");
  } else {
    warningEl.classList.add("hidden");
    inputEl.classList.remove("hidden");
  }
}

document.getElementById("block-btn").addEventListener("click", async () => {
  if (!currentOtherUserId) return;
  const myBlocked = currentUserData.blockedUsers || [];
  const isBlocked = myBlocked.includes(currentOtherUserId);

  if (isBlocked) {
    await updateDoc(doc(db, "users", currentUser.uid), {
      blockedUsers: arrayRemove(currentOtherUserId)
    });
    currentUserData.blockedUsers = myBlocked.filter(id => id !== currentOtherUserId);
  } else {
    const nowSec = Math.floor(Date.now() / 1000);
    await updateDoc(doc(db, "users", currentUser.uid), {
      blockedUsers: arrayUnion(currentOtherUserId),
      [`blockedAt.${currentOtherUserId}`]: nowSec
    });
    currentUserData.blockedUsers = [...myBlocked, currentOtherUserId];
    if (!currentUserData.blockedAt) currentUserData.blockedAt = {};
    currentUserData.blockedAt[currentOtherUserId] = nowSec;
  }

  // Re-check block status
  const roomSnapAfter = await getDoc(doc(db, "rooms", currentRoomId));
  if (roomSnapAfter.exists()) {
    const members = roomSnapAfter.data().members || [];
    // Reload blockedBySet
    blockedBySet = new Set();
    blockedByAt = {};
    for (const uid of members) {
      if (uid === currentUser.uid) continue;
      const memberSnap = await getDoc(doc(db, "users", uid));
      if (memberSnap.exists()) {
        const data = memberSnap.data();
        const theirBlocked = data.blockedUsers || [];
        if (theirBlocked.includes(currentUser.uid)) {
          blockedBySet.add(uid);
          blockedByAt[uid] = (data.blockedAt || {})[currentUser.uid] || 0;
        }
      }
    }
    await checkBlockStatus(members);
  }
});

// ── Reply to Message ──
let replyToMsg = null; // { id, text, senderName }

function setReplyTo(msg) {
  replyToMsg = { id: msg.id, text: msg.text || (msg.imageBase64 ? "[Image]" : "[GIF]"), senderName: msg.senderName || "User" };
  const preview = document.getElementById("reply-preview");
  document.getElementById("reply-preview-text").textContent = `${replyToMsg.senderName}: ${replyToMsg.text}`;
  preview.classList.remove("hidden");
  document.getElementById("msg-input").focus();
}

document.getElementById("cancel-reply-btn").addEventListener("click", () => {
  replyToMsg = null;
  document.getElementById("reply-preview").classList.add("hidden");
});

// Add Reply to context menu (for all messages, not just own)
document.getElementById("ctx-reply").addEventListener("click", (e) => {
  e.stopPropagation();
  if (!ctxMsgId) return;
  const msg = allMessages.find(m => m.id === ctxMsgId);
  if (msg) setReplyTo(msg);
});

// ── Emoji Picker ──
const EMOJIS = [
  "😀","😂","😍","🥰","😎","😭","😅","🤣","😊","😇",
  "🙃","😉","😋","😘","😜","🤔","🤗","😐","😑","🙄",
  "😮","😱","😤","😠","🤬","😢","😪","🥺","😷","🤒",
  "👍","👎","👏","🙌","🤝","🤞","✌️","🤟","👌","🤙",
  "❤️","🧡","💛","💚","💙","💜","🖤","💔","❣️","💕",
  "🎉","🎊","🎈","🔥","✨","⭐","💯","🎯","🏆","🥇",
  "😸","😹","🐶","🐱","🐼","🐨","🦊","🐸","🐷","🐙",
  "🍕","🍔","🍟","🌮","🍣","🍜","🍰","🎂","🍩","🧁",
  "⚽","🏀","🎮","🎸","🎵","🎬","📷","🚀","🌈","🌊"
];

const emojiPicker = document.getElementById("emoji-picker");
EMOJIS.forEach(emoji => {
  const span = document.createElement("span");
  span.textContent = emoji;
  span.addEventListener("click", () => {
    const input = document.getElementById("msg-input");
    const pos = input.selectionStart;
    const val = input.value;
    input.value = val.slice(0, pos) + emoji + val.slice(pos);
    input.selectionStart = input.selectionEnd = pos + emoji.length;
    input.focus();
    // trigger auto-resize
    input.dispatchEvent(new Event("input"));
  });
  emojiPicker.appendChild(span);
});

document.getElementById("emoji-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  emojiPicker.classList.toggle("hidden");
});

document.addEventListener("click", (e) => {
  if (!emojiPicker.contains(e.target) && e.target.id !== "emoji-btn") {
    emojiPicker.classList.add("hidden");
  }
});

// ── GIF via Tenor API (v1 — free demo key, no signup needed) ──
const TENOR_API_KEY = "LIVDSRZULELA"; // Tenor official demo key
const TENOR_CLIENT_KEY = "chatroom_midterm";

async function searchTenor(keyword) {
  const url = `https://api.tenor.com/v1/search?q=${encodeURIComponent(keyword)}&key=${TENOR_API_KEY}&client_key=${TENOR_CLIENT_KEY}&limit=12&media_filter=minimal`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return data.results || [];
  } catch (err) {
    console.error("Tenor error:", err);
    return [];
  }
}

async function loadTrendingGifs() {
  const url = `https://api.tenor.com/v1/trending?key=${TENOR_API_KEY}&client_key=${TENOR_CLIENT_KEY}&limit=12&media_filter=minimal`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return data.results || [];
  } catch (err) {
    return [];
  }
}

function renderGifGrid(results) {
  const grid = document.getElementById("gif-grid");
  grid.innerHTML = "";
  if (results.length === 0) {
    grid.innerHTML = `<div class="gif-loading">No GIFs found</div>`;
    return;
  }
  results.forEach(item => {
    // v1 response: media is an array of objects
    const media = item.media?.[0];
    const gifUrl = media?.gif?.url || media?.mediumgif?.url;
    const previewUrl = media?.tinygif?.url || gifUrl;
    if (!gifUrl) return;
    const img = document.createElement("img");
    img.src = previewUrl;
    img.loading = "lazy";
    img.addEventListener("click", async () => {
      document.getElementById("gif-modal").classList.add("hidden");
      if (!currentRoomId) return;
      await addDoc(collection(db, "rooms", currentRoomId, "messages"), {
        text: "",
        gifUrl,
        senderId: currentUser.uid,
        senderName: currentUserData.username || "User",
        senderEmail: currentUserData.email || "",
        senderPhoto: currentUserData.photoURL || "",
        createdAt: serverTimestamp()
      });
      await setDoc(doc(db, "rooms", currentRoomId), {
        lastMessage: "[GIF]",
        lastMessageSenderId: currentUser.uid
      }, { merge: true });
    });
    grid.appendChild(img);
  });
}

document.getElementById("gif-btn").addEventListener("click", async () => {
  document.getElementById("gif-modal").classList.remove("hidden");
  document.getElementById("gif-search-input").value = "";
  document.getElementById("gif-error").textContent = "";
  const grid = document.getElementById("gif-grid");
  grid.innerHTML = `<div class="gif-loading">Loading trending GIFs...</div>`;
  const trending = await loadTrendingGifs();
  renderGifGrid(trending);
});

document.getElementById("cancel-gif-btn").addEventListener("click", () => {
  document.getElementById("gif-modal").classList.add("hidden");
});

let gifSearchTimer = null;
document.getElementById("gif-search-input").addEventListener("input", (e) => {
  clearTimeout(gifSearchTimer);
  const keyword = e.target.value.trim();
  if (!keyword) return;
  document.getElementById("gif-grid").innerHTML = `<div class="gif-loading">Searching...</div>`;
  gifSearchTimer = setTimeout(async () => {
    const results = await searchTenor(keyword);
    renderGifGrid(results);
  }, 400);
});

// ── AI Chatbot (Groq) ──
const GROQ_API_KEY = "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";

document.getElementById("ai-btn").addEventListener("click", async () => {
  if (!currentRoomId) return;
  const input = document.getElementById("msg-input");
  const userText = input.value.trim();
  if (!userText) {
    alert("請先在輸入框輸入你想問 AI 的問題");
    return;
  }

  // Send user's message first
  input.value = "";
  input.style.height = "auto";
  await addDoc(collection(db, "rooms", currentRoomId, "messages"), {
    text: userText,
    senderId: currentUser.uid,
    senderName: currentUserData.username || "User",
    senderEmail: currentUserData.email || "",
    senderPhoto: currentUserData.photoURL || "",
    createdAt: serverTimestamp()
  });
  await setDoc(doc(db, "rooms", currentRoomId), {
    lastMessage: userText,
    lastMessageSenderId: currentUser.uid
  }, { merge: true });

  // Show typing indicator
  const container = document.getElementById("messages-container");
  const typingEl = document.createElement("div");
  typingEl.className = "message-row";
  typingEl.id = "ai-typing";
  typingEl.innerHTML = `
    <div class="msg-avatar" style="background:#10a37f;">AI</div>
    <div class="msg-content">
      <div class="msg-bubble" style="background:#fff;color:#222;box-shadow:0 1px 2px rgba(0,0,0,0.1);">
        <em>AI is typing...</em>
      </div>
    </div>`;
  container.appendChild(typingEl);
  container.scrollTop = container.scrollHeight;

  try {
    const res = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [{ role: "user", content: userText }]
        })
      }
    );

    const data = await res.json();
    console.log("Groq response:", JSON.stringify(data));
    if (data.error) throw new Error(data.error.message);
    const botReply = data.choices?.[0]?.message?.content || "Sorry, I couldn't get a response.";

    document.getElementById("ai-typing")?.remove();

    await addDoc(collection(db, "rooms", currentRoomId, "messages"), {
      text: botReply,
      senderId: "ai-bot",
      senderName: "AI Assistant",
      senderEmail: "ai@chatbot",
      senderPhoto: "",
      isBot: true,
      createdAt: serverTimestamp()
    });
    await setDoc(doc(db, "rooms", currentRoomId), {
      lastMessage: "🤖 " + botReply.slice(0, 30),
      lastMessageSenderId: "ai-bot"
    }, { merge: true });

  } catch (err) {
    document.getElementById("ai-typing")?.remove();
    console.error("AI error:", err);
    alert("AI 錯誤：" + err.message);
  }
});

// ── Notifications ──
function requestNotificationPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function showNotification(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const notif = new Notification(title, {
    body: body || "",
    icon: "/favicon.ico"
  });

  notif.onclick = () => {
    window.focus();
    notif.close();
  };
}

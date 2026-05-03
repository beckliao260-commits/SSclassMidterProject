import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, updateDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, arrayUnion
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

let currentUser = null;
let currentRoomId = null;
let unsubscribeMessages = null;
let allMessages = []; // for search

// Auth check
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  currentUser = user;
  await loadUserData();
  loadRooms();
});

// Load current user data from Firestore
let currentUserData = {};
async function loadUserData() {
  const snap = await getDoc(doc(db, "users", currentUser.uid));
  if (snap.exists()) currentUserData = snap.data();
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

// Load chat rooms
function loadRooms() {
  const q = query(
    collection(db, "rooms"),
    where("members", "array-contains", currentUser.uid)
  );

  onSnapshot(q, async (snapshot) => {
    const roomList = document.getElementById("room-list");
    roomList.innerHTML = "";

    for (const docSnap of snapshot.docs) {
      const room = docSnap.data();
      const roomId = docSnap.id;

      // Get display name and photo
      let displayName = room.name || "Chat";
      let otherPhoto = room.photoURL || "";
      if (!room.isGroup) {
        const otherId = room.members.find(id => id !== currentUser.uid);
        if (otherId) {
          const otherSnap = await getDoc(doc(db, "users", otherId));
          if (otherSnap.exists()) {
            displayName = otherSnap.data().username;
            otherPhoto = otherSnap.data().photoURL || "";
          }
        }
      }

      const avatarHtml = otherPhoto
        ? `<img src="${otherPhoto}" class="room-avatar-img" />`
        : `<div class="room-avatar">${displayName[0].toUpperCase()}</div>`;

      const item = document.createElement("div");
      item.className = "room-item" + (roomId === currentRoomId ? " active" : "");
      item.innerHTML = `
        ${avatarHtml}
        <div class="room-info">
          <div class="room-name">${displayName}</div>
          <div class="room-last-msg">${room.lastMessage || ""}</div>
        </div>
      `;
      item.dataset.roomId = roomId;
      item.addEventListener("click", () => openRoom(roomId, displayName));
      roomList.appendChild(item);
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
  document.getElementById("invite-member-btn").classList.toggle("hidden", !currentRoomIsGroup);
  document.getElementById("members-btn").classList.toggle("hidden", !currentRoomIsGroup);
  document.getElementById("group-settings-btn").classList.toggle("hidden", !currentRoomIsGroup);
  document.getElementById("search-btn").classList.remove("hidden");
  document.getElementById("search-bar").classList.add("hidden");
  document.getElementById("search-input").value = "";

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
  row.className = "message-row" + (isMine ? " mine" : "");
  row.dataset.msgId = msgId;

  const time = msg.createdAt
    ? new Date(msg.createdAt.seconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  const avatarContent = msg.senderPhoto
    ? `<img src="${msg.senderPhoto}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;" />`
    : `<div class="msg-avatar">${(msg.senderName || "?")[0].toUpperCase()}</div>`;

  let bubbleContent = "";
  if (msg.imageBase64) {
    bubbleContent = `<img src="${msg.imageBase64}" class="msg-image" />`;
  } else {
    bubbleContent = msg.text
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
  }

  const editedLabel = msg.edited ? `<div class="edited-label">(edited)</div>` : "";

  row.innerHTML = `
    ${!isMine ? avatarContent : ""}
    <div class="msg-content">
      <div class="msg-bubble">${bubbleContent}</div>
      ${editedLabel}
      <div class="msg-time">${time}</div>
    </div>
  `;

  // Right-click context menu (only for own messages)
  if (isMine) {
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const isImage = !!msg.imageBase64;
      document.getElementById("ctx-edit").classList.toggle("hidden", isImage);
      showContextMenu(e.clientX, e.clientY, msgId, msg.text || "");
    });
    // Long press for mobile
    let pressTimer;
    row.addEventListener("touchstart", (e) => {
      pressTimer = setTimeout(() => {
        const t = e.touches[0];
        const isImage = !!msg.imageBase64;
        document.getElementById("ctx-edit").classList.toggle("hidden", isImage);
        showContextMenu(t.clientX, t.clientY, msgId, msg.text || "");
      }, 600);
    });
    row.addEventListener("touchend", () => clearTimeout(pressTimer));
  }

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

  await addDoc(collection(db, "rooms", currentRoomId, "messages"), {
    text,
    senderId: currentUser.uid,
    senderName: currentUserData.username || "User",
    senderPhoto: currentUserData.photoURL || "",
    createdAt: serverTimestamp()
  });

  // Update last message in room
  await setDoc(doc(db, "rooms", currentRoomId), { lastMessage: text }, { merge: true });
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
  memberInputs.innerHTML = `<input type="email" class="member-email" placeholder="Member email" />`;
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
  input.type = "email";
  input.className = "member-email";
  input.placeholder = "Member email";
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
  document.getElementById("group-avatar-preview").src = data.photoURL || "https://via.placeholder.com/80";
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
    senderPhoto: currentUserData.photoURL || "",
    createdAt: serverTimestamp()
  });
  await setDoc(doc(db, "rooms", currentRoomId), { lastMessage: "[Image]" }, { merge: true });
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

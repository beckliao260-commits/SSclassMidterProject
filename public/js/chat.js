import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, arrayUnion
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

let currentUser = null;
let currentRoomId = null;
let unsubscribeMessages = null;

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
      let otherPhoto = "";
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
function openRoom(roomId, displayName) {
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

  // Unsubscribe previous listener
  if (unsubscribeMessages) unsubscribeMessages();

  // Load messages
  const msgQuery = query(
    collection(db, "rooms", roomId, "messages"),
    orderBy("createdAt", "asc")
  );

  const container = document.getElementById("messages-container");
  container.innerHTML = "";

  unsubscribeMessages = onSnapshot(msgQuery, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added") {
        const msg = change.doc.data();
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

  const row = document.createElement("div");
  row.className = "message-row" + (isMine ? " mine" : "");
  row.dataset.msgId = msgId;

  const time = msg.createdAt
    ? new Date(msg.createdAt.seconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  // Sanitize message to prevent XSS, then convert newlines to <br>
  const safeText = msg.text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  const avatarContent = msg.senderPhoto
    ? `<img src="${msg.senderPhoto}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;" />`
    : `<div class="msg-avatar">${(msg.senderName || "?")[0].toUpperCase()}</div>`;

  row.innerHTML = `
    ${!isMine ? avatarContent : ""}
    <div class="msg-content">
      <div class="msg-bubble">${safeText}</div>
      <div class="msg-time">${time}</div>
    </div>
  `;

  container.appendChild(row);
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
document.getElementById("new-chat-btn").addEventListener("click", () => {
  modal.classList.remove("hidden");
});
document.getElementById("cancel-chat-btn").addEventListener("click", () => {
  modal.classList.add("hidden");
  document.getElementById("invite-email").value = "";
  document.getElementById("invite-error").textContent = "";
});

document.getElementById("confirm-chat-btn").addEventListener("click", async () => {
  const email = document.getElementById("invite-email").value.trim();
  const errorEl = document.getElementById("invite-error");
  errorEl.textContent = "";

  if (!email) return;

  // Find user by email
  const usersQuery = query(collection(db, "users"), where("email", "==", email));
  const result = await getDocs(usersQuery);

  if (result.empty) {
    errorEl.textContent = "User not found.";
    return;
  }

  const otherUser = result.docs[0].data();
  const otherId = otherUser.uid;

  if (otherId === currentUser.uid) {
    errorEl.textContent = "You can't chat with yourself.";
    return;
  }

  // Check if room already exists
  const existingQuery = query(
    collection(db, "rooms"),
    where("members", "array-contains", currentUser.uid)
  );
  const existing = await getDocs(existingQuery);
  let existingRoomId = null;

  existing.forEach((docSnap) => {
    const data = docSnap.data();
    if (!data.isGroup && data.members.includes(otherId)) existingRoomId = docSnap.id;
  });

  if (existingRoomId) {
    modal.classList.add("hidden");
    openRoom(existingRoomId, otherUser.username);
    return;
  }

  // Create new room
  const roomRef = await addDoc(collection(db, "rooms"), {
    members: [currentUser.uid, otherId],
    isGroup: false,
    lastMessage: "",
    createdAt: serverTimestamp()
  });

  modal.classList.add("hidden");
  document.getElementById("invite-email").value = "";
  openRoom(roomRef.id, otherUser.username);
});

// Mobile: back to room list
document.getElementById("back-to-list-btn").addEventListener("click", () => {
  document.getElementById("chat-area").classList.remove("active");
});

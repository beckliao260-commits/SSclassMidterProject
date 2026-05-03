import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

let currentUser = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  currentUser = user;
  await loadProfile();
});

async function loadProfile() {
  const snap = await getDoc(doc(db, "users", currentUser.uid));
  if (!snap.exists()) return;

  const data = snap.data();
  document.getElementById("username").value = data.username || "";
  document.getElementById("email").value = data.email || "";
  document.getElementById("phone").value = data.phone || "";
  document.getElementById("address").value = data.address || "";

  if (data.photoURL) {
    document.getElementById("avatar-preview").src = data.photoURL;
  }
}

// 壓縮圖片成小尺寸的 base64
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

// Avatar preview
document.getElementById("avatar-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const base64 = await compressImage(file);
  document.getElementById("avatar-preview").src = base64;
});

// Save profile
document.getElementById("profile-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("profile-error");
  const successEl = document.getElementById("profile-success");
  errorEl.textContent = "";
  successEl.textContent = "";

  const username = document.getElementById("username").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const address = document.getElementById("address").value.trim();
  const avatarFile = document.getElementById("avatar-input").files[0];

  try {
    const updateData = { username, phone, address };

    if (avatarFile) {
      const base64 = await compressImage(avatarFile);
      updateData.photoURL = base64;
    }

    await updateDoc(doc(db, "users", currentUser.uid), updateData);
    successEl.textContent = "Profile saved!";
  } catch (err) {
    errorEl.textContent = "Failed to save: " + err.message;
  }
});

// Back button
document.getElementById("back-btn").addEventListener("click", () => {
  window.location.href = "chat.html";
});

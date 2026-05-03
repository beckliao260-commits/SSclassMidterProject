import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

const firebaseConfig = {
  projectId: "ss-class-83213",
  appId: "1:299760087542:web:b146d2112a1c241b6957d7",
  databaseURL: "https://ss-class-83213-default-rtdb.firebaseio.com",
  storageBucket: "ss-class-83213.firebasestorage.app",
  apiKey: "AIzaSyATbo9QHaxcghBCRfD9yhovnA4kcrVkVJw",
  authDomain: "ss-class-83213.firebaseapp.com",
  messagingSenderId: "299760087542",
  measurementId: "G-VCHRLDGGJD"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

/* LensCal — Firebase bootstrap.
   Reuses the studio's web-app config from ../firebase-config.js
   (loaded as a classic script in index.html → window.FIREBASE_CONFIG). */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
  collection, query, where, orderBy, startAt, endAt, limit, onSnapshot,
  serverTimestamp, documentId, deleteField,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  getAuth, onAuthStateChanged, RecaptchaVerifier, signInWithPhoneNumber,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const cfg = window.FIREBASE_CONFIG;
if (!cfg) {
  document.body.innerHTML = '<div style="padding:2rem;font-family:sans-serif">' +
    '<h2>LensCal setup needed</h2><p>Missing <code>firebase-config.js</code> at the site root.</p></div>';
  throw new Error('FIREBASE_CONFIG missing');
}

export const app = initializeApp(cfg, 'lenscal');
export const db = getFirestore(app);
export const auth = getAuth(app);

// Re-export the Firestore/Auth primitives the service layer uses,
// so services import from one place and UI never imports Firebase at all.
export {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
  collection, query, where, orderBy, startAt, endAt, limit, onSnapshot,
  serverTimestamp, documentId, deleteField,
  onAuthStateChanged, RecaptchaVerifier, signInWithPhoneNumber,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
};

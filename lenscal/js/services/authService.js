/* LensCal — auth service. Phone OTP first, email/password fallback. */
import {
  auth, onAuthStateChanged, RecaptchaVerifier, signInWithPhoneNumber,
  signInWithEmailAndPassword, signOut,
} from '../firebase.js';   /* createUserWithEmailAndPassword deliberately not imported */
import { DEFAULT_COUNTRY_CODE } from '../config.js';

let confirmationResult = null;
let recaptcha = null;

export function currentUid() {
  return auth.currentUser ? auth.currentUser.uid : null;
}

export function onAuth(cb) {
  return onAuthStateChanged(auth, cb);
}

/** Normalize an Indian phone input to E.164. "9876543210" → "+919876543210". */
export function normalizePhone(raw) {
  if (!raw) return null;
  let p = String(raw).replace(/[\s\-().]/g, '');
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (/^\d{10}$/.test(p)) p = DEFAULT_COUNTRY_CODE + p;
  else if (/^0\d{10}$/.test(p)) p = DEFAULT_COUNTRY_CODE + p.slice(1);
  else if (/^91\d{10}$/.test(p)) p = '+' + p;
  if (!/^\+\d{8,15}$/.test(p)) return null;
  return p;
}

/** Send OTP. buttonId = id of the visible button (invisible reCAPTCHA anchor). */
export async function sendOtp(phone, buttonId) {
  const e164 = normalizePhone(phone);
  if (!e164) throw new Error('Enter a valid phone number');
  if (!recaptcha) {
    recaptcha = new RecaptchaVerifier(auth, buttonId, { size: 'invisible' });
  }
  confirmationResult = await signInWithPhoneNumber(auth, e164, recaptcha);
  return e164;
}

export async function confirmOtp(code) {
  if (!confirmationResult) throw new Error('Request an OTP first');
  const cred = await confirmationResult.confirm(code.trim());
  return cred.user;
}

/* Sign in only — this never creates an account.
   It used to: an unknown email+password was silently turned into a new
   account. LensCal shares Firebase project fantasy-studio-web-f7813 with the
   studio site, so every account minted here is an authenticated identity
   against the same database that holds the studio's leads, client phone
   numbers and payment history. Whether such an account can actually READ that
   data is decided by the Firestore console rules, so this is defence in depth,
   not the whole defence — but it removes the free, unattended way in.

   It also removed an enumeration oracle: a registered email with a wrong
   password answered "Wrong password for this email" while an unknown email
   silently succeeded, so anyone could test which addresses had accounts. Both
   cases now return the same message.

   Accounts are created by the studio: Firebase console → Authentication →
   Users → Add user. To restore self-serve sign-up, add a deliberate
   "Create account" flow — but do the Firestore rules first, or it reopens
   exactly this hole with an extra click in front of it. */
export async function emailSignIn(email, password) {
  try {
    return (await signInWithEmailAndPassword(auth, email, password)).user;
  } catch (e) {
    const c = e && e.code;
    if (c === 'auth/user-not-found' || c === 'auth/wrong-password'
        || c === 'auth/invalid-credential' || c === 'auth/invalid-email') {
      throw new Error('Email or password is incorrect. Ask the studio to set up your account if you do not have one.');
    }
    if (c === 'auth/too-many-requests') {
      throw new Error('Too many attempts — wait a few minutes and try again.');
    }
    if (c === 'auth/user-disabled') {
      throw new Error('This account has been disabled. Contact the studio.');
    }
    if (c === 'auth/network-request-failed') {
      throw new Error('No internet — check your connection.');
    }
    throw new Error('Sign-in failed. Please try again, or contact the studio.');
  }
}

export function logOut() {
  return signOut(auth);
}

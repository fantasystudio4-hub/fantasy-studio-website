/* LensCal — auth service. Phone OTP first, email/password fallback. */
import {
  auth, onAuthStateChanged, RecaptchaVerifier, signInWithPhoneNumber,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
} from '../firebase.js';
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

export async function emailSignIn(email, password) {
  try {
    return (await signInWithEmailAndPassword(auth, email, password)).user;
  } catch (e) {
    // Auto-create the account on first sign-in (fallback path is meant
    // to be as low-friction as OTP).
    if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential') {
      try {
        return (await createUserWithEmailAndPassword(auth, email, password)).user;
      } catch (e2) {
        if (e2.code === 'auth/email-already-in-use') throw new Error('Wrong password for this email');
        throw e2;
      }
    }
    throw e;
  }
}

export function logOut() {
  return signOut(auth);
}

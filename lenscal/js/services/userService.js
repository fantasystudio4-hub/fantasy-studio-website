/* LensCal — user profile service. */
import {
  db, doc, getDoc, getDocs, setDoc, collection, query, where, limit,
  onSnapshot, serverTimestamp,
} from '../firebase.js';
import { COL } from '../config.js';
import { normalizePhone } from './authService.js';

const userRef = uid => doc(db, COL.users, uid);
const cache = new Map(); // uid -> profile (last seen)

export async function getProfile(uid, { fresh = false } = {}) {
  if (!fresh && cache.has(uid)) return cache.get(uid);
  const snap = await getDoc(userRef(uid));
  const p = snap.exists() ? { id: uid, ...snap.data() } : null;
  if (p) cache.set(uid, p);
  return p;
}

export async function getProfiles(uids) {
  return (await Promise.all(uids.map(u => getProfile(u)))).filter(Boolean);
}

export function listenProfile(uid, cb) {
  return onSnapshot(userRef(uid), snap => {
    const p = snap.exists() ? { id: uid, ...snap.data() } : null;
    if (p) cache.set(uid, p);
    cb(p);
  });
}

/** Create/update the profile. Fields: name, phone, email, roles[], city, area,
    areaLat, areaLng, geohash, rate, ratePrivate, photoURL, locationMode, plan. */
export async function saveProfile(uid, data) {
  const clean = { ...data, updatedAt: serverTimestamp() };
  if (clean.phone) clean.phone = normalizePhone(clean.phone) || clean.phone;
  const existing = await getProfile(uid, { fresh: true });
  if (!existing) {
    clean.createdAt = serverTimestamp();
    clean.plan = clean.plan || 'free';
    clean.locationMode = clean.locationMode || 'area';
    clean.ratePrivate = clean.ratePrivate !== false; // private by default
  }
  await setDoc(userRef(uid), clean, { merge: true });
  cache.delete(uid);
  return getProfile(uid, { fresh: true });
}

/** Stamp "last calendar update" — the trust signal shown to connections. */
export function touchCalendarUpdate(uid) {
  return setDoc(userRef(uid), { lastCalendarUpdate: serverTimestamp() }, { merge: true })
    .catch(() => {});
}

export async function findByPhone(rawPhone) {
  const phone = normalizePhone(rawPhone);
  if (!phone) return null;
  const q = query(collection(db, COL.users), where('phone', '==', phone), limit(1));
  const snaps = await getDocs(q);
  if (snaps.empty) return null;
  const d = snaps.docs[0];
  return { id: d.id, ...d.data() };
}

/** "Updated 2 days ago" style label from a Firestore timestamp. */
export function agoLabel(ts) {
  if (!ts) return 'never updated';
  const ms = ts.toMillis ? ts.toMillis() : +ts;
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d} days ago`;
  const mo = Math.floor(d / 30);
  return mo === 1 ? '1 month ago' : `${mo} months ago`;
}

/* LensCal — urgent broadcasts. No feed, no likes, no comments.
   Targeting: at post time we compute which connections are 🟢 for the
   exact date+slot(s) and store them in `to`, nearest-first. Recipients
   get it via a live listener on array-contains(to, myUid). Broadcasts
   auto-expire after their date passes (filtered on read; a TTL policy
   on `expiresAtMs` can hard-delete them later). */
import {
  db, doc, updateDoc, deleteDoc, addDoc, collection, query, where, onSnapshot,
  serverTimestamp,
} from '../firebase.js';
import { COL, SLOT_IDS } from '../config.js';
import { connectedUids } from './networkService.js';
import { getProfiles, getProfile } from './userService.js';
import { getUsersForDate, isFreeFor } from './availabilityService.js';
import { sharedLocation, distanceBetween, getSearchOrigin } from './locationService.js';

/** Post a broadcast. Returns { id, recipients } (recipients nearest-first). */
export async function postBroadcast(uid, { need, date, slotIds, area, budget, note }) {
  const me = await getProfile(uid);
  const wanted = slotIds && slotIds.length ? slotIds : SLOT_IDS;
  const uids = await connectedUids(uid);
  const [profiles, availMap, origin] = await Promise.all([
    getProfiles(uids), getUsersForDate(uids, date), getSearchOrigin(me),
  ]);

  // Only connections 🟢 for that exact date+slot, ordered nearest-first
  const recipients = profiles
    .filter(p => isFreeFor(availMap.get(p.id) || null, wanted))
    .map(p => {
      const loc = sharedLocation(p);
      return { uid: p.id, km: origin && loc ? distanceBetween(origin, loc) : Infinity };
    })
    .sort((a, b) => a.km - b.km)
    .map(r => r.uid);

  const expires = new Date(date + 'T23:59:59');
  const ref = await addDoc(collection(db, COL.broadcasts), {
    by: uid,
    byName: me?.name || '',
    byArea: me?.area || '',
    need, date, slotIds: wanted,
    area: area || '', budget: budget || '', note: note || '',
    lat: me?.areaLat ?? null, lng: me?.areaLng ?? null,
    to: recipients,
    responders: {},
    createdAt: serverTimestamp(),
    expiresAtMs: +expires,
  });
  return { id: ref.id, recipients };
}

const notExpired = b => (b.expiresAtMs || 0) > Date.now();

/** Live broadcasts addressed to me. */
export function listenIncoming(uid, cb) {
  const q = query(collection(db, COL.broadcasts), where('to', 'array-contains', uid));
  return onSnapshot(q, snaps => {
    const out = [];
    snaps.forEach(d => { const b = { id: d.id, ...d.data() }; if (notExpired(b)) out.push(b); });
    out.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    cb(out);
  });
}

/** Live broadcasts I posted (to see responders). */
export function listenMine(uid, cb) {
  const q = query(collection(db, COL.broadcasts), where('by', '==', uid));
  return onSnapshot(q, snaps => {
    const out = [];
    snaps.forEach(d => out.push({ id: d.id, ...d.data() }));
    out.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    cb(out);
  });
}

/** "I'm in" — records name + distance so the poster sees responders sorted. */
export async function respond(broadcast, uid) {
  const me = await getProfile(uid);
  const myLoc = sharedLocation(me);
  const posterLoc = broadcast.lat != null ? [broadcast.lat, broadcast.lng] : null;
  const km = myLoc && posterLoc ? distanceBetween(posterLoc, myLoc) : null;
  await updateDoc(doc(db, COL.broadcasts, broadcast.id), {
    [`responders.${uid}`]: {
      name: me?.name || '', area: me?.area || '', phone: me?.phone || '',
      km, at: Date.now(),
    },
  });
}

export function deleteBroadcast(id) {
  return deleteDoc(doc(db, COL.broadcasts, id));
}

export function respondersSorted(b) {
  return Object.entries(b.responders || {})
    .map(([uid, r]) => ({ uid, ...r }))
    .sort((a, x) => (a.km ?? Infinity) - (x.km ?? Infinity));
}

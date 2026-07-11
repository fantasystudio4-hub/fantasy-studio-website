/* LensCal — network service: mutual connections + custom groups. */
import {
  db, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
  collection, query, where, onSnapshot, serverTimestamp,
} from '../firebase.js';
import { COL } from '../config.js';
import { findByPhone, getProfile } from './userService.js';
import { canAddConnection } from './planService.js';

const pairId = (a, b) => [a, b].sort().join('_');
const connRef = (a, b) => doc(db, COL.connections, pairId(a, b));

/* ---------- connections ---------- */

/** Send a request by phone number. Returns the target profile. */
export async function requestByPhone(myUid, phone) {
  const target = await findByPhone(phone);
  if (!target) throw new Error('No LensCal user with that number — send them your invite link!');
  await requestByUid(myUid, target.id);
  return target;
}

export async function requestByUid(myUid, targetUid) {
  if (targetUid === myUid) throw new Error("That's you!");
  const me = await getProfile(myUid);
  const mine = await listConnections(myUid, { includePending: true });
  if (!canAddConnection(me, mine.filter(c => c.status === 'accepted').length)) {
    throw new Error('Free plan is limited to 10 connections');
  }
  const ref = connRef(myUid, targetUid);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    const c = existing.data();
    if (c.status === 'accepted') throw new Error('Already connected');
    if (c.requestedBy === myUid) throw new Error('Request already sent');
    // They already asked us → accept.
    return accept(myUid, targetUid);
  }
  await setDoc(ref, {
    users: [myUid, targetUid].sort(),
    requestedBy: myUid,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
}

export async function accept(myUid, otherUid) {
  await updateDoc(connRef(myUid, otherUid), {
    status: 'accepted', acceptedAt: serverTimestamp(),
  });
}

export async function remove(myUid, otherUid) {
  await deleteDoc(connRef(myUid, otherUid));
}

/** All my connection docs (accepted + optionally pending), enriched with
    the other user's uid. */
export async function listConnections(uid, { includePending = false } = {}) {
  const q = query(collection(db, COL.connections), where('users', 'array-contains', uid));
  const snaps = await getDocs(q);
  const out = [];
  snaps.forEach(d => {
    const c = { id: d.id, ...d.data() };
    if (c.status !== 'accepted' && !includePending) return;
    c.otherUid = c.users.find(u => u !== uid);
    out.push(c);
  });
  return out;
}

export function listenConnections(uid, cb) {
  const q = query(collection(db, COL.connections), where('users', 'array-contains', uid));
  return onSnapshot(q, snaps => {
    const out = [];
    snaps.forEach(d => {
      const c = { id: d.id, ...d.data() };
      c.otherUid = c.users.find(u => u !== uid);
      out.push(c);
    });
    cb(out);
  });
}

/** Accepted connection uids only. */
export async function connectedUids(uid) {
  return (await listConnections(uid)).map(c => c.otherUid);
}

export function inviteLink(uid) {
  const base = location.origin + location.pathname;
  return `${base}#/invite/${uid}`;
}

/* ---------- groups ("Core Team", "Drone Guys", ...) ---------- */

export async function createGroup(ownerUid, name, memberUids = []) {
  const ref = await addDoc(collection(db, COL.groups), {
    owner: ownerUid, name, memberUids, createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function listGroups(ownerUid) {
  const q = query(collection(db, COL.groups), where('owner', '==', ownerUid));
  const snaps = await getDocs(q);
  const out = [];
  snaps.forEach(d => out.push({ id: d.id, ...d.data() }));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function updateGroup(groupId, patch) {
  await updateDoc(doc(db, COL.groups, groupId), patch);
}

export async function deleteGroup(groupId) {
  await deleteDoc(doc(db, COL.groups, groupId));
}

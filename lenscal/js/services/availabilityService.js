/* ============================================================
   LENSCAL — AVAILABILITY ENGINE
   The core module. One document per user-date:
     lenscal_availability/{uid}_{date} = {
       userId, date: 'YYYY-MM-DD',
       slots: { [slotId]: { status, note?, updatedAt } },
       updatedAt
     }
   Slots/statuses come from config.js — the engine itself is
   slot-agnostic, so adding 'night' or 'fullday' needs no change here.
   All reads/writes in the app go through this service.
   ============================================================ */
import {
  db, doc, getDoc, getDocs, setDoc, collection, query, orderBy, startAt,
  endAt, onSnapshot, documentId,
} from '../firebase.js';
import { COL, SLOT_IDS, DEFAULT_STATUS, STATUS_CYCLE, STATUSES } from '../config.js';
import { touchCalendarUpdate } from './userService.js';

export const docId = (uid, date) => `${uid}_${date}`;
const ref = (uid, date) => doc(db, COL.availability, docId(uid, date));

/* ---------- date helpers (local time, ISO date strings) ---------- */
export function toISODate(d) {
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
export const todayISO = () => toISODate(new Date());
export function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return toISODate(dt);
}
export function monthRange(year, month /* 0-based */) {
  const start = toISODate(new Date(year, month, 1));
  const end = toISODate(new Date(year, month + 1, 0));
  return { start, end };
}

/* ---------- reads ---------- */

/** Effective state of one slot. Unmarked = available but 'unconfirmed'
    so searchers can distinguish "actively marked free" from "never touched". */
export function effectiveSlot(availDoc, slotId) {
  const s = availDoc && availDoc.slots && availDoc.slots[slotId];
  if (s && s.status && STATUSES[s.status]) {
    return { status: s.status, note: s.note || '', confirmed: true, updatedAt: s.updatedAt || null };
  }
  return { status: DEFAULT_STATUS, note: '', confirmed: false, updatedAt: null };
}

export function nextStatus(current) {
  const i = STATUS_CYCLE.indexOf(current);
  return STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length];
}

/** Live month view for one user. cb receives Map<dateISO, availDoc>.
    Uses a documentId() range query ({uid}_{start}..{uid}_{end}) — needs
    no composite index. */
export function listenMonth(uid, year, month, cb) {
  const { start, end } = monthRange(year, month);
  const q = query(
    collection(db, COL.availability),
    orderBy(documentId()),
    startAt(docId(uid, start)),
    endAt(docId(uid, end)),
  );
  return onSnapshot(q, snap => {
    const map = new Map();
    snap.forEach(d => { const v = d.data(); map.set(v.date, v); });
    cb(map);
  });
}

/** One-shot fetch of a single user-date doc. */
export async function getDay(uid, date) {
  const snap = await getDoc(ref(uid, date));
  return snap.exists() ? snap.data() : null;
}

/** Live availability of many users for ONE date (Find Crew, Broadcast).
    cb receives Map<uid, availDoc|null>; returns unsubscribe fn. */
export function listenUsersForDate(uids, date, cb) {
  const state = new Map(uids.map(u => [u, null]));
  if (!uids.length) { cb(state); return () => {}; }
  const unsubs = uids.map(uid =>
    onSnapshot(ref(uid, date), snap => {
      state.set(uid, snap.exists() ? snap.data() : null);
      cb(new Map(state));
    })
  );
  return () => unsubs.forEach(u => u());
}

/** One-shot: which of `uids` are available for all `slotIds` on `date`. */
export async function getUsersForDate(uids, date) {
  const snaps = await Promise.all(uids.map(uid => getDoc(ref(uid, date))));
  const map = new Map();
  uids.forEach((uid, i) => map.set(uid, snaps[i].exists() ? snaps[i].data() : null));
  return map;
}

export function isFreeFor(availDoc, slotIds) {
  return slotIds.every(sid => effectiveSlot(availDoc, sid).status === 'available');
}

/* ---------- writes (all stamp lastCalendarUpdate on the user) ---------- */

async function writeSlots(uid, date, slotPatch) {
  const payload = { userId: uid, date, updatedAt: Date.now(), slots: {} };
  for (const [sid, v] of Object.entries(slotPatch)) {
    payload.slots[sid] = { ...v, updatedAt: Date.now() };
  }
  await setDoc(ref(uid, date), payload, { merge: true });
  touchCalendarUpdate(uid);
}

/** Set one slot's status (and optionally note). */
export function setSlot(uid, date, slotId, status, note) {
  const v = { status };
  if (note !== undefined) v.note = note;
  return writeSlots(uid, date, { [slotId]: v });
}

/** Set the private note on a slot without touching status. */
export async function setNote(uid, date, slotId, note) {
  const cur = await getDay(uid, date);
  const status = effectiveSlot(cur, slotId).status;
  return writeSlots(uid, date, { [slotId]: { status, note } });
}

/** "Mark full day" — all slots at once. */
export function setDay(uid, date, status) {
  const patch = {};
  for (const sid of SLOT_IDS) patch[sid] = { status };
  return writeSlots(uid, date, patch);
}

/** Multi-date apply (2–3 day weddings): dates[] × slotIds[] → status. */
export async function setMultiple(uid, dates, slotIds, status) {
  await Promise.all(dates.map(date => {
    const patch = {};
    for (const sid of slotIds) patch[sid] = { status };
    return writeSlots(uid, date, patch);
  }));
}

/** Tap-to-cycle a slot: 🟢 → 🔴 → 🟡 → 🟢 */
export async function cycleSlot(uid, date, slotId, currentEffective) {
  const status = nextStatus(currentEffective);
  await setSlot(uid, date, slotId, status);
  return status;
}

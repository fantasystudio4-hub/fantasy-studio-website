/* ============================================================
   FANTASY STUDIO — SHARED RULES (admin panel, crew page, partner page)

   The rules that two screens must answer IDENTICALLY, kept in one place.
   Each used to be copied by hand into every page that needed it, with a
   comment asking the next editor to keep the copies in step — the crew pay
   helpers lived in admin/app.js AND team/index.html, the partner's two
   balance boxes in admin/app.js AND studio/index.html. One copy drifting
   meant the owner and a crew member (or a partner studio) seeing different
   amounts owed.

   Pure functions only: no imports, no DOM, no Firestore. Loaded with a static
   `import … from '../fs-shared.js'`, so it is app code to the service worker
   (sw.js APP_CODE) and on the crew page's offline list (team/index.html NEED).
   ============================================================ */

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/* The studio's number when the live contact (config/site, edited in the admin)
   has not loaded. The pages' plain tel: / wa.me links stay hardcoded in their
   HTML on purpose — they must work before any script runs. */
export const STUDIO_PHONE = '+91 86868 68803';
export const STUDIO_PHONE10 = STUDIO_PHONE.replace(/\D/g, '').slice(-10);

/* text into innerHTML — every name, note and message written by a client, crew
   member, partner or the public goes through this (null/undefined → '') */
export const esc = t => String(t == null ? '' : t)
  .replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
/* whole rupees, Indian grouping: ₹1,20,000 (junk reads as ₹0) */
export const inr = n => '₹' + Math.round(Number(n)||0).toLocaleString('en-IN');

/* Days are the STUDIO's days: Hyderabad time, whatever zone the phone is set
   to (owner, 1 Nov 2026). A crew member or the owner in Dubai, or an NRI client
   in the US, used to see "today" flip at their own midnight — fees owed a day
   early or late, a countdown at zero the evening before, a different day from
   the morning brief. India has no daylight saving, so a fixed +5:30 is exact. */
const IST_MS = 330 * 60000;
/* the yyyy-mm-dd in Hyderabad at epoch-ms (a Firestore Timestamp: t.toMillis()) */
export const istDay = ms => new Date(Number(ms) + IST_MS).toISOString().slice(0, 10);
/* today as yyyy-mm-dd, Hyderabad time */
export const todayISO = () => istDay(Date.now());
/* the moment a yyyy-mm-dd (and optional hh:mm) begins, Hyderabad time */
export const istAt = (date, hhmm) => new Date(`${date}T${hhmm || '00:00'}:00+05:30`);

/* asked once per row per total — over 2,000 assignments a date-formatter call
   each time is felt on a phone, so today's date is held for a second */
let _day = '', _dayAt = 0;
function today(){
  const t = Date.now();
  if(!_day || t - _dayAt > 1000 || t < _dayAt){ _day = todayISO(); _dayAt = t; }
  return _day;
}

/* ---------- crew pay ----------
   A shoot can be settled in instalments, so pay.payments[] is the record and
   pay.paidAmount its running sum. Rows written before instalments existed
   carry only pay.paid + pay.paidDate, so every reader goes through these
   helpers and old rows keep reading correctly with nothing to migrate. */
export const payFee = a => Math.max(0, Number(((a||{}).pay||{}).amount)||0);
export function payGot(a){
  const p = (a||{}).pay || {};
  if(p.paidAmount !== undefined && p.paidAmount !== null) return Math.max(0, Number(p.paidAmount)||0);
  return p.paid ? Math.max(0, Number(p.amount)||0) : 0;   /* legacy: paid meant paid in full */
}
export const payDue = a => Math.max(0, payFee(a) - payGot(a));
/* 'paid' only when a real fee has been fully settled; 'part' once money has
   moved but not all of it; 'due' otherwise */
export function payState(a){
  const fee = payFee(a), got = payGot(a);
  if(got > 0 && fee <= 0) return 'paid';   /* money paid against no fee is settled, not part-paid */
  if(fee > 0 && got >= fee) return 'paid';
  return got > 0 ? 'part' : 'due';
}
/* WHEN a fee becomes owed (owner, 1 Oct 2026): assigning someone to a shoot is
   an agreement, not a debt — the fee is owed from the DAY AFTER the event.
   Until then the unpaid part is "upcoming". Editing jobs are owed as soon as
   they are assigned, and so is a row with no usable date (a shoot that can
   never become "past" must not hide its fee for ever). Money actually
   recorded (payGot) is never affected. Always: payOwed + payUpcoming === payDue. */
export const payEarned = a => !a || a.kind === 'edit' || !ISO_DATE.test(a.date||'') || a.date < today();
export const payOwed = a => payEarned(a) ? payDue(a) : 0;
export const payUpcoming = a => payEarned(a) ? 0 : payDue(a);

/* ---------- a partner studio's account ----------
   Which box a confirmed job sits in. 'upcoming' = nothing shot yet (the first
   dated event is still ahead, or there are no dates); 'ongoing' = a day shot
   and a day still to come; 'done' = the last day is behind us, or the job is
   marked delivered. The admin's studio page, the WhatsApp statement and the
   partner portal all draw their two balance figures from this. */
export function jobPhase(x){
  if(((x && x.status) || 'draft') === 'delivered') return 'done';
  const t = todayISO();
  const ds = ((x && x.events) || []).map(e => e && e.date).filter(d => ISO_DATE.test(d||'')).sort();
  if(!ds.length || ds[0] > t) return 'upcoming';
  return ds[ds.length - 1] >= t ? 'ongoing' : 'done';
}
export const jobBalance = x => Math.max(0, Number(((x && x.totals) || {}).balance)||0);

/* ---------- when the crew see a shoot's details ----------
   The owner (3 Nov 2026): a member put on a shoot days ahead sees only that
   there IS one — the date and morning/evening — and the rest (the function,
   client, venue, call time, notes, role, who else is on it) from 4 pm India
   time the DAY BEFORE. An event on the 19th opens on the 18th at 16:00 IST.
   Editing jobs and rows with no usable date are never held back. Returns the
   moment in epoch-ms; 0 means "open now". The crew-alert function keeps its
   own copy of this rule (app/backend/functions/alerts.js, detailsOpenAt). */
export const DETAILS_OPEN_TIME = '16:00';
export function detailsOpenAt(a){
  if(!a || a.kind === 'edit' || !ISO_DATE.test(a.date||'')) return 0;
  const d = new Date(a.date + 'T00:00:00Z');
  if(isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== a.date) return 0;
  d.setUTCDate(d.getUTCDate() - 1);
  return istAt(d.toISOString().slice(0, 10), DETAILS_OPEN_TIME).getTime();
}
export const detailsOpen = (a, nowMs) => Number(nowMs) >= detailsOpenAt(a);

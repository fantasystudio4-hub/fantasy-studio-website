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

/* today as yyyy-mm-dd on this device's calendar — the rule every page used */
export const todayISO = () => new Date().toLocaleDateString('en-CA');

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

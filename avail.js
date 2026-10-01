/* ============================================================
   FANTASY STUDIO — AVAILABILITY CALENDAR (shared widget)

   The month grid signed-in clients, partner studios and crew see on
   their Schedule / Shoots tab. Each day is split in two halves —
   morning on top, evening below — and every half is plain (free),
   amber (some bookings, filling up) or red (full, or blocked by the
   studio). Colours only: it never shows names, counts or which events
   exist. Past days are dimmed and carry no colour.

   Data — one public doc per month, written by the Cloud Function:
     availability/{YYYY-MM} = { month, days:{ 'DD': { m:'y'|'r', e:'y'|'r' } }, updatedAt }
   A half that is free is simply absent; a missing doc means the whole
   month is free. The widget listens to the VISIBLE month only (a plain
   doc get by id, never a query) and lets go of it on every month change.
   A permission error is treated as "all free" and nothing is said.

   Usage, on any of the dark portals after sign-in:
     const { mountAvailability } = await import('../avail.js');
     const cal = mountAvailability(document.querySelector('#availBox'), {
       db: FS.db,                       // Firestore from fs-auth.js
       sample: FS.isSample(user),       // true → built-in pattern, no reads
       mine: () => ['2026-10-12'],      // own event dates → gold ring
       onAsk: (iso, slot) => { … },     // 'm' | 'e'; null → no Ask button
       askLabels: { m: '…', e: '…' },   // optional: the two buttons' wording
                                        // (default 'Ask about the morning / evening')
       monthsAhead: 12,                 // this month .. +12
       heading: 'Studio availability'
     });
     cal.refresh();   // own dates changed (mine() is read again)
     cal.destroy();   // sign-out / page teardown

   avail.css sits beside this file and is linked in once on first mount
   (pass css:false to link it yourself). Mounting again on the same host
   replaces the earlier widget, listener included, so a portal that
   re-renders on every snapshot can call this freely.
   ============================================================ */
import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MON3   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW3   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];      /* Date.getDay() order */
const WORD   = { '': 'available', y: 'filling up', r: 'fully booked' };
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

const pad      = n => String(n).padStart(2, '0');
const isoOf    = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => isoOf(new Date());
const monthKey = (y, m) => `${y}-${pad(m + 1)}`;
const flag     = v => (v === 'y' || v === 'r') ? v : '';           /* anything else in the doc = free */
const esc      = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

function injectCss(){
  /* the portals link avail.css in their <head>; only a page that did not gets it here */
  if(document.getElementById('fs-avail-css')) return;
  if(Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some(l => /(^|\/)avail\.css(\?|$)/.test(l.getAttribute('href') || ''))) return;
  const l = document.createElement('link');
  l.id = 'fs-avail-css'; l.rel = 'stylesheet';
  l.href = new URL('./avail.css', import.meta.url).href;
  document.head.appendChild(l);
}

/* Sample data for the App Review login and /?demo: a fixed pattern of
   offsets from today, so the next weeks always show a few amber days, a
   few red ones and one mixed day, whatever month it is. Shape is exactly
   what the Cloud Function writes for one month. Today and tomorrow carry
   one amber half each, so the month that opens first always has colour
   even on the 31st. */
const SAMPLE = [
  [0, '', 'y'], [1, 'y', ''],
  [2, 'y', 'y'], [4, 'r', 'r'], [6, 'y', 'y'], [9, 'y', 'r'], [11, 'y', 'y'], [14, 'r', 'r'],
  [19, '', 'y'], [23, 'r', 'r'], [27, 'y', ''],
  [33, '', 'y'], [37, 'r', 'r'], [41, 'y', ''], [45, 'y', 'y'], [52, 'r', 'y'],
  [60, 'r', 'r'], [66, 'y', 'y'], [75, 'y', 'y'], [88, 'r', 'r'], [100, 'y', 'y'], [130, 'r', 'r'],
];
/* exported so a portal's own form can read the same sample its calendar paints */
export function sampleDays(month){
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const days = {};
  SAMPLE.forEach(([off, m, e]) => {
    const d = new Date(t); d.setDate(t.getDate() + off);
    if(monthKey(d.getFullYear(), d.getMonth()) !== month) return;
    const o = {}; if(m) o.m = m; if(e) o.e = e;
    days[pad(d.getDate())] = o;
  });
  return days;
}

const _byHost = new WeakMap();   /* host element → live widget, so a remount replaces it */

export function mountAvailability(host, opts = {}){
  if(!host) throw new Error('mountAvailability: no element to draw into');
  const earlier = _byHost.get(host); if(earlier) earlier.destroy();
  if(opts.css !== false) injectCss();

  const o = {
    db: opts.db || null,
    sample: !!opts.sample,
    mine: typeof opts.mine === 'function' ? opts.mine : () => [],
    onAsk: typeof opts.onAsk === 'function' ? opts.onAsk : null,
    /* the partner page asks with a request form, not WhatsApp, and says so */
    askLabels: {
      m: String((opts.askLabels && opts.askLabels.m) || 'Ask about the morning'),
      e: String((opts.askLabels && opts.askLabels.e) || 'Ask about the evening'),
    },
    monthsAhead: Number.isFinite(opts.monthsAhead) ? Math.max(0, Math.floor(opts.monthsAhead)) : 12,
    heading: opts.heading == null ? 'Studio availability' : String(opts.heading),
  };

  const now = new Date();
  let y = now.getFullYear(), m = now.getMonth();   /* the visible month */
  let sel = null;                                  /* selected 'YYYY-MM-DD' in the visible month */
  let days = {};                                   /* the visible month's doc.days */
  let loading = false, failed = false, dead = false;
  let unsub = null, subKey = '';
  let mineSet = new Set();

  const root = document.createElement('div');
  root.className = 'fs-avail';
  root.innerHTML = `
    ${o.heading ? `<h2 class="av-h">${esc(o.heading)}</h2>` : ''}
    <div class="av-nav">
      <button type="button" class="av-btn" data-prev aria-label="Previous month">‹</button>
      <div class="av-title" aria-live="polite"><b data-title></b></div>
      <button type="button" class="av-btn" data-next aria-label="Next month">›</button>
      <button type="button" class="av-btn av-today" data-today>Today</button>
    </div>
    <div class="av-grid" data-grid role="group" aria-label="Availability by day, morning above evening"></div>
    <div class="av-legend">
      <span class="av-key"><i class="av-mini" aria-hidden="true"><b></b><b></b></i>top morning · bottom evening</span>
      <span><i class="av-sw" aria-hidden="true"></i>Available</span>
      <span><i class="av-sw y" aria-hidden="true"></i>Filling up</span>
      <span><i class="av-sw r" aria-hidden="true"></i>Fully booked</span>
      <span data-lg-mine hidden><i class="av-sw mine" aria-hidden="true"></i>Your date</span>
    </div>
    <div class="av-detail" data-detail aria-live="polite"></div>`;
  host.appendChild(root);
  const $ = s => root.querySelector(s);
  const grid = $('[data-grid]'), detail = $('[data-detail]'), title = $('[data-title]');
  const prevBtn = $('[data-prev]'), nextBtn = $('[data-next]');

  /* this month .. +monthsAhead, recomputed on use so a page left open
     past midnight on the 31st still moves with the calendar */
  const bounds = () => { const n = new Date(), lo = n.getFullYear() * 12 + n.getMonth(); return { lo, hi: lo + o.monthsAhead }; };

  function readMine(){
    let list = [];
    try { list = o.mine() || []; } catch(e){ list = []; }
    mineSet = new Set(Array.from(list).filter(v => ISO_RE.test(String(v))));
    const lg = $('[data-lg-mine]'); if(lg) lg.hidden = !mineSet.size;
  }

  function halves(iso){
    const rec = days[iso.slice(8)];
    const r = rec && typeof rec === 'object' ? rec : {};
    return { ms: flag(r.m), es: flag(r.e) };
  }

  function renderGrid(){
    const first = new Date(y, m, 1);
    const startDow = (first.getDay() + 6) % 7;      /* Monday-first week, like the admin panel */
    const dim = new Date(y, m + 1, 0).getDate();
    const tIso = todayIso();
    const key = monthKey(y, m);
    let h = ['M','T','W','T','F','S','S'].map((d, i) => `<div class="av-dow${i > 4 ? ' we' : ''}" aria-hidden="true">${d}</div>`).join('');
    for(let i = 0; i < startDow; i++) h += '<div class="av-cell off" aria-hidden="true"></div>';
    for(let d = 1; d <= dim; d++){
      const iso = `${key}-${pad(d)}`;
      const col = (startDow + d - 1) % 7;           /* 5 and 6 are Sat and Sun — tinted */
      const past = iso < tIso, today = iso === tIso, mine = mineSet.has(iso);
      const { ms, es } = past ? { ms: '', es: '' } : halves(iso);
      const cls = ['av-cell', col > 4 ? 'we' : '', today ? 'today' : '', past ? 'past' : '', mine ? 'mine' : '', iso === sel ? 'sel' : ''].filter(Boolean).join(' ');
      const label = past
        ? `${d} ${MONTHS[m]} — past`
        : `${today ? 'Today, ' : ''}${d} ${MONTHS[m]} — morning ${WORD[ms]}, evening ${WORD[es]}${mine ? ', your event' : ''}`;
      h += `<button type="button" class="${cls}" data-date="${iso}" aria-label="${label}" aria-pressed="${iso === sel}"${past ? ' disabled' : ''}>
        <span class="av-d">${d}</span>
        <span class="av-bands" aria-hidden="true"><i class="av-half${ms ? ' ' + ms : ''}"></i><i class="av-half${es ? ' ' + es : ''}"></i></span>
      </button>`;
    }
    /* Enter/Space on a cell arrives as a click and repaints, and the
       rebuild would drop the keyboard focus to <body>: note whether the
       focus was in the grid and put it back on the selected day (or the
       same date, when nothing is selected) */
    const active = grid.contains(document.activeElement) ? document.activeElement : null;
    const back = active && active.dataset ? active.dataset.date : '';
    grid.innerHTML = h;
    if(active){
      const c = grid.querySelector('.av-cell.sel') || (back ? grid.querySelector(`.av-cell[data-date="${back}"]`) : null);
      if(c) c.focus({ preventScroll: true });
    }
    title.textContent = `${MONTHS[m]} ${y}`;
    const { lo, hi } = bounds(), idx = y * 12 + m;
    prevBtn.disabled = idx <= lo;
    nextBtn.disabled = idx >= hi;
    root.classList.toggle('loading', loading);
  }

  function renderDetail(){
    if(!sel){
      detail.innerHTML = `<span class="av-hint">${loading ? 'Checking the studio calendar…' : 'Tap a date to see its morning and evening.'}</span>`;
      return;
    }
    const d = new Date(sel + 'T00:00');
    const past = sel < todayIso();
    const when = `${DOW3[d.getDay()]} ${d.getDate()} ${MON3[d.getMonth()]}`;
    if(past){ detail.innerHTML = `<b>${when}</b> — <span class="av-hint">this date has passed.</span>`; return; }
    const { ms, es } = halves(sel);
    let h = `<b>${when}</b> — <span class="av-slot">Morning: <em class="${ms || 'ok'}">${WORD[ms]}</em></span> · <span class="av-slot">Evening: <em class="${es || 'ok'}">${WORD[es]}</em></span>`;
    if(mineSet.has(sel)) h += `<span class="av-you">Your date</span>`;
    /* one Ask per half that is not red: a free day offers both, a half-red
       day the other half, a red day none */
    if(o.onAsk && (ms !== 'r' || es !== 'r')){
      h += '<span class="av-asks">';
      if(ms !== 'r') h += `<button type="button" class="av-ask" data-ask="m">${esc(o.askLabels.m)}</button>`;
      if(es !== 'r') h += `<button type="button" class="av-ask" data-ask="e">${esc(o.askLabels.e)}</button>`;
      h += '</span>';
    }
    detail.innerHTML = h;
  }
  const paint = () => { renderGrid(); renderDetail(); };

  function unsubscribe(){ if(unsub){ try { unsub(); } catch(e){} } unsub = null; subKey = ''; }

  /* listen to the visible month; sample mode and a missing db paint at once */
  function subscribe(){
    unsubscribe();
    const key = monthKey(y, m);
    days = {}; failed = false; loading = false;
    if(o.sample){
      days = sampleDays(key);
      /* the person's own dates are bookings too: at least amber in both
         halves, so a ringed day never reads as fully free */
      readMine();
      mineSet.forEach(iso => {
        if(iso.slice(0, 7) !== key) return;
        const dd = iso.slice(8), rec = days[dd] || (days[dd] = {});
        if(rec.m !== 'r') rec.m = 'y';
        if(rec.e !== 'r') rec.e = 'y';
      });
      paint(); return;
    }
    if(!o.db){ paint(); return; }
    subKey = key; loading = true;
    try {
      unsub = onSnapshot(doc(o.db, 'availability', key), snap => {
        if(dead || subKey !== key) return;
        const data = (snap.exists() && snap.data()) || {};
        days = (data.days && typeof data.days === 'object') ? data.days : {};
        loading = false; paint();
      }, () => {
        /* no permission, offline with nothing cached, anything: all free, quietly */
        if(dead || subKey !== key) return;
        failed = true; loading = false; days = {}; paint();
      });
    } catch(e){ failed = true; loading = false; }
    paint();
  }

  function go(delta){
    const { lo, hi } = bounds();
    const idx = Math.min(hi, Math.max(lo, y * 12 + m + delta));
    if(idx === y * 12 + m) return;
    y = Math.floor(idx / 12); m = idx % 12; sel = null;
    subscribe();
  }

  prevBtn.addEventListener('click', () => go(-1));
  nextBtn.addEventListener('click', () => go(1));
  $('[data-today]').addEventListener('click', () => {
    const n = new Date();
    sel = isoOf(n);
    if(n.getFullYear() === y && n.getMonth() === m){ paint(); return; }
    y = n.getFullYear(); m = n.getMonth();
    subscribe();
  });
  grid.addEventListener('click', e => {
    const c = e.target.closest('.av-cell[data-date]'); if(!c || c.disabled) return;
    sel = c.dataset.date; paint();
  });
  /* arrow keys walk the grid; past (disabled) cells are stepped over */
  grid.addEventListener('keydown', e => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]; if(!step) return;
    const from = e.target.closest('.av-cell[data-date]'); if(!from) return;
    const cells = Array.from(grid.querySelectorAll('.av-cell[data-date]'));
    let i = cells.indexOf(from) + step;
    const dir = step > 0 ? 1 : -1;
    while(i >= 0 && i < cells.length && cells[i].disabled) i += dir;
    if(i < 0 || i >= cells.length) return;
    e.preventDefault(); cells[i].focus();
  });
  detail.addEventListener('click', e => {
    const b = e.target.closest('[data-ask]'); if(!b || !o.onAsk || !sel) return;
    o.onAsk(sel, b.dataset.ask === 'e' ? 'e' : 'm');
  });

  const api = {
    refresh(){
      if(dead) return;
      readMine();
      /* a listener that failed gets one more try (e.g. signed in since);
         the sample repaints its pattern, so moved own dates re-mark */
      if(failed || o.sample) subscribe(); else paint();
    },
    destroy(){
      if(dead) return;
      dead = true; unsubscribe(); root.remove();
      if(_byHost.get(host) === api) _byHost.delete(host);
    },
  };
  _byHost.set(host, api);

  readMine();
  subscribe();
  return api;
}

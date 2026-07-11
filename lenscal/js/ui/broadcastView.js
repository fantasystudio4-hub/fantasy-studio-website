/* LensCal — Urgent Broadcast: need + date + slot + area + budget.
   Pings only connections who are 🟢 for that exact date+slot. */
import { el, clear, toast, sheet, emptyState, fmtDateNice } from './components.js';
import {
  postBroadcast, listenIncoming, listenMine, respond, deleteBroadcast, respondersSorted,
} from '../services/broadcastService.js';
import { todayISO, addDaysISO } from '../services/availabilityService.js';
import { fmtKm } from '../services/locationService.js';
import { SLOTS, SLOT_IDS, ROLES, slotById } from '../config.js';

export function renderBroadcast(root, uid) {
  clear(root);
  const incomingBox = el('div.section');
  const mineBox = el('div.section');

  root.append(
    el('div.page-head', {},
      el('h1.page-title', {}, 'Broadcasts'),
      el('button.btn.btn-primary', { onclick: () => openCompose(uid) }, '📣 New'),
    ),
    incomingBox, mineBox,
  );

  const unsub1 = listenIncoming(uid, list => {
    clear(incomingBox);
    incomingBox.append(el('h2.section-title', {}, 'For you'));
    if (!list.length) {
      incomingBox.append(el('p.muted', {}, 'When a connection needs crew on a day you\'re 🟢, it shows up here.'));
    }
    for (const b of list) incomingBox.append(incomingCard(b, uid));
  });

  const unsub2 = listenMine(uid, list => {
    clear(mineBox);
    mineBox.append(el('h2.section-title', {}, 'Posted by you'));
    if (!list.length) mineBox.append(el('p.muted', {}, 'Nothing posted yet.'));
    for (const b of list) mineBox.append(mineCard(b));
  });

  return () => { unsub1(); unsub2(); };
}

const slotLabel = ids => (ids || []).length === SLOT_IDS.length
  ? '📅 Full day' : `${slotById(ids[0])?.icon || ''} ${slotById(ids[0])?.label || ''}`;

function incomingCard(b, uid) {
  const responded = !!(b.responders && b.responders[uid]);
  return el('div.bc-card', {},
    el('div.bc-head', {},
      el('span.bc-need', {}, `${roleIcon(b.need)} ${b.need}`),
      b.budget ? el('span.bc-budget', {}, `₹${b.budget}`) : null),
    el('p.bc-when', {}, `${fmtDateNice(b.date)} · ${slotLabel(b.slotIds)}${b.area ? ' · 📍 ' + b.area : ''}`),
    b.note ? el('p.bc-note', {}, b.note) : null,
    el('p.muted', {}, `from ${b.byName}${b.byArea ? ' (' + b.byArea + ')' : ''}`),
    responded
      ? el('span.bc-in', {}, '✓ You\'re in — they\'ll WhatsApp you')
      : el('button.btn.btn-primary.btn-full', {
          onclick: async function () {
            this.disabled = true;
            try { await respond(b, uid); toast('Sent! Nearest responders show first.'); }
            catch (e) { toast('Could not respond', 'err'); this.disabled = false; }
          },
        }, "🙋 I'm in"),
  );
}

function mineCard(b) {
  const resp = respondersSorted(b);
  const expired = (b.expiresAtMs || 0) < Date.now();
  return el('div.bc-card', { class: `bc-card ${expired ? 'dim' : ''}` },
    el('div.bc-head', {},
      el('span.bc-need', {}, `${roleIcon(b.need)} ${b.need}`),
      el('button.icon-btn', {
        onclick: () => { if (confirm('Delete this broadcast?')) deleteBroadcast(b.id); },
        'aria-label': 'Delete broadcast',
      }, '🗑')),
    el('p.bc-when', {}, `${fmtDateNice(b.date)} · ${slotLabel(b.slotIds)}${b.area ? ' · 📍 ' + b.area : ''}${expired ? ' · expired' : ''}`),
    el('p.muted', {}, `sent to ${(b.to || []).length} free connection${(b.to || []).length === 1 ? '' : 's'}`),
    resp.length
      ? el('div.responders', {},
          el('span.field-label', {}, `${resp.length} in — nearest first:`),
          ...resp.map(r => el('a.responder-row', {
            href: `https://wa.me/${(r.phone || '').replace(/\D/g, '')}`, target: '_blank', rel: 'noopener',
          },
            el('span', {}, `🙋 ${r.name}${r.area ? ' · ' + r.area : ''}`),
            el('span.dist-badge', {}, r.km != null ? fmtKm(r.km) : ''),
            el('span.wa-mini', {}, '💬'),
          )))
      : el('p.muted', {}, 'No responses yet.'),
  );
}

function roleIcon(need) {
  const r = ROLES.find(r => need && need.toLowerCase().includes(r.id.slice(0, 5)));
  return r ? r.icon : '📣';
}

function openCompose(uid) {
  const need = el('input.input', { placeholder: 'What do you need? e.g. "1 candid photographer"' });
  const date = el('input.input', { type: 'date', value: addDaysISO(todayISO(), 1), min: todayISO() });
  const area = el('input.input', { placeholder: 'Area (e.g. Malakpet)' });
  const budget = el('input.input', { type: 'number', placeholder: 'Budget ₹ (optional)' });
  const note = el('input.input', { placeholder: 'Extra note (optional)' });

  let slotIds = [...SLOT_IDS];
  const slotRow = el('div.chip-row');
  function drawSlots() {
    clear(slotRow);
    slotRow.append(
      el('button.chip', { class: `chip ${slotIds.length === SLOT_IDS.length ? 'on' : ''}`, onclick: () => { slotIds = [...SLOT_IDS]; drawSlots(); } }, '📅 Full day'),
      ...SLOTS.map(s => el('button.chip', { class: `chip ${slotIds.length === 1 && slotIds[0] === s.id ? 'on' : ''}`, onclick: () => { slotIds = [s.id]; drawSlots(); } }, `${s.icon} ${s.label}`)),
    );
  }
  drawSlots();

  const s = sheet('Urgent broadcast', el('div', {},
    need, date, slotRow, area, budget, note,
    el('p.field-hint', {}, 'Goes only to connections who are 🟢 for that exact date + slot, nearest first.'),
    el('button.btn.btn-primary.btn-full', {
      onclick: async function () {
        if (!need.value.trim()) return toast('Say what you need', 'err');
        if (!date.value) return toast('Pick a date', 'err');
        this.disabled = true; this.textContent = 'Posting…';
        try {
          const { recipients } = await postBroadcast(uid, {
            need: need.value.trim(), date: date.value, slotIds,
            area: area.value.trim(), budget: budget.value.trim(), note: note.value.trim(),
          });
          s.close();
          toast(recipients.length
            ? `📣 Sent to ${recipients.length} free connection${recipients.length === 1 ? '' : 's'}`
            : 'Posted — but no connections are 🟢 for that slot', recipients.length ? '' : 'err');
        } catch (e) {
          console.error(e);
          toast('Could not post', 'err');
          this.disabled = false; this.textContent = 'Post broadcast';
        }
      },
    }, 'Post broadcast'),
  ));
}

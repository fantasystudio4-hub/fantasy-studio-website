/* LensCal — My Calendar. Monthly grid, half-day slot chips, tap-to-cycle,
   full-day toggle, multi-select for 2-3 day weddings, private notes.
   All data via availabilityService (real-time). */
import { el, clear, toast, sheet, fmtDateNice } from './components.js';
import {
  listenMonth, effectiveSlot, cycleSlot, setDay, setSlot, setNote, setMultiple,
  toISODate, todayISO,
} from '../services/availabilityService.js';
import { SLOTS, SLOT_IDS, STATUSES, STATUS_CYCLE } from '../config.js';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function renderCalendar(root, uid) {
  clear(root);
  const now = new Date();
  const state = {
    year: now.getFullYear(),
    month: now.getMonth(),
    data: new Map(),          // dateISO -> avail doc
    multi: false,             // multi-select mode
    selected: new Set(),      // selected dateISOs in multi mode
    unsub: null,
  };

  const title = el('h2.cal-title');
  const grid = el('div.cal-grid');
  const multiBar = el('div.multi-bar');

  const header = el('div.cal-header', {},
    el('button.icon-btn', { onclick: () => nav(-1), 'aria-label': 'Previous month' }, '‹'),
    title,
    el('button.icon-btn', { onclick: () => nav(1), 'aria-label': 'Next month' }, '›'),
  );

  const legend = el('div.cal-legend', {},
    ...STATUS_CYCLE.map(s => el('span', {}, `${STATUSES[s].icon} ${STATUSES[s].label}`)),
    el('span.legend-note', {}, 'Top half = morning · bottom = evening · tap to cycle · tap the date for notes'),
  );

  const multiToggle = el('button.btn.btn-ghost.btn-sm', {
    onclick: () => {
      state.multi = !state.multi;
      state.selected.clear();
      multiToggle.classList.toggle('on', state.multi);
      multiToggle.textContent = state.multi ? 'Cancel' : 'Select dates';
      drawGrid(); drawMultiBar();
    },
  }, 'Select dates');

  root.append(
    el('div.page-head', {}, el('h1.page-title', {}, 'My Calendar'), multiToggle),
    header, el('div.cal-weekdays', {}, WEEKDAYS.map(w => el('span', {}, w))),
    grid, legend, multiBar,
  );

  function nav(delta) {
    state.month += delta;
    if (state.month < 0) { state.month = 11; state.year--; }
    if (state.month > 11) { state.month = 0; state.year++; }
    subscribe();
  }

  function subscribe() {
    if (state.unsub) state.unsub();
    title.textContent = new Date(state.year, state.month, 1)
      .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    drawGrid(); // draw immediately with cached/empty data
    state.unsub = listenMonth(uid, state.year, state.month, map => {
      state.data = map;
      drawGrid();
    });
  }

  function drawGrid() {
    clear(grid);
    const first = new Date(state.year, state.month, 1);
    const daysInMonth = new Date(state.year, state.month + 1, 0).getDate();
    const today = todayISO();
    for (let i = 0; i < first.getDay(); i++) grid.append(el('div.cal-cell.blank'));

    for (let d = 1; d <= daysInMonth; d++) {
      const iso = toISODate(new Date(state.year, state.month, d));
      const avail = state.data.get(iso) || null;
      const isPast = iso < today;

      const toggleSelect = () => {
        state.selected.has(iso) ? state.selected.delete(iso) : state.selected.add(iso);
        cell.classList.toggle('selected');
        drawMultiBar();
      };

      // One box per day: top half = morning, bottom half = evening.
      const halves = SLOTS.map(slot => {
        const eff = effectiveSlot(avail, slot.id);
        const half = el('button.cal-half', {
          class: `cal-half ${eff.confirmed ? STATUSES[eff.status].cls : 'unmarked'}`,
          disabled: isPast,
          'aria-label': `${fmtDateNice(iso)} ${slot.label}: ${STATUSES[eff.status].label}${eff.confirmed ? '' : ' (unconfirmed)'}`,
          onclick: e => {
            e.stopPropagation();
            if (state.multi) return toggleSelect();
            // optimistic UI: cycle instantly, Firestore confirms via listener
            quickCycle(half, uid, iso, slot.id, eff.status);
          },
        },
          eff.confirmed
            ? el('span.half-status', {}, STATUSES[eff.status].icon)
            : el('span.half-glyph', {}, slot.icon),
        );
        if (eff.note) half.append(el('span.note-dot'));
        return half;
      });

      const cell = el('div.cal-cell', {
        class: `cal-cell ${iso === today ? 'today' : ''} ${isPast ? 'past' : ''} ${state.selected.has(iso) ? 'selected' : ''}`,
      },
        el('button.cal-day', {
          disabled: isPast,
          'aria-label': `Details for ${fmtDateNice(iso)}`,
          onclick: e => {
            e.stopPropagation();
            if (state.multi) return toggleSelect();
            openDaySheet(uid, iso, () => state.data.get(iso) || null);
          },
        }, String(d)),
        halves,
      );
      grid.append(cell);
    }
  }

  function drawMultiBar() {
    clear(multiBar);
    if (!state.multi) { multiBar.classList.remove('open'); return; }
    multiBar.classList.add('open');
    const slotSel = new Set(SLOT_IDS);
    const slotBtns = SLOTS.map(s => {
      const b = el('button.chip.on', {
        onclick: () => {
          if (slotSel.has(s.id) && slotSel.size === 1) return; // keep ≥1
          slotSel.has(s.id) ? slotSel.delete(s.id) : slotSel.add(s.id);
          b.classList.toggle('on');
        },
      }, `${s.icon} ${s.label}`);
      return b;
    });
    multiBar.append(
      el('div.multi-count', {}, `${state.selected.size} date${state.selected.size === 1 ? '' : 's'} selected`),
      el('div.multi-slots', {}, slotBtns),
      el('div.multi-actions', {}, STATUS_CYCLE.map(st =>
        el('button.btn.btn-sm', {
          class: `btn btn-sm ${STATUSES[st].cls}-btn`,
          onclick: async () => {
            if (!state.selected.size) return toast('Tap dates to select them first');
            await setMultiple(uid, [...state.selected], [...slotSel], st);
            toast(`${STATUSES[st].icon} Marked ${state.selected.size} dates ${STATUSES[st].label.toLowerCase()}`);
            state.selected.clear(); state.multi = false;
            multiToggle.classList.remove('on');
            multiToggle.textContent = 'Select dates';
            drawGrid(); drawMultiBar();
          },
        }, `${STATUSES[st].icon} ${STATUSES[st].label}`),
      )),
    );
  }

  subscribe();
  drawMultiBar();
  return () => { if (state.unsub) state.unsub(); };
}

/** Instant optimistic cycle so a status change feels < 2s (it's ~0ms). */
async function quickCycle(half, uid, iso, slotId, current) {
  const order = STATUS_CYCLE;
  const next = order[(order.indexOf(current) + 1) % order.length];
  half.classList.remove(...order.map(s => STATUSES[s].cls), 'unmarked');
  half.classList.add(STATUSES[next].cls);
  const glyph = half.querySelector('.half-glyph, .half-status');
  if (glyph) { glyph.className = 'half-status'; glyph.textContent = STATUSES[next].icon; }
  try { await cycleSlot(uid, iso, slotId, current); }
  catch (e) { console.error(e); toast('Could not save — check connection', 'err'); }
  return next;
}

/* ---------- day detail sheet: per-slot status, notes, full day ---------- */
function openDaySheet(uid, iso, getAvail) {
  const body = el('div.day-sheet');

  function draw() {
    clear(body);
    const avail = getAvail();

    for (const slot of SLOTS) {
      const eff = effectiveSlot(avail, slot.id);
      const noteInput = el('input.input.input-sm', {
        value: eff.note, placeholder: 'Private note (e.g. "Nikah at Paradise")',
        onchange: async e => {
          await setNote(uid, iso, slot.id, e.target.value.trim());
          toast('Note saved (only you can see it)');
        },
      });
      body.append(el('div.day-slot-row', {},
        el('div.day-slot-head', {},
          el('span.day-slot-name', {}, `${slot.icon} ${slot.label}`),
          el('span.day-slot-status', { class: `day-slot-status ${STATUSES[eff.status].cls}` },
            `${STATUSES[eff.status].icon} ${STATUSES[eff.status].label}${eff.confirmed ? '' : ' (unconfirmed)'}`),
        ),
        el('div.day-slot-btns', {}, STATUS_CYCLE.map(st =>
          el('button.chip', {
            class: `chip ${eff.status === st && eff.confirmed ? 'on' : ''}`,
            onclick: async () => { await setSlot(uid, iso, slot.id, st); setTimeout(draw, 250); },
          }, `${STATUSES[st].icon} ${STATUSES[st].label}`),
        )),
        noteInput,
      ));
    }

    body.append(el('div.day-fullday', {},
      el('span.field-label', {}, 'Mark full day:'),
      el('div.day-slot-btns', {}, STATUS_CYCLE.map(st =>
        el('button.chip', {
          onclick: async () => {
            await setDay(uid, iso, st);
            toast(`${STATUSES[st].icon} Full day ${STATUSES[st].label.toLowerCase()}`);
            setTimeout(draw, 250);
          },
        }, `${STATUSES[st].icon} ${STATUSES[st].label}`),
      )),
    ));
  }

  draw();
  sheet(fmtDateNice(iso), body);
}

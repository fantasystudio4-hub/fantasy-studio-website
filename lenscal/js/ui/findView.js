/* LensCal — Find Crew: the killer feature. Date + slot → distance-sorted
   list of 🟢 connections, with role/group/distance filter chips, AI search
   bar, and a Leaflet/OSM map toggle. */
import { el, clear, toast, avatar, roleBadges, updatedBadge, spinner, emptyState, fmtDateNice } from './components.js';
import { findCrew, whatsappLink } from '../services/searchService.js';
import { parseQuery } from '../services/aiSearchService.js';
import { listGroups } from '../services/networkService.js';
import { fmtKm } from '../services/locationService.js';
import { todayISO } from '../services/availabilityService.js';
import { getProfile } from '../services/userService.js';
import { SLOTS, SLOT_IDS, ROLES, DISTANCE_CHIPS, slotById } from '../config.js';

export function renderFind(root, uid) {
  clear(root);
  const state = {
    date: todayISO(),
    slotIds: [...SLOT_IDS],
    roles: [],
    groupId: null,
    maxKm: null,
    view: 'list', // 'list' | 'map'
    lastResult: null,
    groups: [],
    running: 0,
  };

  /* --- AI search bar --- */
  const aiInput = el('input.input.ai-input', {
    placeholder: '✨ Try: "kal evening Malakpet ke paas 3 km mein kaun free hai video ke liye"',
    onkeydown: e => { if (e.key === 'Enter') runAi(); },
  });
  const aiBtn = el('button.btn.btn-primary', { onclick: runAi }, 'Search');

  async function runAi() {
    const q = aiInput.value.trim();
    if (!q) return;
    aiBtn.disabled = true; aiBtn.textContent = '…';
    try {
      const parsed = await parseQuery(q);
      state.date = parsed.date;
      state.slotIds = parsed.slotIds;
      state.roles = parsed.roles;
      state.maxKm = parsed.radiusKm;
      drawFilters();
      const bits = [fmtDateNice(parsed.date),
        parsed.slotIds.length === SLOT_IDS.length ? 'full day' : slotById(parsed.slotIds[0]).label,
        ...parsed.roles, parsed.radiusKm ? `${parsed.radiusKm} km` : null,
        parsed.area ? `near ${parsed.area}` : null].filter(Boolean);
      toast(`Searching: ${bits.join(' · ')}`);
      await run();
    } catch (e) { console.error(e); toast('Could not understand that — use the filters below', 'err'); }
    aiBtn.disabled = false; aiBtn.textContent = 'Search';
  }

  /* --- filters --- */
  const filtersBox = el('div.filters');
  function drawFilters() {
    clear(filtersBox);

    // date
    const dateInput = el('input.input.date-input', {
      type: 'date', value: state.date, min: todayISO(),
      onchange: e => { state.date = e.target.value; run(); },
    });

    // slot chips
    const slotRow = el('div.chip-row', {},
      el('button.chip', {
        class: `chip ${state.slotIds.length === SLOT_IDS.length ? 'on' : ''}`,
        onclick: () => { state.slotIds = [...SLOT_IDS]; drawFilters(); run(); },
      }, '📅 Full day'),
      ...SLOTS.map(s => el('button.chip', {
        class: `chip ${state.slotIds.length === 1 && state.slotIds[0] === s.id ? 'on' : ''}`,
        onclick: () => { state.slotIds = [s.id]; drawFilters(); run(); },
      }, `${s.icon} ${s.label}`)),
    );

    // role chips
    const roleRow = el('div.chip-row', {}, ROLES.map(r => el('button.chip', {
      class: `chip ${state.roles.includes(r.id) ? 'on' : ''}`,
      onclick: () => {
        state.roles = state.roles.includes(r.id)
          ? state.roles.filter(x => x !== r.id) : [...state.roles, r.id];
        drawFilters(); run();
      },
    }, `${r.icon} ${r.label}`)));

    // distance chips
    const distRow = el('div.chip-row', {}, DISTANCE_CHIPS.map(km => el('button.chip', {
      class: `chip ${state.maxKm === km ? 'on' : ''}`,
      onclick: () => { state.maxKm = km; drawFilters(); run(); },
    }, km == null ? '🌐 Anywhere' : `${km} km`)));

    // group chips
    const groupRow = state.groups.length ? el('div.chip-row', {},
      el('button.chip', {
        class: `chip ${state.groupId == null ? 'on' : ''}`,
        onclick: () => { state.groupId = null; drawFilters(); run(); },
      }, '👥 All'),
      ...state.groups.map(g => el('button.chip', {
        class: `chip ${state.groupId === g.id ? 'on' : ''}`,
        onclick: () => { state.groupId = g.id; drawFilters(); run(); },
      }, g.name)),
    ) : null;

    filtersBox.append(el('div.filter-top', {}, dateInput, viewToggle()), slotRow, roleRow, distRow);
    if (groupRow) filtersBox.append(groupRow);
  }

  function viewToggle() {
    return el('div.view-toggle', {},
      el('button.chip', { class: `chip ${state.view === 'list' ? 'on' : ''}`, onclick: () => { state.view = 'list'; drawFilters(); drawResults(); } }, '☰ List'),
      el('button.chip', { class: `chip ${state.view === 'map' ? 'on' : ''}`, onclick: () => { state.view = 'map'; drawFilters(); drawResults(); } }, '🗺️ Map'),
    );
  }

  const resultsBox = el('div.results');

  async function run() {
    const token = ++state.running;
    clear(resultsBox);
    resultsBox.append(spinner());
    try {
      const res = await findCrew({ uid, date: state.date, slotIds: state.slotIds, roles: state.roles, groupId: state.groupId, maxKm: state.maxKm });
      if (token !== state.running) return;
      state.lastResult = res;
      drawResults();
    } catch (e) {
      console.error(e);
      if (token !== state.running) return;
      clear(resultsBox);
      resultsBox.append(emptyState('⚠️', 'Search failed', 'Check your connection and try again.'));
    }
  }

  function drawResults() {
    clear(resultsBox);
    const res = state.lastResult;
    if (!res) return;
    const { results } = res;
    const slotLabel = state.slotIds.length === SLOT_IDS.length ? 'full day' : slotById(state.slotIds[0]).label.toLowerCase();

    if (!results.length) {
      resultsBox.append(emptyState('🫥', `No one free ${fmtDateNice(state.date)} (${slotLabel})`,
        'Try widening the distance, or add more people to your network.'));
      return;
    }
    resultsBox.append(el('p.result-count', {}, `${results.length} available · nearest first`));
    if (state.view === 'map') { drawMap(res); return; }

    for (const r of results) resultsBox.append(crewCard(r, slotLabel));
  }

  function crewCard(r, slotLabel) {
    const p = r.profile;
    return el('div.crew-card', {},
      avatar(p, 48),
      el('div.crew-info', {},
        el('div.crew-name-row', {},
          el('span.crew-name', {}, p.name || 'Unnamed'),
          r.distanceKm != null
            ? el('span.dist-badge', {}, `📍 ${fmtKm(r.distanceKm)}${p.area ? ` — ${p.area}` : ''}`)
            : el('span.dist-badge.muted', {}, p.locationMode === 'off' ? 'location off' : (p.area || '')),
        ),
        roleBadges(p.roles),
        el('div.crew-meta', {},
          slotSummary(r.slots),
          updatedBadge(p),
        ),
      ),
      el('a.wa-btn', {
        href: whatsappLink(p, { date: fmtDateNice(state.date), slotLabel, area: '' }),
        target: '_blank', rel: 'noopener', 'aria-label': `WhatsApp ${p.name}`,
      }, '💬'),
    );
  }

  function slotSummary(slots) {
    return el('span.slot-summary', {}, SLOTS.map(s => {
      const eff = slots[s.id];
      const ic = eff.status === 'available' ? '🟢' : eff.status === 'booked' ? '🔴' : '🟡';
      return el('span', { class: eff.confirmed ? '' : 'unconfirmed-txt', title: eff.confirmed ? '' : 'unconfirmed' }, `${s.icon}${ic}`);
    }));
  }

  /* --- Leaflet map (lazy-loaded) --- */
  async function drawMap(res) {
    const mapDiv = el('div#crew-map');
    resultsBox.append(mapDiv);
    try {
      await loadLeaflet();
    } catch {
      clear(resultsBox);
      resultsBox.append(emptyState('🗺️', 'Map unavailable offline'));
      return;
    }
    const L = window.L;
    const origin = res.origin || firstLoc(res.results) || [17.385, 78.4867]; // fallback: Hyderabad
    const map = L.map(mapDiv).setView(origin, 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap',
    }).addTo(map);

    if (res.origin) {
      L.circleMarker(res.origin, { radius: 7, color: '#0B6E4F', fillColor: '#0B6E4F', fillOpacity: 0.9 })
        .addTo(map).bindTooltip('You');
    }
    const slotLabel = state.slotIds.length === SLOT_IDS.length ? 'full day' : slotById(state.slotIds[0]).label.toLowerCase();
    const pts = [];
    for (const r of res.results) {
      const p = r.profile;
      if (p.areaLat == null || p.locationMode === 'off') continue;
      pts.push([p.areaLat, p.areaLng]);
      const marker = L.marker([p.areaLat, p.areaLng]).addTo(map);
      const popup = document.createElement('div');
      popup.className = 'map-pop';
      popup.innerHTML = `<strong>${esc(p.name)}</strong><br>${esc(p.area || '')} · ${fmtKm(r.distanceKm) || ''}<br>`;
      const a = document.createElement('a');
      a.href = whatsappLink(p, { date: fmtDateNice(state.date), slotLabel, area: '' });
      a.target = '_blank'; a.rel = 'noopener'; a.textContent = '💬 WhatsApp';
      a.className = 'map-wa';
      popup.append(a);
      marker.bindPopup(popup);
    }
    if (pts.length) map.fitBounds([...pts, ...(res.origin ? [res.origin] : [])], { padding: [30, 30], maxZoom: 14 });
  }

  function firstLoc(results) {
    for (const r of results) if (r.profile.areaLat != null) return [r.profile.areaLat, r.profile.areaLng];
    return null;
  }

  root.append(
    el('h1.page-title', {}, 'Find Crew'),
    el('div.ai-bar', {}, aiInput, aiBtn),
    filtersBox,
    resultsBox,
  );

  listGroups(uid).then(gs => { state.groups = gs; drawFilters(); }).catch(() => {});
  getProfile(uid); // warm cache
  drawFilters();
  run();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let leafletPromise = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.append(css);
    const js = document.createElement('script');
    js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    js.onload = resolve;
    js.onerror = () => { leafletPromise = null; reject(new Error('leaflet load failed')); };
    document.head.append(js);
  });
  return leafletPromise;
}

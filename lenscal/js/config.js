/* ============================================================
   LENSCAL — CORE CONFIG
   The calendar engine, statuses, roles and plans are all defined
   here as data, not hardcoded in UI. Adding a slot (e.g. 'night')
   or a status (e.g. 'travelling') is a one-line change with no
   schema migration — availability docs store slots as a map.
   ============================================================ */

// ---- Half-day slots (extensible: add fullday/night/custom ranges later) ----
export const SLOTS = [
  { id: 'morning', label: 'Morning', icon: '☀️', start: '06:00', end: '14:00' },
  { id: 'evening', label: 'Evening', icon: '🌙', start: '14:00', end: '23:59' },
];
export const SLOT_IDS = SLOTS.map(s => s.id);
export const slotById = id => SLOTS.find(s => s.id === id);

// ---- Statuses (extensible enum: on-hold, travelling, editing can be added) ----
export const STATUSES = {
  available: { id: 'available', label: 'Available', icon: '🟢', cls: 'st-available' },
  booked:    { id: 'booked',    label: 'Booked',    icon: '🔴', cls: 'st-booked' },
  tentative: { id: 'tentative', label: 'Tentative', icon: '🟡', cls: 'st-tentative' },
};
// Tap-cycle order on the calendar
export const STATUS_CYCLE = ['available', 'booked', 'tentative'];
// Unmarked dates default to available (photographers are free unless booked)
export const DEFAULT_STATUS = 'available';

// ---- Roles (multi-select on profile) ----
export const ROLES = [
  { id: 'photographer', label: 'Photographer', icon: '📷' },
  { id: 'videographer', label: 'Videographer', icon: '🎥' },
  { id: 'drone',        label: 'Drone Pilot',  icon: '🚁' },
  { id: 'editor',       label: 'Editor',       icon: '💻' },
];
export const roleById = id => ROLES.find(r => r.id === id);

// ---- Firestore collections (prefixed: this Firebase project is shared
//      with the Fantasy Studio site, which uses 'leads' and 'config') ----
export const COL = {
  users:        'lenscal_users',
  connections:  'lenscal_connections',
  groups:       'lenscal_groups',
  availability: 'lenscal_availability',
  broadcasts:   'lenscal_broadcasts',
};

// ---- Distance filter chips (km); null = anywhere ----
export const DISTANCE_CHIPS = [2, 5, 10, null];

// ---- Plans (architecture-ready; paywall not enforced yet except the
//      free connection cap which is a hard product rule) ----
export const PLANS = {
  free: {
    label: 'Free',
    maxConnections: 10,
    features: ['calendar', 'network', 'find', 'ai_search', 'map', 'broadcast'],
  },
  pro: {
    label: 'Pro',
    maxConnections: Infinity,
    features: ['calendar', 'network', 'find', 'ai_search', 'map', 'broadcast'],
  },
};
// Flip this to true later to start gating ai_search/map/broadcast to Pro.
export const PAYWALL_ENFORCED = false;
// What Free loses when the paywall flips on:
export const PRO_ONLY_FEATURES = ['ai_search', 'map', 'broadcast'];

// ---- Misc ----
export const APP_NAME = 'LensCal';
export const DEFAULT_COUNTRY_CODE = '+91';

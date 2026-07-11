/* LensCal — tiny shared UI helpers (no framework). */
import { ROLES, STATUSES } from '../config.js';
import { agoLabel } from '../services/userService.js';

/** el('div.card#x', {onclick}, children...) */
export function el(spec, attrs = {}, ...children) {
  const [tag, ...rest] = spec.split(/(?=[.#])/);
  const node = document.createElement(tag || 'div');
  for (const part of rest) {
    if (part[0] === '.') node.classList.add(part.slice(1));
    if (part[0] === '#') node.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'html') node.innerHTML = v;
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

/* ---------- toast ---------- */
let toastTimer = null;
export function toast(msg, kind = '') {
  let t = document.getElementById('toast');
  if (!t) { t = el('div#toast'); document.body.append(t); }
  t.textContent = msg;
  t.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3200);
}

/* ---------- bottom sheet ---------- */
export function sheet(title, content, { onClose } = {}) {
  const close = () => {
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 200);
    if (onClose) onClose();
  };
  const overlay = el('div.sheet-overlay', { onclick: e => { if (e.target === overlay) close(); } },
    el('div.sheet', {},
      el('div.sheet-handle'),
      el('div.sheet-head', {},
        el('h3', {}, title),
        el('button.icon-btn', { onclick: close, 'aria-label': 'Close' }, '✕')),
      content,
    ),
  );
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  return { close, overlay };
}

/* ---------- avatar ---------- */
const AV_COLORS = ['#0B6E4F', '#155E75', '#7C3AED', '#B45309', '#BE185D', '#4D7C0F'];
export function avatar(profile, size = 44) {
  if (profile?.photoURL) {
    return el('img.avatar', { src: profile.photoURL, alt: profile.name || '', width: size, height: size });
  }
  const name = profile?.name || '?';
  const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const node = el('div.avatar', { style: `width:${size}px;height:${size}px;background:${AV_COLORS[h % AV_COLORS.length]};font-size:${size * 0.4}px` }, initials);
  return node;
}

/* ---------- badges ---------- */
export function roleBadges(roles = []) {
  return el('span.roles', {}, roles.map(r => {
    const role = ROLES.find(x => x.id === r);
    return role ? el('span.role-badge', { title: role.label }, `${role.icon} ${role.label}`) : null;
  }));
}

export function statusDot(statusId, { confirmed = true } = {}) {
  const s = STATUSES[statusId] || STATUSES.available;
  return el('span.status-dot', {
    class: `status-dot ${s.cls} ${confirmed ? '' : 'unconfirmed'}`,
    title: s.label + (confirmed ? '' : ' (unconfirmed)'),
  }, s.icon);
}

export function updatedBadge(profile) {
  return el('span.updated-badge', {}, `Updated ${agoLabel(profile?.lastCalendarUpdate)}`);
}

/* ---------- spinner / empty ---------- */
export const spinner = () => el('div.spinner', { 'aria-label': 'Loading' });
export function emptyState(icon, title, sub) {
  return el('div.empty', {}, el('div.empty-icon', {}, icon), el('h3', {}, title), sub ? el('p', {}, sub) : null);
}

/* ---------- date formatting ---------- */
export function fmtDateNice(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

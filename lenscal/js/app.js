/* LensCal — app shell: auth gate, hash router, bottom nav, invite links. */
import { el, clear, toast, spinner, avatar } from './ui/components.js';
import { onAuth } from './services/authService.js';
import { getProfile } from './services/userService.js';
import { requestByUid } from './services/networkService.js';
import { renderLogin, renderOnboarding } from './ui/authView.js';
import { renderCalendar } from './ui/calendarView.js';
import { renderFind } from './ui/findView.js';
import { renderNetwork } from './ui/networkView.js';
import { renderBroadcast } from './ui/broadcastView.js';
import { renderProfile } from './ui/profileView.js';

const TABS = [
  { route: 'calendar', label: 'Calendar', icon: '📅', render: renderCalendar },
  { route: 'find', label: 'Find', icon: '🔍', render: renderFind },
  { route: 'broadcast', label: 'Broadcast', icon: '📣', render: renderBroadcast },
  { route: 'network', label: 'Network', icon: '🤝', render: renderNetwork },
  { route: 'profile', label: 'Profile', icon: '👤', render: null }, // special-cased (needs user)
];

const main = document.getElementById('app');
let currentUser = null;
let currentCleanup = null;
let pendingInvite = null;

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [name, arg] = hash.split('/');
  return { name: name || 'calendar', arg };
}

function nav() {
  const bar = document.getElementById('tabbar');
  clear(bar);
  const { name } = route();
  for (const t of TABS) {
    bar.append(el('button.tab', {
      class: `tab ${name === t.route ? 'on' : ''}`,
      onclick: () => { location.hash = `#/${t.route}`; },
      'aria-label': t.label,
    }, el('span.tab-icon', {}, t.icon), el('span.tab-label', {}, t.label)));
  }
}

async function render() {
  if (currentCleanup) { try { currentCleanup(); } catch {} currentCleanup = null; }
  const { name, arg } = route();
  const bar = document.getElementById('tabbar');

  if (!currentUser) {
    bar.style.display = 'none';
    if (name === 'invite' && arg) pendingInvite = arg; // connect after login
    renderLogin(main);
    return;
  }

  const profile = await getProfile(currentUser.uid);
  if (!profile || !profile.name) {
    bar.style.display = 'none';
    if (name === 'invite' && arg) pendingInvite = arg;
    renderOnboarding(main, currentUser, profile, () => {
      location.hash = '#/calendar';
      render();
      handlePendingInvite();
    });
    return;
  }

  if (name === 'invite' && arg) {
    pendingInvite = arg;
    await handlePendingInvite();
    location.hash = '#/network';
    return;
  }

  bar.style.display = '';
  nav();

  const tab = TABS.find(t => t.route === name) || TABS[0];
  clear(main);
  if (tab.route === 'profile') {
    renderProfile(main, currentUser.uid, currentUser, render);
  } else {
    currentCleanup = tab.render(main, currentUser.uid) || null;
  }
  main.scrollTop = 0;
  window.scrollTo(0, 0);
}

async function handlePendingInvite() {
  if (!pendingInvite || !currentUser) return;
  const inviter = pendingInvite;
  pendingInvite = null;
  try {
    const p = await getProfile(inviter);
    if (!p) return toast('Invite link is invalid', 'err');
    await requestByUid(currentUser.uid, inviter);
    toast(`Connection request sent to ${p.name} ✓`);
  } catch (e) {
    toast(e.message || 'Could not connect', 'err');
  }
}

window.addEventListener('hashchange', render);

clear(main);
main.append(spinner());

onAuth(user => {
  currentUser = user;
  if (user) handlePendingInvite();
  render();
});

// PWA service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

/* LensCal — Profile & settings: edit profile, location privacy,
   rate privacy, AI key, sign out. */
import { el, clear, toast, avatar, roleBadges } from './components.js';
import { getProfile, saveProfile } from '../services/userService.js';
import { logOut } from '../services/authService.js';
import { getApiKey, setApiKey } from '../services/aiSearchService.js';
import { renderOnboarding } from './authView.js';
import { planOf } from '../services/planService.js';

export function renderProfile(root, uid, user, rerender) {
  clear(root);
  getProfile(uid, { fresh: true }).then(p => draw(p)).catch(() => draw(null));

  function draw(p) {
    clear(root);
    if (!p) { root.append(el('p.muted', {}, 'Could not load profile.')); return; }

    const locToggle = el('div.setting-row', {},
      el('div', {},
        el('span.setting-name', {}, '📍 Location sharing'),
        el('p.field-hint', {}, 'Area only: connections see your locality centroid, never exact GPS.')),
      el('button.chip', {
        class: `chip ${p.locationMode !== 'off' ? 'on' : ''}`,
        onclick: async function () {
          const next = p.locationMode === 'off' ? 'area' : 'off';
          await saveProfile(uid, { locationMode: next });
          p.locationMode = next;
          this.classList.toggle('on', next !== 'off');
          this.textContent = next === 'off' ? 'Off' : 'Area only';
          toast(next === 'off' ? 'Hidden from distance sort & map' : 'Sharing area-level location');
        },
      }, p.locationMode === 'off' ? 'Off' : 'Area only'),
    );

    const rateToggle = el('div.setting-row', {},
      el('div', {},
        el('span.setting-name', {}, '₹ Rate visibility'),
        el('p.field-hint', {}, p.rate ? `Your rate: ₹${p.rate}/day` : 'No rate set')),
      el('button.chip', {
        class: `chip ${p.ratePrivate === false ? 'on' : ''}`,
        onclick: async function () {
          const next = !(p.ratePrivate === false);
          await saveProfile(uid, { ratePrivate: !next ? true : false });
          p.ratePrivate = !next;
          this.classList.toggle('on', p.ratePrivate === false);
          this.textContent = p.ratePrivate === false ? 'Visible to network' : 'Private';
        },
      }, p.ratePrivate === false ? 'Visible to network' : 'Private'),
    );

    const aiKey = el('input.input', {
      type: 'password', value: getApiKey(),
      placeholder: 'Anthropic API key (optional)',
      onchange: e => { setApiKey(e.target.value); toast(e.target.value ? 'AI search upgraded to Claude ✨' : 'Using built-in parser'); },
    });

    root.append(
      el('div.profile-head', {},
        avatar(p, 72),
        el('div', {},
          el('h1.page-title', {}, p.name || 'Your profile'),
          roleBadges(p.roles),
          el('p.muted', {}, [p.area, p.city].filter(Boolean).join(', ')),
          el('p.muted', {}, `${planOf(p).label} plan`),
        ),
      ),
      el('button.btn.btn-ghost.btn-full', {
        onclick: () => renderOnboarding(root, user, p, () => rerender()),
      }, '✏️ Edit profile'),
      el('h2.section-title', {}, 'Privacy'),
      locToggle, rateToggle,
      el('h2.section-title', {}, 'AI search'),
      el('p.field-hint', {}, 'Works out of the box with the built-in Hinglish parser. Paste an Anthropic API key to use Claude for smarter parsing — the key stays on this device only.'),
      aiKey,
      el('button.btn.btn-ghost.btn-full.danger', {
        onclick: () => { if (confirm('Sign out?')) logOut(); },
      }, 'Sign out'),
      el('p.version-tag', {}, 'LensCal v1 · your calendar is the product'),
    );
  }
}

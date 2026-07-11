/* LensCal — login (phone OTP, email fallback) + profile onboarding. */
import { el, clear, toast, avatar } from './components.js';
import { sendOtp, confirmOtp, emailSignIn } from '../services/authService.js';
import { saveProfile } from '../services/userService.js';
import { geocodeArea } from '../services/locationService.js';
import { ROLES, APP_NAME } from '../config.js';

export function renderLogin(root) {
  clear(root);
  let mode = 'phone'; // 'phone' | 'otp' | 'email'
  let sentTo = '';

  const body = el('div.auth-body');
  const wrap = el('div.auth-wrap', {},
    el('div.auth-logo', {}, el('img', { src: 'icons/icon-192.png', alt: '', width: 72, height: 72 })),
    el('h1.auth-title', {}, APP_NAME),
    el('p.auth-sub', {}, 'Who in your circle is free — this date, this slot, near you.'),
    body,
  );
  root.append(wrap);

  function draw() {
    clear(body);
    if (mode === 'phone') {
      const input = el('input.input', { type: 'tel', placeholder: 'Phone number (e.g. 98765 43210)', autocomplete: 'tel', inputmode: 'tel' });
      const btn = el('button.btn.btn-primary.btn-full#otp-send-btn', {
        onclick: async () => {
          btn.disabled = true; btn.textContent = 'Sending OTP…';
          try {
            sentTo = await sendOtp(input.value, 'otp-send-btn');
            mode = 'otp'; draw();
          } catch (e) {
            console.warn(e);
            toast(otpErrorMessage(e), 'err');
            btn.disabled = false; btn.textContent = 'Send OTP';
          }
        },
      }, 'Send OTP');
      body.append(
        input, btn,
        el('button.btn.btn-ghost.btn-full', { onclick: () => { mode = 'email'; draw(); } },
          'Use email instead'),
      );
      setTimeout(() => input.focus(), 50);
    } else if (mode === 'otp') {
      const input = el('input.input.otp-input', { type: 'text', placeholder: '6-digit code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6 });
      body.append(
        el('p.auth-hint', {}, `Code sent to ${sentTo}`),
        input,
        el('button.btn.btn-primary.btn-full', {
          onclick: async function () {
            this.disabled = true; this.textContent = 'Verifying…';
            try { await confirmOtp(input.value); }
            catch (e) { toast('Wrong code — try again', 'err'); this.disabled = false; this.textContent = 'Verify'; }
          },
        }, 'Verify'),
        el('button.btn.btn-ghost.btn-full', { onclick: () => { mode = 'phone'; draw(); } }, '← Change number'),
      );
      setTimeout(() => input.focus(), 50);
    } else {
      const email = el('input.input', { type: 'email', placeholder: 'Email', autocomplete: 'email' });
      const pass = el('input.input', { type: 'password', placeholder: 'Password (6+ characters)', autocomplete: 'current-password' });
      body.append(
        email, pass,
        el('button.btn.btn-primary.btn-full', {
          onclick: async function () {
            this.disabled = true; this.textContent = 'Signing in…';
            try { await emailSignIn(email.value.trim(), pass.value); }
            catch (e) {
              toast(e.message || 'Sign-in failed', 'err');
              this.disabled = false; this.textContent = 'Continue';
            }
          },
        }, 'Continue'),
        el('p.auth-hint', {}, 'New here? Same button creates your account.'),
        el('button.btn.btn-ghost.btn-full', { onclick: () => { mode = 'phone'; draw(); } }, '← Use phone OTP'),
      );
    }
  }
  draw();
}

function otpErrorMessage(e) {
  const code = e && e.code || '';
  if (String(e.message).includes('valid phone')) return e.message;
  if (code.includes('invalid-phone')) return 'That phone number looks invalid';
  if (code.includes('too-many-requests')) return 'Too many attempts — try later or use email';
  if (code.includes('billing') || code.includes('operation-not-allowed') || code.includes('configuration'))
    return 'Phone OTP is not enabled on this Firebase project yet — use email instead';
  return 'Could not send OTP — use email instead';
}

/* ---------- onboarding (first login or edit profile) ---------- */

export function renderOnboarding(root, user, existing, onDone) {
  clear(root);
  const p = existing || {};
  const state = {
    roles: new Set(p.roles || []),
    photoURL: p.photoURL || '',
    areaLat: p.areaLat ?? null,
    areaLng: p.areaLng ?? null,
    areaResolved: p.area || '',
  };

  const name = el('input.input', { value: p.name || '', placeholder: 'Your name *' });
  const phone = el('input.input', { type: 'tel', value: p.phone || user.phoneNumber || '', placeholder: 'WhatsApp number *', inputmode: 'tel' });
  const city = el('input.input', { value: p.city || '', placeholder: 'City (e.g. Hyderabad) *' });
  const area = el('input.input', { value: p.area || '', placeholder: 'Home area / locality (e.g. Malakpet) *' });
  const rate = el('input.input', { type: 'number', value: p.rate || '', placeholder: 'Per-day rate ₹ (optional, private)' });
  const areaStatus = el('p.field-hint', {}, state.areaLat != null ? `📍 Location set: ${state.areaResolved}` : 'We use your area (not exact GPS) for distance sorting.');

  const roleGrid = el('div.role-grid', {}, ROLES.map(r => {
    const b = el('button.role-chip', {
      type: 'button',
      class: `role-chip ${state.roles.has(r.id) ? 'on' : ''}`,
      onclick: () => {
        state.roles.has(r.id) ? state.roles.delete(r.id) : state.roles.add(r.id);
        b.classList.toggle('on');
      },
    }, `${r.icon} ${r.label}`);
    return b;
  }));

  const photoPreview = el('div.photo-preview', {}, avatar({ name: p.name, photoURL: state.photoURL }, 64));
  const photoInput = el('input', {
    type: 'file', accept: 'image/*', style: 'display:none',
    onchange: async e => {
      const f = e.target.files[0];
      if (!f) return;
      state.photoURL = await downscale(f, 192);
      clear(photoPreview);
      photoPreview.append(avatar({ photoURL: state.photoURL }, 64));
    },
  });

  const saveBtn = el('button.btn.btn-primary.btn-full', {
    onclick: async () => {
      if (!name.value.trim() || !phone.value.trim() || !city.value.trim() || !area.value.trim()) {
        return toast('Name, phone, city and area are required', 'err');
      }
      if (!state.roles.size) return toast('Pick at least one role', 'err');
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      try {
        // Geocode the area to its centroid (area-level location only)
        if (state.areaLat == null || area.value.trim() !== state.areaResolved) {
          areaStatus.textContent = '📍 Locating your area…';
          try {
            const hits = await geocodeArea(area.value.trim(), city.value.trim());
            if (hits.length) {
              state.areaLat = hits[0].lat; state.areaLng = hits[0].lng;
              state.areaResolved = area.value.trim();
            }
          } catch { /* saved without coords; can retry later */ }
        }
        const { geohashForLocation } = await import('../services/locationService.js');
        await saveProfile(user.uid, {
          name: name.value.trim(),
          phone: phone.value.trim(),
          email: user.email || p.email || '',
          roles: [...state.roles],
          city: city.value.trim(),
          area: area.value.trim(),
          areaLat: state.areaLat,
          areaLng: state.areaLng,
          geohash: state.areaLat != null ? geohashForLocation([state.areaLat, state.areaLng]) : null,
          rate: rate.value ? Number(rate.value) : null,
          photoURL: state.photoURL || null,
          locationMode: p.locationMode || 'area',
        });
        onDone();
      } catch (e) {
        console.error(e);
        toast('Could not save profile — check your connection', 'err');
        saveBtn.disabled = false; saveBtn.textContent = 'Save & continue';
      }
    },
  }, existing ? 'Save changes' : 'Save & continue');

  root.append(el('div.onboard-wrap', {},
    el('h1.page-title', {}, existing ? 'Edit profile' : 'Set up your profile'),
    el('div.photo-row', {}, photoPreview,
      el('button.btn.btn-ghost', { onclick: () => photoInput.click() }, 'Add photo'), photoInput),
    name, phone, city, area, areaStatus,
    el('label.field-label', {}, 'I work as (pick all that apply) *'), roleGrid,
    rate,
    saveBtn,
  ));
}

function downscale(file, size) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      const scale = size / Math.min(img.width, img.height);
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.src = URL.createObjectURL(file);
  });
}

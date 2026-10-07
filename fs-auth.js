/* ============================================================
   FANTASY STUDIO — ONE SIGN-IN (Phase 3.5)

   The one Firebase session the client, crew and partner pages share,
   and what hangs off it: who this number is (detectRoles), the optional
   profile (profiles/{uid}), and the phone + OTP box /start/ mounts
   (mountPhoneSignIn). The admin panel keeps its own default app and
   never imports this file.

   Load ../firebase-config.js first (window.FIREBASE_CONFIG). Import this
   module with a dynamic import() inside try/catch, the way the portals
   load the SDK, so a blocked gstatic still reaches the page's own error
   view. Pages that need more of the SDK import it from the SAME 10.12.2
   URLs below: one URL is one module instance, so `db` and `auth` work
   with their functions.
   ============================================================ */
import { initializeApp, getApps, deleteApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, updateCurrentUser, signOut,
         RecaptchaVerifier, signInWithPhoneNumber, PhoneAuthProvider, signInWithCredential }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
         collection, doc, getDoc, getDocs, query, where, setDoc, serverTimestamp, increment,
         terminate, clearIndexedDbPersistence }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const CONFIG = window.FIREBASE_CONFIG;
if(!CONFIG || !CONFIG.apiKey) throw new Error('fs-auth: window.FIREBASE_CONFIG is not set — load ../firebase-config.js first');

/* The App Review login. A Firebase test number (no SMS is sent), so
   reCAPTCHA and the pre-check are skipped for it alone, and it always gets
   all three roles with sample data and no writes. If it is ever taken off
   Firebase's test list, delete it here too, or its sign-in fails. */
export const DEMO_PHONE = '+919000000001';
/* the store app, and nothing else: set by each page's <head> script */
export const inApp = document.documentElement.classList.contains('fs-app');
/* The store app's own phone check: Firebase's native phone auth, present only
   in app builds that ship the FirebaseAuthentication plugin. null in every
   browser and in older app builds, which keep using reCAPTCHA. */
function nativePhoneAuth(){
  try{
    const C = window.Capacitor;
    if(!inApp || !C || !C.Plugins || !C.Plugins.FirebaseAuthentication) return null;
    if(C.isPluginAvailable && !C.isPluginAvailable('FirebaseAuthentication')) return null;
    if(nativeIsOff()) return null;
    return C.Plugins.FirebaseAuthentication;
  }catch(e){ return null; }
}
/* The safety net for that check. Whatever leaves a person stuck on it (a code
   that was sent but cannot be used, or no answer at all) turns it off on this
   phone for a while, so the next Resend or Get OTP takes the reCAPTCHA check
   that has always worked. Stored as "off until", so a clock set far ahead
   cannot switch it off for good. */
const NATIVE_OFF_KEY = 'fs_native_otp_off';
const NATIVE_OFF_LONG = 7 * 24 * 3600e3, NATIVE_OFF_SHORT = 3600e3;
let nativeOffMem = 0;   /* the same "off until", kept in memory too, for a phone that will not keep it in storage */
function nativeIsOff(){
  const now = Date.now();
  return [Number(lsGet(NATIVE_OFF_KEY)), nativeOffMem].some(until => until - now > 0 && until - now <= NATIVE_OFF_LONG + 6e4);
}
function nativeSwitchOff(ms, why){
  nativeOffMem = Date.now() + ms;
  lsSet(NATIVE_OFF_KEY, String(nativeOffMem));
  console.warn('[sign-in] the app phone check is off on this phone for now:', why);
}
function nativeSwitchOn(){ nativeOffMem = 0; lsSet(NATIVE_OFF_KEY, ''); }
/* A wrong or expired code, no network, a rate limit: the person or the line is
   at fault and the web check would fail the same way. Anything else on a code
   the app itself sent means the app's check cannot be used here. */
const CODE_PROBLEM = /invalid-verification-code|code-expired|missing-verification-code|network-request-failed|too-many-requests|quota-exceeded|user-disabled|operation-not-allowed|billing-not-enabled/;
const codeNeedsWebCheck = err => !CODE_PROBLEM.test((err && err.code) || '');
/* Local test hook, the portals' two locks: served from localhost AND ?demo
   in the URL. Samples everywhere, no sign-in, no SMS, no Firestore writes.
   On fantasystudio.in the first lock can never hold. */
export const DEMO_VIEW = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
                      && new URLSearchParams(location.search).has('demo');
/* what the mount's onSignedIn gets in DEMO_VIEW (auth.currentUser stays null) */
export const DEMO_USER = Object.freeze({ uid: 'demo-view', phoneNumber: DEMO_PHONE, sample: true });
/* role → portal path, relative to the site root (the values fs_app_portal holds) */
export const PORTALS = Object.freeze({ client: 'client/', crew: 'team/', studio: 'studio/' });

/* One named app for every portal, so one OTP opens all of a person's pages.
   Named, not the default: the admin panel's email session lives in the
   default app on the same origin and must never be touched by this one. */
export const app = getApps().find(a => a.name === 'fs') || initializeApp(CONFIG, 'fs');
export const auth = getAuth(app);
/* In the store app the cache lives on disk, as the portals' did, so the last
   page opens with no signal. The multi-tab manager because a relaunch within
   seconds of a kill finds the old process still holding the cache, and
   single-tab would quietly fall back to memory. The crew page kept its cache
   on disk in browsers too (a venue with one bar): it opts in with
   <html data-fs-cache="disk">. Everyone else keeps the in-memory default.
   NOT in the iPhone app (30 Sep 2026): there the disk cache works on the
   first page only. After any in-app page change (Edit profile, Save, the
   Crew | Partner switch) the next page's Firestore never answers — no server
   data, not even the cached copy — so saves never leave the phone and the
   portal sits on its loading skeleton until the app is killed. Reproduced in
   the real app shell on the simulator (multi-tab and forceOwnership both
   hang; memory answers in ~0.2 s on every page) while Safari and the Android
   app are fine. So the iPhone app keeps its cache in memory, like a browser. */
const IOS_APP = inApp && !/Android/i.test(navigator.userAgent);
const DISK = !IOS_APP && (inApp || document.documentElement.getAttribute('data-fs-cache') === 'disk');
/* whether a queued write survives leaving the page (the profile's Save) */
export const diskCache = DISK;
let _db;
try{ _db = DISK ? initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }) : getFirestore(app); }
catch(e){ _db = getFirestore(app); }
export const db = _db;

/* storage that can throw (private mode, blocked site data) must never break a page */
const lsGet = k => { try{ return localStorage.getItem(k); }catch(e){ return null; } };
const lsSet = (k, v) => { try{ localStorage.setItem(k, v); }catch(e){} };
const lsDel = k => { try{ localStorage.removeItem(k); }catch(e){} };
const TIMEOUT = Symbol('timeout');
const within = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(TIMEOUT), ms))]);

/* ---------- who is signed in ---------- */

/* last 10 digits of the verified number — the key the rules match on
   (clientPhone10() in firestore.rules), for +91 and overseas alike */
export const phone10 = user => String((user && user.phoneNumber) || '').replace(/\D/g, '').slice(-10);
export const isDemo = user => !!user && user.phoneNumber === DEMO_PHONE;
/* sample data instead of Firestore: the review number, or the local test hook */
export const isSample = (user = auth.currentUser) => DEMO_VIEW || isDemo(user);

/* ---------- the owner's daily counters (appDaily) ----------
   More › Apps & website in the admin panel draws, per day: how many signed-in
   devices opened the iPhone app, the Android app, or the website; which role
   page they opened; and which build of the app they run. Each is a counter
   that goes up by one — no uid, no phone, no token — so there is nothing
   personal in it (firestore.rules, appDaily/{IST day}_{bucket}).

   A device adds 1 to a bucket at most ONCE a day: the bucket is written down
   in localStorage BEFORE the write goes out, so a failed or slow write leaves
   a missing count rather than a double one (the page says "approximate").
   The day is India's, the same one the rule works out from the server clock.
   The review number and ?demo write nothing, and nothing here can ever
   delay or break a page: no await on the page's path, every failure silent.

   role: 'client' | 'crew' | 'studio' | 'none' (signed in, not set up). */
const DAILY_KEY = 'fs_daily';
const istDayOf = (ms = Date.now()) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
const _dailySeen = new Set();   /* role+day pairs this page load has already handled */
function dailyPlatform(){
  try{ const C = window.Capacitor; return C && C.getPlatform ? String(C.getPlatform()) : ''; }catch(e){ return ''; }
}
/* The build, told by which native plugins it brought along (the site is the
   same for every build, so this is the only way to know). g10 = the first
   builds, g11 = Face ID / calendar / widget (1.1), g12 = screenshot blocking
   and native phone sign-in (the build after 1.1). A later build adds g13 and
   so on: the rule allows g10..g99 and the admin names the ones it knows. */
function dailyGeneration(){
  try{
    const C = window.Capacitor;
    const has = n => !!(C && C.Plugins && C.Plugins[n] && (!C.isPluginAvailable || C.isPluginAvailable(n)));
    return (has('PrivacyScreen') || has('FirebaseAuthentication')) ? 'g12'
         : (has('BiometricAuthNative') || has('CapacitorCalendar')) ? 'g11' : 'g10';
  }catch(e){ return 'g10'; }
}
export function touchDaily(role){
  try{
    if(!['client', 'crew', 'studio', 'none'].includes(role)) return;
    const user = auth.currentUser;
    if(isSample(user) || !user || !user.phoneNumber) return;   /* the rule wants a verified phone */
    const day = istDayOf();
    const memo = role + '|' + day;
    if(_dailySeen.has(memo)) return;
    _dailySeen.add(memo);
    let saved = {};
    try{ saved = JSON.parse(lsGet(DAILY_KEY) || '{}') || {}; }catch(e){ saved = {}; }
    if(saved.d !== day) saved = { d: day, b: [] };
    const done = new Set(Array.isArray(saved.b) ? saved.b : []);
    const plat = dailyPlatform();
    const buckets = [
      inApp && plat === 'ios' ? 'app_ios' : inApp && plat === 'android' ? 'app_android' : 'web',
      'r_' + role,
      ...(inApp && (plat === 'ios' || plat === 'android') ? [dailyGeneration()] : []),
    ].filter(b => !done.has(b));
    if(!buckets.length) return;
    buckets.forEach(b => done.add(b));
    const note = JSON.stringify({ d: day, b: [...done] });
    lsSet(DAILY_KEY, note);   /* before the write: undercount, never overcount */
    /* blocked or full storage swallows that write: with no note that sticks, every page load would add again */
    if(lsGet(DAILY_KEY) !== note) return;
    buckets.forEach(bucket => {
      try{
        setDoc(doc(db, 'appDaily', day + '_' + bucket),
          { day, bucket, n: increment(1), updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
      }catch(e){}
    });
  }catch(e){}
}

/* the auth SDK's first answer (it reads the saved session from IndexedDB) */
let _first = null;
export function authReady(){
  return _first || (_first = (async () => {
    try{ await auth.authStateReady(); }
    catch(e){ await new Promise(r => { const off = onAuthStateChanged(auth, () => { off(); r(); }, () => r()); }); }
    return auth.currentUser;
  })());
}

/* Until Phase 3.5 each portal kept its own session in a named app (client,
   crew, studio). Same project and API key, so the first one found is copied
   into `fs` with updateCurrentUser and the person stays signed in. Once per
   device: fs_auth_migrated is set the first time this answers, and whenever
   `fs` has a session of its own, so an old session can never sign someone
   back in after they signed out. Nothing is signed out here; if the copy
   fails the person simply signs in again. */
const LEGACY = ['client', 'crew', 'studio'];
const MIGRATED = 'fs_auth_migrated';
const LEGACY_MS = 4000;   /* a slow IndexedDB must never hold the page */
let _migration = null;
function legacyUser(name){
  return new Promise(resolve => {
    let done = false, off = null, made = null;
    const finish = u => {
      if(done) return; done = true; clearTimeout(t);
      try{ if(off) off(); }catch(e){}
      resolve({ user: u, made, answered: u !== TIMEOUT });
    };
    const t = setTimeout(() => finish(TIMEOUT), LEGACY_MS);
    try{
      let a = getApps().find(x => x.name === name);
      if(!a){ a = initializeApp(CONFIG, name); made = a; }
      off = onAuthStateChanged(getAuth(a), u => finish(u || null), () => finish(null));
      if(done){ try{ off(); }catch(e){} }
    }catch(e){ finish(null); }
  });
}
export function migrateLegacy(){
  return _migration || (_migration = (async () => {
    let moved = null, found = [];
    try{
      if(await authReady()){ lsSet(MIGRATED, '1'); return null; }
      if(lsGet(MIGRATED)) return null;
      found = await Promise.all(LEGACY.map(legacyUser));
      /* phone sessions only: every portal signs in by phone, and a number-less
         (old Google) session could not be matched to any role anyway */
      const hit = found.find(f => f.user && f.user !== TIMEOUT && f.user.phoneNumber);
      if(hit && !auth.currentUser){
        await updateCurrentUser(auth, hit.user);
        moved = auth.currentUser;
        /* the `fs` cache takes over from here: the portals' own go (once,
           as this move happens once per device) */
        if(moved) dropLegacyCaches();
      }
      /* a store that never answered gets another look on the next page load */
      if(moved || found.every(f => f.answered)) lsSet(MIGRATED, '1');
    }catch(e){ console.warn('[fs-auth] session move skipped', e && (e.code || e.message)); }
    /* the old apps were only opened to look; let them go (a timed-out one
       is left alone, mid-start) */
    found.forEach(f => { if(f.made && f.answered) deleteApp(f.made).catch(() => {}); });
    return moved;
  })());
}
/* Each old portal app kept its own Firestore cache on disk in the app (and
   the crew page in browsers): IndexedDB firestore/<app name>/<project>/main,
   with bookings, assignments and pay. Nothing opens them any more (fs-auth
   never starts Firestore on those apps), so they are deleted without
   waiting: fire and forget. A copy still open in another tab only delays
   its own delete until that tab closes. */
function dropLegacyCaches(){
  LEGACY.forEach(name => {
    try{ if(window.indexedDB) indexedDB.deleteDatabase('firestore/' + name + '/' + CONFIG.projectId + '/main'); }catch(e){}
  });
}
/* Who is signed in, once any old session has been moved. Await this before
   treating "signed out" as final: onAuthStateChanged answers null first and
   the moved user a moment later. */
export async function ready(){ await migrateLegacy(); return auth.currentUser; }

/* ---------- role detection ----------
   Only the three queries the rules already allow, each provable from its
   own filter (firestore.rules): packages by clientPhone, team by phone10,
   studios by phone10 AND active == true. The rest is filtered here. */
const ROLES_KEY = 'fs_roles';
const ROLE_MS = 8000;
function keepRoles(uid, r){
  lsSet(ROLES_KEY, JSON.stringify({ uid, roles: { client: !!r.client, crew: !!r.crew, studio: !!r.studio }, at: Date.now() }));
}
/* the last answer for this uid, for a fast next launch (re-check behind it) */
export function cachedRoles(uid){
  try{
    const c = JSON.parse(lsGet(ROLES_KEY) || 'null');
    if(c && uid && c.uid === uid && c.roles) return { client: !!c.roles.client, crew: !!c.roles.crew, studio: !!c.roles.studio };
  }catch(e){}
  return null;
}
const SAMPLE_INFO = () => ({
  client: { name: 'Ayesha' },
  crew:   { name: 'Arjun Rao' },
  studio: { studioName: 'Lumière Wedding Co.', ownerName: 'Rahul', city: 'Hyderabad' },
});
/* → { client, crew, studio, failed: [role…], info: { client?:{name},
   crew?:{name}, studio?:{studioName, ownerName, city} } }. Never throws.
   A query that fails, times out, or finds nothing from an offline cache
   counts as false AND is listed in `failed`, so a page can tell "not set up"
   from "could not check". The cache is only written from a clean answer. */
export async function detectRoles(user){
  const out = { client: false, crew: false, studio: false, failed: [], info: {} };
  try{
    if(DEMO_VIEW || isDemo(user)){
      Object.assign(out, { client: true, crew: true, studio: true, info: SAMPLE_INFO() });
      if(!DEMO_VIEW && user && user.uid) keepRoles(user.uid, out);
      return out;
    }
    const p10 = phone10(user);
    if(!user || p10.length !== 10) return out;
    const check = async (role, run) => {
      try{
        const r = await within(run(), ROLE_MS);
        if(r === TIMEOUT){ out.failed.push(role); return; }
        out[role] = r.has;
        if(r.info) out.info[role] = r.info;
        if(r.unsure) out.failed.push(role);
      }catch(e){ out.failed.push(role); }
    };
    await Promise.all([
      check('client', async () => {
        const s = await getDocs(query(collection(db, 'packages'), where('clientPhone', '==', p10)));
        /* the client portal's own filter: no drafts, no deleted, no B2B jobs */
        const mine = s.docs.map(d => d.data())
          .filter(x => !x.deleted && (x.status || 'draft') !== 'draft' && (x.clientType || 'direct') !== 'studio');
        const named = mine.find(x => x.clientName);
        return { has: mine.length > 0, info: named ? { name: String(named.clientName) } : null,
                 unsure: !mine.length && s.metadata.fromCache };
      }),
      check('crew', async () => {
        const s = await getDocs(query(collection(db, 'team'), where('phone10', '==', p10)));
        const me = s.docs.map(d => d.data()).filter(m => m.active !== false);
        return { has: me.length > 0, info: me.length ? { name: String(me[0].name || '') } : null,
                 unsure: !me.length && s.metadata.fromCache };
      }),
      check('studio', async () => {
        const s = await getDocs(query(collection(db, 'studios'), where('phone10', '==', p10), where('active', '==', true)));
        const st = s.docs.map(d => d.data());
        return { has: st.length > 0,
                 info: st.length ? { studioName: String(st[0].name || ''), ownerName: String(st[0].ownerName || ''), city: String(st[0].city || '') } : null,
                 unsure: !st.length && s.metadata.fromCache };
      }),
    ]);
    if(!out.failed.length) keepRoles(user.uid, out);
  }catch(e){}
  return out;
}

/* ---------- profiles/{uid} (optional; no Storage) ----------
   Contract keys only: uid, phone10, name, photo, roles {crew:{emergencyName,
   emergencyPhone}, client:{email}, studio:{studioName, ownerName, city}},
   laterAt, updatedAt. The caps below are what saveProfile trims to, and
   each is at most the rules' own cap (firestore.rules profiles/{uid}): a
   longer value set in code (a prefill from the admin's records) is cut
   here, never refused there. */
export const PROFILE_LIMITS = Object.freeze({
  name: 80, email: 120, emergencyName: 80, emergencyPhone: 20,
  studioName: 80, ownerName: 80, city: 60, photo: 120000,
});
const ROLE_FIELDS = { crew: ['emergencyName', 'emergencyPhone'], client: ['email'], studio: ['studioName', 'ownerName', 'city'] };
export const laterKey = uid => 'fs_profile_later_' + uid;
export const isLater = uid => !!lsGet(laterKey(uid));

/* The review number's profile. One account, three pages, and each page's
   Me must name the person that page's own sample data names: the crew
   member Arjun Rao, the client Ayesha (her booking greets her), the partner
   studio's owner Rahul, whose photo is the studio's logo. So the sample is
   per role: the role passed in, else the page's own (team/ client/ studio/,
   or /profile/?role=), else crew. Edits are kept for this session only
   (sessionStorage), name and photo per role, so the edit screen visibly
   works on each page without renaming the other two. */
const DEMO_EDITS = 'fs_demo_profile';
const hasRole = r => Object.prototype.hasOwnProperty.call(ROLE_FIELDS, r);
function pageRole(){
  const m = /\/(team|client|studio)\//.exec(location.pathname);
  if(m) return { team: 'crew', client: 'client', studio: 'studio' }[m[1]];
  const r = new URLSearchParams(location.search).get('role');
  return hasRole(r) ? r : '';
}
const sampleRole = role => hasRole(role) ? role : (pageRole() || 'crew');
const SAMPLE_NAME = { crew: i => i.crew.name, client: i => i.client.name, studio: i => i.studio.ownerName };
/* the photo's letters: the member's and the client's initials, the studio's logo */
const SAMPLE_MARK = { crew: 'AR', client: 'A', studio: 'LW' };
const _samplePhoto = {};
function samplePhoto(role){
  if(_samplePhoto[role] != null) return _samplePhoto[role];
  try{
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 256, 256);
    bg.addColorStop(0, '#C9A347'); bg.addColorStop(1, '#8E6E1E');
    g.fillStyle = bg; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#fff'; g.font = '600 104px Georgia, serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(SAMPLE_MARK[role] || 'FS', 128, 136);
    _samplePhoto[role] = c.toDataURL('image/jpeg', 0.85);
  }catch(e){ _samplePhoto[role] = ''; }
  return _samplePhoto[role];
}
function sampleEdits(){
  try{
    const e = JSON.parse(sessionStorage.getItem(DEMO_EDITS) || 'null');
    if(e && typeof e === 'object') return { by: e.by && typeof e.by === 'object' ? e.by : {}, roles: e.roles && typeof e.roles === 'object' ? e.roles : {} };
  }catch(e){}
  return { by: {}, roles: {} };
}
function sampleProfile(uid, role){
  const i = SAMPLE_INFO(), r = sampleRole(role);
  const p = { uid: uid || DEMO_USER.uid, phone10: phone10(DEMO_USER), name: SAMPLE_NAME[r](i), photo: samplePhoto(r),
    roles: { crew: { emergencyName: 'Meera Rao', emergencyPhone: '+91 90000 00002' },
             client: { email: 'reviewer@example.com' },
             studio: { ...i.studio } },
    sample: true };
  const e = sampleEdits(), mine = e.by[r] || {};
  if('name' in mine) p.name = mine.name;
  if('photo' in mine) p.photo = mine.photo;
  Object.keys(e.roles).forEach(k => { if(hasRole(k)) p.roles[k] = { ...p.roles[k], ...e.roles[k] }; });
  return p;
}
/* only the contract's keys, trimmed and capped; anything else is dropped */
function cleanProfile(data){
  const d = data || {}, out = {};
  const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  if('name' in d) out.name = str(d.name, PROFILE_LIMITS.name);
  if('photo' in d){
    const p = String(d.photo || '');
    if(p && (!/^data:image\/jpeg;base64,/.test(p) || p.length > PROFILE_LIMITS.photo))
      throw new Error('fs-auth: photo must be the JPEG data URL resizePhoto() returns');
    out.photo = p;   /* '' takes the photo away */
  }
  if(d.roles && typeof d.roles === 'object'){
    const roles = {};
    Object.keys(ROLE_FIELDS).forEach(role => {
      const r = d.roles[role];
      if(!r || typeof r !== 'object') return;
      const c = {};
      ROLE_FIELDS[role].forEach(k => { if(k in r) c[k] = str(r[k], PROFILE_LIMITS[k]); });
      if(Object.keys(c).length) roles[role] = c;
    });
    if(Object.keys(roles).length) out.roles = roles;
  }
  return out;
}
/* → the profile object, or null when there is none. Rejects when the read
   itself fails (offline with nothing cached, rules not published): treat
   that as "unknown", never as "no profile". `role` only picks which sample
   the review number sees (above); a real profile is one document. */
export async function getProfile(uid, role){
  if(isSample()) return sampleProfile(uid, role);
  if(!uid) return null;
  const s = await getDoc(doc(db, 'profiles', uid));
  return s.exists() ? s.data() : null;
}
/* Merges `data` into profiles/{uid}, stamping uid, phone10 (the verified
   number, as the rules require) and updatedAt. → {ok:true}, or
   {ok:true, pending:true} when the server has not answered in SAVE_MS (the
   write is queued and goes when the phone is back online). Rejects on a
   refused write. The review number and the test hook never write: their
   edit is kept for this session, the name and photo under `role` (as in
   getProfile). */
const SAVE_MS = 8000;
export async function saveProfile(uid, data, role){
  const clean = cleanProfile(data);
  if(isSample()){
    try{
      const prev = sampleEdits(), r = sampleRole(role);
      const by = { ...prev.by, [r]: { ...(prev.by[r] || {}) } };
      if('name' in clean) by[r].name = clean.name;
      if('photo' in clean) by[r].photo = clean.photo;
      const roles = { ...prev.roles };
      Object.keys(clean.roles || {}).forEach(k => { roles[k] = { ...roles[k], ...clean.roles[k] }; });
      sessionStorage.setItem(DEMO_EDITS, JSON.stringify({ by, roles }));
    }catch(e){}
    return { ok: true, sample: true };
  }
  const user = auth.currentUser;
  if(!user || user.uid !== uid) throw new Error('fs-auth: sign in before saving a profile');
  const w = setDoc(doc(db, 'profiles', uid),
    { ...clean, uid, phone10: phone10(user), updatedAt: serverTimestamp() }, { merge: true });
  const r = await within(w, SAVE_MS);
  return r === TIMEOUT ? { ok: true, pending: true } : { ok: true };
}
/* "Later" on the profile step: remembered on this phone at once, and on the
   profile (laterAt) so another device does not ask again. Never throws and
   never waits for the network. */
export function markLater(uid){
  if(!uid) return;
  lsSet(laterKey(uid), String(Date.now()));
  const user = auth.currentUser;
  if(isSample(user) || !user || user.uid !== uid) return;
  setDoc(doc(db, 'profiles', uid),
    { uid, phone10: phone10(user), laterAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true })
    .catch(() => {});
}
/* what is still empty, e.g. ['photo', 'crew.emergencyPhone']; roles is the
   detectRoles answer or one role name. Empty array = complete. */
export function profileMissing(profile, roles){
  const p = profile || {}, miss = [];
  if(!String(p.name || '').trim()) miss.push('name');
  if(!p.photo) miss.push('photo');
  const want = typeof roles === 'string' ? [roles] : Object.keys(ROLE_FIELDS).filter(r => roles && roles[r]);
  want.forEach(r => (ROLE_FIELDS[r] || []).forEach(k => {
    if(!String(((p.roles || {})[r] || {})[k] || '').trim()) miss.push(r + '.' + k);
  }));
  return miss;
}
/* a starting profile from the admin's records (detectRoles(...).info):
   the name the studio knows them by, and the partner studio's details */
export function prefillFrom(info){
  const i = info || {};
  const out = { name: (i.crew && i.crew.name) || (i.client && i.client.name) || (i.studio && i.studio.ownerName) || '', roles: {} };
  if(i.studio) out.roles.studio = { studioName: i.studio.studioName || '', ownerName: i.studio.ownerName || '', city: i.studio.city || '' };
  return out;
}

/* A phone photo (often 12 MP) → a JPEG data URL, longest side ≤ 256 px and
   at most PROFILE_LIMITS.photo characters, so it fits on the profile
   document with no Storage bucket. Halves in steps (one big jump aliases),
   paints white first (JPEG has no alpha: a clear PNG would go black), then
   lowers the quality, then the size, until it fits. */
export async function resizePhoto(file, maxSide = 256){
  if(!file) throw new Error('No photo chosen.');
  let src = null, w = 0, h = 0, url = null;
  try{
    try{
      if(window.createImageBitmap){ src = await createImageBitmap(file, { imageOrientation: 'from-image' }); w = src.width; h = src.height; }
    }catch(e){ src = null; }
    if(!src){
      url = URL.createObjectURL(file);
      src = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('That file is not a photo we can open.')); im.src = url; });
      w = src.naturalWidth; h = src.naturalHeight;
    }
    if(!w || !h) throw new Error('That file is not a photo we can open.');
    let side = Math.min(maxSide, Math.max(w, h));
    for(let round = 0; round < 6; round++){
      const s = side / Math.max(w, h);
      const tw = Math.max(1, Math.round(w * s)), th = Math.max(1, Math.round(h * s));
      let cur = src, cw = w, ch = h;
      while(cw > tw * 2){
        const c = document.createElement('canvas');
        c.width = Math.max(tw, Math.round(cw / 2)); c.height = Math.max(th, Math.round(ch / 2));
        const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
        g.drawImage(cur, 0, 0, c.width, c.height);
        cur = c; cw = c.width; ch = c.height;
      }
      const out = document.createElement('canvas'); out.width = tw; out.height = th;
      const g = out.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, tw, th);
      g.imageSmoothingQuality = 'high';
      g.drawImage(cur, 0, 0, tw, th);
      for(const q of [0.86, 0.78, 0.7, 0.6, 0.5, 0.4]){
        const d = out.toDataURL('image/jpeg', q);
        if(/^data:image\/jpeg;base64,/.test(d) && d.length <= PROFILE_LIMITS.photo) return d;
      }
      side = Math.round(side * 0.8);
    }
    throw new Error('That photo would not shrink enough — try another one.');
  }finally{
    try{ if(src && src.close) src.close(); }catch(e){}
    if(url) URL.revokeObjectURL(url);
  }
}

/* ---------- the studio's number (config/site is world-readable) ---------- */
const DEFAULT_PHONE = '+91 86868 68803';
let _phone = DEFAULT_PHONE, _contact = null;
export function getContact(){
  return _contact || (_contact = within(getDoc(doc(db, 'config', 'site')), 5000)
    .then(s => (s !== TIMEOUT && s.exists() && ((s.data() || {}).contact || {}).phone) || DEFAULT_PHONE, () => DEFAULT_PHONE)
    .then(phone => {
      _phone = String(phone);
      const digits = _phone.replace(/\D/g, '');
      return { phone: _phone, digits, tel: 'tel:+' + digits, wa: 'https://wa.me/' + digits };
    }));
}

/* ---------- "just signed in with an OTP on this phone" ----------
   The app lock lets a person straight in after an OTP: they have just
   proved who they are. The OTP is typed on /start/, a page before the
   portal, so /start/ leaves a note here (writeFresh, in its onSignedIn) and
   the portal's first lock gate takes it (takeFresh). Only this device's
   note counts: the login's own last-sign-in time (its metadata) changes
   with a sign-in on ANY device, so it can never stand in for one (it let a
   locked phone open after a sign-in elsewhere). */
const FRESH_KEY = 'fs_otp_fresh';
const FRESH_MS = 120000;   /* the OTP to the portal's first gate; the profile step can outlast it, and then the lock asks as usual */
export function writeFresh(uid){
  if(uid) lsSet(FRESH_KEY, JSON.stringify({ uid: String(uid), t: Date.now() }));
}
/* → true once, for the note /start/ left for this same login less than
   FRESH_MS ago. Any note is removed as soon as it is read, fresh or not, so
   a second gate (a relock, a reload) is never fresh. Called with no user it
   reads nothing and leaves the note for the gate that knows who it is. */
export function takeFresh(user){
  if(!user || !user.uid) return false;
  const raw = lsGet(FRESH_KEY);
  if(raw == null) return false;
  lsDel(FRESH_KEY);
  try{
    const m = JSON.parse(raw), age = Date.now() - Number(m && m.t);
    return !!m && m.uid === user.uid && age >= 0 && age < FRESH_MS;
  }catch(e){ return false; }
}

/* ---------- leaving ---------- */
/* this phone's notes about the person: roles, last portal, "Later", and a
   fresh-OTP note no gate has taken yet */
export function clearLocal(uid){
  lsDel(ROLES_KEY); lsDel('fs_app_portal'); lsDel(FRESH_KEY);
  if(uid) lsDel(laterKey(uid));
  try{ sessionStorage.removeItem(DEMO_EDITS); }catch(e){}
}
/* Sign out means signed out: the shared session, and any old per-portal
   session still on the phone, so neither can open a page again. */
export async function signOutEverywhere(){
  lsSet(MIGRATED, '1');
  try{ await signOut(auth); }catch(e){}
  await Promise.all(LEGACY.map(async name => {
    const had = getApps().find(x => x.name === name);
    try{
      const a = had || initializeApp(CONFIG, name);
      await signOut(getAuth(a));
      if(!had) await deleteApp(a);
    }catch(e){}
  }));
  lsDel(ROLES_KEY); lsDel('fs_app_portal'); lsDel(FRESH_KEY);
}
/* After a deletion this phone keeps nothing of the person: the Firestore
   cache (on disk in the app and on the crew page: the profile's photo,
   emergency contact and email, and the portal's data) goes with the login.
   terminate() first (it stops every listener, and the cache can only be
   cleared once the instance is shut), then the cache itself. Each step has a
   ceiling: another tab holding the database open blocks the delete, and the
   page must still leave. `db` is unusable afterwards; every caller leaves
   for /start/, a fresh page (/start/ itself loads afresh). The old
   per-portal caches go too
   (dropLegacyCaches, not waited for). */
const WIPE_MS = 3000;
async function wipeCache(){
  dropLegacyCaches();
  try{ await within(terminate(db), WIPE_MS); }catch(e){}
  try{ await within(clearIndexedDbPersistence(db), WIPE_MS); }catch(e){ console.warn('[fs-auth] cache not cleared', e && (e.code || e.message)); }
}
/* "Delete my account" (Me): the callable deletes profiles/{uid} and the
   login and leaves a deletionRequests note for the studio; business records
   stay. The review number and the test hook never call it. Then this phone
   forgets the person (the cache, its notes) and signs out. Rejects if the
   call fails, with the person still signed in so they can try again. */
export async function deleteMyAccount(){
  const user = auth.currentUser;
  const sample = isSample(user);
  if(!sample){
    if(!user) throw new Error('fs-auth: sign in before deleting the account');
    const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
    await httpsCallable(getFunctions(app, 'asia-south1'), 'deleteMyAccount')();
    await wipeCache();
  }
  clearLocal(user && user.uid);
  if(user) await signOutEverywhere();
  return { ok: true, sample };
}

/* ---------- the phone + OTP box ----------
   The client portal's proven sign-in, moved here unchanged in how it
   works: country code, readPhone, the pre-check against the hashed phone
   index (with its timeout), a fresh reCAPTCHA verifier per send (with the
   DEMO_PHONE skip), sendSeq + the stall timer, six OTP boxes, Resend with
   a cooldown, Change number, and authMsg with its Ref. */

/* the pre-check reads the hashed phone index so no SMS is wasted on unknown
   numbers. A check that fails or hangs fails OPEN and sends the OTP — a
   genuine person must never be locked out (it sat ~30s on "Checking…" in
   the iOS app, App Review testing, 23 Sep 2026). */
const PRECHECK_MS = 4000;
async function phoneKey(p){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('fs:' + p));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function isKnownNumber(p){
  try{
    const key = await phoneKey(p);
    return await Promise.race([
      getDoc(doc(db, 'phoneIndex', key)).then(s => s.exists()),
      new Promise(r => setTimeout(() => r(true), PRECHECK_MS)),
    ]);
  }catch(e){ return true; }
}
function authMsg(err){
  const c = (err && err.code) || '';
  if(c.includes('billing-not-enabled') || c.includes('operation-not-allowed'))
    return 'We cannot send OTPs right now. Please call the studio on ' + _phone + ' and we will help you in.';
  if(c.includes('invalid-phone-number')) return 'That mobile number does not look right.';
  if(c.includes('invalid-verification-code')) return 'Wrong OTP — check and try again.';
  if(c.includes('too-many-requests')) return 'Too many tries — wait a few minutes and try again.';
  if(c.includes('network-request-failed')) return 'No internet — check your connection.';
  if(c.includes('captcha-check-failed') || c.includes('missing-recaptcha'))
    return 'That security check expired. Please try again for a fresh code.';
  if(c.includes('code-expired')) return 'That OTP has expired — tap Resend OTP for a new one.';
  if(c.includes('quota-exceeded')) return 'Too many sign-in attempts today. Please call the studio and we will help.';
  if(c.includes('user-disabled')) return 'This account has been disabled — please call the studio.';
  if(/internal-error|app-credential|argument-error/.test(c) || (!c && /recaptcha/i.test((err && err.message) || '')))
    return 'The security check did not load. Please try again.' + errRef(err);
  /* say what to do, not a raw Firebase code; the short Ref is only there so a
     screenshot of this message tells the studio what went wrong */
  return 'Sign-in did not go through. Please try again, or call the studio on ' + _phone + ' and we will sort it out.' + errRef(err);
}
const errRef = err => { const r = String((err && (err.code || err.message)) || '').replace(/^auth\//, '').slice(0, 40); return r ? ' (Ref: ' + r + ')' : ''; };

/* the client portal's sign-in look, scoped to .fs-signin; the page's own
   --gold/--line/--text/--mut/--err win when it defines them */
const CSS = `
.fs-signin{text-align:left}
.fs-signin [hidden]{display:none!important}
.fs-signin .fld{margin-bottom:.9rem;text-align:left}
.fs-signin .fld label{display:block;font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;color:var(--gold-b,#E2C275);margin-bottom:.3rem}
.fs-signin .fld.otpto label{text-align:center}
.fs-signin .fld.otpto b{color:var(--text,#f3ecdc);letter-spacing:.04em}
.fs-signin .phwrap{display:flex;border:1px solid var(--line,rgba(226,194,117,.28));border-radius:10px;overflow:hidden;background:#171309}
.fs-signin .phwrap:focus-within{border-color:var(--gold,#B8902B);box-shadow:0 0 0 3px rgba(184,144,43,.18)}
.fs-signin .phwrap b{display:grid;place-items:center;padding:0 .1em 0 .7em;color:var(--mut,#b3a98f);font-weight:500}
.fs-signin .phwrap input{flex:1;background:transparent;border:0;border-radius:0;color:var(--text,#f3ecdc);padding:.75em .8em;min-width:0;letter-spacing:.06em;font-family:inherit;font-size:16px}
.fs-signin .phwrap input:focus{outline:none}
.fs-signin .phwrap .ccin{flex:0 0 2.6em;width:2.6em;text-align:center;color:var(--mut,#b3a98f);border-right:1px solid var(--line,rgba(226,194,117,.28));padding:.75em .1em;letter-spacing:.02em}
.fs-signin .cchint{color:var(--mut,#b3a98f);font-size:.7rem;margin-top:.35rem;text-align:left}
.fs-signin .gbtn{display:block;width:100%;min-height:48px;background:linear-gradient(135deg,#C9A347,#8E6E1E);border:0;color:#fff;border-radius:40px;padding:.9em;font-family:inherit;font-size:.9rem;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;box-shadow:0 6px 16px rgba(142,110,30,.35)}
.fs-signin .gbtn:active{transform:scale(.98);box-shadow:0 3px 8px rgba(142,110,30,.3)}
.fs-signin .gbtn:disabled{opacity:.7;cursor:default}
.fs-signin .gbtn.busy::before{content:"";display:inline-block;width:15px;height:15px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:fs-si-spin .7s linear infinite;margin-right:.55em;vertical-align:-3px}
@keyframes fs-si-spin{to{transform:rotate(360deg)}}
.fs-signin .otp{display:flex;gap:.45rem;justify-content:center;margin:.4rem 0 1rem}
.fs-signin .otp input{flex:1 1 0;min-width:0;max-width:52px;width:auto;height:52px;text-align:center;font-family:inherit;font-size:1.3rem;background:#171309;border:1px solid var(--line,rgba(226,194,117,.28));border-radius:10px;color:var(--gold-b,#E2C275)}
.fs-signin .otp input:focus{outline:none;border-color:var(--gold,#B8902B);box-shadow:0 0 0 3px rgba(184,144,43,.18)}
.fs-signin .acts{display:flex;justify-content:center;flex-wrap:wrap;gap:0 .3rem}
.fs-signin .mini{background:none;border:0;color:var(--mut,#b3a98f);text-decoration:underline;font-family:inherit;font-size:.8rem;cursor:pointer;margin-top:.5rem;min-height:44px;padding:.4em .9em}
.fs-signin .mini:disabled{text-decoration:none;opacity:.8;cursor:default}
.fs-signin .err{color:var(--err,#e07a6a);font-size:.82rem;margin-top:.8rem;text-align:center}
.fs-signin .note{color:var(--mut,#b3a98f);font-size:.76rem;margin-top:1rem;text-align:center}
.fs-signin .nobook{background:rgba(184,144,43,.09);border:1px dashed rgba(226,194,117,.45);border-radius:12px;padding:.9rem 1rem;margin:.9rem 0 .2rem;text-align:left;font-size:.85rem}
.fs-signin .nobook b{color:var(--gold-b,#E2C275);display:block;margin-bottom:.25rem}
.fs-signin .nobook span{color:var(--mut,#b3a98f)}
.fs-signin .nobook .nbrow{display:flex;gap:.5rem;margin-top:.7rem}
.fs-signin .nobook .nbrow a{flex:1;display:flex;align-items:center;justify-content:center;min-height:44px;text-decoration:none;border:1px solid var(--gold,#B8902B);color:var(--gold-b,#E2C275);border-radius:30px;padding:.5em .6em;font-size:.82rem}
.fs-signin :focus-visible{outline:2px solid var(--gold,#B8902B);outline-offset:2px}
html.fs-app .fs-signin .fs-web-only{display:none!important}
@media (prefers-reduced-motion:reduce){ .fs-signin .gbtn.busy::before{animation:none} .fs-signin .gbtn:active{transform:none} }
`;
function injectCss(){
  if(document.getElementById('fs-signin-css')) return;
  const s = document.createElement('style'); s.id = 'fs-signin-css'; s.textContent = CSS;
  document.head.appendChild(s);
}
const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let _mounts = 0;
/* Draws the phone + OTP steps into rootEl and runs them. opts:
     onSignedIn(user)  after the OTP is confirmed (DEMO_VIEW: DEMO_USER)
     onStep(step)      'phone' | 'otp'
     toast(text)       optional, for "OTP sent to …"
     precheck          default true: unknown numbers get the not-set-up box
                       instead of an SMS (the review number skips it)
     note              line under the box; '' for none
     css               false to skip the built-in styles
   The same moments are also DOM events on rootEl (they bubble):
     fs-signin:step {step}, fs-signin:unknown {phone}, fs-signin:signed-in {user}
   → { el, reset(), focus(), destroy() } */
export function mountPhoneSignIn(rootEl, opts = {}){
  if(!rootEl) throw new Error('mountPhoneSignIn: no element to draw into');
  if(opts.css !== false) injectCss();
  const n = ++_mounts;
  const note = opts.note == null ? 'Use the mobile number Fantasy Studio has for you.' : String(opts.note);
  const boxes = Array.from({ length: 6 }, (_, i) =>
    `<input type="tel" inputmode="numeric" ${i ? 'maxlength="1"' : 'autocomplete="one-time-code"'} aria-label="OTP digit ${i + 1} of 6" />`).join('');
  const wrap = document.createElement('div');
  wrap.className = 'fs-signin';
  wrap.innerHTML = `
    <div data-step="phone">
      <div class="fld"><label for="fs-si-ph-${n}">Mobile number</label>
        <div class="phwrap"><b>+</b><input data-cc class="ccin" type="tel" inputmode="numeric" maxlength="3" value="91" aria-label="Country code" /><input data-phone id="fs-si-ph-${n}" type="tel" inputmode="numeric" maxlength="14" placeholder="98765 43210" autocomplete="tel-national" /></div>
        <div class="cchint fs-web-only">Outside India? Change 91 to your country code.</div>
      </div>
      <button class="gbtn" data-send type="button">Get OTP</button>
      <div class="nobook" data-nobook hidden>
        <b>This number isn't set up with Fantasy Studio yet</b>
        <span>If the studio has a different number for you, try that one — or reach us and we'll help you right away.</span>
        <div class="nbrow"><a data-nb-call href="#">📞 Call</a><a data-nb-wa href="#" target="_blank" rel="noopener">WhatsApp</a></div>
      </div>
    </div>
    <div data-step="otp" hidden>
      <div class="fld otpto"><label>Enter the OTP sent to <b data-otp-to></b></label></div>
      <div class="otp" data-otp-boxes role="group" aria-label="One-time password">${boxes}</div>
      <button class="gbtn" data-verify type="button">Verify &amp; Sign In</button>
      <div class="acts">
        <button class="mini" data-resend type="button">Resend OTP</button>
        <button class="mini" data-back type="button">← Change number</button>
      </div>
    </div>
    <div class="err" data-err role="alert" hidden></div>
    ${note ? `<div class="note">${esc(note)}</div>` : ''}`;
  rootEl.appendChild(wrap);
  const $ = s => wrap.querySelector(s);
  const otpInputs = [...wrap.querySelectorAll('[data-otp-boxes] input')];
  /* the invisible widget and its badge live outside the view (as the portals'
     #recaptcha-box did), so hiding the box after sign-in never hides them mid-check */
  const rcBox = document.createElement('div');
  rcBox.className = 'fs-recaptcha-box';
  document.body.appendChild(rcBox);

  const emit = (name, detail) => { try{ wrap.dispatchEvent(new CustomEvent('fs-signin:' + name, { detail, bubbles: true })); }catch(e){} };
  const call = (fn, ...a) => { try{ if(typeof fn === 'function') fn(...a); }catch(e){ console.error('[sign-in]', e); } };
  const setStep = s => {
    $('[data-step="phone"]').hidden = s !== 'phone';
    $('[data-step="otp"]').hidden = s !== 'otp';
    emit('step', { step: s }); call(opts.onStep, s);
  };
  const showErr = err => {
    if(typeof err !== 'string') console.error('[sign-in]', err && err.code, err && err.message);
    const el = $('[data-err]'); el.textContent = typeof err === 'string' ? err : authMsg(err); el.hidden = false;
  };
  const hideErr = () => { $('[data-err]').hidden = true; };
  getContact().catch(() => {});   /* warm it, so an error message quotes the real number */

  /* ---------- OTP box behaviour ---------- */
  const full = () => otpInputs.every(x => x.value);
  const onFull = () => { const b = $('[data-verify]'); if(!$('[data-step="otp"]').hidden && !b.disabled) b.click(); };   /* the 6th digit submits */
  otpInputs.forEach((b, i) => {
    b.addEventListener('input', () => {
      const v = b.value.replace(/\D/g, '');
      if(v.length > 1){
        /* SMS autofill / fast paste lands the whole code in one box — spread it out */
        v.split('').slice(0, otpInputs.length - i).forEach((ch, j) => otpInputs[i + j].value = ch);
        otpInputs[Math.min(i + v.length, otpInputs.length) - 1].focus();
      }else{
        b.value = v;
        if(v && i < otpInputs.length - 1) otpInputs[i + 1].focus();
      }
      if(full()) onFull();
    });
    b.addEventListener('keydown', e => { if(e.key === 'Backspace' && !b.value && i > 0) otpInputs[i - 1].focus(); });
    b.addEventListener('paste', e => {
      const t = ((e.clipboardData && e.clipboardData.getData('text')) || '').replace(/\D/g, '');
      if(t.length >= otpInputs.length){
        e.preventDefault();
        otpInputs.forEach((x, j) => x.value = t[j] || '');
        otpInputs[otpInputs.length - 1].focus();
        if(full()) onFull();
      }
    });
  });
  const otpCode = () => otpInputs.map(b => b.value).join('');
  const clearBoxes = () => otpInputs.forEach(b => b.value = '');

  /* resend cooldown — prevents accidental OTP hammering, shows the wait */
  let coolIv = null;
  function startCooldown(btn, secs = 30){
    clearInterval(coolIv);
    let s = secs;
    btn.disabled = true; btn.textContent = `Resend OTP (${s}s)`;
    coolIv = setInterval(() => {
      s--;
      if(s <= 0){ clearInterval(coolIv); btn.disabled = false; btn.textContent = 'Resend OTP'; }
      else btn.textContent = `Resend OTP (${s}s)`;
    }, 1000);
  }
  /* the code just shown cannot be used, so waiting out the cooldown would only add to the wait */
  function endCooldown(btn){ clearInterval(coolIv); btn.disabled = false; btn.textContent = 'Resend OTP'; }

  /* read a country-code + number pair; India keeps strict 10-digit checks,
     other countries accept 6–14 national digits (NRI clients) */
  function readPhone(){
    let cc = ($('[data-cc]').value || '').replace(/\D/g, '') || '91';
    let p  = ($('[data-phone]').value || '').replace(/\D/g, '');
    /* phones autofill "+91 98765 43210" or "098765 43210": absorb the
       duplicated country code and the trunk zero */
    if(p.length > 10 && p.indexOf(cc) === 0) p = p.slice(cc.length);
    p = p.replace(/^0+/, '');
    const ok = cc === '91' ? p.length === 10 : (p.length >= 6 && p.length <= 14);
    return { cc, p, ok, full: '+' + cc + p, pretty: '+' + cc + ' ' + p, last10: (cc + p).slice(-10) };
  }
  async function showNotSetUp(pretty){
    const c = await getContact();
    $('[data-nb-call]').href = c.tel;
    $('[data-nb-wa]').href = c.wa + '?text=' + encodeURIComponent('Salaam! I tried to sign in to Fantasy Studio but my number ' + pretty + ' is not set up. Can you help?');
    $('[data-nobook]').hidden = false;
    emit('unknown', { phone: pretty });
  }
  $('[data-phone]').addEventListener('input', () => { $('[data-nobook]').hidden = true; });

  /* ---------- phone OTP sign-in ---------- */
  let confirmation = null, verifier = null;
  /* Google hangs each widget's picture puzzle on <body>, outside the box, and
     clear() leaves it there, so an unsolved puzzle stayed on screen and
     stacked under the next one (iOS app, 23 Sep 2026). Reset the old widget
     and take its puzzle frame away as well. */
  function dropRecaptcha(old){
    try{ if(old && old.widgetId != null && window.grecaptcha) grecaptcha.reset(old.widgetId); }catch(e){}
    try{ if(old) old.clear(); }catch(e){}
    rcBox.textContent = '';
    document.querySelectorAll('iframe[src*="recaptcha/api2/bframe"]').forEach(f => { const c = f.closest('body > div'); if(c) c.remove(); });
  }
  /* A fresh verifier for every send, in a fresh <div>, never on the button:
     verify() returns the CACHED grecaptcha token, which is single-use (the
     first Resend failed), and an invisible widget stays bound to its element,
     so a second one there threw "reCAPTCHA has already been rendered in this
     element" — the error App Review saw (23 Sep 2026). The review number
     skips reCAPTCHA; Firebase honours that for test numbers only. */
  function freshVerifier(old, fullPhone){
    dropRecaptcha(old);
    const el = document.createElement('div');
    rcBox.appendChild(el);
    auth.settings.appVerificationDisabledForTesting = fullPhone === DEMO_PHONE;
    try{ return new RecaptchaVerifier(auth, el, { size: 'invisible' }); }
    finally{ auth.settings.appVerificationDisabledForTesting = false; }
  }
  /* ---- the app's own phone check ----
     In the store app the code is requested through Firebase's native SDK,
     which proves the request comes from this installed app (Play Integrity on
     Android, a silent push on iOS), so there is no reCAPTCHA and no picture
     puzzle. The SMS, the OTP boxes and the session are the same: the plugin
     runs with skipNativeAuth, and confirming the code signs in this page's
     own auth. Any native failure drops back to the reCAPTCHA path in doSend,
     so a build without the plugin, or a check that cannot run on one device,
     behaves exactly as it did before. */
  let nativeOff = null;
  function dropNative(){ if(nativeOff){ const f = nativeOff; nativeOff = null; f(); } }
  /* resolves with the verification id once the SMS is on its way; rejects
     when the native check cannot send it */
  function nativeSend(NA, fullPhone, my){
    dropNative();
    return new Promise((resolve, reject) => {
      let vid = '', settled = false;
      const handles = [];
      const fail = e => { if(!settled){ settled = true; reject(e); } };
      nativeOff = () => { handles.forEach(p => p.then(h => h.remove()).catch(() => {})); fail(new Error('superseded')); };
      const on = (name, fn) => handles.push(Promise.resolve(NA.addListener(name, fn)));
      try{
        on('phoneCodeSent', e => {
          vid = (e && e.verificationId) || '';
          if(!vid) return fail(new Error('no verification id'));
          if(!settled){ settled = true; resolve(vid); }
        });
        on('phoneVerificationFailed', e => fail(new Error((e && e.message) || 'native phone check failed')));
        on('phoneVerificationCompleted', e => {
          /* Android can read the SMS by itself: type the code in for the person.
             No code at all is "instant verification", which this page's own
             session cannot use, so that send goes the reCAPTCHA way. */
          const code = String((e && e.verificationCode) || '').replace(/\D/g, '');
          if(!vid) return fail(new Error('instant verification'));
          if(my !== sendSeq || code.length !== otpInputs.length || $('[data-step="otp"]').hidden) return;
          otpInputs.forEach((x, j) => x.value = code[j]);
          onFull();
        });
        Promise.resolve(NA.signInWithPhoneNumber({ phoneNumber: fullPhone })).catch(fail);
      }catch(e){ fail(e); }
    });
  }
  /* A picture puzzle that is closed leaves verify() pending forever. The
     button comes back after STALL_MS so a new tap can take over, and sendSeq
     makes that tap win over a late older answer. Until then `sending`
     swallows extra taps: one Resend tap, one SMS. */
  const STALL_MS = 30000;
  const STALL_MSG = 'Still waiting for the security check. If a picture puzzle is showing, finish it, or try again.';
  let sendSeq = 0, sending = false;
  let nativeAsked = 0;   /* the send (its sendSeq) now waiting on the app's own check; 0 = none */
  function sendIdle(){ sending = false; const b = $('[data-send]'); b.disabled = false; b.classList.remove('busy'); b.textContent = 'Get OTP'; }
  /* signed in: forget any send in flight and take the badge off the screen */
  function endSend(){ sendSeq++; sendIdle(); dropRecaptcha(verifier); verifier = null; dropNative(); }
  function toOtp(pretty){
    hideErr();
    $('[data-otp-to]').textContent = pretty;
    setStep('otp');
    clearBoxes(); otpInputs[0].focus();
    startCooldown($('[data-resend]'));
    call(opts.toast, 'OTP sent to ' + pretty);
  }
  async function doSend(){
    if(sending) return;
    hideErr();
    $('[data-nobook]').hidden = true;
    const ph = readPhone();
    if(!ph.ok){ showErr(ph.cc === '91' ? 'Enter your 10-digit mobile number.' : 'That number does not look right for country code +' + ph.cc + '.'); return; }
    /* the local test hook never sends: only the review number, answered here */
    if(DEMO_VIEW){
      if(ph.full !== DEMO_PHONE){ showErr('Test view: sign in with 90000 00001.'); return; }
      confirmation = { confirm: async () => ({ user: DEMO_USER }) };
      toOtp(ph.pretty); return;
    }
    const my = ++sendSeq; sending = true;
    const btn = $('[data-send]'); btn.disabled = true; btn.classList.add('busy'); btn.textContent = 'Checking…';
    if(opts.precheck !== false && ph.full !== DEMO_PHONE && !(await isKnownNumber(ph.last10))){
      if(my === sendSeq){ sendIdle(); if($('[data-step="otp"]').hidden) showNotSetUp(ph.pretty); else showErr('This number isn\'t set up with Fantasy Studio yet.'); }
      return;
    }
    if(my !== sendSeq) return;
    btn.textContent = 'Sending OTP…';
    const stall = setTimeout(() => {
      if(my !== sendSeq) return;
      /* no answer from the app's own check: the next tap must not wait on it again */
      if(nativeAsked === my) nativeSwitchOff(NATIVE_OFF_SHORT, 'no answer in ' + STALL_MS / 1000 + ' s');
      sendIdle(); showErr(STALL_MSG);
    }, STALL_MS);
    try{
      const NA = ph.full === DEMO_PHONE ? null : nativePhoneAuth();
      if(NA){
        try{
          nativeAsked = my;
          const vid = await nativeSend(NA, ph.full, my);
          if(nativeAsked === my) nativeAsked = 0;
          if(my !== sendSeq) return;
          confirmation = { native: true, confirm: code => signInWithCredential(auth, PhoneAuthProvider.credential(vid, code)) };
          toOtp(ph.pretty);
          return;
        }catch(err){
          if(nativeAsked === my) nativeAsked = 0;
          if(my !== sendSeq) return;
          console.warn('[sign-in] app phone check failed, using the web check:', err && err.message);
        }
      }
      const c = await signInWithPhoneNumber(auth, ph.full, verifier = freshVerifier(verifier, ph.full));
      if(my !== sendSeq) return;
      confirmation = c;
      toOtp(ph.pretty);
    }catch(err){ if(my === sendSeq) showErr(err); }
    finally{ clearTimeout(stall); if(my === sendSeq) sendIdle(); }
  }
  $('[data-send]').addEventListener('click', doSend);
  $('[data-phone]').addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); doSend(); } });
  $('[data-resend]').addEventListener('click', doSend);
  $('[data-verify]').addEventListener('click', async () => {
    hideErr();
    const code = otpCode();
    if(code.length !== 6){ showErr('Enter the 6-digit OTP.'); return; }
    if(!confirmation){ showErr('Tap Resend OTP for a new code.'); return; }
    const btn = $('[data-verify]'); btn.disabled = true; btn.classList.add('busy'); btn.textContent = 'Verifying…';
    let cred = null;
    const conf = confirmation;
    try{ cred = await conf.confirm(code); }
    catch(err){
      if(conf.native && codeNeedsWebCheck(err)){
        /* the app sent a code its own sign-in cannot use: from now on this phone takes
           the web check, and Resend is free at once to send the code that way */
        nativeSwitchOff(NATIVE_OFF_LONG, (err && err.code) || (err && err.message));
        endCooldown($('[data-resend]'));
        showErr('That code could not be used in the app. Tap Resend OTP and we will send a fresh one.' + errRef(err));
      }else showErr(err);
    }
    finally{ btn.disabled = false; btn.classList.remove('busy'); btn.textContent = 'Verify & Sign In'; }
    if(!cred) return;
    if(conf.native) nativeSwitchOn();   /* it worked on this phone: forget any earlier trouble */
    endSend();
    if(!DEMO_VIEW) lsSet(MIGRATED, '1');   /* a session of its own: old ones stay where they are */
    const user = cred.user || auth.currentUser;
    emit('signed-in', { user }); call(opts.onSignedIn, user);
  });
  /* Change number drops a Resend still in flight, so its late answer can't
     flip the box back to the OTP step for the old number */
  $('[data-back]').addEventListener('click', () => { sendSeq++; sendIdle(); setStep('phone'); hideErr(); $('[data-phone]').focus(); });

  return {
    el: wrap,
    reset(){ sendSeq++; sendIdle(); dropNative(); confirmation = null; clearBoxes(); hideErr(); $('[data-nobook]').hidden = true; setStep('phone'); },
    focus(){ $('[data-phone]').focus(); },
    destroy(){ sendSeq++; clearInterval(coolIv); dropRecaptcha(verifier); verifier = null; dropNative(); rcBox.remove(); wrap.remove(); },
  };
}

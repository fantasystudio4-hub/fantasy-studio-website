/* ============================================================
   FANTASY STUDIO — SHARED CATALOGUE & QUOTE ENGINE

   Every rupee shown anywhere on the public site traces back to this
   file. It is loaded by two pages:

     /            — the home page (package showcase, contact form)
     /builder/    — the Package Builder (the whole shopping flow)

   Before this existed the catalogue lived inline in index.html, so
   moving the builder onto its own page would have forked the prices
   into two files that drift apart the first time one is edited. Both
   pages now read the same constants, the same Firestore config
   override, and the same lead writer.

   Nothing here touches the DOM — pages own their own rendering.
   ============================================================ */

/* ---- official pricing (single source of truth) ---- */
var PRICES = {
  cinematography:    15000,  // per event
  candidPhotography: 10000,  // per event
  traditionalVideo:  7000,   // per event
  traditionalPhoto:  6000,   // per event
  ladyShooter:       2000,   // per head
  drone:             8000,   // per event
  ledScreen6x8:      7000,   // per event
  ledScreen8x12:     10000,  // per event
  liveStreaming:     6000,   // per event
  extraShortVPShoot: 3000,   // per event
  albumPerSheet:     400,    // album = sheets × 400
  albumMinSheets:    15,     // albums start at 15 sheets (0 = no album)
  albumMaxSheets:    100,
};
// All per-service charges are per visit / per event / up to 5 hours.

/* Promo whitelist — only the studio edits this. Empty = promo field hidden.
   Shape: 'CODE': { type:'percent'|'flat', value:Number, label:'shown to client' } */
var PROMO_CODES = {
  'SPECIAL10': { type:'percent', value:10, label:'10% special discount' },
};

var PAYMENT_TERMS = ['50% advance', '40% on event day', '10% at delivery'];

/* Google Analytics 4 — paste your Measurement ID (looks like 'G-XXXXXXXXXX') between the
   quotes to activate tracking. Leave empty to keep analytics off. */
var GA_MEASUREMENT_ID = 'G-X5VJYY7NP9';

/* Google Ads conversion tracking — paste from Google Ads > Conversions > "Contact"
   > Tag setup > "Install the tag yourself". The id looks like 'AW-123456789';
   the contact label is the part after the slash in send_to (e.g. 'AbCdEfGhIj0').
   Leave empty to keep Ads tracking off. */
var ADS_TAG = { id: '', labels: { contact: '' } };

var WA_NUMBER = "918686868803";

/* ---- service catalogue ----
   key / label / unit drive the price; cat / blurb / icon are shop-front copy
   for the builder's service rows and never enter a calculation.

   ORDER MATTERS. It is the order clients see in the builder, in the WhatsApp
   quote and in the PDF, and the first five are the ones a function opens
   with — the rest sit behind "5 more options". Traditional photo and video
   lead because that is what most families start from; cinematography and
   candid follow as the upgrade. */
var SERVICES = [
  { key:'traditionalPhoto',  label:'Traditional Photo',   unit:'event', cat:'photo',
    blurb:'Classic posed and stage photography, album-ready.',
    icon:'photo' },
  { key:'traditionalVideo',  label:'Traditional Video',   unit:'event', cat:'video',
    blurb:'Full start-to-finish video coverage of the function.',
    icon:'video' },
  { key:'cinematography',    label:'Cinematography',      unit:'event', cat:'video',
    blurb:'Cinematic wedding film with teasers — the highlight everyone shares.',
    icon:'film' },
  { key:'candidPhotography', label:'Candid Photography',  unit:'event', cat:'photo',
    blurb:'A photographer following the real moments, not just the posed ones.',
    icon:'camera' },
  { key:'ladyShooter',       label:'Female Shooter Premium', unit:'head', cat:'photo',
    badge:'Ladies’ Section Only',
    blurb:'A lady photographer covering the ladies’ side exclusively — for pardah-observing families.',
    icon:'lady' },
  { key:'drone',             label:'Drone Coverage',      unit:'event', cat:'extras',
    blurb:'Aerial shots of the venue, baraat and entry.',
    icon:'drone' },
  { key:'ledScreen6x8',      label:'LED Screen 6×8',      unit:'event', cat:'screens',
    blurb:'6×8 ft LED wall at the venue so every guest can see.',
    icon:'screen' },
  { key:'ledScreen8x12',     label:'LED Screen 8×12',     unit:'event', cat:'screens',
    blurb:'Larger 8×12 ft LED wall for big halls and open lawns.',
    icon:'screen' },
  { key:'liveStreaming',     label:'Live Streaming',      unit:'event', cat:'screens',
    blurb:'Stream the function live for family who cannot travel.',
    icon:'live' },
  { key:'extraShortVPShoot', label:'Extra Short VP Shoot',unit:'event', cat:'extras',
    blurb:'An extra short video-portrait shoot alongside the main coverage.',
    icon:'spark' },
];

var EVENT_TYPES = ['Manje','Sanchak','Mehndi','Nikah','Ruksati','Valima / Reception','Engagement','Birthday'];

/* one line of plain-language help per function, shown on the "add an event"
   tiles so nobody has to guess which name matches their card */
var EVENT_META = {
  'Manje':               { icon:'haldi',   note:'Haldi / manje at home' },
  'Sanchak':             { icon:'gift',    note:'Gifts & mehndi night' },
  'Mehndi':              { icon:'mehndi',  note:'Mehndi function' },
  'Nikah':               { icon:'rings',   note:'The nikah ceremony' },
  'Ruksati':             { icon:'car',     note:'Vidai / ruksati' },
  'Valima / Reception':  { icon:'crown',   note:'Valima or reception' },
  'Engagement':          { icon:'ring',    note:'Engagement / mangni' },
  'Birthday':            { icon:'cake',    note:'Birthday or single event' },
};

var SERVICE_KEYS = new Set(SERVICES.map(function(s){ return s.key; }));

/* ---- ready-made packages ----
   `events` are applied straight into the builder, then fine-tuned. */
var PRESETS = {
  single: {
    name:'Single-Day', tag:'',
    desc:'One function — engagement or birthday. Traditional photo & video coverage.',
    events:[{type:'Engagement', services:{traditionalPhoto:1, traditionalVideo:1}}],
    album:0
  },
  essential: {
    name:'Essential', tag:'',
    desc:'Sanchak, Nikah & Valima — traditional photo & video. Raw photos + edited video on pendrive.',
    events:[
      {type:'Sanchak', services:{traditionalVideo:1, traditionalPhoto:1}},
      {type:'Nikah', services:{traditionalPhoto:2, traditionalVideo:2}},
      {type:'Valima / Reception', services:{traditionalPhoto:2, traditionalVideo:2}}
    ],
    album:0
  },
  premium: {
    name:'Premium', tag:'Popular',
    desc:'Everything in Essential + cinematography for Nikah & Valima, plus 2 cinematic teasers.',
    events:[
      {type:'Sanchak', services:{traditionalVideo:1, traditionalPhoto:1}},
      {type:'Nikah', services:{traditionalPhoto:2, traditionalVideo:2, cinematography:1}},
      {type:'Valima / Reception', services:{traditionalPhoto:2, traditionalVideo:2, cinematography:1}}
    ],
    album:0
  },
  royal: {
    name:'Royal', tag:'Signature',
    desc:'Full signature coverage — cinematography, candid & drone for Nikah & Valima. + cinematic teasers.',
    events:[
      {type:'Sanchak', services:{traditionalVideo:1, traditionalPhoto:1}},
      {type:'Nikah', services:{traditionalPhoto:2, traditionalVideo:2, cinematography:1, candidPhotography:1, drone:1}},
      {type:'Valima / Reception', services:{traditionalPhoto:2, traditionalVideo:2, cinematography:1, candidPhotography:1, drone:1}}
    ],
    album:0
  }
};

/* what every package includes at no extra charge — reassurance copy, no price */
var ALWAYS_INCLUDED = [
  'Raw photos on a pendrive',
  'Fully edited video',
  'Up to 5 hours per event',
  'Free delivery in Hyderabad',
];

/* ============================================================
   HELPERS
   ============================================================ */
var inr = function(n){ return '₹' + Math.round(n).toLocaleString('en-IN'); };
/* the scope argument is ignored unless it can actually be queried — these get
   passed straight to Array.map in a few places, where the second argument is
   the index, and a bare `c || document` turned that index into a TypeError */
function _scope(c){ return (c && typeof c.querySelector === 'function') ? c : document; }
var $  = function(s,c){ return _scope(c).querySelector(s); };
var $$ = function(s,c){ return [].slice.call(_scope(c).querySelectorAll(s)); };
var TODAY_ISO = new Date().toLocaleDateString('en-CA'); // yyyy-mm-dd, local time
function esc(t){ return String(t).replace(/[&<>"']/g, function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

function fmtDate(d){
  return d ? new Date(d+'T00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : 'Date TBD';
}

/* ---- light anonymous analytics (GTM-ready, no cookies) ---- */
window.dataLayer = window.dataLayer || [];
function track(ev, data){
  try{
    window.dataLayer.push(Object.assign({event:ev}, data||{}));
    if(typeof window.gtag === 'function') window.gtag('event', ev, data||{});
  }catch(e){}
}
/* GA4 loads only when a Measurement ID is configured */
if(typeof GA_MEASUREMENT_ID === 'string' && /^G-[A-Z0-9]+$/.test(GA_MEASUREMENT_ID)){
  (function(){
    var gs = document.createElement('script');
    gs.async = true;
    gs.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_MEASUREMENT_ID;
    document.head.appendChild(gs);
    window.gtag = function(){ window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_MEASUREMENT_ID, { anonymize_ip: true });
    if(typeof ADS_TAG !== 'undefined' && ADS_TAG.id) window.gtag('config', ADS_TAG.id);
  })();
}
/* Google Ads conversion ping (no-op until ADS_TAG is configured) */
function fireAdsConversion(kind){
  try{
    if(typeof ADS_TAG === 'undefined' || !ADS_TAG.id) return;
    var label = ADS_TAG.labels && ADS_TAG.labels[kind];
    if(!label || typeof window.gtag !== 'function') return;
    window.gtag('event', 'conversion', { send_to: ADS_TAG.id + '/' + label });
  }catch(e){}
}

/* Phone handling for a studio that genuinely has NRI clients.
   Admin and the client portal already store/match on the last 10 digits of any
   country's number, so anything E.164-plausible is accepted and normalised.
   Returns null when the number cannot plausibly be a phone number. */
function parsePhone(raw){
  var digits = String(raw||'').replace(/\D/g,'');
  if(digits.indexOf('00') === 0) digits = digits.slice(2);     // 00 = international prefix
  if(digits.length < 10 || digits.length > 15) return null;    // E.164 bounds
  var last10 = digits.slice(-10);                              // what admin stores
  var cc = digits.length > 10 ? digits.slice(0, digits.length-10) : '';
  /* a leading 0 is a national trunk prefix, not a country code — "098765 43210"
     is an Indian number typed the way phones autofill it, not country code 0 */
  cc = cc.replace(/^0+/, '');
  if(!cc) cc = '91';
  return { digits: digits, last10: last10, cc: cc, e164: cc + last10 };
}

/* ============================================================
   QUOTE STATE PRIMITIVES
   ============================================================ */
var eid = 0;

/* Every event that enters state — from a #q= share link, from localStorage, or
   from a preset — goes through here first. Share links and localStorage are both
   attacker-reachable, so the type is whitelisted against EVENT_TYPES, the date is
   regex-checked, the id is forced numeric and quantities are clamped.
   Presets come from the owner's own admin Config, where custom event names are a
   feature, so they pass trustType=true and keep their name (still escaped at every
   sink); only length is capped. */
function normalizeEvent(raw, trustType){
  var r = raw || {};
  var type = trustType
    ? String(r.type||EVENT_TYPES[0]).slice(0,40)
    : (EVENT_TYPES.indexOf(r.type) !== -1 ? r.type : EVENT_TYPES[0]);
  var date = /^\d{4}-\d{2}-\d{2}$/.test(r.date||'') ? r.date : '';
  var services = {};
  Object.keys(r.services||{}).forEach(function(k){
    if(!SERVICE_KEYS.has(k)) return;             // not a real service — drop it
    var q = Math.floor(Number(r.services[k]));
    if(q > 0) services[k] = Math.min(50, q);     // NaN fails this test, so it drops
  });
  return { id: ++eid, type: type, date: date, services: services };
}

function eventTotal(ev){
  var t = 0;
  for(var k in ev.services){ t += (PRICES[k]||0) * ev.services[k]; }
  return t;
}
function activePromo(st){ return PROMO_CODES[st.promo] || null; }
/* album applies only when a photography service (candid / traditional photo) is chosen */
function albumEligible(st){
  return st.events.some(function(ev){
    return (ev.services.candidPhotography||0) > 0 || (ev.services.traditionalPhoto||0) > 0;
  });
}
function calcQuote(st){
  var evSub = st.events.reduce(function(s,e){ return s + eventTotal(e); }, 0);
  var albSub = (albumEligible(st) ? st.albumSheets : 0) * PRICES.albumPerSheet;
  var sub = evSub + albSub;
  var p = activePromo(st);
  var disc = !p ? 0 : Math.min(sub, p.type==='percent' ? Math.round(sub*p.value/100) : p.value);
  return { evSub: evSub, albSub: albSub, sub: sub, disc: disc, promo: p, grand: sub - disc };
}
/* only events with >=1 service count; date-sorted (undated last, builder order) */
function sortedEvents(st){
  return st.events
    .filter(function(ev){ return SERVICES.some(function(sv){ return (ev.services[sv.key]||0) > 0; }); })
    .slice()
    .sort(function(a,b){
      if(a.date && b.date) return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
      if(a.date) return -1;
      if(b.date) return 1;
      return 0;
    });
}
function presetRawTotal(p){
  var t = (p.album||0) * PRICES.albumPerSheet;
  p.events.forEach(function(ev){ for(var k in ev.services) t += PRICES[k]*ev.services[k]; });
  return t;
}
/* flattened service counts for a preset — used by the compare table and cards */
function presetServiceTotals(p){
  var agg = {};
  p.events.forEach(function(ev){ for(var sk in ev.services){ agg[sk] = (agg[sk]||0) + ev.services[sk]; } });
  return agg;
}

/* ---- the WhatsApp message the studio actually receives ---- */
function buildQuoteText(st, lead){
  var t = calcQuote(st);
  var L = [];
  L.push('*Fantasy Studio — Package Enquiry*');
  L.push('_Malakpet, Hyderabad_');
  if(lead && (lead.name || lead.phone)){
    L.push('');
    if(lead.name)  L.push('Name: ' + lead.name);
    /* full international form so an NRI enquiry is callable straight from the chat */
    if(lead.phoneFull) L.push('Phone: +' + lead.phoneFull);
    else if(lead.phone) L.push('Phone: ' + lead.phone);
  }
  L.push('----------------');
  var evs = sortedEvents(st);
  evs.forEach(function(ev,i){
    L.push('');
    L.push('*' + (i+1) + ') ' + (ev.type||'Event') + '* — ' + fmtDate(ev.date));
    SERVICES.forEach(function(sv){
      var q = ev.services[sv.key]||0; if(!q) return;
      var qTxt = q>1 ? ' ×' + q + (sv.unit==='head'?' heads':'') : (sv.unit==='head'?' ×1 head':'');
      L.push('• ' + sv.label + qTxt + ' — ' + inr(PRICES[sv.key]*q));
    });
    L.push('_' + ev.type + ' total: ' + inr(eventTotal(ev)) + '_');
  });
  if(!evs.length){ L.push(''); L.push('_(No services selected yet)_'); }
  if(albumEligible(st) && st.albumSheets>0){
    L.push('');
    L.push('*Album:* ' + st.albumSheets + ' sheets × ' + inr(PRICES.albumPerSheet) + ' = ' + inr(t.albSub));
  }
  L.push('');
  L.push('----------------');
  if(t.disc>0){
    L.push('Subtotal: ' + inr(t.sub));
    L.push('Promo (' + st.promo + '): −' + inr(t.disc));
  }
  L.push('*Grand Total: ' + inr(t.grand) + '*');
  L.push('Payment: ' + PAYMENT_TERMS.join(' · '));
  L.push('');
  L.push('Please confirm availability for my dates. Thank you!');
  return L.join('\n');
}
function waUrl(st, lead){
  return 'https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(buildQuoteText(st, lead));
}

/* ---- shareable quote links: the whole package travels in the URL ---- */
function encodeQuote(st){
  var payload = {
    e: st.events.map(function(ev){ return { t: ev.type, d: ev.date||'', s: ev.services }; }),
    a: st.albumSheets, p: st.promo
  };
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function decodeQuote(str){
  try{
    var d = JSON.parse(decodeURIComponent(escape(atob(String(str).replace(/-/g,'+').replace(/_/g,'/')))));
    return (d && Array.isArray(d.e)) ? d : null;
  }catch(e){ return null; }
}

/* ============================================================
   QUOTE PERSISTENCE (localStorage)
   Same key the inline builder always used, so a package saved before
   this refactor still opens on the new page.
   ============================================================ */
var STORE_KEY = 'fs_quote_v1';
function saveQuote(st){
  try{
    localStorage.setItem(STORE_KEY, JSON.stringify({
      events: st.events, albumSheets: st.albumSheets, promo: st.promo
    }));
  }catch(e){ /* private mode / quota — persistence is best-effort */ }
}
function loadQuote(){
  try{
    var raw = localStorage.getItem(STORE_KEY);
    if(!raw) return null;
    var d = JSON.parse(raw);
    if(!d || !Array.isArray(d.events)) return null;
    return d;
  }catch(e){ return null; }
}
function clearSavedQuote(){ try{ localStorage.removeItem(STORE_KEY); }catch(e){} }
function quoteHasContent(d){
  if(!d || !Array.isArray(d.events)) return false;
  var hasSvc = d.events.some(function(e){
    return Object.values(e.services||{}).some(function(q){ return q>0; });
  });
  return hasSvc || d.albumSheets>0;
}
/* a saved package, normalised and ready to price — used by the home page to
   show "continue where you left off" without duplicating the sanitiser */
function restoreQuote(d){
  var st = { events: [], albumSheets: 0, promo: '' };
  if(!d || !Array.isArray(d.events)) return st;
  st.events = d.events.slice(0,12).map(function(e){ return normalizeEvent(e, false); });
  st.albumSheets = Math.max(0, Math.min(PRICES.albumMaxSheets, parseInt(d.albumSheets,10)||0));
  st.promo = PROMO_CODES[d.promo] ? d.promo : '';
  return st;
}

/* where the builder lives, from any page on the site */
function builderUrl(opts){
  var base = (location.pathname.indexOf('/builder/') === 0 || /\/builder\/?$/.test(location.pathname))
    ? './' : 'builder/';
  var o = opts || {};
  if(o.promo) return base + '?promo=' + encodeURIComponent(o.promo);
  if(o.hash)  return base + o.hash;
  return base;
}

/* ============================================================
   LEAD CAPTURE — an enquiry must never vanish silently

   Three ways an enquiry used to disappear with no signal to anyone:
   (1) __saveLead is only defined after the Firebase config fetch resolves —
       on Indian mobile data that window is seconds long, and every submit
       inside it was skipped by a `typeof === 'function'` guard;
   (2) the write's rejection was swallowed;
   (3) the timeout race resolved identically whether the write landed or not.
   Now: wait for the transport if it is still coming, and if the write does not
   land, park the lead in localStorage and retry it on the next visit. The
   WhatsApp hand-off is unchanged, so the owner still gets the message either way.
   ============================================================ */
var LEAD_KEY = 'fs_lead';
var LEAD_QUEUE_KEY = 'fs_lead_queue_v1';

function queueLead(doc){
  try{
    var q = JSON.parse(localStorage.getItem(LEAD_QUEUE_KEY) || '[]');
    q.push({ doc: doc, at: Date.now() });
    localStorage.setItem(LEAD_QUEUE_KEY, JSON.stringify(q.slice(-20)));
  }catch(e){}
}
function firebaseReady(waitMs){
  if(typeof window.__firebaseReady === 'boolean') return Promise.resolve(window.__firebaseReady);
  if(!window.FIREBASE_CONFIG || !window.FIREBASE_CONFIG.apiKey) return Promise.resolve(false);
  return new Promise(function(res){
    var done = function(){ clearTimeout(t); res(!!window.__firebaseReady); };
    var t = setTimeout(function(){ document.removeEventListener('firebase-ready', done); res(false); }, waitMs);
    document.addEventListener('firebase-ready', done, { once:true });
  });
}
async function saveLeadReliably(doc){
  var ready = await firebaseReady(4000);        /* the window that used to drop leads */
  if(!ready || typeof window.__saveLead !== 'function'){ queueLead(doc); return false; }
  var ok = false;
  try{ ok = await window.__saveLead(doc); }catch(e){ ok = false; }
  if(!ok) queueLead(doc);
  return ok;
}
async function flushLeadQueue(){
  var q;
  try{ q = JSON.parse(localStorage.getItem(LEAD_QUEUE_KEY) || '[]'); }catch(e){ return; }
  if(!q.length) return;
  if(!(await firebaseReady(8000)) || typeof window.__saveLead !== 'function') return;
  var left = [];
  for(var i=0;i<q.length;i++){
    var ok = false;
    try{ ok = await window.__saveLead(q[i].doc); }catch(e){ ok = false; }
    if(!ok) left.push(q[i]);
  }
  try{
    if(left.length) localStorage.setItem(LEAD_QUEUE_KEY, JSON.stringify(left));
    else localStorage.removeItem(LEAD_QUEUE_KEY);
  }catch(e){}
}
/* the lead document admin reads, built from a priced package */
function buildLeadDoc(st, name, phone, phoneFull){
  var evs = sortedEvents(st);
  return {
    name: name, phone: phone, phoneFull: phoneFull || '',
    eventType: evs.map(function(v){ return v.type; }).join(', '),
    weddingDate: (evs.find(function(v){ return v.date; })||{}).date || '',
    message: '',
    quote: {
      events: st.events.map(function(ev){ return { type: ev.type, date: ev.date||'', services: ev.services }; }),
      albumSheets: st.albumSheets,
      promo: st.promo
    },
    grandTotal: calcQuote(st).grand,
    source: 'package_builder'
  };
}

/* ============================================================
   LIVE CONFIG — prices & packages from Firestore.
   Pages subscribe with onRemoteConfig(fn); the callback fires once the
   config lands (or immediately, if it already has). On any failure the
   hardcoded values above simply remain in force.
   ============================================================ */
var _cfgSubs = [], _cfgDone = null;
function onRemoteConfig(fn){
  if(typeof fn !== 'function') return;
  if(_cfgDone) { try{ fn(_cfgDone); }catch(e){} return; }
  _cfgSubs.push(fn);
}
function applyRemoteConfig(cfg){
  try{
    if(cfg && cfg.prices){
      Object.keys(cfg.prices).forEach(function(k){
        var v = Number(cfg.prices[k]);
        if(!isNaN(v) && v >= 0) PRICES[k] = v;
      });
    }
    if(cfg && cfg.presets && Object.keys(cfg.presets).length){
      /* A preset whose numbers don't add up renders "Package ₹NaN" on the live
         site, so validate before adopting: quantities must be real numbers and
         every service key must exist. A bad preset is skipped, keeping the
         built-in one, rather than publishing NaN to visitors. */
      var clean = {};
      Object.keys(cfg.presets).forEach(function(k){
        var pr = cfg.presets[k];
        if(!pr || !Array.isArray(pr.events) || !pr.events.length) return;
        var events = [], ok = true;
        pr.events.forEach(function(ev){
          if(!ev || typeof ev !== 'object'){ ok = false; return; }
          var services = {};
          Object.keys(ev.services||{}).forEach(function(sk){
            if(!SERVICE_KEYS.has(sk)) return;
            var q = Number(ev.services[sk]);
            if(!isFinite(q) || q < 0){ ok = false; return; }
            if(q > 0) services[sk] = Math.min(50, Math.floor(q));
          });
          events.push({ type: String(ev.type||'Event').slice(0,40), services: services });
        });
        var album = Number(pr.album||0);
        if(!ok || !isFinite(album) || album < 0) return;      // skip, keep the built-in
        /* a preset that ended up with nothing priceable would advertise
           "Package ₹0" — drop it rather than show a free package */
        var hasAny = events.some(function(ev){ return Object.keys(ev.services).length > 0; });
        if(!hasAny && !album) return;
        clean[k] = { name: String(pr.name||k), tag: String(pr.tag||''),
                     desc: String(pr.desc||''), album: Math.floor(album), events: events };
      });
      if(Object.keys(clean).length){
        Object.keys(PRESETS).forEach(function(k){ if(!clean[k]) delete PRESETS[k]; });
        Object.keys(clean).forEach(function(k){ PRESETS[k] = clean[k]; });
      }
    }
  }catch(e){}
  _cfgDone = cfg || {};
  _cfgSubs.splice(0).forEach(function(fn){ try{ fn(_cfgDone); }catch(e){} });
}

/* ============================================================
   FIRESTORE OVER REST

   The public pages read ONE config document and occasionally append a
   lead. Both are plain HTTPS calls, so they are done with fetch()
   instead of pulling the modular SDK (134 KB gzipped / 538 KB raw, plus
   ~300-500ms of parse+compile on a mid-range Android) for two requests.
   Verified against the live config/site document: the decoder below
   reproduces the SDK's object exactly.
   ============================================================ */
(function(){
  var CFG = window.FIREBASE_CONFIG;
  if(!CFG || !CFG.apiKey){
    /* no backend configured — unblock anything waiting on the config */
    applyRemoteConfig(null);
    window.__firebaseReady = false;
    return;
  }
  var BASE = 'https://firestore.googleapis.com/v1/projects/' + CFG.projectId +
             '/databases/(default)/documents';

  /* Firestore REST wraps every value in a type tag; unwrap back to plain JS. */
  function fsVal(v){
    if(v === null || typeof v !== 'object') return null;
    if('nullValue'      in v) return null;
    if('booleanValue'   in v) return v.booleanValue;
    if('integerValue'   in v) return Number(v.integerValue);
    if('doubleValue'    in v) return Number(v.doubleValue);
    if('stringValue'    in v) return v.stringValue;
    if('timestampValue' in v) return v.timestampValue;
    if('arrayValue'     in v) return (v.arrayValue.values || []).map(fsVal);
    if('mapValue'       in v) return fsFields(v.mapValue.fields || {});
    return null;
  }
  function fsFields(f){ var o = {}, k; for(k in f) o[k] = fsVal(f[k]); return o; }

  /* ...and the reverse, for writing a lead. */
  function toVal(v){
    if(v === null || v === undefined) return { nullValue: null };
    if(typeof v === 'boolean') return { booleanValue: v };
    if(typeof v === 'number')  return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    /* must be a real Firestore timestamp, not a string: admin sorts leads with
       orderBy('createdAt') and formats them with createdAt.toDate() */
    if(v instanceof Date)      return { timestampValue: v.toISOString() };
    if(Array.isArray(v))       return { arrayValue: { values: v.map(toVal) } };
    if(typeof v === 'object')  return { mapValue: { fields: toFields(v) } };
    return { stringValue: String(v) };
  }
  function toFields(o){ var f = {}, k; for(k in o) f[k] = toVal(o[k]); return f; }

  /* live pricing & content — hardcoded values stay if this fails */
  fetch(BASE + '/config/site?key=' + CFG.apiKey)
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(j){
      applyRemoteConfig(j && j.fields ? fsFields(j.fields) : null);
    })
    .catch(function(){ applyRemoteConfig(null); })
    .then(function(){
      window.__firebaseReady = true;
      document.dispatchEvent(new Event('firebase-ready'));
    });

  /* Lead capture. Resolves true only if the write actually landed, so the
     caller can queue it for retry instead of dropping it on the floor.
     Still time-boxed to 2.5s so the WhatsApp hand-off is never held up. */
  window.__saveLead = function(lead){
    /* REST cannot request serverTimestamp() without a commit+transform, so this
       is the client clock. Same value the SDK would have written while offline. */
    var doc = Object.assign({ createdAt: new Date(), status: 'new', notes: '' }, lead);
    return Promise.race([
      fetch(BASE + '/leads?key=' + CFG.apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: toFields(doc) })
      }).then(function(r){ return r.ok; }).catch(function(){ return false; }),
      new Promise(function(res){ setTimeout(function(){ res(false); }, 2500); })
    ]);
  };
})();

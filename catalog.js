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

/* ---- pricing floor ----
   NOT the source of truth: config/site is, and the studio edits it in the admin
   panel. These are the numbers a visitor is quoted when that document cannot be
   read at all and nothing better has been cached (see LAST-KNOWN-GOOD below) —
   which in practice means a first visit with no usable connection.

   They had drifted a full price revision behind the live document, so an
   offline first visit quoted ₹15,000 for cinematography against a real ₹14,000
   and the studio was held to a package it does not sell. Synced 26 Aug 2026
   with config/site as published on 13 Aug 2026.

   If you change a price in the admin panel, change it here too. Nothing
   enforces that, which is exactly why it drifted — the cache below is what
   makes the drift survivable rather than a wrong quote. */
var PRICES = {
  cinematography:    14000,  // per event
  candidPhotography: 9000,   // per event
  traditionalVideo:  6500,   // per event
  traditionalPhoto:  5500,   // per event
  ladyShooter:       2000,   // per head
  drone:             7000,   // per event
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

/* ---- price tokens in owner-written copy ----
   FAQ answers quote real prices in prose, and prose does not update itself. The
   lady-shooter answer read "₹8,000 per head per event (₹6,000 photography
   charge + ₹2,000 premium)" for months after traditional photo dropped to
   ₹5,500 — so the site, and the FAQPage structured data Google reads from it,
   published a total that no longer added up from its own parts.

   Writing {ladyShooterTotal} instead keeps it right through every future price
   change, and removes the bit a human was getting wrong: the sum. Any token not
   listed here is left exactly as typed, so ordinary prose containing braces is
   untouched. */
var COPY_TOKENS = {
  traditionalPhoto:  { money:true,  get:function(){ return PRICES.traditionalPhoto; } },
  traditionalVideo:  { money:true,  get:function(){ return PRICES.traditionalVideo; } },
  cinematography:    { money:true,  get:function(){ return PRICES.cinematography; } },
  candidPhotography: { money:true,  get:function(){ return PRICES.candidPhotography; } },
  drone:             { money:true,  get:function(){ return PRICES.drone; } },
  ladyShooter:       { money:true,  get:function(){ return PRICES.ladyShooter; } },
  /* a lady shooter is the photography charge PLUS the pardah premium — the one
     figure nobody can keep in step by hand */
  ladyShooterTotal:  { money:true,  get:function(){ return PRICES.traditionalPhoto + PRICES.ladyShooter; } },
  albumPerSheet:     { money:true,  get:function(){ return PRICES.albumPerSheet; } },
  albumMinSheets:    { money:false, get:function(){ return PRICES.albumMinSheets; } },
  albumMaxSheets:    { money:false, get:function(){ return PRICES.albumMaxSheets; } }
};
function fillCopyTokens(text){
  return String(text == null ? '' : text).replace(/\{(\w+)\}/g, function(m, k){
    var t = COPY_TOKENS[k];
    if(!t) return m;
    var v = t.get();
    return t.money ? inr(v) : String(v);
  });
}
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
   from a preset — goes through here first. The date is regex-checked, the id is
   forced numeric, quantities are clamped, and the type is sanitised.

   The type used to be WHITELISTED against EVENT_TYPES for anything that did not
   come straight from a preset, and that silently renamed the studio's own
   functions. A preset named "Aqiqah" in admin Config kept its name right up
   until the package was saved and reopened — or opened from a shared link — at
   which point it came back as "Manje" and the quote described a different
   wedding. Custom names in presets are a deliberate feature, and a preset is
   the only way an event name enters state at all, so the name is now always
   kept.

   Keeping it is safe because the type is escaped at every sink it reaches (the
   builder panels, the WhatsApp message, the PDF, the admin lead list). What the
   cap and the control-character strip below are for is the one thing escaping
   does not cover: a #q= link is opened by SOMEONE ELSE, so a crafted name must
   not be long enough, or multi-line enough, to pass itself off as the studio's
   own copy on their screen. */
var EVENT_TYPE_MAX = 40;
function cleanEventType(v){
  var t = String(v == null ? '' : v)
    .replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, ' ')   /* no newlines, no controls */
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, EVENT_TYPE_MAX)
    .trim();
  return t || EVENT_TYPES[0];
}
function normalizeEvent(raw){
  var r = raw || {};
  var type = cleanEventType(r.type);
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
  st.events = d.events.slice(0,12).map(function(e){ return normalizeEvent(e); });
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

/* The firestore rule that accepts a lead caps three of its fields, and the
   forms had no matching limit. A message over 2000 characters — a long, careful
   description of the wedding, i.e. exactly the enquiry worth having — was
   accepted on screen, refused by the server, parked in the queue below and
   retried on every future visit, failing every single time. The customer read
   "Enquiry sent — we'll reply shortly"; the studio never saw it.

   The inputs now carry maxlength, but that is only the first line: it does not
   constrain a value set by script, an autofill, or a doc rebuilt from a queue
   entry written before this existed. So the clamp is applied here too, at the
   one point every lead passes through on its way to the server.

   Cutting a long message is a real loss, but a truncated enquiry the studio can
   read and call back on beats a perfect one nobody ever sees. */
var LEAD_LIMITS = { name: 120, phone: 20, message: 2000 };
function clampLead(doc){
  var d = Object.assign({}, doc || {});
  d.name    = String(d.name == null ? '' : d.name).trim().slice(0, LEAD_LIMITS.name);
  d.phone   = String(d.phone == null ? '' : d.phone).slice(0, LEAD_LIMITS.phone);
  d.message = String(d.message == null ? '' : d.message).slice(0, LEAD_LIMITS.message);
  return d;
}
/* the rule also requires a non-empty name, so a doc without one can never land
   however many times it is retried */
function leadWritable(doc){ return !!(doc && String(doc.name||'').trim()); }

/* A queued lead used to be retried forever. Give up eventually rather than
   burning a request on every visit for the life of the browser profile. */
var LEAD_QUEUE_MAX_TRIES = 5;
var LEAD_QUEUE_MAX_AGE_MS = 30 * 864e5;   /* 30 days */

function queueLead(doc){
  try{
    var q = JSON.parse(localStorage.getItem(LEAD_QUEUE_KEY) || '[]');
    q.push({ doc: doc, at: Date.now(), tries: 0 });
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
  var lead = clampLead(doc);                    /* fits the rule, so it can land */
  var ready = await firebaseReady(4000);        /* the window that used to drop leads */
  if(!ready || typeof window.__saveLead !== 'function'){ queueLead(lead); return false; }
  var ok = false;
  try{ ok = await window.__saveLead(lead); }catch(e){ ok = false; }
  if(!ok) queueLead(lead);
  return ok;
}
async function flushLeadQueue(){
  var q;
  try{ q = JSON.parse(localStorage.getItem(LEAD_QUEUE_KEY) || '[]'); }catch(e){ return; }
  if(!q.length) return;
  if(!(await firebaseReady(8000)) || typeof window.__saveLead !== 'function') return;
  var now = Date.now(), left = [];
  for(var i=0;i<q.length;i++){
    var item = q[i] || {};
    /* Entries queued before the clamp existed are precisely the ones the server
       keeps refusing — re-clamp before retrying so they finally land instead of
       failing for a sixth time and being dropped. */
    var doc = clampLead(item.doc);
    if(!leadWritable(doc)) continue;            /* nameless: it can never be accepted */
    var ok = false;
    try{ ok = await window.__saveLead(doc); }catch(e){ ok = false; }
    if(ok) continue;
    var tries = (Number(item.tries) || 0) + 1;
    var age = now - (Number(item.at) || now);
    if(tries >= LEAD_QUEUE_MAX_TRIES || age > LEAD_QUEUE_MAX_AGE_MS) continue;
    left.push({ doc: doc, at: item.at || now, tries: tries });
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
/* ---- LAST-KNOWN-GOOD ----
   Updating the constants above fixes today's prices; it does nothing about the
   next revision, because nobody is reminded to edit two files at once. So the
   last config this browser actually read is kept, and a failed fetch falls back
   to that before it falls back to the constants. A returning visitor — which is
   most people building a package over a few evenings — is then quoted what they
   were quoted last time, not whatever shipped with the code.

   Only the four keys the public pages render are stored. The same document also
   carries the studio's internal quoting rates, and there is no reason to copy
   those onto every visitor's device. */
var CFG_CACHE_KEY = 'fs_cfg_v1';
var CFG_PUBLIC_KEYS = ['prices','presets','testimonials','faqs'];
function publicConfigSubset(cfg){
  if(!cfg) return null;
  var out = {}, n = 0;
  CFG_PUBLIC_KEYS.forEach(function(k){ if(cfg[k]){ out[k] = cfg[k]; n++; } });
  return n ? out : null;
}
function cacheConfig(cfg){
  try{
    var pub = publicConfigSubset(cfg);
    if(pub) localStorage.setItem(CFG_CACHE_KEY, JSON.stringify({ at: Date.now(), cfg: pub }));
  }catch(e){ /* private mode / quota — the constants still cover us */ }
}
function cachedConfig(){
  try{
    var d = JSON.parse(localStorage.getItem(CFG_CACHE_KEY) || 'null');
    return (d && d.cfg) ? d.cfg : null;
  }catch(e){ return null; }
}

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
    /* no backend configured — unblock anything waiting on the config, on the
       freshest prices this browser has seen */
    applyRemoteConfig(cachedConfig());
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
      var live = (j && j.fields) ? fsFields(j.fields) : null;
      /* a 5xx, a captive portal or a quota block lands here with live === null;
         last-known-good beats the constants in every one of those cases */
      if(live) cacheConfig(live);
      applyRemoteConfig(live || cachedConfig());
    })
    .catch(function(){ applyRemoteConfig(cachedConfig()); })
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

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const inr = n => '₹' + Math.round(Number(n)||0).toLocaleString('en-IN');
/* compact rupees for tiles too narrow for the full figure — ₹8.4L, ₹1.2Cr.
   Only ever for display next to the exact value (title attribute). */
const inrShort = n => {
  const v = Math.round(Number(n)||0);
  const cut = (d, unit) => '₹' + (v/d).toFixed(v % d === 0 ? 0 : 1).replace(/\.0$/,'') + unit;
  return v >= 1e7 ? cut(1e7,'Cr') : v >= 1e5 ? cut(1e5,'L') : v >= 1e4 ? cut(1e3,'K') : inr(v);
};
const esc = t => String(t==null?'':t).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let toastT;
/* Duration follows length: 2.6s fit "Saved ✓" but "NOT saved — the server
   refused this write…" is 20+ words, gone before a phone user has read half.
   ~45ms per character past the first 40, capped at 7s. */
function toast(m){
  const t=$('#toast'); t.textContent=m; t.style.pointerEvents='none'; t.classList.add('show');
  clearTimeout(toastT);
  toastT=setTimeout(()=>t.classList.remove('show'), Math.min(7000, 2600 + Math.max(0, String(m).length - 40) * 45));
}
function toastUndo(m, fn){
  const t=$('#toast');
  t.textContent = m + ' ';
  const b = document.createElement('button'); b.type='button'; b.textContent='Undo';
  b.addEventListener('click', ()=>{ t.classList.remove('show'); t.style.pointerEvents='none'; fn(); });
  t.appendChild(b);
  t.style.pointerEvents='auto';
  t.classList.add('show');
  clearTimeout(toastT); toastT=setTimeout(()=>{ t.classList.remove('show'); t.style.pointerEvents='none'; }, 8000);
}
const buzz = () => { try{ navigator.vibrate && navigator.vibrate(8); }catch(e){} };

/* ---------------------------------------------------------------- confirm
   Every destructive action in the panel goes through this. Returns a promise
   for true/false, so a call site reads exactly like the window.confirm() it
   replaces:

       if(!await confirmDialog({ title:…, body:…, confirmText:'Delete' })) return;

   Cancel takes focus, not the destructive button: the owner is usually
   one-handed on a phone and a stray second tap must not be the one that
   deletes. Esc, the backdrop and Android's back gesture all cancel. */
let _cfmResolve = null;
function confirmDialog({ title, body='', confirmText='Delete', cancelText='Cancel', danger=true }){
  const bd = $('#confirmBackdrop'), md = $('#confirmModal');
  const yes = $('#confirmYes'), no = $('#confirmNo');
  $('#confirmTitle').textContent = title;
  $('#confirmText').innerHTML = body;               /* callers pass esc()'d text */
  $('#confirmText').hidden = !body;
  yes.textContent = confirmText;
  no.textContent  = cancelText;
  yes.className = 'btn ' + (danger ? 'btn--danger' : 'btn--primary');
  bd.classList.add('open'); md.classList.add('open');
  /* the sheet animates up from the bottom on a phone; focusing mid-flight
     scrolls the page under it, so wait for it to land */
  setTimeout(()=>no.focus(), 60);
  buzz();
  return new Promise(res=>{ _cfmResolve = res; });
}
function closeConfirm(v){
  if(!_cfmResolve) return;
  $('#confirmBackdrop').classList.remove('open');
  $('#confirmModal').classList.remove('open');
  const r = _cfmResolve; _cfmResolve = null; r(v);
}
$('#confirmYes').addEventListener('click', ()=>closeConfirm(true));
$('#confirmNo').addEventListener('click', ()=>closeConfirm(false));
$('#confirmBackdrop').addEventListener('click', ()=>closeConfirm(false));
document.addEventListener('keydown', e=>{
  if(!_cfmResolve) return;
  if(e.key === 'Escape'){ e.preventDefault(); closeConfirm(false); }
  /* the dialog is the only thing on screen while it is open — keep Tab inside
     it so the next Enter cannot land on a button behind the scrim */
  if(e.key === 'Tab'){
    const f = [$('#confirmNo'), $('#confirmYes')];
    const i = f.indexOf(document.activeElement);
    e.preventDefault();
    f[(i + (e.shiftKey ? f.length-1 : 1)) % f.length].focus();
  }
});

/* --------------------------------------------------------- status -> state
   The one place a status becomes a colour. Leads, packages, crew and B2B all
   read this, so "booked" cannot be green on one tab and gold on another, and
   a new status added later has to declare its meaning here before it can be
   drawn anywhere. The state names are defined in tokens.css. */
const STATE_OF = {
  /* leads */
  new:'new', contacted:'info', converted:'linked', booked:'confirmed',
  shot:'progress', delivered:'done', lost:'overdue',
  /* packages */
  draft:'neutral', sent:'info', unconfirmed:'risk',
};
const stateOf = s => STATE_OF[s] || 'neutral';


/* Search boxes re-rendered on every keystroke. At the 1000-record caps that is
   a lot of DOM per character on a phone, and the owner is still mid-word —
   wait for the typing to settle. Short enough that it still reads as live. */
const debounce = (fn, ms=140) => { let t; return function(...a){ clearTimeout(t); t = setTimeout(()=>fn.apply(this, a), ms); }; };

/* ------------------------------------------------------------ sticky view
   Filters and searches used to live only in module variables. That survived a
   tab switch but not a reload — and this is an installed PWA on a phone, which
   the OS kills whenever it wants memory. Coming back to a list you had
   narrowed and finding it wide open again is the same lost place either way.

   Deliberately NOT stored: which record is expanded, and any half-typed note.
   Those belong to the moment, not to the view. */
const VIEW_KEY = 'fs_view';
let _view = {};
try{ _view = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}') || {}; }catch(e){ _view = {}; }
const viewGet = (k, dflt='') => (k in _view ? _view[k] : dflt);
/* The STATE updates now; only the disk write is debounced. Debouncing the
   whole function shared one timer across every key, so two calls inside the
   window cancelled the first — "Clear filter & search" fires viewSet('leadF')
   then viewSet('leadQ'), and only the search was ever persisted. The filter
   the owner had just cleared came straight back on the next load, which is the
   exact thing this is supposed to prevent. */
let _viewFlush;
function viewSet(k, v){
  _view[k] = v;
  clearTimeout(_viewFlush);
  _viewFlush = setTimeout(()=>{
    try{ localStorage.setItem(VIEW_KEY, JSON.stringify(_view)); }catch(e){}
  }, 250);
}

const SERVICE_LABELS = {
  cinematography:'Cinematography', candidPhotography:'Candid Photography',
  traditionalVideo:'Traditional Video', traditionalPhoto:'Traditional Photo',
  ladyShooter:'Female Shooter', drone:'Drone Coverage', ledScreen6x8:'LED Screen 6×8',
  ledScreen8x12:'LED Screen 8×12', liveStreaming:'Live Streaming', extraShortVPShoot:'Extra Short VP Shoot'
};
/* 'converted' is set for you the moment a lead becomes a saved package — the
   enquiry stops being an open lead and its quotation takes over the job (see
   linkConvertedLead). The older lead-side booked/shot/delivered stages stay
   for enquiries that were tracked here before packages existed. */
const STATUSES = ['new','contacted','converted','booked','shot','delivered','lost'];

/* current live-site values — used to seed config/site the first time */
const DEFAULTS = {
  prices: { cinematography:15000, candidPhotography:10000, traditionalVideo:7000, traditionalPhoto:6000,
    ladyShooter:2000, drone:8000, ledScreen6x8:7000, ledScreen8x12:10000, liveStreaming:6000,
    extraShortVPShoot:3000, albumPerSheet:400, albumMinSheets:15, albumMaxSheets:100 },
  presets: {
    single:   { name:'Single-Day', tag:'', desc:'One function — engagement or birthday. Traditional photo & video coverage.', album:0,
      events:[{type:'Engagement', services:{traditionalPhoto:1, traditionalVideo:1}}] },
    essential:{ name:'Essential', tag:'', desc:'Sanchak, Nikah & Valima — traditional photo & video. Raw photos + edited video on pendrive.', album:0,
      events:[{type:'Sanchak', services:{traditionalVideo:1, traditionalPhoto:1}},
              {type:'Nikah', services:{traditionalPhoto:2, traditionalVideo:2}},
              {type:'Valima / Reception', services:{traditionalPhoto:2, traditionalVideo:2}}] },
    premium:  { name:'Premium', tag:'Popular', desc:'Everything in Essential + cinematography for Nikah & Valima, plus 2 cinematic teasers.', album:0,
      events:[{type:'Sanchak', services:{traditionalVideo:1, traditionalPhoto:1}},
              {type:'Nikah', services:{traditionalPhoto:2, traditionalVideo:2, cinematography:1}},
              {type:'Valima / Reception', services:{traditionalPhoto:2, traditionalVideo:2, cinematography:1}}] },
    royal:    { name:'Royal', tag:'Signature', desc:'Full signature coverage — cinematography, candid & drone for Nikah & Valima. + cinematic teasers.', album:0,
      events:[{type:'Sanchak', services:{traditionalVideo:1, traditionalPhoto:1}},
              {type:'Nikah', services:{traditionalPhoto:2, traditionalVideo:2, cinematography:1, candidPhotography:1, drone:1}},
              {type:'Valima / Reception', services:{traditionalPhoto:2, traditionalVideo:2, cinematography:1, candidPhotography:1, drone:1}}] }
  },
  testimonials: [
    { name:'Ayesha & Imran', location:'Malakpet, Hyderabad', text:'Fantasy Studio captured our Nikah and Valima so beautifully. The candid shots brought tears to my mother’s eyes. Truly the best in Hyderabad.' },
    { name:'Priya & Rohan', location:'Banjara Hills, Hyderabad', text:'The drone shots and cinematic film were straight out of a movie. Professional, punctual and so respectful of all our rituals. Highly recommended.' },
    { name:'Sana & Bilal', location:'Old City, Hyderabad', text:'14 years of experience really shows. They handled our Mehndi, Nikah and Reception flawlessly with separate teams. The album is a family treasure now.' }
  ],
  serviceRates: {
    'Traditional Photography': 5500,
    'Traditional Videography': 6500,
    'Drone Coverage': 6000,
    'Female Photographer – Ladies Section': 1500,
    'Candid Photography': 0,
    'Cinematography': 0
  },
  contact: { phone: '+91 86868 68803', website: 'www.fantasystudio.in' },
  deliverySteps: ['All events shot','Photo pendrive ready','Photo pendrive delivered','Cinematic teasers ready','Video editing details received','Video edited','Video delivered','Album selection received','Album designed','Album delivered','All delivered — package closed'],
  /* partner-studio jobs: they collect the footage and do their own post */
  b2bDeliverySteps: ['All events shot','Data ready to collect from office','Data delivered — job closed'],
  quoteTerms: [
    '50% advance to confirm the booking, 40% on the event day and 10% at the time of delivery.',
    'Booking is confirmed and dates are blocked only once the advance is received.',
    'The advance is adjusted in the final bill and is non-refundable if the booking is cancelled after dates are blocked.',
    'Each service covers one visit of up to 5 hours per event; extended hours are charged extra.',
    'Raw photos and the fully edited video are delivered on a pendrive after the final payment is cleared.',
    'Quotation valid for 7 days from the date above.',
    'Travel outside Hyderabad city limits charged extra, if applicable.'
  ],
  faqs: [
    { q:'How do I book Fantasy Studio for my wedding?', a:'Build your package right here on the site, send it to us on WhatsApp, and your dates are reserved once the 50% advance is paid. The remaining 40% is due on the event day and the final 10% at delivery.' },
    { q:'What are the payment terms?', a:'50% advance to confirm your booking, 40% on the event day, and 10% at the time of delivery. These terms are printed on every quote and PDF.' },
    { q:'Do you have female photographers for the bridal side?', a:'Yes. We provide dedicated lady shooters for pardah-observing families — a female photographer who covers the ladies’ section exclusively. Lady shooters are ₹8,000 per head per event (₹6,000 photography charge + ₹2,000 female shooter pardah coverage premium). You can add them to any event directly in the Package Builder.' },
    { q:'Will we get the raw photos too?', a:'Yes. Raw photos along with the fully edited video are delivered on a pendrive with every package.' },
    { q:'Can I customise a ready-made package?', a:'Absolutely. Pick any ready-made package as a starting point, then add or remove services per event — the price updates live as you change things.' },
    { q:'How does the premium album work?', a:'Albums are priced at ₹400 per sheet with a minimum of 15 sheets. Choose your sheet count in the builder and the album total is added to your quote instantly.' },
    { q:'Which events do you cover?', a:'Manje, Sanchak, Mehndi, Nikah, Ruksati and Valima / Reception — plus engagements and birthdays for single-day coverage.' }
  ]
};

if(!window.FIREBASE_CONFIG || !window.FIREBASE_CONFIG.apiKey){
  $('#setupView').hidden = false;
}else{
  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
  const { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail } =
    await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
  const { initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
          collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, deleteField,
          query, orderBy, limit, serverTimestamp, onSnapshot, runTransaction, arrayUnion, increment, getDocsFromServer } =
    await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

  const app  = initializeApp(window.FIREBASE_CONFIG);
  const auth = getAuth(app);
  /* offline-first: writes queue locally and sync when signal returns */
  let db;
  try{ db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
  catch(e){ db = initializeFirestore(app, {}); }

  /* Resolves 'ok' on server ack, 'queued' if still pending after 2.5s (offline),
     'denied' if the server actually refused it.
     The old version swallowed the rejection with p.catch(()=>{}) and then let
     the 2.5s timer win, so a permission-denied write — one that will NEVER
     land — was reported to the owner as "saved · will sync". A ₹1,50,000
     payment could be announced as recorded and simply not exist. */
  function settle(p){
    let failed = null;
    const tracked = p.then(()=>'ok', err=>{ failed = err; return 'denied'; });
    return Promise.race([
      tracked,
      new Promise(res=>setTimeout(()=>res(failed ? 'denied' : 'queued'), 2500))
    ]);
  }
  /* one place that decides what the owner is told about a write */
  function settleMsg(res, okMsg, queuedMsg){
    if(res === 'denied') return { ok:false, msg:'NOT saved — the server refused this write. Check your connection and sign-in, then try again.' };
    if(res === 'queued') return { ok:true,  msg: queuedMsg || 'Saved offline — will sync' };
    return { ok:true, msg: okMsg || 'Saved ✓' };
  }

  /* ---------- auth ---------- */
  $('#loginForm').addEventListener('submit', async e=>{
    e.preventDefault();
    $('#loginErr').hidden = true;
    try{ await signInWithEmailAndPassword(auth, $('#email').value.trim(), $('#pass').value); }
    catch(err){ $('#loginErr').textContent = 'Sign-in failed: ' + (err.code||'').replace('auth/','').replace(/-/g,' '); $('#loginErr').hidden = false; }
  });
  const EYE_ON  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  $('#passEye').addEventListener('click', ()=>{
    const p = $('#pass');
    const show = p.type === 'password';
    p.type = show ? 'text' : 'password';
    $('#passEye').innerHTML = show ? EYE_OFF : EYE_ON;
    $('#passEye').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    p.focus();
  });
  $('#forgotPw').addEventListener('click', async ()=>{
    const email = $('#email').value.trim();
    if(!email){ toast('Type your email above first'); $('#email').focus(); return; }
    try{ await sendPasswordResetEmail(auth, email); toast('Password reset link sent to ' + email); }
    catch(err){ toast('Could not send: ' + (err.code||'').replace('auth/','').replace(/-/g,' ')); }
  });
  const updNet = ()=>{ $('#netDot').hidden = navigator.onLine; };
  window.addEventListener('online',  ()=>{ updNet(); toast('Back online — syncing'); });
  window.addEventListener('offline', ()=>{ updNet(); toast('Offline — changes will sync when signal returns'); });
  updNet();
  /* a 40px button 8px from the Config toggle, in the corner the thumb crosses
     to reach it — one mis-tap signed the owner out mid-task */
  $('#logoutBtn').addEventListener('click', async ()=>{
    if(await confirmDialog({ title:'Log out?', body:'You will need your email and password to get back in.',
                             confirmText:'Log out', danger:false })) signOut(auth);
  });

  /* ============================================================
     WHO CAN OPEN THIS PANEL
     ------------------------------------------------------------
     The gate used to be `if(user)` — ANY account in the Firebase project got
     the full owner console. A wedding client who signs in at /client/ with
     Google shares the same origin and auth session. Whether they could read
     the DATA depended only on the Firestore console rules.

     >>> PUT THE EMAIL YOU SIGN IN WITH HERE. <<<
     While this list is EMPTY the gate stays OFF and behaves exactly as before,
     so shipping this can never lock anyone out — it just shows a warning.
     A Firebase custom claim `admin: true` also works and takes precedence.
     ============================================================ */
  const ADMIN_EMAILS = [
    'fantasystudio4@gmail.com',
  ];

  async function isAdmin(user){
    if(!ADMIN_EMAILS.length) return true;          // gate not configured yet
    const email = String(user.email||'').trim().toLowerCase();
    if(ADMIN_EMAILS.some(e=>String(e).trim().toLowerCase() === email)) return true;
    /* Claim check is a network call on a cold token. If it throws we must NOT
       lock the owner out on a train — fall back to the email list, which is
       already satisfied above, so reaching here means genuinely not an admin. */
    try{
      const tok = await user.getIdTokenResult();
      return tok && tok.claims && tok.claims.admin === true;
    }catch(e){ return false; }
  }

  onAuthStateChanged(auth, async user=>{
    if(!user && _leadsUnsub){ try{ _leadsUnsub(); }catch(e){} _leadsUnsub = null; _leadsInit = false; }
    if(!user && _pkgsUnsub){ try{ _pkgsUnsub(); }catch(e){} _pkgsUnsub = null; }
    if(!user && _teamUnsub){ try{ _teamUnsub(); }catch(e){} _teamUnsub = null; }
    if(!user && _asgsUnsub){ try{ _asgsUnsub(); }catch(e){} _asgsUnsub = null; }
    if(!user && _reqsUnsub){ try{ _reqsUnsub(); }catch(e){} _reqsUnsub = null; }
    if(!user && _studiosUnsub){ try{ _studiosUnsub(); }catch(e){} _studiosUnsub = null; }

    if(user && !(await isAdmin(user))){
      $('#loginView').hidden = false; $('#appView').hidden = true; $('#hdr').hidden = true;
      /* Name the rejected account. If the allowlist ever has a typo, this screen
         tells the owner exactly which address to add instead of leaving them
         locked out of their own panel with no clue why. */
      $('#loginErr').textContent = 'This account'
        + (user.email ? ' (' + user.email + ')' : '')
        + ' is not authorised to open the admin panel.';
      $('#loginErr').hidden = false;
      try{ await signOut(auth); }catch(e){}
      return;
    }

    $('#loginView').hidden = !!user;
    $('#appView').hidden = !user;
    $('#hdr').hidden = !user;
    syncHdrH();   /* the header has no height until it is on screen */
    if(user){
      if(!ADMIN_EMAILS.length){
        toast('Admin lock is not configured — any signed-in account can open this panel. See ADMIN_EMAILS in admin/index.html.');
      }
      loadLeads(); loadConfig(); loadPkgs(); loadTeam(); loadStudios(); loadExps();
      import('./pdf-template.js').catch(()=>{});   /* pre-warm so Send ▷ shares within the tap's activation window */
      const fromHash = TAB_OF_VIEW[(location.hash||'').replace('#','')] || 'tabHome';
      showTab(fromHash);
      try{ history.replaceState({view: VIEW_OF_TAB[fromHash]}, '', '#' + VIEW_OF_TAB[fromHash]); }catch(e){}
    }
  });

  /* ---------- install-to-app-list ---------- */
  const installBtn = $('#installBtn');
  function refreshInstallBtn(){
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    installBtn.hidden = standalone || (!window.__bipEvent && !isIOS);
  }
  installBtn.addEventListener('click', async ()=>{
    if(window.__bipEvent){
      const ev = window.__bipEvent; window.__bipEvent = null;
      ev.prompt();
      try{ await ev.userChoice; }catch(e){}
      refreshInstallBtn();
    }else if(/iphone|ipad|ipod/i.test(navigator.userAgent)){
      toast('Tap Share \u2b06 then \u201cAdd to Home Screen\u201d');
    }else{
      toast('Browser menu \u2192 Install app / Add to Home screen');
    }
  });
  window.addEventListener('bip-ready', refreshInstallBtn);
  window.addEventListener('appinstalled', ()=>{ installBtn.hidden = true; toast('FS Admin installed \u2713'); });
  refreshInstallBtn();

  /* the Team section bar parks directly under the header \u2014 measure it instead
     of guessing, so a notch or a wrapped title can never hide it */
  function syncHdrH(){
    const h = $('#hdr'); if(!h) return;
    const px = Math.round(h.getBoundingClientRect().height);
    if(px > 0) document.documentElement.style.setProperty('--hdr-h', px + 'px');
  }
  addEventListener('resize', syncHdrH);
  addEventListener('orientationchange', syncHdrH);
  syncHdrH();

  /* ---------- tabs ---------- */
  const TABS = { tabHome:'homeView', tabLeads:'leadsView', tabPkgs:'pkgView', tabCal:'calView', tabTeam:'teamView', tabConfig:'configView' };
  const VIEW_OF_TAB = { tabHome:'home', tabPkgs:'packages', tabLeads:'leads', tabCal:'b2b', tabTeam:'team', tabConfig:'config' };
  const TAB_OF_VIEW = { home:'tabHome', packages:'tabPkgs', leads:'tabLeads', b2b:'tabCal', calendar:'tabHome', team:'tabTeam', config:'tabConfig' };
  let _navFromPop = false;
  /* Sheet/modal history states. Pushing a new state while one of these is
     current (e.g. event sheet → ＋ Payment) used to strand the sheet's entry
     in history, costing dead back-presses that dumped the user on Home.
     pushView REPLACES a modal entry instead of stacking on top of it. */
  const MODAL_VIEWS = ['pay','stsheet','tmsheet','assheet','fin','ev','uplist','qa','stusheet','jt','crewpay'];
  function pushView(view, hash, replace){
    if(_navFromPop) return;
    try{
      const cur = history.state && history.state.view;
      if(cur === view) return;                       /* re-tapping the tab you're on must not stack dead entries */
      if(replace || MODAL_VIEWS.includes(cur)) history.replaceState({view}, '', hash);
      else history.pushState({view}, '', hash);
    }catch(e){}
  }
  /* One gate for "may I throw away what's in the builder?" — every caller that
     navigates away from an open editor must ask FIRST. Several of them used to
     navigate and only then let the tab handler prompt, so answering Cancel
     still lost the quote. */
  function canLeaveEditor(){
    if($('#pkgEditView').hidden) return true;
    if(typeof pkgDirty === 'function' && pkgDirty() && !confirm('Discard unsaved changes?')) return false;
    closeEditorSilently();
    return true;
  }
  /* Opening the editor jumps to the top of the page; closing it used to LEAVE
     you at the top — card 40 of the season list, edit, back, and you were at
     card 1 scrolling down again. Both closers put the list back where it was. */
  let _pkgListScrollY = 0;
  function closeEditorSilently(){
    _pkgBaseline = '';
    $('#pkgEditView').hidden = true; $('#pkgListView').hidden = false;
    const y = _pkgListScrollY, token = ++_scrollToken;
    requestAnimationFrame(()=>{ if(token === _scrollToken) window.scrollTo(0, y); });
  }
  /* history.back() is asynchronous, so a double tap on a ✕ (or an impatient
     tap on ✕ then the backdrop) fired it twice and jumped back two entries.
     One in-flight back at a time. */
  let _backPending = false;
  function backFrom(view, closeUI){
    if(_backPending) return;
    if(history.state && history.state.view === view){
      _backPending = true;
      setTimeout(()=>{ _backPending = false; }, 800);
      history.back();
    }else if(typeof closeUI === 'function') closeUI();
  }

  /* ---------- sheet chrome: scroll lock, focus trap, focus return ----------
     Eleven sheets declare role="dialog" aria-modal="true" and none of them
     behaved like one: the page scrolled behind them, Tab walked straight out
     into the list underneath, and closing one left focus on <body> so the next
     Tab started from the top of the page.
     Driven by an observer on the sheets' own class instead of ~25 open/close
     call sites, so a sheet added later gets this for free. */
  let _lockY = 0, _focusReturn = null;
  const anySheetOpen = () => !!document.querySelector('.pay-modal.open');
  function syncSheetChrome(){
    const open = anySheetOpen();
    const locked = document.documentElement.classList.contains('modal-open');
    if(open === locked) return;
    if(open){
      _focusReturn = document.activeElement;
      _lockY = window.scrollY;
      document.body.style.top = (-_lockY) + 'px';
      document.documentElement.classList.add('modal-open');
    }else{
      document.documentElement.classList.remove('modal-open');
      document.body.style.top = '';
      window.scrollTo(0, _lockY);
      /* the list that opened the sheet is rebuilt by live snapshots, so the
         element that had focus may not exist any more */
      if(_focusReturn && _focusReturn.isConnected){
        try{ _focusReturn.focus({ preventScroll: true }); }catch(e){}
      }
      _focusReturn = null;
    }
  }
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  document.addEventListener('keydown', e=>{
    if(e.key !== 'Tab') return;
    const m = document.querySelector('.pay-modal.open'); if(!m) return;
    const f = [...m.querySelectorAll(FOCUSABLE)].filter(el=>!el.hidden && el.offsetParent !== null);
    if(!f.length) return;
    const first = f[0], last = f[f.length-1], inside = m.contains(document.activeElement);
    if(e.shiftKey ? (!inside || document.activeElement === first) : (!inside || document.activeElement === last)){
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  });
  (function(){
    const obs = new MutationObserver(syncSheetChrome);
    $$('.pay-modal').forEach(m=>obs.observe(m, { attributes:true, attributeFilter:['class'] }));
  })();
  /* Switching tabs kept the previous tab's scroll offset, so arriving at a tab
     part-way down the page was routine. Remember each tab's own position. */
  let _tabScroll = {}, _curTab = null;
  function showTab(id){
    if(_curTab && _curTab !== id) _tabScroll[_curTab] = window.scrollY;
    Object.keys(TABS).forEach(t=>{ $('#'+t).classList.toggle('on', t===id); $('#'+TABS[t]).hidden = (t!==id); });
    /* the quick add-event form is MOVED between Home and the B2B page —
       leaving the page it is sitting on closes it rather than stranding it */
    if(typeof closeCalAdd === 'function' && id !== (_qeAnchor === 'b2b' ? 'tabCal' : 'tabHome')) closeCalAdd();
    /* selection is a Leads-tab mode — carrying it to another tab would leave a
       bulk bar on screen acting on a list that is no longer in front of you */
    if(id !== 'tabLeads' && typeof setBulk === 'function' && _bulkOn) setBulk(false);
    if(typeof syncFabs === 'function') syncFabs();   /* after the views are toggled */
    if(id === 'tabCal' && typeof renderB2B === 'function') renderB2B();
    if(id === 'tabTeam' && typeof renderTeam === 'function') renderTeam();
    if(id === 'tabHome'){
      if(typeof renderHome === 'function') renderHome();
      if(typeof renderCalendar === 'function') renderCalendar();   /* the calendar lives on Home now */
    }
    if(_curTab !== id){
      _curTab = id;
      /* An explicit scrollTo(0,0) from openPkgEdit / openStudioDetail used to
         be undone by this restore firing a frame later, so those pages opened
         part-way down. A token lets the newer intent win. */
      const token = ++_scrollToken;
      requestAnimationFrame(()=>{ if(token === _scrollToken) window.scrollTo(0, _tabScroll[id] || 0); });
    }
  }
  let _scrollToken = 0;
  const scrollTopNow = () => { _scrollToken++; window.scrollTo(0,0); };
  Object.keys(TABS).forEach(id=>{
    $('#'+id).addEventListener('click', ()=>{
      /* Tapping Packages while the editor was open just re-showed the editor,
         so there was no way back to the list from the bottom nav — the owner
         had to use the phone's back gesture. Tapping the tab you are already
         on now means "take me to the list". */
      const leavingEditor = !$('#pkgEditView').hidden;
      if(leavingEditor && !canLeaveEditor()) return;
      /* a tab switch closes the quick-add form — with dates BANKED on it that
         silently threw away a whole wedding's queue. Ask first, like the
         editor does. (The popstate path stays silent, same as the editor.) */
      if(_qeQueue.length && id !== (_qeAnchor === 'b2b' ? 'tabCal' : 'tabHome')
         && !confirm(`Leave this page? The ${_qeQueue.length} date${_qeQueue.length>1?'s':''} banked on the add-event form will be discarded.`)) return;
      /* tapping B2B while a studio detail is open = back to the studio list */
      const leavingStudio = !$('#studioDetailView').hidden;
      if(id === 'tabCal' && leavingStudio && typeof closeStudioDetail === 'function') closeStudioDetail();
      /* re-tapping the tab you are on = back to its top — the pattern every
         phone app uses; there was no other way up a long list one-handed */
      if(id === _curTab && !leavingEditor && !leavingStudio){
        _tabScroll[id] = 0;
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      showTab(id);
      /* the editor / studio detail we just closed owns the current history
         entry — REPLACE it, or the back button resurrects a closed page */
      const cur = history.state && history.state.view;
      const replace = (leavingEditor && cur === 'pkgedit') || (leavingStudio && cur === 'studio');
      pushView(VIEW_OF_TAB[id], '#' + VIEW_OF_TAB[id], replace);
    });
  });
  /* phone back button navigates within the app instead of exiting */
  window.addEventListener('popstate', e=>{
    _navFromPop = true;
    try{
      const v = (e.state && e.state.view) || 'home';
      /* Sheets close FIRST and unconditionally — an early return further down
         used to leave a sheet on screen with its history entry already gone. */
      if(typeof closePayUI === 'function') closePayUI();
      if(typeof closeStatusUI === 'function') closeStatusUI();
      if(typeof closeTmUI === 'function') closeTmUI();
      if(typeof closeAsUI === 'function') closeAsUI();
      if(typeof closeFinUI === 'function') closeFinUI();
      if(typeof closeEvUI === 'function') closeEvUI();
      if(typeof closeUpUI === 'function') closeUpUI();
      if(typeof closeQaUI === 'function') closeQaUI();
      if(typeof closeStuUI === 'function') closeStuUI();
      if(typeof closeJtUI === 'function') closeJtUI();
      if(typeof closeCrewPayUI === 'function') closeCrewPayUI();
      /* Close the editor honestly: prompt ONLY when the form is genuinely
         dirty AND actually on screen. Closing a Home sheet must never raise
         "Discard unsaved changes?" for an editor parked on another tab —
         that one is dismissed silently instead. */
      if(v !== 'pkgedit' && !$('#pkgEditView').hidden){
        const onScreen = !$('#pkgView').hidden;
        if(onScreen && typeof pkgDirty === 'function' && pkgDirty() && !confirm('Discard unsaved changes?')){
          try{ history.pushState({view:'pkgedit'}, '', '#packages/edit'); }catch(e2){}
          return;
        }
        closeEditorSilently();
      }
      /* landing on a sheet's own entry (forward button / stray entry): the
         sheets are closed above — stay on the current tab instead of
         teleporting to Home */
      if(MODAL_VIEWS.includes(v)) return;
      if(v === 'pkgedit'){
        showTab('tabPkgs');
        $('#pkgListView').hidden = true; $('#pkgEditView').hidden = false;
      }else if(v === 'studio'){
        showTab('tabCal');
        if(_stuDetailId){ $('#studioListView').hidden = true; $('#studioDetailView').hidden = false; syncFabs(); }
      }else{
        const tab = TAB_OF_VIEW[v] || 'tabHome';
        showTab(tab);
        if(tab === 'tabPkgs'){ $('#pkgEditView').hidden = true; $('#pkgListView').hidden = false; }
        if(tab === 'tabCal' && typeof closeStudioDetail === 'function') closeStudioDetail();
      }
    }finally{ _navFromPop = false; }
  });

  /* ---------- leads ---------- */
  let LEADS = [];
  let _leadsUnsub = null, _leadsInit = false, _seenBefore = 0;
  let _leadsFresh = false, _pkgsFresh = false;   /* true once a server (non-cache) snapshot has arrived */
  /* true once ANY snapshot has arrived (cache or server). renderHome() runs
     synchronously at boot, before either listener has fired, so the panel used
     to greet the owner with "No booked packages yet" and ₹0 on every cold
     start — indistinguishable from genuinely having no work. */
  let _leadsLoaded = false, _pkgsLoaded = false;
  /* Hard caps on the live snapshots. These used to be 300/500 with no signal:
     past that point the oldest records simply vanished from the panel — not in
     the list, not findable by the search box (which filters the in-memory array
     only). Backup/Export runs its own uncapped query, so nothing was ever lost
     from the database itself. Raised, and now the owner is told when the cap is
     reached instead of quietly seeing a partial list. */
  const LEADS_CAP = 1000, PKGS_CAP = 1000;
  let _capWarned = {};
  function warnIfCapped(kind, n, cap){
    if(n < cap || _capWarned[kind]) return;
    _capWarned[kind] = true;
    toast(`Showing the ${cap} most recent ${kind}. Older ones exist — use Backup & Export to see them all.`);
  }
  function loadLeads(){
    if(_leadsUnsub){ renderLeads(); return; }
    try{ _seenBefore = Number(localStorage.getItem('fs_leads_seen'))||0; localStorage.setItem('fs_leads_seen', String(Date.now())); }catch(e){}
    try{
      _leadsUnsub = onSnapshot(query(collection(db,'leads'), orderBy('createdAt','desc'), limit(LEADS_CAP)), snap=>{
        const prevIds = new Set(LEADS.map(l=>l.id));
        LEADS = snap.docs.map(d=>({ id:d.id, ...d.data() }));
        warnIfCapped('leads', snap.size, LEADS_CAP);
        _leadsLoaded = true;
        if(!snap.metadata.fromCache) _leadsFresh = true;
        if(_leadsInit){
          const fresh = LEADS.filter(l=>!prevIds.has(l.id));
          if(fresh.length) toast(`🔔 New lead: ${fresh[0].name||'someone'}${fresh.length>1 ? ' +' + (fresh.length-1) + ' more' : ''}`);
        }
        _leadsInit = true;
        renderStats(); renderLeads(); renderCalendar(); renderHome(); renderTrash();
      }, err=>{
        try{ if(_leadsUnsub) _leadsUnsub(); }catch(e){}
        _leadsUnsub = null; _leadsInit = false;   /* let ↻ Refresh resubscribe */
        $('#leadList').innerHTML = errBox('Could not load leads (' + (err.code||err.message) + ')', 'leads');
      });
    }catch(err){ $('#leadList').innerHTML = `<div class="empty">Could not load leads (${esc(err.code||err.message)})</div>`; }
  }
  $('#refreshBtn').addEventListener('click', loadLeads);
  let leadFilterVal = viewGet('leadF');
  /* ---------------------------------------------------------- bulk actions
     Selection lives in a Set of ids, never in the DOM: the leads list is a
     live snapshot and rebuilds itself under you, so a checked box in the
     markup would be wiped by the next write anyone makes. Ids survive that. */
  let _bulkOn = false, _bulkSel = new Set();
  const bulkRows = () => LEADS.filter(l=>_bulkSel.has(l.id) && !l.deleted);
  function renderLeadChips(){
    const live = LEADS.filter(l=>!l.deleted);
    const counts = {}; STATUSES.forEach(s=>counts[s]=0);
    live.forEach(l=>{ const s=l.status||'new'; counts[s]=(counts[s]||0)+1; });
    const wkN = leadsThisWeek().length;
    $('#leadChips').innerHTML = [['','All',live.length],
        ...(wkN ? [['week','🆕 This week',wkN]] : []),
        ...STATUSES.map(s=>[s, s[0].toUpperCase()+s.slice(1), counts[s]||0])]
      .map(([v,lab,n])=>`<button data-f="${v}" class="${leadFilterVal===v?'on':''}">${lab}<b>${n}</b></button>`).join('');
  }
  $('#leadChips').addEventListener('click', e=>{
    const b = e.target.closest('button[data-f]'); if(!b) return;
    leadFilterVal = b.dataset.f; viewSet('leadF', leadFilterVal); renderStats(); renderLeads();
  });

  const liveLeads = () => LEADS.filter(l=>!l.deleted);
  function renderStats(){
    const counts = {}; STATUSES.forEach(s=>counts[s]=0);
    const mStart = new Date(); mStart.setDate(1); mStart.setHours(0,0,0,0);
    let monthTotal = 0, monthCount = 0;
    liveLeads().forEach(l=>{
      counts[l.status||'new'] = (counts[l.status||'new']||0)+1;
      const ts = l.createdAt && l.createdAt.toDate ? l.createdAt.toDate() : null;
      if(ts && ts >= mStart && l.grandTotal){ monthTotal += Number(l.grandTotal)||0; monthCount++; }
    });
    /* Only the money tile. The seven status tiles that used to sit under it
       printed exactly the counts the filter chips print two rows below, and
       both filtered the list on tap — the same control twice, costing ~380px
       before a single lead was on screen. The chips win: they are one line,
       they scroll sideways, and they show which filter is active. */
    $('#stats').innerHTML =
      `<div class="stat month"><b>${inr(monthTotal)}</b><span>${monthCount} quote${monthCount===1?'':'s'} this month</span></div>`;
    const badge = $('#leadsBadge');
    if(badge){ badge.hidden = !counts.new; badge.textContent = counts.new || ''; }
  }

  function renderLeads(){
    renderLeadChips();
    /* Live snapshots re-render this list at any moment — a new lead arriving
       must not collapse the card the owner is reading or erase a half-typed
       note. Capture open cards, unsaved note drafts and the caret; restore
       them after the rebuild. */
    const _open = new Set($$('#leadList .lead').filter(c=>{ const d=c.querySelector('.lead-det'); return d && !d.hidden; }).map(c=>c.dataset.id));
    const _drafts = {};
    $$('#leadList .lead [data-notes]').forEach(t=>{ const c=t.closest('.lead'); if(c) _drafts[c.dataset.id] = t.value; });
    const _ae = document.activeElement;
    const _focusCard = (_ae && _ae.matches && _ae.matches('#leadList [data-notes]')) ? _ae.closest('.lead') : null;
    const _focusId = _focusCard ? _focusCard.dataset.id : null;
    const _caret = _focusId ? _ae.selectionStart : 0;
    const _restore = ()=>{
      $$('#leadList .lead').forEach(c=>{
        const id = c.dataset.id;
        if(_open.has(id)){ const d=c.querySelector('.lead-det'); if(d) d.hidden = false; }
        if(id in _drafts){
          const t = c.querySelector('[data-notes]');
          if(t && t.value !== _drafts[id]) t.value = _drafts[id];
        }
      });
      if(_focusId){
        const t = document.querySelector(`#leadList .lead[data-id="${_focusId}"] [data-notes]`);
        if(t){ t.focus(); try{ t.setSelectionRange(_caret, _caret); }catch(e){} }
      }
    };
    const f = leadFilterVal;
    const q = ($('#leadSearch').value||'').trim().toLowerCase();
    /* 'week' is a pseudo-filter — when the enquiry landed, not what state it
       is in. The Dashboard's "new leads" tile lands here. */
    const _wkCut = Date.now() - 7*864e5;
    const list = LEADS.filter(l=>!l.deleted
      && (!f || (f === 'week'
            ? (l.createdAt && l.createdAt.toDate && l.createdAt.toDate().getTime() >= _wkCut)
            : (l.status||'new')===f))
      && (!q || String(l.name||'').toLowerCase().includes(q) || String(l.phone||'').includes(q)
          || String(l.eventType||'').toLowerCase().includes(q)));
    /* The same person enquiring twice arrived as two unrelated cards — the
       website has no idea it has seen them before, so the owner re-quoted a
       client they were already talking to. Group the live leads by number
       (last 10 digits, so a +91 form and a bare one are one person) and let
       each card say it is not the first. LEADS is newest-first, so index 0 is
       the latest enquiry. */
    _leadDups = {};
    LEADS.filter(l=>!l.deleted).forEach(l=>{
      const p = normPhone(l.phone);
      if(p.length === 10) (_leadDups[p] = _leadDups[p] || []).push(l);
    });
    if(!list.length){
      /* Three different nothings, three different answers. "Still loading",
         "your filter hides them all" and "there are genuinely none" used to
         look identical, so the owner tapped Refresh at a filter that was
         doing exactly what it was told. Each one now names the way out. */
      const filtered = !!(f || q);
      $('#leadList').innerHTML = !_leadsLoaded
        ? '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>'
        : filtered
        ? `<div class="empty-state">
             <span class="empty-state__icon">🔍</span>
             <p class="empty-state__title">No leads match</p>
             <p class="empty-state__text">${q ? `Nothing for “${esc(q)}”` : 'Nothing'}${f ? ` under <b>${esc(f === 'week' ? 'this week' : f)}</b>` : ''}. There ${liveLeads().length===1?'is':'are'} ${liveLeads().length} lead${liveLeads().length===1?'':'s'} in total.</p>
             <button type="button" class="btn btn--ghost" data-clear-filter>Clear filter &amp; search</button>
           </div>`
        : `<div class="empty-state">
             <span class="empty-state__icon">👥</span>
             <p class="empty-state__title">No leads yet</p>
             <p class="empty-state__text">Enquiries from the website arrive here on their own — there is nothing to add by hand.</p>
             <button type="button" class="btn btn--ghost" data-refresh-leads>↻ Check again</button>
           </div>`;
      return;
    }
    /* a lead trashed elsewhere (or by this very bar) must not stay selected —
       it would keep inflating the count and get written to on the next action */
    if(_bulkOn && _bulkSel.size){
      const alive = new Set(LEADS.filter(l=>!l.deleted).map(l=>l.id));
      [..._bulkSel].forEach(id=>{ if(!alive.has(id)) _bulkSel.delete(id); });
    }
    $('#leadList').innerHTML = list.map(l=>{
      const ts = l.createdAt && l.createdAt.toDate ? l.createdAt.toDate() : null;
      const when = ts ? ts.toLocaleDateString('en-IN',{day:'numeric',month:'short'}) + ' ' + ts.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}) : '—';
      const sib = leadSiblings(l);
      const st = l.status||'new', state = stateOf(st);
      /* Meta is ordered by what matters at a venue, because it truncates from
         the tail on a narrow screen: the shoot date first, then where the
         enquiry came from and when it landed. Losing "· enquiry · 12 Aug" to
         an ellipsis costs nothing; losing the wedding date would cost a call.
         The quote shares this line, so it goes out short (₹2.45L) — the full
         figure is the title attribute and is spelled out in the open card.
         At 375px the exact figure ate the year off the shoot date, and
         "22 Nov 202…" is a worse thing to show than "₹2.45L". */
      const meta = [
        l.weddingDate ? '💍 ' + esc(dmy(l.weddingDate)) : '',
        esc(l.source==='contact_form' ? 'enquiry' : 'builder'),
        esc(when)
      ].filter(Boolean).join(' · ');
      /* .lead and .lead-det stay on the element only because the open-card /
         note-draft / caret restore above finds cards by those names. They
         carry no styling any more — everything visual is .card, .card__toggle,
         .btn and .chip-select from ui.css.
         The status <select> is a SIBLING of the toggle button, never a child:
         a control inside a button is invalid, and the button swallows its taps. */
      return `
      <article class="card lead${_bulkOn && _bulkSel.has(l.id) ? ' picked' : ''}" data-id="${l.id}" data-state="${state}">
        <div class="card__head">
          ${_bulkOn ? `<span class="pickbox"><input type="checkbox" data-pick aria-label="Select ${esc(l.name||'this lead')}"${_bulkSel.has(l.id)?' checked':''} /></span>` : ''}
          <button type="button" class="card__toggle" data-toggle aria-expanded="false" aria-controls="ld-${l.id}">
            <span class="l1">
              <span class="card__title">${esc(l.name||'—')}</span>
              ${(l.createdAt && l.createdAt.toDate && l.createdAt.toDate().getTime() > _seenBefore) ? '<span class="newb">NEW</span>' : ''}
              ${sib.length ? `<span class="dupb" title="This number has ${sib.length + 1} enquiries — open the card to see the others">↩ ${sib.length + 1}×</span>` : ''}
            </span>
            <span class="l2">
              <span class="card__meta">${meta}</span>
              ${l.grandTotal ? `<span class="card__amt" title="${inr(l.grandTotal)}">${inrShort(l.grandTotal)}</span>` : ''}
            </span>
            <span class="chev" aria-hidden="true">›</span>
          </button>
          <span class="card__side">
            <select class="chip-select" data-status data-state="${state}" aria-label="Status for ${esc(l.name||'this lead')}">
              ${STATUSES.map(x=>`<option value="${x}" ${st===x?'selected':''}>${x}</option>`).join('')}
            </select>
          </span>
        </div>
        <div class="card__actions">
          <a class="btn btn--sm btn--ghost" href="tel:+91${esc(l.phone||'')}" aria-label="Call ${esc(l.name||'this lead')}">📞 Call</a>
          <a class="btn btn--sm btn--ghost" href="https://wa.me/${esc(l.phoneFull || ('91' + String(l.phone||'')))}" target="_blank" rel="noopener" aria-label="WhatsApp ${esc(l.name||'this lead')}">💬 WhatsApp</a>
          <button type="button" class="btn btn--sm btn--danger" data-del-lead>Delete</button>
        </div>
        <div class="card__body lead-det" id="ld-${l.id}" hidden>${leadDetailHTML(l)}</div>
      </article>`;
    }).join('');
    _restore();
    if(_bulkOn) renderBulkBar();
  }

  function setBulk(on){
    _bulkOn = on;
    if(!on) _bulkSel.clear();
    const b = $('#leadPick');
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    renderLeads(); renderBulkBar();
  }
  $('#leadPick').addEventListener('click', ()=>setBulk(!_bulkOn));

  function renderBulkBar(){
    const bar = $('#bulkBar');
    if(!_bulkOn){ bar.hidden = true; bar.innerHTML = ''; document.body.classList.remove('has-bulk'); return; }
    const n = _bulkSel.size;
    /* "select all" means everything the current filter is showing, not every
       lead that exists — the visible list is what the owner is reasoning about */
    const shown = $$('#leadList .lead').map(c=>c.dataset.id);
    const allShown = shown.length > 0 && shown.every(id=>_bulkSel.has(id));
    bar.hidden = false;
    document.body.classList.add('has-bulk');
    bar.innerHTML = `
      <div class="bulk-in">
        <button type="button" class="btn btn--sm btn--quiet" data-bulk-all>${allShown ? 'Clear all' : `All ${shown.length}`}</button>
        <b class="bulk-n">${n} selected</b>
        <div class="bulk-acts">
          <select class="chip-select" data-bulk-status aria-label="Set status on selected"${n?'':' disabled'}>
            <option value="">Status…</option>
            ${STATUSES.map(x=>`<option value="${x}">${x}</option>`).join('')}
          </select>
          <button type="button" class="btn btn--sm btn--ghost" data-bulk-csv${n?'':' disabled'}>Export</button>
          <button type="button" class="btn btn--sm btn--danger" data-bulk-del${n?'':' disabled'}>Trash</button>
        </div>
        <button type="button" class="icon-btn" data-bulk-off aria-label="Leave selection mode">&times;</button>
      </div>`;
  }

  /* One write per row, settled individually. A partial failure is reported as
     a partial failure — telling the owner "12 updated" when the server refused
     four of them is the panel lying about their own data. */
  async function bulkWrite(rows, patch, verb){
    let ok = 0, bad = 0;
    const res = await Promise.allSettled(rows.map(l=>settle(updateDoc(doc(db,'leads',l.id), patch))));
    res.forEach((r,i)=>{
      if(r.status === 'fulfilled' && r.value !== 'denied'){ ok++; Object.assign(rows[i], patch); }
      else bad++;
    });
    renderStats(); renderLeads(); renderTrash(); renderBulkBar();
    toast(bad ? `${ok} ${verb}, ${bad} refused by the server` : `${ok} ${verb}`);
    return { ok, bad };
  }

  $('#bulkBar').addEventListener('click', async e=>{
    if(e.target.closest('[data-bulk-off]')){ setBulk(false); return; }
    if(e.target.closest('[data-bulk-all]')){
      const shown = $$('#leadList .lead').map(c=>c.dataset.id);
      const allShown = shown.length > 0 && shown.every(id=>_bulkSel.has(id));
      if(allShown) _bulkSel.clear(); else shown.forEach(id=>_bulkSel.add(id));
      renderLeads(); renderBulkBar();
      return;
    }
    if(e.target.closest('[data-bulk-csv]')){
      const rows = bulkRows(); if(!rows.length) return;
      const out = [['Created','Name','Phone','Source','Status','Events','WeddingDate','QuoteTotal','Message','Notes']];
      rows.forEach(l=>out.push([tsDate(l.createdAt), l.name||'', l.phone||'', l.source||'', l.status||'new',
        l.eventType||'', l.weddingDate||'', l.grandTotal||'', l.message||'', l.notes||'']));
      dl(`leads-selected-${stamp()}.csv`, csvEnc(out), 'text/csv');
      toast(`${rows.length} lead${rows.length===1?'':'s'} exported`);
      return;
    }
    if(e.target.closest('[data-bulk-del]')){
      const rows = bulkRows(); if(!rows.length) return;
      if(!await confirmDialog({
        title:`Move ${rows.length} lead${rows.length===1?'':'s'} to Trash?`,
        body: rows.length <= 5
          ? rows.map(l=>`<b>${esc(l.name||'—')}</b>`).join(', ') + ' leave the list. Nothing is erased — you can restore from Trash.'
          : `<b>${rows.length} leads</b> leave the list. Nothing is erased — you can restore them from Trash.`,
        confirmText:`Move ${rows.length} to Trash`
      })) return;
      await bulkWrite(rows, { deleted:true, deletedAt: todayISO() }, 'moved to Trash');
      setBulk(false);
      return;
    }
  });
  $('#bulkBar').addEventListener('change', async e=>{
    const sel = e.target.closest('[data-bulk-status]'); if(!sel || !sel.value) return;
    const rows = bulkRows(), status = sel.value;
    sel.value = '';
    if(!rows.length) return;
    if(!await confirmDialog({
      title:`Set ${rows.length} lead${rows.length===1?'':'s'} to “${status}”?`,
      body:'This changes their status only — nothing else about them moves.',
      confirmText:'Change status', danger:false
    })) return;
    await bulkWrite(rows, { status }, `set to ${status}`);
  });

  /* live leads sharing this one's number, newest first, excluding itself */
  let _leadDups = {};
  function leadSiblings(l){
    const p = normPhone(l && l.phone);
    if(p.length !== 10) return [];
    return (_leadDups[p] || []).filter(o=>o.id !== l.id);
  }

  function leadDetailHTML(l){
    let h = '';
    const sib = leadSiblings(l);
    if(sib.length){
      h += `<h4>↩ Same number, ${sib.length} other enquir${sib.length===1?'y':'ies'}</h4>`
        + sib.map(o=>{
            const ots = o.createdAt && o.createdAt.toDate ? o.createdAt.toDate() : null;
            return `<div class="ln"><span>${esc(ots ? ots.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : 'date unknown')}${o.eventType ? ' · ' + esc(o.eventType) : ''}</span>`
              + `<span>${esc(o.status||'new')}${o.grandTotal ? ' · ' + inr(o.grandTotal) : ''}</span></div>`;
          }).join('')
        + `<p class="sub" style="margin:.2rem 0 .6rem">Quote the one they are actually waiting on — a second package splits the same client's events and payments across two records.</p>`;
    }
    if(l.eventType) h += `<div class="ln"><span>Events</span><span>${esc(l.eventType)}</span></div>`;
    if(l.phone) h += `<div class="ln"><span>Phone</span><span class="telrow">
      <a href="tel:+91${esc(l.phone)}" aria-label="Call ${esc(l.name||'this lead')}">${esc(l.phone)}</a>
      <a class="icon-btn icon-btn--ring" href="https://wa.me/${esc(l.phoneFull || ('91' + String(l.phone||'')))}" target="_blank" rel="noopener" title="WhatsApp" aria-label="WhatsApp ${esc(l.name||'this lead')}">💬</a>
    </span></div>`;
    if(l.message) h += `<h4>Message</h4><div>${esc(l.message)}</div>`;
    if(l.quote && Array.isArray(l.quote.events)){
      h += '<h4>Quote breakdown</h4>';
      l.quote.events.forEach(ev=>{
        const svcs = Object.entries(ev.services||{}).filter(([,q])=>q>0)
          .map(([k,q])=>`${SERVICE_LABELS[k]||k}${q>1?' ×'+q:''}`).join(', ');
        if(svcs) h += `<div class="ln"><span>${esc(ev.type)}${ev.date?' · '+esc(dmy(ev.date)):''}</span><span>${esc(svcs)}</span></div>`;
      });
      if(l.quote.albumSheets) h += `<div class="ln"><span>Album</span><span>${l.quote.albumSheets} sheets</span></div>`;
      if(l.quote.promo) h += `<div class="ln"><span>Promo</span><span>${esc(l.quote.promo)}</span></div>`;
      h += `<div class="ln"><span><b>Grand total</b></span><span><b>${inr(l.grandTotal)}</b></span></div>`;
    }
    /* Inline date edit. weddingDate is a plain field on the lead with nothing
       downstream of it — no calendar entry, no crew, no money — so it is safe
       to change from the list. (A PACKAGE's event date is not: it moves a
       calendar entry and can strand crew, which is why that one stays in the
       editor where the stale-crew re-sync lives.)
       The dd-mm-yyyy painter in index.html picks this up on its own — it
       watches the document for new date inputs. */
    h += `<h4>Shoot date</h4>
          <input class="input" type="date" data-wdate value="${esc(l.weddingDate||'')}" aria-label="Wedding or shoot date" />`;
    h += `<h4>My notes</h4>
          <textarea class="input" data-notes rows="3" placeholder="Follow-up notes…">${esc(l.notes||'')}</textarea>
          <button type="button" class="btn btn--sm btn--ghost" data-savenotes>Save notes</button>`;
    /* this enquiry already became a package — say so, and offer the way back
       to it, instead of silently inviting a second one */
    if(l.pkgId){
      /* Leads render long before the packages listener has delivered anything
         (they are separate tabs), so an empty PKGS means "not loaded yet", NOT
         "deleted" — say deleted only once the list is genuinely in. The quote
         number stored on the lead lets the button read right either way. */
      const pk = PKGS.find(p=>p.id===l.pkgId && !p.deleted);
      const gone = _pkgsLoaded && !pk;
      h += ` <button type="button" class="btn btn--sm btn--ghost" data-openpkg${gone?' disabled':''}>${gone ? '📦 Package deleted'
              : '📦 Open ' + esc((pk && pk.quoteNo) || l.quoteNo || 'package')}</button>`;
    }
    if(l.quote && Array.isArray(l.quote.events) && l.quote.events.length){
      h += ` <button type="button" class="btn btn--sm btn--ghost" data-convert>→ ${l.pkgId ? 'Create another package' : 'Create package from this lead'}</button>`;
    }
    return h;
  }

  $('#leadList').addEventListener('click', async e=>{
    const card = e.target.closest('.lead'); if(!card) return;
    if(_bulkOn){
      const id = card.dataset.id;
      if(_bulkSel.has(id)) _bulkSel.delete(id); else _bulkSel.add(id);
      card.classList.toggle('picked', _bulkSel.has(id));
      const cb = card.querySelector('[data-pick]'); if(cb) cb.checked = _bulkSel.has(id);
      renderBulkBar();
      return;
    }
    if(e.target.closest('[data-toggle]')){
      const det = card.querySelector('.lead-det'); det.hidden = !det.hidden;
      /* the chevron and the screen-reader state read from this one attribute */
      const hd = card.querySelector('[data-toggle]');
      if(hd) hd.setAttribute('aria-expanded', String(!det.hidden));
      card.classList.toggle('is-open', !det.hidden);
      return;
    }
    if(e.target.closest('[data-clear-filter]')){
      leadFilterVal = ''; $('#leadSearch').value = '';
      viewSet('leadF',''); viewSet('leadQ','');
      renderStats(); renderLeads(); return;
    }
    if(e.target.closest('[data-refresh-leads]')){ loadLeads(); toast('Checking for new leads…'); return; }
    if(e.target.closest('[data-del-lead]')){
      const l = LEADS.find(x=>x.id===card.dataset.id);
      if(!await confirmDialog({
        title:'Move this lead to Trash?',
        body:`<b>${esc((l&&l.name)||'This lead')}</b>${l&&l.phone?' · '+esc(l.phone):''} leaves the list. Nothing is erased — you can restore it from Trash, or undo straight from the toast.`,
        confirmText:'Move to Trash'
      })) return;
      const id = card.dataset.id;
      try{
        const res = await settle(updateDoc(doc(db,'leads',id), { deleted: true, deletedAt: todayISO() }));
        if(res === 'denied'){ toast('NOT deleted — the server refused this write. Check your sign-in and try again.'); return; }
        if(l){ l.deleted = true; l.deletedAt = todayISO(); }
        renderStats(); renderLeads(); renderTrash();
        toastUndo('Lead moved to Trash', async ()=>{
          try{
            const r2 = await settle(updateDoc(doc(db,'leads',id), { deleted: deleteField(), deletedAt: deleteField() }));
            if(r2 === 'denied'){ toast('Undo failed — the server refused the write'); return; }
            if(l){ delete l.deleted; delete l.deletedAt; }
            renderStats(); renderLeads(); renderTrash();
          }catch(err){ toast('Undo failed'); }
        });
      }catch(err){ toast('Delete failed'); }
      return;
    }
    if(e.target.closest('[data-openpkg]')){
      if(!canLeaveEditor()) return;
      const l = LEADS.find(x=>x.id===card.dataset.id);
      const pk = l && PKGS.find(p=>p.id===l.pkgId && !p.deleted);
      if(!pk){ toast('That package no longer exists — check Trash'); return; }
      $('#tabPkgs').click(); openPkgEdit(pk);
      return;
    }
    if(e.target.closest('[data-convert]')){
      if(!canLeaveEditor()) return;
      const l = LEADS.find(x=>x.id===card.dataset.id);
      if(!l) return;
      /* one enquiry, one job. A second package splits the same wedding's
         events and payments across two records — the exact thing the
         lead↔package link exists to prevent. Warn on the STORED link, not on
         finding the doc: with the packages list not loaded yet, "not found"
         must not be read as "no package exists". Only a load that proves it
         was deleted lets the conversion through unquestioned. */
      if(l.pkgId){
        const already = PKGS.find(p=>p.id===l.pkgId && !p.deleted);
        const gone = _pkgsLoaded && !already;
        if(!gone && !confirm(`"${l.name||'This lead'}" already became ${(already && already.quoteNo) || l.quoteNo || 'a package'}.\n\nA second package splits their events and their payments across two records.\n\nTo add a date to the package they already have, tap Cancel and open it instead.\n\nCreate a separate package anyway?`)) return;
      }
      $('#tabPkgs').click(); openPkgEdit(pkgFromLead(l)); $('#pkgEditTitle').textContent = `New Package — from ${l.name||'lead'}`; toast('Quote loaded — check rates, then Save');
      return;
    }
    if(e.target.closest('[data-savenotes]')){
      const notes = card.querySelector('[data-notes]').value;
      /* settle() like every other write: a raw updateDoc never resolves while
         offline, so this button hung with no toast at all, and a refused write
         reported nothing */
      try{
        const sm = settleMsg(await settle(updateDoc(doc(db,'leads',card.dataset.id), { notes })), 'Notes saved');
        toast(sm.msg);
        if(!sm.ok) return;
        const l = LEADS.find(x=>x.id===card.dataset.id); if(l) l.notes = notes;
      }catch(err){ toast('Save failed'); }
    }
  });
  $('#leadList').addEventListener('change', async e=>{
    if(e.target.matches('[data-wdate]')){
      const card = e.target.closest('.lead'), v = e.target.value || '';
      const l = LEADS.find(x=>x.id===card.dataset.id);
      const prev = (l||{}).weddingDate || '';
      try{
        const sm = settleMsg(await settle(updateDoc(doc(db,'leads',card.dataset.id),
          v ? { weddingDate: v } : { weddingDate: deleteField() })), v ? 'Date saved' : 'Date cleared');
        toast(sm.msg);
        if(!sm.ok){ e.target.value = prev; return; }
        if(l){ if(v) l.weddingDate = v; else delete l.weddingDate; }
        renderLeads(); renderCalendar();
      }catch(err){ toast('Save failed'); e.target.value = prev; }
      return;
    }
    if(!e.target.matches('[data-status]')) return;
    const card = e.target.closest('.lead');
    const prev = (LEADS.find(x=>x.id===card.dataset.id)||{}).status || 'new';
    try{
      const sm = settleMsg(await settle(updateDoc(doc(db,'leads',card.dataset.id), { status: e.target.value })), 'Status updated');
      toast(sm.msg);
      /* a refused write must put the dropdown back — leaving it showing the
         status the server rejected is the panel lying about its own data */
      if(!sm.ok){ e.target.value = prev; return; }
      const l = LEADS.find(x=>x.id===card.dataset.id); if(l) l.status = e.target.value;
      /* recolour in place. A full renderLeads() here would collapse whatever
         card the owner has open and throw away an unsaved note draft. */
      const st = stateOf(e.target.value);
      e.target.dataset.state = st; card.dataset.state = st;
      renderStats();
    }catch(err){ toast('Update failed'); e.target.value = prev; }
  });

  /* ---------- config editor ---------- */
  let CFG = null;
  /* Set when config/site could not be read. Save All is blocked while true —
     otherwise the form shows hardcoded DEFAULTS that look exactly like real
     values, and one tap publishes them over the live site's pricing,
     testimonials, FAQs, presets, service rates and learned rates. */
  let _cfgLoadFailed = false;
  let _cfgLoadedAt = null;          // updatedAt seen at load, for the stale check
  function setCfgBlocked(blocked, msg){
    _cfgLoadFailed = blocked;
    const btn = $('#saveConfig'), m = $('#saveMsg');
    if(btn) btn.disabled = blocked;
    if(m){ m.textContent = msg || ''; m.style.color = blocked ? 'var(--err)' : ''; }
  }
  async function loadConfig(){
    /* Save All must stay locked until the live values are actually on screen —
       a fast first tap used to publish empty forms over the live config. */
    setCfgBlocked(true, 'Loading the live config…');
    try{
      const snap = await getDoc(doc(db,'config','site'));
      CFG = snap.exists() ? snap.data() : JSON.parse(JSON.stringify(DEFAULTS));
      _cfgLoadedAt = snap.exists() ? (snap.data().updatedAt || null) : null;
      setCfgBlocked(false, snap.exists() ? '' :
        'No saved config yet — showing current site defaults. Save All to publish them.');
    }catch(err){
      CFG = JSON.parse(JSON.stringify(DEFAULTS));
      setCfgBlocked(true,
        'Could not load the live config (' + (err.code||err.message) + '). These are built-in defaults, NOT your live values — do not save. Reconnect and reopen this tab.');
    }
    /* one-time upgrade: any earlier default checklist becomes the current flow.
       A hand-customized list is left untouched. */
    const OLD_DSTEP_SETS = [
      ['All events shot','Photos edited','Video edited','Cinematic teasers','Album designed','Album printed','Pendrive prepared','Delivered to client'],
      ['All events shot','Photos edited','Photo pendrive ready','Photo pendrive delivered','Cinematic teasers ready','Video editing details received','Video edited','Video delivered','Album selection received','Album designed','Album delivered','All delivered — package closed'],
    ].map(a=>JSON.stringify(a));
    if(Array.isArray(CFG.deliverySteps) && OLD_DSTEP_SETS.includes(JSON.stringify(CFG.deliverySteps))){
      CFG.deliverySteps = DEFAULTS.deliverySteps.slice();
      try{ setDoc(doc(db,'config','site'), { deliverySteps: CFG.deliverySteps }, { merge: true }); }catch(e){}
    }
    buildConfigForms();
  }

  function buildConfigForms(){
    const p = CFG.prices || {};
    $('#priceGrid').innerHTML = Object.keys(SERVICE_LABELS).map(k=>`
      <div class="fld"><label>${SERVICE_LABELS[k]}</label>
      <input type="number" min="0" data-price="${k}" value="${Number(p[k])||0}" /></div>`).join('');
    $('#albumPerSheet').value  = Number(p.albumPerSheet)||400;
    $('#albumMinSheets').value = Number(p.albumMinSheets)||15;
    $('#albumMaxSheets').value = Number(p.albumMaxSheets)||100;

    const rates = CFG.serviceRates || DEFAULTS.serviceRates;
    $('#rateList').innerHTML = Object.keys(rates).map(n=>rateRow(n, rates[n])).join('');
    const contact = CFG.contact || DEFAULTS.contact;
    $('#cfgPhone').value = contact.phone || '';
    $('#cfgWebsite').value = contact.website || '';
    $('#cfgUpi').value = contact.upi || '';
    $('#cfgEditDue').value = Number(CFG.editDueDays) || 21;
    $('#cfgUpiAlt').value = contact.upiAlt || '';
    const terms = CFG.quoteTerms || DEFAULTS.quoteTerms;
    $('#termList').innerHTML = terms.map(termRow).join('');
    const dsteps = (CFG.deliverySteps && CFG.deliverySteps.length) ? CFG.deliverySteps : DEFAULTS.deliverySteps;
    $('#dstepList').innerHTML = dsteps.map(dstepRow).join('');
    const bsteps = (CFG.b2bDeliverySteps && CFG.b2bDeliverySteps.length) ? CFG.b2bDeliverySteps : DEFAULTS.b2bDeliverySteps;
    $('#bstepList').innerHTML = bsteps.map(bstepRow).join('');
    $('#pkgListRM').innerHTML = Object.keys(CFG.presets||{}).map(key=>pkgRow(key, CFG.presets[key])).join('');
    refreshAllPresetChips();
    $('#testiList').innerHTML = (CFG.testimonials||[]).map(testiRow).join('');
    $('#faqList').innerHTML = (CFG.faqs||[]).map(faqRow).join('');
  }
  /* ---------- ready-made packages ----------
     These were edited as raw JSON: the one place in the panel where a missing
     brace blocked the entire Save All, and where a typo published nothing at
     all to the public site (which validates presets and silently drops a bad
     one, keeping the built-in). Same rows and quantity steppers the quotation
     builder uses instead.
     The limits mirror what the site actually accepts — qty is clamped to 50
     and the event name to 40 characters there, so accepting more here would
     just be a number the owner sets and never sees. */
  const PRESET_QTY_MAX = 50, PRESET_TYPE_MAX = 40;
  const presetSvcRow = (key, qty) => `
    <div class="itemrow psvc" data-psvc="${esc(key)}">
      <div class="l1">
        <span class="pslab">${esc(SERVICE_LABELS[key] || key)}${SERVICE_LABELS[key] ? '' : ' <em>(not a service on the site — it is ignored there)</em>'}</span>
        <button class="rm" data-rmpsvc type="button" title="Remove">✕</button>
      </div>
      <div class="l2">
        <div class="mini-f"><label>Qty</label>
          <div class="qwrap">
            <button type="button" data-pqm>−</button>
            <input data-pq type="number" min="1" max="${PRESET_QTY_MAX}" value="${Math.min(PRESET_QTY_MAX, Math.max(1, Number(qty)||1))}" />
            <button type="button" data-pqp>+</button>
          </div>
        </div>
      </div>
    </div>`;
  const presetEvRow = (ev={}) => `
    <div class="pev" data-pev>
      <button class="del" data-rmpev type="button" title="Remove this event">✕</button>
      <div class="fld"><label>Event</label>
        <input data-k="type" maxlength="${PRESET_TYPE_MAX}" value="${esc(ev.type||'')}" placeholder="e.g. NIKAH" /></div>
      <div class="evchips" data-pevchips>${EVENT_NAMES.map(n=>`<button type="button" class="qchip" data-pevname="${esc(n)}">${esc(n)}</button>`).join('')}</div>
      <div class="psvcs">${Object.entries(ev.services||{}).filter(([,q])=>Number(q)>0)
        .map(([k,q])=>presetSvcRow(k,q)).join('')}</div>
      <div class="svcchips" data-psvcchips></div>
    </div>`;
  /* one chip per site service this event does not already carry */
  function refreshPresetChips(evCard){
    const box = evCard.querySelector('[data-psvcchips]'); if(!box) return;
    const used = new Set([...evCard.querySelectorAll('[data-psvc]')].map(r=>r.dataset.psvc));
    box.innerHTML = Object.keys(SERVICE_LABELS).filter(k=>!used.has(k))
      .map(k=>`<button type="button" class="qchip" data-addpsvc="${esc(k)}">＋ ${esc(SERVICE_LABELS[k])}</button>`).join('');
  }
  const refreshAllPresetChips = () => $$('#pkgListRM [data-pev]').forEach(refreshPresetChips);
  const pkgRow = (key, p) => `
    <div class="row" data-pkg>
      <button class="del" data-del title="Remove">✕</button>
      <div class="grid2">
        <div class="fld"><label>Key (no spaces)</label><input data-k="key" value="${esc(key)}" /></div>
        <div class="fld"><label>Name</label><input data-k="name" value="${esc(p.name||'')}" /></div>
        <div class="fld"><label>Tag (optional)</label><input data-k="tag" value="${esc(p.tag||'')}" /></div>
        <div class="fld"><label>Album sheets</label><input type="number" min="0" data-k="album" value="${Number(p.album)||0}" /></div>
      </div>
      <div class="fld"><label>Description</label><input data-k="desc" value="${esc(p.desc||'')}" /></div>
      <label>Events &amp; services</label>
      <div class="pevs">${(p.events||[]).map(presetEvRow).join('')}</div>
      <button class="addrow" type="button" data-addpev>＋ Add event to this package</button>
    </div>`;
  const testiRow = (t={}) => `
    <div class="row" data-testi>
      <button class="del" data-del title="Remove">✕</button>
      <div class="grid2">
        <div class="fld"><label>Name</label><input data-k="name" value="${esc(t.name||'')}" /></div>
        <div class="fld"><label>Location</label><input data-k="location" value="${esc(t.location||'')}" /></div>
      </div>
      <div class="fld"><label>Review text</label><textarea data-k="text">${esc(t.text||'')}</textarea></div>
    </div>`;
  const faqRow = (f={}) => `
    <div class="row" data-faq>
      <button class="del" data-del title="Remove">✕</button>
      <div class="fld"><label>Question</label><input data-k="q" value="${esc(f.q||'')}" /></div>
      <div class="fld"><label>Answer</label><textarea data-k="a">${esc(f.a||'')}</textarea></div>
    </div>`;

  const rateRow = (name, rate) => `
    <div class="row" data-rate>
      <button class="del" data-del title="Remove">✕</button>
      <div class="grid2">
        <div class="fld"><label>Service name</label><input data-k="name" value="${esc(name)}" /></div>
        <div class="fld"><label>Rate (₹)</label><input data-k="rate" type="number" min="0" value="${Number(rate)||0}" /></div>
      </div>
    </div>`;
  const termRow = (t='') => `
    <div class="row" data-term>
      <button class="del" data-del title="Remove">✕</button>
      <div class="fld"><label>Term</label><input data-k="t" value="${esc(t)}" /></div>
    </div>`;
  $('#addRate').addEventListener('click', ()=>$('#rateList').insertAdjacentHTML('beforeend', rateRow('New Service', 0)));
  $('#addTerm').addEventListener('click', ()=>$('#termList').insertAdjacentHTML('beforeend', termRow('')));
  const dstepRow = (t='') => `
    <div class="row" data-dstep>
      <button class="del" data-del title="Remove">✕</button>
      <div class="fld"><label>Step</label><input data-k="t" value="${esc(t)}" /></div>
    </div>`;
  $('#addDstep').addEventListener('click', ()=>$('#dstepList').insertAdjacentHTML('beforeend', dstepRow('')));
  const bstepRow = (t='') => `
    <div class="row" data-bstep>
      <button class="del" data-del title="Remove">✕</button>
      <div class="fld"><label>Step</label><input data-k="t" value="${esc(t)}" /></div>
    </div>`;
  $('#addBstep').addEventListener('click', ()=>$('#bstepList').insertAdjacentHTML('beforeend', bstepRow('')));

  $('#addPkg').addEventListener('click', ()=>{
    $('#pkgListRM').insertAdjacentHTML('beforeend', pkgRow('newPackage', {name:'New Package', tag:'', desc:'', album:0, events:[{type:'NIKAH', services:{traditionalPhoto:1}}]}));
    refreshAllPresetChips();
  });
  /* everything inside a preset card: add/remove an event, add/remove a service,
     step a quantity, pick an event name */
  $('#pkgListRM').addEventListener('click', e=>{
    const addEv = e.target.closest('[data-addpev]');
    if(addEv){
      const box = addEv.closest('[data-pkg]').querySelector('.pevs');
      box.insertAdjacentHTML('beforeend', presetEvRow({}));
      refreshPresetChips(box.lastElementChild);
      return;
    }
    const rmEv = e.target.closest('[data-rmpev]');
    if(rmEv){ rmEv.closest('[data-pev]').remove(); return; }
    const nm = e.target.closest('[data-pevname]');
    if(nm){
      const card = nm.closest('[data-pev]');
      card.querySelector('[data-k="type"]').value = nm.dataset.pevname;
      return;
    }
    const addSvc = e.target.closest('[data-addpsvc]');
    if(addSvc){
      const card = addSvc.closest('[data-pev]');
      card.querySelector('.psvcs').insertAdjacentHTML('beforeend', presetSvcRow(addSvc.dataset.addpsvc, 1));
      refreshPresetChips(card);
      return;
    }
    const rmSvc = e.target.closest('[data-rmpsvc]');
    if(rmSvc){
      const card = rmSvc.closest('[data-pev]');
      rmSvc.closest('[data-psvc]').remove();
      refreshPresetChips(card);
      return;
    }
    const step = e.target.closest('[data-pqm]') || e.target.closest('[data-pqp]');
    if(step){
      const q = step.closest('[data-psvc]').querySelector('[data-pq]');
      const up = !!e.target.closest('[data-pqp]');
      q.value = Math.min(PRESET_QTY_MAX, Math.max(1, (Number(q.value)||1) + (up ? 1 : -1)));
    }
  });
  $('#addTesti').addEventListener('click', ()=>$('#testiList').insertAdjacentHTML('beforeend', testiRow()));
  $('#addFaq').addEventListener('click', ()=>$('#faqList').insertAdjacentHTML('beforeend', faqRow()));
  document.addEventListener('click', e=>{ if(e.target.matches('[data-del]')) e.target.closest('.row').remove(); });

  $('#saveConfig').addEventListener('click', async ()=>{
    if(_cfgLoadFailed){
      toast('Config never loaded — saving now would overwrite your live values with defaults');
      return;
    }
    try{
      const prices = {};
      $$('[data-price]').forEach(i=>{ prices[i.dataset.price] = Number(i.value)||0; });
      prices.albumPerSheet  = Number($('#albumPerSheet').value)||400;
      prices.albumMinSheets = Number($('#albumMinSheets').value)||0;
      prices.albumMaxSheets = Number($('#albumMaxSheets').value)||100;

      const presets = {};
      for(const row of $$('[data-pkg]')){
        const get = k => row.querySelector(`[data-k="${k}"]`).value;
        const key = get('key').trim().replace(/\s+/g,'');
        if(!key) continue;
        /* read the rows instead of parsing a textarea — there is no longer an
           invalid state to reject, only empty events to drop */
        const events = [...row.querySelectorAll('[data-pev]')].map(ec=>{
          const services = {};
          ec.querySelectorAll('[data-psvc]').forEach(sr=>{
            const k = sr.dataset.psvc;
            if(!k) return;
            services[k] = Math.min(PRESET_QTY_MAX, Math.max(1, Number(sr.querySelector('[data-pq]').value)||1));
          });
          return { type: ec.querySelector('[data-k="type"]').value.trim().slice(0, PRESET_TYPE_MAX), services };
        }).filter(ev=>ev.type || Object.keys(ev.services).length);
        /* the site drops a preset with nothing priceable rather than advertise
           "Package ₹0" — say so here instead of letting it vanish silently */
        if(!events.length || !events.some(ev=>Object.keys(ev.services).length) && !(Number(get('album'))||0)){
          toast(`Package "${get('name').trim() || key}" has no services and no album — give it something to price, or remove it with ✕`);
          return;
        }
        presets[key] = { name:get('name').trim(), tag:get('tag').trim(), desc:get('desc').trim(),
          album:Number(get('album'))||0, events };
      }
      const testimonials = $$('[data-testi]').map(r=>({
        name: r.querySelector('[data-k="name"]').value.trim(),
        location: r.querySelector('[data-k="location"]').value.trim(),
        text: r.querySelector('[data-k="text"]').value.trim()
      })).filter(t=>t.name || t.text);
      const faqs = $$('[data-faq]').map(r=>({
        q: r.querySelector('[data-k="q"]').value.trim(),
        a: r.querySelector('[data-k="a"]').value.trim()
      })).filter(f=>f.q && f.a);

      const serviceRates = {};
      $$('[data-rate]').forEach(r=>{
        const n = r.querySelector('[data-k="name"]').value.trim();
        if(n) serviceRates[n] = Number(r.querySelector('[data-k="rate"]').value)||0;
      });
      /* the client portal's Pay now sends to these — a typo here misdirects a
         real payment, so they are the owner's to type, never guessed */
      const contact = { phone: $('#cfgPhone').value.trim(), website: $('#cfgWebsite').value.trim(),
                        upi: $('#cfgUpi').value.trim(), upiAlt: $('#cfgUpiAlt').value.trim() };
      const quoteTerms = $$('[data-term]').map(r=>r.querySelector('[data-k="t"]').value.trim()).filter(Boolean);
      const deliverySteps = $$('[data-dstep]').map(r=>r.querySelector('[data-k="t"]').value.trim()).filter(Boolean);
      /* the write below is a full overwrite, so this has to be in the payload
         or saving any other setting would silently wipe the B2B checklist */
      const b2bDeliverySteps = $$('[data-bstep]').map(r=>r.querySelector('[data-k="t"]').value.trim()).filter(Boolean);
      /* Remembered rates used to shadow this form forever: raise a rate here
         and every new quote still prefilled the old learned one, and a service
         deleted here kept showing in the builder chips. Saving the config is
         an explicit statement of intent, so it resets what the builder
         remembers (the album rate is kept — it is not in this form). */
      const _prevLearned = (CFG && CFG.learnedRates) || {};
      const learnedRates = _prevLearned['__albumPerSheet']
        ? { __albumPerSheet: _prevLearned['__albumPerSheet'] } : {};

      /* Last-write-wins between two devices used to silently discard the other
         one's edits. Re-read first and refuse if the doc moved under us. */
      let fresh = null;
      try{ fresh = await getDoc(doc(db,'config','site')); }catch(e){ fresh = null; }
      if(fresh && fresh.exists()){
        const serverAt = fresh.data().updatedAt || null;
        if(_cfgLoadedAt && serverAt && serverAt !== _cfgLoadedAt){
          $('#saveMsg').textContent = 'Config was changed on another device since you opened this tab. Reload before saving so you do not overwrite those edits.';
          $('#saveMsg').style.color = 'var(--err)';
          toast('Not saved — config changed elsewhere. Reload first.');
          return;
        }
      }
      /* The write stays a full overwrite on purpose: merge:true never removes
         map keys or shortens arrays, so a preset/testimonial/FAQ deleted in the
         form would silently reappear on the public site. The two guards above
         (load must have succeeded, doc must not have moved) are what make a
         full overwrite safe. */

      const stamp = new Date().toISOString();
      const editDueDays = Math.min(365, Math.max(1, Number($('#cfgEditDue').value)||21));
      const payload = { prices, presets, testimonials, faqs, serviceRates, contact,
                        quoteTerms, deliverySteps, b2bDeliverySteps, learnedRates, editDueDays, updatedAt: stamp };
      /* settle() so an offline save answers instead of hanging forever, and a
         refused write is reported instead of pretending it published */
      const res = await settle(setDoc(doc(db,'config','site'), payload));
      if(res === 'denied'){
        toast('NOT saved — the server refused the config write. Check your sign-in and try again.');
        return;
      }
      CFG = { prices, presets, testimonials, faqs, serviceRates, contact, quoteTerms, deliverySteps, b2bDeliverySteps, learnedRates, editDueDays, updatedAt: stamp };
      _cfgLoadedAt = stamp;
      $('#saveMsg').style.color = '';
      $('#saveMsg').textContent = res === 'queued'
        ? 'Saved offline — it will publish the moment you are back online.'
        : 'Saved — the live site now uses these values.';
      toast(res === 'queued' ? 'Config saved offline — will publish when online' : 'Config published ✓');
      _cfgTouched = false;
    }catch(err){ toast('Save failed: ' + (err.code||err.message)); }
  });

  /* ---------- one guard for everything the browser could throw away ----------
     In-app navigation already asks before leaving a dirty builder, but a page
     refresh, a closed tab or an Android back-out took a half-written quotation,
     unsaved Config edits or a half-typed add-event form with it, silently. */
  let _cfgTouched = false;
  $('#configView').addEventListener('input', ()=>{ _cfgTouched = true; });
  function unsavedWork(){
    try{
      if(typeof pkgDirty === 'function' && pkgDirty()) return true;
      if(_cfgTouched) return true;
      /* banked multi-date events are typed work too — a reload used to throw
         away a whole wedding's queued dates without a word */
      if(typeof _qeQueue !== 'undefined' && _qeQueue.length) return true;
      const add = $('#calAdd');
      if(add && !add.hidden && ($('#qeTitle').value.trim() || $('#qeVenue').value.trim())) return true;
    }catch(e){}
    return false;
  }
  window.addEventListener('beforeunload', e=>{
    if(!unsavedWork()) return;
    e.preventDefault();
    e.returnValue = '';   /* the wording is the browser's, not ours */
  });

  /* ============================================================
     PACKAGES — private quotation builder
     ============================================================ */
  let PKGS = [];
  let editingId = null;
  let expandedPkg = null;
  let expandedHome = null;
  function nextQuoteNo(){
    const yr = new Date().getFullYear();
    const nums = PKGS.map(x=>x.quoteNo||'').filter(q=>q.startsWith('FS-'+yr+'-')).map(q=>parseInt(q.split('-')[2],10)||0);
    return 'FS-' + yr + '-' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3,'0');
  }

  const builderRates = () => (CFG && CFG.serviceRates && Object.keys(CFG.serviceRates).length ? CFG.serviceRates : DEFAULTS.serviceRates);
  /* while the builder edits a STUDIO job, the studio's negotiated rate card
     (when it has one) replaces the retail rates everywhere in the builder */
  let _bStudioId = null;
  /* the lead this package is being built from (or was built from) — written
     onto the package as leadId so the enquiry and its quotation stay one job */
  let _bLeadId = null;
  /* The quotation builder quotes at ITS studio's rates (_bStudioId). The quick
     "＋ Add an event" sheet quotes at whichever studio is picked in the sheet —
     and it can be open while _bStudioId still holds the last package edited —
     so it names the rate card it wants for the length of one render rather
     than trusting the builder's. undefined = follow the builder. */
  let _rateStudio;
  function withRates(stuId, fn){
    const prev = _rateStudio; _rateStudio = stuId;
    try{ return fn(); } finally{ _rateStudio = prev; }
  }
  /* the builder learns: every rate you actually use overrides the preset next time */
  const allRates = () => {
    const _sid = _rateStudio === undefined ? _bStudioId : _rateStudio;
    const stu = _sid ? studioById(_sid) : null;
    if(stu && stu.rateCard && Object.keys(stu.rateCard).length){
      const m = Object.assign({}, stu.rateCard);
      delete m['__albumPerSheet'];
      return m;
    }
    const m = Object.assign({}, builderRates(), (CFG && CFG.learnedRates) || {});
    delete m['__albumPerSheet'];
    return m;
  };
  const learnedAlbumRate = () => Number(((CFG && CFG.learnedRates) || {})['__albumPerSheet']) || 400;
  const pdfContact   = () => (CFG && CFG.contact) || DEFAULTS.contact;
  /* master term list = saved config terms + any newer standard terms they
     don't have yet, so upgrades surface in the picker without touching
     the saved config (untick per quote, or edit the list in Site Config) */
  const pdfTerms     = () => {
    const own = (CFG && Array.isArray(CFG.quoteTerms)) ? CFG.quoteTerms.filter(Boolean) : [];
    if(!own.length) return DEFAULTS.quoteTerms.slice();
    const hasPayTerm = own.some(t => /^50% advance/i.test(t));
    const extra = DEFAULTS.quoteTerms.filter(t =>
      !own.includes(t) && !(hasPayTerm && /^50% advance/i.test(t)));
    return own.concat(extra);
  };
  const todayISO = () => new Date().toLocaleDateString('en-CA');
  /* Every date this panel SHOWS is day-first. Dates are stored yyyy-mm-dd
     (sortable, what Firestore and the CSVs want); this is the one place that
     turns a stored date into the written form — 2026-08-02 → 02-08-2026 —
     for the few spots that print numbers instead of "2 Aug". */
  const dmy = d => /^\d{4}-\d{2}-\d{2}$/.test(d||'')
    ? d.slice(8,10) + '-' + d.slice(5,7) + '-' + d.slice(0,4) : (d||'');

  /* Time of day on an event. Two functions on one date are the whole reason to
     ask: a morning Nikah and an evening Reception read as one blur on a
     calendar row, and the crew turn up at the wrong end of the day. Optional —
     blank stays blank, so nothing saved before this existed gets a time it
     never had. */
  const SLOTS = [['morning','🌅 Morning'], ['evening','🌆 Evening'], ['full','☀️ Full day']];
  const SLOT_LABEL = { morning:'Morning', evening:'Evening', full:'Full day' };
  const slotName = s => SLOT_LABEL[String(s||'')] || '';
  const slotTag  = s => slotName(s) ? `<span class="slotpill ${esc(s)}">${esc(slotName(s))}</span>` : '';
  /* for plain-text places — WhatsApp, confirm dialogs, the PDF */
  const slotSuffix = s => slotName(s) ? ' (' + slotName(s) + ')' : '';

  /* ---------- delivery tracker (booked → delivered) ---------- */
  const dSteps = () => (CFG && Array.isArray(CFG.deliverySteps) && CFG.deliverySteps.length ? CFG.deliverySteps : DEFAULTS.deliverySteps);
  const stepDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d||'') ? new Date(d+'T00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'}) : '';
  /* album / cinematic steps only appear when the package actually includes them */
  const hasAlbum  = x => !!(x && ((x.album && (Number(x.album.sheets)>0 || Number(x.album.price)>0))
    || (x.addons||[]).some(a=>/album/i.test(a))));
  const hasCinema = x => !!(x && ((x.events||[]).some(ev=>(ev.items||[]).some(it=>/cinema/i.test(it.service||'')))
    || (x.addons||[]).some(a=>/cinematic|teaser/i.test(a))));
  const hasPhoto  = x => !!(x && (x.events||[]).some(ev=>(ev.items||[]).some(it=>/photo/i.test(it.service||''))));
  const hasVideo  = x => !!(x && (x.events||[]).some(ev=>(ev.items||[]).some(it=>/video|cinema/i.test(it.service||''))));
  /* A partner studio's job ends when the footage changes hands. The album
     selection, the client pendrive, the teasers — that whole retail flow is
     the studio's own business with their client, not ours, so a B2B job ran a
     checklist most of which could never be ticked. Its own short list instead,
     editable in Site Config like the retail one. */
  const b2bSteps = () => (CFG && Array.isArray(CFG.b2bDeliverySteps) && CFG.b2bDeliverySteps.length
    ? CFG.b2bDeliverySteps : DEFAULTS.b2bDeliverySteps);
  function stepsFor(x){
    /* the keyword filter below decides which RETAIL steps apply to a package;
       a studio job does not run that flow at all, so it never reaches it */
    if(isStudioJob(x)) return b2bSteps().slice();
    return dSteps().filter(s =>
      (!/album/i.test(s)            || hasAlbum(x)) &&
      (!/cinematic|teaser/i.test(s) || hasCinema(x)) &&
      (!/photo/i.test(s)            || hasPhoto(x)) &&
      (!/video/i.test(s)            || hasVideo(x)));
  }
  function deliveryInfo(x){
    const steps = stepsFor(x);
    const done = {};
    (Array.isArray(x.delivery) ? x.delivery : []).forEach(d=>{ if(d && d.step) done[d.step] = d.date||''; });
    const doneCount = steps.filter(s=>s in done).length;
    return { steps, done, doneCount, total: steps.length, pct: steps.length ? Math.round(100*doneCount/steps.length) : 0 };
  }
  function trackerHTML(x){
    const di = deliveryInfo(x);
    return `
    <div class="dtrack">
      <div class="dt-head"><span>Delivery</span><span class="dprog"><i style="width:${di.pct}%"></i></span><b>${di.doneCount}/${di.total}</b></div>
      ${di.steps.map(s=>{
        const d = (s in di.done);
        return `<div class="dstep ${d?'done':''}" data-tstep data-name="${esc(s)}"><i>✓</i><span>${esc(s)}</span><em>${d?stepDate(di.done[s]):''}</em></div>`;
      }).join('')}
    </div>`;
  }

  /* ---------- shared package helpers ---------- */
  const livePkgs = () => PKGS.filter(x=>!x.deleted);
  const daysAgo = d => /^\d{4}-\d{2}-\d{2}$/.test(d||'') ? Math.floor((Date.now() - new Date(d+'T00:00').getTime()) / 864e5) : null;
  const waLink = (numOrPkg, text) => {
    const n = (numOrPkg && typeof numOrPkg === 'object')
      ? waNumberFor(numOrPkg)
      : '91' + String(numOrPkg||'').replace(/\D/g,'').slice(-10);
    return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
  };
  function openWa(url){
    const w = window.open(url, '_blank');
    if(!w) toast('Popup blocked — allow popups for this app to open WhatsApp');
    return !!w;
  }
  function waQuoteText(x){
    const tt = x.totals||{};
    const evs = (x.events||[]).map(ev=>`• ${ev.title||'Event'}${ev.date?' — '+stepDate(ev.date):''}${slotSuffix(ev.slot)}`).join('\n');
    return `*Fantasy Studio* — Quotation ${x.quoteNo||''}\n\n${evs}\n\nPackage total: ${inr(tt.finalPrice||0)}\n50% advance confirms your dates · 40% on event day · 10% at delivery.\n\n${pdfContact().phone||''} · ${pdfContact().website||''}`;
  }
  function waReceiptText(x, pm, balance){
    return `*Fantasy Studio* — Payment received ✅\n\n${inr(pm.amount)} (${pm.mode}) on ${stepDate(pm.date)||pm.date}\nQuote ${x.quoteNo||''} — ${x.clientName||''}\nRemaining balance: ${inr(balance)}\n\nThank you!`;
  }
  function waFollowupText(x){
    return `Salaam ${x.clientName||''}! Just checking if you had a chance to review our quotation ${x.quoteNo||''} (${inr((x.totals||{}).finalPrice||0)}) from Fantasy Studio. Dates book up fast in season — we would love to cover your functions. 🌟`;
  }
  function nextShootDate(x){
    const today = todayISO();
    const ds = (x.events||[]).map(e=>e.date).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')).sort();
    return ds.find(d=>d>=today) || ds[ds.length-1] || '';
  }
  /* a date only counts as "heavy" once it already holds this many confirmed
     events — the studio runs several crews, so a shared date is normal and
     the warning fires only when a 6th job would land on the same day */
  const DATE_EVENT_CAP = 5;
  function dateConflicts(dateISO, excludeId, excludeClient){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(dateISO||'')) return [];
    const xc = String(excludeClient||'').trim().toLowerCase();
    return calEvents().filter(e=>e.date===dateISO && (e.status==='booked' || e.status==='lead') && e.id!==excludeId
      && !(xc && String(e.client||'').trim().toLowerCase() === xc));   /* the same client's own lead isn't a clash */
  }
  /* client phones are stored as the LAST 10 DIGITS of the client's login
     number — works for +91 and for NRI numbers alike (the portal matches on
     the last 10 digits of the verified phone, whatever the country code) */
  function normPhone(v){
    const d = String(v||'').replace(/\D/g,'');
    return d.length > 10 ? d.slice(-10) : d;
  }
  /* normPhone throws the country code away, which is right for portal matching
     but wrong for dialling: waLink used to bolt 91 back onto the last 10 digits,
     so every WhatsApp message to an NRI client went to a wrong Indian number.
     Store the full dialling form too, and prefer it when it exists. */
  function normPhoneFull(v){
    let d = String(v||'').replace(/\D/g,'');
    if(d.indexOf('00') === 0) d = d.slice(2);
    if(d.length <= 10) return '91' + d.replace(/^0+/,'');
    const cc = d.slice(0, d.length-10).replace(/^0+/,'');
    return (cc || '91') + d.slice(-10);
  }
  /* normPhoneFull() assumes +91 for a 10-digit input, which is right for a
     freshly typed Indian number but wrong for an NRI package being re-saved:
     for an Indian client the editor's phone box only holds the last 10 digits.
     Keep the number the record already had whenever the last 10 digits still
     match — UNLESS the box itself carries a dialling code, which is the case
     for NRI clients (openPkgEdit shows those in full so the code is visible
     and correctable). A typed code always wins, or a wrong one could never be
     fixed: the last 10 digits are unchanged, so the old number came back. */
  function keepPhoneFull(typed){
    const raw = String(typed||'').trim();
    const digits = raw.replace(/\D/g,'');
    if(raw.startsWith('+') || digits.length > 10) return normPhoneFull(raw);
    const t = normPhone(raw);
    const had = String(_phoneFullAtOpen||'').replace(/\D/g,'');
    if(t && had && had.slice(-10) === t) return had;
    return normPhoneFull(raw);
  }
  const waNumberFor = x => (x && x.clientPhoneFull)
    ? String(x.clientPhoneFull).replace(/\D/g,'')
    : '91' + String((x&&x.clientPhone)||'').replace(/\D/g,'').slice(-10);
  /* phone index: lets the client portal check "does this number have a booking?"
     BEFORE sending an OTP — stores only a hash, never the number itself */
  async function phoneKey(p){
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('fs:' + String(p||'').replace(/\D/g,'').slice(-10)));
    return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  /* resolves true only once the SERVER has the key. Callers that just want it
     written can ignore the result; the partner-login check on a studio's page
     needs to tell a landed key from a lost one — a silently dropped write
     leaves that partner stuck at "this number is not registered". */
  async function ensurePhoneIndex(phone){
    const p = String(phone||'').replace(/\D/g,'').slice(-10);
    if(p.length !== 10) return false;
    try{ await setDoc(doc(db,'phoneIndex', await phoneKey(p)), { t: true }, { merge: true }); return true; }
    catch(e){ return false; }
  }
  /* does this number actually have a login key on the server right now? */
  async function hasPhoneIndex(phone){
    const p = String(phone||'').replace(/\D/g,'').slice(-10);
    if(p.length !== 10) return false;
    return (await getDoc(doc(db,'phoneIndex', await phoneKey(p)))).exists();
  }
  let _phoneIdxDone = false;
  function backfillPhoneIndex(){
    if(_phoneIdxDone) return;
    try{ if(localStorage.getItem('fs_phoneidx_v2')){ _phoneIdxDone = true; return; } }catch(e){}
    _phoneIdxDone = true;
    /* one-time: clean existing packages' phone formats + build the login index */
    livePkgs().forEach(x=>{
      const raw = String(x.clientPhone||'');
      const norm = normPhone(raw);
      if(norm.length === 10 && norm !== raw){
        settle(updateDoc(doc(db,'packages',x.id), { clientPhone: norm }));
        x.clientPhone = norm;
      }
      if((x.status||'draft') !== 'draft') ensurePhoneIndex(norm);   /* drafts don't unlock the portal pre-check */
    });
    try{ localStorage.setItem('fs_phoneidx_v2','1'); }catch(e){}
  }

  /* duplicate-proof quote numbers: a counter doc allocated in a transaction */
  async function allocQuoteNo(){
    const yr = new Date().getFullYear();
    try{
      return await runTransaction(db, async t=>{
        const ref = doc(db,'config','counters');
        const snap = await t.get(ref);
        const key = 'quote' + yr;
        const cur = snap.exists() ? (Number(snap.data()[key])||0) : 0;
        const localMax = PKGS.map(x=>x.quoteNo||'').filter(q=>q.startsWith('FS-'+yr+'-'))
          .map(q=>parseInt(q.split('-')[2],10)||0).reduce((a,b)=>Math.max(a,b), 0);
        const next = Math.max(cur, localMax) + 1;
        t.set(ref, { [key]: next }, { merge: true });
        return 'FS-' + yr + '-' + String(next).padStart(3,'0');
      });
    }catch(e){
      /* Transactions need a live server round trip; they never queue offline.
         navigator.onLine only says "some interface is up", so at a venue on one
         bar of unusable 2G, or behind a hotel captive portal, it reports true,
         this rethrew, and pkgSave aborted — the owner could not save a new
         package AT ALL. Fall back to local numbering for anything that is a
         connectivity symptom; a genuine error (permission-denied, invalid
         argument) must still surface rather than silently degrade. */
      const code = (e && e.code) || '';
      const connectivity = !navigator.onLine
        || code === 'unavailable' || code === 'deadline-exceeded'
        || code === 'resource-exhausted' || code === 'aborted'
        || code === 'internal' || code === 'cancelled';
      if(!connectivity) throw e;
      return nextQuoteNo();
    }
  }

  let _pkgsUnsub = null, _pkgsBackfilled = false, _pkgsErr = '';
  /* backfill one legacy package: counter + doc in ONE transaction, skipped if another device already numbered it */
  async function backfillQuoteNo(id){
    const yr = new Date().getFullYear();
    return runTransaction(db, async t=>{
      const cref = doc(db,'config','counters');
      const pref = doc(db,'packages',id);
      const cs = await t.get(cref);
      const ps = await t.get(pref);
      if(!ps.exists() || ps.data().quoteNo) return ps.exists() ? ps.data().quoteNo : null;
      const key = 'quote' + yr;
      const cur = cs.exists() ? (Number(cs.data()[key])||0) : 0;
      const localMax = PKGS.map(x=>x.quoteNo||'').filter(q=>q.startsWith('FS-'+yr+'-'))
        .map(q=>parseInt(q.split('-')[2],10)||0).reduce((a,b)=>Math.max(a,b), 0);
      const next = Math.max(cur, localMax) + 1;
      const qn = 'FS-' + yr + '-' + String(next).padStart(3,'0');
      t.set(cref, { [key]: next }, { merge: true });
      t.update(pref, { quoteNo: qn });
      return qn;
    });
  }
  function loadPkgs(){
    if(_pkgsUnsub){ renderPkgList(); renderCalendar(); return; }
    _pkgsErr = '';
    try{
      /* includeMetadataChanges — see the studios listener: without it an
         unchanged collection never raises a server snapshot, so _pkgsFresh
         stays false and the crew mirror the partner portal reads never syncs */
      _pkgsUnsub = onSnapshot(query(collection(db,'packages'), orderBy('createdAt','desc'), limit(PKGS_CAP)),
        { includeMetadataChanges: true }, async snap=>{
        PKGS = snap.docs.map(d=>({ id:d.id, ...d.data() }));
        warnIfCapped('packages', snap.size, PKGS_CAP);
        _pkgsLoaded = true;
        if(!snap.metadata.fromCache){ _pkgsFresh = true; backfillPhoneIndex(); }
        syncStudioCrew();   /* partner portal reads crew off the package doc */
        renderPkgList();
        renderCalendar();
        /* one-time backfill: number packages created before quote numbers existed.
           Only from a SERVER snapshot — a stale cache image must never renumber docs. */
        if(!_pkgsBackfilled && !snap.metadata.fromCache){
          _pkgsBackfilled = true;
          const unnumbered = PKGS.filter(x=>!x.quoteNo).sort((a,b)=>{
            const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
            const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
            return ta - tb;
          });
          for(const x of unnumbered){
            try{ const qn = await backfillQuoteNo(x.id); if(qn) x.quoteNo = qn; }
            catch(e){ break; }   /* offline/denied — retry next session */
          }
          if(unnumbered.length) renderPkgList();
        }
      }, err=>{
        try{ if(_pkgsUnsub) _pkgsUnsub(); }catch(e){}
        _pkgsUnsub = null;   /* let ↻ Refresh resubscribe */
        _pkgsErr = 'Could not load packages (' + (err.code||err.message) + ')';
        renderPkgList();
      });
    }catch(err){ _pkgsErr = 'Could not load packages (' + (err.code||err.message) + ')'; renderPkgList(); }
  }
  $('#pkgRefresh').addEventListener('click', loadPkgs);
  $('#pkgSearch').addEventListener('input', debounce(()=>{ viewSet('pkgQ', $('#pkgSearch').value||''); renderPkgListOnly(); }));
  /* The filter variables restore themselves where they are declared; the two
     search boxes are DOM and have to be put back by hand. Done once, before
     the first render, so the very first paint is already the narrowed list the
     owner left behind rather than a wide one that jumps a frame later. */
  (function restoreSearches(){
    const lq = viewGet('leadQ',''), pq = viewGet('pkgQ','');
    if(lq) $('#leadSearch').value = lq;
    if(pq) $('#pkgSearch').value = pq;
  })();
  $('#leadSearch').addEventListener('input', debounce(()=>{ viewSet('leadQ', $('#leadSearch').value||''); renderLeads(); }));

  let pkgFilterVal = viewGet('pkgF');
  /* 'unconfirmed' = quote sent but the event is NOT confirmed / on hold — it
     leaves the follow-up nag list (which only chases 'sent' quotes) without
     pretending the enquiry is booked or dead */
  const PKG_STATES = ['draft','sent','unconfirmed','booked','delivered'];
  const STATUS_LABEL = s => s === 'unconfirmed' ? 'not confirmed' : s;
  function renderPkgChips(){
    const live = livePkgs();
    const counts = {draft:0,sent:0,unconfirmed:0,booked:0,delivered:0};
    live.forEach(x=>{ const s=x.status||'draft'; counts[s]=(counts[s]||0)+1; });
    const b2bN = live.filter(isStudioJob).length;
    const dueN = live.filter(x=>(x.status||'draft') !== 'draft' && Math.max(0,(x.totals||{}).balance||0) > 0).length;
    $('#pkgChips').innerHTML = [['','All',live.length],
        ...(dueN ? [['due','₹ Due',dueN]] : []),
        ...(b2bN ? [['b2b','🏢 Studio',b2bN]] : []),
        ...PKG_STATES.map(s=>{ const l=STATUS_LABEL(s); return [s, l[0].toUpperCase()+l.slice(1), counts[s]||0]; })]
      .map(([v,lab,n])=>`<button data-f="${v}" class="${pkgFilterVal===v?'on':''}">${lab}<b>${n}</b></button>`).join('');
  }
  $('#pkgChips').addEventListener('click', e=>{
    const b = e.target.closest('button[data-f]'); if(!b) return;
    pkgFilterVal = b.dataset.f; viewSet('pkgF', pkgFilterVal); renderPkgListOnly();
  });
  /* The filter order is whatever renderPkgChips just drew — 🏢 Studio only
     appears when there are studio jobs — so it is read off the chips instead
     of being hard-coded twice. A swipe that starts ON the chip strip is left
     alone: that strip scrolls sideways itself. */
  wireSwipe($('#pkgListView'), {
    keys: ()=>$$('#pkgChips button[data-f]').map(b=>b.dataset.f),
    cur:  ()=>pkgFilterVal,
    go:   k=>{ pkgFilterVal = k; viewSet('pkgF', k); renderPkgListOnly(); },
    skip: t=>!!(t && t.closest && t.closest('#pkgChips')),
    box:  ()=>$('#pkgList'),
  });
  $('#pkgStats').addEventListener('click', e=>{
    const f = e.target.closest('[data-fin]');
    if(f){ openFin(); return; }
    /* the tile is a money figure, so land on the money section — not whichever
       part of Team was open last */
    if(e.target.closest('[data-goteam]')){ $('#tabTeam').click(); setTeamSeg('pay'); return; }
    const t = e.target.closest('[data-goto]'); if(!t) return;
    /* only block while the editor is genuinely ON SCREEN — it used to stay
       flagged open behind another tab and silently kill these taps */
    if(!$('#pkgView').hidden && !$('#pkgEditView').hidden) return;
    pkgFilterVal = t.dataset.goto;
    $('#tabPkgs').click();
    renderPkgList();
  });

  function renderPkgStats(){
    const el = $('#pkgStats'); if(!el) return;
    const confirmed = livePkgs().filter(x=>['booked','delivered'].includes(x.status||'draft'));
    const booked = livePkgs().filter(x=>(x.status||'draft')==='booked');
    const outstanding = confirmed.reduce((s,x)=>s+Math.max(0,(x.totals||{}).balance||0),0);
    const bookedVal = confirmed.reduce((s,x)=>s+((x.totals||{}).finalPrice||0),0);
    const mStart = new Date(); mStart.setDate(1); mStart.setHours(0,0,0,0);
    const newMonth = livePkgs().filter(x=>x.createdAt && x.createdAt.toDate && x.createdAt.toDate() >= mStart).length;
    /* the two money tiles share one line — tapping either opens the money analytics sheet */
    /* what the crew are owed — the money that leaves. Same basis as the Team
       tab's "crew pay due" tile, so the two screens can never disagree. */
    const crewDue = ASGS.reduce((s,a)=>s + payDue(a), 0);
    /* Compact on these tiles by necessity: they are a quarter of a phone wide
       and the full figure was being cut off mid-number. The exact rupees stay
       one long-press away in the title. */
    el.innerHTML = `
      <div class="stat money" data-fin role="button" tabindex="0" title="${inr(outstanding)} — open money analytics"><b>${inrShort(outstanding)}</b><span>left to collect</span></div>
      <div class="stat money" data-fin role="button" tabindex="0" title="${inr(bookedVal)} — open money analytics"><b>${inrShort(bookedVal)}</b><span>booked value</span></div>
      <div class="stat money out" data-goteam role="button" tabindex="0" title="${_asgsLoaded ? inr(crewDue) + ' — open the Team tab' : 'Loading crew pay…'}"><b>${_asgsLoaded ? inrShort(crewDue) : '…'}</b><span>crew pay due</span></div>
      <div class="stat wide" data-goto="booked" role="button" tabindex="0"><b>${booked.length}</b><span>booked</span></div>
      <div class="stat wide" data-goto="" role="button" tabindex="0"><b>${newMonth}</b><span>new this month</span></div>`;
  }
  /* one shoot at a time: the very next event as a single tappable card —
     tapping it opens the full event + package sheet, with ‹ › to browse
     the rest of the upcoming schedule without leaving Home */
  let _upEvents = [];
  function renderUpcoming(){
    const el = $('#upcoming'); if(!el) return;
    const today = new Date().toLocaleDateString('en-CA');
    /* strictly AFTER today: the calendar day box opens on today and already
       shows today's events in full, so repeating them here as the hero was
       the same shoot twice on one screen */
    _upEvents = calEvents()
      .filter(e=>e.date > today && (e.status === 'booked' || e.status === 'lead'))   // confirmed bookings only
      .sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);   /* 0 on equal dates — same-day events must not swap between refreshes */
    if(!_upEvents.length){
      if($('#evModal').classList.contains('open')) closeEvUI();
      if($('#upModal').classList.contains('open')) closeUpUI();
      /* say so rather than vanishing — Home used to just end after the
         calendar, which reads like something failed to load */
      el.hidden = !_pkgsLoaded;
      el.innerHTML = '<h3>📅 Next shoot</h3><div class="empty" style="padding:.9rem 0">Nothing booked after today.</div>';
      return;
    }
    el.hidden = false;
    /* the next shoot is a DAY, not a single event: a 3-function day used to
       highlight only its first event and push the other two into the small
       rows below, where they read as later shoots. Every event on that date
       now sits inside the highlight; the following 4 stay as compact rows. */
    const d0 = _upEvents[0].date;
    const hero = _upEvents.filter(e=>e.date === d0);   /* sorted by date, so these are contiguous */
    const d = new Date(d0+'T00:00');
    const days = Math.round((d - new Date(today+'T00:00'))/864e5);
    const when = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days · ${d.toLocaleDateString('en-IN',{weekday:'short'})}`;
    /* one package covering three functions on the same day owes ONE balance —
       repeating it on every row would read as three separate debts */
    const dueShown = new Set();
    const heroRows = hero.map((e,i)=>{
      const pk = e.kind === 'pkg' ? PKGS.find(p=>p.id===e.id) : null;
      let due = pk ? Math.max(0,(pk.totals||{}).balance||0) : 0;
      if(due > 0 && dueShown.has(e.id)) due = 0; else if(due > 0) dueShown.add(e.id);
      return `
      <div class="uh-row" data-open-ev="${i}" role="button" tabindex="0" aria-label="Open event details">
        <i class="dot ${e.status}"></i>
        <div class="uh-mid">
          <b>${esc(e.title)}</b>
          <span>${e.quoteNo ? esc(e.quoteNo) + ' · ' : ''}${e.b2b ? '🏢 ' : ''}${esc(e.client)}${e.venue ? ' · 📍 ' + esc(e.venue) : ''}</span>${slotTag(e.slot)}
        </div>
        ${due > 0 ? `<span class="due">${inr(due)} due</span>` : ''}
        <span class="chev2">›</span>
      </div>`;
    }).join('');
    const rest = _upEvents.slice(hero.length, hero.length + 4);
    const rows = rest.map((e,i)=>`
      <div class="up-ev" data-open-ev="${hero.length+i}" role="button" tabindex="0">
        <span class="when">${new Date(e.date+'T00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</span>
        <span class="what">${esc(e.title)} <span>· ${esc(e.client)}</span></span>
        <i class="dot ${e.status}"></i>
      </div>`).join('');
    const more = _upEvents.length - hero.length - rest.length;
    el.innerHTML = `<h3>📅 Next shoot${_upEvents.length>1 ? `<button class="upmore" data-uplist type="button">${_upEvents.length} upcoming ›</button>` : ''}</h3>
      <div class="up-hero">
        <div class="uh-head">
          <div class="un-when"><b>${d.getDate()}</b><span>${d.toLocaleDateString('en-IN',{month:'short'})}</span></div>
          <div class="uh-t">
            <b>${when}</b>
            <span>${hero.length} event${hero.length===1?'':'s'} on this date</span>
          </div>
        </div>
        <div class="uh-rows">${heroRows}</div>
      </div>
      ${rows}
      ${more > 0 ? `<button class="upall" data-uplist type="button">＋ ${more} more — complete list</button>` : ''}`;
    if($('#evModal').classList.contains('open')){
      /* live data landed while the sheet was open — re-find the SAME shoot in
         the rebuilt list so the sheet never silently switches events */
      if(_evKey){ const ni = _upEvents.findIndex(x=>evKeyOf(x) === _evKey); if(ni >= 0) _evIdx = ni; }
      renderEv();
    }
    if($('#upModal').classList.contains('open')) renderUpList();
  }
  $('#upcoming').addEventListener('click', e=>{
    if(e.target.closest('[data-uplist]')){ openUpList(); return; }
    const open = e.target.closest('[data-open-ev]');
    if(open) openEv(Number(open.dataset.openEv)||0);
  });

  /* sent quotes that have gone quiet — surfaced on Home every morning */
  function renderFollowups(){
    const el = $('#followups'); if(!el) return;
    const list = livePkgs().filter(x=>(x.status||'draft')==='sent').map(x=>{
      const since = x.sentAt || tsDate(x.updatedAt) || tsDate(x.createdAt);
      return { x, days: daysAgo(since) };
    }).filter(r=>r.days != null && r.days >= 3)
      .sort((a,b)=>b.days-a.days).slice(0,6);
    el.hidden = !list.length;
    if(!list.length) return;
    el.innerHTML = '<h3>📤 Quotes needing follow-up</h3>' + list.map(r=>`
      <div class="up-ev" data-fu="${r.x.id}">
        <span class="when">${r.days}d ago</span>
        <span class="what">${esc(r.x.clientName||'—')} <span>· ${esc(r.x.quoteNo||'')} · ${inr((r.x.totals||{}).finalPrice||0)}</span></span>
        ${r.x.clientPhone ? '<button class="btn btn--sm btn--ghost" data-funudge>WhatsApp</button>' : ''}
        <button class="btn btn--sm btn--ghost" data-fudone title="Mark followed up">✓</button>
      </div>`).join('');
  }
  $('#followups').addEventListener('click', async e=>{
    const row = e.target.closest('[data-fu]'); if(!row) return;
    const x = PKGS.find(p=>p.id===row.dataset.fu); if(!x) return;
    const nudge = e.target.closest('[data-funudge]'), done = e.target.closest('[data-fudone]');
    if(!nudge && !done) return;
    if(nudge && !openWa(waLink(x, waFollowupText(x)))) return;   /* popup blocked → don't reset the counter */
    try{
      await settle(updateDoc(doc(db,'packages',x.id), { sentAt: todayISO() }));
      x.sentAt = todayISO();
      renderFollowups();
      if(done) toast('Marked as followed up');
    }catch(err){ toast('Update failed'); }
  });

  function renderHome(){
    renderPkgStats();
    renderUpcoming();
    renderFollowups();
    renderHomeBooked();
  }

  function leadsThisWeek(){
    const cut = Date.now() - 7*864e5;
    return liveLeads().filter(l=>{
      const t = l.createdAt && l.createdAt.toDate ? l.createdAt.toDate().getTime() : 0;
      return t >= cut;
    });
  }

  const HOME_BOOKED_N = 10;
  let _homeBookedAll = false, _homeTab = 'next';
  /* A booking has three lives: still to shoot, shot and being worked on, and
     handed over. They were one undifferentiated list, so the wedding being
     edited this week sat between one booked for December and one delivered in
     March. The split is by the DATES, so a package moves itself along. */
  function homeGroups(){
    const today = todayISO();
    const dates = x => (x.events||[]).map(e=>e.date).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')).sort();
    const booked = livePkgs().filter(x=>(x.status||'draft')==='booked');
    const lastOf = x => { const d = dates(x); return d.length ? d[d.length-1] : ''; };
    return {
      /* no dates yet still counts as ahead — it has not been shot */
      next: booked.filter(x=>{ const d = dates(x); return !d.length || d.some(v=>v >= today); })
        .sort((a,b)=>{ const da = nextShootDate(a)||'9999', db = nextShootDate(b)||'9999'; return da<db?-1:da>db?1:0; }),
      ongoing: booked.filter(x=>{ const d = dates(x); return d.length && d.every(v=>v < today); })
        .sort((a,b)=>lastOf(a) < lastOf(b) ? 1 : -1),
      delivered: livePkgs().filter(x=>(x.status||'draft')==='delivered')
        .sort((a,b)=>{ const da = a.deliveredAt||lastOf(a)||'', db = b.deliveredAt||lastOf(b)||''; return da<db?1:-1; }),
    };
  }
  const HOME_TABS = [['next','Coming next'],['ongoing','Ongoing'],['delivered','Delivered']];
  const HOME_EMPTY = {
    next: 'Nothing booked ahead — a package lands here the moment its status is <b style="color:var(--ok)">booked</b>.',
    ongoing: 'Nothing in post right now — a booking moves here the day after its last function.',
    delivered: 'Nothing delivered yet — mark a package <b>delivered</b> once everything is handed over.',
  };
  $('#homeTabs').addEventListener('click', e=>{
    const b = e.target.closest('[data-htab]'); if(!b || b.dataset.htab === _homeTab) return;
    _homeTab = b.dataset.htab;
    _homeBookedAll = false;          /* each tab starts at its own first ten */
    renderHomeBooked();
  });
  function renderHomeBooked(){
    const el = $('#homeBooked'); if(!el) return;
    const g = homeGroups();
    $('#homeTabs').innerHTML = HOME_TABS.map(([k,l])=>
      `<button type="button" data-htab="${k}" class="${_homeTab===k?'on':''}">${l}<b>${g[k].length}</b></button>`).join('');
    const show = g[_homeTab] || [];
    if(!show.length){
      el.innerHTML = _pkgsErr ? errBox(_pkgsErr, 'pkgs')
        : _pkgsLoaded
        ? `<div class="empty-state"><span class="empty-state__icon">📸</span><p class="empty-state__text">${HOME_EMPTY[_homeTab]}</p></div>`
        : '<div class="skeleton"></div><div class="skeleton"></div>';
      return;
    }
    /* the season list runs long — the first 10 (soonest shoots first) are the
       ones that need attention today; the rest are one tap away */
    const cut = _homeBookedAll ? show.length : HOME_BOOKED_N;
    /* an expanded card that fell past the cut must not vanish under the fold */
    const keep = show.findIndex(x=>x.id === expandedHome);
    const lim = (keep >= 0 && keep >= cut) ? keep + 1 : cut;
    el.innerHTML = show.slice(0, lim).map(x=>pkgCardHTML(x, expandedHome === x.id)).join('')
      + (show.length > cut
          ? `<button class="upall" type="button" data-hbmore>＋ View all ${show.length} — ${show.length - lim} more</button>`
          : (_homeBookedAll && show.length > HOME_BOOKED_N
              ? '<button class="upall" type="button" data-hbless>− Show fewer</button>' : ''));
  }

  /* Swipe a filtered list sideways to change which filter it is showing —
     left for the next, right for the previous, the direction every other app
     on the phone uses. Only a deliberate horizontal flick counts, so vertical
     scrolling is untouched, a chip strip that scrolls on its own keeps doing
     it, and a swipe that lifts off over a card never opens that card. */
  function wireSwipe(sec, o){
    if(!sec) return;
    let x0 = 0, y0 = 0, t0 = 0, swiped = false, armed = false;
    sec.addEventListener('touchstart', e=>{
      swiped = false;
      armed = e.touches.length === 1 && !(o.skip && o.skip(e.target));
      if(!armed) return;
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
    }, { passive: true });
    sec.addEventListener('touchend', e=>{
      if(!armed) return;
      const t = e.changedTouches && e.changedTouches[0]; if(!t) return;
      const dx = t.clientX - x0, dy = t.clientY - y0;
      if(Date.now() - t0 > 800) return;                                   /* a slow drag is not a flick */
      if(Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.6) return;  /* scrolling, not swiping */
      const keys = o.keys(); if(!keys.length) return;
      const i = keys.indexOf(o.cur());
      const ni = (i < 0 ? 0 : i) + (dx < 0 ? 1 : -1);
      if(ni < 0 || ni >= keys.length) return;                             /* neither end wraps */
      swiped = true;
      o.go(keys[ni]);
      const box = o.box && o.box();
      if(box){
        box.classList.remove('sl-l','sl-r');
        void box.offsetWidth;                                             /* restart the animation */
        box.classList.add(dx < 0 ? 'sl-l' : 'sl-r');
      }
    }, { passive: true });
    /* the finger lifted on a card: that was a swipe, not a tap on it */
    sec.addEventListener('click', e=>{
      if(!swiped) return;
      swiped = false;
      e.stopPropagation(); e.preventDefault();
    }, true);
  }
  wireSwipe($('#bookingsSec'), {
    keys: ()=>HOME_TABS.map(([k])=>k),
    cur:  ()=>_homeTab,
    go:   k=>{ _homeTab = k; _homeBookedAll = false; renderHomeBooked(); },
    box:  ()=>$('#homeBooked'),
  });

  function pkgCardHTML(x, open){
    const st = x.status||'draft';
    const evn = (x.events||[]).length;
    const tt = x.totals||{};
    const _paid = Number(tt.advance)||0, _bal = Math.max(0, Number(tt.balance)||0), _fin = Number(tt.finalPrice)||0;
    /* Compact on the card, exact in the title and in the open package — the
       full "₹1,10,000/₹3,10,000" is 19 characters and at 375px it pushed the
       quote number off its own line. */
    const amt = _paid > 0
      ? (_bal > 0
          ? `<span class="card__amt" title="Balance due ${inr(_bal)} of ${inr(_fin)} total"><em class="duelbl">DUE</em>${inrShort(_bal)}<em>/${inrShort(_fin)}</em></span>`
          : `<span class="card__amt" title="${inr(_fin)} — paid in full">${inrShort(_fin)}<em class="paidlbl">PAID</em></span>`)
      : `<span class="card__amt" title="${inr(_fin)}">${inrShort(_fin)}</span>`;
    const nd = st === 'booked' ? nextShootDate(x) : '';
    const sentDays = st === 'sent' ? daysAgo(x.sentAt || tsDate(x.updatedAt) || tsDate(x.createdAt)) : null;
    const track = (st === 'booked' || st === 'delivered');
    let prog = '';
    if(track){
      const di = deliveryInfo(x);
      prog = st === 'delivered'
        ? `<div class="dl3">${di.doneCount ? `<span class="dprog"><i style="width:${di.pct}%"></i></span>` : ''}<b class="dv">✓ Delivered${x.deliveredAt ? ' ' + stepDate(x.deliveredAt) : ''}</b></div>`
        : `<div class="dl3"><span class="dprog"><i style="width:${di.pct}%"></i></span><b>${di.doneCount}/${di.total} steps</b></div>`;
    }
    /* The status control moved out of .pkg-acts and into the card head, where
       Clients keeps it too. .pkg-acts is hidden until the card is expanded, so
       the old placement meant two taps to change a status and a second, static
       copy of the same pill sitting in the head doing nothing. One control,
       always reachable, same StatusChip vocabulary as every other tab. */
    return `
    <article class="card ${open?'is-open':''}" data-id="${x.id}" data-state="${stateOf(st)}">
      <div class="card__head">
        <button type="button" class="card__toggle" data-expand aria-expanded="${open?'true':'false'}">
          <span class="l1">
            <span class="card__title">${esc(x.clientName||'—')}</span>
            ${isStudioJob(x) ? `<span class="b2bpill">🏢 B2B${x.whiteLabel ? ' · WL' : ''}</span>` : ''}
          </span>
          <span class="l2">
            <span class="card__meta">${[
              x.quoteNo ? `<b class="qno">${esc(x.quoteNo)}</b>` : '',
              isStudioJob(x) && x.endClientName ? `for ${esc(x.endClientName)}` : '',
              `${evn} event${evn===1?'':'s'}`,
              nd ? `📅 ${stepDate(nd)}` : '',
              sentDays != null && sentDays >= 0 ? `📤 ${sentDays}d` : ''
            ].filter(Boolean).join(' · ')}</span>
            ${amt}
          </span>
          ${prog}
          <span class="chev" aria-hidden="true">›</span>
        </button>
        <span class="card__side">
          <button type="button" class="chip-status no-dot" data-state="${stateOf(st)}" data-cycle
                  aria-label="Change status — currently ${STATUS_LABEL(st)}">${STATUS_LABEL(st)}</button>
        </span>
      </div>
      <div class="pkg-acts" ${open?'':'hidden'}>
        <button type="button" class="btn btn--sm btn--ghost" data-edit>Edit</button>
        <button type="button" class="btn btn--sm btn--ghost" data-pdfrow>PDF</button>
        <button type="button" class="btn btn--sm btn--ghost" data-wapdf>Send ▷</button>
        <button type="button" class="btn btn--sm btn--ghost" data-pay>＋ Payment</button>
        ${x.clientPhone ? `<button type="button" class="btn btn--sm btn--ghost" data-call>📞 Call</button>
        <button type="button" class="btn btn--sm btn--ghost" data-wachat>💬 WhatsApp</button>` : ''}
        <button type="button" class="btn btn--sm btn--danger" data-delpkg>Delete</button>
      </div>
      ${track && open ? trackerHTML(x) : ''}
    </article>`;
  }

  /* which pipeline groups are open in the "All" view — remembered per device */
  let _pkgGrpsOpen = null;
  function pkgGrpsOpen(){
    if(!_pkgGrpsOpen){
      try{ _pkgGrpsOpen = JSON.parse(localStorage.getItem('fs_pkg_grps')||'null'); }catch(err){}
      if(!_pkgGrpsOpen || typeof _pkgGrpsOpen !== 'object') _pkgGrpsOpen = { booked:true, sent:false, unconfirmed:false, draft:false, delivered:false };
    }
    return _pkgGrpsOpen;
  }
  function togglePkgGrp(s){
    const o = pkgGrpsOpen(); o[s] = !o[s];
    try{ localStorage.setItem('fs_pkg_grps', JSON.stringify(o)); }catch(err){}
    renderPkgListOnly();
  }

  /* The full cascade — for anything that actually CHANGED data. Typing in the
     search box, tapping a filter chip or expanding a card changes none of it,
     and each keystroke was redrawing Home's stats, Next shoot, the follow-up
     list, the bookings list, Trash, Team, B2B and the money sheet. Those go
     through renderPkgListOnly() instead. */
  function renderPkgList(){
    renderHome();
    renderTrash();
    if(typeof renderTeam === 'function' && !$('#teamView').hidden) renderTeam();
    if(typeof renderB2B === 'function') renderB2B();   /* self-skips when the B2B tab is hidden */
    if($('#finModal').classList.contains('open')) renderFin();
    renderPkgListOnly();
  }
  $('#pkgList').addEventListener('click', e=>{
    if(!e.target.closest('[data-pkg-clear]')) return;
    pkgFilterVal = ''; $('#pkgSearch').value = '';
    viewSet('pkgF',''); viewSet('pkgQ','');
    renderPkgListOnly();
  });
  function renderPkgListOnly(){
    renderPkgChips();
    const f = pkgFilterVal;
    const q = ($('#pkgSearch').value||'').trim().toLowerCase();
    /* 'b2b' and 'due' are pseudo-filters: they cut across the statuses rather
       than being one of them. They live in the same chip strip because that is
       where the owner looks to narrow a list, and the Dashboard lands here. */
    let list = livePkgs().filter(x=>(!f || (f === 'b2b' ? isStudioJob(x)
        : f === 'due' ? ((x.status||'draft') !== 'draft' && Math.max(0,(x.totals||{}).balance||0) > 0)
        : (x.status||'draft')===f))
      && (!q || String(x.clientName||'').toLowerCase().includes(q) || String(x.clientPhone||'').includes(q)
          || String(x.quoteNo||'').toLowerCase().includes(q) || String(x.endClientName||'').toLowerCase().includes(q)));
    if(f === 'booked' || f === 'due') list = [...list].sort((a,b)=>{ const da = nextShootDate(a)||'9999', db2 = nextShootDate(b)||'9999'; return da<db2?-1:da>db2?1:0; });
    if(!list.length){
      /* never say "no packages yet" for data that simply has not arrived (or
         failed to) — that reads as "everything is gone" */
      $('#pkgList').innerHTML = _pkgsErr ? errBox(_pkgsErr, 'pkgs')
        : !_pkgsLoaded ? '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>'
        : livePkgs().length
        ? `<div class="empty-state">
             <span class="empty-state__icon">🔍</span>
             <p class="empty-state__title">Nothing matches</p>
             <p class="empty-state__text">${q ? `No package for “${esc(q)}”` : 'No package'}${f ? ` under <b>${esc(f === 'due' ? 'due' : f === 'b2b' ? 'studio jobs' : STATUS_LABEL(f))}</b>` : ''}. There ${livePkgs().length===1?'is':'are'} ${livePkgs().length} in total.</p>
             <button type="button" class="btn btn--ghost" data-pkg-clear>Clear filter &amp; search</button>
           </div>`
        : `<div class="empty-state">
             <span class="empty-state__icon">📦</span>
             <p class="empty-state__title">No packages yet</p>
             <p class="empty-state__text">A package holds the events, the crew and the money for one booking.</p>
             <button type="button" class="btn btn--primary" id="pkgEmptyNew">＋ Create your first package</button>
           </div>`;
      return;
    }
    /* "All" view: group by status so the list reads like a pipeline —
       booked (next shoot first), quotes awaiting a reply, drafts, delivered.
       Each group collapses (tap the header); only Booked starts open so the
       list stays short. The choice is remembered on this device. */
    if(!f && !q){
      const GRPS = [['booked','Booked'], ['sent','Sent — awaiting reply'], ['unconfirmed','Not confirmed — on hold'], ['draft','Drafts'], ['delivered','Delivered']];
      const open = pkgGrpsOpen();
      $('#pkgList').innerHTML = GRPS.map(([s, lab])=>{
        let grp = list.filter(x=>(x.status||'draft')===s);
        if(!grp.length) return '';
        if(s === 'booked') grp = [...grp].sort((a,b)=>{ const da = nextShootDate(a)||'9999', db2 = nextShootDate(b)||'9999'; return da<db2?-1:da>db2?1:0; });
        const isOpen = !!open[s];
        return `<div class="grp tog ${isOpen?'':'closed'}" data-grp="${s}" role="button" tabindex="0" aria-expanded="${isOpen}"><span class="car">▾</span>${lab}<b>${grp.length}</b></div>`
          + (isOpen ? grp.map(x=>pkgCardHTML(x, expandedPkg === x.id)).join('') : '');
      }).join('');
      return;
    }
    $('#pkgList').innerHTML = list.map(x=>pkgCardHTML(x, expandedPkg === x.id)).join('');
  }

  /* Ticking a delivery step, from wherever the tracker is on screen — the
     package card, and now a partner studio's job history. It lived inline in
     the package-card handler, which is why the studio page could only ever
     show progress and not move it. */
  async function toggleDeliveryStep(x, name){
    if(!x || !name) return;
    const list = (Array.isArray(x.delivery) ? x.delivery : []).filter(d=>d && d.step);
    const had = list.some(d=>d.step === name);
    const delivery = had ? list.filter(d=>d.step !== name) : [...list, { step: name, date: todayISO() }];
    const steps = stepsFor(x);
    const allDone = steps.length > 0 && steps.every(s=>delivery.some(d=>d.step === s));
    const patch = { delivery, updatedAt: serverTimestamp() };
    let becameDelivered = false;
    if(!had && allDone && (x.status||'draft') === 'booked'
       && await confirmDialog({
            title:'All delivery steps are done',
            body:`Mark <b>${esc(x.clientName||'this package')}</b> as Delivered?`,
            confirmText:'Mark Delivered', danger:false
          })){
      patch.status = 'delivered'; patch.deliveredAt = todayISO(); becameDelivered = true;
    }
    try{
      const res = await settle(updateDoc(doc(db,'packages',x.id), patch));
      /* this used to update the local mirror whatever the server said, so a
         refused write still painted the step ticked */
      if(res === 'denied'){ toast('NOT saved — the server refused this write. Check your sign-in and try again.'); return; }
      x.delivery = delivery;
      if(becameDelivered){ x.status = 'delivered'; x.deliveredAt = patch.deliveredAt; toast('🎉 Package delivered'); }
      buzz();
      renderPkgList();
      if(typeof renderB2B === 'function') renderB2B();   /* the studio page shows this too */
    }catch(err){ toast('Update failed'); }
  }

  async function pkgCardAction(e){
    if(e.target.closest('#pkgEmptyNew')){ openJobType(); return; }
    const gh = e.target.closest('[data-grp]');
    if(gh){ togglePkgGrp(gh.dataset.grp); return; }
    /* Package cards became .card in the component migration; this still looked
       for .lead and so returned on the very first line. That killed EVERY
       action on a booking — expand, status, Edit, PDF, Send, + Payment, Call,
       WhatsApp, Delete and the delivery tracker — on both the Packages tab and
       Home's Bookings box. Only .card here: pkgCardAction is bound to #pkgList
       and #homeBooked, and neither ever holds a lead card. */
    const card = e.target.closest('.card'); if(!card) return;
    const id = card.dataset.id;
    const inHome = !!card.closest('#homeBooked');
    if(e.target.closest('[data-expand]')){
      if(inHome){ expandedHome = (expandedHome === id) ? null : id; renderHomeBooked(); }
      else{ expandedPkg = (expandedPkg === id) ? null : id; renderPkgListOnly(); }
      return;
    }
    const x = PKGS.find(p=>p.id===id); if(!x) return;
    if(e.target.closest('[data-cycle]')){ openStatus(x); return; }
    if(e.target.closest('[data-tstep]')){
      await toggleDeliveryStep(x, e.target.closest('[data-tstep]').dataset.name);
      return;
    }
    if(e.target.closest('[data-edit]')){
      if(!canLeaveEditor()) return;
      if(inHome) $('#tabPkgs').click();   // the editor lives in the Packages tab
      openPkgEdit(x);
      return;
    }
    if(e.target.closest('[data-pdfrow]')){ await makePdf(x); return; }
    if(e.target.closest('[data-wapdf]')){ await makePdf(x, true); return; }
    if(e.target.closest('[data-pay]')){ openPay(x); return; }
    if(e.target.closest('[data-call]')){ location.href = 'tel:+' + waNumberFor(x); return; }
    if(e.target.closest('[data-wachat]')){ openWa('https://wa.me/' + waNumberFor(x)); return; }
    if(e.target.closest('[data-delpkg]')){
      if(!await confirmDialog({
        title:'Move this package to Trash?',
        body:`<b>${esc(x.clientName||'This client')}</b>${x.quoteNo?' · '+esc(x.quoteNo):''} leaves the list. Nothing is erased — you can restore it from Trash.`,
        confirmText:'Move to Trash'
      })) return;
      /* Assignments live in their own collection and are NOT trashed with the
         package: the crew kept seeing the job on their phones while it had
         vanished from your Team tab, with no way left to cancel it. */
      const orphans = ASGS.filter(a=>a.pkgId===id);
      let dropCrew = false;
      if(orphans.length){
        /* This is a two-way CHOICE, not a yes/no gate, and a native confirm
           could only ever offer "OK" and "Cancel" for it — the old copy had to
           spell out in prose what each of those two words would do. Both
           outcomes are named on their own button now. */
        dropCrew = await confirmDialog({
          title:`${orphans.length} crew assignment${orphans.length===1?'' : 's'} attached`,
          body:`${esc(orphans.map(a=>a.memberName||'—').join(', '))} ${orphans.length===1?'is':'are'} booked on this package. Trashing it does not free ${orphans.length===1?'them':'them'} on its own — the crew would keep seeing the job on their phones.`,
          confirmText:`Also free the crew`,
          cancelText:'Keep them booked',
          danger:false
        });
      }
      try{
        const res = await settle(updateDoc(doc(db,'packages',id), { deleted: true, deletedAt: todayISO(), updatedAt: serverTimestamp() }));
        if(res === 'denied'){ toast('NOT deleted — the server refused this write. Check your sign-in and try again.'); return; }
        x.deleted = true; x.deletedAt = todayISO();
        let removedCrew = [];
        if(dropCrew){
          removedCrew = orphans.map(a=>({ ...a }));
          await Promise.allSettled(orphans.map(a=>settle(deleteDoc(doc(db,'assignments',a.id)))));
          ASGS = ASGS.filter(a=>a.pkgId!==id);
          renderTeam();
        }
        renderPkgList();
        toastUndo(dropCrew ? `Package + ${removedCrew.length} assignment${removedCrew.length===1?'':'s'} moved to Trash` : 'Package moved to Trash', async ()=>{
          try{
            const r2 = await settle(updateDoc(doc(db,'packages',id), { deleted: deleteField(), deletedAt: deleteField(), updatedAt: serverTimestamp() }));
            if(r2 === 'denied'){ toast('Undo failed — the server refused the write'); return; }
            delete x.deleted; delete x.deletedAt;
            if(removedCrew.length){
              await Promise.allSettled(removedCrew.map(a=>{
                const { id: aid, ...rest } = a;
                return settle(setDoc(doc(db,'assignments',aid), { ...rest, updatedAt: serverTimestamp() }));
              }));
              loadTeam();
            }
            renderPkgList();
          }catch(err){ toast('Undo failed'); }
        });
      }
      catch(err){ toast('Delete failed'); }
    }
  }
  $('#pkgList').addEventListener('click', pkgCardAction);
  $('#homeBooked').addEventListener('click', pkgCardAction);
  /* View all / show fewer — pkgCardAction ignores clicks outside a card */
  $('#homeBooked').addEventListener('click', e=>{
    if(e.target.closest('[data-hbmore]')){ _homeBookedAll = true; renderHomeBooked(); return; }
    if(e.target.closest('[data-hbless]')){
      _homeBookedAll = false;
      const sec = $('#homeBooked').closest('.sec');
      renderHomeBooked();
      if(sec) sec.scrollIntoView({ behavior:'smooth', block:'start' });
    }
  });
  document.addEventListener('click', e=>{
    const r = e.target.closest('[data-retry]'); if(!r) return;
    const what = r.dataset.retry;
    if(what === 'pkgs'){ loadPkgs(); }
    else if(what === 'team'){ loadTeam(); }
    else if(what === 'studios'){ loadStudios(); }
    else if(what === 'leads'){ loadLeads(); }
    toast('Reconnecting…');
  });

  /* ---------- calendar: every dated event across the panel ---------- */
  let calY, calM, calSel = null;
  /* today is selected from the start: Home opens showing today's events
     instead of "Tap a date to see its events" */
  (function(){ const n = new Date(); calY = n.getFullYear(); calM = n.getMonth(); calSel = n.toLocaleDateString('en-CA'); })();
  /* Rebuilt from scratch on every call, and called many times over — the grid,
     the day box, Next shoot, and once per date inside dateConflicts(), which
     itself runs in a .map() over a package's dates on save. Hold the build for
     the current task only: every caller inside one synchronous render shares
     it, and the next turn of the event loop rebuilds, so a local mutation (a
     status flipped, an event edited, a lead trashed) can never be served a
     stale list. No invalidation to remember, and none to forget. */
  let _calCache = null;
  function calEvents(){
    if(_calCache) return _calCache;
    const evs = [];
    livePkgs().forEach(pk=>{
      (pk.events||[]).forEach(ev=>{
        if(/^\d{4}-\d{2}-\d{2}$/.test(ev.date||''))
          evs.push({ date: ev.date, title: ev.title||'Event', slot: ev.slot||'', client: pk.clientName||'', quoteNo: pk.quoteNo||'', status: pk.status||'draft', kind:'pkg', id: pk.id, venue: ev.venue||'', b2b: isStudioJob(pk) });
      });
    });
    /* the membership test below used to be PKGS.some() per lead — O(leads ×
       packages), which at the 1000/1000 caps is a million comparisons every
       time this ran */
    const livePkgIds = new Set(PKGS.filter(p=>!p.deleted).map(p=>p.id));
    liveLeads().forEach(l=>{
      /* converted: its package owns these dates now and drew them above.
         Checked by id, not by status, so a lead converted back when it was
         already marked 'booked' stops doubling up too. */
      if(l.pkgId && livePkgIds.has(l.pkgId)) return;
      if(l.status !== 'booked') return;
      /* a booked lead's quote can hold several dated events (e.g. 1, 3 & 5 Aug) —
         show them ALL, not just the single weddingDate */
      const qevs = (l.quote && Array.isArray(l.quote.events) ? l.quote.events : [])
        .filter(ev=>/^\d{4}-\d{2}-\d{2}$/.test(ev.date||''));
      if(qevs.length){
        qevs.forEach(ev=>evs.push({ date: ev.date, title: ev.type||'Event', client: l.name||'', status:'lead', kind:'lead', id: l.id, venue:'' }));
      }else if(/^\d{4}-\d{2}-\d{2}$/.test(l.weddingDate||'')){
        evs.push({ date: l.weddingDate, title: l.eventType||'Wedding', client: l.name||'', status:'lead', kind:'lead', id: l.id, venue:'' });
      }
    });
    _calCache = evs;
    queueMicrotask(()=>{ _calCache = null; });
    return evs;
  }
  function renderCalendar(){
    const grid = $('#calGrid'); if(!grid) return;
    const first = new Date(calY, calM, 1);
    const startDow = (first.getDay() + 6) % 7;   // Monday-first week
    const dim = new Date(calY, calM+1, 0).getDate();
    const byDate = {};
    calEvents().forEach(e=>{ (byDate[e.date] = byDate[e.date]||[]).push(e); });
    const todayIso = new Date().toLocaleDateString('en-CA');
    /* Monday-first, so columns 5 and 6 are Sat and Sun — tinted, because most
       functions land on a weekend and the eye needs to find them fast */
    let h = ['M','T','W','T','F','S','S'].map((d,i)=>`<div class="cal-dow ${i>4?'we':''}">${d}</div>`).join('');
    for(let i=0;i<startDow;i++) h += '<div class="cal-cell off"></div>';
    let monthN = 0;
    for(let d=1; d<=dim; d++){
      const iso = `${calY}-${String(calM+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const evs = byDate[iso]||[];
      monthN += evs.length;
      const col = (startDow + d - 1) % 7;
      h += `<div class="cal-cell ${col>4?'we':''} ${iso===todayIso?'today':''} ${evs.length?'has':''} ${iso===calSel?'sel':''}" data-date="${iso}" role="button" tabindex="0" aria-pressed="${iso===calSel}" aria-label="${d} — ${evs.length} event${evs.length===1?'':'s'}">
        <span class="d">${d}</span>
        <div class="dots">${evs.slice(0,4).map(e=>`<i class="dot ${e.status}"></i>`).join('')}${evs.length>4?`<b>+${evs.length-4}</b>`:''}</div>
      </div>`;
    }
    grid.innerHTML = h;
    /* set after the loop — the day cells are what the month's total counts */
    $('#calTitle').innerHTML = `<b>${esc(first.toLocaleDateString('en-IN', { month:'long', year:'numeric' }))}</b>`
      + `<span class="calcount">${monthN ? monthN + ' event' + (monthN===1?'':'s') : 'no events'}</span>`;
    renderCalDetail();
  }
  function renderCalDetail(){
    const box = $('#calDetail'); if(!box) return;
    if(!calSel){
      box.innerHTML = '<div class="empty">Tap a date to see its events.</div>';
      /* only the Home copy depends on a selected date — a form open on a
         studio's B2B page must survive every packages snapshot */
      if(_qeAnchor === 'home') closeCalAdd();
      return;
    }
    const evs = calEvents().filter(e=>e.date===calSel);
    const human = new Date(calSel+'T00:00').toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    const isToday = calSel === new Date().toLocaleDateString('en-CA');
    box.innerHTML = `<div class="sec">
      <div class="cd-head"><h3>${human}${isToday ? ' <span class="todaypill">Today</span>' : ''}</h3><button class="btn btn--sm btn--ghost" type="button" data-addev>＋ Add event</button></div>`
      + (evs.length ? evs.map(e=>{
      const crew = e.kind === 'pkg' ? evCrew(e.id, e.date, e.title) : [];
      return `
      <div class="cal-ev" data-kind="${e.kind}" data-id="${e.id}">
        <i class="dot ${e.status}"></i>
        <div class="cal-ev-t"><b>${esc(e.title)}${slotTag(e.slot)}</b><span>${e.quoteNo ? esc(e.quoteNo) + ' · ' : ''}${e.b2b ? '🏢 ' : ''}${esc(e.client)}${e.venue?' · '+esc(e.venue):''}${crew.length ? ' · 🎬 ' + esc(crew.map(a=>a.memberName||'—').join(', ')) : ''}</span></div>
        <button class="btn btn--sm btn--ghost" data-openev>Open</button>
      </div>`;
    }).join('') : '<div class="empty">No events on this date.</div>') + `</div>`;
    syncQeDate();   /* the open quick-add form follows the selected date */
  }
  /* quick month/year jump — tap the calendar title */
  let jumpY = null;
  function renderCalJump(){
    const el = $('#calJump'); if(el.hidden) return;
    if(jumpY == null) jumpY = calY;
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    el.innerHTML = `<div class="yr"><button data-jy="-1">‹</button><b>${jumpY}</b><button data-jy="1">›</button></div>` +
      months.map((m,i)=>`<button class="mo ${jumpY===calY && i===calM ? 'on':''}" data-jm="${i}">${m}</button>`).join('');
  }
  $('#calTitle').addEventListener('click', ()=>{ const el=$('#calJump'); el.hidden = !el.hidden; jumpY = calY; renderCalJump(); });
  $('#calJump').addEventListener('click', e=>{
    const jy = e.target.closest('[data-jy]'); if(jy){ jumpY += Number(jy.dataset.jy); renderCalJump(); return; }
    const jm = e.target.closest('[data-jm]'); if(jm){ calY = jumpY; calM = Number(jm.dataset.jm); $('#calJump').hidden = true; renderCalendar(); }
  });
  $('#calPrev').addEventListener('click', ()=>{ calM--; if(calM<0){ calM=11; calY--; } renderCalendar(); });
  $('#calNext').addEventListener('click', ()=>{ calM++; if(calM>11){ calM=0; calY++; } renderCalendar(); });
  $('#calToday').addEventListener('click', ()=>{ const n=new Date(); calY=n.getFullYear(); calM=n.getMonth(); calSel=n.toLocaleDateString('en-CA'); renderCalendar(); });
  /* jump to the calendar on Home, focused on a date */
  function gotoCalendar(dateISO){
    if(/^\d{4}-\d{2}-\d{2}$/.test(dateISO||'')){
      calSel = dateISO;
      const d = new Date(dateISO+'T00:00'); calY = d.getFullYear(); calM = d.getMonth();
    }
    $('#tabHome').click();
    renderCalendar();
    const g = $('#calGrid');
    if(g) setTimeout(()=>g.closest('.sec').scrollIntoView({ behavior:'smooth', block:'start' }), 140);
  }
  $('#calGrid').addEventListener('click', e=>{
    const c = e.target.closest('.cal-cell[data-date]'); if(!c) return;
    calSel = c.dataset.date; renderCalendar();
  });
  $('#calDetail').addEventListener('click', e=>{
    if(e.target.closest('[data-addev]')){ openCalAdd(); return; }
    const row = e.target.closest('.cal-ev'); if(!row || !e.target.closest('[data-openev]')) return;
    if(row.dataset.kind === 'pkg'){
      const pk = PKGS.find(x=>x.id===row.dataset.id);
      if(pk){ if(!canLeaveEditor()) return; $('#tabPkgs').click(); openPkgEdit(pk); }
    }else{
      const l = LEADS.find(v=>v.id===row.dataset.id);
      if(l){ $('#leadSearch').value = l.name||''; leadFilterVal = ''; }
      $('#tabLeads').click();
      renderLeads();
    }
  });
  /* ---------- quick "add event" straight from the calendar day box ----------
     Three ways in, all writing the same shape the builder writes:
       client   — a brand-new direct booking with one dated event
       b2b      — the same, owned by a partner studio (no phone: studio jobs
                  must never surface in the client portal — see firestore.rules)
       existing — appends the date to a booking that already exists, so day 2
                  and day 3 of a wedding do NOT become duplicate packages
     No rates are asked for here: the event carries items:[], contributes ₹0 to
     the totals, and the full builder fills in the money later. */
  let _qeMode = 'client', _qeStatus = 'booked';
  /* the same form serves two pages, so it remembers where it was opened from:
     'home' = under the calendar day box, 'b2b' = under a studio's page.
     _qeStudio pins it to that studio (no client mode, and Existing lists only
     that studio's jobs). */
  let _qeAnchor = 'home', _qeStudio = null;
  function syncQeDate(){
    const el = $('#qeDate'); if(!el) return;
    /* on Home the tapped date always wins — tap another cell, the form follows */
    if(_qeAnchor === 'home' && calSel) el.value = calSel;
  }
  function syncQePills(){
    $$('#qeMode button').forEach(b=>b.classList.toggle('on', b.dataset.qem === _qeMode));
    $$('#qeStatus button').forEach(b=>b.classList.toggle('on', b.dataset.qest === _qeStatus));
    $('#qeStWrap').hidden = (_qeMode === 'existing');   /* an existing booking keeps its own status */
    /* the B2B page never starts a direct-client booking */
    $('#qeMode [data-qem="client"]').hidden = (_qeAnchor === 'b2b');
  }
  function renderQeFields(){
    const el = $('#qeFields'); if(!el) return;
    if(_qeMode === 'client'){
      const names = [...new Set(livePkgs().filter(x=>!isStudioJob(x)).map(x=>String(x.clientName||'').trim()).filter(Boolean))].sort();
      el.innerHTML = `
        <div class="fld"><label>Client name</label>
          <input id="qeName" list="qeNames" autocomplete="off" placeholder="e.g. Ayesha &amp; Faraz" />
          <datalist id="qeNames">${names.slice(0,200).map(n=>`<option value="${esc(n)}"></option>`).join('')}</datalist>
        </div>
        <div class="fld"><label>Phone (optional)</label>
          <input id="qePhone" type="tel" inputmode="tel" placeholder="10-digit mobile — this is the client's portal login" />
        </div>`;
    }else if(_qeMode === 'studio'){
      /* a studio deactivated later must still be offered while its own page is open */
      const acts = STUDIOS.filter(s=>s.active !== false || s.id === _qeStudio);
      el.innerHTML = acts.length ? `
        <div class="fld"><label>Partner studio</label>
          <select id="qeStudio">${acts.map(s=>`<option value="${esc(s.id)}" ${s.id === _qeStudio ? 'selected' : ''}>${esc(s.name||'—')}${s.city ? ' · ' + esc(s.city) : ''}</option>`).join('')}</select>
        </div>
        <div class="fld"><label>For end client (optional)</label>
          <input id="qeEnd" placeholder="the studio's own client" />
        </div>`
      : `<div class="qe-warn">No partner studios yet — add one in the <b>B2B</b> tab first, then come back here.</div>`;
    }else{
      /* opened from a studio's page, "Existing" means that studio's own jobs;
         from the B2B list it means studio jobs generally, never a retail one */
      const list = _qeStudio ? studioJobs(_qeStudio)
        : _qeAnchor === 'b2b' ? livePkgs().filter(isStudioJob)
        : livePkgs();
      el.innerHTML = list.length ? `
        <div class="fld"><label>Add this date to</label>
          <select id="qePkg">${list.map(x=>`<option value="${esc(x.id)}">${x.quoteNo ? esc(x.quoteNo) + ' · ' : ''}${esc(x.clientName||'—')}${isStudioJob(x) ? ' 🏢' : ''} · ${esc(STATUS_LABEL(x.status||'draft'))}</option>`).join('')}</select>
        </div>
        <p class="qe-note" style="margin:-.4rem 0 .8rem">${_qeStudio ? 'This studio\'s jobs, newest first.' : 'Newest bookings first.'} Use this for day 2 / day 3 of the same function.</p>`
      : `<div class="qe-warn">${_qeStudio ? 'No jobs for this studio yet — start one with <b>🏢 B2B</b>.'
          : _qeAnchor === 'b2b' ? 'No studio jobs yet — start one with <b>🏢 B2B</b>.'
          : 'No bookings yet — start one with <b>Client</b> or <b>B2B</b>.'}</div>`;
    }
    syncQePills();
  }
  /* opts.studio — a studio doc: opens on that studio's own page, pinned to it.
     opts.b2b    — the B2B list page: same form, studio still to be picked.
     Otherwise it opens under the calendar day box on Home.
     The form is MOVED rather than duplicated, so there is one set of fields and
     one save path. Both anchors are containers that are never innerHTML-rebuilt
     (#studioDetailView is, so the B2B copy sits after it, not inside it). */
  function openCalAdd(opts){
    const node = $('#calAdd'); if(!node) return;
    const stu = (opts && opts.studio) || null;
    _qeStudio = stu ? stu.id : null;
    _qeAnchor = (stu || (opts && opts.b2b)) ? 'b2b' : 'home';
    if(_qeAnchor === 'home'){
      if(!calSel){ toast('Tap a date first'); return; }
      $('#homeView').insertBefore(node, $('#upcoming'));   /* directly under the day box */
    }else if(stu){
      /* a studio's own page: #studioDetailView is rebuilt on every snapshot,
         so the form sits after it, never inside it */
      $('#calView').appendChild(node);
    }else{
      /* the B2B list: directly under the two buttons it was launched from,
         not below a season's worth of studios. The .sec around them is never
         rebuilt — only #studioList itself is. */
      const adds = $('#calView .b2b-adds');
      if(adds && adds.parentNode) adds.parentNode.insertBefore(node, adds.nextSibling);
      else $('#calView').appendChild(node);
    }
    _qeMode = _qeAnchor === 'b2b' ? 'studio' : 'client';
    _qeStatus = 'booked';
    $('#qeTitle').value = ''; $('#qeVenue').value = '';
    $('#qeDate').value = (_qeAnchor === 'home' ? calSel : (calSel || todayISO()));
    $('#qeChips').innerHTML = EVENT_NAMES.map(n=>`<button type="button" class="qchip" data-qename="${esc(n)}">${esc(n)}</button>`).join('');
    $('#qeSlot').innerHTML = SLOTS.map(([v,l])=>`<button type="button" data-sv="${v}">${l}</button>`).join('');
    renderQeFields();
    qeResetSvc();   /* never carry the last event's services into the next one */
    _qeQueue = []; renderQeQueue();
    node.hidden = false;
    syncFabs();   /* the floating buttons would sit on top of the Save row */
    setTimeout(()=>{ if(!node.hidden) node.scrollIntoView({ behavior:'smooth', block:'nearest' }); }, 80);
  }
  function closeCalAdd(){
    const b = $('#calAdd'); if(b) b.hidden = true;
    /* a saved or abandoned job must not leave its dates behind for the next one */
    _qeQueue = []; renderQeQueue();
    if(typeof syncFabs === 'function') syncFabs();
  }
  $('#qeMode').addEventListener('click', e=>{
    const b = e.target.closest('[data-qem]'); if(!b || b.dataset.qem === _qeMode) return;
    _qeMode = b.dataset.qem; renderQeFields();
    qeRefreshSvc();   /* B2B ↔ client is a different rate card; typed rows stay */
  });
  $('#qeStatus').addEventListener('click', e=>{
    const b = e.target.closest('[data-qest]'); if(!b) return;
    _qeStatus = b.dataset.qest; syncQePills();
  });
  $('#qeChips').addEventListener('click', e=>{
    const b = e.target.closest('[data-qename]'); if(!b) return;
    $('#qeTitle').value = b.dataset.qename;
  });
  /* ---- services on the quick sheet ----
     The same rows, chips and rate card the quotation builder uses, so an event
     can be priced the moment it is booked instead of staying a bare date until
     someone opens Packages. Which card applies depends on who the job is for. */
  const qeStudioId = () => {
    if(_qeMode === 'studio'){ const s = $('#qeStudio'); return (s && s.value) || _qeStudio || null; }
    if(_qeMode === 'existing'){
      const s = $('#qePkg'); const pk = s ? PKGS.find(x=>x.id === s.value) : null;
      return (pk && isStudioJob(pk)) ? (pk.studioId || null) : null;
    }
    return null;   /* a direct client is always quoted at retail rates */
  };
  const qeItems = () => readCardItems($('#qeSvc'));
  const itemsGross = items => items.reduce((s,it)=>s + (Number(it.qty)||1)*(Number(it.rate)||0), 0);
  function qeCompute(){
    $$('#qeSvc .itemrow').forEach(r=>{
      const q = Math.max(1, Number(r.querySelector('[data-f="qty"]').value)||1);
      const rt = Math.max(0, Number(r.querySelector('[data-f="rate"]').value)||0);
      r.querySelector('[data-amt]').textContent = inr(q*rt);
    });
    const gross = itemsGross(qeItems());
    $('#qeTot').textContent = gross > 0 ? 'Event total ' + inr(gross) : '';
    return gross;
  }
  function qeRefreshSvc(){ withRates(qeStudioId(), ()=>refreshSvcChips($('#qeSvc'))); }
  function qeResetSvc(){ $('#qeItems').innerHTML = ''; qeRefreshSvc(); qeCompute(); }
  $('#qeAddItem').addEventListener('click', ()=>{
    withRates(qeStudioId(), ()=>$('#qeItems').insertAdjacentHTML('beforeend', itemRowHTML({})));
    qeCompute();
  });
  $('#calAdd').addEventListener('click', e=>{
    /* time of day: tap to set, tap the lit one again to clear it */
    const sl = e.target.closest('#qeSlot [data-sv]');
    if(sl){
      const on = sl.classList.contains('on');
      $$('#qeSlot button').forEach(b=>b.classList.remove('on'));
      if(!on) sl.classList.add('on');
      return;
    }
    if(e.target.closest('[data-qm]') || e.target.closest('[data-qp]')){
      const q = e.target.closest('.itemrow').querySelector('[data-f="qty"]');
      q.value = Math.max(1, (Number(q.value)||1) + (e.target.closest('[data-qp]') ? 1 : -1));
      qeCompute(); return;
    }
    if(e.target.closest('[data-rmitem]')){
      e.target.closest('.itemrow').remove(); qeRefreshSvc(); qeCompute(); return;
    }
    const sv = e.target.closest('[data-addsvc]');
    if(sv){
      const name = sv.dataset.addsvc;
      withRates(qeStudioId(), ()=>$('#qeItems').insertAdjacentHTML('beforeend',
        itemRowHTML({ service: name, qty: 1, rate: Number(allRates()[name])||0 })));
      qeRefreshSvc(); qeCompute();
    }
  });
  $('#calAdd').addEventListener('input', e=>{
    if(e.target.matches('[data-f="qty"],[data-f="rate"]')) qeCompute();
  });
  $('#calAdd').addEventListener('change', e=>{
    /* a different studio (or a different job) means a different rate card */
    if(e.target.id === 'qeStudio' || e.target.id === 'qePkg'){ qeRefreshSvc(); return; }
    if(e.target.matches('[data-f="service"]')){
      const row = e.target.closest('.itemrow');
      const nameInp = row.querySelector('[data-f="serviceName"]');
      if(e.target.value === '__custom'){ nameInp.hidden = false; nameInp.focus(); }
      else{
        nameInp.hidden = true; nameInp.value = '';
        row.querySelector('[data-f="rate"]').value =
          withRates(qeStudioId(), ()=>allRates())[e.target.value] ?? 0;
      }
      qeRefreshSvc(); qeCompute();
    }
  });
  /* ---- several dates, one job ----
     A wedding is rarely one function, and this sheet could only ever save the
     first: the owner had to save, reopen and use 📋 Existing for day 2 and day
     3. Dates are banked here instead and written as one package's events, the
     same shape the quotation builder gives a client booking. */
  let _qeQueue = [];
  /* the date box auto-fills from the tapped calendar day, so a filled date on
     its own does not mean the owner has started another event — the title,
     venue, time or services do */
  const qeFormStarted = () => !!($('#qeTitle').value.trim() || $('#qeVenue').value.trim()
    || $('#qeSlot [data-sv].on') || qeItems().length);
  function qeReadEvent(){
    const date = $('#qeDate').value;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')){ toast('Pick a date for this event'); $('#qeDate').focus(); return null; }
    const title = $('#qeTitle').value.trim();
    if(!title){ toast('Give the event a name'); $('#qeTitle').focus(); return null; }
    return { title, date, slot: ($('#qeSlot [data-sv].on') || {dataset:{}}).dataset.sv || '',
             venue: $('#qeVenue').value.trim(), items: qeItems() };
  }
  function qeClearEvent(){
    $('#qeTitle').value = ''; $('#qeVenue').value = '';
    $$('#qeSlot button').forEach(b=>b.classList.remove('on'));
    qeResetSvc();
  }
  function renderQeQueue(){
    const el = $('#qeQueue'); if(!el) return;
    el.innerHTML = _qeQueue.length
      ? `<div class="qeq-h">${_qeQueue.length} date${_qeQueue.length>1?'s':''} on this job</div>`
        + _qeQueue.map((ev,i)=>`
        <div class="up-ev exprow">
          <span class="when">${esc(dmy(ev.date))}</span>
          <span class="what">${esc(ev.title)}${slotTag(ev.slot)}${ev.venue ? `<span> · ${esc(ev.venue)}</span>` : ''}</span>
          <b>${itemsGross(ev.items) ? esc(inrShort(itemsGross(ev.items))) : ''}</b>
          <button class="icon-btn icon-btn--danger" data-qerm="${i}" title="Remove this date">✕</button>
        </div>`).join('')
      : '';
    /* "all" rather than a count: the form may or may not hold one more, and a
       number that goes stale as you type is worse than no number */
    $('#qeSave').textContent = _qeQueue.length ? 'Save all dates' : 'Save event';
  }
  $('#qeQueue').addEventListener('click', e=>{
    const b = e.target.closest('[data-qerm]'); if(!b) return;
    _qeQueue.splice(Number(b.dataset.qerm), 1);
    renderQeQueue();
  });
  $('#qeMore').addEventListener('click', ()=>{
    const ev = qeReadEvent(); if(!ev) return;
    _qeQueue.push(ev);
    qeClearEvent();
    renderQeQueue();
    toast(`${ev.title} added — now enter the next date`);
    $('#qeDate').focus();
  });
  $('#qeCancel').addEventListener('click', closeCalAdd);
  $('#qeSave').addEventListener('click', async ()=>{
    /* the banked dates, plus whatever is still on the form. With nothing
       banked this is exactly the old single-event path. */
    const evs = [..._qeQueue];
    if(qeFormStarted() || !evs.length){
      const ev = qeReadEvent(); if(!ev) return;
      evs.push(ev);
    }
    if(!evs.length){ toast('Add at least one date'); $('#qeDate').focus(); return; }
    const items = evs.flatMap(e=>e.items||[]);

    /* work out what we are writing, and refuse early rather than half-way */
    let pk = null, stu = null, name = '', rawPhone = '', phone = '';
    if(_qeMode === 'existing'){
      const sel = $('#qePkg');
      pk = sel ? PKGS.find(x=>x.id === sel.value && !x.deleted) : null;
      if(!pk){ toast('Pick a booking to add this date to'); return; }
      name = pk.clientName || '';
    }else if(_qeMode === 'studio'){
      const sel = $('#qeStudio');
      stu = sel ? studioById(sel.value) : null;
      if(!stu){ toast('Pick a partner studio — add one in the B2B tab first'); return; }
      name = stu.name || 'Studio';
    }else{
      name = $('#qeName').value.trim();
      if(!name){ toast('Client name is required'); $('#qeName').focus(); return; }
      /* a second booking under the same name splits that client's events AND
         their money across two records — day 2 of a wedding belongs on the
         booking that already exists */
      const dup = livePkgs().filter(x=>!isStudioJob(x) && String(x.clientName||'').trim().toLowerCase() === name.toLowerCase());
      if(dup.length && !confirm(`"${name}" already has ${dup.length} booking${dup.length>1?'s':''}${dup[0].quoteNo ? ' (' + dup[0].quoteNo + ')' : ''}.\n\nA separate booking splits their events and their payments across two records.\n\nTo add this date to the booking they already have, tap Cancel and use the 📋 Existing tab.\n\nCreate a separate booking anyway?`)) return;
      rawPhone = $('#qePhone').value.trim();
      phone = normPhone(rawPhone);
      /* the portal matches on the LAST 10 DIGITS — a short number locks the
         client out of their own booking with no error anywhere */
      if(rawPhone && phone.length !== 10
         && !confirm(`⚠ "${rawPhone}" doesn't look like a complete mobile number (${phone.length} digits).\n\nThe client portal finds bookings by the last 10 digits — with this one, the client will NOT be able to log in.\n\nSave anyway?`)){
        $('#qePhone').focus(); return;
      }
    }
    const status = _qeMode === 'existing' ? (pk.status||'draft') : _qeStatus;
    if(status === 'booked'){
      /* every date being saved, not just the last one typed */
      const busy = evs.map(e=>({ d: e.date, c: dateConflicts(e.date, pk ? pk.id : null, name) }))
                      .filter(r=>r.c.length >= DATE_EVENT_CAP);
      if(busy.length){
        const f = busy[0];
        if(!confirm(`⚠ Heavy day: ${stepDate(f.d)} already has ${f.c.length} events booked (${f.c[0].title} — ${f.c[0].client}${f.c.length>1 ? ', +' + (f.c.length-1) + ' more' : ''})${busy.length>1 ? `, and ${busy.length-1} more of these dates ${busy.length===2?'is':'are'} full too` : ''}. Add anyway?`)) return;
      }
    }

    const btn = $('#qeSave'); if(btn.disabled) return;
    btn.disabled = true;
    try{
      let res, okMsg;
      if(_qeMode === 'existing'){
        const events = [...(pk.events||[]), ...evs];
        const patch = { events, updatedAt: serverTimestamp() };
        /* A priced event has to move the money with it, or the booking keeps
           its old total: the balance would be wrong, the payment sheet would
           ask for too little and the money reports would under-count. Same
           sum the builder computes — every event's services plus the album,
           less the discount already agreed; recorded payments stay put. */
        if(items.length){
          const gross = events.reduce((s,e)=>s + itemsGross(e.items||[]), 0)
                      + (Number((pk.album||{}).price)||0);
          const t = Object.assign({ gross:0, discount:0, finalPrice:0, advance:0, balance:0 }, pk.totals||{});
          const discount = Math.min(gross, Math.max(0, Number(t.discount)||0));
          const finalPrice = gross - discount;
          const advance = Math.max(0, Number(t.advance)||0);
          patch.totals = { gross, discount, finalPrice, advance, balance: finalPrice - advance };
        }
        res = await settle(updateDoc(doc(db,'packages',pk.id), patch));
        if(res !== 'denied'){ pk.events = events; if(patch.totals) pk.totals = patch.totals; }
        okMsg = `${evs.length > 1 ? evs.length + ' dates added to' : 'Added to'} ${pk.quoteNo ? pk.quoteNo + ' · ' : ''}${pk.clientName||''}`
              + (items.length ? ` — ${inr(patch.totals.finalPrice)} total` : '');
      }else{
        const b2b = _qeMode === 'studio';
        const d = {
          clientName: b2b ? (stu.name || 'Studio') : name,
          careOf: '',
          clientPhone: b2b ? '' : phone,
          clientPhoneFull: b2b || !phone ? '' : normPhoneFull(rawPhone),
          quoteDate: todayISO(),
          events: evs,
          album: { sheets:0, perSheet:0, price:0 },
          addons: [],
          pdfTerms: b2b ? [] : pdfTerms(),
          totals: (g => ({ gross:g, discount:0, finalPrice:g, advance:0, balance:g }))(itemsGross(items)),
          ...(b2b
            ? { clientType:'studio', studioId: stu.id, studioName: stu.name || 'Studio',
                whiteLabel: false, endClientName: ($('#qeEnd') ? $('#qeEnd').value.trim() : '') }
            : { clientType:'direct' })
        };
        const quoteNo = await allocQuoteNo();
        const ref = doc(collection(db,'packages'));
        res = await settle(setDoc(ref, { ...d, quoteNo, status,
          ...(status === 'sent' ? { sentAt: todayISO() } : {}),
          createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
        /* drafts don't unlock the portal pre-check — indexing one makes a
           stranger burn a real OTP and then land on "No bookings found" */
        if(res !== 'denied' && !b2b && phone.length === 10 && status !== 'draft') ensurePhoneIndex(phone);
        okMsg = `${quoteNo} saved — ${STATUS_LABEL(status)}`
              + (evs.length > 1 ? ` · ${evs.length} dates` : '')
              + (items.length ? ` · ${inr(itemsGross(items))}` : '');
      }
      if(res === 'denied'){ toast('NOT saved — the server refused the write. Nothing was added.'); return; }
      toast(res === 'queued' ? 'Saved offline — will sync' : okMsg);
      closeCalAdd();
      loadPkgs();
    }catch(err){ toast('Could not save: ' + (err.code||err.message)); }
    finally{ btn.disabled = false; }
  });

  /* ---------- lead -> package bridge ---------- */
  /* Converting used to COPY the enquiry and leave it behind: the same wedding
     then lived in two records with two independent status ladders, and if the
     lead was also marked 'booked' its dates drew twice on the calendar. Store
     each id on the other and retire the lead the moment its package exists.
     A failure here is a nuisance, never a loss — the package is already saved. */
  async function linkConvertedLead(leadId, pkgId, quoteNo){
    if(!leadId || !pkgId) return;
    const patch = { status: 'converted', pkgId, convertedAt: todayISO() };
    if(quoteNo) patch.quoteNo = quoteNo;
    try{
      const res = await settle(updateDoc(doc(db,'leads',leadId), patch));
      if(res === 'denied'){
        toast('Package saved — but the lead was not updated. Set it to Converted by hand so it stops showing as open.');
        return;
      }
      const l = LEADS.find(v=>v.id===leadId);
      if(l) Object.assign(l, patch);
      renderStats(); renderLeads(); renderCalendar();
    }catch(err){
      toast('Package saved — but the lead could not be marked Converted (' + (err.code||err.message) + ')');
    }
  }

  /* The website builder and the quotation builder name the same services
     differently ("Traditional Photo" vs "Traditional Photography"), so a
     converted lead used to arrive with every common service at ₹0 as a
     "Custom service…" row — and hand-fixing the rate then taught the builder
     a duplicate service name forever. Map to the canonical rate-card name. */
  const LEAD_SVC_ALIAS = {
    'Traditional Photo': 'Traditional Photography',
    'Traditional Video': 'Traditional Videography',
    'Female Shooter': 'Female Photographer – Ladies Section',
  };
  function leadServiceRate(key, label){
    const rates = allRates();
    if(rates[label] != null) return { service: label, rate: Number(rates[label])||0 };
    const alias = LEAD_SVC_ALIAS[label];
    if(alias && rates[alias] != null) return { service: alias, rate: Number(rates[alias])||0 };
    /* not on the quotation rate card at all (LED screen, live streaming…):
       fall back to the public-site price the client was actually quoted */
    const web = Number(((CFG && CFG.prices) || DEFAULTS.prices || {})[key]) || 0;
    return { service: alias || label, rate: web };
  }
  function pkgFromLead(l){
    _bStudioId = null;   /* leads are always direct clients — never inherit a studio's rate card */
    const q = l.quote || {};
    const events = (q.events||[]).map(ev=>({
      title: String(ev.type||'Event').toUpperCase(),
      date: /^\d{4}-\d{2}-\d{2}$/.test(ev.date||'') ? ev.date : '',
      venue: '',
      items: Object.entries(ev.services||{}).filter(([,qty])=>Number(qty)>0).map(([k,qty])=>{
        const r = leadServiceRate(k, SERVICE_LABELS[k] || k);
        return { service: r.service, qty: Number(qty)||1, rate: r.rate };
      })
    /* a dated function with no services ticked is still a date to hold */
    })).filter(ev=>ev.items.length || ev.date);
    const sheets = Number(q.albumSheets)||0;
    return {
      leadId: l.id,
      clientName: l.name||'', careOf:'', clientPhone: l.phone||'',
      clientPhoneFull: l.phoneFull || '',   /* keeps NRI leads dialling their real country code */
      quoteDate: todayISO(),
      events: events.length ? events : [{title:'', date:'', venue:'', items:[]}],
      album: { sheets, perSheet: sheets>0 ? learnedAlbumRate() : 0, price: sheets * (sheets>0 ? learnedAlbumRate() : 0) },
      addons: [], totals: {}
    };
  }

  /* ============================================================
     TEAM — members, per-event crew assignments, crew pay
     Data lives in two collections:
       team/{id}         one doc per member (email = employee-page login)
       assignments/{id}  one doc per member-per-event; carries denormalised
                         event details + pay so the employee page never has
                         to read packages. Employees may only flip
                         status→acknowledged (enforced in Firestore rules).
     ============================================================ */
  /* the shooting crafts, then post, then support */
  const TEAM_ROLES = ['photography','candid photography','cinematography','videography','iphone shoot','drone','led','editor','assistant'];
  /* title-case, except the one word that is never spelled with a capital I */
  const roleLabel = r => String(r||'').replace(/\b\w/g, c=>c.toUpperCase())
    .replace(/\bIphone\b/g, 'iPhone').replace(/\bLed\b/g, 'LED');

  /* ---------- crew pay: agreed fee, part-payments, what is still owed ----------
     A shoot can be settled in instalments, so pay.payments[] is the record and
     pay.paidAmount its running sum. Rows written before instalments existed
     carry only pay.paid + pay.paidDate, so every reader goes through these
     helpers and old rows keep reading correctly with nothing to migrate. */
  const payFee = a => Math.max(0, Number(((a||{}).pay||{}).amount)||0);
  function payGot(a){
    const p = (a||{}).pay || {};
    if(p.paidAmount !== undefined && p.paidAmount !== null) return Math.max(0, Number(p.paidAmount)||0);
    return p.paid ? Math.max(0, Number(p.amount)||0) : 0;   /* legacy: paid meant paid in full */
  }
  const payDue = a => Math.max(0, payFee(a) - payGot(a));
  /* 'paid' only when a real fee has been fully settled; 'part' once money has
     moved but not all of it; 'due' otherwise */
  function payState(a){
    const fee = payFee(a), got = payGot(a);
    if(got > 0 && fee <= 0) return 'paid';   /* money paid against no fee is settled, not part-paid */
    if(fee > 0 && got >= fee) return 'paid';
    return got > 0 ? 'part' : 'due';
  }
  /* every instalment as {amount, date, mode} — used wherever crew pay has to be
     bucketed by WHEN it left, which the single legacy paidDate cannot express */
  function payEvents(a){
    const p = (a||{}).pay || {};
    if(Array.isArray(p.payments) && p.payments.length){
      return p.payments.map(x=>({ amount: Math.max(0, Number(x.amount)||0),
                                  date: String(x.date||''), mode: String(x.mode||'') }));
    }
    if(p.paid) return [{ amount: Math.max(0, Number(p.amount)||0), date: String(p.paidDate||''), mode: String(p.mode||'') }];
    return [];
  }
  let TEAM = [], ASGS = [], REQS = [];
  let _teamUnsub = null, _asgsUnsub = null, _reqsUnsub = null, _teamLoaded = false, _asgsLoaded = false;
  let LB_HAS = false;   /* the leaderboard has something to show (set by its renderer) */
  let _asgsFresh = false;   /* true once a server (non-cache) assignments snapshot has arrived */
  /* a listener error used to be painted into the list and then wiped by the
     next render's skeleton — the owner was left staring at a shimmer forever
     with no way to retry. Remember the failure and offer a retry button. */
  let _teamErr = '', _asgsErr = '', _reqsErr = '';
  const errBox = (msg, retry) => `<div class="empty-state">
      <span class="empty-state__icon">⚠️</span>
      <p class="empty-state__title">Could not load</p>
      <p class="empty-state__text">${esc(msg)}</p>
      <button type="button" class="btn btn--ghost" data-retry="${retry}">↻ Try again</button>
    </div>`;
  const TEAM_CAP = 500, ASGS_CAP = 2000, REQS_CAP = 100;
  const memberById = id => TEAM.find(m=>m.id===id);
  const activeTeam = () => TEAM.filter(m=>m.active !== false);
  $('#tmRole').innerHTML = TEAM_ROLES.map(r=>`<option value="${r}">${roleLabel(r)}</option>`).join('');
  $('#asRole').innerHTML = TEAM_ROLES.map(r=>`<option value="${r}">${roleLabel(r)}</option>`).join('');

  /* crew log in on /team/ with phone OTP — the last-10-digits key is the same
     NRI-safe convention the client portal uses for packages */
  const phone10Of = p => String(p||'').replace(/\D/g,'').slice(-10);
  const memberPhone10 = m => m ? (m.phone10 || phone10Of(m.phone)) : '';

  function loadTeam(){
    _teamErr = _teamUnsub ? _teamErr : '';
    _asgsErr = _asgsUnsub ? _asgsErr : '';
    /* keep going past this early-return check for the reqs listener below —
       after a transient error it used to stay dead until a full reload */
    if(_teamUnsub && _asgsUnsub && _reqsUnsub){ renderTeam(); return; }
    if(_teamUnsub && _asgsUnsub) renderTeam();
    if(!_teamUnsub){
      try{
        _teamUnsub = onSnapshot(query(collection(db,'team'), orderBy('createdAt','desc'), limit(TEAM_CAP)), snap=>{
          TEAM = snap.docs.map(d=>({ id:d.id, ...d.data() }))
            .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
          warnIfCapped('team members', snap.size, TEAM_CAP);
          _teamLoaded = true;
          renderTeam();
        }, err=>{
          try{ if(_teamUnsub) _teamUnsub(); }catch(e){} _teamUnsub = null;
          _teamErr = 'Could not load the team (' + (err.code||err.message) + ')';
          renderTeam();
        });
      }catch(err){ _teamErr = 'Could not load the team (' + (err.code||err.message) + ')'; renderTeam(); }
    }
    if(!_asgsUnsub){
      try{
        _asgsUnsub = onSnapshot(query(collection(db,'assignments'), orderBy('date','desc'), limit(ASGS_CAP)),
          { includeMetadataChanges: true }, snap=>{
          ASGS = snap.docs.map(d=>({ id:d.id, ...d.data() }));
          warnIfCapped('assignments', snap.size, ASGS_CAP);
          _asgsLoaded = true;
          if(!snap.metadata.fromCache) _asgsFresh = true;
          syncStudioCrew();   /* partner portal reads crew off the package doc */
          renderTeam();
          renderPkgStats();   /* the crew-pay tile on Home reads these */
          if($('#finModal').classList.contains('open')) renderFin();
          if(!$('#homeView').hidden) renderCalDetail();   /* the calendar sits on Home */
        }, err=>{
          try{ if(_asgsUnsub) _asgsUnsub(); }catch(e){} _asgsUnsub = null;
          _asgsErr = 'Could not load assignments (' + (err.code||err.message) + ')';
          renderTeam();
        });
      }catch(err){ _asgsErr = 'Could not load assignments (' + (err.code||err.message) + ')'; renderTeam(); }
    }
    if(!_reqsUnsub){
      try{
        _reqsUnsub = onSnapshot(query(collection(db,'teamRequests'), orderBy('createdAt','desc'), limit(REQS_CAP)), snap=>{
          REQS = snap.docs.map(d=>({ id:d.id, ...d.data() }));
          _reqsErr = '';
          /* the section's visibility and the Crew badge are decided in
             renderTeam — rendering the rows alone would leave an approved
             request on screen with a stale badge beside it */
          renderTeam();
        }, err=>{
          try{ if(_reqsUnsub) _reqsUnsub(); }catch(e){} _reqsUnsub = null;
          /* This used to fail in total silence: a rules problem meant join
             requests simply never appeared, with nothing on screen saying so
             and no way to retry. Every other listener says what broke. */
          _reqsErr = 'Could not load join requests (' + (err.code||err.message) + ')';
          renderTeam();
        });
      }catch(err){
        _reqsErr = 'Could not load join requests (' + (err.code||err.message) + ')';
        renderTeam();
      }
    }
  }

  /* A package is identified by its quote number first — the client name alone
     is ambiguous the moment a couple books twice, and the owner reads the quote
     number off the PDF and off WhatsApp. One helper so every list agrees. */
  const qnoOf = x => (x && x.quoteNo) ? String(x.quoteNo) : '';
  const pkgLabel = x => [qnoOf(x), (x && x.clientName) || '—'].filter(Boolean).join(' · ');
  const qnoTag = q => q ? `<span class="qtag">${esc(q)}</span>` : '';
  const asWhoText = c => [c.quoteNo, (c.eventTitle || 'Event') + slotSuffix(c.slot), c.clientName || '—',
                          stepDate(c.date) || c.date].filter(Boolean).join(' · ');

  /* booked-package events from today onward, soonest first */
  function teamUpcoming(){
    const today = todayISO();
    const rows = [];
    livePkgs().filter(x=>(x.status||'draft')==='booked').forEach(pk=>{
      (pk.events||[]).forEach((ev,idx)=>{
        if(/^\d{4}-\d{2}-\d{2}$/.test(ev.date||'') && ev.date >= today) rows.push({ pk, ev, idx });
      });
    });
    return rows.sort((a,b)=>a.ev.date<b.ev.date?-1:a.ev.date>b.ev.date?1:0);
  }
  /* crew whose stored date matches this exact event */
  /* Two functions of the same package on ONE date (e.g. Nikah morning +
     Reception evening) used to show each other's crew, because a match on
     pkgId+date alone cannot tell them apart. Narrow by event title in that
     case — assignments carry it. */
  function evCrew(pkId, date, title){
    /* editing is attached to an event but is not crew ON the day — counting it
       made a wedding with an editor look staffed when nobody was shooting */
    const rows = ASGS.filter(a=>a.pkgId===pkId && a.date===date && a.kind !== 'edit');
    if(!title || rows.length < 2) return rows;
    const pk = PKGS.find(p=>p.id===pkId);
    const sameDay = pk ? (pk.events||[]).filter(e=>e.date===date).length : 1;
    if(sameDay < 2) return rows;
    const t = String(title).trim().toLowerCase();
    const exact = rows.filter(a=>String(a.eventTitle||'').trim().toLowerCase() === t);
    return exact.length ? exact : rows.filter(a=>!a.eventTitle);
  }
  /* crew pointing at this package but at a date the package no longer has —
     the event was edited after assigning. Shown with a sync button. */
  const staleCrew = pk => ASGS.filter(a=>a.pkgId===pk.id
    && !(pk.events||[]).some(ev=>ev.date===a.date));

  /* which of the six roles a booked service calls for. Order matters: candid
     and cinematography are their own crafts, not "a photographer" and "a
     videographer". Drone maps to nobody — whoever is shooting flies it. */
  function neededRoles(ev){
    const n = {};
    (ev.items||[]).forEach(it=>{
      const s = String(it.service||'').toLowerCase(), q = Number(it.qty)||1;
      /* drone and LED are matched before the generic photo/video tests —
         "drone video" is a drone job, not a videography one */
      const r = /drone|aerial/.test(s) ? 'drone'
              : /\bled\b|led wall|led screen/.test(s) ? 'led'
              : /candid/.test(s) ? 'candid photography'
              : /cinema/.test(s) ? 'cinematography'
              : /iphone|mobile/.test(s) ? 'iphone shoot'
              : /photo/.test(s) ? 'photography'
              : /video/.test(s) ? 'videography'
              : '';
      if(r) n[r] = (n[r]||0) + q;
    });
    return n;
  }

  /* What a shooter actually needs the night before: which function, when to be
     there, where, and what they are doing. The crew page has all of it, but
     nothing pushed it to them — the studio's WhatsApp habit was the gap.
     Deliberately no fee: this gets forwarded around crew groups. */
  function callSheetText(a){
    const when = /^\d{4}-\d{2}-\d{2}$/.test(a.date||'')
      ? new Date(a.date+'T00:00').toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'}) : '';
    return [
      `*Fantasy Studio* — call sheet`,
      '',
      `*${a.eventTitle || 'Event'}*${slotSuffix(a.slot)}${a.clientName ? ' — ' + a.clientName : ''}`,
      when ? `📅 ${when}` : '',
      a.callTime ? `⏰ Call time ${a.callTime}` : '⏰ Call time to be confirmed',
      a.venue ? `📍 ${a.venue}` : '',
      `🎬 You are on ${roleLabel(a.role)}`,
      a.notes ? `📝 ${a.notes}` : '',
      '',
      'Please open your crew page and confirm.'
    ].filter(v=>v !== '').join('\n');
  }
  const crewWaNumber = a => {
    const m = memberById(a.memberId);
    const p = (m && m.phone) || a.memberPhone10 || '';
    return p ? String(normPhoneFull(p)).replace(/\D/g,'') : '';
  };

  function crewRowHTML(a, extra){
    const seen = a.status === 'acknowledged';
    /* the member's own "completed" is the later, stronger signal — once it is
       in, showing "seen" tells the owner nothing they still need */
    const pill = a.workDone
      ? '<span class="ackpill seen" title="Marked completed by the member">✓ done</span>'
      : `<span class="ackpill ${seen?'seen':'wait'}">${seen?'✓ seen':'⏳ not seen'}</span>`;
    const wa = a.kind === 'edit' ? '' : crewWaNumber(a);
    return `
      <div class="tm-crew" data-asedit="${a.id}">
        <span class="nm2">${esc(a.memberName||'—')}</span>
        <span class="rl">${esc(roleLabel(a.role))}${a.callTime ? ' · call ' + esc(a.callTime) : ''}${(a.pay||{}).amount ? ' · ' + inr(a.pay.amount) : ''}</span>
        ${extra || pill}
        ${(!extra && wa) ? `<button class="csbtn" type="button" data-callsheet="${esc(a.id)}" title="WhatsApp ${esc(a.memberName||'them')} the call sheet" aria-label="Send call sheet to ${esc(a.memberName||'this member')}">📤</button>` : ''}
      </div>`;
  }

  const TEAM_EV_N = 10;
  let _teamEvAll = false;
  function renderTeamEvents(){
    const el = $('#teamEvents'); if(!el) return;
    if(_asgsErr){ el.innerHTML = errBox(_asgsErr, 'team'); return; }
    const all = teamUpcoming();
    if(!all.length){
      el.innerHTML = (_pkgsLoaded && _asgsLoaded)
        ? '<div class="empty" style="padding:.4rem 0">No upcoming booked events. Events appear here once a package is <b style="color:var(--ok)">booked</b> and its dates are set.</div>'
        : '<div class="skeleton"></div><div class="skeleton"></div>';
      return;
    }
    /* a full season runs to dozens of dates — the next ten are the ones being
       crewed this week; the rest are one tap away */
    const rows = _teamEvAll ? all : all.slice(0, TEAM_EV_N);
    const today = todayISO();
    const staleShown = new Set();
    el.innerHTML = rows.map(({pk, ev, idx})=>{
      const crew = evCrew(pk.id, ev.date, ev.title);
      const need = neededRoles(ev);
      const needTotal = Object.values(need).reduce((a,b)=>a+b, 0);
      const needTxt = Object.entries(need).map(([r,q])=>`${q}× ${roleLabel(r)}`).join(' · ');
      /* The card used to print the requirement — "Needs 2× Photography · 1×
         Cinematography" — and leave the owner to subtract the crew listed
         below it in their head. Count the roles already on the event off
         against it and say what is actually still missing. */
      const have = {};
      crew.forEach(a=>{ const r = String(a.role||'').trim().toLowerCase(); if(r) have[r] = (have[r]||0) + 1; });
      const gap = Object.entries(need).map(([r,q])=>[r, q - (have[r]||0)]).filter(([,q])=>q > 0);
      const gapTxt = gap.map(([r,q])=>`${q}× ${roleLabel(r)}`).join(' · ');
      /* stale crew (event date was edited after assigning) surfaces once per
         package, on its first upcoming row, with a one-tap re-sync */
      let stale = [];
      if(!staleShown.has(pk.id)){ stale = staleCrew(pk); if(stale.length) staleShown.add(pk.id); }
      /* how full this event is, and how close it is — the two things that
         decide which row gets crewed next */
      const unconf = crew.filter(a=>a.status !== 'acknowledged').length;
      const days = Math.round((new Date(ev.date+'T00:00') - new Date(today+'T00:00'))/864e5);
      const away = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days}d`;
      const fill = needTotal ? Math.min(100, Math.round(100*crew.length/needTotal)) : (crew.length ? 100 : 0);
      /* Role-aware, not headcount: three photographers on a job that wants two
         photographers and a cinematographer used to read as fully crewed. */
      const state = !crew.length ? 'none' : (needTotal && gap.length) ? 'part' : 'full';
      return `
      <div class="tm-ev ${state}">
        <div class="tm-ev-h">
          <div class="tm-ev-t">
            <div class="l1">
              <span class="when">${stepDate(ev.date)}</span>
              <span class="away ${days<=2?'soon':''}">${away}</span>
              <b>${esc(ev.title||'Event')}${slotTag(ev.slot)}</b>
            </div>
            <span class="cl">${pk.quoteNo ? esc(pk.quoteNo) + ' · ' : ''}${isStudioJob(pk) ? '🏢 ' : ''}${esc(pk.clientName||'—')}${ev.venue ? ' · 📍 ' + esc(ev.venue) : ''}</span>
          </div>
          <button class="btn btn--sm btn--ghost" data-asadd data-aspk="${pk.id}" data-asev="${idx}">＋ Assign</button>
        </div>
        <div class="tm-fill">
          <span class="fbar"><i style="width:${fill}%"></i></span>
          <b class="${state}">${crew.length}${needTotal ? '/' + needTotal : ''} crew</b>
          ${unconf ? `<em>${unconf} not confirmed</em>`
            /* "all confirmed" in green beside a half-staffed shoot two days out
               read as reassurance. It is only good news once the event is
               actually crewed. */
            : (crew.length && state === 'full' ? '<em class="ok">all confirmed</em>' : '')}
        </div>
        ${needTotal ? (gapTxt
            ? `<div class="tm-need" title="This event needs ${esc(needTxt)}">Still needs <b class="miss">${esc(gapTxt)}</b></div>`
            : `<div class="tm-need" title="This event needs ${esc(needTxt)}">Fully crewed <b class="ok2">✓</b></div>`)
          : ''}
        ${crew.map(a=>crewRowHTML(a)).join('')}
        ${stale.map(a=>crewRowHTML(a, `<span class="ackpill stale">⚠ ${esc(stepDate(a.date)||a.date||'date?')}</span><button class="btn btn--sm btn--ghost" data-assync="${a.id}" data-aspk="${pk.id}" data-asev="${idx}">Sync</button>`)).join('')}
      </div>`;
    }).join('')
    + (all.length > TEAM_EV_N
        ? `<button class="upall" type="button" data-tmev>${_teamEvAll ? '− Show fewer' : `＋ See all ${all.length} — ${all.length - TEAM_EV_N} more`}</button>`
        : '');
  }
  $('#teamEvents').addEventListener('click', e=>{
    if(!e.target.closest('[data-tmev]')) return;
    _teamEvAll = !_teamEvAll;
    renderTeamEvents();
  });

  /* ============================================================
     TEAM CONSOLE — the same rank maths the crew page shows its own
     members, so a level here and a level there always agree. Everything
     is derived from the assignment docs this tab already holds.
     ============================================================ */
  const XP_EVENT = 10, XP_ACK = 2, XP_EDIT = 5;
  const TEAM_RANKS = [
    { xp:0,    t:'Rookie' },  { xp:50,   t:'Crew' },    { xp:120,  t:'Shooter' },
    { xp:250,  t:'Senior' },  { xp:450,  t:'Lead' },    { xp:750,  t:'Veteran' },
    { xp:1200, t:'Master' },  { xp:1800, t:'Legend' },  { xp:2600, t:'Icon' },
    { xp:3600, t:'Maestro' },
  ];
  function tmRank(xp){
    let i = 0;
    while(i + 1 < TEAM_RANKS.length && xp >= TEAM_RANKS[i+1].xp) i++;
    const cur = TEAM_RANKS[i], next = TEAM_RANKS[i+1] || null;
    return { lvl:i+1, title:cur.t,
             pct: next ? Math.min(100, Math.round(100*(xp-cur.xp)/(next.xp-cur.xp))) : 100 };
  }
  const initials = n => String(n||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase() || '?';
  function memberStats(mid){
    const today = todayISO(), mon = today.slice(0,7);
    const list = ASGS.filter(a=>a.memberId === mid);
    const done = list.filter(a=>(a.date||'') < today);
    const up   = list.filter(a=>(a.date||'') >= today);
    const acks = list.filter(a=>a.status === 'acknowledged').length;
    const edits = list.filter(a=>a.workDone).length;
    const due = list.reduce((s,a)=>s + payDue(a), 0);
    const xp = done.length*XP_EVENT + acks*XP_ACK + edits*XP_EDIT;
    return { list, done, up, acks, edits, due, xp, rank: tmRank(xp),
             month: done.filter(a=>(a.date||'').slice(0,7) === mon).length,
             pending: up.filter(a=>a.status !== 'acknowledged').length,
             next: up.map(a=>a.date).filter(Boolean).sort()[0] || '',
             rate: list.length ? Math.round(100*acks/list.length) : null };
  }

  /* What an editor hands over maps onto the package's own delivery checklist,
     so signing the edit off can tick the step instead of the owner hunting for
     it in the package card. Matched on keywords, because the checklist is the
     studio's to rename in Config. */
  function stepForDeliver(x, deliver){
    const steps = stepsFor(x) || [];
    const d = String(deliver||'').toLowerCase();
    const want = /album/.test(d) ? /album designed/i
      : /teaser|reel/.test(d) ? /teaser/i
      : /video|cinema/.test(d) ? /video edited/i
      : /photo/.test(d) ? /photo.*(ready|edited)/i
      : null;
    if(!want) return '';
    return steps.find(st=>want.test(st)) || '';
  }
  async function tickDeliveryStep(pkgId, step){
    const x = PKGS.find(p=>p.id===pkgId); if(!x || !step) return;
    const list = (Array.isArray(x.delivery) ? x.delivery : []).filter(d=>d && d.step);
    if(list.some(d=>d.step === step)){ toast('Already ticked'); return; }
    const delivery = [...list, { step, date: todayISO() }];
    const res = await settle(updateDoc(doc(db,'packages',pkgId), { delivery, updatedAt: serverTimestamp() }));
    const sm = settleMsg(res, `“${step}” ticked ✓`);
    toast(sm.msg);
    if(!sm.ok) return;
    x.delivery = delivery;
    buzz(); renderPkgList(); renderTeam();
  }

  /* ---------- editing desk ----------
     Post-production is the one job that is NOT about the day it is attached
     to: it is booked against an event but delivered weeks later, so it sorts
     by its own deadline and stays out of the shoot schedule above. */
  function renderEditDesk(){
    const el = $('#edList'); if(!el) return;
    const jobs = ASGS.filter(a=>a.kind === 'edit');
    if(!jobs.length){
      $('#edCount').textContent = '';
      el.innerHTML = '<div class="empty" style="padding:.5rem 0">No editing assigned yet. Use <b style="color:var(--gold-b)">＋ Assign editing</b> below — it reaches shoots that have already happened.</div>';
      return;
    }
    const today = todayISO();
    const open = jobs.filter(a=>!a.workDone).sort((a,b)=>(a.dueDate||'9999') < (b.dueDate||'9999') ? -1 : 1);
    const done = jobs.filter(a=>a.workDone).sort((a,b)=>(a.dueDate||'') > (b.dueDate||'') ? -1 : 1);
    const late = open.filter(a=>(a.dueDate||'') && a.dueDate < today).length;
    $('#edCount').innerHTML = late ? `<b style="color:var(--warn)">${late} overdue.</b>` : '';
    const dueChip = a => {
      if(!/^\d{4}-\d{2}-\d{2}$/.test(a.dueDate||'')) return '<span class="duetag">no date</span>';
      const d = Math.round((new Date(a.dueDate+'T00:00') - new Date(today+'T00:00'))/864e5);
      const cls = d < 0 ? 'late' : d <= 3 ? 'soon' : '';
      const txt = d < 0 ? Math.abs(d) + 'd late' : d === 0 ? 'today' : d === 1 ? 'tomorrow' : 'in ' + d + 'd';
      return `<span class="duetag ${cls}">${txt}</span>`;
    };
    const row = a => {
      const pk = PKGS.find(p=>p.id===a.pkgId);
      const late = !a.workDone && (a.dueDate||'') && a.dueDate < today;
      const m = memberById(a.memberId);
      const wa = (m && m.phone) ? String(normPhoneFull(m.phone)).replace(/\D/g,'') : '';
      /* an edit signed off whose delivery step is still unticked — one tap
         instead of finding the package and the step by hand */
      const step = (a.workDone && pk) ? stepForDeliver(pk, a.deliver) : '';
      const stepDone = step && (Array.isArray(pk.delivery) ? pk.delivery : []).some(d=>d && d.step === step);
      return `
      <div class="ed-row ${a.workDone ? 'ok' : ''}">
        <span class="w" data-asedit="${a.id}" role="button" tabindex="0">${esc(stepDate(a.dueDate) || '—')}</span>
        <span class="t" data-asedit="${a.id}" role="button" tabindex="0">
          <b>${esc(a.clientName||'—')}${a.scope === 'package' ? ' · all functions' : ''}</b>
          ${qnoTag(a.quoteNo)}
          <span>${esc(a.deliver || a.eventTitle || 'Editing')} · ${esc(a.memberName||'—')}</span>
        </span>
        ${late && wa ? `<button class="edact" data-nudge="${a.id}" title="Remind the editor">💬</button>` : ''}
        ${step && !stepDone ? `<button class="edact tick" data-tick="${a.id}" title="Tick “${esc(step)}” on the package">✓ step</button>` : ''}
        ${a.workDone ? '<span class="duetag ok">✓ done</span>' : dueChip(a)}
      </div>`;
    };
    el.innerHTML = (open.length ? open.map(row).join('')
                                : '<div class="empty" style="padding:.5rem 0">Nothing outstanding — every edit is signed off ✓</div>')
      + (done.length ? `<div class="grp tog ${_edShowDone?'':'closed'}" data-edgrp role="button" tabindex="0" aria-expanded="${_edShowDone}"><span class="car">▾</span>Completed<b>${done.length}</b></div>`
          + (_edShowDone ? done.map(row).join('') : '') : '');
  }
  let _edShowDone = false;
  $('#edList').addEventListener('click', e=>{
    if(e.target.closest('[data-edgrp]')){ _edShowDone = !_edShowDone; renderEditDesk(); return; }
    const nd = e.target.closest('[data-nudge]');
    if(nd){
      const a = ASGS.find(v=>v.id===nd.dataset.nudge); if(!a) return;
      const m = memberById(a.memberId); if(!m || !m.phone) return;
      const days = Math.round((new Date(todayISO()+'T00:00') - new Date(a.dueDate+'T00:00'))/864e5);
      openWa('https://wa.me/' + String(normPhoneFull(m.phone)).replace(/\D/g,'') + '?text=' + encodeURIComponent(
        `Salaam ${m.name||''}! The ${a.deliver||'editing'} for ${a.clientName||'the booking'} was due ${stepDate(a.dueDate)}` +
        `${days > 0 ? ` — ${days} day${days===1?'':'s'} ago` : ''}. How is it looking?`));
      return;
    }
    const tk = e.target.closest('[data-tick]');
    if(tk){
      const a = ASGS.find(v=>v.id===tk.dataset.tick); if(!a) return;
      const pk = PKGS.find(p=>p.id===a.pkgId); if(!pk) return;
      const step = stepForDeliver(pk, a.deliver); if(!step) return;
      if(confirm(`Tick “${step}” as done on ${pk.clientName||'this package'}?`)) tickDeliveryStep(pk.id, step);
      return;
    }
    const r = e.target.closest('[data-asedit]'); if(!r) return;
    const a = ASGS.find(v=>v.id===r.dataset.asedit); if(!a) return;
    openAs({ pkgId: a.pkgId, quoteNo: a.quoteNo||'', clientName: a.clientName||'',
             eventTitle: a.eventTitle||'', slot: a.slot||'', date: a.date||'', venue: a.venue||'' }, a);
  });

  /* Editing is handed out AFTER the shoot, so it cannot come off the upcoming
     list — that only reaches forward. This offers every booked event from the
     last eight months onward, most recent first, which is where a wedding
     waiting to be edited actually sits. */
  /* One row per QUOTE, not per function: editing is bought for a booking, and
     a three-day wedding listed as three near-identical dates was the wrong
     shape to pick from. The functions live in a second select, and only when
     the job is not the whole booking. */
  function bookingRows(){
    const cutoff = new Date(Date.now() - 240*864e5).toLocaleDateString('en-CA');
    return livePkgs()
      .filter(x=>['booked','delivered'].includes(x.status||'draft'))
      .map(pk=>{
        const evs = (pk.events||[]).filter(e=>/^\d{4}-\d{2}-\d{2}$/.test(e.date||''))
          .sort((a,b)=>a.date < b.date ? -1 : 1);
        return { pk, evs, last: evs.length ? evs[evs.length-1].date : '' };
      })
      .filter(r=>r.evs.length && r.last >= cutoff)
      .sort((a,b)=>a.last < b.last ? 1 : -1);
  }
  const spanOf = r => r.evs.length > 1
    ? stepDate(r.evs[0].date) + ' – ' + stepDate(r.last)
    : stepDate(r.last);
  /* whole booking → the last function carries the job; otherwise the chosen one */
  function ctxOfRow(r){
    const whole = $('#asWhole').checked;
    const ev = whole ? r.evs[r.evs.length-1] : (r.evs[Number($('#asBookEv').value)] || r.evs[r.evs.length-1]);
    return { pkgId: r.pk.id, quoteNo: r.pk.quoteNo||'', clientName: r.pk.clientName||'',
             eventTitle: ev.title||'', slot: ev.slot||'', date: ev.date||'', venue: ev.venue||'' };
  }
  function fillBookings(){
    const today = todayISO();
    $('#asBook').innerHTML = _bookRows.map((r,i)=>
      `<option value="${i}">${r.pk.quoteNo ? esc(r.pk.quoteNo) + ' · ' : ''}${esc(r.pk.clientName||'—')} · ${esc(spanOf(r))}${r.last < today ? ' (shot)' : ''}</option>`).join('');
    fillBookingEvents();
  }
  function fillBookingEvents(){
    const r = _bookRows[Number($('#asBook').value)];
    const wrap = $('#asBookEvWrap');
    /* one function, or the whole booking: nothing to choose */
    wrap.hidden = !r || r.evs.length < 2 || $('#asWhole').checked || $('#asBookWrap').hidden;
    if(!r) return;
    /* syncAsUI runs on every pick and every role change — resetting the choice
       each time would snatch back the function the owner had just selected */
    const keep = $('#asBookEv').value;
    $('#asBookEv').innerHTML = r.evs.map((e,i)=>
      `<option value="${i}">${esc(stepDate(e.date))} · ${esc(e.title||'Event')}</option>`).join('');
    const n = Number(keep);
    $('#asBookEv').value = String(keep !== '' && n >= 0 && n < r.evs.length ? n : r.evs.length - 1);
  }
  function reBook(){
    const r = _bookRows[Number($('#asBook').value)]; if(!r) return;
    _asCtx = ctxOfRow(r);
    $('#asWho').textContent = asWhoText(_asCtx);
    $('#asDue').value = '';            /* re-derived from the chosen function */
    renderAsPick(); syncAsUI(); refreshAsConflict();
  }
  $('#edAdd').addEventListener('click', ()=>{
    _bookRows = bookingRows();
    if(!_bookRows.length){ toast('No booked events yet — book a package first, then assign its editing'); return; }
    $('#asWhole').checked = true;      /* per-quote picker: the whole booking is the default */
    $('#asBook').innerHTML = '';
    _bookRows.length && ($('#asBookWrap').hidden = false);
    fillBookings();
    openAs(ctxOfRow(_bookRows[0]), null, { pickBooking: true, forceEdit: true, whole: true });
  });
  /* a different booking starts on its own last function, not the index the
     previous one happened to be on */
  $('#asBook').addEventListener('change', ()=>{ $('#asBookEv').value = ''; fillBookingEvents(); reBook(); });
  $('#asBookEv').addEventListener('change', reBook);

  /* Upcoming events and Editing are two different jobs — one is staffing a
     day, the other is chasing a deadline — so they are two tabs rather than
     two stacked sections you scroll past. */
  const WORK_TABS = [['up','📅 Upcoming'],['edit','✂️ Editing']];
  let _teamTab = 'up';
  function renderWorkTabs(){
    const el = $('#workTabs'); if(!el) return;
    const today = todayISO();
    const n = { up: teamUpcoming().length,
                edit: ASGS.filter(a=>a.kind === 'edit' && !a.workDone).length };
    const late = ASGS.filter(a=>a.kind === 'edit' && !a.workDone && (a.dueDate||'') && a.dueDate < today).length;
    el.innerHTML = WORK_TABS.map(([k,l])=>
      `<button type="button" data-wtab="${k}" class="${_teamTab===k?'on':''}">${l}<b class="${k==='edit'&&late?'late':''}">${n[k]}</b></button>`).join('');
    $('#workUp').hidden = _teamTab !== 'up';
    $('#workEd').hidden = _teamTab !== 'edit';
  }
  $('#workTabs').addEventListener('click', e=>{
    const b = e.target.closest('[data-wtab]'); if(!b || b.dataset.wtab === _teamTab) return;
    _teamTab = b.dataset.wtab;
    renderWorkTabs();
  });
  wireSwipe($('#workSec'), {
    keys: ()=>WORK_TABS.map(([k])=>k),
    cur:  ()=>_teamTab,
    go:   k=>{ _teamTab = k; renderWorkTabs(); },
    skip: t=>!!(t && t.closest && t.closest('#workTabs')),
    box:  ()=>$('#workBody'),
  });

  /* the league table — the one view that says who is actually carrying the season */
  let _lbPeriod = 'y';
  function renderLeaderboard(){
    const sec = $('#lbSec'), el = $('#lbList'); if(!sec || !el) return;
    const today = todayISO();
    const from = _lbPeriod === 'm' ? today.slice(0,7) : _lbPeriod === 'y' ? today.slice(0,4) : '';
    const done = ASGS.filter(a=>(a.date||'') < today && (!from || (a.date||'').startsWith(from)));
    /* visibility belongs to applyTeamSeg — this section lives under Crew */
    LB_HAS = !!ASGS.length;
    if(!ASGS.length) return;
    const by = {};
    done.forEach(a=>{
      const k = a.memberId || a.memberName || '?';
      by[k] = by[k] || { name: (memberById(a.memberId)||{}).name || a.memberName || '—', id: a.memberId, n:0, amt:0 };
      by[k].n++; by[k].amt += Number((a.pay||{}).amount)||0;
    });
    const rows = Object.values(by).sort((a,b)=>b.n - a.n || b.amt - a.amt);
    if(!rows.length){
      el.innerHTML = `<div class="empty" style="padding:.8rem 0">No shoots completed ${_lbPeriod==='m'?'this month':_lbPeriod==='y'?'this year':'yet'}.</div>`;
      return;
    }
    const top = rows[0].n || 1;
    const medal = i => i===0 ? '🥇' : i===1 ? '🥈' : i===2 ? '🥉' : (i+1);
    el.innerHTML = rows.slice(0,12).map((r,i)=>`
      <div class="lb-row ${i<3?'top g'+(i+1):''}">
        <span class="pos">${medal(i)}</span>
        <span class="av">${esc(initials(r.name))}</span>
        <span class="lb-mid">
          <b>${esc(r.name)}</b>
          <span class="lb-bar"><i style="width:${Math.round(100*r.n/top)}%"></i></span>
        </span>
        <span class="lb-n"><b>${r.n}</b><span>${r.amt ? inr(r.amt) : 'shoots'}</span></span>
      </div>`).join('');
  }
  $('#lbTog').addEventListener('click', e=>{
    const b = e.target.closest('[data-lb]'); if(!b || b.dataset.lb === _lbPeriod) return;
    _lbPeriod = b.dataset.lb;
    $$('#lbTog button').forEach(x=>x.classList.toggle('on', x === b));
    renderLeaderboard();
  });

  let _tmShowInactive = false;
  function renderSquadCats(){
    const el = $('#squadCats'); if(!el) return;
    /* only worth showing once both kinds actually exist */
    const have = new Set(TEAM.map(catOf));
    if(TEAM.length < 2 || have.size < 2){ el.innerHTML = ''; return; }
    const counts = { all: TEAM.length, outdoor: 0, office: 0 };
    TEAM.forEach(m=>counts[catOf(m)]++);
    el.innerHTML = [['all','Everyone'], ['outdoor', CAT_LABEL.outdoor], ['office', CAT_LABEL.office]]
      .map(([k,label])=>`<button type="button" data-squadcat="${k}" class="${_squadCat===k?'on':''}">${label} <b>${counts[k]}</b></button>`).join('');
  }
  let _squadCat = viewGet('squad','all');
  $('#squadCats').addEventListener('click', e=>{
    const b = e.target.closest('[data-squadcat]'); if(!b) return;
    _squadCat = b.dataset.squadcat; viewSet('squad', _squadCat);
    renderSquadCats(); renderTeamMembers();
  });

  function renderTeamMembers(){
    const el = $('#teamMembers'); if(!el) return;
    if(_teamErr){ el.innerHTML = errBox(_teamErr, 'team'); return; }
    if(!TEAM.length){
      el.innerHTML = _teamLoaded
        ? `<div class="empty-state">
             <span class="empty-state__icon">🎬</span>
             <p class="empty-state__title">No team members yet</p>
             <p class="empty-state__text">Add your shooters, editors and assistants — they get their own crew page and show up in the assign picker.</p>
             <button type="button" class="btn btn--primary" data-tm-add>＋ Add a member</button>
           </div>`
        : '<div class="skeleton"></div><div class="skeleton"></div>';
      return;
    }
    const inCat = m => _squadCat === 'all' || catOf(m) === _squadCat;
    /* busiest first, so the roster reads as a squad sheet rather than a list */
    const act = TEAM.filter(m=>m.active !== false && inCat(m))
      .map(m=>({ m, s: memberStats(m.id) }))
      .sort((a,b)=>b.s.xp - a.s.xp);
    const inact = TEAM.filter(m=>m.active === false && inCat(m)).map(m=>({ m, s: memberStats(m.id) }));
    if(!act.length && !inact.length){
      el.innerHTML = `<div class="empty" style="padding:.4rem 0">No ${_squadCat === 'office' ? 'office' : 'outdoor'} members yet.</div>`;
      return;
    }
    const C = 113.1;   /* 2πr for r=18 */
    const row = ({m, s}) => {
      const wa = m.phone ? String(normPhoneFull(m.phone)).replace(/\D/g,'') : '';
      return `
      <div class="sq ${m.active === false ? 'off' : ''}" data-tmedit="${m.id}" role="button" tabindex="0" aria-label="Edit ${esc(m.name||'member')}">
        <div class="sq-h">
          <span class="sq-av">
            <svg viewBox="0 0 40 40" aria-hidden="true">
              <circle class="rbg" cx="20" cy="20" r="18"></circle>
              <circle class="rfg" cx="20" cy="20" r="18" style="stroke-dashoffset:${C - C*s.rank.pct/100}"></circle>
            </svg>
            <i>${esc(initials(m.name))}</i>
          </span>
          <span class="sq-t">
            <b>${esc(m.name||'—')}</b>
            <span>${esc(CAT_LABEL[catOf(m)])} · ${esc(roleLabel(m.role))}${m.defaultRate ? ' · ' + inr(m.defaultRate) + '/event' : ''}${memberPhone10(m) ? '' : ' · ⚠ no phone'}</span>
          </span>
          <span class="sq-acts">
            ${m.phone ? `<a class="icon-btn icon-btn--ring" href="tel:${esc(m.phone)}" onclick="event.stopPropagation()" title="Call" aria-label="Call ${esc(m.name||'')}">📞</a>` : ''}
            ${wa ? `<a class="icon-btn icon-btn--ring" href="https://wa.me/${wa}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="WhatsApp" aria-label="WhatsApp ${esc(m.name||'')}">💬</a>` : ''}
          </span>
        </div>
        <div class="sq-m">
          <span class="lvchip">Lv ${s.rank.lvl} · ${esc(s.rank.title)}</span>
          <span>🎬 <b>${s.done.length}</b> done</span>
          <span>⏭ <b>${s.up.length}</b> ahead</span>
          ${s.pending ? `<span class="due">⏳ <b>${s.pending}</b> unconfirmed</span>` : ''}
          ${s.due ? `<span class="due">💰 <b>${inr(s.due)}</b> due</span>` : ''}
          ${s.next ? `<span>next <b>${esc(stepDate(s.next))}</b></span>` : '<span>free</span>'}
        </div>
      </div>`;
    };
    el.innerHTML = act.map(row).join('')
      + (inact.length ? `<div class="grp tog ${_tmShowInactive?'':'closed'}" data-tmgrp role="button" tabindex="0" aria-expanded="${_tmShowInactive}"><span class="car">▾</span>Inactive<b>${inact.length}</b></div>` + (_tmShowInactive ? inact.map(row).join('') : '') : '');
  }

  function renderTeamReqs(){
    const sec = $('#teamReqSec'), el = $('#teamReqs'); if(!sec || !el) return;
    const pending = REQS.filter(r=>(r.status||'pending') === 'pending');
    /* visibility belongs to applyTeamSeg — this section lives under Crew */
    const badge = $('#teamBadge');
    if(badge){ badge.hidden = !pending.length; badge.textContent = pending.length; }
    if(_reqsErr){ el.innerHTML = errBox(_reqsErr, 'team'); return; }
    /* no early return on empty: mapping an empty list clears the rows, so an
       approved or dismissed request cannot linger in the DOM behind a hidden
       section and reappear the next time Crew is opened */
    el.innerHTML = pending.map(r=>`
      <div class="up-ev" style="cursor:default">
        <span class="what"><b>${esc(r.name||'—')}</b> <span>${r.note ? '· “' + esc(r.note) + '”' : ''}</span></span>
        ${(r.phoneFull||r.phone10) ? `<a class="icon-btn icon-btn--ring" href="tel:${esc(String(r.phoneFull||r.phone10).replace(/[^\d+]/g,''))}" title="${esc(r.phoneFull||r.phone10)}" aria-label="Call ${esc(r.name||'this person')}">📞</a>` : ''}
        <button class="btn btn--sm btn--ghost" data-reqok="${esc(r.id)}">Approve</button>
        <button class="icon-btn icon-btn--danger" data-reqno="${esc(r.id)}" title="Dismiss">✕</button>
      </div>`).join('');
  }
  $('#teamReqs').addEventListener('click', async e=>{
    const ok = e.target.closest('[data-reqok]');
    const no = e.target.closest('[data-reqno]');
    if(ok){
      const r = REQS.find(v=>v.id===ok.dataset.reqok); if(!r) return;
      const existing = TEAM.find(m=>memberPhone10(m) && memberPhone10(m) === r.phone10);
      if(existing && existing.active === false){
        /* a returning member: reactivating is what the owner actually wants,
           not "this is a duplicate" */
        if(!confirm(`${existing.name||'This person'} is on your team but marked inactive.\n\nReactivate them now?`)) return;
        try{
          const res = await settle(updateDoc(doc(db,'team',existing.id), { active: true, updatedAt: serverTimestamp() }));
          const sm = settleMsg(res, `${existing.name||'Member'} reactivated ✓ — their crew page is unlocked`);
          toast(sm.msg);
          if(!sm.ok) return;
          existing.active = true;
          await settle(deleteDoc(doc(db,'teamRequests',r.id)));
          renderTeam();
        }catch(err){ toast('Could not reactivate'); }
        return;
      }
      if(existing){
        if(confirm(`${existing.name||'A member'} already has this number — this request is a duplicate. Remove it?`)){
          try{ toast(settleMsg(await settle(deleteDoc(doc(db,'teamRequests',r.id))), 'Duplicate request removed').msg); }
          catch(err){ toast('Could not remove the request'); }
        }
        return;
      }
      openTm(null);
      _tmFromReq = r.id;
      $('#tmTitle').textContent = 'Approve — Add Team Member';
      $('#tmName').value = r.name||'';
      $('#tmPhone').value = r.phoneFull||r.phone10||'';
      return;
    }
    if(no){
      const r = REQS.find(v=>v.id===no.dataset.reqno); if(!r) return;
      if(!await confirmDialog({
        title:'Dismiss this join request?',
        body:`<b>${esc(r.name||'This person')}</b> can request again from the crew page — dismissing only clears it from your list.`,
        confirmText:'Dismiss'
      })) return;
      try{ toast(settleMsg(await settle(deleteDoc(doc(db,'teamRequests',r.id))), 'Request dismissed').msg); }
      catch(err){ toast('Could not dismiss'); }
    }
  });

  let _payOpen = new Set();
  function renderTeamPay(){
    const el = $('#teamPay'); if(!el) return;
    if(!ASGS.length){
      el.innerHTML = _asgsLoaded
        ? '<div class="empty" style="padding:.4rem 0">Nothing here yet — pay rows appear as you assign crew to events.</div>'
        : '<div class="skeleton"></div>';
      return;
    }
    const byMember = {};
    ASGS.forEach(a=>{ (byMember[a.memberId] = byMember[a.memberId]||[]).push(a); });
    /* the ✓/○ prefixes only explained themselves in title tooltips, which a
       touch screen never shows — one visible line instead */
    el.innerHTML = '<p class="sub" style="margin:0 0 .5rem">✓ marked completed by the member · ○ shot done, not marked yet</p>'
      + Object.entries(byMember).map(([mid, list])=>{
      const m = memberById(mid);
      const name = (m && m.name) || list[0].memberName || '—';
      const due = list.reduce((s,a)=>s + payDue(a), 0);
      const got = list.reduce((s,a)=>s + payGot(a), 0);
      const open = _payOpen.has(mid);
      /* one handover, one entry point — the shoots it covers are worked out
         for you rather than opened one at a time */
      const nDue = list.filter(a=>payDue(a) > 0).length;
      const head = `<div class="grp tog ${open?'':'closed'}" data-pmgrp="${esc(mid)}" role="button" tabindex="0" aria-expanded="${open}"><span class="car">▾</span>${esc(name)}<b>${due > 0 ? inr(due) + ' due' : (got > 0 ? 'all paid ✓' : 'nothing due')}</b>${
        due > 0 ? `<button class="btn btn--sm btn--ghost pmall" type="button" data-pmall="${esc(mid)}" title="Settle ${inr(due)} across ${nDue} shoot${nDue===1?'':'s'}">Settle all</button>` : ''}</div>`;
      if(!open) return head;
      const rows = [...list].sort((a,b)=>a.date<b.date?1:-1).map(a=>{
        const p = a.pay||{};
        const st = payState(a);
        const gone = !livePkgs().some(pk=>pk.id===a.pkgId);
        /* members sign their own work off from the crew page */
        const scissors = a.workDone
          ? '<span title="Completed — marked by the member" style="color:var(--ok)">✓ </span>'
          : (a.date||'') < todayISO() ? '<span title="Not marked completed yet" style="color:var(--warn)">○ </span>'
          : '';
        return `
        <div class="pm-row">
          <span class="ev2">${scissors}${gone ? '<span title="Package deleted">⚠ </span>' : ''}${esc(stepDate(a.date)||a.date||'—')} · ${esc(a.eventTitle||'Event')}${slotTag(a.slot)} <span>· ${a.quoteNo ? esc(a.quoteNo) + ' · ' : ''}${esc(a.clientName||'')}</span></span>
          <span class="amt2">${inr(payFee(a))}${st === 'part' ? `<i class="got2">${inr(payGot(a))} paid</i>` : ''}</span>
          ${st === 'paid'
            ? `<button class="paid2" data-unpaid="${a.id}" title="Tap to see or correct this payment">Paid ${esc(stepDate(p.paidDate)||'')}</button>`
            : st === 'part'
              ? `<button class="btn btn--sm btn--ghost part2" data-cpay="${a.id}">${inr(payDue(a))} left</button>`
              : `<button class="btn btn--sm btn--ghost" data-cpay="${a.id}">Pay</button>`}
        </div>`;
      }).join('');
      return head + rows;
    }).join('');
  }

  function renderTeamStats(){
    const el = $('#teamStats'); if(!el) return;
    const today = todayISO();
    const up = teamUpcoming();
    const unfilled = up.filter(({pk, ev})=>!evCrew(pk.id, ev.date, ev.title).length).length;
    const unconf = ASGS.filter(a=>(a.date||'') >= today && a.status !== 'acknowledged').length;
    /* the crew-pay-due figure rides the Pay section's own badge now, so this
       strip stays one compact row and the work starts near the top */
    el.innerHTML = `
      <div class="stat"><b>${up.length}</b><span>upcoming</span></div>
      <div class="stat ${unfilled?'warn':''}"><b>${unfilled}</b><span>with no crew</span></div>
      <div class="stat ${unconf?'warn':''}"><b>${unconf}</b><span>unconfirmed</span></div>
      <div class="stat"><b>${activeTeam().length}</b><span>active crew</span></div>`;
  }

  /* Work = rostering, Crew = the people, Pay = the money. Only one is on
     screen, so no job is ever four screens below another. */
  let _tSeg = 'work';
  try{ const s = localStorage.getItem('fs_team_seg'); if(['work','crew','pay'].includes(s)) _tSeg = s; }catch(e){}
  function applyTeamSeg(){
    $$('#teamSegs button').forEach(b=>{
      const on = b.dataset.tseg === _tSeg;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('#workSec').hidden     = _tSeg !== 'work';
    $('#squadSec').hidden    = _tSeg !== 'crew';
    $('#lbSec').hidden       = _tSeg !== 'crew' || !LB_HAS;
    /* an error has to be visible too, or the one thing that explains the empty
       inbox is hidden by the same rule that hides an empty inbox */
    $('#teamReqSec').hidden  = _tSeg !== 'crew' || !(reqCount() || _reqsErr);
    $('#paySec').hidden      = _tSeg !== 'pay';
  }
  const reqCount = () => REQS.filter(r=>(r.status||'pending') === 'pending').length;
  function setTeamSeg(seg){
    if(!['work','crew','pay'].includes(seg)) return;
    _tSeg = seg;
    try{ localStorage.setItem('fs_team_seg', seg); }catch(e){}
    applyTeamSeg();
    /* Switching section should show that section from its start. The bar is
       sticky, so its own top never goes negative — measure against where it
       parks (just under the header) and scroll only when the page has moved
       past it. */
    const t = $('#teamSegs'), hdr = $('#hdr');
    if(!t) return;
    const parked = hdr ? hdr.getBoundingClientRect().height : 56;
    if(t.getBoundingClientRect().top <= parked + 1){
      const y = t.getBoundingClientRect().top + window.scrollY - parked;
      window.scrollTo({ top: Math.max(0, y), behavior: 'auto' });
    }
  }
  $('#teamSegs').addEventListener('click', e=>{
    const b = e.target.closest('[data-tseg]'); if(!b) return;
    setTeamSeg(b.dataset.tseg);
  });

  function renderTeam(){
    if(!$('#teamView')) return;
    renderTeamStats();
    renderTeamReqs();
    renderTeamEvents();
    renderEditDesk();
    renderWorkTabs();
    renderLeaderboard();
    renderSquadCats();
    renderTeamMembers();
    renderTeamPay();
    /* badges so an unseen request or an unpaid crew member is never hidden
       behind a section the owner is not looking at */
    const rq = reqCount();
    $('#segCrewB').hidden = !rq;
    $('#segCrewB').textContent = rq || '';
    const due = ASGS.reduce((s,a)=>s + payDue(a), 0);
    $('#segPayB').hidden = !(due > 0);
    $('#segPayB').textContent = due > 0 ? inrShort(due) : '';
    applyTeamSeg();
  }

  /* ---------- member add / edit sheet ---------- */
  let _tmEditId = null, _tmFromReq = null;
  /* Two kinds of people on the payroll: the ones who go out to shoots and the
     ones who work from the studio. Members saved before this existed have no
     `cat`, and they were all shoot crew, so 'outdoor' is the read default. */
  const TM_CATS = ['outdoor','office'];
  const catOf = m => TM_CATS.includes((m||{}).cat) ? m.cat : 'outdoor';
  const CAT_LABEL = { outdoor:'🎥 Outdoor', office:'🏢 Office' };
  let _tmCat = 'outdoor';
  function setTmCat(c){
    _tmCat = TM_CATS.includes(c) ? c : 'outdoor';
    $('#tmCatOut').classList.toggle('on', _tmCat === 'outdoor');
    $('#tmCatOff').classList.toggle('on', _tmCat === 'office');
  }
  $('#tmCatOut').addEventListener('click', ()=>setTmCat('outdoor'));
  $('#tmCatOff').addEventListener('click', ()=>setTmCat('office'));

  function openTm(m){
    _tmEditId = m ? m.id : null;
    _tmFromReq = null;
    $('#tmTitle').textContent = m ? 'Edit Team Member' : 'Add Team Member';
    $('#tmName').value = m ? (m.name||'') : '';
    setTmCat(m ? catOf(m) : 'outdoor');
    $('#tmRole').value = m && TEAM_ROLES.includes(m.role) ? m.role : TEAM_ROLES[0];
    $('#tmPhone').value = m ? (m.phone||'') : '';
    $('#tmRate').value = m && m.defaultRate ? m.defaultRate : '';
    const tog = $('#tmToggle');
    tog.hidden = !m;
    if(m){
      const off = m.active === false;
      tog.textContent = off ? 'Reactivate this member' : 'Deactivate (keeps their history)';
      tog.style.color = off ? 'var(--ok)' : 'var(--err)';
    }
    $('#tmModal').classList.add('open'); $('#tmBackdrop').classList.add('open');
    setTimeout(()=>$('#tmName').focus(), 80);
    pushView('tmsheet', '#team/member');
  }
  function closeTmUI(){ $('#tmModal').classList.remove('open'); $('#tmBackdrop').classList.remove('open'); _tmEditId = null; _tmFromReq = null; }
  function closeTm(){
    backFrom('tmsheet', closeTmUI);
  }
  $('#tmClose').addEventListener('click', closeTm);
  $('#tmBackdrop').addEventListener('click', closeTm);
  $('#tmAdd').addEventListener('click', ()=>openTm(null));
  $('#tmSave').addEventListener('click', async ()=>{
    const btn = $('#tmSave'); if(btn.disabled) return;
    const name = $('#tmName').value.trim();
    if(!name){ toast('Name is required'); $('#tmName').focus(); return; }
    const phone = $('#tmPhone').value.trim();
    const p10 = phone10Of(phone);
    if(phone && p10.length < 10){ toast('That phone number looks too short'); $('#tmPhone').focus(); return; }
    if(!phone && !confirm('No phone number — they will NOT be able to open the crew page (it signs in by phone OTP). Save anyway?')) return;
    if(p10 && TEAM.some(m=>m.id !== _tmEditId && memberPhone10(m) === p10)
       && !confirm('Another member already uses this number — both would share one crew login. Save anyway?')) return;
    const data = { name, cat: _tmCat, role: $('#tmRole').value, phone, phone10: p10,
                   defaultRate: Math.max(0, Math.round(Number($('#tmRate').value)||0)), updatedAt: serverTimestamp() };
    btn.disabled = true;
    try{
      if(_tmEditId){
        const old = TEAM.find(m=>m.id===_tmEditId);
        const res = await settle(updateDoc(doc(db,'team',_tmEditId), data));
        const sm = settleMsg(res, 'Member saved ✓');
        toast(sm.msg);
        if(!sm.ok) return;
        /* the crew page matches assignments by memberPhone10, and shows
           memberName — keep existing assignment docs in step when either
           changes (also heals docs from before the phone-login switch) */
        if(old && (memberPhone10(old) !== p10 || (old.name||'') !== name)){
          const mine = ASGS.filter(a=>a.memberId===_tmEditId);
          /* settle() each write — raw updateDoc promises never resolve while
             offline, which froze this sheet mid-save until signal returned */
          await Promise.allSettled(mine.map(a=>settle(updateDoc(doc(db,'assignments',a.id),
            { memberName: name, memberPhone10: p10, updatedAt: serverTimestamp() }))));
          mine.forEach(a=>{ a.memberName = name; a.memberPhone10 = p10; });
        }
        Object.assign(old||{}, data, { updatedAt: null });
      }else{
        const ref = doc(collection(db,'team'));
        const res = await settle(setDoc(ref, { ...data, active: true, createdAt: serverTimestamp() }));
        const sm = settleMsg(res, 'Member added ✓');
        toast(sm.msg);
        if(!sm.ok) return;
        TEAM.push({ id: ref.id, ...data, active: true });
        TEAM.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
      }
      renderTeam();
      const fromReq = _tmFromReq;
      closeTm();
      /* saving a member from a join request = approving it — clear the
         request so it leaves the inbox; their crew page unlocks live */
      if(fromReq){
        /* settle(), so an offline approval reports honestly instead of leaving
           the request sitting in the inbox with a success toast over it */
        try{
          const rq = await settle(deleteDoc(doc(db,'teamRequests',fromReq)));
          toast(rq === 'denied'
            ? 'Member saved — but the join request could not be cleared. Dismiss it by hand.'
            : rq === 'queued' ? 'Member saved — the request clears when you are back online'
            : 'Approved ✓ — their crew page is now unlocked');
        }catch(err){ toast('Member saved — but the join request could not be cleared'); }
      }
    }catch(err){ toast('Save failed: ' + (err.code||err.message)); }
    finally{ btn.disabled = false; }
  });
  $('#tmToggle').addEventListener('click', async ()=>{
    const m = TEAM.find(v=>v.id===_tmEditId); if(!m) return;
    const next = !(m.active === false);   /* true → deactivate */
    try{
      const res = await settle(updateDoc(doc(db,'team',m.id), { active: !next, updatedAt: serverTimestamp() }));
      const sm = settleMsg(res, next ? 'Member deactivated' : 'Member reactivated');
      toast(sm.msg);
      if(!sm.ok) return;
      m.active = !next;
      renderTeam();
      closeTm();
    }catch(err){ toast('Update failed'); }
  });
  $('#teamMembers').addEventListener('click', e=>{
    if(e.target.closest('[data-tm-add]')){ openTm(null); return; }
    const g = e.target.closest('[data-tmgrp]');
    if(g){ _tmShowInactive = !_tmShowInactive; renderTeamMembers(); return; }
    const row = e.target.closest('[data-tmedit]'); if(!row) return;
    const m = TEAM.find(v=>v.id===row.dataset.tmedit);
    if(m) openTm(m);
  });

  /* ---------- assign sheet ---------- */
  let _asEditId = null, _asCtx = null;
  function asgConflicts(mid, date, excludeId){
    return ASGS.filter(a=>a.memberId===mid && a.date===date && a.id!==excludeId);
  }
  /* ---- crew picker: who is free, who the event actually needs, and more
     than one at a time. A three-photographer wedding used to be three trips
     through this sheet. ---- */
  let _asPicked = new Set();
  function asEventOf(ctx){
    const pk = ctx && PKGS.find(p=>p.id===ctx.pkgId);
    if(!pk) return null;
    const evs = (pk.events||[]).filter(e=>e.date === ctx.date);
    return evs.find(e=>String(e.title||'') === String(ctx.eventTitle||'')) || evs[0] || null;
  }
  function refreshAsConflict(){
    const box = $('#asConflict');
    const clash = [..._asPicked].map(id=>({ m: memberById(id), cs: _asCtx ? asgConflicts(id, _asCtx.date, _asEditId) : [] }))
      .filter(x=>x.cs.length);
    box.hidden = !clash.length;
    if(clash.length){
      const f = clash[0];
      box.textContent = `⚠ ${(f.m&&f.m.name)||'This member'} is already on ${f.cs[0].eventTitle||'an event'} (${f.cs[0].clientName||'—'}) that day`
        + (clash.length > 1 ? `, and ${clash.length-1} other${clash.length>2?'s':''} clash too` : '')
        + '. You can still save if this is intentional.';
    }
  }
  /* one place decides what the sheet looks like for the current selection */
  const roleIsEdit = r => /editor/i.test(String(r||''));
  const lastEventDate = pkgId => {
    const pk = PKGS.find(p=>p.id===pkgId); if(!pk) return '';
    return (pk.events||[]).map(e=>e.date).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')).sort().pop() || '';
  };
  const editDueDays = () => Math.min(365, Math.max(1, Number(CFG && CFG.editDueDays) || 21));
  const dueFromEvent = d => {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(d||'')) return todayISO();
    const t = new Date(d + 'T00:00'); t.setDate(t.getDate() + editDueDays());
    return t.toLocaleDateString('en-CA');
  };
  /* Picking several hides Role and Pay — each member keeps their own — which
     left "Assign 3 crew" as a leap of faith: three roles and three rates the
     owner could not see until after the write. Spell them out, and name the
     one that silently becomes ₹0. */
  function renderAsMulti(){
    const box = $('#asMulti'); if(!box) return;
    const picked = [..._asPicked].map(memberById).filter(Boolean);
    const multi = !_asEditId && picked.length > 1;
    box.hidden = !multi;
    if(!multi) return;
    const rows = picked.map(x=>({
      name: x.name || '—',
      role: x.role || $('#asRole').value || '',
      rate: Math.max(0, Math.round(Number(x.defaultRate)||0))
    }));
    const total = rows.reduce((s,r)=>s + r.rate, 0);
    const noRate = rows.filter(r=>!r.rate).length;
    box.innerHTML = `<div class="amh">Saving ${rows.length} assignments — each at their own role and rate</div>`
      + rows.map(r=>`<div class="amr"><span>${esc(r.name)}</span><em>${esc(roleLabel(r.role))}</em>`
          + `<b class="${r.rate?'':'zero'}">${r.rate ? inr(r.rate) : 'no rate'}</b></div>`).join('')
      + `<div class="amr tot"><span>Total</span><em></em><b>${inr(total)}</b></div>`
      + (noRate ? `<div class="amn">${noRate === 1 ? 'One member has' : noRate + ' members have'} no pay per event set, so ${noRate === 1 ? 'they' : 'they'} will be saved at ₹0 — set it on their card in Crew, or assign them on their own to type a one-off amount.</div>` : '');
  }

  function syncAsUI(){
    const n = _asPicked.size;
    const multi = !_asEditId && n > 1;
    $('#asPickHint').textContent = _asEditId ? 'tap to swap the member'
      : n > 1 ? `${n} picked — each gets their own role & rate`
      : 'tap one, or several';
    renderAsMulti();
    $$('#asModal [data-solo]').forEach(f=>f.hidden = multi);
    /* editing is a desk job on a deadline — a call time means nothing for it,
       and a due date means nothing for a shoot */
    const ed = !multi && roleIsEdit($('#asRole').value);
    $$('#asModal [data-editonly]').forEach(f=>f.hidden = !ed);
    if(!$('#asBookWrap').hidden && typeof fillBookingEvents === 'function') fillBookingEvents();
    $$('#asModal [data-shootonly]').forEach(f=>f.hidden = ed);
    if(ed && !$('#asDue').value)
      $('#asDue').value = dueFromEvent(($('#asWhole').checked && lastEventDate(_asCtx && _asCtx.pkgId)) || (_asCtx && _asCtx.date));
    $('#asSave').textContent = multi ? `Assign ${n} crew` : 'Save Assignment';
  }
  $('#asRole').addEventListener('change', syncAsUI);
  /* the deadline is measured from the last function once it covers them all */
  $('#asWhole').addEventListener('change', ()=>{
    $('#asDue').value = '';
    if(!$('#asBookWrap').hidden){ fillBookingEvents(); reBook(); return; }
    syncAsUI();
  });
  const DELIVERABLES = ['Photos','Video','Teasers','Album design','Reels'];
  $('#asDelChips').innerHTML = DELIVERABLES.map(d=>`<button type="button" class="qchip" data-del="${esc(d)}">${esc(d)}</button>`).join('');
  $('#asDelChips').addEventListener('click', e=>{
    const b = e.target.closest('[data-del]'); if(!b) return;
    const cur = $('#asDeliver').value.split('+').map(t=>t.trim()).filter(Boolean);
    const v = b.dataset.del;
    const i = cur.indexOf(v);
    if(i >= 0) cur.splice(i,1); else cur.push(v);
    $('#asDeliver').value = cur.join(' + ');
  });
  function renderAsPick(){
    const el = $('#asPick'); if(!el) return;
    const ev = asEventOf(_asCtx);
    const need = ev ? neededRoles(ev) : {};
    const onEvent = new Set(_asCtx ? evCrew(_asCtx.pkgId, _asCtx.date, _asCtx.eventTitle).map(a=>a.memberId) : []);
    let list = activeTeam().slice();
    /* someone deactivated since being assigned must still show while editing,
       or saving would quietly move their job to whoever sorts first */
    const sel = _asEditId ? [..._asPicked][0] : null;
    if(sel && !list.some(m=>m.id===sel)){ const g = memberById(sel); if(g) list.unshift(g); }
    /* A real roster does not fit on a phone — the picker was a bounded scroll
       box you hunted through. Offered once there is enough to hunt through.
       A picked member filtered out of view stays picked; the summary below
       still accounts for them. */
    const filterBox = $('#asFilter');
    if(filterBox) filterBox.hidden = list.length <= 6;
    const fq = (filterBox && !filterBox.hidden ? _asFilter : '').trim().toLowerCase();
    if(fq) list = list.filter(m=>String(m.name||'').toLowerCase().includes(fq)
      || String(m.role||'').toLowerCase().includes(fq));
    const busyOf = m => _asCtx ? asgConflicts(m.id, _asCtx.date, _asEditId) : [];
    /* wanted for this event and free → first; busy → last */
    const rank = m => _asForceEdit
      ? (roleIsEdit(m.role) ? 0 : 1)                                  /* editors first */
      : (busyOf(m).length ? 2 : 0) - (need[String(m.role||'').toLowerCase()] ? 1 : 0);
    /* everyone in one list, office first then outdoor, each group still
       ordered by who this event actually wants and who is free */
    const catRank = m => catOf(m) === 'office' ? 0 : 1;
    list.sort((a,b)=>catRank(a) - catRank(b) || rank(a) - rank(b));
    let _lastCat = null;
    const showHeads = new Set(list.map(catOf)).size > 1;
    el.innerHTML = list.map(m=>{
      let head = '';
      if(showHeads && catOf(m) !== _lastCat){
        _lastCat = catOf(m);
        head = `<span class="pickhead">${esc(CAT_LABEL[_lastCat])}</span>`;
      }
      return head + pickBtn(m);
    }).join('') || `<div class="empty" style="padding:.6rem 0">${fq
      ? 'Nobody matches “' + esc(fq) + '”.'
      : 'No active team members — add one in the Squad list.'}</div>`;

    function pickBtn(m){
      const busy = busyOf(m);
      const here = onEvent.has(m.id) && m.id !== sel;
      const on = _asPicked.has(m.id);
      const wanted = !!need[String(m.role||'').toLowerCase()];
      const note = here ? 'already on this event' : busy.length ? 'busy · ' + esc(busy[0].eventTitle||'another event') : 'free';
      /* a bare ★ read as a favourite or a rating — it means this event's
         services actually call for their craft */
      return `<button type="button" class="cpick ${on?'on':''} ${here?'here':''}" data-pick="${m.id}" ${here?'disabled':''}>
        <i class="dot ${here ? 'delivered' : busy.length ? 'unconfirmed' : 'booked'}"></i>
        <span class="cp-t"><b>${esc(m.name||'—')}${wanted?'<i class="wantt">needed</i>':''}</b><em>${esc(roleLabel(m.role))} · ${note}</em></span>
      </button>`;
    }
    /* A normal crew fits without any inner scrolling, which is what made this
       sheet quick. Only a long roster gets a bounded window, so Role, Pay and
       Notes don't end up a thousand pixels below the list. */
    el.classList.toggle('tall', list.length > 8);
    syncAsUI();
    /* the same crew as another day of this booking, in one tap */
    const btn = $('#asCopy');
    const pk = _asCtx && PKGS.find(p=>p.id===_asCtx.pkgId);
    let src = null;
    if(pk && !_asEditId){
      src = (pk.events||[])
        .filter(e=>/^\d{4}-\d{2}-\d{2}$/.test(e.date||'') && !(e.date === _asCtx.date && String(e.title||'') === String(_asCtx.eventTitle||'')))
        .map(e=>({ e, crew: evCrew(pk.id, e.date, e.title).filter(a=>!onEvent.has(a.memberId)) }))
        .filter(x=>x.crew.length)
        .sort((a,b)=>a.e.date < b.e.date ? 1 : -1)[0] || null;
    }
    btn.hidden = !src;
    if(src){
      btn.textContent = `⧉ Same crew as ${src.e.title || 'the other day'} (${stepDate(src.e.date)}) — ${src.crew.length}`;
      btn.dataset.copy = src.crew.map(a=>a.memberId).join(',');
    }
  }
  $('#asPick').addEventListener('click', e=>{
    const b = e.target.closest('[data-pick]'); if(!b || b.disabled) return;
    const id = b.dataset.pick;
    if(_asEditId){ _asPicked = new Set([id]); }            /* editing swaps, never adds */
    else if(_asPicked.has(id)) _asPicked.delete(id);
    else _asPicked.add(id);
    /* one member picked: their own role and rate prefill, as before */
    if(_asPicked.size === 1){
      const m = memberById([..._asPicked][0]);
      if(m){
        if(TEAM_ROLES.includes(m.role)) $('#asRole').value = m.role;
        if(!_asEditId && m.defaultRate) $('#asAmt').value = m.defaultRate;
      }
    }
    $$('#asPick .cpick').forEach(x=>x.classList.toggle('on', _asPicked.has(x.dataset.pick)));
    syncAsUI();
    refreshAsConflict();
  });
  $('#asCopy').addEventListener('click', ()=>{
    const ids = String($('#asCopy').dataset.copy||'').split(',').filter(Boolean);
    if(!ids.length) return;
    _asPicked = new Set(ids);
    renderAsPick();
    refreshAsConflict();
    toast(`${ids.length} member${ids.length===1?'':'s'} picked — check the details, then Save`);
  });
  let _asForceEdit = false, _bookRows = [];
  /* what is typed in the crew filter, for the length of one sheet */
  let _asFilter = '';
  $('#asFilter').addEventListener('input', e=>{ _asFilter = e.target.value; renderAsPick(); });
  $('#asFilter').addEventListener('keydown', e=>{
    if(e.key !== 'Escape') return;
    e.stopPropagation();          /* clear the filter first; Escape again closes the sheet */
    _asFilter = ''; e.target.value = ''; renderAsPick();
  });
  function openAs(ctx, a, opts){
    _asEditId = a ? a.id : null;
    _asFilter = ''; $('#asFilter').value = '';
    _asCtx = ctx;
    _asForceEdit = !!(opts && opts.forceEdit);
    $('#asBookWrap').hidden = !(opts && opts.pickBooking);
    $('#asTitle').textContent = a ? 'Edit Assignment' : (_asForceEdit ? 'Assign Editing' : 'Assign Crew');
    $('#asWho').textContent = asWhoText(ctx) + (ctx.venue ? ' · ' + ctx.venue : '');
    _asPicked = a && a.memberId ? new Set([a.memberId]) : new Set();
    /* Every field is set BEFORE the picker renders, because renderAsPick ends
       in syncAsUI — which reads the role to decide between a call time and a
       deadline, and fills an empty deadline in. Rendering first meant syncAsUI
       read the PREVIOUS sheet's role, and the assignments below then wiped the
       due date it had just worked out. */
    $('#asRole').value = a && TEAM_ROLES.includes(a.role) ? a.role
      : (_asForceEdit && TEAM_ROLES.includes('editor')) ? 'editor' : TEAM_ROLES[0];
    $('#asCall').value = a ? (a.callTime||'') : '';
    $('#asDue').value = a ? (a.dueDate||'') : '';
    $('#asDeliver').value = a ? (a.deliver||'') : '';
    $('#asWhole').checked = a ? (a.scope === 'package') : !!(opts && opts.whole);
    $('#asAmt').value = a ? ((a.pay||{}).amount || '') : '';
    $('#asNotes').value = a ? (a.notes||'') : '';
    $('#asRemove').hidden = !a;
    renderAsPick();
    refreshAsConflict();
    $('#asModal').classList.add('open'); $('#asBackdrop').classList.add('open');
    pushView('assheet', '#team/assign');
  }
  function closeAsUI(){ $('#asModal').classList.remove('open'); $('#asBackdrop').classList.remove('open'); _asEditId = null; _asCtx = null; }
  function closeAs(){
    backFrom('assheet', closeAsUI);
  }
  $('#asClose').addEventListener('click', closeAs);
  $('#asBackdrop').addEventListener('click', closeAs);
  document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ closeTm(); closeAs(); } });

  $('#asSave').addEventListener('click', async ()=>{
    const btn = $('#asSave'); if(btn.disabled || !_asCtx) return;
    const picked = [..._asPicked].map(memberById).filter(Boolean);
    if(!picked.length){ toast('Tap a team member to assign'); return; }
    const multi = !_asEditId && picked.length > 1;
    const m = picked[0];
    /* ask once, listing everyone who already has something that day */
    const clash = picked.filter(x=>asgConflicts(x.id, _asCtx.date, _asEditId).length);
    if(clash.length){
      const names = clash.map(x=>x.name||'a member').join(', ');
      if(!confirm(`${names} ${clash.length>1?'are':'is'} already booked on ${stepDate(_asCtx.date)||_asCtx.date}. Assign anyway?`)) return;
    }
    const typed = Math.max(0, Math.round(Number($('#asAmt').value)||0));
    const amt = typed;
    /* several at once: each keeps their own role and their own rate, because
       one rate and one role across a mixed crew is never what was meant */
    const payFor = x => multi ? Math.max(0, Math.round(Number(x.defaultRate)||0)) : typed;
    const roleFor = x => multi ? (x.role || $('#asRole').value || '') : ($('#asRole').value || x.role || '');
    const baseOf = x => {
      const r = roleFor(x), ed = roleIsEdit(r);
      return {
        memberId: x.id, memberName: x.name||'', memberPhone10: memberPhone10(x),
        pkgId: _asCtx.pkgId, quoteNo: _asCtx.quoteNo||'', clientName: _asCtx.clientName||'',
        eventTitle: (ed && $('#asWhole').checked) ? 'All functions' : (_asCtx.eventTitle||''),
        date: (ed && $('#asWhole').checked) ? (lastEventDate(_asCtx.pkgId) || _asCtx.date || '') : (_asCtx.date||''),
        venue: ed ? '' : (_asCtx.venue||''),
        /* a whole-booking editing job spans every function, so it carries no
           single time of day */
        slot: (ed && $('#asWhole').checked) ? '' : (_asCtx.slot||''),
        callTime: ed ? '' : ($('#asCall').value||''), role: r,
        /* empty strings rather than absent keys: a member switched off editing
           must lose the deadline, not keep a stale one */
        kind: ed ? 'edit' : '',
        dueDate: ed ? (($('#asDue').value || dueFromEvent(_asCtx.date))) : '',
        deliver: ed ? $('#asDeliver').value.trim() : '',
        scope: ed && $('#asWhole').checked ? 'package' : '',
        notes: $('#asNotes').value.trim(), updatedAt: serverTimestamp()
      };
    };
    const base = baseOf(m);
    btn.disabled = true;
    try{
      if(multi){
        let ok = 0, failed = 0;
        for(const x of picked){
          const b = baseOf(x), pay = payFor(x);
          const ref = doc(collection(db,'assignments'));
          const res = await settle(setDoc(ref, { ...b, pay: { amount: pay, paid: false, paidDate: '', mode: '' },
                                                 status: 'assigned', createdAt: serverTimestamp() }));
          if(res === 'denied'){ failed++; continue; }
          ok++;
          ASGS.unshift({ id: ref.id, ...b, pay: { amount: pay, paid: false, paidDate: '', mode: '' }, status: 'assigned' });
        }
        toast(failed ? `${ok} assigned — ${failed} refused by the server` : `${ok} crew assigned ✓`);
        if(!ok) return;
      }else if(_asEditId){
        const old = ASGS.find(v=>v.id===_asEditId);
        const patch = { ...base, 'pay.amount': amt };
        /* The fee can change; what was already handed over cannot. On a row
           marked paid before instalments existed there is no separate figure —
           its payment IS pay.amount — so editing the fee would silently rewrite
           history and hand the member a receipt for money never paid. Freeze
           the old figure into payments[]/paidAmount before the fee moves. */
        const _curPay = (old||{}).pay || {}, _frozen = payGot(old);
        if(_frozen > 0 && !(Array.isArray(_curPay.payments) && _curPay.payments.length)){
          patch['pay.payments']   = priorPayments(_curPay);
          patch['pay.paidAmount'] = _frozen;
        }
        if(_frozen > 0 || _curPay.paid) patch['pay.paid'] = amt > 0 && _frozen >= amt;
        /* details the member already acknowledged have changed — they must
           confirm again, so the ✓ never silently means an outdated plan */
        const reset = old && old.status === 'acknowledged'
          && (old.memberId !== base.memberId || old.callTime !== base.callTime
              || old.role !== base.role || old.venue !== base.venue || old.date !== base.date
              || (old.notes||'') !== base.notes);   /* the note is shown to them too */
        if(reset){ patch.status = 'assigned'; patch.ackAt = deleteField(); }
        const res = await settle(updateDoc(doc(db,'assignments',_asEditId), patch));
        const sm = settleMsg(res, reset ? 'Saved — the member will be asked to confirm again' : 'Assignment saved ✓');
        toast(sm.msg);
        if(!sm.ok) return;
        if(old){
          Object.assign(old, base, { updatedAt: null });
          old.pay = { ...(old.pay||{}), amount: amt,
            ...(patch['pay.payments'] ? { payments: patch['pay.payments'], paidAmount: _frozen } : {}),
            ...(patch['pay.paid'] !== undefined ? { paid: patch['pay.paid'] } : {}) };
          if(reset){ old.status='assigned'; delete old.ackAt; }
        }
      }else{
        const ref = doc(collection(db,'assignments'));
        const res = await settle(setDoc(ref, { ...base, pay: { amount: amt, paid: false, paidDate: '', mode: '' },
                                               status: 'assigned', createdAt: serverTimestamp() }));
        const sm = settleMsg(res, `${m.name||'Member'} assigned ✓`);
        toast(sm.msg);
        if(!sm.ok) return;
        ASGS.unshift({ id: ref.id, ...base, pay: { amount: amt, paid: false, paidDate: '', mode: '' }, status: 'assigned' });
      }
      buzz(); renderTeam();
      closeAs();
    }catch(err){ toast('Save failed: ' + (err.code||err.message)); }
    finally{ btn.disabled = false; }
  });

  $('#asRemove').addEventListener('click', async ()=>{
    const a = ASGS.find(v=>v.id===_asEditId); if(!a) return;
    if(!await confirmDialog({
      title:'Remove from this event?',
      body:`<b>${esc(a.memberName||'This member')}</b> comes off <b>${esc(a.eventTitle||'this event')}</b> and the date frees up on their schedule.`,
      confirmText:'Remove'
    })) return;
    const saved = { ...a }; delete saved.id;
    try{
      const res = await settle(deleteDoc(doc(db,'assignments',a.id)));
      if(res === 'denied'){ toast('NOT removed — the server refused the write.'); return; }
      ASGS = ASGS.filter(v=>v.id!==a.id);
      renderTeam();
      closeAs();
      toastUndo('Assignment removed', async ()=>{
        try{
          await settle(setDoc(doc(db,'assignments',a.id), { ...saved, updatedAt: serverTimestamp() }));
          loadTeam();
        }catch(err){ toast('Undo failed'); }
      });
    }catch(err){ toast('Remove failed'); }
  });

  $('#teamEvents').addEventListener('click', e=>{
    /* the whole crew row opens the assign sheet — this has to be caught first
       or tapping 📤 would edit the assignment instead of messaging them */
    const cs = e.target.closest('[data-callsheet]');
    if(cs){
      const a = ASGS.find(v=>v.id===cs.dataset.callsheet); if(!a) return;
      const wa = crewWaNumber(a);
      if(!wa){ toast('No phone number for this member — add one in the Crew list'); return; }
      openWa('https://wa.me/' + wa + '?text=' + encodeURIComponent(callSheetText(a)));
      return;
    }
    const add = e.target.closest('[data-asadd]');
    const sync = e.target.closest('[data-assync]');
    const edit = e.target.closest('[data-asedit]');
    const evCtx = btn => {
      const pk = PKGS.find(p=>p.id===btn.dataset.aspk); if(!pk) return null;
      const ev = (pk.events||[])[Number(btn.dataset.asev)]; if(!ev) return null;
      return { pkgId: pk.id, quoteNo: pk.quoteNo||'', clientName: pk.clientName||'',
               eventTitle: ev.title||'', slot: ev.slot||'', date: ev.date||'', venue: ev.venue||'' };
    };
    if(add){ const ctx = evCtx(add); if(ctx) openAs(ctx, null); return; }
    if(sync){
      const a = ASGS.find(v=>v.id===sync.dataset.assync);
      const pk = PKGS.find(p=>p.id===sync.dataset.aspk);
      if(!a || !pk) return;
      /* The stale row renders under the package's FIRST upcoming event, so the
         row's index must not decide where the assignment goes — in a
         multi-event package that rewrote crew onto the wrong function. Resolve
         the target from the assignment itself: same title first, then the only
         event, then the only upcoming one; anything still ambiguous is a
         human call. */
      const evs = (pk.events||[]).filter(ev=>/^\d{4}-\d{2}-\d{2}$/.test(ev.date||''));
      const title = String(a.eventTitle||'').trim().toLowerCase();
      const byTitle = evs.filter(ev=>String(ev.title||'').trim().toLowerCase() === title);
      const upEvs = evs.filter(ev=>ev.date >= todayISO());
      const target = byTitle.length === 1 ? byTitle[0]
                   : evs.length === 1 ? evs[0]
                   : upEvs.length === 1 ? upEvs[0]
                   : null;
      if(!target){
        toast('This package has several events — remove this assignment (tap the name) and re-assign on the correct event.');
        return;
      }
      const ctx = { pkgId: pk.id, quoteNo: pk.quoteNo||'', clientName: pk.clientName||'',
                    eventTitle: target.title||'', slot: target.slot||'', date: target.date||'', venue: target.venue||'' };
      (async ()=>{
        try{
          const patch = { eventTitle: ctx.eventTitle, slot: ctx.slot||'', date: ctx.date, venue: ctx.venue,
                          status: 'assigned', ackAt: deleteField(), updatedAt: serverTimestamp() };
          const res = await settle(updateDoc(doc(db,'assignments',a.id), patch));
          const sm = settleMsg(res, 'Assignment synced to the new event details — the member will confirm again');
          toast(sm.msg);
          if(!sm.ok) return;
          Object.assign(a, { eventTitle: ctx.eventTitle, slot: ctx.slot||'', date: ctx.date, venue: ctx.venue, status: 'assigned' });
          delete a.ackAt;
          renderTeam();
        }catch(err){ toast('Sync failed'); }
      })();
      return;
    }
    if(edit){
      const a = ASGS.find(v=>v.id===edit.dataset.asedit); if(!a) return;
      openAs({ pkgId: a.pkgId, quoteNo: a.quoteNo||'', clientName: a.clientName||'',
               eventTitle: a.eventTitle||'', slot: a.slot||'', date: a.date||'', venue: a.venue||'' }, a);
    }
  });

  /* ---------- pay tracker: pay crew in instalments against one assignment ---------- */
  let _cpId = null, _cpMode = 'online';
  /* set instead of _cpId when the sheet is settling a member's whole ledger */
  let _cpAllMember = null;
  /* everything still owed to one member, oldest shoot first — the order money
     is actually handed over in, and the order Settle all allocates it */
  const dueRowsFor = mid => ASGS.filter(a=>a.memberId === mid && payDue(a) > 0)
    .sort((a,b)=>String(a.date||'') < String(b.date||'') ? -1 : 1);

  /* Settling a season meant opening one sheet per shoot: six sheets, six
     amounts, six saves, for one handover of cash. This is the same sheet with
     the member's whole outstanding ledger in it — whatever is entered is
     allocated oldest shoot first, so a part payment lands where a studio would
     put it, and each shoot still gets its own entry that can be corrected. */
  function openCrewPayAll(mid){
    const rows = dueRowsFor(mid);
    if(!rows.length){ toast('Nothing due for this member'); return; }
    const m = memberById(mid);
    const name = (m && m.name) || rows[0].memberName || 'this member';
    const total = rows.reduce((s,a)=>s + payDue(a), 0);
    _cpId = null; _cpAllMember = mid; _cpMode = 'online';
    $('#cpModeOnline').classList.add('on'); $('#cpModeCash').classList.remove('on');
    $('#cpWho').textContent = `${name} — ${inr(total)} owed across ${rows.length} shoot${rows.length===1?'':'s'}`;
    $('#cpAmt').value = '';
    const quick = [['Everything owed', total]];
    const half = Math.round(total/2);
    if(half > 0 && half < total) quick.push(['Half', half]);
    $('#cpQuick').innerHTML = quick.map(([l,v])=>`<button type="button" data-cqa="${v}">${l} · ${inr(v)}</button>`).join('');
    $('#cpDate').value = todayISO();
    $('#cpHist').innerHTML = '<b style="color:var(--gold-b)">Outstanding — paid off in this order</b>'
      + rows.map(a=>`<div><span>${esc(stepDate(a.date)||a.date||'no date')} · ${esc(a.eventTitle||'Event')}</span><span>${inr(payDue(a))}</span></div>`).join('');
    const wasOpen = $('#cpModal').classList.contains('open');
    $('#cpModal').classList.add('open'); $('#cpBackdrop').classList.add('open');
    setTimeout(()=>$('#cpAmt').focus(), 80);
    if(!wasOpen) pushView('crewpay', '#team/pay');
  }

  async function settleAllPayment(){
    const mid = _cpAllMember;
    const rows = dueRowsFor(mid);
    if(!rows.length){ toast('Nothing due any more'); closeCrewPay(); return; }
    const amount = Math.round(Number($('#cpAmt').value)||0);
    if(amount <= 0){ toast('Enter the amount you paid'); $('#cpAmt').focus(); return; }
    const total = rows.reduce((s,a)=>s + payDue(a), 0);
    if(amount > total && !confirm(`That is ${inr(amount - total)} more than the ${inr(total)} owed across these shoots.\n\nOnly ${inr(total)} can be allocated — the rest would not be recorded anywhere. Continue with ${inr(total)}?`)){
      $('#cpAmt').focus(); return;
    }
    const date = $('#cpDate').value || todayISO(), mode = _cpMode;
    const btn = $('#cpSave'); btn.disabled = true;
    let left = Math.min(amount, total), paid = 0, n = 0, failed = 0, queued = false;
    try{
      for(const a of rows){
        if(left <= 0) break;
        const take = Math.min(left, payDue(a));
        if(take <= 0) continue;
        try{
          const res = await recordCrewPayment(a, { id: newPayId(), amount: take, date, mode });
          a.pay = res.pay; queued = queued || res.queued;
          left -= take; paid += take; n++;
        }catch(err){ failed++; }
      }
      /* Say exactly what landed. A partial run is the one case where a cheerful
         summary would be a lie — the owner has handed over cash and needs to
         know which shoots it was recorded against. */
      if(!n){ toast('Nothing was recorded — ' + (failed ? 'the server refused the writes' : 'no shoot had a balance')); return; }
      renderTeam(); renderPkgStats(); buzz();
      const stillOwed = dueRowsFor(mid).reduce((s,a)=>s + payDue(a), 0);
      toast(failed
        ? `${inr(paid)} recorded across ${n} shoot${n===1?'':'s'} — ${failed} could not be saved, ${inr(stillOwed)} still shows as owed`
        : queued
          ? `${inr(paid)} across ${n} shoot${n===1?'':'s'} saved offline — will sync`
          : `${inr(paid)} to ${(memberById(mid)||{}).name || 'crew'} across ${n} shoot${n===1?'':'s'} — ${stillOwed > 0 ? inr(stillOwed) + ' still owed' : 'fully settled ✓'}`);
      if(!failed) closeCrewPay();
      else openCrewPayAll(mid);   /* leave the sheet on what is still outstanding */
    }catch(err){ toast('Could not settle: ' + (err.message||err.code||'no signal')); }
    finally{ btn.disabled = false; }
  }

  function openCrewPay(a){
    _cpId = a.id; _cpAllMember = null; _cpMode = 'online';
    $('#cpModeOnline').classList.add('on'); $('#cpModeCash').classList.remove('on');
    const fee = payFee(a), got = payGot(a), due = payDue(a);
    $('#cpWho').textContent = `${a.memberName||'—'} · ${a.eventTitle||'Event'} ${stepDate(a.date)||a.date||''} — `
      + (fee > 0 ? `${inr(due)} left of ${inr(fee)}` : 'no fee set on this assignment');
    $('#cpAmt').value = '';
    const quick = [];
    if(due > 0) quick.push(['Full balance', due]);
    const half = Math.round(due/2);
    if(half > 0 && half < due) quick.push(['Half', half]);
    $('#cpQuick').innerHTML = quick.map(([l,v])=>`<button type="button" data-cqa="${v}">${l} · ${inr(v)}</button>`).join('');
    $('#cpDate').value = todayISO();
    renderCrewPayHist(a);
    const wasOpen = $('#cpModal').classList.contains('open');
    $('#cpModal').classList.add('open'); $('#cpBackdrop').classList.add('open');
    setTimeout(()=>$('#cpAmt').focus(), 80);
    if(!wasOpen) pushView('crewpay', '#team/pay');
  }
  function renderCrewPayHist(a){
    /* rendered through priorPayments so a row marked paid before instalments
       existed shows as one removable entry — otherwise a mistaken "paid" tick
       could never be taken back once the old toggle was retired */
    const list = priorPayments((a||{}).pay);
    const el = $('#cpHist'); if(!el) return;
    el.innerHTML = list.length
      ? '<b style="color:var(--gold-b)">Payments so far</b>' + list.map(pm=>
          `<div><span>${esc(dmy(pm.date) || 'date not recorded')}${pm.mode ? ' · ' + esc(pm.mode) : ''}</span><span>${inr(pm.amount||0)} <button class="rm" data-cprm data-pid="${esc(pm.id||'')}" title="Remove this payment">✕</button></span></div>`).join('')
      : '';
  }
  function closeCrewPayUI(){ $('#cpModal').classList.remove('open'); $('#cpBackdrop').classList.remove('open'); _cpId = null; _cpAllMember = null; }
  function closeCrewPay(){ backFrom('crewpay', closeCrewPayUI); }
  $('#cpClose').addEventListener('click', closeCrewPay);
  $('#cpBackdrop').addEventListener('click', closeCrewPay);
  $('#cpModeOnline').addEventListener('click', ()=>{ _cpMode='online'; $('#cpModeOnline').classList.add('on'); $('#cpModeCash').classList.remove('on'); });
  $('#cpModeCash').addEventListener('click', ()=>{ _cpMode='cash'; $('#cpModeCash').classList.add('on'); $('#cpModeOnline').classList.remove('on'); });
  $('#cpQuick').addEventListener('click', e=>{
    const b = e.target.closest('[data-cqa]'); if(!b) return;
    $('#cpAmt').value = b.dataset.cqa; $('#cpAmt').focus();
  });

  /* rebuild the whole pay map: payments[], its running sum, and the paid flag
     kept accurate for the JSON backup and any reader that still consults it */
  function payMapFrom(curPay, payments){
    const got = payments.reduce((s,p)=>s + (Math.max(0, Number(p.amount)||0)), 0);
    const fee = Math.max(0, Number((curPay||{}).amount)||0);
    /* the settlement date is the LATEST instalment, not the last one typed —
       a back-dated correction must not rewind it (yyyy-mm-dd sorts as text) */
    const last = payments.reduce((m,p)=>{ const d = String((p||{}).date||''); return d > m ? d : m; }, '');
    return { ...(curPay||{}), amount: fee, payments,
             paidAmount: got,
             paid: fee > 0 && got >= fee,
             paidDate: got > 0 ? String(last||'') : '' };
  }
  /* instalments already on the record. A row marked paid before history
     existed has none, so it is seeded with one entry for what was settled —
     without this its money would vanish the moment a second payment landed. */
  function priorPayments(curPay){
    const p = curPay || {};
    if(Array.isArray(p.payments) && p.payments.length) return [...p.payments];
    const got = (p.paidAmount !== undefined && p.paidAmount !== null)
      ? Math.max(0, Number(p.paidAmount)||0)
      : (p.paid ? Math.max(0, Number(p.amount)||0) : 0);
    return got > 0 ? [{ id:'legacy', amount: got, date: String(p.paidDate||''), mode: String(p.mode||'') }] : [];
  }
  /* Every instalment id is unique within a session: settling a member's whole
     ledger writes several in the same millisecond, and Date.now() alone would
     hand two of them the same id — which is what removing one payment matches
     on. */
  let _payIdN = 0;
  const newPayId = () => Date.now().toString(36) + (_payIdN++).toString(36) + Math.random().toString(36).slice(2,5);

  /* One write, used by both the single-assignment sheet and Settle all.
     Returns the new pay map and whether it is still queued. */
  async function recordCrewPayment(a, entry){
    const id = a.id;
    if(navigator.onLine){
      /* read-modify-write against the server copy: an instalment recorded on
         another device (or a fee edited meanwhile) can never be overwritten */
      const pay = await runTransaction(db, async t=>{
        const ref = doc(db,'assignments',id);
        const snap = await t.get(ref);
        if(!snap.exists()) throw new Error('assignment not found');
        const server = snap.data().pay || {};
        const next = payMapFrom(server, [...priorPayments(server), entry]);
        t.update(ref, { pay: next, updatedAt: serverTimestamp() });
        return next;
      });
      return { pay, queued: false };
    }
    /* offline: queue it. A row that already has history appends without
       touching the others; the first instalment has to seed the map whole,
       and with no signal this device is the only writer anyway. */
    const cur = a.pay || {};
    const hasHistory = Array.isArray(cur.payments) && cur.payments.length > 0;
    const pay = payMapFrom(cur, [...priorPayments(cur), entry]);
    const patch = hasHistory
      ? { 'pay.payments': arrayUnion(entry), 'pay.paidAmount': increment(entry.amount),
          'pay.paidDate': pay.paidDate, 'pay.paid': pay.paid, updatedAt: serverTimestamp() }
      : { pay, updatedAt: serverTimestamp() };
    updateDoc(doc(db,'assignments',id), patch).catch(()=>{});
    return { pay, queued: true };
  }

  async function saveCrewPayment(){
    if(_cpAllMember) return settleAllPayment();
    const a = ASGS.find(v=>v.id===_cpId); if(!a) return;
    const id = a.id;
    const amount = Math.round(Number($('#cpAmt').value)||0);
    if(amount <= 0){ toast('Enter the amount you paid'); $('#cpAmt').focus(); return; }
    const fee = payFee(a), due = payDue(a);
    if(due <= 0 && fee > 0){
      if(!confirm(`${a.memberName||'This member'} is already fully paid for this event. Record another ${inr(amount)} anyway?`)){ $('#cpAmt').focus(); return; }
    }else if(amount > due){
      if(!confirm(`That is ${inr(amount - due)} more than the ${inr(due)} still owed for this event. Record it anyway?`)){ $('#cpAmt').focus(); return; }
    }
    const mode = _cpMode;
    const entry = { id: newPayId(), amount, date: $('#cpDate').value || todayISO(), mode };
    const btn = $('#cpSave'); btn.disabled = true;
    try{
      const { pay, queued } = await recordCrewPayment(a, entry);
      const left = Math.max(0, payFee({ pay }) - pay.paidAmount);
      toast(queued
        ? `${inr(amount)} (${mode}) saved — will sync when you're back online`
        : `${inr(amount)} (${mode}) to ${a.memberName||'crew'} recorded — ${left > 0 ? inr(left) + ' still owed' : 'fully settled ✓'}`);
      a.pay = pay;
      buzz();
      renderTeam(); renderPkgStats();
      if(_cpId === id) closeCrewPay();   /* only close the sheet this write belongs to */
    }catch(err){ toast('Could not save that payment: ' + (err.message||err.code||'no signal')); }
    finally{ btn.disabled = false; }
  }
  $('#cpSave').addEventListener('click', saveCrewPayment);
  $('#cpHist').addEventListener('click', async e=>{
    const rm = e.target.closest('[data-cprm]'); if(!rm) return;
    const a = ASGS.find(v=>v.id===_cpId); if(!a) return;
    const pid = rm.dataset.pid;
    if(!await confirmDialog({
      title:'Remove this payment?',
      body:'The balance owed goes back up by the same amount.',
      confirmText:'Remove'
    })) return;
    /* read-modify-write, so removing one instalment can never carry a stale
       copy of the others back over the server's (same as client payments) */
    try{
      const pay = await runTransaction(db, async t=>{
        const ref = doc(db,'assignments',a.id);
        const snap = await t.get(ref);
        if(!snap.exists()) throw new Error('assignment not found');
        const cur = snap.data().pay || {};
        const list = priorPayments(cur);
        const i = list.findIndex(p=>String((p||{}).id||'') === pid);
        if(i < 0) throw new Error('payment not found — reopen and retry');
        list.splice(i, 1);
        const next = payMapFrom(cur, list);
        t.update(ref, { pay: next, updatedAt: serverTimestamp() });
        return next;
      });
      a.pay = pay;
      /* only refresh the sheet if it is still this assignment's — the snapshot
         may have re-rendered and the owner moved on while the write was away */
      if(_cpId === a.id) openCrewPay(a);
      renderTeam(); renderPkgStats();
      toast('Payment removed — balance updated');
    }catch(err){ toast('Remove failed: ' + (err.message||err.code||'no signal')); }
  });

  $('#teamPay').addEventListener('click', e=>{
    /* checked BEFORE the group header it sits inside, or tapping it would just
       collapse the member instead */
    const all = e.target.closest('[data-pmall]');
    if(all){ openCrewPayAll(all.dataset.pmall); return; }
    const g = e.target.closest('[data-pmgrp]');
    if(g){
      const id = g.dataset.pmgrp;
      _payOpen.has(id) ? _payOpen.delete(id) : _payOpen.add(id);
      renderTeamPay(); return;
    }
    const pay = e.target.closest('[data-cpay]');
    if(pay){
      const a = ASGS.find(v=>v.id===pay.dataset.cpay); if(!a) return;
      if(payFee(a) <= 0){ toast('Set a fee for this event first — tap the crew row on the event card'); return; }
      openCrewPay(a);
      return;
    }
    const un = e.target.closest('[data-unpaid]');
    if(un){
      const a = ASGS.find(v=>v.id===un.dataset.unpaid); if(!a) return;
      openCrewPay(a);   /* the sheet is where a payment gets corrected or removed */
    }
  });

  /* ---------- export / backup ---------- */
  function dl(filename, text, type){
    const b = new Blob([text], {type});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = filename; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
  }
  function csvEnc(rows){
    return rows.map(r=>r.map(v=>{
      v = (v==null ? '' : String(v));
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g,'""') + '"' : v;
    }).join(',')).join('\n');
  }
  const tsDate = t => (t && t.toDate) ? t.toDate().toLocaleDateString('en-CA') : '';
  const stamp = () => new Date().toLocaleDateString('en-CA');
  /* exports fetch the FULL collections — the in-memory lists are capped, a backup must not be.
     Server-first: an offline cache copy is clearly labelled, never passed off as a full backup. */
  async function fetchAll(){
    const one = async col => {
      /* no orderBy: Firestore silently EXCLUDES documents that lack the
         ordered field, so legacy docs without createdAt vanished from
         backups. Fetch everything and sort in memory instead. */
      const q = query(collection(db,col));
      try{ return { snap: await getDocsFromServer(q), partial: false }; }
      catch(e){ return { snap: await getDocs(q), partial: true }; }
    };
    const ts = d => (d.createdAt && d.createdAt.toMillis) ? d.createdAt.toMillis() : 0;
    const sortNew = arr => arr.sort((a,b)=>ts(b)-ts(a));
    const [p, l, t, a, st, ex] = await Promise.all([one('packages'), one('leads'), one('team'), one('assignments'), one('studios'), one('expenses')]);
    return { pkgs: sortNew(p.snap.docs.map(d=>({ id:d.id, ...d.data() }))),
             leads: sortNew(l.snap.docs.map(d=>({ id:d.id, ...d.data() }))),
             team: sortNew(t.snap.docs.map(d=>({ id:d.id, ...d.data() }))),
             asgs: sortNew(a.snap.docs.map(d=>({ id:d.id, ...d.data() }))),
             studios: sortNew(st.snap.docs.map(d=>({ id:d.id, ...d.data() }))),
             /* spending is a money record: a backup without it is not a backup */
             exps: sortNew(ex.snap.docs.map(d=>({ id:d.id, ...d.data() }))),
             partial: p.partial || l.partial || t.partial || a.partial || st.partial || ex.partial };
  }
  const partNote = p => p ? ' ⚠ offline copy — may be incomplete' : '';
  $('#expJson').addEventListener('click', async ()=>{
    toast('Preparing backup…');
    try{
      const { pkgs, leads, team, asgs, studios, exps, partial } = await fetchAll();
      /* fetch the config fresh — CFG can be built-in DEFAULTS when the load
         failed, and a backup of defaults masquerading as the live config is
         worse than no config at all */
      let cfgOut = null, cfgNote = '';
      try{ const cs = await getDoc(doc(db,'config','site')); cfgOut = cs.exists() ? cs.data() : null; }
      catch(e){
        if(_cfgLoadFailed){ cfgOut = null; cfgNote = 'live config unavailable at export time — NOT included; do not restore config from this file'; }
        else cfgOut = CFG;
      }
      dl(`fantasy-studio-backup-${stamp()}.json`,
        JSON.stringify({ exportedAt:new Date().toISOString(), packages:pkgs, leads, team, assignments:asgs, studios, expenses:exps, config:cfgOut, ...(cfgNote?{configNote:cfgNote}:{}) }, null, 1),
        'application/json');
      toast(`Backup downloaded — ${pkgs.length} packages, ${leads.length} leads, ${team.length} team, ${asgs.length} assignments, ${studios.length} studios, ${exps.length} expenses${partNote(partial)}${cfgNote ? ' ⚠ config missing' : ''}`);
    }catch(err){ toast('Backup failed: ' + (err.code||err.message)); }
  });
  $('#expPkgs').addEventListener('click', async ()=>{
    toast('Preparing CSV…');
    try{
      const { pkgs, partial } = await fetchAll();
      const live = pkgs.filter(x=>!x.deleted);
      const rows = [['QuoteNo','Client','Type','Studio','EndClient','Phone','Status','DeliveryProgress','DeliveredOn','Events','EventDates','Gross','Discount','Final','Advance','Balance','Created']];
      live.forEach(x=>{ const t=x.totals||{}; const st=x.status||'draft';
        const di = (st==='booked'||st==='delivered') ? deliveryInfo(x) : null;
        rows.push([x.quoteNo||'', x.clientName||'', x.clientType||'direct', x.studioName||'', x.endClientName||'', x.clientPhone||'', st,
        di ? di.doneCount+'/'+di.total : '', st==='delivered' ? (x.deliveredAt||'') : '',
        (x.events||[]).length, (x.events||[]).map(e=>e.date).filter(Boolean).join(' '), t.gross||0, t.discount||0,
        t.finalPrice||0, t.advance||0, t.balance||0, tsDate(x.createdAt)]); });
      dl(`packages-${stamp()}.csv`, csvEnc(rows), 'text/csv'); toast(`Packages CSV — ${live.length} rows${partNote(partial)}`);
    }catch(err){ toast('Export failed: ' + (err.code||err.message)); }
  });
  $('#expSpend').addEventListener('click', async ()=>{
    toast('Preparing CSV…');
    try{
      const { exps, partial } = await fetchAll();
      const live = exps.filter(x=>!x.deleted);
      const rows = [['Date','Category','Amount','Mode','Note']];
      live.forEach(x=>rows.push([x.date||'', x.cat||'', Number(x.amount)||0, x.mode||'', x.note||'']));
      dl(`expenses-${stamp()}.csv`, csvEnc(rows), 'text/csv'); toast(`Expenses CSV — ${live.length} rows${partNote(partial)}`);
    }catch(err){ toast('Export failed: ' + (err.code||err.message)); }
  });
  $('#expPays').addEventListener('click', async ()=>{
    toast('Preparing CSV…');
    try{
      const { pkgs, partial } = await fetchAll();
      /* money records stay in the accounting export even if their package sits in Trash */
      const rows = [['Date','Client','Mode','Amount','QuoteNo','PackageInTrash']];
      pkgs.forEach(x=>(x.payments||[]).forEach(pm=>rows.push([pm.date||'', x.clientName||'', pm.mode||'', pm.amount||0, x.quoteNo||'', x.deleted ? 'yes' : ''])));
      dl(`payments-${stamp()}.csv`, csvEnc(rows), 'text/csv'); toast(`Payments CSV — ${rows.length-1} rows${partNote(partial)}`);
    }catch(err){ toast('Export failed: ' + (err.code||err.message)); }
  });
  $('#expLeads').addEventListener('click', async ()=>{
    toast('Preparing CSV…');
    try{
      const { leads, partial } = await fetchAll();
      const live = leads.filter(l=>!l.deleted);
      const rows = [['Created','Name','Phone','Source','Status','Events','WeddingDate','QuoteTotal','Message','Notes']];
      live.forEach(l=>rows.push([tsDate(l.createdAt), l.name||'', l.phone||'', l.source||'', l.status||'new',
        l.eventType||'', l.weddingDate||'', l.grandTotal||'', l.message||'', l.notes||'']));
      dl(`leads-${stamp()}.csv`, csvEnc(rows), 'text/csv'); toast(`Leads CSV — ${live.length} rows${partNote(partial)}`);
    }catch(err){ toast('Export failed: ' + (err.code||err.message)); }
  });

  /* ---------- trash: restore or permanently clear deleted records ---------- */
  let _purged = false;
  function renderTrash(){
    const el = $('#trashList'); if(!el) return;
    const items = [
      ...PKGS.filter(x=>x.deleted).map(x=>({ kind:'pkg', id:x.id, label:`📦 ${x.clientName||'—'}${x.quoteNo ? ' · ' + x.quoteNo : ''}`, on:x.deletedAt||'' })),
      ...LEADS.filter(l=>l.deleted).map(l=>({ kind:'lead', id:l.id, label:`👥 ${l.name||'—'}`, on:l.deletedAt||'' }))
    ];
    el.innerHTML = items.length ? items.map(it=>`
      <div class="up-ev">
        <span class="what">${esc(it.label)} <span>· deleted ${esc(it.on)}</span></span>
        <button class="btn btn--sm btn--ghost" data-restore="${it.kind}:${it.id}">Restore</button>
        <button class="icon-btn icon-btn--danger" data-purge="${it.kind}:${it.id}">✕ Forever</button>
      </div>`).join('') : '<div class="empty" style="padding:.4rem 0">Trash is empty.</div>';
    /* silent 30-day cleanup — only once BOTH lists have arrived fresh from the server,
       never from a stale cache image (it could hard-delete something restored elsewhere) */
    if(!_purged && _pkgsFresh && _leadsFresh){
      _purged = true;
      [...PKGS.filter(x=>x.deleted), ...LEADS.filter(l=>l.deleted)].forEach(it=>{
        const d = daysAgo(it.deletedAt);
        if(d == null || d <= 30) return;
        const col = PKGS.includes(it) ? 'packages' : 'leads';
        /* A package with recorded payments is a financial record. Auto-purging
           it after 30 days destroyed the only history of money received, with
           no prompt and no way back. Those are kept in Trash until the owner
           deletes them deliberately with the ✕ Forever button. */
        if(col === 'packages' && Array.isArray(it.payments) && it.payments.length) return;
        deleteDoc(doc(db, col, it.id)).catch(()=>{});
      });
    }
  }
  $('#trashList').addEventListener('click', async e=>{
    const rBtn = e.target.closest('[data-restore]');
    const pBtn = e.target.closest('[data-purge]');
    if(!rBtn && !pBtn) return;
    const [kind, id] = (rBtn||pBtn).dataset[rBtn?'restore':'purge'].split(':');
    const col = kind === 'pkg' ? 'packages' : 'leads';
    const arr = kind === 'pkg' ? PKGS : LEADS;
    const it = arr.find(v=>v.id===id); if(!it) return;
    if(rBtn){
      try{
        const res = await settle(updateDoc(doc(db,col,id), { deleted: deleteField(), deletedAt: deleteField() }));
        if(res === 'denied'){ toast('NOT restored — the server refused this write. Check your sign-in and try again.'); return; }
        delete it.deleted; delete it.deletedAt;
        renderPkgList(); renderStats(); renderLeads(); renderTrash();
        toast('Restored ✓');
      }catch(err){ toast('Restore failed — it may have been permanently deleted elsewhere'); }
    }else{
      const paid = kind==='pkg' && Array.isArray(it.payments) && it.payments.length
        ? `\n\nThis package has ${it.payments.length} recorded payment(s) totalling ${inr(it.payments.reduce((n,p)=>n+(Number(p.amount)||0),0))}. That payment history will be destroyed.`
        : '';
      if(!await confirmDialog({
        title:'Delete forever?',
        body:'This one really cannot be undone — it does not go back to Trash.' + esc(paid),
        confirmText:'Delete forever'
      })) return;
      try{
        /* the one delete in the panel with no undo — it must never report
           success for a write the server refused, or one still queued offline
           that could still be refused when it replays */
        const res = await settle(deleteDoc(doc(db,col,id)));
        if(res === 'denied'){ toast('NOT deleted — the server refused this write. Check your sign-in and try again.'); return; }
        if(kind==='pkg') PKGS = PKGS.filter(v=>v.id!==id); else LEADS = LEADS.filter(v=>v.id!==id);
        renderTrash();
        toast(res === 'queued' ? 'Queued for permanent deletion — it clears when you are back online' : 'Deleted forever');
      }catch(err){ toast('Delete failed'); }
    }
  });

  /* ============================================================
     B2B — partner studios: CRUD, rate cards, jobs & ledger.
     Server-side the `studios` collection is admin-only, and studio
     jobs carry no clientPhone, so nothing here can ever surface on
     the public site, the client portal or the crew page.
     ============================================================ */
  let STUDIOS = [];
  let _studiosUnsub = null, _studiosLoaded = false, _stuEditId = null, _stuDetailId = null, _studiosErr = '';
  /* which job in a studio's history has its delivery tracker open. Module
     scope, because this page is rebuilt on every packages/studios/assignments
     snapshot and an expanded row must survive that. */
  let _stuJobOpen = null;
  /* the rate card starts collapsed — it is set up once per studio and then
     rarely touched, but its open form is one input row per service and was
     parked between the profile and the money the owner actually came for */
  let _stuRateOpen = false;
  let _stuKeyFixed = false;
  const _loginKeyOk = new Map();   /* studioId -> the phone10 whose login key we confirmed on the server */
  const STUDIOS_CAP = 300;
  function studioById(id){ return STUDIOS.find(s=>s.id===id) || null; }
  const isStudioJob = x => !!x && (x.clientType||'direct') === 'studio';
  const studioJobs = id => livePkgs().filter(p=>isStudioJob(p) && p.studioId === id);

  /* ---- partner portal: mirror each studio job's crew onto its package ----
     The /studio/ portal must never read assignments (they carry crew pay),
     so a pay-free summary lives on the package doc itself as `crew`.
     Recomputed after every packages/assignments snapshot and written only
     when it actually changed — covers assign, edit, delete and re-sync in
     one place, and backfills every existing studio job on the first load
     after this deploys. Server-fresh data only; a cache image must never
     strip a job's crew. */
  let _crewSyncT = null, _crewSyncBusy = false, _crewSyncAgain = false;
  const _crewKey = list => (Array.isArray(list) ? list : [])
    .map(c => [c.name, c.role, c.date, c.slot, c.kind].map(v => String(v || '')).join('|'))
    .sort().join('~');
  function syncStudioCrew(){
    if(!_pkgsFresh || !_asgsFresh) return;
    clearTimeout(_crewSyncT);
    _crewSyncT = setTimeout(async ()=>{
      if(_crewSyncBusy){ _crewSyncAgain = true; return; }
      _crewSyncBusy = true;
      try{
        /* the assignments listener is windowed to the newest ASGS_CAP docs
           by date — past the cap, older assignments fall out of ASGS and a
           naive recompute would silently strip crew off old jobs. When the
           window is full, leave untouched any package whose mirrored crew
           reaches at or below the window's horizon. */
        const _capped = ASGS.length >= ASGS_CAP;
        const _horizon = _capped && ASGS.length ? String(ASGS[ASGS.length-1].date || '') : '';
        for(const p of livePkgs().filter(isStudioJob)){
          if(_capped && (Array.isArray(p.crew) ? p.crew : []).some(c => String((c||{}).date || '') <= _horizon)) continue;
          const want = ASGS.filter(a => a.pkgId === p.id)
            .map(a => ({ name: a.memberName || '', role: a.role || '', date: a.date || '',
                         slot: a.slot || '', kind: a.kind === 'edit' ? 'edit' : '' }));
          if(_crewKey(want) === _crewKey(p.crew)) continue;
          p.crew = want;   /* keep the local copy in step — no rewrite on the echo snapshot */
          await settle(updateDoc(doc(db,'packages',p.id), { crew: want }));
        }
      }finally{
        _crewSyncBusy = false;
        if(_crewSyncAgain){ _crewSyncAgain = false; syncStudioCrew(); }
      }
    }, 1200);
  }
  const CONFIRMED_ST = ['booked','delivered'];

  function loadStudios(){
    if(_studiosUnsub){ renderB2B(); return; }
    _studiosErr = '';
    try{
      /* includeMetadataChanges: with the persistent cache on, an unchanged
         collection raises ONLY the cached snapshot — Firestore suppresses the
         server confirmation because just the metadata changed. The phone10
         backfill below waits for a server snapshot, so without this it would
         never run on a return visit and partner logins would stay unset. */
      _studiosUnsub = onSnapshot(query(collection(db,'studios'), orderBy('createdAt','desc'), limit(STUDIOS_CAP)),
        { includeMetadataChanges: true }, snap=>{
        STUDIOS = snap.docs.map(d=>({ id:d.id, ...d.data() }))
          .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
        warnIfCapped('studios', snap.size, STUDIOS_CAP);
        _studiosLoaded = true;
        /* one-time fix-up: studios saved before the partner portal existed
           carry no phone10 login key — derive it from the profile phone.
           Server snapshots only; a stale cache image must never write. */
        if(!_stuKeyFixed && !snap.metadata.fromCache){
          _stuKeyFixed = true;
          STUDIOS.forEach(s=>{
            if(s.phone10 !== undefined) return;
            const p10 = String(s.phone||'').replace(/\D/g,'').slice(-10);
            if(p10.length !== 10) return;
            s.phone10 = p10;
            settle(updateDoc(doc(db,'studios',s.id), { phone10: p10 }));
            ensurePhoneIndex(p10);
          });
        }
        renderB2B();
      }, err=>{
        try{ if(_studiosUnsub) _studiosUnsub(); }catch(e){} _studiosUnsub = null;
        _studiosErr = 'Could not load studios (' + (err.code||err.message) + ')'
          + ((err.code||'').includes('permission') ? ' — publish the updated firestore.rules from the console first.' : '');
        renderStudioList();
      });
    }catch(err){ _studiosErr = 'Could not load studios (' + (err.code||err.message) + ')'; renderStudioList(); }
  }

  function renderB2B(){
    if($('#calView').hidden) return;
    renderB2BStats();
    renderStudioList();
    if(!$('#studioDetailView').hidden) renderStudioDetail();
  }
  function renderB2BStats(){
    const el = $('#b2bStats'); if(!el) return;
    const jobs = livePkgs().filter(isStudioJob);
    const openJobs = jobs.filter(x=>['sent','unconfirmed','booked'].includes(x.status||'draft')).length;
    const conf = jobs.filter(x=>CONFIRMED_ST.includes(x.status||'draft'));
    const out = conf.reduce((s,x)=>s+Math.max(0,(x.totals||{}).balance||0),0);
    const life = conf.reduce((s,x)=>s+((x.totals||{}).finalPrice||0),0);
    el.innerHTML = `
      <div class="stat"><b>${STUDIOS.filter(s=>s.active !== false).length}</b><span>studios</span></div>
      <div class="stat"><b>${openJobs}</b><span>open jobs</span></div>
      <div class="stat money" data-fin role="button" tabindex="0" title="${inr(out)}"><b>${inrShort(out)}</b><span>to collect</span></div>
      <div class="stat money" data-fin role="button" tabindex="0" title="${inr(life)}"><b>${inrShort(life)}</b><span>lifetime b2b</span></div>`;
  }
  function stuCardHTML(s){
    const jobs = studioJobs(s.id);
    const open = jobs.filter(x=>['sent','unconfirmed','booked'].includes(x.status||'draft')).length;
    const conf = jobs.filter(x=>CONFIRMED_ST.includes(x.status||'draft'));
    const due = conf.reduce((n,x)=>n+Math.max(0,(x.totals||{}).balance||0),0);
    const life = conf.reduce((n,x)=>n+((x.totals||{}).finalPrice||0),0);
    const inactive = s.active === false;
    /* The whole card opens the studio (the [data-stu] handler), so the head is
       a role=button region rather than a real <button> — a <button> here would
       wrap the Call link, and a control inside a button is invalid markup that
       swallows the inner tap. Same visual grammar as Clients and Packages. */
    return `
    <article class="card ${inactive?'tm-inactive':''}" data-stu="${s.id}">
      <div class="card__head">
        <span class="card__toggle" role="button" tabindex="0" aria-label="Open ${esc(s.name||'this studio')}">
          <span class="l1">
            <span class="card__title">${esc(s.name||'—')}</span>
            ${inactive ? '<span class="chip-status no-dot" data-state="neutral">inactive</span>' : ''}
          </span>
          <span class="l2"><span class="card__meta">${esc([s.city, s.ownerName].filter(Boolean).join(' · ')) || '—'}</span></span>
          <span class="chev" aria-hidden="true">›</span>
        </span>
        ${s.phone ? `<span class="card__side"><a class="icon-btn" href="tel:${esc(s.phone)}" aria-label="Call ${esc(s.name||'this studio')}" onclick="event.stopPropagation()">📞</a></span>` : ''}
      </div>
      <div class="stu-chips">
        <b class="c1">${open} open job${open===1?'':'s'}</b>
        <b class="c2">${inr(due)} due</b>
        <b class="c3">${inr(life)} lifetime</b>
      </div>
    </article>`;
  }
  function renderStudioList(){
    const el = $('#studioList'); if(!el) return;
    if(_studiosErr){ el.innerHTML = errBox(_studiosErr, 'studios'); return; }
    if(!STUDIOS.length){
      el.innerHTML = _studiosLoaded
        ? `<div class="empty-state">
             <span class="empty-state__icon">🏢</span>
             <p class="empty-state__title">No partner studios yet</p>
             <p class="empty-state__text">Add the studios that hire Fantasy Studio — their jobs, dues and lifetime value are tracked here.</p>
             <button type="button" class="btn btn--primary" data-stu-add>＋ Add a partner studio</button>
           </div>`
        : '<div class="skeleton"></div><div class="skeleton"></div>';
      return;
    }
    const q = ($('#stuSearch').value||'').trim().toLowerCase();
    const hit = s => !q || [s.name, s.ownerName, s.city, s.phone].some(v=>String(v||'').toLowerCase().includes(q));
    const act = STUDIOS.filter(s=>s.active !== false && hit(s)), inact = STUDIOS.filter(s=>s.active === false && hit(s));
    if(!act.length && !inact.length){
      el.innerHTML = `<div class="empty-state">
          <span class="empty-state__icon">🔍</span>
          <p class="empty-state__title">No studio matches</p>
          <p class="empty-state__text">Nothing for “${esc(q)}” among ${STUDIOS.length} studio${STUDIOS.length===1?'':'s'}.</p>
          <button type="button" class="btn btn--ghost" data-stu-clear>Clear search</button>
        </div>`;
      return;
    }
    el.innerHTML = act.map(stuCardHTML).join('')
      + (inact.length ? `<div class="grp">Inactive<b>${inact.length}</b></div>` + inact.map(stuCardHTML).join('') : '');
  }
  /* Two floating pairs — 🔍+⚡ on Home, 🔍+＋ on the B2B studio LIST (a studio's
     own page has its own actions). One place decides who is on screen, because
     they are fixed to the bottom right and would otherwise sit on top of the
     add-event form's Save row. */
  function syncFabs(){
    const formOpen = !$('#calAdd').hidden;
    const onHome = !$('#homeView').hidden;
    const onStudioList = !$('#calView').hidden && $('#studioDetailView').hidden;
    $('#fabBtn').hidden = !onHome || formOpen;
    /* search is global now — the button follows you to every tab. It hides
       only while the add-event form owns the bottom of the screen. */
    $('#homeSearchBtn').hidden = formOpen || $('#appView').hidden;
    $('#stuSearchBtn').hidden = !onStudioList || formOpen;
    $('#stuAddFab').hidden = !onStudioList || formOpen;
    if(!onStudioList) closeStuSearch();
  }
  function openStuSearch(){
    $('#stuSearchBar').hidden = false;
    $('#stuSearch').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function closeStuSearch(){
    const box = $('#stuSearch'); if(!box) return;
    const had = !!box.value;
    box.value = '';
    $('#stuSearchBar').hidden = true;
    if(had) renderStudioList();
  }
  $('#stuSearch').addEventListener('input', debounce(renderStudioList));
  $('#stuSearch').addEventListener('keydown', e=>{ if(e.key === 'Escape') closeStuSearch(); });
  $('#stuSearchBtn').addEventListener('click', openStuSearch);
  $('#stuSearchX').addEventListener('click', closeStuSearch);
  $('#stuAddFab').addEventListener('click', ()=>openStu(null));
  $('#studioList').addEventListener('click', e=>{
    if(e.target.closest('[data-retry]')){ loadStudios(); toast('Reconnecting…'); return; }
    if(e.target.closest('[data-stu-add]')){ openStu(null); return; }
    if(e.target.closest('[data-stu-clear]')){ $('#stuSearch').value=''; renderStudioList(); return; }
    const card = e.target.closest('[data-stu]'); if(!card) return;
    openStudioDetail(card.dataset.stu);
  });
  /* the short ₹8.4L form has no tooltip on a phone — the tile opens the
     analytics sheet, where the exact figures live */
  $('#b2bStats').addEventListener('click', e=>{ if(e.target.closest('[data-fin]')) openFin(); });
  $('#stuAdd').addEventListener('click', ()=>openStu(null));
  /* same quick-add form as a studio's own page, with the studio still to pick */
  $('#b2bAddEv').addEventListener('click', ()=>openCalAdd({ b2b: true }));

  /* ---------- add / edit studio sheet ---------- */
  function openStu(s){
    _stuEditId = s ? s.id : null;
    $('#stuTitle').textContent = s ? 'Edit Studio' : 'Add Partner Studio';
    $('#stuName').value  = s ? (s.name||'') : '';
    $('#stuOwner').value = s ? (s.ownerName||'') : '';
    $('#stuCity').value  = s ? (s.city||'') : '';
    $('#stuPhone').value = s ? (s.phone||'') : '';
    $('#stuGst').value   = s ? (s.gst||'') : '';
    $('#stuTerms').value = s ? (s.paymentTerms||'') : '';
    $('#stuNotes').value = s ? (s.notes||'') : '';
    const t = $('#stuToggle');
    t.hidden = !s;
    if(s){
      const inact = s.active === false;
      t.textContent = inact ? 'Reactivate studio' : 'Deactivate studio';
      t.style.color = inact ? 'var(--ok)' : 'var(--err)';
    }
    $('#stuModal').classList.add('open'); $('#stuBackdrop').classList.add('open');
    setTimeout(()=>$('#stuName').focus(), 80);
    pushView('stusheet', '#b2b/studio-edit');
  }
  function closeStuUI(){ $('#stuModal').classList.remove('open'); $('#stuBackdrop').classList.remove('open'); _stuEditId = null; }
  function closeStu(){
    backFrom('stusheet', closeStuUI);
  }
  $('#stuClose').addEventListener('click', closeStu);
  $('#stuBackdrop').addEventListener('click', closeStu);
  $('#stuSave').addEventListener('click', async ()=>{
    const btn = $('#stuSave'); if(btn.disabled) return;
    const name = $('#stuName').value.trim();
    if(!name){ toast('Studio name is required'); $('#stuName').focus(); return; }
    /* phone10 is the partner-portal login key: the /studio/ page signs the
       owner in by OTP and queries studios on this exact field. A number
       shorter than 10 digits stores '' — no login, and the detail page
       says so. */
    const _sp10 = $('#stuPhone').value.replace(/\D/g,'').slice(-10);
    const data = { name, ownerName: $('#stuOwner').value.trim(), city: $('#stuCity').value.trim(),
                   phone: $('#stuPhone').value.trim(), phone10: _sp10.length === 10 ? _sp10 : '',
                   gst: $('#stuGst').value.trim(),
                   paymentTerms: $('#stuTerms').value.trim(), notes: $('#stuNotes').value.trim(),
                   updatedAt: serverTimestamp() };
    btn.disabled = true;
    try{
      if(_stuEditId){
        const old = studioById(_stuEditId);
        const res = await settle(updateDoc(doc(db,'studios',_stuEditId), data));
        const sm = settleMsg(res, 'Studio saved ✓');
        toast(sm.msg);
        if(!sm.ok) return;
        /* keep the denormalized name on this studio's jobs in step */
        if(old && (old.name||'') !== name){
          const mine = PKGS.filter(p=>isStudioJob(p) && p.studioId === _stuEditId);
          await Promise.allSettled(mine.map(p=>settle(updateDoc(doc(db,'packages',p.id),
            { studioName: name, clientName: name, updatedAt: serverTimestamp() }))));
          mine.forEach(p=>{ p.studioName = name; p.clientName = name; });
        }
        Object.assign(old||{}, data, { updatedAt: null });
      }else{
        const ref = doc(collection(db,'studios'));
        const res = await settle(setDoc(ref, { ...data, rateCard: {}, active: true, createdAt: serverTimestamp() }));
        const sm = settleMsg(res, 'Studio added ✓');
        toast(sm.msg);
        if(!sm.ok) return;
        STUDIOS.push({ id: ref.id, ...data, rateCard: {}, active: true });
        STUDIOS.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
      }
      /* the partner portal checks this hashed index before sending an OTP —
         same index the client portal uses, so one write serves both */
      if(data.phone10) ensurePhoneIndex(data.phone10);
      renderB2B(); renderPkgList();
      closeStu();
    }catch(err){ toast('Save failed: ' + (err.code||err.message)); }
    finally{ btn.disabled = false; }
  });
  $('#stuToggle').addEventListener('click', async ()=>{
    const s = studioById(_stuEditId); if(!s) return;
    const deactivate = !(s.active === false);
    if(deactivate && !await confirmDialog({
      title:'Deactivate this studio?',
      body:`<b>${esc(s.name||'This studio')}</b> leaves the new-job picker. Existing jobs, dues and history stay exactly as they are.`,
      confirmText:'Deactivate', danger:false
    })) return;
    try{
      const res = await settle(updateDoc(doc(db,'studios',s.id), { active: !deactivate, updatedAt: serverTimestamp() }));
      const sm = settleMsg(res, deactivate ? 'Studio deactivated' : 'Studio reactivated');
      toast(sm.msg);
      if(!sm.ok) return;
      s.active = !deactivate;
      renderB2B();
      closeStu();
    }catch(err){ toast('Update failed'); }
  });

  /* ---------- studio detail: profile, rate card, ledger, jobs ---------- */
  let _stuListScrollY = 0;
  function openStudioDetail(id){
    /* a job expanded on one studio's page must not reopen on the next one —
       nor an open rate card. The draft-capture in renderStudioDetail reads
       whatever rows are in the DOM, so the previous studio's must go before
       the new page renders, or its half-typed rates would be "restored" onto
       the wrong studio (a leak that predates the collapse). */
    if(_stuDetailId !== id){
      _stuJobOpen = null; _stuRateOpen = false;
      const rl = $('#stuRateList'); if(rl) rl.innerHTML = '';
    }
    _stuListScrollY = (!$('#calView').hidden && !$('#studioListView').hidden) ? window.scrollY : 0;
    _stuDetailId = id;
    closeCalAdd();   /* a form opened from the LIST doesn't belong on a studio page */
    renderStudioDetail();
    $('#studioListView').hidden = true; $('#studioDetailView').hidden = false;
    syncFabs();
    scrollTopNow();
    pushView('studio', '#b2b/studio');
  }
  function closeStudioDetail(){
    $('#studioDetailView').hidden = true; $('#studioListView').hidden = false;
    _stuDetailId = null; _stuJobOpen = null; _stuRateOpen = false;
    closeCalAdd();   /* the quick-add form belongs to the studio page above it */
    syncFabs();
    const y = _stuListScrollY, token = ++_scrollToken;
    requestAnimationFrame(()=>{ if(token === _scrollToken) window.scrollTo(0, y); });
  }
  const stuRateRow = (name, rate) => `
    <div class="row" data-srate>
      <button class="del" data-del title="Remove">✕</button>
      <div class="grid2">
        <div class="fld"><label>Service</label><input data-k="name" value="${esc(name)}" /></div>
        <div class="fld"><label>Rate (₹)</label><input data-k="rate" type="number" min="0" value="${Number(rate)||0}" /></div>
      </div>
    </div>`;
  function renderStudioDetail(){
    const el = $('#studioDetailView'); if(!el) return;
    const s = studioById(_stuDetailId);
    if(!s){ el.innerHTML = '<div class="empty">Studio not found — it may have been removed.</div>'; return; }
    /* Any package/studio snapshot re-renders this page. Rebuilding the rate
       card from the SAVED map threw away whatever the owner was typing, so
       capture the live rows (and the caret) and put them back afterwards. */
    const _draft = $$('#stuRateList [data-srate]').map(r=>({
      name: r.querySelector('[data-k="name"]').value,
      rate: r.querySelector('[data-k="rate"]').value
    }));
    const _saved = Object.entries(s.rateCard || {}).map(([n,v])=>({ name:n, rate:String(Number(v)||0) }));
    const _dirty = _draft.length && JSON.stringify(_draft) !== JSON.stringify(_saved);
    const _ae = document.activeElement;
    const _focus = (_ae && _ae.closest && _ae.closest('#stuRateList'))
      ? { row: $$('#stuRateList [data-srate]').indexOf(_ae.closest('[data-srate]')),
          k: _ae.dataset.k, caret: _ae.selectionStart }
      : null;
    const jobs = studioJobs(s.id).sort((a,b)=>{
      const da = a.quoteDate||'', db2 = b.quoteDate||'';
      return da<db2?1:da>db2?-1:0;   /* newest first */
    });
    const conf = [...jobs].filter(x=>CONFIRMED_ST.includes(x.status||'draft')).reverse();  /* oldest first for the running balance */
    let run = 0;
    const led = conf.map(x=>{
      /* totals.* is what the studio card, the B2B tiles and Money Analytics
         all use — deriving 'received' from the payment list instead made this
         ledger disagree with them whenever an advance was typed in the
         builder without an itemised payment row */
      const t = x.totals||{};
      const billed = Number(t.finalPrice)||0;
      const got = Math.max(0, Number(t.advance)||0);
      const out = Math.max(0, Number(t.balance)||0);
      run += out;
      return { x, billed, got, out, run };
    });
    const rates = s.rateCard || {};
    /* unsaved typing keeps the card open through any snapshot re-render —
       collapsing is only ever something the owner did on purpose */
    const rateOpen = !!(_stuRateOpen || _dirty);   /* _dirty is a count — 0 would render aria-expanded="0" */
    _stuRateOpen = rateOpen;   /* keep the toggle's own state in step when a draft forces it open */
    const rateN = Object.keys(rates).length;
    el.innerHTML = `
      <button class="btn btn--sm btn--ghost" id="stuBack" style="margin:1rem 0 .6rem">← All studios</button>
      <div class="sec">
        <h3>🏢 ${esc(s.name||'—')} ${s.active === false ? '<span class="chip-status no-dot" data-state="neutral">inactive</span>' : ''}</h3>
        <p class="sub">${esc([s.ownerName, s.city].filter(Boolean).join(' · '))}${s.gst ? ' · GST ' + esc(s.gst) : ''}</p>
        ${s.paymentTerms ? `<div class="ln2"><span>Payment terms</span><span>${esc(s.paymentTerms)}</span></div>` : ''}
        ${s.notes ? `<div class="ln2"><span>Notes</span><span>${esc(s.notes)}</span></div>` : ''}
        <div class="ln2"><span>Partner portal</span><span id="stuPortalStat">${
          s.active === false ? 'off — studio is inactive'
          : !(s.phone10 && String(s.phone10).length === 10) ? 'no login yet — add a 10-digit mobile via Edit'
          : _loginKeyOk.get(s.id) === s.phone10 ? `✓ signs in at /studio/ with …${esc(String(s.phone10).slice(-4))}`
          : 'checking the login key…'}</span></div>
        <div class="ev-acts">
          ${s.phone ? `<a class="btn btn--sm btn--ghost stu-a" href="tel:${esc(s.phone)}">📞 Call</a>
          <a class="btn btn--sm btn--ghost stu-a" href="https://wa.me/${esc(normPhoneFull(s.phone))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
          <button class="btn btn--sm btn--ghost" type="button" data-stuedit>Edit</button>
          <button class="btn btn--sm btn--ghost" type="button" data-stunewjob>＋ New job</button>
          <button class="btn btn--sm btn--ghost" type="button" data-stuaddev>＋ Add event</button>
        </div>
      </div>
      <div class="sec">
        <h3>📒 Ledger <span style="font-size:.7rem;color:var(--mut)">(booked &amp; delivered jobs)</span></h3>
        ${led.length ? `
          <div class="ledrow hd"><span class="l-ev">Job</span><b>Billed</b><b>Received</b><b>Due</b></div>
          ${led.map(r=>`
          <div class="ledrow"><span class="l-ev">${esc(r.x.quoteNo||'—')} <span>· ${esc(((r.x.events||[])[0]||{}).title||'Job')}${r.x.endClientName ? ' · ' + esc(r.x.endClientName) : ''}</span></span><b title="${inr(r.billed)}">${inrShort(r.billed)}</b><b style="color:var(--ok)" title="${inr(r.got)}">${inrShort(r.got)}</b><b class="${r.out>0?'neg':''}" title="${inr(r.out)}">${inrShort(r.out)}</b></div>`).join('')}
          <div class="ledrow" style="border-top:1px solid var(--line);font-size:.85rem"><span class="l-ev">Outstanding balance</span><b style="color:var(--gold-b)">${inr(run)}</b></div>`
        : '<div class="empty" style="padding:.5rem 0">No confirmed jobs yet — the ledger fills in as jobs are booked.</div>'}
      </div>
      <div class="sec">
        <h3>📦 Job history <span style="font-size:.7rem;color:var(--mut)">(${jobs.length})</span></h3>
        ${jobs.length ? jobs.map(x=>{
          const st = x.status||'draft';
          /* delivery only means anything once the job is confirmed */
          const di = CONFIRMED_ST.includes(st) ? deliveryInfo(x) : null;
          const next = di ? di.steps.find(s=>!(s in di.done)) : '';
          const open = _stuJobOpen === x.id;
          return `
          <div class="stujob ${open?'open':''}">
            <div class="up-ev" data-stujob="${x.id}" role="button" tabindex="0" aria-expanded="${open}">
              <span class="when">${esc(stepDate(nextShootDate(x) || x.quoteDate) || '—')}</span>
              <span class="what">${esc(x.quoteNo||'—')} <span>· ${inr((x.totals||{}).finalPrice||0)}${x.endClientName ? ' · ' + esc(x.endClientName) : ''}${x.whiteLabel ? ' · WL' : ''}</span>
                ${di && di.total ? `<em class="sjd"><span class="dprog"><i style="width:${di.pct}%"></i></span><b>${di.doneCount}/${di.total}</b><span class="sjn">${
                  next ? esc(next) : 'handed over ✓'}</span></em>` : ''}
              </span>
              <span class="chip-status no-dot" data-state="${stateOf(st)}">${STATUS_LABEL(st)}</span>
            </div>
            ${open ? `<div class="sj-det">${di && di.total
              ? trackerHTML(x)
              : '<div class="empty" style="padding:.4rem 0">Delivery tracking starts once this job is booked.</div>'}
              <button class="btn btn--sm btn--ghost" type="button" data-stuopen="${x.id}">Open package</button></div>` : ''}
          </div>`;
        }).join('') : '<div class="empty" style="padding:.5rem 0">No jobs yet — ＋ New job starts one with this studio\'s rates.</div>'}
      </div>
      <div class="sec">
        <h3 class="rc-tog ${rateOpen?'':'closed'}" data-ratetog role="button" tabindex="0" aria-expanded="${rateOpen}">💱 Rate card
          <span class="rc-sum">${rateN ? rateN + ' negotiated rate' + (rateN===1?'':'s') : 'none — jobs quote at retail rates'}</span>
          <span class="car">▾</span></h3>
        ${rateOpen ? `
        <p class="sub">Negotiated — auto-fills new jobs for this studio; leave empty to quote at retail rates.</p>
        <div id="stuRateList">${Object.keys(rates).map(n=>stuRateRow(n, rates[n])).join('')}</div>
        <button class="addrow" type="button" id="stuRateAdd">＋ Add service rate</button>
        <button class="gbtn" type="button" id="stuRateSave" style="margin-top:.7rem">Save Rate Card</button>` : ''}
      </div>`;
    /* put unsaved rate-card typing back after the rebuild */
    if(_dirty){
      $('#stuRateList').innerHTML = _draft.map(r=>stuRateRow(r.name, r.rate)).join('');
      const warn = document.createElement('div');
      warn.className = 'as-warn';
      warn.textContent = '⚠ Unsaved rate-card changes — tap Save Rate Card.';
      $('#stuRateList').insertAdjacentElement('beforebegin', warn);
      if(_focus && _focus.row >= 0){
        const row = $$('#stuRateList [data-srate]')[_focus.row];
        const inp = row && row.querySelector(`[data-k="${_focus.k}"]`);
        if(inp){ inp.focus(); try{ inp.setSelectionRange(_focus.caret, _focus.caret); }catch(e){} }
      }
    }
    checkStudioLogin(s);
  }

  /* The green tick used to be inferred from phone10 alone — but the login key
     write is a separate doc that can quietly fail, and once phone10 exists the
     backfill skips that studio for good. So ask the server whether the key is
     really there, and offer a one-tap retry when it isn't. */
  async function checkStudioLogin(s){
    const p10 = String((s && s.phone10) || '');
    if(!s || s.active === false || p10.length !== 10) return;
    /* this page re-renders on every packages/studios/assignments snapshot —
       confirm the key once per number, not once per render */
    if(_loginKeyOk.get(s.id) === p10) return;
    const live = () => (_stuDetailId === s.id) ? $('#stuPortalStat') : null;
    try{
      const ok = await hasPhoneIndex(p10);
      if(ok) _loginKeyOk.set(s.id, p10);
      const el = live(); if(!el) return;
      el.innerHTML = ok
        ? `✓ signs in at /studio/ with …${esc(p10.slice(-4))}`
        : `⚠ login key missing — this partner cannot sign in <button class="btn btn--sm btn--ghost" type="button" data-stufixlogin style="margin-left:.4rem">Fix now</button>`;
    }catch(err){
      const el = live(); if(!el) return;
      el.textContent = navigator.onLine
        ? `login key set for …${p10.slice(-4)} (couldn't verify just now)`
        : `login key set for …${p10.slice(-4)} (offline — not verified)`;
    }
  }
  $('#studioDetailView').addEventListener('click', async e=>{
    if(e.target.closest('#stuBack')){
      backFrom('studio', closeStudioDetail);
      return;
    }
    if(e.target.closest('[data-stuedit]')){ const s = studioById(_stuDetailId); if(s) openStu(s); return; }
    const fixLogin = e.target.closest('[data-stufixlogin]');
    if(fixLogin){
      const s = studioById(_stuDetailId); if(!s) return;
      fixLogin.disabled = true; fixLogin.textContent = 'Fixing…';
      const ok = await ensurePhoneIndex(s.phone10);
      toast(ok ? 'Login key written — the partner can sign in now'
               : navigator.onLine ? 'Could not write the login key — try again'
                                  : 'Offline — reconnect and tap Fix now again');
      if(ok) checkStudioLogin(s); else { fixLogin.disabled = false; fixLogin.textContent = 'Fix now'; }
      return;
    }
    if(e.target.closest('[data-stunewjob]')){
      const s = studioById(_stuDetailId); if(!s) return;
      if(!canLeaveEditor()) return;
      $('#tabPkgs').click();
      openPkgEdit(null, { studio: s });
      return;
    }
    /* quick date for this studio — same form as the calendar day box */
    if(e.target.closest('[data-stuaddev]')){
      const s = studioById(_stuDetailId); if(!s) return;
      openCalAdd({ studio: s });
      return;
    }
    if(e.target.closest('[data-ratetog]')){
      const s = studioById(_stuDetailId); if(!s) return;
      if(_stuRateOpen){
        /* collapsing throws the DOM rows away — typed-but-unsaved rates must
           not vanish on a mis-tap of the header */
        const draft = $$('#stuRateList [data-srate]').map(r=>({
          name: r.querySelector('[data-k="name"]').value,
          rate: r.querySelector('[data-k="rate"]').value
        }));
        const saved = Object.entries(s.rateCard || {}).map(([n,v])=>({ name:n, rate:String(Number(v)||0) }));
        if(JSON.stringify(draft) !== JSON.stringify(saved)
           && !confirm('Close the rate card? The unsaved rate changes on it will be discarded.')) return;
        /* the render's own draft-capture would otherwise read these rows and
           faithfully restore the draft that was just discarded */
        $('#stuRateList').innerHTML = '';
      }
      _stuRateOpen = !_stuRateOpen;
      renderStudioDetail();
      return;
    }
    if(e.target.closest('#stuRateAdd')){ $('#stuRateList').insertAdjacentHTML('beforeend', stuRateRow('', 0)); return; }
    if(e.target.closest('#stuRateSave')){
      const s = studioById(_stuDetailId); if(!s) return;
      const rateCard = {};
      $$('#stuRateList [data-srate]').forEach(r=>{
        const n = r.querySelector('[data-k="name"]').value.trim();
        if(n) rateCard[n] = Math.max(0, Number(r.querySelector('[data-k="rate"]').value)||0);
      });
      try{
        const res = await settle(updateDoc(doc(db,'studios',s.id), { rateCard, updatedAt: serverTimestamp() }));
        const sm = settleMsg(res, 'Rate card saved ✓');
        toast(sm.msg);
        if(!sm.ok) return;
        s.rateCard = rateCard;
      }catch(err){ toast('Save failed: ' + (err.code||err.message)); }
      return;
    }
    /* Ticking a step and opening the package both live in the expanded panel,
       which is a SIBLING of the row — so neither can be swallowed by the row's
       own expand handler below. */
    const ts = e.target.closest('[data-tstep]');
    if(ts){
      const x = PKGS.find(p=>p.id===_stuJobOpen);
      if(x) await toggleDeliveryStep(x, ts.dataset.name);
      return;
    }
    const so = e.target.closest('[data-stuopen]');
    if(so){
      const x = PKGS.find(p=>p.id===so.dataset.stuopen);
      if(x){ if(!canLeaveEditor()) return; $('#tabPkgs').click(); openPkgEdit(x); }
      return;
    }
    const j = e.target.closest('[data-stujob]');
    if(j){
      /* the row opens its delivery tracker in place now; the package editor is
         one more tap inside, so a glance at progress no longer costs a trip
         through the builder and back */
      _stuJobOpen = (_stuJobOpen === j.dataset.stujob) ? null : j.dataset.stujob;
      renderStudioDetail();
    }
  });

  /* ---------- new booking chooser: direct client or studio job ---------- */
  function renderJtMain(){
    const acts = STUDIOS.filter(s=>s.active !== false);
    $('#jtWho').textContent = 'Who is this job for?';
    $('#jtOpts').innerHTML = `
      <button type="button" data-jt-direct>💍 Direct client<em>wedding / event</em></button>
      <button type="button" data-jt-studio ${acts.length ? '' : 'disabled style="opacity:.5"'}>🏢 Studio job<em>${acts.length ? 'B2B — partner studio' : 'add a studio in B2B first'}</em></button>`;
  }
  function openJobType(){
    renderJtMain();
    $('#jtModal').classList.add('open'); $('#jtBackdrop').classList.add('open');
    pushView('jt', '#packages/new');
  }
  function closeJtUI(){ $('#jtModal').classList.remove('open'); $('#jtBackdrop').classList.remove('open'); }
  function closeJt(){
    backFrom('jt', closeJtUI);
  }
  $('#jtOpts').addEventListener('click', e=>{
    if(e.target.closest('[data-jt-direct]')){
      if(!canLeaveEditor()) return;
      closeJtUI();
      if($('#pkgView').hidden) $('#tabPkgs').click();
      openPkgEdit(null);
      return;
    }
    if(e.target.closest('[data-jt-studio]')){
      const acts = STUDIOS.filter(s=>s.active !== false);
      if(!acts.length) return;
      $('#jtWho').textContent = 'Which studio?';
      $('#jtOpts').innerHTML = acts.map(s=>`<button type="button" data-jt-pick="${s.id}">🏢 ${esc(s.name||'—')}<em>${esc(s.city||'')}</em></button>`).join('')
        + '<button type="button" data-jt-back style="justify-content:center;color:var(--mut)">← Back</button>';
      return;
    }
    if(e.target.closest('[data-jt-back]')){ renderJtMain(); return; }
    const pick = e.target.closest('[data-jt-pick]');
    if(pick){
      const s = studioById(pick.dataset.jtPick);
      if(!canLeaveEditor()) return;
      closeJtUI();
      if(s){
        if($('#pkgView').hidden) $('#tabPkgs').click();
        openPkgEdit(null, { studio: s });
      }
    }
  });
  $('#jtClose').addEventListener('click', closeJt);
  $('#jtBackdrop').addEventListener('click', closeJt);

  /* ---------- status picker sheet ---------- */
  let statusId = null;
  function openStatus(x){
    statusId = x.id;
    $('#stWho').textContent = `${x.quoteNo ? x.quoteNo + ' · ' : ''}${x.clientName||'—'}`;
    $('#stOpts').innerHTML = PKG_STATES.map(s=>`
      <button data-st="${s}" class="${(x.status||'draft')===s?'on':''}"><i class="dot ${s}"></i>${STATUS_LABEL(s)}${(x.status||'draft')===s?'<em>current</em>':''}</button>`).join('');
    $('#stModal').classList.add('open'); $('#stBackdrop').classList.add('open');
    pushView('stsheet', '#packages/status');
  }
  function closeStatusUI(){ $('#stModal').classList.remove('open'); $('#stBackdrop').classList.remove('open'); statusId = null; }
  function closeStatus(){
    backFrom('stsheet', closeStatusUI);
  }
  $('#stClose').addEventListener('click', closeStatus);
  $('#stBackdrop').addEventListener('click', closeStatus);
  $('#stOpts').addEventListener('click', async e=>{
    const b = e.target.closest('[data-st]'); if(!b) return;
    const x = PKGS.find(p=>p.id===statusId);
    if(!x){ closeStatus(); return; }
    const next = b.dataset.st;
    if((x.status||'draft') === next){ closeStatus(); return; }
    if(next === 'booked'){
      /* warn per DATE, and only once a date already carries a full day
         (DATE_EVENT_CAP events) — parallel crews make shared dates normal */
      const busy = (x.events||[])
        .filter(ev=>/^\d{4}-\d{2}-\d{2}$/.test(ev.date||''))
        .map(ev=>({ date: ev.date, n: dateConflicts(ev.date, x.id, x.clientName).length }))
        .filter(r=>r.n >= DATE_EVENT_CAP);
      if(busy.length && !confirm(`⚠ Heavy day: ${stepDate(busy[0].date)} already has ${busy[0].n} events booked${busy.length>1 ? ' (+' + (busy.length-1) + ' more full dates)' : ''}. Booking this adds another on top. Book anyway?`)) return;
    }
    const patch = { status: next, updatedAt: serverTimestamp() };
    if(next === 'delivered') patch.deliveredAt = todayISO();
    else if(x.deliveredAt) patch.deliveredAt = deleteField();
    if(next === 'sent') patch.sentAt = todayISO();
    try{
      const res = await settle(updateDoc(doc(db,'packages',x.id), patch));
      if(res === 'denied'){
        toast('Status NOT changed — the server refused the write. Try again.');
        return;                            /* leave the sheet open, mirror untouched */
      }
      x.status = next;
      if(next === 'delivered') x.deliveredAt = patch.deliveredAt; else delete x.deliveredAt;
      if(next === 'sent') x.sentAt = patch.sentAt;
      /* leaving draft = this phone becomes a real client — open the portal's
         pre-OTP check for them now (drafts are deliberately not indexed) */
      if(next !== 'draft' && x.clientPhone) ensurePhoneIndex(x.clientPhone);
      buzz(); renderPkgList(); closeStatus();
      toast(res === 'queued' ? `Status → ${next} (will sync)` : `Status → ${next}`);
    }catch(err){ toast('Update failed'); }
  });

  /* ---------- record payment ---------- */
  let payingId = null, payMode = 'online';
  function openPay(x){
    payingId = x.id; payMode = 'online';
    $('#modeOnline').classList.add('on'); $('#modeCash').classList.remove('on');
    $('#payWho').textContent = `${x.clientName||'—'} — balance ${inr(Math.max(0,(x.totals||{}).balance||0))} of ${inr((x.totals||{}).finalPrice||0)}`;
    $('#payAmt').value = '';
    const bal = Number((x.totals||{}).balance)||0;
    const fin = Number((x.totals||{}).finalPrice)||0;
    const quick = [];
    if(bal > 0) quick.push(['Full balance', bal]);
    if(fin > 0){
      const half = Math.round(fin*0.5), ten = Math.round(fin*0.10);
      if(half > 0 && half < bal) quick.push(['50% advance', half]);
      if(ten > 0 && ten < bal) quick.push(['10% delivery', ten]);
    }
    $('#payQuick').innerHTML = quick.map(([l,v])=>`<button type="button" data-qa="${v}">${l} · ${inr(v)}</button>`).join('');
    $('#payDate').value = todayISO();
    const hist = (x.payments||[]);
    $('#payHist').innerHTML = hist.length
      ? '<b style="color:var(--gold-b)">Previous payments</b>' + hist.map(pm=>
          `<div><span>${esc(dmy(pm.date))} · ${esc(pm.mode||'')}</span><span>${inr(pm.amount||0)} <button class="rm" data-rmpay data-pid="${esc(pm.id||'')}" data-amt="${Number(pm.amount)||0}" data-date="${esc(pm.date||'')}" data-mode="${esc(pm.mode||'')}" title="Remove this payment">✕</button></span></div>`).join('')
      : '';
    const wasOpen = $('#payModal').classList.contains('open');
    $('#payModal').classList.add('open'); $('#payBackdrop').classList.add('open');
    setTimeout(()=>$('#payAmt').focus(), 80);
    if(!wasOpen) pushView('pay', '#packages/pay');
  }
  function closePayUI(){ $('#payModal').classList.remove('open'); $('#payBackdrop').classList.remove('open'); payingId = null; }
  function closePay(){
    backFrom('pay', closePayUI);
  }
  $('#payQuick').addEventListener('click', e=>{
    const b = e.target.closest('[data-qa]'); if(!b) return;
    $('#payAmt').value = b.dataset.qa; $('#payAmt').focus();
  });
  $('#payClose').addEventListener('click', closePay);
  $('#payBackdrop').addEventListener('click', closePay);
  $('#modeOnline').addEventListener('click', ()=>{ payMode='online'; $('#modeOnline').classList.add('on'); $('#modeCash').classList.remove('on'); });
  $('#modeCash').addEventListener('click', ()=>{ payMode='cash'; $('#modeCash').classList.add('on'); $('#modeOnline').classList.remove('on'); });
  document.addEventListener('keydown', e=>{
    if(e.key !== 'Escape') return;
    /* the expense form sits inside the money sheet — one Escape should close
       the form, not the sheet out from under it */
    if(!$('#expForm').hidden){ closeExpForm(); return; }
    closePay(); closeStatus(); closeFin(); closeEv(); closeUpList(); closeQa(); closeStu(); closeJt();
  });
  /* Everything tappable here is a div — a calendar date, a shoot row, a stat
     tile, a group header. They are focusable now, so give them a button's
     keyboard behaviour too instead of leaving a laptop unable to reach them. */
  document.addEventListener('keydown', e=>{
    if(e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const t = e.target;
    if(!t || !t.matches || !t.matches('[tabindex="0"][role="button"]')) return;
    e.preventDefault();   /* Space would scroll the page */
    t.click();
  });
  /* Money arrived, but the status never moved: a client who had paid the 50%
     sat in 'sent' — the date stayed open in the clash check, no crew could be
     assigned against a booking that did not exist, the follow-up list kept
     chasing them and the client portal showed the wrong stage. Your printed
     terms already say it ("dates are blocked only once the advance is
     received"); offer the transition at the exact moment the money lands. */
  const BOOKABLE_ON_PAYMENT = ['draft','sent','unconfirmed'];
  async function offerBookOnPayment(x, amount){
    if(!BOOKABLE_ON_PAYMENT.includes(x.status||'draft')) return;
    const nd = nextShootDate(x);
    if(!confirm(`${inr(amount)} received on ${x.quoteNo ? x.quoteNo + ' · ' : ''}${x.clientName||'this package'}.\n\nMark it as Booked? Your terms hold the dates only once the advance is in — booking blocks ${nd ? stepDate(nd) : 'the dates'} in the calendar, lets you assign crew, and stops the follow-up reminders.`)) return;
    const patch = { status: 'booked', updatedAt: serverTimestamp() };
    if(x.deliveredAt) patch.deliveredAt = deleteField();
    try{
      const res = await settle(updateDoc(doc(db,'packages',x.id), patch));
      if(res === 'denied'){
        toast('Payment saved — but the status was NOT changed. Set it to Booked from the status pill.');
        return;
      }
      x.status = 'booked'; delete x.deliveredAt;
      /* it may have been a draft until now, and drafts are deliberately kept
         out of the portal's pre-OTP check */
      if(x.clientPhone) ensurePhoneIndex(x.clientPhone);
      buzz(); renderPkgList(); renderCalendar();
      toast(res === 'queued' ? 'Marked Booked — will sync' : '📅 Booked — the dates are held');
    }catch(err){
      toast('Payment saved — but the status change failed (' + (err.code||err.message) + ')');
    }
  }

  $('#paySave').addEventListener('click', async ()=>{
    const x = PKGS.find(pk=>pk.id===payingId); if(!x) return;
    const btn = $('#paySave'); if(btn.disabled) return;
    const amount = Math.round(Number($('#payAmt').value)||0);
    if(amount <= 0){ toast('Enter the amount received'); $('#payAmt').focus(); return; }
    /* there was no upper bound at all: a stray extra digit turned ₹15,000 into
       ₹1,50,000 and was stored without a word */
    const due = Math.max(0, Number((x.totals||{}).balance) || 0);
    if(amount > due){
      /* the `due > 0` version of this guard skipped the ONE case where every
         rupee is an overpayment: a package already fully paid */
      const over = amount - due;
      const msg = due === 0
        ? `This package is already fully paid — nothing is due.\n\nRecording ${inr(amount)} will push it ${inr(over)} into overpayment (and inflate your money reports).\n\nRecord it anyway?`
        : `${inr(amount)} is ${inr(over)} more than the ${inr(due)} still due on this package.\n\nRecord it anyway?`;
      if(!confirm(msg)){ $('#payAmt').focus(); return; }
    }
    const payment = { id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
                      amount, date: $('#payDate').value || todayISO(), mode: payMode };
    btn.disabled = true;
    try{
      /* arrayUnion + increment: safe against a stale list on another phone, and queues offline */
      const res = await settle(updateDoc(doc(db,'packages',x.id), {
        payments: arrayUnion(payment),
        'totals.advance': increment(amount),
        'totals.balance': increment(-amount),
        updatedAt: serverTimestamp()
      }));
      /* A refused write must not update the local mirror or close the sheet —
         the owner would walk away believing a payment was recorded that does
         not exist anywhere. 'queued' is genuinely fine: Firestore will replay
         it when the connection returns. */
      if(res === 'denied'){
        btn.disabled = false;
        toast(`NOT saved — the server refused this payment. ${inr(amount)} was not recorded. Check your sign-in and try again.`);
        return;
      }
      x.payments = [...(x.payments||[]), payment];
      const tt = Object.assign({ gross:0, discount:0, finalPrice:0, advance:0, balance:0 }, x.totals||{});
      tt.advance = (Number(tt.advance)||0) + amount;
      tt.balance = (Number(tt.finalPrice)||0) - tt.advance;
      x.totals = tt;
      buzz(); renderPkgList();
      closePay();
      toast(res === 'queued'
        ? `${inr(amount)} saved offline — will sync`
        : `${inr(amount)} (${payMode}) recorded — balance ${inr(Math.max(0,tt.balance))}`);
      /* status first, receipt second: the booking is the part that costs you a
         date if it is forgotten */
      await offerBookOnPayment(x, amount);
      if(x.clientPhone && confirm('Send a WhatsApp receipt to the client?')){
        openWa(waLink(x, waReceiptText(x, payment, Math.max(0,tt.balance))));
      }
    }catch(err){ toast('Save failed: ' + (err.code||err.message)); }
    finally{ btn.disabled = false; }
  });

  /* remove a mistaken payment — transaction so totals stay exact (needs signal) */
  $('#payHist').addEventListener('click', async e=>{
    const b = e.target.closest('[data-rmpay]'); if(!b) return;
    const x = PKGS.find(pk=>pk.id===payingId); if(!x) return;
    /* resolve the payment by identity (not row index) — the list may have refreshed since the modal opened */
    const pm = (x.payments||[]).find(p=>p && (b.dataset.pid ? p.id === b.dataset.pid
      : (!p.id && Number(p.amount)===Number(b.dataset.amt) && (p.date||'')===b.dataset.date && (p.mode||'')===b.dataset.mode)));
    if(!pm){ toast('Payment not found — reopen and retry'); return; }
    if(!await confirmDialog({
      title:'Remove this payment?',
      body:`<b>${inr(pm.amount)}</b> recorded on ${esc(dmy(pm.date)||pm.date)} comes off. The balance owed goes back up by the same amount.`,
      confirmText:'Remove'
    })) return;
    try{
      const arr = await runTransaction(db, async t=>{
        const ref = doc(db,'packages',x.id);
        const snap = await t.get(ref);
        if(!snap.exists()) throw new Error('package not found');
        const cur = snap.data();
        const list = [...(cur.payments||[])];
        const i = pm.id ? list.findIndex(p=>p && p.id === pm.id)
                        : list.findIndex(p=>p && !p.id && p.amount===pm.amount && p.date===pm.date && p.mode===pm.mode);
        if(i < 0) throw new Error('payment not found — refresh and retry');
        list.splice(i, 1);
        const tt = Object.assign({ gross:0, discount:0, finalPrice:0, advance:0, balance:0 }, cur.totals||{});
        tt.advance = Math.max(0, (Number(tt.advance)||0) - (Number(pm.amount)||0));
        tt.balance = (Number(tt.finalPrice)||0) - tt.advance;
        t.update(ref, { payments: list, totals: tt, updatedAt: serverTimestamp() });
        return { list, tt };
      });
      x.payments = arr.list; x.totals = arr.tt;
      renderPkgList(); openPay(x);
      toast('Payment removed — balance updated');
    }catch(err){ toast('Remove failed: ' + (err.message||err.code||'no signal')); }
  });

  /* ---------- studio spending ----------
     Crew pay is derived from assignments; everything else the studio spends —
     rent, gear, travel, food, ads, staff salaries — is entered by hand here.
     Admin-only by the same default-deny rule that guards every other money
     record, so no rules change is needed for it to work. */
  const EXP_CATS = [['rent','🏠 Rent'], ['gear','📷 Gear'], ['travel','✈️ Travel'],
                    ['food','🍽️ Food'], ['ads','📣 Ads'], ['salary','👤 Salary'], ['other','🧾 Other']];
  const EXP_LABEL = Object.fromEntries(EXP_CATS);
  const catName = c => EXP_LABEL[String(c||'other')] || EXP_LABEL.other;
  let EXPS = [], _expsUnsub = null, _expsLoaded = false, _expsErr = '';
  const EXPS_CAP = 3000;
  const liveExps = () => EXPS.filter(x=>!x.deleted);
  const expAmt = x => Math.max(0, Number(x && x.amount)||0);
  function loadExps(){
    if(_expsUnsub) return;
    _expsErr = '';
    try{
      _expsUnsub = onSnapshot(query(collection(db,'expenses'), orderBy('date','desc'), limit(EXPS_CAP)), snap=>{
        EXPS = snap.docs.map(d=>({ id:d.id, ...d.data() }));
        warnIfCapped('expenses', snap.size, EXPS_CAP);
        _expsLoaded = true;
        if($('#finModal').classList.contains('open')) renderFin();
      }, err=>{
        try{ if(_expsUnsub) _expsUnsub(); }catch(e){}
        _expsUnsub = null;   /* reopening Money Analytics resubscribes */
        _expsErr = 'Could not load expenses (' + (err.code||err.message) + ')';
        if($('#finModal').classList.contains('open')) renderFin();
      });
    }catch(err){ _expsErr = 'Could not load expenses (' + (err.code||err.message) + ')'; }
  }

  /* ---------- money analytics sheet ----------
     Everything is computed from recorded payments (amount + date + mode) and
     package totals — the same numbers the stat tiles show, just broken down
     month-wise and year-wise. */
  let finYear = null;
  function finPayments(){
    const rows = [];
    livePkgs().forEach(x=>(x.payments||[]).forEach(pm=>{
      if(!pm) return;
      rows.push({ amt: Number(pm.amount)||0, date: String(pm.date||''), mode: pm.mode||'', b2b: isStudioJob(x) });
    }));
    return rows;
  }
  /* corporate-style reporting: Indian financial year (Apr–Mar) with
     Q1 Apr–Jun · Q2 Jul–Sep · Q3 Oct–Dec · Q4 Jan–Mar and an annual total.
     finYear holds the FY START year (2026 = FY 2026-27). */
  const fyStartOf = ds => { const yy = Number(ds.slice(0,4)), mm = Number(ds.slice(5,7)); return mm >= 4 ? yy : yy - 1; };
  const fyLabel = yy => `FY ${yy}-${String((yy+1)%100).padStart(2,'0')}`;
  function openFin(){
    loadExps();   /* no-op when already listening; retries after an error */
    if(finYear == null){
      const now = new Date();
      finYear = (now.getMonth()+1) >= 4 ? now.getFullYear() : now.getFullYear()-1;
    }
    renderFin();
    const wasOpen = $('#finModal').classList.contains('open');
    $('#finModal').classList.add('open'); $('#finBackdrop').classList.add('open');
    if(!wasOpen) pushView('fin', '#money');
  }
  function closeFinUI(){ $('#finModal').classList.remove('open'); $('#finBackdrop').classList.remove('open'); closeExpForm(); }
  function closeFin(){
    backFrom('fin', closeFinUI);
  }
  function renderFin(){
    const pays = finPayments().filter(p=>/^\d{4}-\d{2}-\d{2}/.test(p.date));
    const confirmed = livePkgs().filter(x=>['booked','delivered'].includes(x.status||'draft'));
    const outstanding = confirmed.reduce((s,x)=>s+Math.max(0,(x.totals||{}).balance||0),0);
    const bookedVal = confirmed.reduce((s,x)=>s+((x.totals||{}).finalPrice||0),0);
    /* Same basis as the table's Collected column (totals.advance), so the
       tile and the rows can never disagree. An advance typed in the builder
       counts as received even when it has no itemised payment row. */
    const allGot = confirmed.reduce((s,x)=>s+Math.max(0,(x.totals||{}).advance||0),0);
    const allRows = pays.reduce((s,p)=>s+p.amt,0);
    const y = Number(finYear);
    /* cash-flow splits for the selected FY (by payment date) */
    const inFy = pays.filter(p=>fyStartOf(p.date) === y);
    const got = inFy.reduce((s,p)=>s+p.amt,0);
    const online = inFy.filter(p=>p.mode==='online').reduce((s,p)=>s+p.amt,0);
    const cash = inFy.filter(p=>p.mode==='cash').reduce((s,p)=>s+p.amt,0);
    /* ---- the expense side: crew pay ----
       Owed is all-time, like "to collect" on the income side. Paid is bucketed
       by the date it was marked paid, like the cash-flow splits above, so
       "in hand" below compares like with like: money that came in this FY less
       money that went out this FY. Same basis as the Team tab's "crew pay due"
       tile, so the two screens can never disagree. */
    /* crew pay is settled in instalments, so the money that left is summed
       from the instalments themselves — each carries its own date, which is
       the only thing a financial year can be cut on */
    const crewDue     = ASGS.reduce((s,a)=>s + payDue(a), 0);
    const crewPaidAll = ASGS.reduce((s,a)=>s + payGot(a), 0);
    const crewPaidFy  = ASGS.reduce((s,a)=>s + payEvents(a).reduce((n,p)=>
      n + ((/^\d{4}-\d{2}-\d{2}$/.test(p.date) && fyStartOf(p.date) === y) ? p.amount : 0), 0), 0);
    /* a crew payment marked paid before payment dates were stored has no date
       to bucket by — say so rather than quietly dropping it out of the FY line */
    const crewPaidUndated = crewPaidAll - ASGS.reduce((s,a)=>s + payEvents(a).reduce((n,p)=>
      n + (/^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.amount : 0), 0), 0);
    const money = v => `<b title="${inr(v)}">${inrShort(v)}</b>`;
    /* ---- everything else the studio spends ---- */
    const exps = liveExps().filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.date||''));
    const expInFy = exps.filter(x=>fyStartOf(x.date) === y);
    const expFy = expInFy.reduce((n,x)=>n + expAmt(x), 0);
    const expAll = exps.reduce((n,x)=>n + expAmt(x), 0);
    const byCat = {};
    expInFy.forEach(x=>{ const c = String(x.cat||'other'); byCat[c] = (byCat[c]||0) + expAmt(x); });
    const catRow = Object.entries(byCat).sort((a,b)=>b[1]-a[1])
      .map(([c,v])=>`<span>${esc(catName(c))} ${money(v)}</span>`).join('');
    /* crew pay and expenses are both cash out; "in hand" is what the FY's
       collections are actually worth once both have left */
    const outFy = crewPaidFy + expFy;
    /* ---- the systematic table: every period shows Billed / Collected / Balance,
       from confirmed bookings anchored to their first event date ---- */
    const anchor = x => {
      const ds = (x.events||[]).map(e=>e.date).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')).sort();
      return ds[0] || (/^\d{4}-\d{2}-\d{2}$/.test(x.quoteDate||'') ? x.quoteDate : tsDate(x.createdAt));
    };
    const jobs = confirmed.map(x=>({
      d: anchor(x),
      billed: Number((x.totals||{}).finalPrice)||0,
      recv: Math.max(0, Number((x.totals||{}).advance)||0),
      due: Math.max(0, Number((x.totals||{}).balance)||0)
    })).filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.d||''));
    const Z = () => ({ billed:0, recv:0, due:0, n:0 });
    const addTo = (o,r) => { o.billed+=r.billed; o.recv+=r.recv; o.due+=r.due; o.n++; };
    const FMN = ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar'];
    const months = FMN.map(Z);
    const byFy = {};
    jobs.forEach(r=>{
      const fy = fyStartOf(r.d);
      byFy[fy] = byFy[fy] || Z(); addTo(byFy[fy], r);
      if(fy === y){ const idx = (Number(r.d.slice(5,7))+8)%12; addTo(months[idx], r); }
    });
    const QL = ['Q1','Q2','Q3','Q4'], QR = ['Apr–Jun','Jul–Sep','Oct–Dec','Jan–Mar'];
    const qs = [0,1,2,3].map(qi=>{
      const sl = months.slice(qi*3, qi*3+3), o = Z();
      sl.forEach(m=>{ o.billed+=m.billed; o.recv+=m.recv; o.due+=m.due; o.n+=m.n; });
      return o;
    });
    const fyTot = byFy[y] || Z();
    const fys = Object.keys(byFy).map(Number).sort((a,b)=>b-a);
    /* four money columns on a phone: the full figure does not fit, and this is
       a summary table — the exact rupees stay in the title */
    const amt = v => v ? `<span title="${inr(v)}">${inrShort(v)}</span>` : '—';
    const row3 = (label, o, cls='', attrs='') => `
      <div class="ledrow finled ${cls}" ${attrs}><span class="l-ev">${label}</span><b>${amt(o.billed)}</b><b style="color:var(--ok)">${amt(o.recv)}</b><b class="${o.due>0?'neg':''}">${amt(o.due)}</b></div>`;
    const HD = '<div class="ledrow finled hd"><span class="l-ev">Period</span><b>Billed</b><b>Collected</b><b>Balance</b></div>';
    $('#finWho').textContent = 'Financial-year view (Apr–Mar) — billed / collected / balance per period, from confirmed bookings by event date';
    $('#finBody').innerHTML = `
      <div class="fintiles">
        <div class="stat" title="${inr(outstanding)}"><b>${inrShort(outstanding)}</b><span>to collect</span></div>
        <div class="stat" title="${inr(bookedVal)}"><b>${inrShort(bookedVal)}</b><span>booked value</span></div>
        <div class="stat" title="${inr(allGot)}"><b>${inrShort(allGot)}</b><span>received · all time</span></div>
        <div class="stat money out" title="${_asgsLoaded ? inr(crewDue) : 'Loading crew pay…'}"><b>${_asgsLoaded ? inrShort(crewDue) : '…'}</b><span>crew pay due</span></div>
      </div>
      <div class="finyr">
        <button data-fy="-1" type="button" aria-label="Previous financial year">‹</button>
        <b>${fyLabel(y)}</b>
        <button data-fy="1" type="button" aria-label="Next financial year">›</button>
      </div>
      <div class="finsplit"><span>💳 Online ${money(online)}</span><span>💵 Cash ${money(cash)}</span><span>🧾 <b>${inFy.length}</b> payment${inFy.length===1?'':'s'} this FY</span></div>
      <div class="finsplit out"><span>🎬 Crew paid ${money(crewPaidFy)}</span><span>💸 Expenses ${money(expFy)}</span><span>🔻 Total out ${money(outFy)}</span><span>💼 In hand ${money(got - outFy)}</span></div>
      ${catRow ? `<div class="finsplit out cats">${catRow}</div>` : ''}
      <div class="finsplit"><span>⏳ Crew still owed ${money(crewDue)}</span>${expAll !== expFy ? `<span>🧾 ${inrShort(expAll)} spent all time</span>` : ''}</div>
      ${_expsErr ? `<div class="finnote">${esc(_expsErr)} — the expense figures above are incomplete. Close and reopen this sheet to retry.</div>` : ''}
      ${crewPaidUndated > 0 ? `<div class="finnote">${inr(crewPaidUndated)} of crew pay was marked paid before payment dates were kept, so it sits outside every financial year — it is still counted in "still owed" having left, just not in this FY's crew-paid line.</div>` : ''}
      ${allRows < allGot ? `<div class="finnote">Online/cash covers itemised payments only — ${inr(allGot - allRows)} was entered straight as an advance in the builder, so it is counted as received but has no mode.</div>` : ''}
      ${(()=>{ const b = inFy.filter(p=>p.b2b).reduce((s,p)=>s+p.amt,0);
               return b > 0 ? `<div class="finsplit"><span>💍 Direct <b>${inr(got - b)}</b></span><span>🏢 Studio <b>${inr(b)}</b></span></div>` : ''; })()}
      <div class="finh">Quarterly · ${fyLabel(y)}</div>
      ${HD}
      ${qs.map((q,i)=>row3(`${QL[i]} <span>${QR[i]}</span>`, q)).join('')}
      ${row3('Annual', fyTot, 'annual')}
      <div class="finh">Month-wise · ${fyLabel(y)}</div>
      ${HD}
      ${months.map((m,i)=>row3(FMN[i], m)).join('')}
      <div class="finh">Money out · ${fyLabel(y)}</div>
      <div class="ledrow finled hd"><span class="l-ev">Month</span><b>Crew</b><b>Expenses</b><b>Out</b></div>
      ${(()=>{
        /* crew pay lands in the month it was marked paid, expenses in the
           month they are dated — the same basis as the cash-flow line above */
        const sp = FMN.map(()=>({ crew:0, other:0 }));
        const mIdx = ds => (Number(ds.slice(5,7))+8)%12;
        expInFy.forEach(x=>{ sp[mIdx(x.date)].other += expAmt(x); });
        ASGS.forEach(a=>payEvents(a).forEach(p=>{
          if(/^\d{4}-\d{2}-\d{2}$/.test(p.date) && fyStartOf(p.date) === y) sp[mIdx(p.date)].crew += p.amount;
        }));
        const tot = sp.reduce((o,m)=>({ crew:o.crew+m.crew, other:o.other+m.other }), {crew:0,other:0});
        const line = (label, m, cls='') => `
          <div class="ledrow finled ${cls}"><span class="l-ev">${label}</span><b>${amt(m.crew)}</b><b>${amt(m.other)}</b><b class="${(m.crew+m.other)>0?'neg':''}">${amt(m.crew+m.other)}</b></div>`;
        return sp.map((m,i)=>line(FMN[i], m)).join('') + line('Total', tot, 'annual');
      })()}
      <div class="finh">Expenses · ${fyLabel(y)} <button class="btn btn--sm btn--ghost" type="button" id="expAdd">＋ Add expense</button></div>
      ${expInFy.length ? expInFy.slice(0, _expAll ? 500 : 8).map(x=>`
        <div class="up-ev exprow">
          <span class="when">${esc(dmy(x.date))}</span>
          <span class="what" data-exp="${esc(x.id)}" role="button" tabindex="0">${esc(catName(x.cat))}${x.note ? ' · ' + esc(x.note) : ''}${x.mode ? `<span> · ${esc(x.mode)}</span>` : ''}</span>
          <b title="${inr(expAmt(x))}">${inrShort(expAmt(x))}</b>
          <button class="icon-btn icon-btn--danger" data-exdel="${esc(x.id)}" title="Delete this expense">✕</button>
        </div>`).join('')
        + (expInFy.length > 8 ? `<button class="upall" type="button" id="expAll">${_expAll ? '− Show fewer' : `＋ See all ${expInFy.length}`}</button>` : '')
      : `<div class="empty" style="padding:.5rem 0">${_expsLoaded ? 'Nothing recorded for this year yet — tap ＋ Add expense.' : 'Loading…'}</div>`}
      <div class="finh">Annual · financial years</div>
      ${fys.length ? HD + fys.map(fy=>row3(`${fy}-${String((fy+1)%100).padStart(2,'0')}`, byFy[fy], fy===y?'on':'', `data-fyr="${fy}" role="button" tabindex="0" title="Show ${fyLabel(fy)} quarter-wise"`)).join('')
      : '<div class="empty" style="padding:.6rem 0">No confirmed bookings yet — this table fills in as packages are booked.</div>'}`;
  }
  $('#finBody').addEventListener('click', async e=>{
    const fy = e.target.closest('[data-fy]');
    if(fy){ finYear = Number(finYear) + Number(fy.dataset.fy); renderFin(); return; }
    if(e.target.closest('#expAdd')){ openExpForm(null); return; }
    if(e.target.closest('#expAll')){ _expAll = !_expAll; renderFin(); return; }
    const ed = e.target.closest('[data-exp]');
    if(ed){ const x = EXPS.find(v=>v.id === ed.dataset.exp); if(x) openExpForm(x); return; }
    const del = e.target.closest('[data-exdel]');
    if(del){
      const x = EXPS.find(v=>v.id === del.dataset.exdel); if(!x) return;
      if(!await confirmDialog({
        title:'Delete this expense?',
        body:`<b>${esc(catName(x.cat))}</b> · ${inr(expAmt(x))} · ${esc(dmy(x.date))}`,
        confirmText:'Delete'
      })) return;
      /* Expenses are not soft-deleted into Trash the way packages and leads
         are — they are small, hand-typed records. The undo below puts the
         same entry straight back, so a mis-tap is one tap to reverse. */
      const copy = { date: x.date||'', amount: expAmt(x), cat: String(x.cat||'other'),
                     mode: x.mode||'', note: x.note||'' };
      try{
        const res = await settle(deleteDoc(doc(db,'expenses',x.id)));
        if(res === 'denied'){ toast('NOT deleted — the server refused this write. Check your sign-in and try again.'); return; }
        EXPS = EXPS.filter(v=>v.id !== x.id);
        if(_expEdit === x.id) closeExpForm();
        renderFin();
        toastUndo('Expense deleted', async ()=>{
          try{
            const ref = doc(collection(db,'expenses'));
            const r2 = await settle(setDoc(ref, { ...copy, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
            if(r2 === 'denied'){ toast('Undo failed — the server refused the write'); return; }
            addExpLocal({ id: ref.id, ...copy });
            renderFin(); toast('Expense restored');
          }catch(err){ toast('Undo failed'); }
        });
      }catch(err){ toast('Delete failed: ' + (err.code||err.message)); }
      return;
    }
    const yr = e.target.closest('[data-fyr]');
    if(yr){ finYear = Number(yr.dataset.fyr); renderFin(); }
  });

  /* ---------- add / edit one expense ---------- */
  let _expAll = false, _expEdit = null, _exCat = '', _exMode = 'online';
  /* the list is date-desc; keep the local mirror in the same order as the
     snapshot that will replace it, so a saved row does not jump on refresh */
  const addExpLocal = row => { EXPS = [row, ...EXPS].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))); };
  function syncExPills(){
    $$('#exCat button').forEach(b=>b.classList.toggle('on', b.dataset.exc === _exCat));
    $$('#exMode button').forEach(b=>b.classList.toggle('on', b.dataset.exm === _exMode));
  }
  function openExpForm(x){
    _expEdit = x ? x.id : null;
    _exCat = x ? String(x.cat||'other') : '';   /* no default: a wrong category is worse than one extra tap */
    _exMode = (x && x.mode === 'cash') ? 'cash' : 'online';
    $('#exTitle').textContent = x ? '✎ Edit expense' : '＋ New expense';
    $('#exDate').value = (x && x.date) ? x.date : todayISO();
    $('#exAmt').value = x ? expAmt(x) : '';
    $('#exNote').value = (x && x.note) || '';
    $('#exCat').innerHTML = EXP_CATS.map(([v,l])=>`<button type="button" data-exc="${v}">${l}</button>`).join('');
    syncExPills();
    $('#expForm').hidden = false;
    $('#expForm').scrollIntoView({ block:'nearest' });
    setTimeout(()=>{ if(!$('#expForm').hidden) $('#exAmt').focus(); }, 80);
  }
  function closeExpForm(){ $('#expForm').hidden = true; _expEdit = null; }
  $('#exCat').addEventListener('click', e=>{
    const b = e.target.closest('[data-exc]'); if(!b) return;
    _exCat = b.dataset.exc; syncExPills();
  });
  $('#exMode').addEventListener('click', e=>{
    const b = e.target.closest('[data-exm]'); if(!b) return;
    _exMode = b.dataset.exm; syncExPills();
  });
  $('#exCancel').addEventListener('click', closeExpForm);
  $('#exSave').addEventListener('click', async ()=>{
    const date = $('#exDate').value;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')){ toast('Pick a date for this expense'); $('#exDate').focus(); return; }
    const amount = Math.round(Number($('#exAmt').value)||0);
    if(amount <= 0){ toast('Enter the amount spent'); $('#exAmt').focus(); return; }
    if(!_exCat){ toast('Pick a category'); return; }
    const btn = $('#exSave'); if(btn.disabled) return;
    btn.disabled = true;
    const d = { date, amount, cat: _exCat, mode: _exMode, note: $('#exNote').value.trim(), updatedAt: serverTimestamp() };
    try{
      let res;
      if(_expEdit){
        const id = _expEdit;
        res = await settle(updateDoc(doc(db,'expenses',id), d));
        if(res !== 'denied'){
          const it = EXPS.find(v=>v.id === id);
          if(it){ Object.assign(it, d); EXPS = [...EXPS].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))); }
        }
      }else{
        const ref = doc(collection(db,'expenses'));
        res = await settle(setDoc(ref, { ...d, createdAt: serverTimestamp() }));
        if(res !== 'denied') addExpLocal({ id: ref.id, ...d });
      }
      const sm = settleMsg(res, `${inr(amount)} · ${catName(_exCat)} recorded`);
      if(!sm.ok){ toast(sm.msg); return; }   /* leave the form filled in so nothing is retyped */
      closeExpForm();
      renderFin();
      toast(sm.msg);
    }catch(err){ toast('Save failed: ' + (err.code||err.message)); }
    finally{ btn.disabled = false; }
  });
  $('#finClose').addEventListener('click', closeFin);
  $('#finBackdrop').addEventListener('click', closeFin);

  /* ---------- upcoming shoot sheet: full event + package detail ---------- */
  let _evIdx = 0, _evKey = null;
  const evKeyOf = e => e ? `${e.kind}|${e.id}|${e.date}|${e.title}` : null;
  function openEv(i){
    if(!_upEvents.length) return;
    _evIdx = Math.max(0, Math.min(i, _upEvents.length-1));
    renderEv();
    const wasOpen = $('#evModal').classList.contains('open');
    $('#evModal').classList.add('open'); $('#evBackdrop').classList.add('open');
    if(!wasOpen) pushView('ev', '#event');
  }
  function closeEvUI(){ $('#evModal').classList.remove('open'); $('#evBackdrop').classList.remove('open'); }
  function closeEv(){
    backFrom('ev', closeEvUI);
  }
  function renderEv(){
    if(_evIdx > _upEvents.length-1) _evIdx = Math.max(0, _upEvents.length-1);
    const ev = _upEvents[_evIdx]; if(!ev) return;
    _evKey = evKeyOf(ev);
    $('#evNav').innerHTML = `
      <button data-evn="-1" type="button" ${_evIdx===0?'disabled':''} aria-label="Previous event">‹</button>
      <b>Upcoming shoot ${_evIdx+1} of ${_upEvents.length}</b>
      <button data-evn="1" type="button" ${_evIdx===_upEvents.length-1?'disabled':''} aria-label="Next event">›</button>`;
    const d = new Date(ev.date+'T00:00');
    const human = d.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    if(ev.kind === 'lead'){
      const l = LEADS.find(v=>v.id===ev.id);
      $('#evBody').innerHTML = `
        <h3 style="color:var(--gold-b)">${esc(ev.title)}</h3>
        <div class="who">${human}</div>
        <div class="ln2"><span>Client</span><span>${esc(ev.client||'—')}</span></div>
        ${l && l.phone ? `<div class="ln2"><span>Phone</span><span>${esc(l.phone)}</span></div>` : ''}
        ${l && l.grandTotal ? `<div class="ln2"><span>Quoted</span><span>${inr(l.grandTotal)}</span></div>` : ''}
        <div class="ln2"><span>Source</span><span>Booked lead — no package yet</span></div>
        <div class="ev-acts">
          ${l ? '<button class="btn btn--sm btn--ghost" type="button" data-evlead>Open lead</button>' : ''}
          <button class="btn btn--sm btn--ghost" type="button" data-evcal>Calendar</button>
        </div>`;
      return;
    }
    const pk = PKGS.find(p=>p.id===ev.id);
    if(!pk){ $('#evBody').innerHTML = '<div class="empty">Package not found — it may have been deleted.</div>'; return; }
    const st = pk.status||'draft';
    const tt = pk.totals||{};
    const paid = Number(tt.advance)||0, bal = Math.max(0,Number(tt.balance)||0), fin = Number(tt.finalPrice)||0;
    const crew = evCrew(pk.id, ev.date, ev.title);
    const events = (pk.events||[]).map(e2=>{
      const cur = e2.date === ev.date;
      const svcs = (e2.items||[]).map(it=>`${esc(it.service)}${Number(it.qty)>1?' ×'+Number(it.qty):''}`).join(', ');
      return `<div class="ev-e ${cur?'cur':''}">
        <b>${esc(e2.title||'Event')}${slotTag(e2.slot)}${cur ? ' · this shoot' : ''}</b>
        <span>${e2.date ? esc(stepDate(e2.date)) : 'date TBD'}${e2.venue ? ' · 📍 '+esc(e2.venue) : ''}</span>
        ${svcs ? `<em>${svcs}</em>` : ''}
      </div>`;
    }).join('');
    const pays = (pk.payments||[]).length
      ? `<div class="finh">Payments received</div>` + pk.payments.map(pm=>
          `<div class="ln2"><span>${esc(stepDate(pm.date)||pm.date||'')} · ${esc(pm.mode||'')}</span><span>${inr(pm.amount)}</span></div>`).join('')
      : '';
    const stuOfPk = isStudioJob(pk) ? studioById(pk.studioId) : null;
    $('#evBody').innerHTML = `
      <h3 style="color:var(--gold-b)">${esc(pk.clientName||'—')} <span class="chip-status no-dot" data-state="${stateOf(st)}">${STATUS_LABEL(st)}</span>${isStudioJob(pk) ? ' <span class="b2bpill">🏢 B2B</span>' : ''}</h3>
      <div class="who">${human}${pk.quoteNo ? ' · ' + esc(pk.quoteNo) : ''}${pk.clientPhone ? ' · 📞 ' + esc(pk.clientPhone) : ''}</div>
      ${isStudioJob(pk) ? `
        ${pk.endClientName ? `<div class="ln2"><span>End client</span><span>${esc(pk.endClientName)}</span></div>` : ''}
        ${pk.whiteLabel ? '<div class="ln2"><span>White-label</span><span>our name stays off the paperwork</span></div>' : ''}
        ${stuOfPk && stuOfPk.paymentTerms ? `<div class="ln2"><span>Payment terms</span><span>${esc(stuOfPk.paymentTerms)}</span></div>` : ''}` : ''}
      <div class="fintiles">
        <div class="stat"><b>${inr(fin)}</b><span>package</span></div>
        <div class="stat"><b>${inr(paid)}</b><span>paid</span></div>
        <div class="stat"><b ${bal>0?'style="color:var(--warn)"':''}>${inr(bal)}</b><span>balance</span></div>
      </div>
      <div class="finh">All events in this package</div>
      ${events || '<div class="empty" style="padding:.4rem 0">No events yet.</div>'}
      ${crew.length ? `<div class="finh">Crew on ${esc(stepDate(ev.date))}</div>` + crew.map(a=>
        `<div class="ln2"><span>${esc(a.memberName||'—')}</span><span>${esc(a.role||'')}${a.callTime ? ' · ' + esc(a.callTime) : ''}</span></div>`).join('') : ''}
      ${pays}
      <div class="ev-acts">
        ${bal > 0 ? `<button class="btn btn--sm btn--ghost" type="button" data-evpay>＋ Payment</button>` : ''}
        <button class="btn btn--sm btn--ghost" type="button" data-evopen>Open package</button>
        <button class="btn btn--sm btn--ghost" type="button" data-evcal>Calendar</button>
      </div>`;
  }
  $('#evNav').addEventListener('click', e=>{
    const b = e.target.closest('[data-evn]'); if(!b || b.disabled) return;
    openEv(_evIdx + Number(b.dataset.evn));
  });
  $('#evBody').addEventListener('click', e=>{
    const ev = _upEvents[_evIdx]; if(!ev) return;
    if(e.target.closest('[data-evpay]')){
      const pk = PKGS.find(p=>p.id===ev.id);
      if(pk){ closeEvUI(); openPay(pk); }
      return;
    }
    if(e.target.closest('[data-evopen]')){
      const pk = PKGS.find(p=>p.id===ev.id);
      if(pk){ if(!canLeaveEditor()) return; closeEvUI(); $('#tabPkgs').click(); openPkgEdit(pk); }
      return;
    }
    if(e.target.closest('[data-evlead]')){
      const l = LEADS.find(v=>v.id===ev.id);
      closeEvUI();
      if(l){ $('#leadSearch').value = l.name||''; leadFilterVal = ''; }
      $('#tabLeads').click();
      renderLeads();
      return;
    }
    if(e.target.closest('[data-evcal]')){
      closeEvUI();
      gotoCalendar(ev.date);
    }
  });
  $('#evClose').addEventListener('click', closeEv);
  $('#evBackdrop').addEventListener('click', closeEv);

  /* ---------- complete upcoming-shoots list ----------
     Opened from the ＋ button (or the "N upcoming" chip) on Home; tapping a
     row jumps into the full event + package sheet at that shoot. */
  function openUpList(){
    if(!_upEvents.length) return;
    renderUpList();
    const wasOpen = $('#upModal').classList.contains('open');
    $('#upModal').classList.add('open'); $('#upBackdrop').classList.add('open');
    if(!wasOpen) pushView('uplist', '#upcoming');
  }
  function closeUpUI(){ $('#upModal').classList.remove('open'); $('#upBackdrop').classList.remove('open'); }
  function closeUpList(){
    backFrom('uplist', closeUpUI);
  }
  function renderUpList(){
    if(!_upEvents.length){ closeUpUI(); return; }
    $('#upWho').textContent = `${_upEvents.length} confirmed event${_upEvents.length===1?'':'s'} ahead`;
    const today = todayISO();
    let lastMonth = '';
    $('#upBody').innerHTML = _upEvents.map((e,i)=>{
      const d = new Date(e.date+'T00:00');
      const mon = d.toLocaleDateString('en-IN',{month:'long',year:'numeric'});
      const head = mon !== lastMonth ? `<div class="finh">${mon}</div>` : '';
      lastMonth = mon;
      const pk = e.kind === 'pkg' ? PKGS.find(p=>p.id===e.id) : null;
      const due = pk ? Math.max(0,(pk.totals||{}).balance||0) : 0;
      const days = Math.round((d - new Date(today+'T00:00'))/864e5);
      return head + `
      <div class="up-ev" data-goev="${i}" role="button" tabindex="0">
        <span class="when">${d.toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</span>
        <span class="what">${esc(e.title)} <span>· ${e.b2b ? '🏢 ' : ''}${esc(e.client)}${days===0 ? ' · today' : days===1 ? ' · tomorrow' : ''}</span></span>
        ${due > 0 ? `<span class="due">${inr(due)}</span>` : `<i class="dot ${e.status}"></i>`}
      </div>`;
    }).join('');
  }
  $('#upBody').addEventListener('click', e=>{
    const r = e.target.closest('[data-goev]'); if(!r) return;
    closeUpUI();
    openEv(Number(r.dataset.goev)||0);
  });
  $('#upClose').addEventListener('click', closeUpList);
  $('#upBackdrop').addEventListener('click', closeUpList);

  /* ---------- quick actions — the ⚡ button on Home ---------- */
  function openQa(){
    renderQaMain();
    const wasOpen = $('#qaModal').classList.contains('open');
    $('#qaModal').classList.add('open'); $('#qaBackdrop').classList.add('open');
    if(!wasOpen) pushView('qa', '#quick');
  }
  function closeQaUI(){ $('#qaModal').classList.remove('open'); $('#qaBackdrop').classList.remove('open'); }
  function closeQa(){
    backFrom('qa', closeQaUI);
  }
  function renderQaMain(){
    $('#qaOpts').classList.remove('qa-form');
    $('#qaWho').textContent = 'The things you do most — one tap away';
    $('#qaOpts').innerHTML = `
      <button type="button" data-qa-lead>👤 New lead <em>name + number, that is all</em></button>
      <button type="button" data-qa-book>📅 New booking <em>a date on the calendar</em></button>
      <button type="button" data-qa-new>📦 New package / quotation</button>
      <button type="button" data-qa-pay>💰 Record a payment</button>
      <button type="button" data-qa-today>📅 Today's calendar</button>
      <button type="button" data-qa-member>🎬 Add a team member</button>`;
  }

  /* ---------------------------------------------------------- quick add lead
     Someone rings while the owner is standing at a venue. The full package
     builder is the wrong tool for that: this takes a name and a number and
     gets out of the way — everything else can be filled in later from the
     Leads tab.

     The shape below is not free. leads/{id} has no isAdmin() create branch —
     the rule was written for the public website form and constrains the doc
     itself: only those twelve keys, status 'new', notes '', a non-empty name,
     and a source of 'package_builder' or 'contact_form'. So the write matches
     the website's own shape exactly. It is filed as 'contact_form' because
     that is what the two permitted values mean here — an enquiry that came to
     us, as opposed to one built in the quote builder. */
  function renderQaLead(){
    $('#qaWho').textContent = 'Name and number is enough — the rest can wait';
    $('#qaOpts').classList.add('qa-form');
    $('#qaOpts').innerHTML = `
      <div class="field">
        <label class="field__label" for="qlName">Name <span class="req">*</span></label>
        <input class="input" id="qlName" autocomplete="off" placeholder="e.g. Priya &amp; Arjun" />
        <p class="field__error" id="qlNameErr" hidden></p>
      </div>
      <div class="field">
        <label class="field__label" for="qlPhone">Mobile <span class="req">*</span></label>
        <input class="input" id="qlPhone" inputmode="tel" autocomplete="off" placeholder="98765 43210" />
        <p class="field__error" id="qlPhoneErr" hidden></p>
        <span class="field__hint">10 digits — this is how the client signs in to their own page later.</span>
      </div>
      <div class="field">
        <label class="field__label" for="qlType">Event <span class="field__opt">(optional)</span></label>
        <input class="input" id="qlType" autocomplete="off" placeholder="e.g. Wedding, Reception" />
      </div>
      <div class="qa-acts">
        <button type="button" class="btn btn--ghost" data-qa-back>← Back</button>
        <button type="button" class="btn btn--primary" id="qlSave">Save lead</button>
      </div>`;
    setTimeout(()=>{ const n = $('#qlName'); if(n) n.focus({ preventScroll:true }); }, 40);
  }
  /* inline, under the field, never an alert(): an alert covers the very box it
     is complaining about and loses the owner's place */
  function qlErr(id, msg){
    const f = $('#' + id), e = $('#' + id + 'Err');
    if(!f || !e) return;
    e.textContent = msg || ''; e.hidden = !msg;
    f.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if(msg) f.focus({ preventScroll:true });
  }
  async function saveQaLead(){
    const name  = ($('#qlName').value||'').trim();
    const raw   = ($('#qlPhone').value||'').trim();
    const type  = ($('#qlType').value||'').trim();
    qlErr('qlName',''); qlErr('qlPhone','');
    if(!name){ qlErr('qlName','Who is it? A name is the one thing this needs.'); return; }
    if(name.length > 120){ qlErr('qlName','That is longer than 120 characters — shorten it.'); return; }
    const ten = normPhone(raw);
    if(!raw){ qlErr('qlPhone','A number, so you can call them back.'); return; }
    if(ten.length !== 10){
      qlErr('qlPhone', `That is ${ten.length} digit${ten.length===1?'':'s'} — an Indian mobile is 10. The client portal finds bookings by the last 10.`);
      return;
    }
    const btn = $('#qlSave'); btn.disabled = true; btn.textContent = 'Saving…';
    try{
      const ref = doc(collection(db,'leads'));
      const res = await settle(setDoc(ref, {
        name, phone: ten, phoneFull: normPhoneFull(raw),
        eventType: type, message: '', notes: '',
        status: 'new', source: 'contact_form', createdAt: serverTimestamp()
      }));
      if(res === 'denied'){
        btn.disabled = false; btn.textContent = 'Save lead';
        toast('NOT saved — the server refused this write. Check your sign-in and try again.');
        return;
      }
      closeQaUI();
      toast(`Lead saved — ${name}`);
      buzz();
      leadFilterVal = ''; $('#leadSearch').value = '';
      $('#tabLeads').click(); renderStats(); renderLeads();
    }catch(err){
      btn.disabled = false; btn.textContent = 'Save lead';
      toast('Save failed');
    }
  }
  function renderQaPay(){
    const list = livePkgs()
      .filter(x=>(x.status||'draft') !== 'draft' && Math.max(0,(x.totals||{}).balance||0) > 0)
      .sort((a,b)=>{ const da = nextShootDate(a)||'9999', db2 = nextShootDate(b)||'9999'; return da<db2?-1:da>db2?1:0; })
      .slice(0,12);
    $('#qaWho').textContent = 'Who paid you? Tap the client to record it';
    $('#qaOpts').innerHTML = (list.length
      ? list.map(x=>`<button type="button" data-qa-pick="${x.id}"><i class="dot ${x.status||'draft'}"></i>${esc(x.clientName||'—')}<em>${inr(Math.max(0,(x.totals||{}).balance||0))} due</em></button>`).join('')
      : '<div class="empty" style="padding:.6rem 0">Nothing is due — every balance is clear 🎉</div>')
      + '<button type="button" data-qa-back style="justify-content:center;color:var(--mut)">← Back</button>';
  }
  $('#qaOpts').addEventListener('click', e=>{
    if(e.target.closest('[data-qa-lead]')){ renderQaLead(); return; }
    if(e.target.closest('#qlSave')){ saveQaLead(); return; }
    if(e.target.closest('[data-qa-book]')){
      /* the add-event form is the minimal booking path and already exists —
         it just needs a date chosen, so quick-add starts it on today */
      closeQaUI(); gotoCalendar(todayISO()); setTimeout(()=>openCalAdd(), 180); return;
    }
    if(e.target.closest('[data-qa-new]')){ closeQaUI(); openJobType(); return; }
    if(e.target.closest('[data-qa-pay]')){ renderQaPay(); return; }
    if(e.target.closest('[data-qa-back]')){ renderQaMain(); return; }
    const pick = e.target.closest('[data-qa-pick]');
    if(pick){ const x = PKGS.find(p=>p.id===pick.dataset.qaPick); closeQaUI(); if(x) openPay(x); return; }
    if(e.target.closest('[data-qa-today]')){
      closeQaUI();
      gotoCalendar(new Date().toLocaleDateString('en-CA'));
      return;
    }
    if(e.target.closest('[data-qa-member]')){ closeQaUI(); $('#tabTeam').click(); openTm(null); return; }
  });
  $('#qaOpts').addEventListener('keydown', e=>{
    if(e.key === 'Enter' && e.target.matches('#qlName,#qlPhone,#qlType')){ e.preventDefault(); saveQaLead(); }
  });
  $('#fabBtn').addEventListener('click', openQa);
  $('#qaClose').addEventListener('click', closeQa);
  $('#qaBackdrop').addEventListener('click', closeQa);

  /* ---------- Global search — one box over every record type ----------
     Was a box that only existed on Home and only knew about packages, leads
     and studios. Crew and events were unreachable by name, and standing at a
     venue the owner is rarely on the Home tab. Now: ⌘/Ctrl+K from anywhere,
     the 🔍 button on any tab, arrow keys to move, Enter to open the record.

     Phone numbers are matched on digits alone, so "9876" finds a number the
     panel stores as "+91 98765 43210" and one stored as "98765 43210". */
  let _gsRows = [], _gsSel = 0;
  const gsDigits = v => String(v||'').replace(/\D/g,'');

  function gsSearch(q){
    const t = q.toLowerCase(), d = gsDigits(q);
    const hitTxt = (...vals) => vals.some(v=>String(v||'').toLowerCase().includes(t));
    const hitTel = v => d.length >= 3 && gsDigits(v).includes(d);
    const rows = [];

    livePkgs().forEach(x=>{
      if(hitTxt(x.clientName, x.quoteNo, x.endClientName) || hitTel(x.clientPhone))
        rows.push({ kind:'pkg', id:x.id, icon:'📦', title:x.clientName||'—',
          meta:[x.quoteNo, isStudioJob(x)?'B2B':'', inr((x.totals||{}).finalPrice||0)].filter(Boolean).join(' · '),
          state:stateOf(x.status||'draft'), badge:STATUS_LABEL(x.status||'draft') });
    });
    liveLeads().forEach(l=>{
      if(hitTxt(l.name, l.eventType) || hitTel(l.phone))
        rows.push({ kind:'lead', id:l.id, icon:'👤', title:l.name||'—',
          meta:['lead', l.eventType, l.grandTotal?inrShort(l.grandTotal):''].filter(Boolean).join(' · '),
          state:stateOf(l.status||'new'), badge:l.status||'new' });
    });
    TEAM.forEach(m=>{
      if(hitTxt(m.name, m.role) || hitTel(m.phone))
        rows.push({ kind:'crew', id:m.id, icon:'🎬', title:m.name||'—',
          meta:['crew', roleLabel(m.role), m.active===false?'inactive':''].filter(Boolean).join(' · '),
          state:m.active===false?'neutral':'confirmed', badge:m.active===false?'inactive':'crew' });
    });
    STUDIOS.forEach(st=>{
      if(hitTxt(st.name, st.ownerName, st.city) || hitTel(st.phone))
        rows.push({ kind:'studio', id:st.id, icon:'🏢', title:st.name||'—',
          meta:['studio', st.city, st.ownerName].filter(Boolean).join(' · '),
          state:st.active===false?'neutral':'info', badge:st.active===false?'inactive':'B2B' });
    });
    calEvents().forEach(e=>{
      if(hitTxt(e.title, e.client, e.venue))
        rows.push({ kind:'event', id:e.date, icon:'📅', title:e.title||'Event',
          meta:[dmy(e.date), e.client, e.venue].filter(Boolean).join(' · '),
          state:stateOf(e.status), badge:dmy(e.date) });
    });
    /* Soonest shoot first inside events, then the rest by how well the name
       matches — a prefix hit is almost always the one being looked for. */
    const rank = r => (String(r.title||'').toLowerCase().startsWith(t) ? 0 : 1);
    return rows.sort((a,b)=>rank(a)-rank(b)).slice(0, 30);
  }

  function renderGs(){
    const box = $('#gsResults'), q = ($('#gsInput').value||'').trim();
    if(!q){
      _gsRows = [];
      box.innerHTML = `<p class="gs-empty">Search clients, leads, crew, partner studios and events — by name, phone, quote number or venue.</p>`;
      return;
    }
    _gsRows = gsSearch(q);
    if(_gsSel >= _gsRows.length) _gsSel = 0;
    if(!_gsRows.length){
      box.innerHTML = `<div class="empty-state">
          <span class="empty-state__icon">🔍</span>
          <p class="empty-state__title">Nothing found</p>
          <p class="empty-state__text">No client, lead, crew member, studio or event matches “${esc(q)}”.</p>
        </div>`;
      return;
    }
    box.innerHTML = _gsRows.map((r,i)=>`
      <button type="button" class="gs-row${i===_gsSel?' sel':''}" data-gs="${i}"
              role="option" aria-selected="${i===_gsSel}" id="gs-${i}">
        <span class="gs-k" aria-hidden="true">${r.icon}</span>
        <span class="gs-t">
          <b>${esc(r.title)}</b>
          <span>${esc(r.meta)}</span>
        </span>
        <span class="chip-status no-dot" data-state="${r.state}">${esc(r.badge)}</span>
      </button>`).join('');
    const sel = box.querySelector('.gs-row.sel');
    if(sel) sel.scrollIntoView({ block:'nearest' });
    $('#gsInput').setAttribute('aria-activedescendant', 'gs-' + _gsSel);
  }

  function gsOpen(r){
    if(!r) return;
    closeGsUI();
    switch(r.kind){
      case 'pkg': {
        const x = PKGS.find(v=>v.id===r.id); if(!x) return;
        if(!canLeaveEditor()) return;
        expandedPkg = x.id; pkgFilterVal = '';
        $('#pkgSearch').value = x.quoteNo || x.clientName || '';
        $('#tabPkgs').click(); renderPkgList();
        break;
      }
      case 'lead': {
        const l = LEADS.find(v=>v.id===r.id);
        if(l){ $('#leadSearch').value = l.name || l.phone || ''; leadFilterVal = ''; }
        $('#tabLeads').click(); renderStats(); renderLeads();
        break;
      }
      case 'crew': {
        const m = TEAM.find(v=>v.id===r.id); if(!m) return;
        $('#tabTeam').click(); setTeamSeg('crew'); openTm(m);
        break;
      }
      case 'studio': $('#tabCal').click(); openStudioDetail(r.id); break;
      case 'event':  $('#tabHome').click(); gotoCalendar(r.id); break;
    }
  }

  function openGs(){
    const wasOpen = $('#gsModal').classList.contains('open');
    $('#gsBackdrop').classList.add('open'); $('#gsModal').classList.add('open');
    _gsSel = 0; renderGs();
    if(!wasOpen) pushView('gs', '#search');
    /* the sheet animates in; focusing mid-flight scrolls the page under it */
    setTimeout(()=>$('#gsInput').focus({ preventScroll:true }), 60);
  }
  function closeGsUI(){
    $('#gsBackdrop').classList.remove('open'); $('#gsModal').classList.remove('open');
    $('#gsInput').value = ''; _gsRows = []; _gsSel = 0;
  }
  function closeGs(){ backFrom('gs', closeGsUI); }

  $('#gsInput').addEventListener('input', debounce(()=>{ _gsSel = 0; renderGs(); }, 120));
  $('#gsInput').addEventListener('keydown', e=>{
    if(e.key === 'Escape'){ e.preventDefault(); closeGs(); return; }
    if(e.key === 'Enter'){ e.preventDefault(); gsOpen(_gsRows[_gsSel]); return; }
    if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      if(!_gsRows.length) return;
      e.preventDefault();
      _gsSel = (_gsSel + (e.key === 'ArrowDown' ? 1 : _gsRows.length - 1)) % _gsRows.length;
      renderGs();
    }
  });
  $('#gsResults').addEventListener('click', e=>{
    const b = e.target.closest('[data-gs]'); if(!b) return;
    gsOpen(_gsRows[Number(b.dataset.gs)]);
  });
  /* The 🔍 button is the ONLY way in on a phone — there is no Ctrl+K there.
     It lost its listener when the Home-only search it used to open was
     removed, which left the button on screen doing nothing. */
  $('#homeSearchBtn').addEventListener('click', openGs);
  $('#gsClose').addEventListener('click', closeGs);
  $('#gsBackdrop').addEventListener('click', closeGs);
  /* ⌘K on a Mac, Ctrl+K everywhere else. Ignored while a text field already
     has focus for a reason — the owner may be mid-word in a note. */
  document.addEventListener('keydown', e=>{
    if((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')){
      e.preventDefault();
      $('#gsModal').classList.contains('open') ? closeGs() : openGs();
    }
  });

  /* ---------- Config quick-jump chips — that page is LONG ---------- */
  (function(){
    const jump = $('#cfgJump'); if(!jump) return;
    const secs = $$('#configView .sec');
    jump.innerHTML = secs.map((s,i)=>{
      const h = s.querySelector('h3'); if(!h) return '';
      const label = ((h.childNodes[0] && h.childNodes[0].textContent) || h.textContent || '').trim();
      if(!label) return '';
      if(!s.id) s.id = 'cfgSec' + i;
      return `<button type="button" data-cfgjump="${s.id}">${esc(label)}</button>`;
    }).join('');
    jump.addEventListener('click', e=>{
      const b = e.target.closest('[data-cfgjump]'); if(!b) return;
      const s = document.getElementById(b.dataset.cfgjump);
      if(s) s.scrollIntoView({ behavior:'smooth', block:'start' });
    });
  })();

  /* ---------- builder ---------- */
  $('#pkgNew').addEventListener('click', ()=>openJobType());
  $('#pkgBack').addEventListener('click', ()=>{
    /* closes the editor BEFORE history.back() — the popstate handler re-checks
       dirtiness, and an already-hidden editor is what tells it "already
       answered", instead of a second spurious prompt */
    if(!canLeaveEditor()) return;
    backFrom('pkgedit');
  });

  function rateOptions(selected){
    const rates = allRates();
    const known = Object.keys(rates);
    const isCustom = selected && !known.includes(selected);
    return known.map(n=>`<option value="${esc(n)}" ${n===selected?'selected':''}>${esc(n)}</option>`).join('')
      + `<option value="__custom" ${isCustom?'selected':''}>Custom service…</option>`;
  }
  const itemRowHTML = (it={}) => {
    const rates = allRates();
    const isCustom = it.service && !Object.keys(rates).includes(it.service);
    return `
    <div class="itemrow">
      <div class="l1">
        <select data-f="service">${rateOptions(it.service)}</select>
        <button class="rm" data-rmitem title="Remove">✕</button>
      </div>
      <input data-f="serviceName" placeholder="Custom service name" value="${esc(isCustom?it.service:'')}" ${isCustom?'':'hidden'} style="grid-column:1 / -1" />
      <div class="l2">
        <div class="mini-f"><label>Qty</label>
          <div class="qwrap">
            <button type="button" data-qm>−</button>
            <input data-f="qty" type="number" min="1" inputmode="numeric" value="${Number(it.qty)||1}" />
            <button type="button" data-qp>+</button>
          </div>
        </div>
        <div class="mini-f"><label>Rate (₹)</label>
          <input data-f="rate" type="number" min="0" inputmode="numeric" value="${Number(it.rate)||0}" placeholder="Rate" />
        </div>
        <div class="mini-f amtf"><label>Amount</label>
          <span class="amt" data-amt>${inr((Number(it.qty)||1)*(Number(it.rate)||0))}</span>
        </div>
      </div>
    </div>`;
  };
  const EVENT_NAMES = ['MANJE','SANCHAK','MEHNDI','NIKAH','RUKSATI','VALIMA RECEPTION','ENGAGEMENT','BIRTHDAY'];
  const evCardHTML = (ev={}) => `
    <div class="sec pkg-ev">
      <button class="del" data-rmev title="Remove event">✕</button>
      <div class="grid2">
        <div class="fld"><label>Event title</label><input data-f="title" value="${esc(ev.title||'')}" placeholder="e.g. VALIMA RECEPTION" /></div>
        <div class="fld"><label>Date</label><input data-f="date" type="date" value="${esc(ev.date||'')}" /></div>
      </div>
      <div class="evchips" data-evchips ${ev.title?'hidden':''}>${EVENT_NAMES.map(n=>`<button type="button" class="qchip" data-evname="${esc(n)}">${esc(n)}</button>`).join('')}</div>
      <div class="fld"><label>Time of day</label>
        <div class="mode-pills slotpills" data-slot>
          ${SLOTS.map(([v,l])=>`<button type="button" data-sv="${v}" class="${(ev.slot||'')===v?'on':''}">${l}</button>`).join('')}
        </div>
      </div>
      <div class="dwarn" data-dwarn hidden></div>
      <div class="fld"><label>Venue (optional)</label><input data-f="venue" value="${esc(ev.venue||'')}" /></div>
      <button type="button" class="copyprev" data-copyprev>⧉ Same services as previous event</button>
      <div class="items">${(ev.items||[]).map(itemRowHTML).join('')}</div>
      <div class="svcchips" data-svcchips></div>
      <button class="addrow" data-additem>＋ Add custom service</button>
    </div>`;
  /* one-tap service chips: every configured rate not yet on this event */
  function refreshSvcChips(card){
    const box = card.querySelector('[data-svcchips]'); if(!box) return;
    const used = new Set([...card.querySelectorAll('.itemrow:not([data-addon]) [data-f="service"]')].map(s=>s.value));
    const rates = allRates();
    box.innerHTML = Object.keys(rates).filter(n=>!used.has(n)).map(n=>
      `<button type="button" class="qchip" data-addsvc="${esc(n)}">＋ ${esc(n)}<small>${inr(rates[n])}</small></button>`
    ).join('');
  }
  const refreshAllSvcChips = () => $$('#pkgEvents .pkg-ev').forEach(refreshSvcChips);
  /* read one card's service rows (used by copy-previous) */
  function readCardItems(card){
    return [...card.querySelectorAll('.itemrow')].map(r=>{
      const sel = r.querySelector('[data-f="service"]').value;
      const name = sel === '__custom' ? r.querySelector('[data-f="serviceName"]').value.trim() : sel;
      return { service: name, qty: Math.max(1, Number(r.querySelector('[data-f="qty"]').value)||1),
               rate: Math.max(0, Number(r.querySelector('[data-f="rate"]').value)||0) };
    }).filter(it=>it.service);
  }
  const addonRowHTML = (a='') => `
    <div class="itemrow" data-addon style="grid-template-columns:1fr auto">
      <input data-f="addon" value="${esc(a)}" placeholder="e.g. 100 sheets Canvera album (400 photos)" />
      <button class="rm" data-rmaddon>✕</button>
    </div>`;

  function openPkgEdit(x, opts){
    editingId = x ? x.id : null;
    /* studio job? — either explicitly started for a studio, or editing one */
    const stu = (opts && opts.studio) ? opts.studio
      : (x && isStudioJob(x)) ? (studioById(x.studioId) || { id: x.studioId, name: x.studioName || x.clientName || 'Studio', rateCard: {} })
      : null;
    _bStudioId = stu ? stu.id : null;
    /* set for a lead being converted (pkgFromLead carries it) and for a saved
       package that came from one; null for any package started from scratch,
       so an unrelated job can never adopt the last lead you looked at */
    _bLeadId = (x && x.leadId) || null;
    $('#stuJobSec').hidden = !stu;
    $$('#pkgEditView [data-direct-only]').forEach(f=>f.hidden = !!stu);
    /* B2B jobs have no retail album or quotation terms — hide steps 3 & 6 */
    $$('#pkgEditView [data-retail-only]').forEach(f=>f.hidden = !!stu);
    const _hint = $('#pkgEditView .hint'); if(_hint) _hint.hidden = !!stu;   /* retail-rates hint is wrong for B2B jobs */
    if(stu){
      $('#stuJobName').textContent = stu.name || '';
      $('#stuJobTerms').textContent = (stu.paymentTerms ? 'Terms: ' + stu.paymentTerms + ' · ' : '')
        + (stu.rateCard && Object.keys(stu.rateCard).length
            ? 'Services quote at this studio\'s negotiated rates.'
            : 'No rate card saved yet — rates fall back to your normal ones (set the card in B2B → studio → Rate card).');
      $('#pcEndClient').value = x ? (x.endClientName||'') : '';
      $('#pcWhiteLabel').checked = x ? !!x.whiteLabel : false;
    }else{
      $('#pcEndClient').value = ''; $('#pcWhiteLabel').checked = false;
    }
    $('#pkgEditTitle').textContent = x
      ? `Edit — ${x.quoteNo ? x.quoteNo + ' · ' : ''}${x.clientName||''}`
      : (stu ? `New Studio Job — ${stu.name||''}` : 'New Package');
    $('#pcName').value = stu ? (stu.name||'') : (x ? (x.clientName||'') : '');
    $('#pcCareOf').value = (!stu && x) ? (x.careOf||'') : '';
    /* The phone box only ever held the LAST 10 DIGITS, so rebuilding the
       dialling number from it stamped '91' on every NRI client — every later
       WhatsApp/Call went to a wrong Indian number. Remember the full number
       this package (or lead) arrived with and keep it while the last 10
       digits are unchanged (see keepPhoneFull).
       An NRI client's box now shows that full number instead: a country code
       the owner cannot SEE is a country code they cannot correct, and the
       10-digit box left a wrong one permanently stuck. Indian numbers keep
       the familiar bare 10 digits. */
    const _pFull = (!stu && x) ? String(x.clientPhoneFull || '').replace(/\D/g,'') : '';
    const _nri = _pFull.length > 10 && _pFull.slice(0, -10) !== '91';
    $('#pcPhone').value = _nri ? '+' + _pFull : ((!stu && x) ? (x.clientPhone||'') : '');
    _phoneFullAtOpen = (!stu && x) ? String(x.clientPhoneFull || '') : '';
    $('#pcDate').value = x && x.quoteDate ? x.quoteDate : todayISO();
    $('#pkgEvents').innerHTML = ((x && x.events && x.events.length) ? x.events : [{title:'',date:'',venue:'',items:[]}]).map(evCardHTML).join('');
    refreshAllSvcChips();
    $('#pkgAddons').innerHTML = ((x && x.addons) || []).map(addonRowHTML).join('');
    const alb = (x && x.album) || {};
    $('#paSheets').value = Number(alb.sheets)||0;
    $('#paPerSheet').value = Number(alb.perSheet) || (Number(alb.sheets)>0 && Number(alb.price)>0
      ? Math.round(Number(alb.price)/Number(alb.sheets)) : learnedAlbumRate());
    $('#ppDiscount').value = x ? ((x.totals||{}).discount||0) : 0;
    $('#ppAdvance').value  = x ? ((x.totals||{}).advance||0) : 0;
    _advanceAtOpen = Number($('#ppAdvance').value)||0;
    /* terms picker: master list from config; saved packages remember their selection */
    const chosenTerms = x && Array.isArray(x.pdfTerms) ? x.pdfTerms : null;
    $('#pkgTerms').innerHTML = pdfTerms().map(tm=>
      `<label class="termrow"><input type="checkbox" data-pterm ${!chosenTerms || chosenTerms.includes(tm) ? 'checked' : ''} /><span>${esc(tm)}</span></label>`
    ).join('');
    /* save-as status pills: draft / sent / booked (plus the current status
       when editing a delivered / not-confirmed package, so a plain re-save
       never changes it by accident) */
    _bStatus = x ? (x.status||'draft') : 'draft';
    const _stBase = ['draft','sent','booked'];
    const _stOpts2 = _stBase.includes(_bStatus) ? _stBase : [..._stBase, _bStatus];
    $('#bStatusPills').innerHTML = _stOpts2.map(s=>
      `<button type="button" data-bst="${s}" class="${_bStatus===s?'on':''}"><i class="dot ${s}" style="margin-right:.3em"></i>${STATUS_LABEL(s)}</button>`).join('');
    /* remember where the list was — but only when it is genuinely on screen;
       arriving from Home or a lead card starts the list at its top */
    _pkgListScrollY = (!$('#pkgView').hidden && !$('#pkgListView').hidden) ? window.scrollY : 0;
    $('#pkgListView').hidden = true; $('#pkgEditView').hidden = false;
    computePkg();
    scrollTopNow();
    pushView('pkgedit', '#packages/edit');
    _pkgBaseline = JSON.stringify(readForm());
  }
  let _pkgBaseline = '';
  let _advanceAtOpen = 0;
  let _phoneFullAtOpen = '';
  let _bStatus = 'draft';
  $('#bStatusPills').addEventListener('click', e=>{
    const b = e.target.closest('[data-bst]'); if(!b) return;
    _bStatus = b.dataset.bst;
    $$('#bStatusPills button').forEach(p=>p.classList.toggle('on', p === b));
  });
  function pkgDirty(){
    try{ return !$('#pkgEditView').hidden && JSON.stringify(readForm()) !== _pkgBaseline; }
    catch(e){ return false; }
  }

  function readForm(){
    const events = $$('#pkgEvents .pkg-ev').map(card=>({
      title: card.querySelector('[data-f="title"]').value.trim(),
      date:  card.querySelector('[data-f="date"]').value,
      slot:  (card.querySelector('[data-slot] button.on') || {dataset:{}}).dataset.sv || '',
      venue: card.querySelector('[data-f="venue"]').value.trim(),
      items: [...card.querySelectorAll('.itemrow')].map(r=>{
        const sel = r.querySelector('[data-f="service"]').value;
        const name = sel === '__custom' ? r.querySelector('[data-f="serviceName"]').value.trim() : sel;
        return { service: name, qty: Math.max(1, Number(r.querySelector('[data-f="qty"]').value)||1),
                 rate: Math.max(0, Number(r.querySelector('[data-f="rate"]').value)||0) };
      }).filter(it=>it.service)
    /* keep an event that has ANY of title / services / date — date-only
       events used to be dropped silently on save, so a 3-day function
       entered as bare dates lost days 2 and 3 and the calendar showed
       only the first one */
    })).filter(ev=>ev.title || ev.items.length || /^\d{4}-\d{2}-\d{2}$/.test(ev.date||''));
    /* B2B studio jobs carry no retail album — whatever is left in the hidden
       fields must not leak into the gross */
    const _sheets = _bStudioId ? 0 : Math.max(0, Number($('#paSheets').value)||0);
    const _perSheet = _bStudioId ? 0 : Math.max(0, Number($('#paPerSheet').value)||0);
    const album = { sheets: _sheets, perSheet: _perSheet, price: _sheets * _perSheet };
    const gross = events.reduce((s,ev)=>s + ev.items.reduce((a,it)=>a + it.qty*it.rate, 0), 0) + album.price;
    const discount = Math.min(gross, Math.max(0, Number($('#ppDiscount').value)||0));
    const finalPrice = gross - discount;
    /* The advance used to be clamped to the new final price. Drop a package's
       price below what the client has already paid and totals.advance was
       quietly reduced to match, desyncing it from the payment list and erasing
       the overpayment. Recorded payments are the source of truth: never report
       less than what was actually received. */
    const _editing = editingId ? PKGS.find(v=>v.id===editingId) : null;
    const _paid = _editing && Array.isArray(_editing.payments)
      ? _editing.payments.reduce((n,p)=>n + (Number(p.amount)||0), 0) : 0;
    const _typed = Math.max(0, Number($('#ppAdvance').value)||0);
    const advance = Math.max(_paid, Math.min(finalPrice, _typed));
    /* studio jobs: the studio IS the client on paper; no phone is stored so
       the job can never surface in the client portal (see firestore.rules).
       Keyed on _bStudioId, not the studio doc — a studio deleted later must
       not silently flip its jobs back to 'direct' on the next edit. */
    const typed = _bStudioId
      ? { clientType: 'studio', studioId: _bStudioId,
          studioName: (studioById(_bStudioId)||{}).name || $('#pcName').value.trim() || 'Studio',
          whiteLabel: !!$('#pcWhiteLabel').checked,
          endClientName: $('#pcEndClient').value.trim() }
      : { clientType: 'direct' };
    const _b2b = !!_bStudioId;
    return {
      clientName: _b2b ? typed.studioName : $('#pcName').value.trim(),
      careOf: _b2b ? '' : $('#pcCareOf').value.trim(),
      clientPhone: _b2b ? '' : normPhone($('#pcPhone').value),
      clientPhoneFull: _b2b ? '' : keepPhoneFull($('#pcPhone').value),
      quoteDate: $('#pcDate').value || todayISO(),
      events,
      album,
      addons: $$('#pkgAddons [data-addon] [data-f="addon"]').map(i=>i.value.trim()).filter(Boolean),
      /* no quotation terms on B2B jobs — the studio's own payment terms apply */
      pdfTerms: _b2b ? [] : $$('#pkgTerms [data-pterm]').filter(c=>c.checked).map(c=>c.closest('.termrow').querySelector('span').textContent),
      totals: { gross, discount, finalPrice, advance, balance: finalPrice - advance },
      /* only ever ADD the link — a package saved without one keeps whatever
         leadId it already has on the server rather than losing it */
      ...(_bLeadId ? { leadId: _bLeadId } : {}),
      ...typed
    };
  }

  function computePkg(){
    // per-row amounts
    $$('#pkgEvents .itemrow').forEach(r=>{
      const q = Math.max(1, Number(r.querySelector('[data-f="qty"]').value)||1);
      const rt = Math.max(0, Number(r.querySelector('[data-f="rate"]').value)||0);
      r.querySelector('[data-amt]').textContent = inr(q*rt);
    });
    const d = readForm();
    $('#paTotal').textContent = inr((d.album||{}).price||0);
    $('#ppGross').textContent = inr(d.totals.gross);
    $('#ppFinal').textContent = inr(d.totals.finalPrice);
    $('#ppBalance').textContent = inr(d.totals.balance);
    const st = $('#stickyTotal'); if(st) st.textContent = inr(d.totals.finalPrice);
  }
  /* typing a title by hand hides that card's name chips */
  $('#pkgEditView').addEventListener('input', e=>{
    if(e.target.matches('[data-f="title"]')){
      const chips = e.target.closest('.pkg-ev').querySelector('[data-evchips]');
      if(chips) chips.hidden = !!e.target.value.trim();
    }
  });

  $('#pkgEditView').addEventListener('input', computePkg);
  $('#pkgEditView').addEventListener('change', e=>{
    if(e.target.matches('[data-f="date"]')){
      const card = e.target.closest('.pkg-ev');
      const warn = card && card.querySelector('[data-dwarn]');
      if(warn){
        const clashes = dateConflicts(e.target.value, editingId, $('#pcName').value);
        /* several crews run in parallel — only warn once the date is FULL */
        warn.hidden = clashes.length < DATE_EVENT_CAP;
        if(clashes.length >= DATE_EVENT_CAP) warn.textContent =
          `⚠ ${stepDate(e.target.value)} already has ${clashes.length} events booked (${clashes[0].title} — ${clashes[0].client}${clashes.length>1 ? ', +' + (clashes.length-1) + ' more' : ''}). One more may stretch your crews.`;
      }
    }
    if(e.target.matches('[data-f="service"]')){
      const row = e.target.closest('.itemrow');
      const nameInp = row.querySelector('[data-f="serviceName"]');
      if(e.target.value === '__custom'){ nameInp.hidden = false; nameInp.focus(); }
      else{ nameInp.hidden = true; nameInp.value = '';
        row.querySelector('[data-f="rate"]').value = allRates()[e.target.value] ?? 0; }
      const card = row.closest('.pkg-ev'); if(card) refreshSvcChips(card);
      computePkg();
    }
  });
  $('#pkgEditView').addEventListener('click', e=>{
    if(e.target.closest('[data-qm]') || e.target.closest('[data-qp]')){
      const row = e.target.closest('.itemrow');
      const q = row.querySelector('[data-f="qty"]');
      q.value = Math.max(1, (Number(q.value)||1) + (e.target.closest('[data-qp]') ? 1 : -1));
      computePkg(); return;
    }
    if(e.target.closest('[data-rmitem]')){
      const card = e.target.closest('.pkg-ev');
      e.target.closest('.itemrow').remove();
      if(card) refreshSvcChips(card);
      computePkg(); return;
    }
    /* time of day: tap to set, tap the lit one again to clear it */
    const sl = e.target.closest('[data-sv]');
    if(sl && sl.closest('[data-slot]')){
      const on = sl.classList.contains('on');
      sl.closest('[data-slot]').querySelectorAll('button').forEach(b=>b.classList.remove('on'));
      if(!on) sl.classList.add('on');
      computePkg(); return;   /* keeps the dirty check honest */
    }
    if(e.target.closest('[data-additem]')){ e.target.closest('.pkg-ev').querySelector('.items').insertAdjacentHTML('beforeend', itemRowHTML({})); return; }
    if(e.target.closest('[data-rmev]')){ e.target.closest('.pkg-ev').remove(); computePkg(); return; }
    if(e.target.closest('[data-rmaddon]')){ e.target.closest('[data-addon]').remove(); return; }
    /* one-tap event name */
    const en = e.target.closest('[data-evname]');
    if(en){
      const card = en.closest('.pkg-ev');
      card.querySelector('[data-f="title"]').value = en.dataset.evname;
      card.querySelector('[data-evchips]').hidden = true;
      computePkg(); return;
    }
    /* one-tap service with the configured rate prefilled */
    const sv = e.target.closest('[data-addsvc]');
    if(sv){
      const card = sv.closest('.pkg-ev');
      const name = sv.dataset.addsvc;
      card.querySelector('.items').insertAdjacentHTML('beforeend',
        itemRowHTML({ service: name, qty: 1, rate: Number(allRates()[name])||0 }));
      refreshSvcChips(card);
      computePkg(); return;
    }
    /* copy the previous event's services onto this one */
    const cp = e.target.closest('[data-copyprev]');
    if(cp){
      const card = cp.closest('.pkg-ev');
      const prev = card.previousElementSibling;
      if(prev && prev.classList.contains('pkg-ev')){
        const items = readCardItems(prev);
        if(!items.length){ toast('Previous event has no services yet'); return; }
        card.querySelector('.items').innerHTML = items.map(itemRowHTML).join('');
        refreshSvcChips(card);
        computePkg();
        toast('Services copied from the previous event');
      }
      return;
    }
  });
  $('#pkgAddEvent').addEventListener('click', ()=>{
    $('#pkgEvents').insertAdjacentHTML('beforeend', evCardHTML({}));
    const cards = $$('#pkgEvents .pkg-ev');
    const last = cards[cards.length-1];
    refreshSvcChips(last);
    last.scrollIntoView({behavior:'smooth', block:'center'});
  });
  $('#pkgAddAddon').addEventListener('click', ()=>$('#pkgAddons').insertAdjacentHTML('beforeend', addonRowHTML('')));

  $('#pkgSave').addEventListener('click', async ()=>{
    const d = readForm();
    if(!d.clientName){ toast('Client name is required'); $('#pcName').focus(); return; }
    if(!d.events.length){ toast('Add at least one event with a service'); return; }
    /* the client portal matches on the LAST 10 DIGITS — a one-digit typo here
       silently locks the client out of their booking with no error anywhere */
    const rawPhone = $('#pcPhone').value.trim();
    if(rawPhone && d.clientPhone.length !== 10
       && !confirm(`⚠ "${rawPhone}" doesn't look like a complete mobile number (${d.clientPhone.length} digits).\n\nThe client portal finds bookings by the last 10 digits of the client's number — with this one, the client will NOT be able to log in.\n\nSave anyway?`)){
      $('#pcPhone').focus();
      return;
    }
    const btn = $('#pkgSave'); if(btn.disabled) return;
    btn.disabled = true;
    try{
      const existing = editingId ? PKGS.find(pk=>pk.id===editingId) : null;
      const wasNew = !editingId;
      let newQuoteNo = '';
      const prevStatus = existing ? (existing.status||'draft') : 'draft';
      const newStatus = _bStatus || 'draft';
      /* saving straight to booked runs the same heavy-day check as the status sheet */
      if(newStatus === 'booked' && prevStatus !== 'booked'){
        const busy = d.events
          .filter(ev=>/^\d{4}-\d{2}-\d{2}$/.test(ev.date||''))
          .map(ev=>({ date: ev.date, n: dateConflicts(ev.date, editingId, d.clientName).length }))
          .filter(r=>r.n >= DATE_EVENT_CAP);
        if(busy.length && !confirm(`⚠ Heavy day: ${stepDate(busy[0].date)} already has ${busy[0].n} events booked${busy.length>1 ? ' (+' + (busy.length-1) + ' more full dates)' : ''}. Book anyway?`)) return;
      }
      let res;
      if(editingId){
        /* payments may have landed while the editor was open — if the advance field
           wasn't hand-edited, carry the live figure instead of the stale prefill */
        const liveAdv = existing ? Number((existing.totals||{}).advance)||0 : 0;
        if(existing && d.totals.advance === _advanceAtOpen && liveAdv !== _advanceAtOpen){
          d.totals.advance = Math.min(d.totals.finalPrice, liveAdv);
          d.totals.balance = d.totals.finalPrice - d.totals.advance;
        }
        const patch = { ...d, updatedAt: serverTimestamp() };
        if(prevStatus !== newStatus){
          patch.status = newStatus;
          if(newStatus === 'sent') patch.sentAt = todayISO();
          if(existing && existing.deliveredAt && newStatus !== 'delivered') patch.deliveredAt = deleteField();
        }
        if(existing && !existing.quoteNo) patch.quoteNo = await allocQuoteNo();
        res = await settle(updateDoc(doc(db,'packages',editingId), patch));
        if(res !== 'denied' && existing && prevStatus !== newStatus){
          existing.status = newStatus;
          if(newStatus === 'sent') existing.sentAt = todayISO();
          if(newStatus !== 'delivered') delete existing.deliveredAt;
        }
      }else{
        const quoteNo = await allocQuoteNo();
        newQuoteNo = quoteNo;
        const ref = doc(collection(db,'packages'));
        res = await settle(setDoc(ref, { ...d, quoteNo, status: newStatus,
          ...(newStatus === 'sent' ? { sentAt: todayISO() } : {}),
          createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
        /* only adopt the new id if the write was NOT refused — otherwise every
           retry would update a document that does not exist, and Save could
           never succeed again */
        if(res !== 'denied') editingId = ref.id;
      }
      if(res === 'denied'){
        /* leave the form dirty and the editor open: the baseline must NOT be
           reset or the owner can walk away from unsaved work believing it
           saved, and no learned rates / phone index from a refused write */
        toast('NOT saved — the server refused the write. Your changes are still on screen; try again.');
        return;
      }
      toast(res === 'queued' ? `Saved offline as ${STATUS_LABEL(newStatus)} — will sync`
        : `Package saved — ${STATUS_LABEL(newStatus)}`);
      /* only non-drafts feed the portal's "is this a client?" pre-check —
         indexing a draft made strangers pass the check, burn a real OTP and
         then hit "No bookings found" (the portal hides drafts) */
      if(d.clientPhone && newStatus !== 'draft') ensurePhoneIndex(d.clientPhone);
      /* the enquiry and its quotation are now ONE job — retire the lead and
         point the two records at each other */
      if(wasNew && _bLeadId) await linkConvertedLead(_bLeadId, editingId, newQuoteNo);
      _pkgBaseline = JSON.stringify(readForm());
      /* An advance typed straight into the builder is not a payment record, so
         it never showed in the payment list, the receipts or the cash-flow
         splits. Offer to record the difference so payments stay the single
         source of truth. */
      const _savedPkg = PKGS.find(pk=>pk.id===editingId);
      const _paidRows = _savedPkg && Array.isArray(_savedPkg.payments)
        ? _savedPkg.payments.reduce((n,p)=>n+(Number(p.amount)||0),0) : 0;
      const _gap = Math.round((Number(d.totals.advance)||0) - _paidRows);
      /* learn the rates used, so the next quote prefills them automatically —
         NOT from studio jobs: negotiated B2B rates must never leak into the
         retail rates offered to direct wedding clients */
      if((d.clientType||'direct') !== 'studio') try{
        const learned = Object.assign({}, (CFG && CFG.learnedRates) || {});
        d.events.forEach(ev=>ev.items.forEach(it=>{ if(it.service && it.rate > 0) learned[it.service] = it.rate; }));
        if(d.album && d.album.perSheet > 0) learned['__albumPerSheet'] = d.album.perSheet;
        CFG = CFG || {}; CFG.learnedRates = learned;
        setDoc(doc(db,'config','site'), { learnedRates: learned }, { merge: true });
      }catch(e){}
      loadPkgs();
      /* Don't offer to "add the missing payment" here: paySave INCREMENTS
         totals.advance, so recording it would double the money. Just say so —
         the money reports below already treat totals.advance as received. */
      if(_gap > 0) toast(`Saved. Note: ${inr(_gap)} of the advance has no payment entry — add it via ＋ Payment for a receipt and the cash/online split.`);
    }catch(err){ toast('Save failed: ' + (err.code||err.message)); }
    finally{ btn.disabled = false; }
  });

  async function makePdf(x, share){
    try{
      toast('Preparing PDF…');
      const { buildQuotePdf } = await import('./pdf-template.js');
      /* a package with a saved term selection prints exactly those terms;
         older packages (no selection stored) fall back to the master list.
         A studio job prints the partner studio's own agreed terms instead of
         the retail list — and never the studio name on a white-label job. */
      let useTerms = Array.isArray(x.pdfTerms) ? x.pdfTerms : pdfTerms();
      if(isStudioJob(x)){
        const st = studioById(x.studioId);
        useTerms = (st && st.paymentTerms) ? [st.paymentTerms] : [];
      }
      const docPdf = await buildQuotePdf(x, pdfContact(), useTerms);
      const safe = String((x.whiteLabel ? (x.endClientName || 'Quotation') : x.clientName) || 'Client')
        .replace(/[^A-Za-z0-9]+/g,'_').replace(/^_+|_+$/g,'') || 'Client';
      const fname = `${x.whiteLabel ? 'Quotation' : 'Fantasy_Studio_Quote'}_${safe}${x.quoteNo ? '_' + x.quoteNo : ''}.pdf`;
      if(share){
        /* hand the PDF straight to WhatsApp via the system share sheet */
        try{
          const blob = docPdf.output('blob');
          const file = new File([blob], fname, { type: 'application/pdf' });
          if(navigator.canShare && navigator.canShare({ files: [file] })){
            await navigator.share({ files: [file], title: 'Fantasy Studio Quotation' });
            return;
          }
        }catch(err){ if(err && err.name === 'AbortError') return; }
        /* No file-level share (desktop, or the tap's activation window expired
           while the fonts downloaded). This used to open WhatsApp with a
           text-only message and RETURN, throwing away the PDF that had just
           been built — the owner believed a quotation had been sent when the
           client only ever got text. Keep the file, then open the chat. */
        docPdf.save(fname);
        if(x.clientPhone && openWa(waLink(x, waQuoteText(x)))){
          toast('PDF downloaded — attach it in the WhatsApp chat that just opened');
        }else{
          toast('PDF downloaded — this browser cannot share files directly');
        }
        return;
      }
      docPdf.save(fname);
    }catch(err){ toast('PDF failed: ' + (err.message||err)); }
  }
  $('#pkgPdf').addEventListener('click', async ()=>{
    const d = readForm();
    if(!d.events.length){ toast('Add at least one event first'); return; }
    /* keep the saved quote number on PDFs generated from inside the editor */
    if(editingId){ const ex = PKGS.find(p=>p.id===editingId); if(ex && ex.quoteNo) d.quoteNo = ex.quoteNo; }
    await makePdf(d);
  });
}

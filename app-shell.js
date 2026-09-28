/* Fantasy Studio — app shell (store app only)
   One bottom tab bar for the crew, client and partner pages when they run
   inside the Capacitor app. Nothing here runs in a browser: mount() returns
   at once unless html.fs-app is set (the 3-line <head> script on each page
   sets it from the FantasyStudioApp user agent or window.Capacitor).

   A tab is only html[data-tab]; each page owns the CSS that shows and hides
   its existing sections under it, so renderers, timers and onSnapshot
   listeners keep running exactly as on the website.

   FSApp.mount({ portal, tabs:[{id,label,icon,hiddenWhen?}], visibleWhen, onChange? })
   FSApp.setTab(id)  FSApp.current()  FSApp.hide()  FSApp.show()
   FSApp.refresh()   FSApp.exitToStart()

   The native pack (Phase 2), each a quiet no-op without its plugin:
   FSApp.native.has(name) / .plugin(name)      FSApp.haptic('light'|'medium'|'success')
   FSApp.lock.{ key, enabled, setEnabled, available, gate, screen, hide, shown, armBackground }
   FSApp.calendar.{ available, add }   FSApp.pullToRefresh(fn, {enabledWhen})   FSApp.splashHide()
                                                                  (classic script) */
(function(){
  'use strict';
  var html = document.documentElement;
  var FSApp = window.FSApp = {};
  var st = null;   /* the mounted bar; one per page */
  var splashed = false;   /* the launch splash has been asked to go */

  function inApp(){ return html.classList.contains('fs-app'); }
  function key(){ return 'fs_tab_' + st.portal; }
  function tab(id){ for(var i=0;i<st.tabs.length;i++) if(st.tabs[i].id === id) return st.tabs[i]; return null; }
  function usable(t){ return !!t && !t.hidden; }
  function firstVisible(){ for(var i=0;i<st.tabs.length;i++) if(!st.tabs[i].hidden) return st.tabs[i]; return st.tabs[0]; }

  /* hiddenWhen can change with the data (a client with nothing to pay), so
     it is asked again on every change and whenever the page shows or hides
     something. If the open tab just vanished, fall to the first one left.
     Write `hidden` only when it changes: the observer below watches that
     attribute, and setting it to the value it already has still counts as
     a mutation — an unconditional write here would re-run this forever. */
  function evalHidden(){
    st.tabs.forEach(function(t){
      var h = false;
      try{ h = !!(t.hiddenWhen && t.hiddenWhen()); }catch(e){}
      t.hidden = h;
      if(t.btn.hidden !== h) t.btn.hidden = h;
    });
    if(st.id && !usable(tab(st.id))) apply(firstVisible().id, 'replace');
  }

  function evalVisible(){
    var on = false;
    try{ on = !st.forcedOff && !!st.visibleWhen(); }catch(e){}
    if(st.nav.hidden === on) st.nav.hidden = !on;   /* only on change, as above */
    html.classList.toggle('fs-tabs-on', on);
    /* the body padding under the bar follows its real height, safe area
       included — measured only while the bar is really on screen: under the
       keyboard it is display:none and would read as 0 */
    if(on && !html.classList.contains('fs-kb')) html.style.setProperty('--fs-tabs-h', st.nav.offsetHeight + 'px');
    if(on && !splashed) FSApp.splashHide();   /* something worth seeing is on screen */
  }

  /* how: 'push' (a tap), 'replace' (first paint, a tab that vanished) or
     'pop' (Back) — only a tap adds a history entry, so Android Back walks
     back through the tabs the user opened and then leaves the page */
  function apply(id, how){
    var t = tab(id);
    if(!usable(t)) t = firstVisible();
    if(!t) return;
    var changed = t.id !== st.id;
    st.id = t.id;
    html.setAttribute('data-tab', t.id);
    st.tabs.forEach(function(x){ x.btn.setAttribute('aria-selected', x === t ? 'true' : 'false'); });
    try{ localStorage.setItem(key(), t.id); }catch(e){}
    try{
      var s = history.state && typeof history.state === 'object' ? history.state : {};
      var next = Object.assign({}, s, { fsTab: t.id });
      if(how === 'push') history.pushState(next, '');
      else if(how === 'replace') history.replaceState(next, '');
    }catch(e){}
    /* to the top on a new tab or a deliberate re-tap; a Back that closes a
       page's own sheet lands on the same tab and must keep its scroll */
    if(changed || how === 'none'){ try{ window.scrollTo({ top:0, left:0, behavior:'instant' }); }catch(e){ window.scrollTo(0,0); } }
    if(changed && st.onChange){ try{ st.onChange(t.id); }catch(e){} }
  }

  /* 'light' (a tab), 'medium' (a pull-to-refresh release), 'success' (a
     write that went through). The native plugin matches the names
     case-sensitively and falls back to HEAVY, so they go up in capitals. */
  function haptic(kind){
    try{
      var H = FSApp.native.plugin('Haptics'); if(!H) return;
      var p = /^(success|warning|error)$/.test(kind) ? H.notification && H.notification({ type: kind.toUpperCase() })
            : H.impact && H.impact({ style: (kind === 'medium' || kind === 'heavy') ? kind.toUpperCase() : 'LIGHT' });
      if(p && p.catch) p.catch(function(){});
    }catch(e){}
  }

  FSApp.mount = function(opts){
    if(!inApp() || !opts || !opts.tabs || !opts.tabs.length) return null;
    if(!document.body){ document.addEventListener('DOMContentLoaded', function(){ FSApp.mount(opts); }); return null; }
    if(st) FSApp.unmount();
    st = { portal: opts.portal || 'app', tabs: [], id: null, forcedOff: false,
           visibleWhen: opts.visibleWhen || function(){ return true; }, onChange: opts.onChange };

    var nav = document.createElement('nav');
    nav.className = 'fs-tabs'; nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', 'Sections');
    nav.hidden = true;
    opts.tabs.forEach(function(d){
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'fs-tab'; b.setAttribute('role', 'tab');
      b.setAttribute('data-tab', d.id); b.setAttribute('aria-selected', 'false');
      /* the icon is the page's own emoji or SVG string, never user data */
      b.innerHTML = '<span class="fs-tab-ic" aria-hidden="true">' + (d.icon || '') + '</span><span class="fs-tab-lb"></span>';
      b.lastChild.textContent = d.label || d.id;
      var t = { id: d.id, hiddenWhen: d.hiddenWhen, btn: b, hidden: false };
      b.addEventListener('click', function(){
        haptic();
        if(t.id === st.id) apply(t.id, 'none');   /* same tab: just back to the top */
        else apply(t.id, 'push');
      });
      st.tabs.push(t); nav.appendChild(b);
    });
    st.nav = nav;
    document.body.appendChild(nav);

    evalHidden();
    var saved = null;
    try{ saved = localStorage.getItem(key()); }catch(e){}
    apply(usable(tab(saved)) ? saved : firstVisible().id, 'replace');
    evalVisible();

    /* the pages show and hide their views with the hidden attribute, so
       watching that one attribute is enough to know when the signed-in
       view is on screen — no polling */
    st.mo = new MutationObserver(function(recs){
      /* the bar's own hidden flips are not the page changing */
      for(var i=0;i<recs.length;i++) if(!st.nav.contains(recs[i].target)){ evalHidden(); evalVisible(); return; }
    });
    st.mo.observe(html, { attributes:true, attributeFilter:['hidden'], subtree:true });

    st.onPop = function(e){ if(e.state && e.state.fsTab && st) apply(e.state.fsTab, 'pop'); };
    window.addEventListener('popstate', st.onPop);
    st.onResize = function(){ if(st) evalVisible(); };
    window.addEventListener('resize', st.onResize);
    /* a fixed bar rides up on the keyboard and covers the field being typed
       into (Android resizes the viewport); step aside while an input has focus */
    st.onFocus = function(e){
      var el = e.target, typing = e.type === 'focusin' && el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.type !== 'checkbox' && el.type !== 'radio';
      html.classList.toggle('fs-kb', !!typing);
      if(!typing) evalVisible();   /* re-measure once the bar is back */
    };
    document.addEventListener('focusin', st.onFocus);
    document.addEventListener('focusout', st.onFocus);
    return FSApp;
  };

  FSApp.unmount = function(){
    if(!st) return;
    try{ st.mo.disconnect(); }catch(e){}
    window.removeEventListener('popstate', st.onPop);
    window.removeEventListener('resize', st.onResize);
    document.removeEventListener('focusin', st.onFocus);
    document.removeEventListener('focusout', st.onFocus);
    if(st.nav.parentNode) st.nav.parentNode.removeChild(st.nav);
    html.classList.remove('fs-tabs-on', 'fs-kb'); html.removeAttribute('data-tab');
    st = null;
  };

  FSApp.setTab = function(id){ if(st) apply(id, 'push'); };
  FSApp.current = function(){ return st ? st.id : null; };
  FSApp.hide = function(){ if(st){ st.forcedOff = true; evalVisible(); } };
  FSApp.show = function(){ if(st){ st.forcedOff = false; evalVisible(); } };
  /* for a page that changes what is on screen without touching `hidden` */
  FSApp.refresh = function(){ if(st){ evalHidden(); evalVisible(); } };
  /* the app's sign-in chooser; replace, so Back cannot return to a signed-out page */
  FSApp.exitToStart = function(){ location.replace('/start/'); };

  /* ================= the native pack (Phase 2) =================
     Everything from here down is a no-op in a browser (no html.fs-app) and
     in the app build that shipped before these plugins existed: each call
     looks its plugin up at call time and gives up quietly when it is not
     there, so a site deploy can never break an installed app. */

  /* which plugins this build of the app brought along */
  FSApp.native = {
    has: function(name){
      try{
        var C = window.Capacitor;
        if(!inApp() || !C || !C.Plugins || !C.Plugins[name]) return false;
        return C.isPluginAvailable ? !!C.isPluginAvailable(name) : true;
      }catch(e){ return false; }
    },
    plugin: function(name){ return FSApp.native.has(name) ? window.Capacitor.Plugins[name] : null; }
  };
  function platform(){ try{ var C = window.Capacitor; return C && C.getPlatform ? String(C.getPlatform()) : ''; }catch(e){ return ''; } }
  FSApp.haptic = haptic;

  /* ---- splash ----
     The app shows its launch splash over the remote load. It goes once
     there is something worth seeing: the first time the tab bar's
     signed-in view is on screen (evalVisible), or 300 ms after
     DOMContentLoaded on a page with no bar (the builder). A tab page that
     is signed out hides it 2.5 s after DOMContentLoaded at the latest, so
     the login form never waits behind the splash if the app ever stops
     auto-hiding. hide() on a splash that has gone is harmless. */
  FSApp.splashHide = function(){
    splashed = true;
    var S = FSApp.native.plugin('SplashScreen');
    if(!S || !S.hide) return;
    try{ var p = S.hide({ fadeOutDuration: 250 }); if(p && p.catch) p.catch(function(){}); }catch(e){}
  };
  if(inApp()){
    var splashSoon = function(){
      /* DOMContentLoaded can fire before a module script with remote
         imports has run (measured in Chrome), so "no bar yet" is not "no
         tabs": a page that carries a module script waits like a tab page */
      var hold = st || document.querySelector('script[type="module"]');
      setTimeout(function(){ if(!splashed) FSApp.splashHide(); }, hold ? 2500 : 300);
    };
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', splashSoon); else splashSoon();
  }

  /* ---- biometric lock (Face ID, Touch ID, fingerprint) ----
     The portal decides when to ask (on load, on coming back from the
     background) and what to do with the answer; this only talks to the
     plugin and draws the lock screen. A failure never locks anyone out for
     good: a phone that cannot ask (no biometry, none enrolled, no passcode,
     a broken prompt) is a silent skip ('skipped'); only a person who was
     asked and did not get through is 'failed', and gets a lock screen with
     Try again and Sign out; signing in again with an OTP is always let
     through (gate {fresh:true}), so Sign out is a real way back in.
     The toggle is per phone, in localStorage fs_lock_<portal>: '1' / '0',
     unset means the portal's default. */
  var LOCK_TITLE = 'Unlock your Fantasy Studio pages';
  /* the plugin's error codes that mean "asked, and not through"; every other
     code (biometryNotAvailable, biometryNotEnrolled, passcodeNotSet,
     noDeviceCredential, invalidContext, or one this list has never seen) is
     the phone's trouble, not the person's, and must not keep them out.
     biometryLockout is a person's misses too: counted as failed, never as
     a way past the lock. */
  var NOT_THROUGH = ['userCancel', 'appCancel', 'systemCancel', 'userFallback', 'authenticationFailed', 'notInteractive', 'biometryLockout'];
  var PROMPT_MAX = 180000;   /* a prompt that never answers counts as failed after this (3 min: a slow passcode must not lose its success) */
  var CHECK_MAX = 5000;     /* and a checkBiometry that never answers, as no biometry */
  var MARK = '<svg class="fs-lock-mark" viewBox="0 0 100 100" aria-hidden="true">' +
    '<circle cx="50" cy="50" r="45" fill="none" stroke="#B8902B" stroke-width="2.3"/>' +
    '<circle cx="50" cy="50" r="35" fill="none" stroke="#B8902B" stroke-width="1.9"/>' +
    '<circle cx="50" cy="5" r="3.3" fill="#B8902B"/><circle cx="50" cy="95" r="3.3" fill="#B8902B"/>' +
    '<circle cx="5" cy="50" r="3.3" fill="#B8902B"/><circle cx="95" cy="50" r="3.3" fill="#B8902B"/>' +
    '<text x="50" y="50" text-anchor="middle" dominant-baseline="central" font-family="\'Playfair Display\',Georgia,serif" font-weight="600" font-size="33" fill="#B8902B">FS</text></svg>';
  var lockEl = null, lockBusy = null, lockArm = null, prompting = false;
  var availP = null, availHooked = false;   /* available(), asked once per page */
  /* the plugin's BiometryType enum: 1 Touch ID, 2 Face ID, 3 fingerprint, 4 face, 5 iris */
  function biomType(t){ return (t === 1 || t === 3) ? 'touch' : (t === 2 || t === 4 || t === 5) ? 'face' : 'none'; }
  function unlockLabel(type){
    var apple = platform() !== 'android';
    if(type === 'face') return apple ? 'Unlock with Face ID' : 'Unlock with your face';
    if(type === 'touch') return apple ? 'Unlock with Touch ID' : 'Unlock with your fingerprint';
    if(type === 'code') return apple ? 'Unlock with passcode' : 'Unlock with your screen lock';
    return 'Unlock';
  }
  /* the answer can change while the app is away (Face ID set up in
     Settings, a lockout that ran out), so coming back asks again */
  function hookAvail(){
    if(availHooked) return;
    availHooked = true;
    var A = FSApp.native.plugin('App');
    if(!A || !A.addListener) return;
    try{
      var p = A.addListener('appStateChange', function(s){ if(s && s.isActive) availP = null; });
      if(p && p.catch) p.catch(function(){});
    }catch(e){}
  }
  function restateBar(){ try{ if(FSApp.statusBar) FSApp.statusBar(); }catch(e){} }
  FSApp.lock = {
    key: function(portal){ return 'fs_lock_' + (portal || 'app'); },
    enabled: function(portal, defaultOn){
      var v = null; try{ v = localStorage.getItem(FSApp.lock.key(portal)); }catch(e){}
      return v === null ? !!defaultOn : v === '1';
    },
    setEnabled: function(portal, on){ try{ localStorage.setItem(FSApp.lock.key(portal), on ? '1' : '0'); }catch(e){} },
    /* {ok, type:'face'|'touch'|'none', enrolled, lockedOut}: `type` is what
       the phone has, `ok` only when it is enrolled too (the simulator has
       Face ID hardware and nothing enrolled — isAvailable is the one that
       counts). Asked once per page and again when the app comes back, so
       a render can call it freely; a check that fails is not kept. */
    available: function(){
      var none = { ok:false, type:'none', enrolled:false, lockedOut:false };
      var B = FSApp.native.plugin('BiometricAuthNative');
      if(!B || !B.checkBiometry) return Promise.resolve(none);
      hookAvail();
      if(!availP){
        var dog = null;
        var p = availP = Promise.race([
          Promise.resolve().then(function(){ return B.checkBiometry(); }),
          new Promise(function(y, n){ dog = setTimeout(n, CHECK_MAX); })
        ]).then(function(r){
          clearTimeout(dog);
          r = r || {};
          var t = biomType(r.biometryType);
          /* too many misses turn Face ID off for a while, but the passcode
             still works and the prompt offers it: still ask, or failing on
             purpose would be the way in */
          var out = !r.isAvailable && r.code === 'biometryLockout' && !!r.deviceIsSecure;
          /* iOS: Face ID refused for this app (Don't Allow, or switched off in
             Settings) reads as not available — the passcode still works, so
             ask for it rather than let the lock quietly vanish */
          if(!out && platform() !== 'android' && !r.isAvailable && r.code === 'biometryNotAvailable' && !!r.deviceIsSecure && t !== 'none') out = true;
          return { ok: (!!r.isAvailable || out) && t !== 'none', type: t, enrolled: !!r.isAvailable || out, lockedOut: out };
        }, function(){ clearTimeout(dog); if(availP === p) availP = null; return none; });
      }
      return availP.then(function(a){ return Object.assign({}, a); });   /* a copy: callers keep theirs */
    },
    /* 'ok' | 'skipped' | 'failed' — never rejects. One prompt at a time: a
       relock that arrives while a prompt is up joins the same answer.
       {fresh:true}: the person has just signed in with an OTP on this page,
       which is proof enough — never asked, and the sure way past a prompt
       that keeps going wrong. {timeout} (ms) only shortens the watchdog. */
    gate: function(o){
      o = o || {};
      if(o.fresh) return Promise.resolve('skipped');
      if(lockBusy) return lockBusy;
      var B = FSApp.native.plugin('BiometricAuthNative');
      var auth = B && (B.internalAuthenticate || B.authenticate);
      if(!auth || !FSApp.lock.enabled(o.portal, o.defaultOn)) return Promise.resolve('skipped');
      var wait = +o.timeout > 0 ? +o.timeout : PROMPT_MAX, asked = false;
      lockBusy = FSApp.lock.available().then(function(a){
        if(!a.ok) return 'skipped';
        prompting = asked = true;
        restateBar();   /* the first prompt after an install once drew dark text */
        var dog = null;
        return Promise.race([
          Promise.resolve().then(function(){ return auth.call(B, { reason: o.reason || LOCK_TITLE, allowDeviceCredential: true }); })
            .then(function(){ return 'ok'; }, function(e){ return NOT_THROUGH.indexOf(e && e.code) >= 0 ? 'failed' : 'skipped'; }),
          /* a prompt that never answers must not wedge the page: it counts as
             not through, so the lock screen offers Try again and Sign out */
          new Promise(function(y){ dog = setTimeout(function(){ y('failed'); }, wait); })
        ]).then(function(r){ clearTimeout(dog); return r; });
      }).then(function(r){
        prompting = false; lockBusy = null;
        if(asked) restateBar();   /* the system sheet can leave its own style behind */
        return r;
      });
      return lockBusy;
    },
    /* the full-screen lock: FS mark, title, a gold Unlock button (onTry, may
       return a promise; disabled while it runs) and Sign out (onSignOut).
       `type` sets the button's wording; left out, it is looked up. */
    screen: function(o){
      o = o || {};
      if(!inApp() || !document.body) return null;
      FSApp.lock.hide();
      var el = document.createElement('div');
      el.id = 'fsLock'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'fsLockTitle');
      el.innerHTML = '<div class="fs-lock-in">' + MARK +
        '<h2 id="fsLockTitle"></h2><p class="fs-lock-sub"></p>' +
        '<button type="button" class="fs-lock-btn"></button>' +
        '<button type="button" class="fs-lock-out">Sign out instead</button></div>';
      el.querySelector('h2').textContent = LOCK_TITLE;
      el.querySelector('.fs-lock-sub').textContent = o.text || 'This phone keeps your pages private until you unlock them.';
      var btn = el.querySelector('.fs-lock-btn');
      btn.textContent = o.label || unlockLabel(o.type);
      /* a locked-out Face ID goes straight to the passcode, so say so */
      if(!o.label) FSApp.lock.available().then(function(a){
        if(lockEl !== el) return;
        if(a.lockedOut) btn.textContent = unlockLabel('code');
        else if(!o.type) btn.textContent = unlockLabel(a.type);
      });
      btn.addEventListener('click', function(){
        if(btn.disabled) return;
        btn.disabled = true; el.classList.add('trying');
        Promise.resolve().then(function(){ return o.onTry && o.onTry(); }).catch(function(){}).then(function(){
          btn.disabled = false; el.classList.remove('trying');
        });
      });
      el.querySelector('.fs-lock-out').addEventListener('click', function(){
        var b = this; if(b.disabled) return; b.disabled = true; b.textContent = 'Signing out…';   /* offline it can take a moment */
        try{ if(o.onSignOut) o.onSignOut(); }catch(e){}
      });
      document.body.appendChild(el);
      html.classList.add('fs-locked');
      lockEl = el;
      setTimeout(function(){ try{ btn.focus(); }catch(e){} }, 60);
      return el;
    },
    hide: function(){
      if(lockEl && lockEl.parentNode) lockEl.parentNode.removeChild(lockEl);
      lockEl = null; html.classList.remove('fs-locked');
    },
    shown: function(){ return !!lockEl; },
    /* fires 'fs:relock' on window (detail {away ms, minutes}) when the app
       comes back after more than `minutes` in the background; the portal
       then calls gate() again. The Face ID sheet itself sends the app to
       the background for a moment, so nothing counts while a prompt is up.
       Armed once per page: arming again replaces the last listener. */
    armBackground: function(minutes){
      if(lockArm){ lockArm.remove(); lockArm = null; }
      var A = FSApp.native.plugin('App');
      if(!A || !A.addListener) return null;
      var ms = Math.max(0, +minutes || 0) * 60000, away = 0, h = null, dead = false;
      try{
        var p = A.addListener('appStateChange', function(s){
          if(dead || prompting || !s) return;
          if(!s.isActive){ away = Date.now(); return; }
          availP = null;   /* the relock below must see the phone as it is now */
          var gone = away ? Date.now() - away : 0; away = 0;
          if(gone > ms){ try{ window.dispatchEvent(new CustomEvent('fs:relock', { detail:{ away: gone, minutes: ms / 60000 } })); }catch(e){} }
        });
        if(p && p.then) p.then(function(x){ h = x; if(dead && h && h.remove) h.remove(); }, function(){});
        else h = p;
      }catch(e){ return null; }
      lockArm = { remove: function(){ dead = true; try{ if(h && h.remove) h.remove(); }catch(e){} } };
      return lockArm;
    }
  };

  /* ---- one-tap calendar ----
     Writes straight into the phone's calendar. iOS asks for write-only
     access (17+; the plugin falls back to the old prompt on older iOS),
     Android's createEvent looks up the default calendar first, so it needs
     read+write there. Browsers keep their .ics download and Google
     Calendar link: available() is false outside the app. */
  function toMs(v){
    if(v instanceof Date) return isNaN(v) ? 0 : v.getTime();
    if(typeof v === 'number') return v;
    if(typeof v === 'string' && v){ var d = new Date(v); return isNaN(d) ? 0 : d.getTime(); }
    return 0;
  }
  /* 'granted' | 'denied' | 'error' — a method that is missing or throws
     hands over to the next one; a plain "no" from the user does not */
  function askCalendar(K){
    var tries = [];
    if(K.requestWriteOnlyCalendarAccess) tries.push(function(){ return K.requestWriteOnlyCalendarAccess(); });
    if(K.requestFullCalendarAccess) tries.push(function(){ return K.requestFullCalendarAccess(); });
    if(platform() === 'android') tries.reverse();
    if(K.requestPermission) tries.push(function(){ return K.requestPermission({ scope:'writeCalendar' }); });
    function next(i){
      if(i >= tries.length) return Promise.resolve('error');
      return Promise.resolve().then(tries[i]).then(function(r){ return r && r.result === 'granted' ? 'granted' : 'denied'; }, function(){ return next(i + 1); });
    }
    return next(0);
  }
  FSApp.calendar = {
    available: function(){ var K = FSApp.native.plugin('CapacitorCalendar'); return !!(K && K.createEvent); },
    /* { title, start, end?, location?, notes?, alerts? } → 'ok' | 'denied' | 'unavailable' | 'error'.
       start/end: Date, ms or ISO string; no end means three hours; alerts
       are minutes from the start, a day and two hours before by default. */
    add: function(ev){
      ev = ev || {};
      var K = FSApp.native.plugin('CapacitorCalendar');
      if(!K || !K.createEvent) return Promise.resolve('unavailable');
      var start = toMs(ev.start), end = toMs(ev.end);
      if(!start || !ev.title) return Promise.resolve('error');
      if(!end || end <= start) end = start + 3 * 3600000;
      var opts = { title: String(ev.title), startDate: start, endDate: end,
                   alerts: Array.isArray(ev.alerts) ? ev.alerts : [-1440, -120] };
      if(ev.location) opts.location = String(ev.location);
      if(ev.notes) opts.description = String(ev.notes);
      return askCalendar(K).then(function(perm){
        if(perm !== 'granted') return perm;
        return Promise.resolve().then(function(){ return K.createEvent(opts); })
          .then(function(){ haptic('success'); return 'ok'; }, function(){ return 'error'; });
      });
    }
  };

  /* ---- pull to refresh ----
     A light touch gesture, app only: from the top of the page, drag down
     past 70px and let go. The row is fixed under the status bar, so the
     page never reflows and its own overscroll bounce still happens; the
     listeners are passive, nothing here ever holds up a scroll. Off while
     a sheet or the lock screen is open, or a drag inside one would refresh
     the page underneath, and while o.enabledWhen() says no (the sign-in
     form has nothing to refresh). Set up once per page: calling again
     replaces. A refresh gets 8 s at most; the pill never outstays that. */
  var ptr = null;
  function overlayOpen(){
    return html.classList.contains('ed-lock') || html.classList.contains('fs-locked')
        || !!document.querySelector('.open[role=dialog], .ed-lock, #fsLock');
  }
  FSApp.pullToRefresh = function(onRefresh, o){
    if(ptr){ ptr.off(); ptr = null; }
    if(!inApp() || typeof onRefresh !== 'function') return null;
    /* the iOS 1.0 binary has contentInset 'automatic', which leaves the web view
       stuck down after a pull; only builds carrying the Phase 2 plugins have
       the fix ('never'), so the gesture waits for them on iOS */
    if(platform() !== 'android' && !(FSApp.native.has('BiometricAuthNative') || FSApp.native.has('CapacitorCalendar'))) return null;
    o = o || {};
    var THRESH = 70, MIN_MS = 500, MAX_MS = 8000;
    var y0 = null, armed = false, busy = false, row = null;
    function allowed(){
      if(typeof o.enabledWhen !== 'function') return true;
      try{ return !!o.enabledWhen(); }catch(e){ return false; }
    }
    function rowSet(state){   /* 'ready' | 'busy' | null (gone) */
      if(!state){ if(row && row.parentNode) row.parentNode.removeChild(row); row = null; return; }
      if(!row){
        row = document.createElement('div'); row.className = 'fs-ptr'; row.setAttribute('role', 'status');
        row.innerHTML = '<i aria-hidden="true"></i><span></span>';
        document.body.insertBefore(row, document.body.firstChild);
        requestAnimationFrame(function(){ if(row) row.classList.add('on'); });
      }
      row.classList.toggle('spin', state === 'busy');
      row.lastChild.textContent = state === 'busy' ? 'Refreshing…' : 'Release to refresh';
    }
    function start(e){
      y0 = null;
      if(busy || window.scrollY > 0 || overlayOpen() || !e.touches || e.touches.length !== 1 || !allowed()) return;
      y0 = e.touches[0].clientY; armed = false;
    }
    function move(e){
      if(y0 === null || !e.touches || !e.touches.length) return;
      var on = e.touches[0].clientY - y0 > THRESH && window.scrollY <= 0;
      if(on !== armed){ armed = on; rowSet(on ? 'ready' : null); if(on) haptic('light'); }
    }
    function end(e){
      if(y0 === null) return;
      y0 = null;
      var go = armed && e.type !== 'touchcancel';   /* the browser took the gesture: not a release */
      armed = false;
      if(!go){ rowSet(null); return; }
      busy = true; haptic('medium'); rowSet('busy');
      var t0 = Date.now(), dog = null;
      /* a refresh that never settles must not leave the pill spinning, or
         `busy` would turn every later pull away */
      Promise.race([
        Promise.resolve().then(function(){ return onRefresh(); }).catch(function(){}),
        new Promise(function(y){ dog = setTimeout(y, MAX_MS); })
      ]).then(function(){
        clearTimeout(dog);
        setTimeout(function(){ rowSet(null); busy = false; }, Math.max(0, MIN_MS - (Date.now() - t0)));
      });
    }
    document.addEventListener('touchstart', start, { passive:true });
    document.addEventListener('touchmove', move, { passive:true });
    document.addEventListener('touchend', end, { passive:true });
    document.addEventListener('touchcancel', end, { passive:true });
    var me = { off: function(){
      document.removeEventListener('touchstart', start); document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end); document.removeEventListener('touchcancel', end);
      rowSet(null);
      if(ptr === me) ptr = null;   /* an old handle must not forget the live one */
    } };
    return (ptr = me);
  };
})();

/* Status-bar text colour. The app sets light text (StatusBar style DARK) for
   its dark pages, and the native setting outlives a page, so every app page
   restates its own on load: the cream builder asks for dark text with
   data-fs-status="light" on <html>, everything else gets light text. */
(function(){
  var html = document.documentElement;
  if(!html.classList.contains('fs-app')) return;
  function set(){
    try{
      var SB = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar;
      if(!SB || !SB.setStyle) return;
      var p = SB.setStyle({ style: html.getAttribute('data-fs-status') === 'light' ? 'LIGHT' : 'DARK' });
      if(p && p.catch) p.catch(function(){});
    }catch(e){}
  }
  if(window.FSApp) window.FSApp.statusBar = set;
  set();
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', set);
})();

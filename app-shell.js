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
   FSApp.refresh()   FSApp.exitToStart()                         (classic script) */
(function(){
  'use strict';
  var html = document.documentElement;
  var FSApp = window.FSApp = {};
  var st = null;   /* the mounted bar; one per page */

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

  function haptic(){
    try{
      var H = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
      var p = H && H.impact({ style:'light' });
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

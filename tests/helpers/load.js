/* Loaders for code that runs in the browser with no build step.
   - loadCatalog(): runs catalog.js (a classic script of top-level `var`s) in a
     sandbox with just enough of window/document/localStorage to load, and
     returns that sandbox — so tests call the REAL calcQuote, clampLead, …
   - cut(): slices a run of source out of a page's inline <script> between two
     marker strings, the way app/backend/site-tests already does for admin/app.js.
     If a marker moves, the test fails loudly instead of testing stale code. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      m.set(k, String(v));
    },
    removeItem: (k) => {
      m.delete(k);
    },
    clear: () => m.clear(),
    _map: m,
  };
}

function loadCatalog(overrides = {}) {
  const listeners = {};
  const document = {
    addEventListener: (t, fn) => {
      (listeners[t] = listeners[t] || []).push(fn);
    },
    removeEventListener: () => {},
    dispatchEvent: () => true,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ setAttribute() {}, appendChild() {}, style: {} }),
    head: { appendChild() {} },
    readyState: 'complete',
  };
  const sandbox = {
    console,
    /* the page's own time boxes (2.5 s / 8 s) must not hold a finished test open */
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t.unref) t.unref();
      return t;
    },
    clearTimeout,
    Promise,
    Date,
    Math,
    JSON,
    Intl,
    URL,
    URLSearchParams,
    encodeURIComponent,
    decodeURIComponent,
    escape,
    unescape,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    document,
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
    navigator: { userAgent: 'node-test', onLine: true },
    location: { href: 'http://localhost/', hostname: 'localhost', search: '', hash: '', pathname: '/' },
    fetch: () => Promise.reject(new Error('no network in tests')),
    Event: function Event(t) {
      this.type = t;
    },
    CustomEvent: function CustomEvent(t) {
      this.type = t;
    },
    FIREBASE_CONFIG: null /* the Firebase block in catalog.js then stays off */,
    ...overrides,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('catalog.js'), sandbox, { filename: 'catalog.js' });
  return sandbox;
}

function cut(src, from, to) {
  const a = src.indexOf(from);
  const b = a < 0 ? -1 : src.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `marker not found: ${from.slice(0, 50)} … ${to.slice(0, 50)}`);
  return src.slice(a, b);
}

/* A browser ES module with no imports (fs-shared.js): `export` is stripped and
   every exported name is returned. The package is CommonJS, so it cannot be
   import()ed as it stands. */
function loadModule(rel, globals = {}) {
  const src = read(rel);
  assert.ok(!/^\s*import\s/m.test(src), `${rel} has imports; loadModule only takes self-contained modules`);
  const names = [...src.matchAll(/^export\s+(?:const|let|function|async function)\s+([A-Za-z_$][\w$]*)/gm)].map(
    (m) => m[1],
  );
  const body = src.replace(/^export\s+/gm, '');
  return new Function(...Object.keys(globals), `${body}\nreturn { ${names.join(', ')} };`)(...Object.values(globals));
}

module.exports = { ROOT, read, loadCatalog, loadModule, cut, memoryStorage };

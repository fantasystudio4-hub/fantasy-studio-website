/* Every page carries its own esc() for text that goes into innerHTML (names,
   notes, messages written by clients, crew, partners and the public). The audit
   found no unescaped sink — this keeps every copy of the helper itself safe. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { read, loadModule } = require('./helpers/load');

const FILES = ['fs-shared.js', 'portfolio/index.html', 'fs-auth.js', 'avail.js', 'catalog.js'];

function escOf(file) {
  if (file === 'fs-shared.js') return loadModule(file).esc; /* admin, crew, partner and client pages import this one */
  const src = read(file);
  let m = src.match(/const esc\s*=\s*([^\n]+?\}\[c\]\)\));/);
  if (m) return new Function(`return ${m[1]}`)();
  m = src.match(/function esc\(t\)\{[\s\S]*?\n\}/);
  assert.ok(m, `no esc() found in ${file}`);
  return new Function(`${m[0]}; return esc;`)();
}

test('every esc() copy neutralises HTML and attribute breakouts', () => {
  const evil = `<img src=x onerror="alert('x')">&`;
  for (const f of FILES) {
    const out = escOf(f)(evil);
    assert.equal(out, '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;', f);
    assert.equal(escOf(f)(42), '42', f);
  }
});

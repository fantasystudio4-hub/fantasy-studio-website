/* fs-auth.js shares ONE Firebase app and database across the pages that import
   it, and an ES module is one instance per URL: if some files moved to a new
   SDK version and others did not, a page would silently get two separate
   databases. Every gstatic URL must name the same version (and the admin CSP
   pins it too). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const { ROOT, read } = require('./helpers/load');

test('every Firebase SDK URL in the site names the same version', () => {
  const files = execFileSync('git', ['ls-files', '*.js', '*.html', 'vercel.json'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const seen = new Map();
  for (const f of files) {
    for (const m of read(f).matchAll(/firebasejs\/(\d+\.\d+\.\d+)\//g)) {
      if (!seen.has(m[1])) seen.set(m[1], []);
      seen.get(m[1]).push(f);
    }
  }
  assert.ok(seen.size > 0, 'no Firebase SDK URL found');
  assert.equal(
    seen.size,
    1,
    `more than one SDK version: ${[...seen].map(([v, f]) => `${v} in ${[...new Set(f)].join(', ')}`).join('; ')}`,
  );
});

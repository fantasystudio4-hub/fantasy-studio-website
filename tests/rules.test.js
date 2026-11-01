/* Static guards on the security rules. The full behaviour is tested against the
   Firestore emulator (app/backend/rules-test); these catch a careless edit
   before it is ever deployed. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('./helpers/load');

for (const file of ['firestore.rules', 'storage.rules']) {
  test(`${file}: isAdmin() requires a verified Google sign-in, not just the address`, () => {
    const m = read(file).match(/function isAdmin\(\)\s*\{([\s\S]*?)\}/);
    assert.ok(m, 'isAdmin() not found');
    assert.match(m[1], /request\.auth\.token\.email_verified == true/);
    assert.match(m[1], /request\.auth\.token\.firebase\.sign_in_provider == 'google\.com'/);
  });
}

test('firestore.rules: clients and partners read only packages the studio has shared', () => {
  const rules = read('firestore.rules');
  const m = rules.match(/match \/packages\/\{pkgId\} \{([\s\S]*?)allow write/);
  assert.ok(m, 'packages rule not found');
  assert.equal(
    (m[1].match(/resource\.data\.shared == true/g) || []).length,
    2,
    'both the client and the partner branch',
  );
  /* and the portals' LIST queries prove it */
  for (const f of ['client/index.html', 'fs-auth.js', 'studio/index.html']) {
    assert.match(read(f), /where\(\s*'shared',\s*'==',\s*true\s*\)/, `${f} must query with shared == true`);
  }
});

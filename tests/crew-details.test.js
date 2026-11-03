/* When the crew see a shoot's details (owner, 3 Nov 2026): from 4 pm India
   time the day before. One copy, fs-shared.js; the crew-alert function keeps
   its own (app/backend/functions/alerts.js) and pins the same cases. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { read, loadModule } = require('./helpers/load');

const S = loadModule('fs-shared.js');
const at = (s) => Date.parse(s);

test('an event on the 19th opens on the 18th at 16:00 India time', () => {
  const a = { date: '2026-11-19', slot: 'evening' };
  assert.equal(new Date(S.detailsOpenAt(a)).toISOString(), '2026-11-18T10:30:00.000Z');
  assert.equal(S.detailsOpen(a, at('2026-11-18T15:59:59+05:30')), false);
  assert.equal(S.detailsOpen(a, at('2026-11-18T16:00:00+05:30')), true);
  assert.equal(S.detailsOpen(a, at('2026-11-19T09:00:00+05:30')), true);
  assert.equal(S.detailsOpen(a, at('2026-11-10T12:00:00+05:30')), false);
});

test('month and year edges', () => {
  assert.equal(new Date(S.detailsOpenAt({ date: '2026-12-01' })).toISOString(), '2026-11-30T10:30:00.000Z');
  assert.equal(new Date(S.detailsOpenAt({ date: '2027-01-01' })).toISOString(), '2026-12-31T10:30:00.000Z');
  assert.equal(new Date(S.detailsOpenAt({ date: '2028-03-01' })).toISOString(), '2028-02-29T10:30:00.000Z');
});

test('the phone’s own time zone does not move it', () => {
  const prevTZ = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    const M = loadModule('fs-shared.js');
    assert.equal(new Date(M.detailsOpenAt({ date: '2026-11-19' })).toISOString(), '2026-11-18T10:30:00.000Z');
  } finally {
    if (prevTZ === undefined) delete process.env.TZ;
    else process.env.TZ = prevTZ;
  }
});

test('never held back: editing jobs, no date, a date that is not a day', () => {
  for (const a of [
    null,
    undefined,
    {},
    { kind: 'edit', date: '2030-01-01' },
    { date: '' },
    { date: '19 Nov' },
    { date: '2026-02-31' },
  ]) {
    assert.equal(S.detailsOpenAt(a), 0, JSON.stringify(a));
    assert.equal(S.detailsOpen(a, 0), true);
  }
});

test('the crew page uses the shared rule, not a copy', () => {
  const page = read('team/index.html');
  assert.match(page, /import \{[^}]*\bdetailsOpenAt\b[^}]*\} from '\.\.\/fs-shared\.js'/);
  assert.doesNotMatch(page, /function detailsOpenAt|const detailsOpenAt/);
});

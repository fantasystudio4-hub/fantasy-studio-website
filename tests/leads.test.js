/* Enquiries from the public site: a lead must fit firestore.rules or it is lost,
   and the offline queue must retry, then give up, without dropping good leads. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCatalog, read } = require('./helpers/load');

const RULES = read('firestore.rules');
const ruleCap = (field) => {
  const m = RULES.match(new RegExp(`request\\.resource\\.data\\.${field}\\.size\\(\\) <= (\\d+)`));
  assert.ok(m, `no size cap for leads.${field} in firestore.rules`);
  return Number(m[1]);
};

test('LEAD_LIMITS in catalog.js match the caps in firestore.rules', () => {
  const C = loadCatalog();
  assert.equal(C.LEAD_LIMITS.name, ruleCap('name'));
  assert.equal(C.LEAD_LIMITS.phone, ruleCap('phone'));
  assert.equal(C.LEAD_LIMITS.message, ruleCap('message'));
});

test('clampLead trims and caps every field the rule limits', () => {
  const C = loadCatalog();
  const d = C.clampLead({ name: '  ' + 'n'.repeat(500) + '  ', phone: '9'.repeat(40), message: 'm'.repeat(9000) });
  assert.equal(d.name.length, C.LEAD_LIMITS.name);
  assert.equal(d.phone.length, C.LEAD_LIMITS.phone);
  assert.equal(d.message.length, C.LEAD_LIMITS.message);
  assert.equal(C.clampLead(null).name, '');
  assert.equal(C.leadWritable(C.clampLead({ name: '   ' })), false);
  assert.equal(C.leadWritable(C.clampLead({ name: 'Priya' })), true);
});

test('buildLeadDoc only uses keys the leads rule allows', () => {
  const C = loadCatalog();
  const s = { events: [C.normalizeEvent({ type: 'Nikah', date: '2026-12-05', services: { drone: 1 } })], promo: '' };
  const doc = C.buildLeadDoc(s, 'Priya', '9876543210', '919876543210');
  const allowed = RULES.match(/hasOnly\(\s*\[('name'[^\]]*)\]/)[1]
    .split(',')
    .map((x) => x.trim().replace(/'/g, ''));
  for (const k of Object.keys(doc)) assert.ok(allowed.includes(k), `lead key ${k} is not allowed by the rules`);
  assert.equal(doc.source, 'package_builder');
  assert.equal(doc.grandTotal, C.PRICES.drone);
  assert.equal(doc.weddingDate, '2026-12-05');
});

function queueWith(C, items) {
  C.localStorage.setItem(C.LEAD_QUEUE_KEY, JSON.stringify(items));
  C.__firebaseReady = true;
}
const queued = (C) => JSON.parse(C.localStorage.getItem(C.LEAD_QUEUE_KEY) || '[]');

test('flushLeadQueue sends queued leads and empties the queue', async () => {
  const C = loadCatalog();
  const sent = [];
  C.__saveLead = async (d) => {
    sent.push(d.name);
    return true;
  };
  queueWith(C, [
    { doc: { name: 'A' }, at: Date.now(), tries: 0 },
    { doc: { name: 'B' }, at: Date.now(), tries: 1 },
  ]);
  await C.flushLeadQueue();
  assert.deepEqual(sent, ['A', 'B']);
  assert.equal(C.localStorage.getItem(C.LEAD_QUEUE_KEY), null);
});

test('flushLeadQueue keeps a failed lead with one more try, then gives up', async () => {
  const C = loadCatalog();
  C.__saveLead = async () => false;
  queueWith(C, [
    { doc: { name: 'Retry me' }, at: Date.now(), tries: 0 },
    { doc: { name: 'Last try' }, at: Date.now(), tries: C.LEAD_QUEUE_MAX_TRIES - 1 },
    { doc: { name: 'Too old' }, at: Date.now() - C.LEAD_QUEUE_MAX_AGE_MS - 1, tries: 0 },
    { doc: { name: '   ' }, at: Date.now(), tries: 0 },
  ]);
  await C.flushLeadQueue();
  const left = queued(C);
  assert.equal(left.length, 1);
  assert.equal(left[0].doc.name, 'Retry me');
  assert.equal(left[0].tries, 1);
});

test('saveLeadReliably queues the lead when Firebase is not ready', async () => {
  const C = loadCatalog();
  C.__firebaseReady = false;
  const ok = await C.saveLeadReliably({ name: 'Offline', phone: '9876543210' });
  assert.equal(ok, false);
  assert.equal(queued(C)[0].doc.name, 'Offline');
});

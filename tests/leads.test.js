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
  const m = RULES.match(/leadField\('eventType', ''\)\.size\(\) <= (\d+)/);
  assert.equal(C.LEAD_LIMITS.eventType, Number(m[1]));
  const e = RULES.match(/quote\.get\('events', \[\]\)\.size\(\) <= (\d+)/);
  assert.equal(C.LEAD_LIMITS.events, Number(e[1]));
});

test('a builder lead with more functions than the rule allows still fits it', () => {
  const C = loadCatalog();
  const events = [];
  for (let i = 0; i < 15; i++) events.push(C.normalizeEvent({ type: 'Night ' + i, services: { drone: 1 } }));
  events.push(C.normalizeEvent({ type: 'Empty' }));
  const doc = C.clampLead(C.buildLeadDoc({ events, promo: '' }, 'Priya', '9876543210', '919876543210'));
  assert.equal(doc.quote.events.length, C.LEAD_LIMITS.events);
  assert.ok(doc.quote.events.every((e) => Object.keys(e.services).length));
  assert.match(doc.message, /^\+3 more functions/);
  assert.equal(doc.grandTotal, 15 * C.PRICES.drone);
  assert.ok(doc.eventType.length <= C.LEAD_LIMITS.eventType);
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

test('a retried lead reuses the id it was first sent under', async () => {
  const C = loadCatalog();
  C.__firebaseReady = true;
  const ids = [];
  C.__saveLead = async (d) => {
    ids.push(d._id);
    return false; /* first try: cut off by the time box */
  };
  await C.saveLeadReliably({ name: 'Priya', phone: '9876543210' });
  C.__saveLead = async (d) => {
    ids.push(d._id);
    return true;
  };
  await C.flushLeadQueue();
  assert.equal(ids.length, 2);
  assert.match(ids[0], /^[A-Za-z0-9]{20}$/);
  assert.equal(ids[1], ids[0]);
});

test('the REST writer posts under that id, without it as a field, and reads 409 as landed', async () => {
  const calls = [];
  let status = 200;
  const fetch = async (url, opts) => {
    if (!opts) return { ok: true, status: 200, json: async () => ({ fields: {} }) }; /* config/site */
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: status < 300, status };
  };
  const C = loadCatalog({ FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p' }, fetch });
  const lead = { _id: 'abcDEF123', name: 'Priya', phone: '9876543210', source: 'contact_form' };
  assert.equal(await C.__saveLead(lead), true);
  assert.match(calls[0].url, /\/leads\?documentId=abcDEF123&key=k$/);
  assert.equal('_id' in calls[0].body.fields, false);
  status = 409;
  assert.equal(await C.__saveLead(lead), true);
  status = 403;
  assert.equal(await C.__saveLead(lead), false);
  status = 200;
  assert.equal(await C.__saveReview({ id: 'rv1', name: 'A', text: 'Lovely', rating: 5 }), true);
  assert.match(calls[3].url, /\/reviews\?documentId=rv1&key=k$/);
});

/* The public quote engine (catalog.js): what a visitor is quoted in the builder
   is what the studio receives on WhatsApp and in the lead. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCatalog } = require('./helpers/load');

const plain = (x) => JSON.parse(JSON.stringify(x)); /* sandbox objects → this realm */
const C = loadCatalog();
const st = (events, promo = '') => ({ events: events.map((e) => C.normalizeEvent(e)), promo });

test('event and quote totals are price × quantity, summed', () => {
  const s = st([
    { type: 'Nikah', date: '2026-12-05', services: { cinematography: 1, candidPhotography: 2 } },
    { type: 'Valima / Reception', services: { drone: 1 } },
  ]);
  const want = C.PRICES.cinematography + 2 * C.PRICES.candidPhotography + C.PRICES.drone;
  const q = C.calcQuote(s);
  assert.equal(q.sub, want);
  assert.equal(q.disc, 0);
  assert.equal(q.grand, want);
});

test('a percent promo is rounded, and never takes the total below zero', () => {
  const s = st([{ type: 'Nikah', services: { traditionalPhoto: 1 } }], 'SPECIAL10');
  const q = C.calcQuote(s);
  assert.equal(q.disc, Math.round(C.PRICES.traditionalPhoto * 0.1));
  assert.equal(q.grand, q.sub - q.disc);
  C.PROMO_CODES.HUGE = { type: 'flat', value: 10_000_000, label: 'test' };
  try {
    const big = C.calcQuote(st([{ type: 'Nikah', services: { drone: 1 } }], 'HUGE'));
    assert.equal(big.grand, 0);
  } finally {
    delete C.PROMO_CODES.HUGE;
  }
});

test('unknown or prototype-named promo codes give no discount (and no NaN)', () => {
  for (const code of ['NOPE', 'constructor', '__proto__', 'toString', ['SPECIAL10']]) {
    const q = C.calcQuote(st([{ type: 'Nikah', services: { drone: 1 } }], code));
    assert.equal(q.disc, 0, String(code));
    assert.equal(q.grand, C.PRICES.drone, String(code));
  }
});

test('normalizeEvent clamps quantities to MAX_QTY and drops junk', () => {
  const e = C.normalizeEvent({
    type: 'A\nfake\u0000line',
    date: 'not-a-date',
    services: { drone: 999, cinematography: '2.9', candidPhotography: -1, bogus: 3, liveStreaming: 'x' },
  });
  assert.deepEqual(plain(e.services), { drone: C.MAX_QTY, cinematography: 2 });
  assert.equal(e.date, '');
  assert.ok(!/[\n\u0000]/.test(e.type));
  assert.ok(C.normalizeEvent({ type: 'x'.repeat(500) }).type.length <= 40);
  assert.equal(C.normalizeEvent({}).type, C.EVENT_TYPES[0]);
});

test('a shared #q= link round-trips the package', () => {
  const s = st(
    [{ type: 'Mehndi', date: '2026-11-20', services: { candidPhotography: 1, ladyShooter: 2 } }],
    'SPECIAL10',
  );
  const d = C.decodeQuote(C.encodeQuote(s));
  assert.equal(d.p, 'SPECIAL10');
  assert.deepEqual(plain(d.e), [{ t: 'Mehndi', d: '2026-11-20', s: { candidPhotography: 1, ladyShooter: 2 } }]);
  assert.equal(C.decodeQuote('%%%garbage'), null);
});

test('parsePhone keeps the last 10 digits and a country code (NRI clients)', () => {
  assert.equal(C.parsePhone('98765 43210').e164, '919876543210');
  assert.equal(C.parsePhone('098765 43210').e164, '919876543210'); /* trunk 0, not a country code */
  assert.equal(C.parsePhone('+1 (415) 555-0123').e164, '14155550123');
  /* UAE mobiles are 9 digits, so the last-10 split reads cc '97' — the full number is still right */
  assert.equal(C.parsePhone('00971 50 123 4567').e164, '971501234567');
  assert.equal(C.parsePhone('12345'), null);
  assert.equal(C.parsePhone('1'.repeat(16)), null);
});

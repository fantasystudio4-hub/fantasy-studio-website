/* The quotation PDF's payment schedule must add up to the Balance Due box. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { read, cut } = require('./helpers/load');

/* admin/pdf-template.js is a browser ES module; the package is CommonJS, so the
   function is sliced out of the source like the page helpers are */
const load = async () => {
  const fn = cut(
    read('admin/pdf-template.js'),
    'export function paymentSchedule',
    'export async function buildQuotePdf',
  );
  return { paymentSchedule: new Function(`${fn.replace(/^export /, '')}; return paymentSchedule;`)() };
};

test('the two schedule rows add up to the balance due', async () => {
  const { paymentSchedule } = await load();
  /* the usual case: 10% at delivery, the rest after the event */
  assert.deepEqual(paymentSchedule(100000, 70000), { delivery: 10000, eventDay: 60000, fullTenth: true });
  /* an advance over 90%: only what is left, all at delivery */
  assert.deepEqual(paymentSchedule(100000, 5000), { delivery: 5000, eventDay: 0, fullTenth: false });
  /* paid in full or overpaid: nothing scheduled */
  assert.deepEqual(paymentSchedule(100000, 0), { delivery: 0, eventDay: 0, fullTenth: false });
  assert.deepEqual(paymentSchedule(100000, -10000), { delivery: 0, eventDay: 0, fullTenth: false });
  for (const [fin, bal] of [
    [250000, 175000],
    [99999, 33333],
    [1, 1],
  ]) {
    const s = paymentSchedule(fin, bal);
    assert.equal(s.delivery + s.eventDay, bal);
  }
});

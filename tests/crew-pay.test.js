/* Crew pay: the admin panel and the crew page each carry payFee/payGot/payDue/
   payEarned/payOwed/payUpcoming. If the two copies ever disagree, the owner and
   the crew member see different amounts owed. This runs BOTH real copies over
   the same rows and requires identical answers. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { read, cut } = require('./helpers/load');

const TODAY = '2026-11-01';
function load(src, from, to, extra, more) {
  const body = cut(src, from, to);
  const names = ['payFee', 'payGot', 'payDue', 'payEarned', 'payOwed', 'payUpcoming'].concat(more || []);
  return new Function('todayISO', `${extra || ''}\n${body}\nreturn { ${names.join(', ')} };`)(() => TODAY);
}
const admin = load(read('admin/app.js'), '  const payFee = a =>', "  /* 'paid' only when");
const team = load(read('team/index.html'), 'const payFee = a =>', '/* every instalment as');

const ROWS = [
  undefined,
  {},
  { pay: {} },
  { date: '2026-10-30', pay: { amount: 5000 } } /* past, unpaid → owed */,
  { date: '2026-10-30', pay: { amount: 5000, paidAmount: 2000 } } /* part paid */,
  { date: '2026-10-30', pay: { amount: 5000, paid: true } } /* legacy paid in full */,
  { date: '2026-10-30', pay: { amount: 5000, paid: true, paidAmount: 1000 } } /* paidAmount wins */,
  { date: TODAY, pay: { amount: 4000 } } /* today → still upcoming */,
  { date: '2026-12-01', pay: { amount: 4000, paidAmount: 500 } } /* future */,
  { kind: 'edit', date: '2026-12-01', pay: { amount: 7000 } } /* editing: owed at once */,
  { date: 'someday', pay: { amount: '3000' } } /* no usable date: owed */,
  { date: '2026-10-01', pay: { amount: 'abc', paidAmount: -50 } } /* junk never goes negative */,
  { date: '2026-10-01', pay: { amount: 1000, paidAmount: 3000 } } /* overpaid: due is 0, not −2000 */,
];

test('admin and crew page compute identical pay for every row shape', () => {
  for (const a of ROWS) {
    for (const fn of Object.keys(admin)) {
      assert.equal(team[fn](a), admin[fn](a), `${fn}(${JSON.stringify(a)})`);
    }
  }
});

test('pay helpers: owed + upcoming === due, never negative', () => {
  for (const a of ROWS) {
    assert.equal(admin.payOwed(a) + admin.payUpcoming(a), admin.payDue(a));
    assert.ok(admin.payDue(a) >= 0 && admin.payGot(a) >= 0 && admin.payFee(a) >= 0);
  }
  assert.equal(admin.payOwed(ROWS[3]), 5000);
  assert.equal(admin.payDue(ROWS[4]), 3000);
  assert.equal(admin.payDue(ROWS[5]), 0);
  assert.equal(admin.payOwed(ROWS[7]), 0);
  assert.equal(admin.payUpcoming(ROWS[7]), 4000);
  assert.equal(admin.payOwed(ROWS[9]), 7000);
});

test('a crew row with pay recorded cannot be handed to another member', () => {
  const { reassignBlocked } = load(
    read('admin/app.js'),
    '  const payFee = a =>',
    "  /* 'paid' only when",
    '',
    'reassignBlocked',
  );
  const paid = { memberId: 'vikas', pay: { amount: 5000, paidAmount: 2000 } };
  const legacyPaid = { memberId: 'vikas', pay: { amount: 5000, paid: true } };
  const unpaid = { memberId: 'vikas', pay: { amount: 5000 } };
  assert.equal(reassignBlocked(paid, 'sandeep'), true);
  assert.equal(reassignBlocked(legacyPaid, 'sandeep'), true);
  assert.equal(reassignBlocked(paid, 'vikas'), false); /* fee / time edits on the same person still save */
  assert.equal(reassignBlocked(unpaid, 'sandeep'), false);
  assert.equal(reassignBlocked(null, 'sandeep'), false); /* a new row */
});

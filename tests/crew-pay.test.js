/* Crew pay and a partner's account: one copy, fs-shared.js, read by the admin
   panel, the crew page and the partner page. These tests pin the rules and
   make sure no page grows its own copy again. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { read, loadModule } = require('./helpers/load');

const TODAY = '2026-11-01';
/* fs-shared reads the date through Date; pin it to TODAY in Hyderabad */
class FixedDate extends Date {
  constructor(...a) {
    super(...(a.length ? a : [`${TODAY}T12:00:00+05:30`]));
  }
  static now() {
    return new Date(`${TODAY}T12:00:00+05:30`).getTime();
  }
}
const S = loadModule('fs-shared.js', { Date: FixedDate });

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

test('pay helpers: owed + upcoming === due, never negative', () => {
  for (const a of ROWS) {
    assert.equal(S.payOwed(a) + S.payUpcoming(a), S.payDue(a), JSON.stringify(a));
    assert.ok(S.payDue(a) >= 0 && S.payGot(a) >= 0 && S.payFee(a) >= 0, JSON.stringify(a));
  }
  assert.equal(S.payOwed(ROWS[3]), 5000);
  assert.equal(S.payDue(ROWS[4]), 3000);
  assert.equal(S.payDue(ROWS[5]), 0);
  assert.equal(S.payGot(ROWS[6]), 1000);
  assert.equal(S.payOwed(ROWS[7]), 0);
  assert.equal(S.payUpcoming(ROWS[7]), 4000);
  assert.equal(S.payOwed(ROWS[9]), 7000);
  assert.equal(S.payOwed(ROWS[10]), 3000);
  assert.equal(S.payDue(ROWS[12]), 0);
});

test('payState: paid / part / due', () => {
  assert.equal(S.payState(ROWS[3]), 'due');
  assert.equal(S.payState(ROWS[4]), 'part');
  assert.equal(S.payState(ROWS[5]), 'paid');
  assert.equal(S.payState({ pay: { amount: 0, paidAmount: 500 } }), 'paid');
});

test("jobPhase / jobBalance: a partner's two balance boxes", () => {
  const job = (dates, status = 'booked', balance = 1000) => ({
    status,
    events: dates.map((date) => ({ date })),
    totals: { balance },
  });
  assert.equal(S.jobPhase(job([])), 'upcoming');
  assert.equal(S.jobPhase(job(['2026-11-05'])), 'upcoming');
  assert.equal(S.jobPhase(job(['2026-10-30', '2026-11-03'])), 'ongoing');
  assert.equal(S.jobPhase(job([TODAY])), 'ongoing');
  assert.equal(S.jobPhase(job(['2026-10-01'])), 'done');
  assert.equal(S.jobPhase(job(['2026-12-01'], 'delivered')), 'done');
  assert.equal(S.jobPhase(job(['bad', '2026-10-01'])), 'done');
  assert.equal(S.jobBalance(job([], 'booked', -5)), 0);
  assert.equal(S.jobBalance({}), 0);
  assert.equal(S.jobBalance(job([], 'booked', '2500')), 2500);
});

test('the admin, crew and partner pages import these rules instead of keeping copies', () => {
  const BASE = ['esc', 'inr', 'todayISO'];
  const PAY = ['payFee', 'payGot', 'payDue', 'payState', 'payEarned', 'payOwed', 'payUpcoming'];
  for (const [file, names] of [
    ['admin/app.js', [...BASE, ...PAY, 'jobPhase', 'jobBalance']],
    ['team/index.html', [...BASE, ...PAY.filter((n) => n !== 'payEarned')]],
    ['studio/index.html', [...BASE, 'jobPhase', 'jobBalance']],
  ]) {
    const src = read(file);
    assert.match(src, /import \{[^}]*\} from '\.\.\/fs-shared\.js'/, `${file} must import ../fs-shared.js`);
    for (const n of names) {
      assert.ok(
        !new RegExp(`(?:const|let|function)\\s+${n}\\b`).test(src),
        `${file} defines its own ${n} — use the one in fs-shared.js`,
      );
    }
  }
});

test('a crew row with pay recorded cannot be handed to another member', () => {
  const src = read('admin/app.js');
  const m = src.match(/const reassignBlocked = (\(old, memberId\) => [^;]+);/);
  assert.ok(m, 'reassignBlocked not found');
  const reassignBlocked = new Function('payGot', `return ${m[1]};`)(S.payGot);
  const paid = { memberId: 'vikas', pay: { amount: 5000, paidAmount: 2000 } };
  const legacyPaid = { memberId: 'vikas', pay: { amount: 5000, paid: true } };
  const unpaid = { memberId: 'vikas', pay: { amount: 5000 } };
  assert.equal(reassignBlocked(paid, 'sandeep'), true);
  assert.equal(reassignBlocked(legacyPaid, 'sandeep'), true);
  assert.equal(reassignBlocked(paid, 'vikas'), false); /* fee / time edits on the same person still save */
  assert.equal(reassignBlocked(unpaid, 'sandeep'), false);
  assert.equal(reassignBlocked(null, 'sandeep'), false); /* a new row */
});

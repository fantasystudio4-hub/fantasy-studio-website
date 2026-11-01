/* The crew page's "Next shoot" card and the home-screen widget both read
   nextShoots(): shoots from the first one that is not over yet. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { read, cut } = require('./helpers/load');

const SRC = read('team/index.html');
const START = cut(SRC, '  const SLOT_START = {', '  const calOn = ');
const NEXT = cut(SRC, '  const SHOOT_OVER = ', '  const widgetOff = ');

function nextShootsAt(nowIso, ASGS) {
  const RealDate = Date;
  const now = new RealDate(nowIso).getTime();
  class FakeDate extends RealDate {
    constructor(...a) {
      super(...(a.length ? a : [now]));
    }
    static now() {
      return now;
    }
  }
  const today = nowIso.slice(0, 10);
  return new Function('Date', 'ASGS', 'todayISO', 'slotRank', 'slotName', `${START}\n${NEXT}\nreturn nextShoots();`)(
    FakeDate,
    ASGS,
    () => today,
    () => 0,
    () => '',
  ).map((a) => a.id);
}

const shoot = (id, date, callTime) => ({ id, date, callTime, eventTitle: 'Haldi' });

test('a shoot later today is next', () => {
  assert.deepEqual(nextShootsAt('2026-11-01T06:00:00+05:30', [shoot('a', '2026-11-01', '08:00')]), ['a']);
});

test('the shoot that is over gives way to the next one', () => {
  const rows = [shoot('a', '2026-11-01', '08:00'), shoot('b', '2026-11-02', '08:00')];
  assert.deepEqual(nextShootsAt('2026-11-01T12:00:00+05:30', rows), ['b']);
});

test('when every shoot left is over, nothing is next', () => {
  /* the only shoot was today at 08:00; at 11:00+ it is over (3 hours) */
  assert.deepEqual(nextShootsAt('2026-11-01T12:00:00+05:30', [shoot('a', '2026-11-01', '08:00')]), []);
});

/* 引擎测试：node --test public/shift-alarm/tests/
 * 断言尽量对着「外部可验证的事实」写——ISO 星期对 Date 的 UTC 结果、
 * 2026 年春节与补班对国务院公告——而不是对着实现自己复述一遍。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../engine.js';
import { CN_HOLIDAYS } from '../holidays-data.js';

const H2026 = {
  off: CN_HOLIDAYS['2026'].off,
  work: CN_HOLIDAYS['2026'].work,
  names: CN_HOLIDAYS['2026'].names,
};

test('civil date 与 Date(UTC) 在 1970–2050 全程一致', () => {
  for (let z = -3653; z < 29220; z += 7) {          // 1960 → 2050，每 7 天抽一次
    const iso = E.toISO(z);
    const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
    assert.equal(d.toISOString().slice(0, 10), iso, `toISO(${z})`);
    assert.equal(E.toDays(iso), z, `toDays(${iso})`);
    const jsDow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    assert.equal(E.isoDow(z), jsDow, `isoDow(${iso})`);
  }
});

test('ISO 周号符合 ISO-8601（含跨年那几周）', () => {
  // 2026-01-01 是周四 → 属第 1 周；2025-12-29(周一) 也属 2026 第 1 周
  assert.equal(E.isoWeekNumber('2026-01-01'), 1);
  assert.equal(E.isoWeekNumber('2025-12-29'), 1);
  assert.equal(E.isoWeekNumber('2025-12-28'), 52);   // 周日，属 2025 第 52 周
  assert.equal(E.isoWeekNumber('2026-12-31'), 53);   // 2026 是 53 周年
});

test('跨日时刻解析：夜班下班落到次日，提前量落到前一晚', () => {
  assert.deepEqual(E.resolveClock('2026-03-05', E.toMinutes('23:00') + 180),
    { date: '2026-03-06', time: '02:00', minutes: 120 });
  assert.deepEqual(E.resolveClock('2026-03-05', E.toMinutes('01:00') - 120),
    { date: '2026-03-04', time: '23:00', minutes: 1380 });
});

function baseRules(over = {}) {
  return Object.assign(E.emptyRules(), over);
}

test('固定周班型：只在周一到周五上班', () => {
  const r = baseRules();
  const s = E.expandSchedule(r, '2026-03-02', '2026-03-08', { off: [], work: [], names: {} });
  assert.deepEqual(s.days.map((d) => d.isWork), [true, true, true, true, true, false, false]);
});

test('大小周（anchor 口径）：周六隔周上，且严格交替', () => {
  const r = baseRules();
  r.pattern = { ...r.pattern, kind: 'alternating', baseWorkdays: [1, 2, 3, 4, 5],
    bigWeekExtra: [6], parity: 'anchor', anchorMonday: '2026-03-02', anchorIsBig: true };
  const s = E.expandSchedule(r, '2026-03-01', '2026-04-30', { off: [], work: [], names: {} });
  const saturdays = s.days.filter((d) => d.dow === 6).map((d) => [d.date, d.isWork]);
  assert.deepEqual(saturdays, [
    ['2026-03-07', true],  ['2026-03-14', false],
    ['2026-03-21', true],  ['2026-03-28', false],
    ['2026-04-04', true],  ['2026-04-11', false],
    ['2026-04-18', true],  ['2026-04-25', false],
  ]);
  // 周日永远休、周一到周五永远上
  for (const d of s.days) {
    if (d.dow === 7) assert.equal(d.isWork, false, d.date);
    if (d.dow <= 5) assert.equal(d.isWork, true, d.date);
  }
});

test('大周多上的那天打上 bigweek-extra 标签', () => {
  const r = baseRules();
  r.pattern = { ...r.pattern, kind: 'alternating', parity: 'anchor',
    anchorMonday: '2026-03-02', anchorIsBig: true, baseWorkdays: [1,2,3,4,5], bigWeekExtra: [6] };
  const s = E.expandSchedule(r, '2026-03-02', '2026-03-08', { off: [], work: [], names: {} });
  assert.ok(s.byDate.get('2026-03-07').tags.includes('bigweek-extra'));
  assert.ok(!s.byDate.get('2026-03-06').tags.includes('bigweek-extra'));
});

test('法定节假日：2026 春节整段不上班，哪怕是周一到周五', () => {
  const r = baseRules();
  const s = E.expandSchedule(r, '2026-02-15', '2026-02-23', H2026);
  for (const d of s.days) {
    assert.equal(d.isWork, false, `${d.date} 应放假`);
    assert.ok(d.tags.includes('holiday'));
    assert.equal(d.holidayName, '春节');
  }
});

test('调休补班：2026-02-14 是周六但要上班，2026-09-20 是周日也要上班', () => {
  const r = baseRules();
  const s = E.expandSchedule(r, '2026-01-01', '2026-12-31', H2026);
  for (const date of CN_HOLIDAYS['2026'].work) {
    const d = s.byDate.get(date);
    assert.equal(d.isWork, true, `${date} 应为补班日`);
    assert.ok(d.tags.includes('makeup'), `${date} 应有 makeup 标签`);
  }
  assert.equal(E.dowOf('2026-02-14'), 6);
  assert.equal(E.dowOf('2026-09-20'), 7);
});

test('补班能把「小周的周六」翻成上班（大小周 × 调休 的交叉情形）', () => {
  const r = baseRules();
  r.pattern = { ...r.pattern, kind: 'alternating', parity: 'anchor',
    anchorMonday: '2026-02-09', anchorIsBig: false,   // 2026-02-14 那周是小周 → 周六本该休
    baseWorkdays: [1,2,3,4,5], bigWeekExtra: [6] };
  const noHol = E.expandSchedule(r, '2026-02-14', '2026-02-14', { off: [], work: [], names: {} });
  assert.equal(noHol.byDate.get('2026-02-14').isWork, false, '小周周六本该休');
  const withHol = E.expandSchedule(r, '2026-02-14', '2026-02-14', H2026);
  assert.equal(withHol.byDate.get('2026-02-14').isWork, true, '补班应覆盖小周');
  assert.ok(withHol.byDate.get('2026-02-14').trace.some((t) => t.includes('补班')));
});

test('优先级：手动覆盖压过法定假日与补班', () => {
  const r = baseRules();
  r.overrides = { work: { '2026-02-16': 'day' }, off: ['2026-02-14'] };
  const s = E.expandSchedule(r, '2026-02-14', '2026-02-16', H2026);
  assert.equal(s.byDate.get('2026-02-14').isWork, false, '手动标休压过补班');
  assert.equal(s.byDate.get('2026-02-16').isWork, true, '手动标上班压过春节');
});

test('请假区间整段变休', () => {
  const r = baseRules();
  r.leaves = [{ start: '2026-03-09', end: '2026-03-13', name: '年假' }];
  const s = E.expandSchedule(r, '2026-03-09', '2026-03-13', H2026);
  assert.ok(s.days.every((d) => !d.isWork && d.reason === '年假'));
});

test('循环班型：做四休三，锚点当天是第 1 天', () => {
  const r = baseRules();
  r.pattern = { ...r.pattern, kind: 'cycle',
    cycle: { anchor: '2026-03-02', slots: ['day', 'day', 'day', 'day', 'off', 'off', 'off'] } };
  const s = E.expandSchedule(r, '2026-03-02', '2026-03-15', { off: [], work: [], names: {} });
  assert.deepEqual(s.days.map((d) => d.isWork),
    [true, true, true, true, false, false, false, true, true, true, true, false, false, false]);
});

test('循环班型在锚点之前也正确（负数取模）', () => {
  const r = baseRules();
  r.pattern = { ...r.pattern, kind: 'cycle',
    cycle: { anchor: '2026-03-02', slots: ['day', 'day', 'off'] } };
  const s = E.expandSchedule(r, '2026-02-27', '2026-03-02', { off: [], work: [], names: {} });
  // 2026-03-02 是第 1 天 → 02-27 应是第 1 天(往前 3 天整循环)，02-28 第 2 天，03-01 第 3 天(休)
  assert.deepEqual(s.days.map((d) => d.isWork), [true, true, false, true]);
});

test('三班倒：每个循环位可以指定不同班次', () => {
  const r = baseRules();
  r.shifts = [
    { id: 'morning', name: '早班', start: '07:00', end: '15:00' },
    { id: 'night', name: '夜班', start: '23:00', end: '07:00' },
  ];
  r.pattern = { ...r.pattern, kind: 'cycle',
    cycle: { anchor: '2026-03-02', slots: ['morning', 'morning', 'night', 'night', 'off', 'off'] } };
  const s = E.expandSchedule(r, '2026-03-02', '2026-03-07', { off: [], work: [], names: {} });
  assert.deepEqual(s.days.map((d) => (d.shift ? d.shift.id : null)),
    ['morning', 'morning', 'night', 'night', null, null]);
});

test('提醒：上班日提前 90 分钟的闹钟落在同一天', () => {
  const r = baseRules();
  r.reminders = [{ id: 'wake', kind: 'alarm', on: 'workday',
    when: { anchor: 'shiftStart', offsetMin: -90 }, title: '起床 · {班次}{上班}' }];
  const s = E.expandSchedule(r, '2026-03-02', '2026-03-08', H2026);
  const occ = E.expandReminders(r, s);
  assert.equal(occ.length, 5);
  assert.equal(occ[0].date, '2026-03-02');
  assert.equal(occ[0].time, '07:30');
  assert.equal(occ[0].title, '起床 · 白班09:00');
});

test('提醒：夜班「下班后」提醒跨到次日', () => {
  const r = baseRules();
  r.shifts = [{ id: 'night', name: '夜班', start: '23:00', end: '07:00' }];
  r.defaultShift = 'night';
  r.pattern = { ...r.pattern, kind: 'weekly', workdays: [1] };
  r.reminders = [{ id: 'out', kind: 'event', on: 'workday',
    when: { anchor: 'shiftEnd', offsetMin: 0 }, title: '下班打卡' }];
  const s = E.expandSchedule(r, '2026-03-02', '2026-03-02', { off: [], work: [], names: {} });
  const occ = E.expandReminders(r, s);
  assert.equal(occ[0].date, '2026-03-03');
  assert.equal(occ[0].time, '07:00');
});

test('提醒：前一晚提醒只在「明天要上班」时触发，且能读到明天的上班时间', () => {
  const r = baseRules();
  r.reminders = [{ id: 'sleep', kind: 'event', on: 'eve-of-work',
    when: { anchor: 'next-shiftStart', offsetMin: -630 }, title: '早点睡 · 明天{明日上班}上班' }];
  const s = E.expandSchedule(r, '2026-03-06', '2026-03-09', H2026);   // 五 六 日 一
  const occ = E.expandReminders(r, s);
  assert.deepEqual(occ.map((o) => o.date), ['2026-03-08']);   // 只有周日晚上（明天周一要上班）
  assert.equal(occ[0].time, '22:30');
  assert.equal(occ[0].title, '早点睡 · 明天09:00上班');
});

test('提醒：只在补班日触发', () => {
  const r = baseRules();
  r.reminders = [{ id: 'm', kind: 'event', on: 'makeup', when: { anchor: 'fixed', time: '08:00' }, title: '今天补班' }];
  const s = E.expandSchedule(r, '2026-01-01', '2026-12-31', H2026);
  const occ = E.expandReminders(r, s);
  assert.deepEqual(occ.map((o) => o.date), CN_HOLIDAYS['2026'].work);
});

test('连上天数：2026 双休制下有两段并列 6 天，longestStreak 取最早的一段', () => {
  const r = baseRules();
  const s = E.expandSchedule(r, '2026-01-01', '2026-12-31', H2026);
  // 01-04 是周日补班 → 04~09 连上 6 天；02-14 是周六补班 → 02-09~02-14 连上 6 天。
  assert.deepEqual(E.streaksAtLeast(s, 6), [
    { start: '2026-01-04', end: '2026-01-09', days: 6 },
    { start: '2026-02-09', end: '2026-02-14', days: 6 },
  ]);
  const st = E.longestStreak(s);
  assert.equal(st.days, 6);
  assert.equal(st.start, '2026-01-04');
  assert.equal(st.end, '2026-01-09');
});

test('大小周 + 调休叠加会造出更长的连上区间（这正是 iPhone 看不见的东西）', () => {
  const r = baseRules();
  r.pattern = { ...r.pattern, kind: 'alternating', parity: 'anchor',
    anchorMonday: '2026-01-05', anchorIsBig: true, baseWorkdays: [1,2,3,4,5], bigWeekExtra: [6] };
  const s = E.expandSchedule(r, '2026-01-01', '2026-12-31', H2026);
  const runs = E.streaksAtLeast(s, 7);
  assert.ok(runs.length > 0, '大小周叠调休应出现 7 天以上连上');
  for (const run of runs) {
    assert.ok(run.days >= 7);
    assert.equal(E.addDays(run.start, run.days - 1), run.end);
  }
});

test('假日数据没覆盖的年份会给出警告', () => {
  const r = baseRules();
  const s = E.expandSchedule(r, '2028-01-01', '2028-03-01', H2026);
  assert.ok(s.warnings.some((w) => w.includes('2028')), s.warnings.join('|'));
});

test('统计：双休制 2026 年工作日数量与逐日展开一致', () => {
  const r = baseRules();
  const s = E.expandSchedule(r, '2026-01-01', '2026-12-31', H2026);
  const sum = E.summarize(s);
  assert.equal(sum.work + sum.rest, 365);
  assert.equal(sum.work, s.days.filter((d) => d.isWork).length);
  assert.equal(sum.makeup, 6);
  assert.equal(sum.months.length, 12);
});

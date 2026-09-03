/* 中文班规解析测试。
 * 重点不只是「能解析对」，还有「拿不准的时候必须问」——
 * 解析器悄悄猜一个大小周起算周，比解析失败危险得多。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../parser.js';
import * as E from '../engine.js';
import { CN_HOLIDAYS } from '../holidays-data.js';

const TODAY = '2026-09-03';                 // 周四
const H = { off: CN_HOLIDAYS['2026'].off, work: CN_HOLIDAYS['2026'].work, names: CN_HOLIDAYS['2026'].names };
const parse = (s) => P.parseWorkRules(s, { today: TODAY });

test('中文数字', () => {
  assert.equal(P.cnNum('九'), 9);
  assert.equal(P.cnNum('十'), 10);
  assert.equal(P.cnNum('十二'), 12);
  assert.equal(P.cnNum('二十'), 20);
  assert.equal(P.cnNum('二十三'), 23);
  assert.equal(P.cnNum('18'), 18);
});

test('时刻解析：数字、中文、半/一刻、上下午', () => {
  assert.equal(P.parseTime('9:30'), '09:30');
  assert.equal(P.parseTime('09:05'), '09:05');
  assert.equal(P.parseTime('九点'), '09:00');
  assert.equal(P.parseTime('九点半'), '09:30');
  assert.equal(P.parseTime('八点一刻'), '08:15');
  assert.equal(P.parseTime('十点三刻'), '10:45');
  assert.equal(P.parseTime('6点', '下午'), '18:00');
  assert.equal(P.parseTime('8点', '晚上'), '20:00');
  assert.equal(P.parseTime('9点', '早上'), '09:00');
  assert.equal(P.parseTime('12点', '中午'), '12:00');
});

test('星期解析：区间与单点', () => {
  assert.deepEqual(P.parseDows('周一到周五'), [1, 2, 3, 4, 5]);
  assert.deepEqual(P.parseDows('星期一至星期六'), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(P.parseDows('周六和周日'), [6, 7]);
  assert.deepEqual(P.parseDows('礼拜三'), [3]);
});

test('双休 + 早九晚六', () => {
  const { rules, notes } = parse('双休，早九晚六');
  assert.equal(rules.pattern.kind, 'weekly');
  assert.deepEqual(rules.pattern.workdays, [1, 2, 3, 4, 5]);
  assert.equal(rules.shifts[0].start, '09:00');
  assert.equal(rules.shifts[0].end, '18:00');
  assert.ok(notes.some((n) => n.label === '上下班' && n.confidence === 'sure'));
});

test('单休', () => {
  const { rules } = parse('单休，8点半上班，6点下班');
  assert.deepEqual(rules.pattern.workdays, [1, 2, 3, 4, 5, 6]);
  assert.equal(rules.shifts[0].start, '08:30');
});

test('996 同时给出时间与六天班', () => {
  const { rules } = parse('我们公司996');
  assert.equal(rules.shifts[0].start, '09:00');
  assert.equal(rules.shifts[0].end, '21:00');
  assert.deepEqual(rules.pattern.workdays, [1, 2, 3, 4, 5, 6]);
});

test('大小周：识别班型，并且必须追问起算周', () => {
  const { rules, questions } = parse('大小周，早九晚六');
  assert.equal(rules.pattern.kind, 'alternating');
  assert.deepEqual(rules.pattern.bigWeekExtra, [6]);
  assert.equal(rules.pattern.parity, 'anchor');
  assert.ok(questions.some((q) => q.id === 'anchor'), '起算周没确认就是猜，必须问');
});

test('大小周：原文说了「这周要上周六」就不再追问', () => {
  const { rules, questions } = parse('大小周，早九晚六，这周要上周六');
  assert.equal(rules.pattern.anchorMonday, E.mondayOf(TODAY));
  assert.equal(rules.pattern.anchorIsBig, true);
  assert.ok(!questions.some((q) => q.id === 'anchor'));
});

test('大小周：说了「下周休」→ 下周是小周', () => {
  const { rules } = parse('大小周，下周休息，不用上班');
  assert.equal(rules.pattern.anchorMonday, E.addDays(E.mondayOf(TODAY), 7));
  assert.equal(rules.pattern.anchorIsBig, false);
});

test('大小周落到日历上：周六严格隔周，周日永远休', () => {
  const { rules } = parse('大小周，早九晚六，这周要上周六');
  const s = E.expandSchedule(rules, '2026-09-01', '2026-11-30', H);

  // 「大周」这件事本身必须严格隔周交替（这是班型层的性质）
  const sats = s.days.filter((d) => d.dow === 6);
  for (let i = 1; i < sats.length; i++) {
    assert.notEqual(E.isBigWeek(rules.pattern, sats[i].date),
                    E.isBigWeek(rules.pattern, sats[i - 1].date),
                    `${sats[i].date} 的大小周属性没有交替`);
  }
  // 落到「今天要不要上班」时，法定节假日与调休会盖掉班型——
  // 所以只在一段没有假期的窗口里断言交替（11 月 2026 全月无假）。
  // 起算周是 2026-08-31（大周），11-02 那周距它 9 周 → 小周，所以 11-07 休。
  const nov = s.days.filter((d) => d.dow === 6 && d.date.startsWith('2026-11'));
  assert.deepEqual(nov.map((d) => [d.date, d.isWork]), [
    ['2026-11-07', false], ['2026-11-14', true],
    ['2026-11-21', false], ['2026-11-28', true],
  ]);
  // 跨月不能断档：10-31 是大周上班，紧接着的 11-07 必须是小周休
  assert.equal(s.byDate.get('2026-10-31').isWork, true);
  assert.equal(s.byDate.get('2026-09-05').isWork, true, '本周六应上班');
  assert.equal(s.byDate.get('2026-09-26').isWork, false, '中秋当天不上班，哪怕它是大周周六');
  for (const d of s.days) if (d.dow === 7 && !d.tags.includes('makeup')) assert.equal(d.isWork, false);
});

test('做四休三 → 滚动循环，并追问起算日', () => {
  const { rules, questions } = parse('做四休三，早八晚八');
  assert.equal(rules.pattern.kind, 'cycle');
  assert.equal(rules.pattern.cycle.slots.length, 7);
  assert.equal(rules.pattern.cycle.slots.filter((s) => s !== 'off').length, 4);
  assert.ok(questions.some((q) => q.id === 'cycleAnchor'));
});

test('做五休二 当成固定周班型而不是滚动循环', () => {
  const { rules } = parse('做五休二');
  assert.equal(rules.pattern.kind, 'weekly');
  assert.deepEqual(rules.pattern.workdays, [1, 2, 3, 4, 5]);
});

test('三班倒：给出三个班次且夜班跨日', () => {
  const { rules, questions } = parse('三班倒');
  assert.equal(rules.shifts.length, 3);
  assert.equal(rules.pattern.kind, 'cycle');
  // 三班倒的排法是 早 08–16 / 中 16–24 / 夜 00–08：
  // 跨日的是**中班**（16:00 的 end 写成 00:00），夜班反而落在同一天内。
  const noon = rules.shifts.find((s) => s.id === 'noon');
  assert.ok(E.toMinutes(noon.end) <= E.toMinutes(noon.start), '中班应跨日到次日 0 点');
  const night = rules.shifts.find((s) => s.id === 'night');
  assert.equal(night.start, '00:00');
  assert.equal(night.end, '08:00');
  assert.ok(questions.some((q) => q.id === 'shiftCycle'));
});

test('默认跟随法定节假日；明说不跟就关掉', () => {
  assert.equal(parse('双休').rules.holidays.observeOff, true);
  assert.equal(parse('双休').rules.holidays.observeMakeup, true);
  const off = parse('双休，节假日照常上班，不调休').rules.holidays;
  assert.equal(off.observeOff, false);
  assert.equal(off.observeMakeup, false);
});

test('起床提前量：读得出「提前一小时」', () => {
  const { rules } = parse('双休，早九晚六，提前一小时起床');
  const wake = rules.reminders.find((r) => r.id === 'wake');
  assert.equal(wake.when.offsetMin, -60);
});

test('没说上下班时间时，要标成猜的并追问', () => {
  const { notes, questions } = parse('大小周');
  assert.ok(notes.some((n) => n.label === '上下班' && n.confidence === 'guess'));
  assert.ok(questions.some((q) => q.id === 'shift'));
});

test('解析结果直接喂引擎能跑通，且提醒能展开', () => {
  const { rules } = parse('大小周，早九晚六，这周要上周六，提前90分钟起床');
  const s = E.expandSchedule(rules, '2026-09-03', '2027-03-03', H);
  const occ = E.expandReminders(rules, s);
  assert.ok(occ.length > 300, `提醒实例太少：${occ.length}`);
  const wake = occ.filter((o) => o.reminderId === 'wake');
  assert.equal(wake[0].time, '07:30');
  assert.ok(wake.every((o) => o.title.includes('上班')));
});

/* ── 模型输出的收编 ── */

test('adoptRules 只认白名单字段，脏数据不会带偏班表', () => {
  const { rules, problems } = P.adoptRules({
    name: '测试',
    pattern: { kind: 'alternating', baseWorkdays: [1, 2, 3, 4, 5, 99], bigWeekExtra: [6],
      parity: '乱写', anchorMonday: '2026-09-07', anchorIsBig: true },
    shifts: [{ id: 'day', name: '白班', start: '09:00', end: '18:00' },
             { id: 'bad', name: '坏班', start: '9点', end: '18:00' }],
    defaultShift: '不存在的班次',
    shiftByDow: { 6: 'day', 9: 'day', 5: '不存在' },
    holidays: { observeOff: true, observeMakeup: false },
    reminders: [{ id: 'ok', on: 'workday', when: { anchor: 'shiftStart', offsetMin: -90 },
                  title: '起床', alarmsMin: [0, -5, -10, -15] },
                { id: 'bad', on: '不存在的时机', when: {}, title: 'x' }],
    额外字段: '应被忽略',
    uncertainties: ['起算周是猜的'],
  }, { today: TODAY });

  assert.deepEqual(rules.pattern.baseWorkdays, [1, 2, 3, 4, 5], '越界的 99 应被丢掉');
  assert.equal(rules.pattern.parity, 'anchor', '非法 parity 应回退');
  assert.equal(rules.shifts.length, 1, '时间格式不合法的班次应被丢掉');
  assert.equal(rules.defaultShift, 'day', '不存在的 defaultShift 应回退到第一个');
  assert.deepEqual(rules.shiftByDow, { 6: 'day' }, '越界星期与不存在的班次都应丢掉');
  assert.equal(rules.holidays.observeMakeup, false);
  assert.equal(rules.reminders.length, 1, '非法 on 的提醒应被丢掉');
  assert.equal(rules.reminders[0].alarmsMin.length, 2, 'VALARM 应截到 2 条');
  assert.equal(rules.额外字段, undefined);
});

test('adoptRules 对缺失的起算周会报出来，而不是默默用今天', () => {
  const { rules, problems } = P.adoptRules({
    pattern: { kind: 'alternating', anchorIsBig: true },
    shifts: [{ id: 'day', name: '白班', start: '09:00', end: '18:00' }],
    holidays: {},
  }, { today: TODAY });
  assert.ok(problems.some((p) => p.includes('起算周')), problems.join('|'));
  assert.equal(rules.pattern.anchorMonday, E.mondayOf(TODAY));
});

test('adoptRules 收编循环班型时把未知班次归成休', () => {
  const { rules } = P.adoptRules({
    pattern: { kind: 'cycle', cycle: { anchor: '2026-09-07', slots: ['day', '未知', 'off', 'day'] } },
    shifts: [{ id: 'day', name: '白班', start: '08:00', end: '20:00' }],
    holidays: {},
  }, { today: TODAY });
  assert.deepEqual(rules.pattern.cycle.slots, ['day', 'off', 'off', 'day']);
});

test('buildPrompt 带上今天、Schema 和硬要求', () => {
  const p = P.buildPrompt('大小周', { today: TODAY });
  assert.ok(p.includes(TODAY));
  assert.ok(p.includes('anchorMonday'));
  assert.ok(p.includes('uncertainties'));
  assert.ok(p.includes('大小周'));
});

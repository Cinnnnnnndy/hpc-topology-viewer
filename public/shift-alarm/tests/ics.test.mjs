/* .ics 导出的不变量测试。
 *
 * 这里的每一条都对应一个「Apple 会静默出错」的已知坑——静默是关键词：
 * 日历不会报错，只会在某个放假的早晨照常把你叫醒，或者在补班那天一声不吭。
 * 所以这些不变量必须被钉死，而不是靠人眼复查生成结果。
 *
 * 跨实现的等价性复核（用 python icalendar + dateutil 展开 RRULE 再逐条比对）
 * 在 tests/verify_ics.py，由 tests/run.sh 一起跑。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../engine.js';
import * as I from '../ics.js';
import * as P from '../parser.js';
import { CN_HOLIDAYS } from '../holidays-data.js';

const H = { off: CN_HOLIDAYS['2026'].off, work: CN_HOLIDAYS['2026'].work, names: CN_HOLIDAYS['2026'].names };
const NOW = 1756800000000;

function bigSmallWeek() {
  const r = E.emptyRules();
  r.shifts = [{ id: 'day', name: '白班', start: '09:00', end: '18:00' },
              { id: 'sat', name: '周六班', start: '10:00', end: '16:00' }];
  r.shiftByDow = { 6: 'sat' };
  r.pattern = { ...r.pattern, kind: 'alternating', parity: 'anchor',
    anchorMonday: '2026-09-07', anchorIsBig: true, baseWorkdays: [1, 2, 3, 4, 5], bigWeekExtra: [6] };
  r.reminders = [{ id: 'punch', on: 'workday', when: { anchor: 'shiftStart', offsetMin: -15 },
    title: '打卡 · {班次}', alarmsMin: [0] }];
  return r;
}

function build(r, from = '2026-09-03', to = '2027-09-02', opts = {}) {
  const s = E.expandSchedule(r, from, to, H);
  const occ = E.expandReminders(r, s);
  return { occ, out: I.buildICS(occ, { mode: 'recurring', nowMs: NOW, ...opts }) };
}

test('大小周落成「每周一至五 + 隔周周六」，而不是一堆单条', () => {
  const { out } = build(bigSmallWeek());
  const rrules = out.text.split('\r\n').filter((l) => l.startsWith('RRULE:'));
  assert.ok(rrules.some((l) => l.includes('INTERVAL=1') && l.includes('BYDAY=MO,TU,WE,TH,FR')), rrules.join('|'));
  assert.ok(rrules.some((l) => l.includes('INTERVAL=2') && l.includes('BYDAY=SA')), rrules.join('|'));
  assert.ok(out.stats.events <= 5, `事件数应压到个位数，实际 ${out.stats.events}`);
});

test('绝不生成 RDATE —— Apple 会静默丢弃它，补班那天就一声不吭', () => {
  for (const r of [bigSmallWeek(), E.emptyRules()]) {
    const { out } = build(r);
    assert.ok(!/^RDATE/m.test(out.text), '出现了 RDATE');
  }
});

test('INTERVAL=2 只跟单个 BYDAY 搭配 —— 多个星期几会被 WKST 拆进相邻双周', () => {
  const r = bigSmallWeek();
  r.pattern.bigWeekExtra = [6, 7];            // 大周连周六周日一起上
  r.shiftByDow = {};
  const { out } = build(r);
  for (const line of out.text.split('\r\n').filter((l) => l.startsWith('RRULE:'))) {
    if (line.includes('FREQ=WEEKLY') && line.includes('INTERVAL=2')) {
      const byday = /BYDAY=([A-Z,]+)/.exec(line)[1];
      assert.equal(byday.split(',').length, 1, `INTERVAL=2 配了多个 BYDAY: ${line}`);
    }
  }
});

test('EXDATE 是 DATE-TIME、时刻与 DTSTART 完全一致、TZID 一致', () => {
  const { out } = build(bigSmallWeek());
  const lines = out.text.split('\r\n');
  const times = new Map();       // series 序号 -> DTSTART 的 HHMMSS
  let cur = null;
  for (const l of lines) {
    if (l.startsWith('DTSTART;TZID=Asia/Shanghai:')) cur = l.slice(-6);
    if (l.startsWith('EXDATE')) {
      assert.ok(l.startsWith('EXDATE;TZID=Asia/Shanghai:'), `EXDATE 的 TZID 不对: ${l}`);
      assert.ok(!l.includes('VALUE=DATE'), 'EXDATE 用了纯日期，Apple 会整条忽略');
      for (const v of l.split(':')[1].split(',')) {
        assert.match(v, /^\d{8}T\d{6}$/, `EXDATE 不是 DATE-TIME: ${v}`);
        assert.equal(v.slice(-6), cur, `EXDATE 时刻与 DTSTART 不一致: ${v} vs ${cur}`);
        assert.ok(!v.endsWith('Z'), 'EXDATE 混用了 UTC');
      }
      times.set(cur, true);
    }
  }
  assert.ok(times.size > 0, '这个用例本该产生 EXDATE');
});

test('EXDATE 每行都不触发折行（折行是各家解析器的重灾区）', () => {
  const { out } = build(bigSmallWeek());
  for (const l of out.text.split('\r\n')) {
    if (l.startsWith('EXDATE')) {
      assert.ok(Buffer.byteLength(l, 'utf8') <= 75, `EXDATE 行 ${Buffer.byteLength(l)} 字节，会被折行`);
    }
  }
});

test('每行 ≤ 75 八位组，且折行不劈开中文', () => {
  const r = bigSmallWeek();
  r.reminders[0].title = '打卡提醒 · 这是一段很长的中文标题用来把行撑爆掉看看折行是不是按字节算的 · {班次}';
  const { out } = build(r);
  for (const l of out.text.split('\r\n')) {
    assert.ok(Buffer.byteLength(l, 'utf8') <= 75, `行超长 ${Buffer.byteLength(l)}: ${l}`);
  }
  // 去掉折行标记后能还原出完整标题，说明没把多字节字符劈开
  const unfolded = out.text.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('这是一段很长的中文标题用来把行撑爆掉看看折行是不是按字节算的'));
});

test('VALARM 最多两条 —— iOS 事件界面只暴露两个提醒位', () => {
  const r = bigSmallWeek();
  r.reminders[0].alarmsMin = [0, -10, -30, -60];
  const { out } = build(r);
  for (const block of out.text.split('BEGIN:VEVENT').slice(1)) {
    const n = (block.match(/BEGIN:VALARM/g) || []).length;
    assert.ok(n <= I.MAX_ALARMS, `一个事件里有 ${n} 条 VALARM`);
  }
});

test('只用 ACTION:DISPLAY —— ACTION:AUDIO 的自定义铃声 Apple 不认', () => {
  const { out } = build(bigSmallWeek());
  assert.ok(out.text.includes('ACTION:DISPLAY'));
  assert.ok(!out.text.includes('ACTION:AUDIO'));
});

test('VTIMEZONE 只有一个 STANDARD、没有 DAYLIGHT，且是 Olson 名', () => {
  const { out } = build(bigSmallWeek());
  assert.ok(out.text.includes('TZID:Asia/Shanghai'));
  assert.ok(!out.text.includes('BEGIN:DAYLIGHT'), '多余的 DAYLIGHT 会让某些解析器凭空造出切换');
  assert.equal((out.text.match(/BEGIN:STANDARD/g) || []).length, 1);
  assert.ok(!/China Standard Time/.test(out.text), '必须用 Olson 名，不能用 Windows 时区名');
});

test('UID 稳定：同样的规则导两次，UID 逐个相同（重导是更新而不是加倍）', () => {
  const a = build(bigSmallWeek(), '2026-09-03', '2027-09-02', { nowMs: 1 });
  const b = build(bigSmallWeek(), '2026-09-03', '2027-09-02', { nowMs: 999999999 });
  const uids = (t) => t.split('\r\n').filter((l) => l.startsWith('UID:'));
  assert.deepEqual(uids(a.out.text), uids(b.out.text));
  assert.ok(uids(a.out.text).length > 0);
});

test('UID 在同一份文件里不重复', () => {
  const { out } = build(bigSmallWeek());
  const uids = out.text.split('\r\n').filter((l) => l.startsWith('UID:'));
  assert.equal(new Set(uids).size, uids.length);
});

test('文本转义：分号、逗号、反斜杠、换行都按 RFC 5545 处理', () => {
  assert.equal(I.escapeText('a;b,c\\d\ne'), 'a\\;b\\,c\\\\d\\ne');
  const r = E.emptyRules();
  r.reminders = [{ id: 'x', on: 'workday', when: { anchor: 'fixed', time: '08:00' },
    title: '打卡;别忘了,路径 C:\\work', alarmsMin: [0] }];
  const { out } = build(r, '2026-09-03', '2026-10-03');
  assert.ok(out.text.includes('SUMMARY:打卡\\;别忘了\\,路径 C:\\\\work'));
});

test('recurring 与 expanded 生成的实例集合完全一致', () => {
  const r = bigSmallWeek();
  const s = E.expandSchedule(r, '2026-09-03', '2027-09-02', H);
  const occ = E.expandReminders(r, s);
  const rec = I.buildICS(occ, { mode: 'recurring', nowMs: NOW });
  const exp = I.buildICS(occ, { mode: 'expanded', nowMs: NOW });
  assert.equal(rec.warnings.length, 0, rec.warnings.join('|'));
  assert.equal(exp.stats.events, occ.length);
  assert.ok(rec.stats.events < exp.stats.events);
});

test('重复规则的 UNTIL 与 DTSTART 同一时刻', () => {
  const { out } = build(bigSmallWeek());
  const lines = out.text.replace(/\r\n /g, '').split('\r\n');   // 先反折行
  let cur = null;
  for (const l of lines) {
    if (l.startsWith('DTSTART;TZID=Asia/Shanghai:')) cur = l.slice(-6);
    if (l.startsWith('RRULE:')) {
      const until = /UNTIL=(\d{8}T\d{6})/.exec(l);
      assert.ok(until, l);
      assert.equal(until[1].slice(-6), cur, `UNTIL 时刻与 DTSTART 不一致: ${l}`);
    }
  }
});

test('RRULE 与 DTSTART 都不触发折行', () => {
  const { out } = build(bigSmallWeek());
  for (const l of out.text.split('\r\n')) {
    if (l.startsWith('RRULE:') || l.startsWith('DTSTART')) {
      assert.ok(Buffer.byteLength(l, 'utf8') <= 75, `${l} = ${Buffer.byteLength(l)} 字节，会被折行`);
    }
  }
  assert.ok(!out.text.includes('WKST'), 'WKST 在我们的两种形态里可证明无用，不该出现');
});

test('DTSTART 一定落在 BYDAY 点名的星期几上（否则双周规则由 WKST 说了算）', () => {
  const r = bigSmallWeek();
  const { out } = build(r);
  const M = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };
  const lines = out.text.replace(/\r\n /g, '').split('\r\n');
  let cur = null;
  for (const l of lines) {
    if (l.startsWith('DTSTART;TZID=Asia/Shanghai:')) {
      const v = l.split(':')[1];
      cur = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
    }
    if (l.startsWith('RRULE:') && l.includes('FREQ=WEEKLY')) {
      const days = /BYDAY=([A-Z,]+)/.exec(l)[1].split(',').map((d) => M[d]);
      assert.ok(days.includes(E.dowOf(cur)), `DTSTART ${cur} 不在 BYDAY ${days} 里`);
    }
  }
});

test('班表全天日历：每天一条，含调休原因', () => {
  const r = bigSmallWeek();
  const s = E.expandSchedule(r, '2026-09-14', '2026-09-27', H);
  const out = I.buildScheduleICS(s, { nowMs: NOW });
  assert.ok(out.text.includes('DTSTART;VALUE=DATE:20260920'));      // 补班的周日
  assert.ok(out.text.includes('调休补班'));
  assert.equal(out.stats.events, s.days.filter((d) => d.isWork).length);
});

test('滚动循环用 FREQ=DAILY;INTERVAL=L 压缩，而不是一年一千多条单事件', () => {
  const r = E.emptyRules();
  r.shifts = [{ id: 'day', name: '白班', start: '08:00', end: '20:00' },
              { id: 'night', name: '夜班', start: '20:00', end: '08:00' }];
  // 两班倒：白白夜夜休休，6 天一轮——和 7 天的星期永远对不齐
  r.pattern = { ...r.pattern, kind: 'cycle',
    cycle: { anchor: '2026-09-07', slots: ['day', 'day', 'night', 'night', 'off', 'off'] } };
  r.reminders = [{ id: 'wake', on: 'workday', when: { anchor: 'shiftStart', offsetMin: -60 },
    title: '上班 · {班次}', alarmsMin: [0] }];
  const s = E.expandSchedule(r, '2026-09-03', '2027-09-02', H);
  const occ = E.expandReminders(r, s);
  const out = I.buildICS(occ, { mode: 'recurring', nowMs: NOW });

  assert.ok(occ.length > 200, `样本太小: ${occ.length}`);
  assert.ok(out.stats.events <= 12,
    `6 天一轮最多该压到十来条，实际 ${out.stats.events} 条`);
  assert.ok(out.text.includes('FREQ=DAILY;INTERVAL='), '应当用上 DAILY 间隔规则');
  assert.equal(out.warnings.length, 0, out.warnings.join('|'));

  // DAILY 规则同样不能触发折行
  for (const l of out.text.split('\r\n')) {
    if (l.startsWith('RRULE:')) assert.ok(Buffer.byteLength(l, 'utf8') <= 75, l);
  }
});

test('DAILY 压缩后的展开结果与逐日展开完全一致', () => {
  const r = E.emptyRules();
  r.pattern = { ...r.pattern, kind: 'cycle',
    cycle: { anchor: '2026-09-07', slots: ['day', 'day', 'day', 'day', 'off', 'off', 'off', 'off'] } };
  r.reminders = [{ id: 'w', on: 'workday', when: { anchor: 'shiftStart', offsetMin: 0 },
    title: '上班', alarmsMin: [0] }];
  const s = E.expandSchedule(r, '2026-09-03', '2027-09-02', H);
  const occ = E.expandReminders(r, s);
  const rec = I.buildICS(occ, { mode: 'recurring', nowMs: NOW });
  const exp = I.buildICS(occ, { mode: 'expanded', nowMs: NOW });
  assert.ok(rec.stats.events < exp.stats.events / 10);
  assert.equal(exp.stats.events, occ.length);
});

test('默认那套提醒整体压缩到十几条 —— 逐天变的文案会让重复规则碎掉', () => {
  // 这条是端到端的压缩体检。它盯的是一类很隐蔽的退化：
  // 提醒文案里只要放了 {原因} 这种逐天不同的占位符，导出时按「时刻＋文案」
  // 分组就会把一条规则碎成十几条，用户日历里凭空多出一堆条目。
  // 数字本身不重要，数量级重要。
  const { rules } = P.parseWorkRules('大小周，早九晚六，这周要上周六', { today: '2026-09-03' });
  const s = E.expandSchedule(rules, '2026-09-03', '2027-09-02', H);
  const occ = E.expandReminders(rules, s);
  const out = I.buildICS(occ, { mode: 'recurring', nowMs: NOW });
  assert.ok(occ.length > 1000, `样本太小: ${occ.length}`);
  assert.ok(out.stats.events <= 24,
    `一整年 5 条提醒该压到二十来条，实际 ${out.stats.events} 条——` +
    '多半是某条提醒的标题或备注里混进了逐天变化的占位符');
});

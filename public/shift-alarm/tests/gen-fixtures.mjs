/* 生成一组 .ics 固件 + 期望日期集合，交给 tests/verify_ics.py 用独立的
 * RFC 5545 解析器（python icalendar + dateutil.rrule）逐条复核。
 * 自己写的 .ics 用自己写的解析器去验，等于没验——所以这一步必须换实现。
 *
 * 用法：node tests/gen-fixtures.mjs <输出目录>
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import * as E from '../engine.js';
import * as I from '../ics.js';
import { CN_HOLIDAYS } from '../holidays-data.js';

const outDir = process.argv[2] || './fixtures';
mkdirSync(outDir, { recursive: true });

const H = (y) => ({ off: CN_HOLIDAYS[y].off, work: CN_HOLIDAYS[y].work, names: CN_HOLIDAYS[y].names });
const H26 = H('2026');
const NOW = 1756800000000;   // 固定时间戳，输出可重现

function rules(mut) {
  const r = E.emptyRules();
  mut(r);
  return r;
}

const CASES = [
  {
    id: 'weekly-双休',
    rules: rules((r) => {
      r.reminders = [{ id: 'wake', on: 'workday', when: { anchor: 'shiftStart', offsetMin: -90 },
        title: '起床', alarmsMin: [0] }];
    }),
    from: '2026-09-03', to: '2027-09-02',
  },
  {
    id: 'alternating-大小周',
    rules: rules((r) => {
      r.pattern = { ...r.pattern, kind: 'alternating', parity: 'anchor',
        anchorMonday: '2026-09-07', anchorIsBig: true, baseWorkdays: [1, 2, 3, 4, 5], bigWeekExtra: [6] };
      r.reminders = [{ id: 'wake', on: 'workday', when: { anchor: 'shiftStart', offsetMin: -90 },
        title: '起床 · {星期}', alarmsMin: [0] }];
    }),
    from: '2026-09-03', to: '2027-09-02',
  },
  {
    id: 'alternating-周六单独班次',
    rules: rules((r) => {
      r.shifts = [{ id: 'day', name: '白班', start: '09:00', end: '18:00' },
                  { id: 'sat', name: '周六班', start: '10:00', end: '16:00' }];
      r.shiftByDow = { 6: 'sat' };
      r.pattern = { ...r.pattern, kind: 'alternating', parity: 'anchor',
        anchorMonday: '2026-09-07', anchorIsBig: true, baseWorkdays: [1, 2, 3, 4, 5], bigWeekExtra: [6] };
      r.reminders = [{ id: 'punch', on: 'workday', when: { anchor: 'shiftStart', offsetMin: -15 },
        title: '打卡 · {班次}', alarmsMin: [0] }];
    }),
    from: '2026-09-03', to: '2027-09-02',
  },
  {
    id: 'cycle-做四休三',
    rules: rules((r) => {
      r.pattern = { ...r.pattern, kind: 'cycle',
        cycle: { anchor: '2026-09-07', slots: ['day', 'day', 'day', 'day', 'off', 'off', 'off'] } };
      r.reminders = [{ id: 'wake', on: 'workday', when: { anchor: 'shiftStart', offsetMin: -60 },
        title: '上班', alarmsMin: [0] }];
    }),
    from: '2026-09-03', to: '2027-09-02',
  },
  {
    id: 'night-三班倒跨日',
    rules: rules((r) => {
      r.shifts = [{ id: 'morning', name: '早班', start: '07:00', end: '15:00' },
                  { id: 'night', name: '夜班', start: '23:00', end: '07:00' }];
      r.pattern = { ...r.pattern, kind: 'cycle',
        cycle: { anchor: '2026-09-07', slots: ['morning', 'morning', 'night', 'night', 'off', 'off'] } };
      r.reminders = [{ id: 'off', on: 'workday', when: { anchor: 'shiftEnd', offsetMin: 0 },
        title: '下班打卡 · {班次}', alarmsMin: [0] }];
    }),
    from: '2026-09-03', to: '2027-09-02',
  },
  {
    id: 'eve-前一晚提醒',
    rules: rules((r) => {
      r.pattern = { ...r.pattern, kind: 'alternating', parity: 'anchor',
        anchorMonday: '2026-09-07', anchorIsBig: true, baseWorkdays: [1, 2, 3, 4, 5], bigWeekExtra: [6] };
      r.reminders = [{ id: 'sleep', on: 'eve-of-work', when: { anchor: 'next-shiftStart', offsetMin: -630 },
        title: '早点睡，明天{明日上班}上班', note: '{原因}', alarmsMin: [0, -30] }];
    }),
    from: '2026-09-03', to: '2027-09-02',
  },
  {
    id: 'escape-特殊字符',
    rules: rules((r) => {
      r.reminders = [{ id: 'x', on: 'workday', when: { anchor: 'fixed', time: '08:00' },
        title: '打卡；别忘了，路径 C:\\\\work 与换行', note: '第一行\n第二行；含逗号，和反斜杠\\\\',
        alarmsMin: [0] }];
    }),
    from: '2026-09-03', to: '2026-12-31',
  },
];

const manifest = [];
for (const c of CASES) {
  const sched = E.expandSchedule(c.rules, c.from, c.to, H26);
  const occ = E.expandReminders(c.rules, sched);
  for (const mode of ['recurring', 'expanded']) {
    const out = I.buildICS(occ, { mode, nowMs: NOW, calendarName: c.id });
    const file = `${c.id}.${mode}.ics`;
    writeFileSync(`${outDir}/${file}`, out.text, 'utf8');
    manifest.push({
      id: c.id, mode, file, stats: out.stats, warnings: out.warnings,
      // 期望：每条提醒实例的 本地日期+时刻，排序后的列表
      expected: occ.map((o) => `${o.date} ${o.time}`).sort(),
      titles: [...new Set(occ.map((o) => o.title))],
    });
  }
}
writeFileSync(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 1), 'utf8');
console.log(`wrote ${manifest.length} fixtures to ${outDir}`);
for (const m of manifest) {
  console.log(` ${m.mode.padEnd(9)} ${m.id.padEnd(28)} occ=${String(m.expected.length).padStart(4)} ` +
    `events=${String(m.stats.events).padStart(4)} series=${m.stats.series} ` +
    (m.warnings.length ? 'WARN:' + m.warnings.join('/') : ''));
}

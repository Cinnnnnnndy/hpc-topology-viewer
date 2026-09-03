/*
 * 班表闹钟 · 规则引擎
 * ---------------------------------------------------------------------------
 * 把「一句话说得清、但 iPhone 设不出来」的上班规则，展开成一天一天的确定班表。
 *
 * 两条设计红线：
 *
 * 1) 全程不碰 Date 的时区。日期一律是「civil date」——'YYYY-MM-DD' 这串字符
 *    本身，以及它对应的儒略日序号（days-from-1970-01-01）。用 new Date('2026-03-07')
 *    会按 UTC 解析、再按本地时区显示，跨时区打开页面时整张表会整体错一天；
 *    这类 bug 在闹钟场景里是「周六白起来一次」，必须从根上避免。
 *    civil↔days 用 Howard Hinnant 那对无分支算法，全整数、无浮点误差。
 *
 * 2) 优先级是显式的、可解释的。每一天最终 isWork 由五层依次覆盖，
 *    并且把「是谁改的」记在 reason / trace 上——用户看得见「这天为什么要上班」，
 *    才敢把闹钟交给它。
 *
 * 本文件是纯函数模块，无 DOM、无依赖，浏览器与 node 通用（tests/ 直接 import 它）。
 */

export const SCHEMA_VERSION = 1;

/* ═══════════════════ civil date 基础设施 ═══════════════════ */

/** 'YYYY-MM-DD' → 距 1970-01-01 的天数（可为负） */
export function toDays(iso) {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
  return civilToDays(y, m, d);
}

export function civilToDays(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400;                                   // [0, 399]
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** 天数 → 'YYYY-MM-DD' */
export function toISO(z) {
  const [y, m, d] = daysToCivil(z);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function daysToCivil(z) {
  z += 719468;
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  const doe = z - era * 146097;                                // [0, 146096]
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365
  );                                                           // [0, 399]
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return [y + (m <= 2 ? 1 : 0), m, d];
}

/** ISO 星期：1=周一 … 7=周日。1970-01-01 是周四，用它校准。 */
export function isoDow(z) {
  return ((((z % 7) + 7) % 7) + 3) % 7 + 1;
}

export function dowOf(iso) { return isoDow(toDays(iso)); }
export function addDays(iso, n) { return toISO(toDays(iso) + n); }

/** 该日期所在 ISO 周的周一 */
export function mondayOf(iso) {
  const z = toDays(iso);
  return toISO(z - (isoDow(z) - 1));
}

/** ISO 周号（大小周按「单双周」判定时要用，规则同 ISO-8601：含该年第一个周四的那周是第 1 周） */
export function isoWeekNumber(iso) {
  const z = toDays(iso);
  const thursday = z + (4 - isoDow(z));            // 本周的周四
  const [y] = daysToCivil(thursday);
  const jan1 = civilToDays(y, 1, 1);
  return Math.floor((thursday - jan1) / 7) + 1;
}

export const DOW_LABEL = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/* ═══════════════════ 时刻工具 ═══════════════════ */

/** 'HH:MM' → 当天起的分钟数 */
export function toMinutes(hhmm) {
  return (+hhmm.slice(0, 2)) * 60 + (+hhmm.slice(3, 5));
}

/** 分钟数 → { date, time }，自动处理跨日（夜班下班在次日、闹钟提前到前一晚） */
export function resolveClock(dateISO, minutes) {
  let z = toDays(dateISO);
  let m = minutes;
  while (m < 0) { m += 1440; z -= 1; }
  while (m >= 1440) { m -= 1440; z += 1; }
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return { date: toISO(z), time: `${hh}:${mm}`, minutes: m };
}

/* ═══════════════════ 默认规则 ═══════════════════ */

export const DEFAULT_SHIFTS = [
  { id: 'day', name: '白班', start: '09:00', end: '18:00' },
];

export function emptyRules() {
  return {
    version: SCHEMA_VERSION,
    name: '我的班表',
    timezone: 'Asia/Shanghai',
    pattern: {
      kind: 'weekly',
      workdays: [1, 2, 3, 4, 5],
      // alternating（大小周）用的字段
      baseWorkdays: [1, 2, 3, 4, 5],
      bigWeekExtra: [6],
      parity: 'anchor',            // 'anchor' | 'iso-odd' | 'iso-even'
      anchorMonday: null,          // 该周是「大周」（上班多的那周）
      // cycle（做N休M / 轮班）用的字段
      cycle: { anchor: null, slots: [] },
    },
    shifts: DEFAULT_SHIFTS.map((s) => ({ ...s })),
    defaultShift: 'day',
    shiftByDow: {},                // { '6': 'short' } —— 周六走另一个班次
    holidays: {
      source: 'cn-statutory',
      observeOff: true,            // 法定放假日不上班
      observeMakeup: true,         // 调休补班日要上班（哪怕是周六周日）
      makeupShift: null,           // 补班走哪个班次，null = 沿用当天默认
    },
    overrides: { work: {}, off: [] },
    leaves: [],                    // [{ start, end, name }]
    reminders: [],
    horizon: { from: null, months: 12 },
  };
}

/* ═══════════════════ 班次解析 ═══════════════════ */

function shiftById(rules, id) {
  return rules.shifts.find((s) => s.id === id) || rules.shifts[0] || DEFAULT_SHIFTS[0];
}

function pickShift(rules, dateISO, dow, slotShiftId) {
  if (slotShiftId) return shiftById(rules, slotShiftId);
  const byDow = rules.shiftByDow && rules.shiftByDow[String(dow)];
  if (byDow) return shiftById(rules, byDow);
  return shiftById(rules, rules.defaultShift);
}

/* ═══════════════════ 第 1 层：基础班型 ═══════════════════ */

/**
 * 返回 { work: boolean, shiftId: string|null, note: string }
 * 只看班型本身，不含节假日与个人覆盖。
 */
function basePattern(rules, dateISO) {
  const p = rules.pattern || {};
  const z = toDays(dateISO);
  const dow = isoDow(z);

  if (p.kind === 'cycle') {
    const slots = (p.cycle && p.cycle.slots) || [];
    if (!slots.length || !p.cycle.anchor) return { work: false, shiftId: null, note: '循环班型未配置' };
    const span = toDays(dateISO) - toDays(p.cycle.anchor);
    const idx = ((span % slots.length) + slots.length) % slots.length;
    const slot = slots[idx];
    if (!slot || slot === 'off' || slot.shift === 'off') {
      return { work: false, shiftId: null, note: `循环第 ${idx + 1}/${slots.length} 天 · 休` };
    }
    const shiftId = typeof slot === 'string' ? slot : slot.shift;
    return { work: true, shiftId, note: `循环第 ${idx + 1}/${slots.length} 天` };
  }

  if (p.kind === 'alternating') {
    const base = p.baseWorkdays || [1, 2, 3, 4, 5];
    const extra = p.bigWeekExtra || [6];
    const big = isBigWeek(p, dateISO);
    if (base.includes(dow)) {
      return { work: true, shiftId: null, note: big ? '大周 · 常规工作日' : '小周 · 常规工作日' };
    }
    if (big && extra.includes(dow)) {
      return { work: true, shiftId: null, note: `大周 · 加上的${DOW_LABEL[dow]}` };
    }
    return { work: false, shiftId: null, note: big ? '大周 · 休' : '小周 · 休' };
  }

  // 默认：固定周班型
  const wd = p.workdays || [1, 2, 3, 4, 5];
  return wd.includes(dow)
    ? { work: true, shiftId: null, note: '常规工作日' }
    : { work: false, shiftId: null, note: '常规休息日' };
}

/**
 * 这一周是不是「大周」。
 * 两套判定都支持，因为现实里两种说法都有人用：
 *  · anchor  —— 指着某一周说「这周是大周」，之后按自然周严格交替（最常见，也最不会歧义）
 *  · iso-odd / iso-even —— 按 ISO 周号单双。跨年时 ISO 周号会从 52/53 跳回 1，
 *    可能出现连着两周同奇偶（即连着两个大周），这是该口径本身的性质，不是 bug；
 *    UI 上要把这一点讲明白，anchor 口径没有这个问题。
 */
export function isBigWeek(pattern, dateISO) {
  if (pattern.parity === 'iso-odd') return isoWeekNumber(dateISO) % 2 === 1;
  if (pattern.parity === 'iso-even') return isoWeekNumber(dateISO) % 2 === 0;
  const anchor = pattern.anchorMonday;
  if (!anchor) return false;
  const weeks = Math.floor((toDays(mondayOf(dateISO)) - toDays(mondayOf(anchor))) / 7);
  const even = ((weeks % 2) + 2) % 2 === 0;
  return pattern.anchorIsBig === false ? !even : even;
}

/* ═══════════════════ 展开成班表 ═══════════════════ */

/**
 * @param rules    规则对象
 * @param fromISO  起（含）
 * @param toISO_   止（含）
 * @param holidays { off: Set|Array, work: Set|Array, names: {date:name} } —— 法定节假日数据
 * @returns { days: DayInfo[], byDate: Map, warnings: string[] }
 *
 * DayInfo = { date, dow, isWork, shift, holidayName, tags[], reason, trace[] }
 *   tags: 'holiday' | 'makeup' | 'leave' | 'override-work' | 'override-off' | 'bigweek-extra'
 */
export function expandSchedule(rules, fromISO, toISO_, holidays) {
  const hOff = toSet(holidays && holidays.off);
  const hWork = toSet(holidays && holidays.work);
  const hNames = (holidays && holidays.names) || {};
  const warnings = [];

  const z0 = toDays(fromISO), z1 = toDays(toISO_);
  if (z1 < z0) return { days: [], byDate: new Map(), warnings: ['结束日期早于开始日期'] };
  if (z1 - z0 > 366 * 6) warnings.push('展开范围超过 6 年，已按 6 年截断');

  const leaves = normalizeLeaves(rules.leaves);
  const ovWork = (rules.overrides && rules.overrides.work) || {};
  const ovOff = toSet((rules.overrides && rules.overrides.off) || []);

  const days = [];
  const byDate = new Map();
  const end = Math.min(z1, z0 + 366 * 6);

  for (let z = z0; z <= end; z++) {
    const date = toISO(z);
    const dow = isoDow(z);
    const trace = [];

    // 第 1 层：班型
    const base = basePattern(rules, date);
    let isWork = base.work;
    let slotShiftId = base.shiftId;
    let reason = base.note;
    const tags = [];
    if (isWork && rules.pattern.kind === 'alternating' && !(rules.pattern.baseWorkdays || [1, 2, 3, 4, 5]).includes(dow)) {
      tags.push('bigweek-extra');
    }
    trace.push(`班型：${base.note}`);

    // 第 2 层：法定放假
    const holidayName = hNames[date] || null;
    if (rules.holidays.observeOff && hOff.has(date)) {
      if (isWork) trace.push(`法定放假（${holidayName || '节假日'}）→ 改为休`);
      isWork = false;
      reason = `法定放假 · ${holidayName || '节假日'}`;
      tags.push('holiday');
    }

    // 第 3 层：调休补班。补班是「国务院把这天挪成工作日」，
    // 所以它能把周六周日、也能把本来该休的小周周六，翻成上班。
    if (rules.holidays.observeMakeup && hWork.has(date)) {
      if (!isWork) trace.push(`调休补班（${holidayName || ''}）→ 改为上班`);
      isWork = true;
      reason = `调休补班${holidayName ? ' · ' + holidayName : ''}`;
      tags.push('makeup');
      if (rules.holidays.makeupShift) slotShiftId = rules.holidays.makeupShift;
    }

    // 第 4 层：请假 / 年假
    const leave = leaves.find((L) => z >= L.z0 && z <= L.z1);
    if (leave) {
      if (isWork) trace.push(`${leave.name || '请假'} → 改为休`);
      isWork = false;
      reason = leave.name || '请假';
      tags.push('leave');
    }

    // 第 5 层：手动覆盖（最高优先级，用户说了算）
    if (ovOff.has(date)) {
      if (isWork) trace.push('手动标记为休');
      isWork = false; reason = '手动标记 · 休'; tags.push('override-off');
    } else if (ovWork[date]) {
      if (!isWork) trace.push('手动标记为上班');
      isWork = true; reason = '手动标记 · 上班'; tags.push('override-work');
      if (typeof ovWork[date] === 'string' && ovWork[date] !== 'default') slotShiftId = ovWork[date];
    }

    const shift = isWork ? pickShift(rules, date, dow, slotShiftId) : null;
    const info = { date, dow, isWork, shift, holidayName, tags, reason, trace };
    days.push(info);
    byDate.set(date, info);
  }

  // 补一条覆盖范围提醒：假日数据没盖到的年份，节假日一律按「没有」处理
  const coveredYears = new Set(Object.keys(hNames).map((d) => d.slice(0, 4)));
  const spanYears = new Set();
  for (let z = z0; z <= end; z += 28) spanYears.add(toISO(z).slice(0, 4));
  spanYears.add(toISO(end).slice(0, 4));
  const missing = [...spanYears].filter((y) => !coveredYears.has(y)).sort();
  if (missing.length && rules.holidays.source === 'cn-statutory') {
    warnings.push(`${missing.join('、')} 年的国家法定节假日安排尚未收录，这些年份只按班型推算（春节国庆不会自动放假）。`);
  }

  return { days, byDate, warnings };
}

function toSet(v) {
  if (!v) return new Set();
  return v instanceof Set ? v : new Set(v);
}

function normalizeLeaves(leaves) {
  return (leaves || []).map((L) => ({
    name: L.name, z0: toDays(L.start), z1: toDays(L.end || L.start),
  })).filter((L) => Number.isFinite(L.z0) && Number.isFinite(L.z1));
}

/* ═══════════════════ 提醒展开 ═══════════════════ */

export const REMINDER_SCOPES = {
  workday:        { label: '每个工作日',       test: (d) => d.isWork },
  restday:        { label: '每个休息日',       test: (d) => !d.isWork },
  'eve-of-work':  { label: '上班日的前一晚',   test: (d, next) => !!next && next.isWork },
  'eve-of-rest':  { label: '休息日的前一晚',   test: (d, next) => !!next && !next.isWork },
  makeup:         { label: '只在调休补班日',   test: (d) => d.tags.includes('makeup') },
  'bigweek-extra':{ label: '只在大周多上的那天', test: (d) => d.tags.includes('bigweek-extra') },
  'first-workday':{ label: '长假后第一个工作日', test: (d, next, prev) => d.isWork && !!prev && !prev.isWork },
  'last-workday': { label: '放假前最后一个工作日', test: (d, next) => d.isWork && !!next && !next.isWork },
};

/**
 * 把提醒规则展开成一条条「几月几号几点响」。
 * anchor：
 *   'shiftStart' / 'shiftEnd' —— 相对当天班次（offsetMin 可正可负，自动跨日）
 *   'fixed'                   —— 固定时刻 time
 *   'next-shiftStart'         —— 相对「第二天」的上班时刻（前一晚提醒专用）
 */
export function expandReminders(rules, schedule) {
  const out = [];
  const days = schedule.days;
  for (let i = 0; i < days.length; i++) {
    const day = days[i], next = days[i + 1] || null, prev = days[i - 1] || null;
    for (const r of rules.reminders || []) {
      if (r.enabled === false) continue;
      const scope = REMINDER_SCOPES[r.on];
      if (!scope || !scope.test(day, next, prev)) continue;

      let baseDate = day.date, baseMin;
      const w = r.when || {};
      if (w.anchor === 'fixed' || !w.anchor) {
        baseMin = toMinutes(w.time || '08:00');
      } else if (w.anchor === 'next-shiftStart') {
        if (!next || !next.shift) continue;
        baseMin = toMinutes(next.shift.start) + 1440;      // 落在「明天」，再由 offset 拉回今晚
      } else if (w.anchor === 'shiftEnd') {
        if (!day.shift) continue;
        let endMin = toMinutes(day.shift.end);
        if (endMin <= toMinutes(day.shift.start)) endMin += 1440;   // 夜班：下班在次日
        baseMin = endMin;
      } else {
        if (!day.shift) continue;
        baseMin = toMinutes(day.shift.start);
      }

      const at = resolveClock(baseDate, baseMin + (w.offsetMin || 0));
      out.push({
        reminderId: r.id,
        title: renderTemplate(r.title, day, next),
        note: renderTemplate(r.note || '', day, next),
        kind: r.kind || 'event',
        date: at.date,
        time: at.time,
        durationMin: r.durationMin || 0,
        alarmsMin: r.alarmsMin && r.alarmsMin.length ? r.alarmsMin : [0],
        sourceDay: day,
      });
    }
  }
  out.sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));
  return out;
}

function renderTemplate(tpl, day, next) {
  if (!tpl) return '';
  return tpl
    .replace(/\{班次\}/g, day.shift ? day.shift.name : '休')
    .replace(/\{上班\}/g, day.shift ? day.shift.start : '—')
    .replace(/\{下班\}/g, day.shift ? day.shift.end : '—')
    .replace(/\{明日上班\}/g, next && next.shift ? next.shift.start : '—')
    .replace(/\{明日班次\}/g, next && next.shift ? next.shift.name : '休')
    .replace(/\{原因\}/g, day.reason || '')
    .replace(/\{星期\}/g, DOW_LABEL[day.dow] || '');
}

/* ═══════════════════ 统计（给 UI 做体检用） ═══════════════════ */

export function summarize(schedule) {
  const byMonth = new Map();
  let work = 0, rest = 0, makeup = 0, holiday = 0, bigExtra = 0;
  for (const d of schedule.days) {
    const key = d.date.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, { month: key, work: 0, rest: 0, makeup: 0, hours: 0 });
    const m = byMonth.get(key);
    if (d.isWork) {
      work++; m.work++;
      if (d.shift) {
        let dur = toMinutes(d.shift.end) - toMinutes(d.shift.start);
        if (dur <= 0) dur += 1440;
        m.hours += dur / 60;
      }
    } else { rest++; m.rest++; }
    if (d.tags.includes('makeup')) { makeup++; m.makeup++; }
    if (d.tags.includes('holiday')) holiday++;
    if (d.tags.includes('bigweek-extra')) bigExtra++;
  }
  return { work, rest, makeup, holiday, bigExtra, months: [...byMonth.values()] };
}

/** 连上多少天没休 —— 大小周 + 调休叠加时最容易出现的「连上 9 天」，值得单独提示 */
export function longestStreak(schedule) {
  let best = 0, cur = 0, bestEnd = null, curStart = null;
  for (const d of schedule.days) {
    if (d.isWork) {
      if (cur === 0) curStart = d.date;
      cur++;
      if (cur > best) { best = cur; bestEnd = d.date; }
    } else cur = 0;
  }
  return { days: best, end: bestEnd, start: bestEnd ? addDays(bestEnd, -(best - 1)) : null };
}

/**
 * 列出所有「连上 ≥ n 天」的区间。大小周叠上调休之后，连上 7–9 天是常态，
 * 而这件事在 iPhone 上是完全看不见的——UI 拿这个做体检提示。
 * longestStreak 并列时取最早的一段；要看全部就用这个。
 */
export function streaksAtLeast(schedule, n = 6) {
  const out = [];
  let cur = 0, start = null;
  for (const d of schedule.days) {
    if (d.isWork) { if (!cur) start = d.date; cur++; }
    else { if (cur >= n) out.push({ start, end: addDays(d.date, -1), days: cur }); cur = 0; }
  }
  if (cur >= n) out.push({ start, end: schedule.days[schedule.days.length - 1].date, days: cur });
  return out;
}

/*
 * 班表闹钟 · iCalendar 导出
 * ---------------------------------------------------------------------------
 * 这是「直接导入苹果系统」里最靠得住的一条路：.ics 是 RFC 5545，
 * iOS 日历原生认，下载即可「添加全部」，不需要开发者账号、不需要 Mac、
 * 也不需要任何越权设置。
 *
 * 两种写法，UI 可切：
 *
 *  · expanded  —— 一天一个独立 VEVENT。绝不会被重复规则的解析差异坑到，
 *                 代价是事件条数多（一年三条提醒 ≈ 750 条）。
 *  · recurring —— 用 RRULE 表达主干（大小周就是 FREQ=WEEKLY;INTERVAL=2），
 *                 放假用 EXDATE 挖掉，补班等例外单独补成独立 VEVENT。
 *                 条数少，删起来「删除所有未来事件」一次搞定。
 *
 * recurring 不是「猜一个规则出来」——它是从**已经算好的日期集合**反推：
 * 先按 BYDAY/INTERVAL 展开一遍，再比差集，多出来的进 EXDATE、少掉的补成单条。
 * 于是 展开(RRULE) − EXDATE + 例外 ≡ 引擎算出的集合 是构造出来的恒等式，
 * 不依赖 Apple 怎么理解 RRULE 的边角语义。buildICS 里还会再断言一次，
 * 万一不等就整组退回逐日展开，并把这件事写进 warnings 让用户看见。
 */

import { toDays, toISO, isoDow, addDays, toMinutes } from './engine.js';

const CRLF = '\r\n';

/** iOS 事件编辑界面只暴露两个提醒栏位，多的照响但看不见、删不掉 */
export const MAX_ALARMS = 2;

/* ── 文本转义与折行 ───────────────────────────────────────────── */

export function escapeText(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\n|\r/g, '\\n');
}

/**
 * RFC 5545 要求每行不超过 75 个八位组。中文一个字 3 字节：
 * 按字符数折会超长，按字节数硬折会把一个 UTF-8 序列劈成两半变乱码——
 * 所以按「码点的字节宽度」累加，永远在字符边界断开。
 */
export function foldLine(line) {
  const bytesOf = (ch) => {
    const c = ch.codePointAt(0);
    return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  };
  let out = '', cur = '', width = 0;
  for (const ch of Array.from(line)) {
    const w = bytesOf(ch);
    if (width + w > 75) {
      out += cur + CRLF + ' ';
      cur = ''; width = 1;              // 续行的前导空格自己算 1 个八位组
    }
    cur += ch; width += w;
  }
  return out + cur;
}

/* ── 时间格式 ─────────────────────────────────────────────────── */

const stamp = (dateISO, hhmm) => dateISO.replace(/-/g, '') + 'T' + hhmm.replace(':', '') + '00';

/** DTSTAMP 用 UTC。nowMs 由调用方传入，便于测试可重现。 */
function utcStamp(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T` +
         `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/**
 * Asia/Shanghai 的 VTIMEZONE。
 * 中国 1986–1991 实行过夏令时，1991-09-15 02:00 起永久 +0800、再未变过。
 * 所以一个 STANDARD 分量就够，并且把那次真实的 +0900→+0800 切换写进去，
 * 历史日期也不会算错。（不少生成器直接写 TZOFFSETFROM:+0800，
 * 对未来无害，但那是编的。）
 */
export const VTIMEZONE_SHANGHAI = [
  'BEGIN:VTIMEZONE',
  'TZID:Asia/Shanghai',
  'X-LIC-LOCATION:Asia/Shanghai',
  'BEGIN:STANDARD',
  'TZNAME:CST',
  'DTSTART:19910915T020000',
  'TZOFFSETFROM:+0900',
  'TZOFFSETTO:+0800',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/* ── UID：稳定、可重复导入 ───────────────────────────────────── */

/** FNV-1a 32 位。只用来做短标识，不是安全哈希。 */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * 同一条规则、同一个提醒、同一天 → 同一个 UID。
 * 意义：改完规则重新导入时，日历会**更新**已有事件而不是再加一份。
 * 所以 UID 里绝不能掺时间戳，否则每次导出都变成一批全新事件。
 */
function uidFor(calId, key) {
  return `${hash32(calId + '|' + key)}-${hash32(key)}@shift-alarm.local`;
}

/* ── RRULE 反推 ──────────────────────────────────────────────── */

const BYDAY = ['', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/** 展开 FREQ=WEEKLY;INTERVAL=n;WKST=MO;BYDAY=…（只覆盖我们自己会生成的形态） */
function expandWeekly(startISO, untilISO, interval, byDays) {
  const out = [];
  const z0 = toDays(startISO), z1 = toDays(untilISO);
  const anchorMon = z0 - (isoDow(z0) - 1);          // 锚周的周一，配合 WKST=MO
  for (let z = z0; z <= z1; z++) {
    const dow = isoDow(z);
    if (!byDays.includes(dow)) continue;
    const weeks = Math.floor((z - (dow - 1) - anchorMon) / 7);
    if (((weeks % interval) + interval) % interval !== 0) continue;
    out.push(toISO(z));
  }
  return out;
}

/** 展开 FREQ=DAILY;INTERVAL=n —— 就是 DTSTART + n·k，没有任何边角语义 */
function expandDaily(startISO, untilISO, interval) {
  const out = [];
  const z1 = toDays(untilISO);
  for (let z = toDays(startISO); z <= z1; z += interval) out.push(toISO(z));
  return out;
}

/**
 * 轮班用的一条 series：FREQ=DAILY;INTERVAL=L。
 *
 * 「上四休三」「白白夜夜休休」这类滚动循环压根不跟星期走，用 WEEKLY 一条都压不出来
 *（6 天一轮和 7 天一周只有 42 天才对齐一次），逐日展开就是一年一千多条事件。
 * 但换个角度：一个 L 天的循环里，第 i 个位置的日期恰好是 anchor+i 起、每 L 天一次——
 * 正好是 FREQ=DAILY;INTERVAL=L。于是 L 天的循环最多 L 条事件就能表达完。
 * DAILY+INTERVAL 是 RFC 5545 最基础的形态，不涉及 WKST / BYDAY 的任何歧义。
 */
function makeDailySeries(dates, untilISO, interval) {
  const covered = expandDaily(dates[0], untilISO, interval);
  if (!covered.length) return null;
  const set = new Set(dates);
  return {
    interval, covered, dtstart: covered[0],
    exdates: covered.filter((d) => !set.has(d)),
    rrulePrefix: `FREQ=DAILY;INTERVAL=${interval};UNTIL=`,
  };
}

/** 一条 series = 一个带 RRULE 的 VEVENT */
function makeSeries(dates, untilISO, interval, dows) {
  // 起点必须落在 BYDAY 里点名的某一天上。
  // Apple 的双周规则是从 DTSTART 起 +14n 数的：如果 DTSTART 那天不在 BYDAY 里，
  // 结果就改由 WKST 决定，而 WKST 的两种取值差整整一周——这是最隐蔽的一类错。
  // covered[0] 天然满足（它是展开结果里的第一天），这里再断言一次。
  const covered = expandWeekly(dates[0], untilISO, interval, dows);
  if (!covered.length) return null;
  if (!dows.includes(isoDow(toDays(covered[0])))) return null;
  const set = new Set(dates);
  return {
    interval, dows, covered,
    dtstart: covered[0],
    exdates: covered.filter((d) => !set.has(d)),
    // 不写 WKST：在我们生成的两种形态里它可证明是空操作
    // （INTERVAL=1 时 RFC 5545 规定 WKST 无效；INTERVAL=2 时我们只配单个 BYDAY
    // 且 DTSTART 就落在那天，等价于 DTSTART+14n）。
    // 而带上它会把这行撑到 79 字节、触发折行——折行恰恰是各家 .ics 解析器
    // 出错最多的地方。一个证明无用的参数，不值得拿最关键那一行去换。
    rrulePrefix: `FREQ=WEEKLY;INTERVAL=${interval};` +
                 `BYDAY=${dows.map((d) => BYDAY[d]).join(',')};UNTIL=`,
  };
}

/**
 * 给一组日期规划出「几条重复事件 + 几条例外单条」。
 *
 * 只用两种形态，因为只有这两种在 Apple 上是无歧义的：
 *  · INTERVAL=1 + 多个 BYDAY —— 每周都发生，WKST 取值不影响结果，安全。
 *  · INTERVAL=2 + **单个** BYDAY —— 等价于 DTSTART+14n，WKST 同样不影响。
 *
 * 明确不生成 INTERVAL=2 + 多个 BYDAY：那种写法下 WKST=SU 会把周六周日
 * 判进相邻的两个双周里（周六在这个双周、周日在下一个），而 Apple 的 EventKit
 * 序列化倾向于自己写 WKST=SU。大周同时上周六和周日的人会因此每隔一周被叫错一天。
 * 遇到这种情况就拆成每个星期几各一条 —— 多一条事件，换掉一整类静默错误。
 *
 * @returns { series[], extras[] } 或 null（不值得用重复规则，改逐日展开）
 */
export function derivePlan(dates, untilISO) {
  if (dates.length < 3) return null;
  const allDows = [...new Set(dates.map((d) => isoDow(toDays(d))))].sort((a, b) => a - b);

  const plans = [];

  // 方案 A：所有星期几合成一条每周规则，缺的挖 EXDATE、多的补单条
  const a = buildPlan(dates, untilISO, [{ interval: 1, dows: allDows }]);
  if (a) plans.push(a);

  // 方案 B：把「出现明显偏少」的星期几拆出来各走一条双周规则（大小周的形态）
  const counts = new Map();
  for (const d of dates) {
    const k = isoDow(toDays(d));
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const max = Math.max(...counts.values());
  const sparse = allDows.filter((d) => counts.get(d) <= max * 0.6);
  const dense = allDows.filter((d) => !sparse.includes(d));
  if (sparse.length && dense.length) {
    const specs = [{ interval: 1, dows: dense }];
    for (const d of sparse) specs.push({ interval: 2, dows: [d] });   // 单 BYDAY，见上文
    const b = buildPlan(dates, untilISO, specs);
    if (b) plans.push(b);
  }

  // 方案 C：每个星期几各一条，每条自己在「每周 / 隔周」之间按代价择优。
  // 这一支必须对**只有一个星期几**的组也生效：周六单独一个班次（和平日不同
  // 上班时间）时，它会被分到自己的组里，组里只剩周六——那正是最需要
  // INTERVAL=2 的场景。之前这里写的是 allDows.length > 1，于是隔周周六
  // 永远试不到双周规则，只能退回逐条展开（25 条独立事件）。
  const specsC = [];
  for (const d of allDows) {
    const own = dates.filter((x) => isoDow(toDays(x)) === d);
    let pick = null;
    for (const interval of [1, 2]) {
      const s = makeSeries(own, untilISO, interval, [d]);
      if (!s || s.exdates.length > s.covered.length * 0.5) continue;
      const c = 1 + s.exdates.length * EXDATE_WEIGHT;
      if (!pick || c < pick.c) pick = { c, interval };
    }
    if (pick) specsC.push({ interval: pick.interval, dows: [d] });
  }
  if (specsC.length === allDows.length) {
    const c = buildPlan(dates, untilISO, specsC);
    if (c) plans.push(c);
  }

  // 方案 D：只把「常规上班的那几天」写成规则，零星的日子（多半是调休补班）
  // 一律做成独立单条。这是人手写日历时最自然的那种写法。
  if (dense.length && dense.length < allDows.length) {
    const d2 = buildPlan(dates, untilISO, [{ interval: 1, dows: dense }]);
    if (d2) plans.push(d2);
  }

  // 方案 E：滚动循环（做N休M、两班倒、四班三倒）。这类日期集合跟星期完全无关，
  // 上面四个方案一条都压不出来。按「循环长度 L」把日期分成 L 个同余类，
  // 每类走一条 FREQ=DAILY;INTERVAL=L。L 未知就 2..31 全试一遍取最省的——
  // 每个 L 只是一次线性扫描，代价可以忽略。
  const baseZ = toDays(dates[0]);
  for (let L = 2; L <= 31; L++) {
    const specs = [];
    const seen = new Set();
    for (const d of dates) {
      const phase = ((toDays(d) - baseZ) % L + L) % L;
      if (!seen.has(phase)) { seen.add(phase); specs.push({ freq: 'DAILY', interval: L, phase, baseZ }); }
    }
    // 同余类比整份日期还多就没意义了（L 太大，等于逐日展开）
    if (specs.length >= dates.length) continue;
    const e = buildPlan(dates, untilISO, specs);
    if (e) plans.push(e);
  }

  if (!plans.length) return null;
  plans.sort((x, y) => x.cost - y.cost);
  const best = plans[0];
  return best.cost < dates.length ? best : null;    // 还不如逐日展开就不用
}

/**
 * EXDATE 的权重给得比较重（0.3），不是为了省字节，是为了**可信**：
 * 「每天都重复，但排除其中 108 天」在数学上没错，用户点开一看却是
 * 「怎么周末也有？」——一个自己都读不懂的规则，没人敢把闹钟交给它。
 * 权重调到这个量级后，双休会落成「周一至周五 + 6 条补班单条」，
 * 大小周会落成「周一至周五 + 隔周周六 + 几条补班单条」，
 * 正好是人手写日历时会写的那两种形状。
 */
const EXDATE_WEIGHT = 0.3;

function buildPlan(dates, untilISO, specs) {
  const want = new Set(dates);
  const series = [];
  const claimed = new Set();
  for (const spec of specs) {
    const own = spec.freq === 'DAILY'
      ? dates.filter((d) => ((toDays(d) - spec.baseZ) % spec.interval + spec.interval) % spec.interval === spec.phase)
      : dates.filter((d) => spec.dows.includes(isoDow(toDays(d))));
    if (!own.length) continue;
    const s = spec.freq === 'DAILY'
      ? makeDailySeries(own, untilISO, spec.interval)
      : makeSeries(own, untilISO, spec.interval, spec.dows);
    // 例外比正例还多的规则不是规则——「隔周周六重复，但其中 23 次不算」这种条目
    // 自相矛盾，用户点开只会更糊涂。但它不该连累整套方案：跳过这一条就行，
    // 它名下那几天没人认领，自然会掉进 extras 变成独立事件。
    //（一开始这里写的是 return null 整套作废，结果是：调休补班日落在轮班循环之外，
    // 凭空多出一个「几乎全是例外」的同余类，把本来最优的 8 天循环整个否掉，
    // 最后选了 20 条规则的烂方案。)
    if (!s || s.exdates.length > s.covered.length * 0.5) continue;
    series.push(s);
    for (const d of s.covered) if (!s.exdates.includes(d)) claimed.add(d);
  }
  if (!series.length) return null;
  const extras = dates.filter((d) => !claimed.has(d));
  // 重复规则不能覆盖到集合外的日期（覆盖到了说明 EXDATE 没挖干净）
  for (const d of claimed) if (!want.has(d)) return null;
  const exCount = series.reduce((n, s) => n + s.exdates.length, 0);
  return { series, extras, cost: series.length + extras.length + exCount * EXDATE_WEIGHT };
}

/* ── 主构建 ──────────────────────────────────────────────────── */

/**
 * @param occurrences engine.expandReminders 的输出
 * @param opts { calendarName, mode:'expanded'|'recurring', color, calId, nowMs }
 * @returns { text, stats:{events,series,singles}, warnings[] }
 */
export function buildICS(occurrences, opts = {}) {
  const {
    calendarName = '班表闹钟',
    mode = 'recurring',
    color = '#FF3B30',
    calId = 'shift-alarm',
    nowMs = 0,
  } = opts;
  const warnings = [];
  const dtstamp = utcStamp(nowMs);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//shift-alarm//班表闹钟//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    'X-WR-TIMEZONE:Asia/Shanghai',
    `X-APPLE-CALENDAR-COLOR:${color}`,
    ...VTIMEZONE_SHANGHAI,
  ];

  let events = 0, series = 0, singles = 0;

  // 按「提醒 + 时刻 + 时长 + 文案 + 响铃偏移」分组：
  // 一个 VEVENT 序列里所有实例必须同一时刻，白班夜班混着就得拆开。
  const groups = new Map();
  for (const o of occurrences) {
    const key = [o.reminderId, o.time, o.durationMin, o.title, o.note,
                 (o.alarmsMin || []).join('.')].join('');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }

  for (const list of groups.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const sample = list[0];
    const dates = list.map((o) => o.date);
    const untilISO = dates[dates.length - 1];

    let plan = null;
    if (mode === 'recurring') {
      plan = derivePlan(dates, untilISO);
      if (plan) {
        // 构造恒等式自检：所有 series 展开 − EXDATE + 例外，必须逐日等于原集合。
        // 这是最后一道闸：宁可退回逐日展开（一定对），也不发一份可能少响一天的日历。
        const got = new Set();
        for (const s of plan.series) {
          for (const d of s.covered) if (!s.exdates.includes(d)) got.add(d);
        }
        for (const d of plan.extras) got.add(d);
        const want = new Set(dates);
        if (got.size !== want.size || ![...want].every((d) => got.has(d))) {
          warnings.push(`「${sample.title}」的重复规则自检未通过，已改为逐日展开。`);
          plan = null;
        }
      }
    }

    if (plan) {
      series += plan.series.length;
      events += plan.series.length + plan.extras.length;
      for (const s of plan.series) {
        lines.push(...vevent({
          uid: uidFor(calId, `${sample.reminderId}|series|${sample.time}|${s.dtstart}|${s.interval}`),
          dtstamp, date: s.dtstart, time: sample.time,
          durationMin: sample.durationMin, title: sample.title, note: sample.note,
          alarmsMin: sample.alarmsMin,
          // UNTIL 必须与 DTSTART 同一时刻：Apple 对齐得很死
          rrule: s.rrulePrefix + stamp(s.covered[s.covered.length - 1], sample.time),
          exdates: s.exdates.map((d) => stamp(d, sample.time)),
        }));
      }
      for (const d of plan.extras) {
        const o = list.find((x) => x.date === d) || sample;
        singles++;
        lines.push(...vevent({
          uid: uidFor(calId, `${sample.reminderId}|${d}|${sample.time}`),
          dtstamp, date: d, time: sample.time,
          durationMin: sample.durationMin, title: o.title, note: o.note,
          alarmsMin: sample.alarmsMin,
        }));
      }
    } else {
      for (const o of list) {
        events++; singles++;
        lines.push(...vevent({
          uid: uidFor(calId, `${o.reminderId}|${o.date}|${o.time}`),
          dtstamp, date: o.date, time: o.time,
          durationMin: o.durationMin, title: o.title, note: o.note,
          alarmsMin: o.alarmsMin,
        }));
      }
    }
  }

  lines.push('END:VCALENDAR');
  return { text: lines.map(foldLine).join(CRLF) + CRLF, stats: { events, series, singles }, warnings };
}

function vevent({ uid, dtstamp, date, time, durationMin, title, note, alarmsMin, rrule, exdates }) {
  const out = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    'SEQUENCE:0',
    `DTSTART;TZID=Asia/Shanghai:${stamp(date, time)}`,
  ];
  if (durationMin && durationMin > 0) {
    out.push(`DTEND;TZID=Asia/Shanghai:${endStamp(date, time, durationMin)}`);
  } else {
    out.push('DURATION:PT0S');       // 零时长：日历里显示成一个时间点，不占一条时间段
  }
  out.push(`SUMMARY:${escapeText(title)}`);
  if (note) out.push(`DESCRIPTION:${escapeText(note)}`);
  if (rrule) out.push(`RRULE:${rrule}`);
  if (exdates && exdates.length) {
    // 每行只放 3 个：'EXDATE;TZID=Asia/Shanghai:' 26 字节 + 3×15 + 2 个逗号 = 73 字节，
    // 刚好不触发折行。折行本身合法，但历来是各家 .ics 解析器的重灾区，
    // 而 EXDATE 一旦被读漏，症状是「放假那天照样把你叫醒」——宁可多几行。
    for (let i = 0; i < exdates.length; i += 3) {
      out.push(`EXDATE;TZID=Asia/Shanghai:${exdates.slice(i, i + 3).join(',')}`);
    }
  }
  out.push('TRANSP:TRANSPARENT');    // 这是提醒不是会议，不该把你标成「忙」
  // 最多两条 VALARM：iOS 的事件编辑界面只暴露两个「提醒」栏位，
  // 第三条往往照响却看不见也删不掉，用户会当成 bug。
  // 另外只用 ACTION:DISPLAY——ACTION:AUDIO 带自定义 ATTACH 在 Apple 上不生效，
  // 会静默退回默认提示音，不如不承诺。
  for (const m of (alarmsMin && alarmsMin.length ? alarmsMin : [0]).slice(0, MAX_ALARMS)) {
    out.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(title)}`,
      `TRIGGER;RELATED=START:${m === 0 ? 'PT0S' : (m < 0 ? '-PT' + Math.abs(m) + 'M' : 'PT' + m + 'M')}`,
      'END:VALARM',
    );
  }
  out.push('END:VEVENT');
  return out;
}

function endStamp(date, time, durationMin) {
  let m = toMinutes(time) + durationMin;
  let d = date;
  while (m >= 1440) { m -= 1440; d = addDays(d, 1); }
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return stamp(d, `${hh}:${mm}`);
}

/* ── 班表本身也能当日历用（全天事件版） ─────────────────────── */

/**
 * 把「哪天上班 / 哪天休」导成全天事件。
 * 用途不是叫醒你，是让你在日历里一眼看见这个月到底怎么排的——
 * 尤其大小周和调休叠在一起的时候。建议单独放一个日历，随时可整体删掉。
 */
export function buildScheduleICS(schedule, opts = {}) {
  const {
    calendarName = '班表', calId = 'shift-cal', nowMs = 0,
    onlyWorkdays = true, color = '#34C759',
  } = opts;
  const dtstamp = utcStamp(nowMs);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//shift-alarm//班表//CN', 'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeText(calendarName)}`, 'X-WR-TIMEZONE:Asia/Shanghai',
    `X-APPLE-CALENDAR-COLOR:${color}`,
  ];
  let n = 0;
  for (const d of schedule.days) {
    if (onlyWorkdays && !d.isWork) continue;
    const title = d.isWork
      ? `${d.shift ? d.shift.name : '上班'} ${d.shift ? d.shift.start + '–' + d.shift.end : ''}`.trim()
      : `休 · ${d.reason}`;
    n++;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uidFor(calId, 'day|' + d.date)}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${d.date.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${addDays(d.date, 1).replace(/-/g, '')}`,
      `SUMMARY:${escapeText(title)}`,
      `DESCRIPTION:${escapeText(d.reason + (d.holidayName ? ' · ' + d.holidayName : ''))}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return { text: lines.map(foldLine).join(CRLF) + CRLF, stats: { events: n } };
}

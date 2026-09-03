/*
 * 班表闹钟 · 中文班规解析
 * ---------------------------------------------------------------------------
 * 把「大小周，早九晚六，周六轮着上，法定节假日按国家的来」这种一句话，
 * 变成引擎能吃的结构化规则。
 *
 * 两条路，同一个出口（都产出同一份 rules 对象）：
 *
 *  · parseWorkRules()  —— 本地确定性解析。不联网、不要 key、打开就能用，
 *                         覆盖国内最常见的那些说法。
 *  · buildPrompt()     —— 把用户原话 + JSON Schema + 少量示例拼成提示词，
 *                         交给模型（页面里可以直接调 Claude，也可以复制到任意
 *                         对话框里粘回结果）。用于本地解析拿不准的复杂班规。
 *
 * 设计上有一条硬规矩：**解析器永远不许偷偷猜**。
 * 每认出一件事就记一条 note；凡是靠默认值补上的、或者原文有歧义的，
 * 一律记成 question 抛回界面让人确认。班表错一天，就是白起床一次或者旷工一次，
 * 「差不多对」在这里没有意义。
 */

import { emptyRules, mondayOf, addDays, dowOf, DOW_LABEL } from './engine.js';

/* ── 中文数字与时刻 ─────────────────────────────────────────── */

const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/** 「十」「十二」「二十」「二十三」以及阿拉伯数字都能读 */
export function cnNum(s) {
  if (s == null) return NaN;
  s = String(s).trim();
  if (/^\d+$/.test(s)) return +s;
  if (!s) return NaN;
  if (s === '十') return 10;
  const m = /^(.)?十(.)?$/.exec(s);
  if (m) {
    const tens = m[1] ? CN_DIGIT[m[1]] : 1;
    const ones = m[2] ? CN_DIGIT[m[2]] : 0;
    if (tens == null || ones == null) return NaN;
    return tens * 10 + ones;
  }
  let n = 0;
  for (const ch of s) {
    if (CN_DIGIT[ch] == null) return NaN;
    n = n * 10 + CN_DIGIT[ch];
  }
  return n;
}

const HHMM = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

/**
 * 解析一个时刻。支持 9:30 / 09:30 / 9点 / 九点半 / 九点一刻 / 晚上8点 / 下午6点。
 * period 是上下文里的「早上/下午/晚上」，用于 12 小时制消歧。
 */
export function parseTime(raw, period) {
  if (!raw) return null;
  const s = String(raw).trim();
  let h = NaN, mi = 0;

  let m = /^(\d{1,2})\s*[:：]\s*(\d{1,2})$/.exec(s);
  if (m) { h = +m[1]; mi = +m[2]; }
  if (Number.isNaN(h)) {
    m = /^([零〇一二两三四五六七八九十\d]{1,3})\s*[点時时]\s*(半|一刻|三刻|[零〇一二两三四五六七八九十\d]{1,3})?\s*分?$/.exec(s);
    if (m) {
      h = cnNum(m[1]);
      const rest = m[2];
      if (rest === '半') mi = 30;
      else if (rest === '一刻') mi = 15;
      else if (rest === '三刻') mi = 45;
      else if (rest) mi = cnNum(rest);
      if (Number.isNaN(mi)) mi = 0;
    }
  }
  if (Number.isNaN(h)) {
    m = /^([零〇一二两三四五六七八九十\d]{1,3})$/.exec(s);
    if (m) h = cnNum(m[1]);
  }
  if (Number.isNaN(h) || h < 0 || h > 24 || mi < 0 || mi > 59) return null;

  // 12 小时制：有「下午 / 晚上 / 傍晚 / 夜里」且小时 < 12 就 +12
  if (period && /下午|晚上?|傍晚|夜里?|中午/.test(period) && h < 12) {
    if (!(/中午/.test(period) && h === 12)) h += 12;
  }
  if (h === 24) h = 0;
  return HHMM(h % 24, mi);
}

/* ── 星期 ───────────────────────────────────────────────────── */

const DOW_WORD = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7, 末: 0 };

/** 从「周一到周五」「周六周日」「礼拜三」里抽出 ISO 星期集合 */
export function parseDows(text) {
  const out = new Set();
  // 区间：周一到周五 / 周一至周六
  for (const m of text.matchAll(/(?:周|星期|礼拜)([一二三四五六日天])\s*(?:到|至|-|~|—)\s*(?:周|星期|礼拜)?([一二三四五六日天])/g)) {
    const a = DOW_WORD[m[1]], b = DOW_WORD[m[2]];
    if (a && b && a <= b) for (let d = a; d <= b; d++) out.add(d);
  }
  // 单点：周六、周日
  for (const m of text.matchAll(/(?:周|星期|礼拜)([一二三四五六日天])/g)) {
    const d = DOW_WORD[m[1]];
    if (d) out.add(d);
  }
  return [...out].sort((x, y) => x - y);
}

/* ── 主解析 ─────────────────────────────────────────────────── */

/**
 * @param text 用户原话
 * @param opts { today: 'YYYY-MM-DD' }
 * @returns { rules, notes:[{label,detail,confidence}], questions:[{id,ask,why}] }
 */
export function parseWorkRules(text, opts = {}) {
  const today = opts.today;
  const raw = String(text || '');
  // 全角标点统一成半角，省得每条正则都写两遍
  const t = raw.replace(/[，。！]/g, ',').replace(/[；]/g, ';').replace(/\s+/g, ' ');
  const r = emptyRules();
  const notes = [];
  const questions = [];
  const note = (label, detail, confidence = 'sure') => notes.push({ label, detail, confidence });
  const ask = (id, question, why) => questions.push({ id, ask: question, why });

  /* —— 1. 上下班时刻 —— */
  let start = null, end = null;
  // 「996」「10-10-6」这类写法同时含着班型信息（一周几天）。
  // 但班型是下一步 detectPattern 统一决定的，直接写进 r.pattern 会被它覆盖掉，
  // 所以先存成 hint，由 detectPattern 在没有更强线索时采纳。
  const hints = {};

  // 「朝九晚五」「早九晚六」「早8晚5」
  let m = /(?:朝|早|上午)\s*([零〇一二两三四五六七八九十\d]{1,3})\s*(?:点)?\s*(?:晚|到晚上?|至晚)\s*([零〇一二两三四五六七八九十\d]{1,3})/.exec(t);
  if (m) {
    start = parseTime(m[1]);
    const e = cnNum(m[2]);
    end = Number.isNaN(e) ? null : HHMM(e < 12 ? e + 12 : e, 0);   // 「晚五」= 17:00
    if (start && end) note('上下班', `${start} – ${end}`, 'sure');
  }

  // 「996」「995」「10-10-6」
  if (!start && /\b996\b|996工作制/.test(t)) {
    start = '09:00'; end = '21:00';
    note('上下班', '09:00 – 21:00（996）');
    hints.workdays = [1, 2, 3, 4, 5, 6];
    hints.why = '996 的最后一个 6';
  }
  if (!start && /\b995\b/.test(t)) { start = '09:00'; end = '21:00'; note('上下班', '09:00 – 21:00（995）'); }
  if (!start) {
    const mm = /(\d{1,2})\s*[-–]\s*(\d{1,2})\s*[-–]\s*([567])\b/.exec(t);
    if (mm) {
      start = HHMM(+mm[1], 0);
      end = HHMM(+mm[2] < 12 ? +mm[2] + 12 : +mm[2], 0);
      note('上下班', `${start} – ${end}`);
      const days = +mm[3];
      hints.workdays = [1, 2, 3, 4, 5, 6, 7].slice(0, days);
      hints.why = `${mm[1]}-${mm[2]}-${mm[3]} 的最后一位`;
    }
  }

  // 一般写法：「9点上班」「18:00下班」「早上8:30到岗」
  if (!start) {
    const ms = /(上午|下午|早上?|晚上?|中午|傍晚)?\s*([\d]{1,2}[:：][\d]{1,2}|[零〇一二两三四五六七八九十\d]{1,3}\s*[点時时](?:半|一刻|三刻|[零〇一二两三四五六七八九十\d]{1,3}分?)?)\s*(?:钟)?\s*(?:上班|到岗|开工|打卡上班|start)/.exec(t);
    if (ms) { start = parseTime(ms[2], ms[1]); if (start) note('上班时刻', start); }
  }
  if (!end) {
    const me = /(上午|下午|早上?|晚上?|中午|傍晚)?\s*([\d]{1,2}[:：][\d]{1,2}|[零〇一二两三四五六七八九十\d]{1,3}\s*[点時时](?:半|一刻|三刻|[零〇一二两三四五六七八九十\d]{1,3}分?)?)\s*(?:钟)?\s*(?:下班|收工|走人)/.exec(t);
    if (me) { end = parseTime(me[2], me[1]); if (end) note('下班时刻', end); }
  }
  // 「9点到18点」这种区间
  if (!start || !end) {
    const mr = /(上午|下午|早上?|晚上?)?\s*([\d]{1,2}[:：][\d]{1,2}|[零〇一二两三四五六七八九十\d]{1,3}\s*[点時时](?:半)?)\s*(?:到|至|-|~|—)\s*(上午|下午|早上?|晚上?)?\s*([\d]{1,2}[:：][\d]{1,2}|[零〇一二两三四五六七八九十\d]{1,3}\s*[点時时](?:半)?)/.exec(t);
    if (mr) {
      const a = parseTime(mr[2], mr[1]), b = parseTime(mr[4], mr[3] || (parseTime(mr[2], mr[1]) ? '下午' : ''));
      if (a && b) { start = start || a; end = end || b; note('上下班', `${start} – ${end}`); }
    }
  }

  if (!start || !end) {
    start = start || '09:00'; end = end || '18:00';
    ask('shift', `上下班时间是 ${start} – ${end} 吗？`, '原文里没读到明确的上下班时刻，先按最常见的填上了');
    note('上下班', `${start} – ${end}`, 'guess');
  }
  r.shifts = [{ id: 'day', name: '白班', start, end }];
  r.defaultShift = 'day';

  /* —— 2. 班型 —— */
  const patternSet = detectPattern(t, r, note, ask, today, hints);

  /* —— 3. 法定节假日 —— */
  if (/不(?:按|随)(?:国家)?法定|不调休|节假日照常|假期照常上班/.test(t)) {
    r.holidays.observeOff = false;
    r.holidays.observeMakeup = false;
    note('法定节假日', '不跟随国家安排（照常上班）');
  } else {
    note('法定节假日', '跟随国务院安排：放假不上班、调休日要补班');
    if (/不补班|不用补班|调休不上/.test(t)) {
      r.holidays.observeMakeup = false;
      note('调休补班', '不补班');
    }
  }

  /* —— 4. 提醒 —— */
  r.reminders = defaultReminders(t, note);

  /* —— 5. 范围 —— */
  r.name = guessName(t, patternSet);
  return { rules: r, notes, questions };
}

/* ── 班型识别 ───────────────────────────────────────────────── */

function detectPattern(t, r, note, ask, today, hints = {}) {
  // 做N休M / 上N休M（滚动循环，不跟星期走）
  const cyc = /(?:做|上|干)\s*([零〇一二两三四五六七八九十\d]{1,2})\s*休\s*([零〇一二两三四五六七八九十\d]{1,2})/.exec(t);

  // 大小周：隔周多上一天
  const isBigSmall = /大小周|大小礼拜|隔周(?:单休|双休|休一天)|单双周|做六休一和做五休二|轮着上周六/.test(t);

  if (isBigSmall) {
    r.pattern.kind = 'alternating';
    r.pattern.baseWorkdays = [1, 2, 3, 4, 5];
    r.pattern.parity = 'anchor';
    const extra = pickBigWeekExtra(t);
    r.pattern.bigWeekExtra = extra;
    note('班型', `大小周：平时周一至周五，大周多上${extra.map((d) => DOW_LABEL[d]).join('、')}`);

    const anchor = resolveAnchor(t, today, note);
    r.pattern.anchorMonday = anchor.monday;
    r.pattern.anchorIsBig = anchor.isBig;
    if (anchor.guessed) {
      ask('anchor',
        `${anchor.monday} 那一周是「大周」（要上${extra.map((d) => DOW_LABEL[d]).join('、')}）吗？`,
        '大小周必须有个起算周，说错就整张表错开一周——这是最需要你亲自确认的一项');
      note('大小周起算', `${anchor.monday} 起算，该周为${anchor.isBig ? '大周' : '小周'}`, 'guess');
    } else {
      note('大小周起算', `${anchor.monday} 起算，该周为${anchor.isBig ? '大周' : '小周'}`);
    }
    return 'alternating';
  }

  if (cyc) {
    const on = cnNum(cyc[1]), off = cnNum(cyc[2]);
    if (Number.isFinite(on) && Number.isFinite(off) && on > 0 && off > 0) {
      // 「做五休二 / 做六休一」在国内基本等同于固定周班型，不是滚动循环
      if (on + off === 7 && /做五休二|做6休1|做六休一|五天工作|六天工作/.test(t.replace(/\s/g, ''))) {
        r.pattern.kind = 'weekly';
        r.pattern.workdays = [1, 2, 3, 4, 5, 6, 7].slice(0, on);
        note('班型', `固定每周上 ${on} 天休 ${off} 天（周一起算）`);
        return 'weekly';
      }
      r.pattern.kind = 'cycle';
      r.pattern.cycle = {
        anchor: mondayOf(today || '2026-01-05'),
        slots: [...Array(on).fill('day'), ...Array(off).fill('off')],
      };
      note('班型', `滚动循环：上 ${on} 天休 ${off} 天，${on + off} 天一轮`);
      ask('cycleAnchor', `循环从 ${r.pattern.cycle.anchor} 这天开始算第 1 个工作日吗？`,
        '滚动循环不跟星期走，起算日错一天，之后每一天都错');
      return 'cycle';
    }
  }

  // 轮班
  if (/三班倒|三班制/.test(t)) {
    r.shifts = [
      { id: 'morning', name: '早班', start: '08:00', end: '16:00' },
      { id: 'noon', name: '中班', start: '16:00', end: '00:00' },
      { id: 'night', name: '夜班', start: '00:00', end: '08:00' },
    ];
    r.pattern.kind = 'cycle';
    r.pattern.cycle = {
      anchor: mondayOf(today || '2026-01-05'),
      slots: ['morning', 'morning', 'noon', 'noon', 'night', 'night', 'off', 'off'],
    };
    note('班型', '三班倒：早early→中→夜，每班连上两天后休两天（8 天一轮）', 'guess');
    ask('shiftCycle', '三班倒的轮法和起算日对吗？可以在下面的「班型」里改成你们实际的轮转顺序。',
      '各家轮法差别很大（四班三倒、两班倒、连上几天再转），这里给的是最常见的一种');
    return 'cycle';
  }
  if (/两班倒|二班倒|白夜班|白班夜班倒/.test(t)) {
    r.shifts = [
      { id: 'day', name: '白班', start: '08:00', end: '20:00' },
      { id: 'night', name: '夜班', start: '20:00', end: '08:00' },
    ];
    r.pattern.kind = 'cycle';
    r.pattern.cycle = {
      anchor: mondayOf(today || '2026-01-05'),
      slots: ['day', 'day', 'night', 'night', 'off', 'off'],
    };
    note('班型', '两班倒：白白夜夜休休（6 天一轮）', 'guess');
    ask('shiftCycle', '两班倒的轮法和起算日对吗？', '各家轮法不同，这里给的是最常见的「白白夜夜休休」');
    return 'cycle';
  }

  // 固定周
  const dows = parseDows(t);
  if (/单休|做六休一|每周休一天/.test(t)) {
    r.pattern.kind = 'weekly'; r.pattern.workdays = [1, 2, 3, 4, 5, 6];
    note('班型', '单休：周一至周六上班，周日休');
    return 'weekly';
  }
  if (/双休|做五休二|五天工作制|周末双休/.test(t)) {
    r.pattern.kind = 'weekly'; r.pattern.workdays = [1, 2, 3, 4, 5];
    note('班型', '双休：周一至周五上班');
    return 'weekly';
  }
  if (dows.length) {
    r.pattern.kind = 'weekly'; r.pattern.workdays = dows;
    note('班型', `每周固定上：${dows.map((d) => DOW_LABEL[d]).join('、')}`);
    return 'weekly';
  }

  if (hints.workdays) {
    r.pattern.kind = 'weekly';
    r.pattern.workdays = hints.workdays;
    note('班型', `每周上 ${hints.workdays.length} 天（${hints.why}）`);
    return 'weekly';
  }
  r.pattern.kind = 'weekly'; r.pattern.workdays = [1, 2, 3, 4, 5];
  note('班型', '双休：周一至周五上班', 'guess');
  ask('pattern', '你是标准双休（周一至周五）吗？', '原文里没读出班型，先按最常见的双休填上了');
  return 'weekly';
}

/** 大周额外上的是哪几天 */
function pickBigWeekExtra(t) {
  if (/大周.*?(?:上|要上)?.*?周日|隔周.*周日/.test(t) && /周六/.test(t)) return [6, 7];
  const dows = parseDows(t).filter((d) => d === 6 || d === 7);
  if (dows.length) return dows;
  return [6];
}

/**
 * 大小周的起算周。这是整份规则里最容易出错、后果最重的一项：
 * 说错一周，之后每一个周六都是反的。所以只要不是原文明确写了，
 * 一律标成 guessed 并抛一条 question 出去。
 */
function resolveAnchor(t, today, note) {
  const base = today || '2026-01-05';
  const thisMon = mondayOf(base);

  if (/这周|本周|这个礼拜|本礼拜/.test(t)) {
    if (/(?:这周|本周|这个礼拜|本礼拜)[^,;]{0,6}(?:大周|要上|上班|不休)/.test(t)) {
      return { monday: thisMon, isBig: true, guessed: false };
    }
    if (/(?:这周|本周|这个礼拜|本礼拜)[^,;]{0,6}(?:小周|休|不用上)/.test(t)) {
      return { monday: thisMon, isBig: false, guessed: false };
    }
  }
  if (/下周|下个礼拜|下礼拜/.test(t)) {
    const nextMon = addDays(thisMon, 7);
    if (/(?:下周|下个礼拜|下礼拜)[^,;]{0,6}(?:大周|要上|上班)/.test(t)) {
      return { monday: nextMon, isBig: true, guessed: false };
    }
    if (/(?:下周|下个礼拜|下礼拜)[^,;]{0,6}(?:小周|休)/.test(t)) {
      return { monday: nextMon, isBig: false, guessed: false };
    }
  }
  // 明确写了某个日期要上班：「3月7号要上班」
  const md = /(\d{4})[-/年]\s*(\d{1,2})[-/月]\s*(\d{1,2})/.exec(t);
  if (md && /上班|要上/.test(t)) {
    const iso = `${md[1]}-${String(+md[2]).padStart(2, '0')}-${String(+md[3]).padStart(2, '0')}`;
    const d = dowOf(iso);
    if (d === 6 || d === 7) return { monday: mondayOf(iso), isBig: true, guessed: false };
  }
  return { monday: thisMon, isBig: true, guessed: true };
}

/* ── 默认提醒 ───────────────────────────────────────────────── */

function defaultReminders(t, note) {
  const rs = [];
  let wakeAhead = 90;
  const m = /提前\s*([零〇一二两三四五六七八九十\d]{1,3})\s*(小时|个小时|分钟|分)\s*(?:起床|叫我|响)?/.exec(t);
  if (m) {
    const n = cnNum(m[1]);
    if (Number.isFinite(n)) {
      wakeAhead = /小时/.test(m[2]) ? n * 60 : n;
      note('起床提前量', `上班前 ${wakeAhead} 分钟`);
    }
  } else {
    note('起床提前量', `上班前 ${wakeAhead} 分钟`, 'guess');
  }

  rs.push({
    id: 'wake', enabled: true, kind: 'alarm', on: 'workday',
    when: { anchor: 'shiftStart', offsetMin: -wakeAhead },
    // 备注这里刻意不放 {原因}。{原因} 是逐天变的（「大周 · 常规工作日」
    // 「调休补班 · 国庆节」……），而导出时是按「时刻＋文案」分组成重复事件的：
    // 文案一天一个样，一条规则就会碎成十几条。天天都要响的这条，
    // 值得为压缩让出这点信息；真正需要说明原因的是下面那条补班提醒。
    title: '起床 · 今天{班次} {上班} 上班', note: '', alarmsMin: [0],
  });
  rs.push({
    id: 'punch-in', enabled: true, kind: 'event', on: 'workday',
    when: { anchor: 'shiftStart', offsetMin: -10 },
    title: '上班打卡（{上班} 前）', alarmsMin: [0],
  });
  rs.push({
    id: 'punch-out', enabled: true, kind: 'event', on: 'workday',
    when: { anchor: 'shiftEnd', offsetMin: 0 },
    title: '下班打卡', alarmsMin: [0],
  });
  rs.push({
    id: 'eve', enabled: true, kind: 'event', on: 'eve-of-work',
    when: { anchor: 'next-shiftStart', offsetMin: -630 },
    title: '早点睡 · 明天{明日班次} {明日上班} 上班', alarmsMin: [0],
  });
  rs.push({
    id: 'makeup', enabled: true, kind: 'event', on: 'makeup',
    when: { anchor: 'shiftStart', offsetMin: -150 },
    title: '⚠️ 今天调休补班，别当成周末', note: '{原因}', alarmsMin: [0],
  });
  note('提醒', '起床、上班打卡、下班打卡、前一晚预告、补班特别提醒（可增删）');
  return rs;
}

function guessName(t, kind) {
  if (/大小周/.test(t)) return '大小周班表';
  if (kind === 'cycle') return '轮班班表';
  if (/单休/.test(t)) return '单休班表';
  return '我的班表';
}

/* ── 交给模型：提示词 ───────────────────────────────────────── */

export const RULES_JSON_SCHEMA = {
  type: 'object',
  required: ['pattern', 'shifts', 'holidays'],
  properties: {
    name: { type: 'string' },
    pattern: {
      type: 'object',
      required: ['kind'],
      properties: {
        kind: { enum: ['weekly', 'alternating', 'cycle'] },
        workdays: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 7 },
          description: 'kind=weekly 时使用。1=周一 … 7=周日' },
        baseWorkdays: { type: 'array', items: { type: 'integer' },
          description: 'kind=alternating：每周都上的那几天' },
        bigWeekExtra: { type: 'array', items: { type: 'integer' },
          description: 'kind=alternating：大周额外要上的那几天，通常是 [6]' },
        parity: { enum: ['anchor', 'iso-odd', 'iso-even'] },
        anchorMonday: { type: 'string', description: 'YYYY-MM-DD，某个周一；该周按 anchorIsBig 定性' },
        anchorIsBig: { type: 'boolean' },
        cycle: {
          type: 'object',
          properties: {
            anchor: { type: 'string', description: 'YYYY-MM-DD，循环的第 1 天' },
            slots: { type: 'array', items: { type: 'string' },
              description: "每天一项，值是 shifts 里的 id，或 'off' 表示休" },
          },
        },
      },
    },
    shifts: {
      type: 'array',
      items: {
        type: 'object', required: ['id', 'name', 'start', 'end'],
        properties: { id: { type: 'string' }, name: { type: 'string' },
          start: { type: 'string', description: 'HH:MM' },
          end: { type: 'string', description: 'HH:MM，早于 start 表示跨到次日（夜班）' } },
      },
    },
    defaultShift: { type: 'string' },
    shiftByDow: { type: 'object', description: '如 {"6":"sat"} 表示周六走 sat 这个班次' },
    holidays: {
      type: 'object',
      properties: {
        observeOff: { type: 'boolean', description: '国家法定放假日是否不上班' },
        observeMakeup: { type: 'boolean', description: '调休补班日是否要上班' },
      },
    },
    reminders: {
      type: 'array',
      items: {
        type: 'object', required: ['id', 'on', 'when', 'title'],
        properties: {
          id: { type: 'string' },
          kind: { enum: ['alarm', 'event'] },
          on: { enum: ['workday', 'restday', 'eve-of-work', 'eve-of-rest', 'makeup',
                       'bigweek-extra', 'first-workday', 'last-workday'] },
          when: {
            type: 'object',
            properties: {
              anchor: { enum: ['shiftStart', 'shiftEnd', 'fixed', 'next-shiftStart'] },
              offsetMin: { type: 'integer', description: '相对锚点的分钟数，可负' },
              time: { type: 'string', description: "anchor=fixed 时的 HH:MM" },
            },
          },
          title: { type: 'string', description: '可用占位符 {班次} {上班} {下班} {明日上班} {明日班次} {原因} {星期}' },
          note: { type: 'string' },
          alarmsMin: { type: 'array', items: { type: 'integer' }, description: '最多 2 个，0 表示准点响' },
        },
      },
    },
    uncertainties: {
      type: 'array',
      items: { type: 'string' },
      description: '你不确定、需要用户确认的点。宁可多问，不要猜。',
    },
  },
};

const FEW_SHOT = `示例 1
输入：大小周，早九晚六，这周要上周六
输出：{"name":"大小周班表","pattern":{"kind":"alternating","baseWorkdays":[1,2,3,4,5],"bigWeekExtra":[6],"parity":"anchor","anchorMonday":"<本周一>","anchorIsBig":true},"shifts":[{"id":"day","name":"白班","start":"09:00","end":"18:00"}],"defaultShift":"day","holidays":{"observeOff":true,"observeMakeup":true},"uncertainties":[]}

示例 2
输入：四班三倒，早班8点到16点，中班16点到24点，夜班24点到8点，上两天早班两天中班两天夜班休两天
输出：{"name":"四班三倒","pattern":{"kind":"cycle","cycle":{"anchor":"<起算日>","slots":["morning","morning","noon","noon","night","night","off","off"]}},"shifts":[{"id":"morning","name":"早班","start":"08:00","end":"16:00"},{"id":"noon","name":"中班","start":"16:00","end":"00:00"},{"id":"night","name":"夜班","start":"00:00","end":"08:00"}],"holidays":{"observeOff":false,"observeMakeup":false},"uncertainties":["轮转的起算日是哪天？","轮班岗位通常不跟法定节假日走，这里按不跟随处理，对吗？"]}`;

/** 拼一个可以直接丢给任意模型的提示词（页面里也用同一份去调 Claude） */
export function buildPrompt(text, opts = {}) {
  const today = opts.today || '';
  return `你是排班规则解析器。把用户用中文口语描述的上班规则，转成下面这个 JSON Schema 的一个实例。

只输出 JSON 本身，不要代码块围栏，不要任何解释文字。

今天是 ${today}（用于把「这周」「下周」这类相对说法解析成具体日期）。
时区固定 Asia/Shanghai。1=周一 … 7=周日。

JSON Schema：
${JSON.stringify(RULES_JSON_SCHEMA, null, 1)}

几条硬要求：
1. 凡是原文没说清、你靠常识补上的，必须写进 uncertainties 数组。宁可多问一句，也不要默默替用户决定——这份规则是拿来定闹钟的，错一天就是白起床一次或者旷工一次。
2. 大小周（隔周多上一天）必须给出 anchorMonday 和 anchorIsBig。如果原文没有任何线索能定位是哪一周，就随便挑本周一，并在 uncertainties 里明确说「起算周是猜的，需要确认」。
3. 夜班用 end < start 表示跨到次日（例如 23:00 → 07:00）。
4. reminders 如果用户没提，就给一套常见的：起床（上班前 90 分钟）、上班打卡、下班打卡、上班日前一晚预告、调休补班日特别提醒。
5. 中国的调休很反直觉：某些周六周日是要上班的，某些周一到周五是放假的。默认 observeOff 与 observeMakeup 都为 true，除非用户明确说不跟国家安排（轮班岗位常常不跟）。

${FEW_SHOT}

现在解析这句：
${text}`;
}

/* ── 把模型返回的 JSON 收进规则对象 ─────────────────────────── */

/**
 * 模型的输出一律当外部输入对待：逐字段挑，不认识的丢掉，缺的补默认。
 * 直接 Object.assign 进 rules 会让一个手滑的字段名把整张表带偏，
 * 而这种错在界面上是看不出来的。
 */
export function adoptRules(json, opts = {}) {
  const r = emptyRules();
  const problems = [];
  const j = typeof json === 'string' ? JSON.parse(json) : json;
  if (!j || typeof j !== 'object') throw new Error('不是一个 JSON 对象');

  if (typeof j.name === 'string' && j.name.trim()) r.name = j.name.trim().slice(0, 40);

  const shifts = Array.isArray(j.shifts) ? j.shifts.filter(
    (s) => s && typeof s.id === 'string' && /^\d{2}:\d{2}$/.test(s.start || '') && /^\d{2}:\d{2}$/.test(s.end || '')) : [];
  if (shifts.length) {
    r.shifts = shifts.map((s) => ({ id: s.id, name: String(s.name || s.id).slice(0, 12), start: s.start, end: s.end }));
  } else {
    problems.push('没读到有效的班次时间，已用 09:00–18:00 白班兜底');
  }
  const ids = new Set(r.shifts.map((s) => s.id));
  r.defaultShift = ids.has(j.defaultShift) ? j.defaultShift : r.shifts[0].id;

  const p = j.pattern || {};
  const dows = (v) => Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => n >= 1 && n <= 7))].sort((a, b) => a - b) : null;
  if (p.kind === 'alternating') {
    r.pattern.kind = 'alternating';
    r.pattern.baseWorkdays = dows(p.baseWorkdays) || [1, 2, 3, 4, 5];
    r.pattern.bigWeekExtra = dows(p.bigWeekExtra) || [6];
    r.pattern.parity = ['anchor', 'iso-odd', 'iso-even'].includes(p.parity) ? p.parity : 'anchor';
    r.pattern.anchorMonday = isISO(p.anchorMonday) ? mondayOf(p.anchorMonday) : mondayOf(opts.today || '2026-01-05');
    r.pattern.anchorIsBig = p.anchorIsBig !== false;
    if (!isISO(p.anchorMonday)) problems.push('大小周的起算周无效，已按本周起算——请务必核对周六那一栏');
  } else if (p.kind === 'cycle') {
    r.pattern.kind = 'cycle';
    const slots = Array.isArray(p.cycle && p.cycle.slots)
      ? p.cycle.slots.map((s) => (s === 'off' || ids.has(s) ? s : 'off')) : [];
    if (!slots.length || !slots.some((s) => s !== 'off')) {
      problems.push('循环班型的排列无效，已退回双休');
      r.pattern.kind = 'weekly'; r.pattern.workdays = [1, 2, 3, 4, 5];
    } else {
      r.pattern.cycle = {
        anchor: isISO(p.cycle.anchor) ? p.cycle.anchor : (opts.today || '2026-01-05'),
        slots,
      };
      if (!isISO(p.cycle.anchor)) problems.push('循环起算日无效，已按今天起算——请核对');
    }
  } else {
    r.pattern.kind = 'weekly';
    r.pattern.workdays = dows(p.workdays) || [1, 2, 3, 4, 5];
  }

  if (j.shiftByDow && typeof j.shiftByDow === 'object') {
    for (const [k, v] of Object.entries(j.shiftByDow)) {
      if (/^[1-7]$/.test(k) && ids.has(v)) r.shiftByDow[k] = v;
    }
  }

  const h = j.holidays || {};
  r.holidays.observeOff = h.observeOff !== false;
  r.holidays.observeMakeup = h.observeMakeup !== false;

  const SCOPES = ['workday', 'restday', 'eve-of-work', 'eve-of-rest', 'makeup',
                  'bigweek-extra', 'first-workday', 'last-workday'];
  const ANCHORS = ['shiftStart', 'shiftEnd', 'fixed', 'next-shiftStart'];
  r.reminders = (Array.isArray(j.reminders) ? j.reminders : []).filter(
    (x) => x && SCOPES.includes(x.on) && typeof x.title === 'string').map((x, i) => {
    const w = x.when || {};
    return {
      id: String(x.id || `r${i}`).slice(0, 24), enabled: true,
      kind: x.kind === 'alarm' ? 'alarm' : 'event',
      on: x.on,
      when: {
        anchor: ANCHORS.includes(w.anchor) ? w.anchor : 'shiftStart',
        offsetMin: Number.isFinite(+w.offsetMin) ? Math.max(-1440, Math.min(1440, +w.offsetMin)) : 0,
        time: /^\d{2}:\d{2}$/.test(w.time || '') ? w.time : '08:00',
      },
      title: String(x.title).slice(0, 80),
      note: typeof x.note === 'string' ? x.note.slice(0, 200) : '',
      // 超过 2 条的 VALARM 在 iOS 上看不见也删不掉，这里就截断，别留到导出阶段
      alarmsMin: (Array.isArray(x.alarmsMin) ? x.alarmsMin : [0])
        .map(Number).filter(Number.isFinite).slice(0, 2),
    };
  });
  if (!r.reminders.length) problems.push('没读到有效的提醒，已留空——请在下面自己加');

  const uncertainties = (Array.isArray(j.uncertainties) ? j.uncertainties : [])
    .filter((s) => typeof s === 'string').map((s) => s.slice(0, 200));
  return { rules: r, problems, uncertainties };
}

function isISO(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

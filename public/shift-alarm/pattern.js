/*
 * 班表闹钟 · 界面
 * ---------------------------------------------------------------------------
 * 逻辑全在 engine.js / ics.js / parser.js 里（那三个有测试）。这里只做三件事：
 * 收集输入、把班表画出来给人核对、把文件递给 iOS。
 *
 * 「递给 iOS」这一步的做法是有讲究的，不是随手写个 <a download>：
 *
 *  1. 主路径是 navigator.share({ files: [file] })。iOS 15 起支持，会直接唤起
 *     系统分享面板并出现「日历」——那是日历的导入扩展，比「下载后去文件里点开」
 *     可靠得多（后者在 iOS 17/18 上有一批「只能预览、没有添加按钮」的报告）。
 *  2. 分享对象里**只能有 files**。一旦同时带上 title / text / url，
 *     iOS 会把文件丢掉、改成分享那段文字。
 *  3. File 必须在 click 处理器里**同步**构造好。中间只要 await 一次
 *     （fetch、动态 import、异步生成），瞬时用户激活就过期，
 *     navigator.share 抛 NotAllowedError，而且没法再程序化拿回来。
 *     所以 .ics 文本在状态变化时就预先算好，点击时直接取。
 *  4. AbortError 是用户自己点了取消，不能当失败去触发下载兜底。
 *  5. 兜底用 blob:，绝不用 data:（Safari 14+ 屏蔽 data: 顶层导航、
 *     并忽略 download 属性，结果是打开一个满屏乱码的新标签页）。
 *     revoke 要延后，立刻 revoke 会让下载中断。
 */

import * as E from './engine.js';
import * as I from './ics.js';
import * as P from './parser.js';
import { CN_HOLIDAYS } from './holidays-data.js';

/* ── 小工具 ─────────────────────────────────────────── */

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}

const isStandalone = () =>
  window.navigator.standalone === true ||
  window.matchMedia('(display-mode: standalone)').matches;

/** 今天（按设备本地时区读，再转成 civil date 串） */
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ── 假日数据 ───────────────────────────────────────── */

const HOLIDAYS = (() => {
  const off = [], work = [], names = {};
  for (const y of Object.keys(CN_HOLIDAYS)) {
    const v = CN_HOLIDAYS[y];
    off.push(...v.off); work.push(...v.work);
    Object.assign(names, v.names);
  }
  return { off: new Set(off), work: new Set(work), names };
})();

/* ── 状态 ───────────────────────────────────────────── */

const STORE_KEY = 'shift-alarm.rules.v1';
const TODAY = todayISO();

const state = {
  rules: null,
  notes: [],
  asks: [],
  schedule: null,
  occurrences: [],
  monthCursor: TODAY.slice(0, 7),
  selectedDay: null,
  months: 12,
  icsMode: 'recurring',
  // 预先算好，供 click 处理器同步取用（见文件头第 3 条）
  icsText: '', icsStats: null, icsWarn: [],
  calText: '', calStats: null,
  wake: { groups: [], reminder: null },
};

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state.rules)); } catch (e) { /* 隐私模式下会抛，忽略 */ }
}
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    return j && j.pattern ? j : null;
  } catch (e) { return null; }
}

/* ── 重算 ───────────────────────────────────────────── */

function horizon() {
  const from = TODAY;
  const to = E.toISO(E.toDays(from) + Math.round(state.months * 30.5));
  return { from, to };
}

function recompute() {
  const r = state.rules;
  if (!r) return;
  const { from, to } = horizon();
  state.schedule = E.expandSchedule(r, from, to, HOLIDAYS);
  state.occurrences = E.expandReminders(r, state.schedule);

  const now = Date.now();
  const ics = I.buildICS(state.occurrences, {
    mode: state.icsMode, calendarName: r.name || '班表闹钟', nowMs: now,
    calId: 'shift-alarm-' + I.hash32(JSON.stringify(r.pattern) + r.name),
  });
  state.icsText = ics.text; state.icsStats = ics.stats; state.icsWarn = ics.warnings;

  const cal = I.buildScheduleICS(state.schedule, {
    calendarName: (r.name || '班表') + '（班表）', nowMs: now,
  });
  state.calText = cal.text; state.calStats = cal.stats;

  state.wake = buildWakeGroups();

  save();
  render();
}

/* ── 渲染 ───────────────────────────────────────────── */

function render() {
  renderNotes();
  renderCalendar();
  renderStats();
  renderHealth();
  renderTuner();
  renderReminders();
  renderExport();
  for (const id of ['#sec-cal', '#sec-rem', '#sec-export']) $(id).hidden = !state.rules;
}

function renderNotes() {
  const card = $('#notes-card'), notes = $('#notes'), asks = $('#asks');
  notes.textContent = ''; asks.textContent = '';
  if (!state.notes.length && !state.asks.length) { card.hidden = true; return; }
  card.hidden = false;
  for (const n of state.notes) {
    const row = el('div', 'note' + (n.confidence === 'guess' ? ' guess' : ''));
    row.append(el('span', 'k', n.label), el('span', 'v', n.detail));
    notes.append(row);
  }
  for (const a of state.asks) {
    const row = el('div', 'ask');
    row.append(el('b', null, a.ask), el('small', null, a.why));
    asks.append(row);
  }
}

const MONTH_LABEL = (ym) => `${+ym.slice(0, 4)} 年 ${+ym.slice(5, 7)} 月`;

function renderCalendar() {
  if (!state.schedule) return;
  $('#cal-month').textContent = MONTH_LABEL(state.monthCursor);
  const grid = $('#cal');
  grid.textContent = '';

  const first = state.monthCursor + '-01';
  const firstDow = E.dowOf(first);
  const startZ = E.toDays(first) - (firstDow - 1);          // 补齐到周一
  const daysInMonth = E.toDays(E.addDays(first, 32).slice(0, 7) + '-01') - E.toDays(first);
  const cells = Math.ceil((firstDow - 1 + daysInMonth) / 7) * 7;

  for (let i = 0; i < cells; i++) {
    const date = E.toISO(startZ + i);
    const inMonth = date.slice(0, 7) === state.monthCursor;
    const info = state.schedule.byDate.get(date);
    const b = el('button', 'day' + (inMonth ? ' in' : ''));
    b.append(el('span', null, String(+date.slice(8, 10))));

    if (info) {
      if (info.isWork) b.classList.add('work');
      if (info.tags.includes('holiday')) b.classList.add('holiday');
      if (info.tags.includes('makeup')) b.classList.add('makeup');
      if (info.tags.includes('bigweek-extra')) b.classList.add('extra');
      if (info.tags.some((t) => t.startsWith('override'))) b.classList.add('ov');
      if (info.isWork && info.shift && state.rules.shifts.length > 1) {
        b.append(el('span', 'sub', info.shift.name.slice(0, 2)));
      }
      if (info.tags.includes('makeup')) b.append(el('span', 'tag', '补'));
      else if (info.tags.includes('holiday')) b.append(el('span', 'tag', '假'));
    }
    if (date === TODAY) b.classList.add('today');
    b.addEventListener('click', () => selectDay(date));
    grid.append(b);
  }
  renderDayDetail();
}

function selectDay(date) {
  state.selectedDay = state.selectedDay === date ? null : date;
  renderDayDetail();
}

function renderDayDetail() {
  const box = $('#daydetail');
  const date = state.selectedDay;
  if (!date || !state.schedule) { box.hidden = true; return; }
  const info = state.schedule.byDate.get(date);
  if (!info) { box.hidden = true; return; }
  box.hidden = false;
  box.textContent = '';

  const head = el('div');
  head.append(el('b', null, `${date}（${E.DOW_LABEL[info.dow]}）`));
  head.append(document.createTextNode(
    info.isWork ? ` · 上班 ${info.shift ? info.shift.start + '–' + info.shift.end : ''}` : ' · 休'));
  box.append(head);

  const why = el('ul');
  for (const line of info.trace.length ? info.trace : [info.reason]) why.append(el('li', null, line));
  box.append(why);

  const occ = state.occurrences.filter((o) => o.date === date);
  if (occ.length) {
    const list = el('ul');
    for (const o of occ) list.append(el('li', null, `${o.time} ${o.title}`));
    box.append(el('div', null, '这天的提醒：'), list);
  }

  const btn = el('button', 'small', info.isWork ? '改成「休」' : '改成「上班」');
  btn.style.marginTop = '10px';
  btn.addEventListener('click', () => toggleOverride(date));
  box.append(btn);

  const ovs = state.rules.overrides;
  if (ovs.off.includes(date) || ovs.work[date]) {
    const clr = el('button', 'small danger', '取消这天的手动修改');
    clr.style.marginLeft = '8px';
    clr.addEventListener('click', () => {
      ovs.off = ovs.off.filter((d) => d !== date);
      delete ovs.work[date];
      recompute();
    });
    box.append(clr);
  }
}

function toggleOverride(date) {
  const info = state.schedule.byDate.get(date);
  const ov = state.rules.overrides;
  ov.off = ov.off.filter((d) => d !== date);
  delete ov.work[date];
  if (info.isWork) ov.off.push(date);
  else ov.work[date] = 'default';
  recompute();
}

function renderStats() {
  const box = $('#stats');
  box.textContent = '';
  if (!state.schedule) return;
  const ym = state.monthCursor;
  const days = state.schedule.days.filter((d) => d.date.startsWith(ym));
  const work = days.filter((d) => d.isWork);
  let hours = 0;
  for (const d of work) {
    if (!d.shift) continue;
    let dur = E.toMinutes(d.shift.end) - E.toMinutes(d.shift.start);
    if (dur <= 0) dur += 1440;
    hours += dur / 60;
  }
  const makeup = days.filter((d) => d.tags.includes('makeup')).length;
  const mk = (n, label) => {
    const s = el('div', 'stat');
    s.append(el('b', null, String(n)), el('small', null, label));
    return s;
  };
  // 标签不要以数字开头：它紧跟在大号数字后面，「22」+「9 月上班天数」连读成「229」
  box.append(mk(work.length, '本月上班天数'));
  box.append(mk(Math.round(hours), '本月工时 · 小时'));
  box.append(mk(makeup, '本月补班天数'));
}

function renderHealth() {
  const card = $('#health-card'), box = $('#health');
  box.textContent = '';
  if (!state.schedule) { card.hidden = true; return; }
  const items = [];

  for (const w of state.schedule.warnings) items.push(w);

  const runs = E.streaksAtLeast(state.schedule, 7);
  if (runs.length) {
    const r = runs[0];
    items.push(`接下来会有 ${runs.length} 段「连上 7 天以上」的日子，最近的一段是 ` +
      `${r.start} 到 ${r.end}，一口气 ${r.days} 天——大小周撞上调休就会这样，` +
      `这正是 iPhone 自带闹钟看不见的东西。`);
  }

  const nextMakeup = state.schedule.days.find((d) => d.tags.includes('makeup') && d.date >= TODAY);
  if (nextMakeup) {
    items.push(`下一个要补班的周末是 ${nextMakeup.date}（${E.DOW_LABEL[nextMakeup.dow]}，` +
      `${nextMakeup.holidayName || '调休'}）。`);
  }
  if (!items.length) { card.hidden = true; return; }
  card.hidden = false;
  for (const t of items) box.append(el('div', 'warn', t));
}

/* ── 班型微调 ───────────────────────────────────────── */

function renderTuner() {
  const box = $('#tuner');
  if (!state.rules) return;
  box.textContent = '';
  const r = state.rules;

  box.append(labeledSelect('班型', r.pattern.kind, [
    ['weekly', '固定每周（双休 / 单休 / 自选星期）'],
    ['alternating', '大小周（隔周多上一天）'],
    ['cycle', '滚动循环（做N休M / 轮班倒班）'],
  ], (v) => { r.pattern.kind = v; recompute(); }));

  if (r.pattern.kind === 'weekly') {
    box.append(dowPicker('每周哪几天上班', r.pattern.workdays, (v) => { r.pattern.workdays = v; recompute(); }));
  }

  if (r.pattern.kind === 'alternating') {
    box.append(dowPicker('每周都要上的', r.pattern.baseWorkdays, (v) => { r.pattern.baseWorkdays = v; recompute(); }));
    box.append(dowPicker('大周多上的', r.pattern.bigWeekExtra, (v) => { r.pattern.bigWeekExtra = v; recompute(); }));

    const wrap = el('label', 'field');
    wrap.append(el('span', null, '哪一周算「大周」（起算周，最容易错的一项）'));
    const inp = el('input');
    inp.type = 'date';
    inp.value = r.pattern.anchorMonday || E.mondayOf(TODAY);
    inp.addEventListener('change', () => {
      if (inp.value) { r.pattern.anchorMonday = E.mondayOf(inp.value); recompute(); }
    });
    wrap.append(inp);
    const note = el('small');
    note.style.cssText = 'display:block;margin-top:5px;color:var(--ink-3);font-size:13px';
    note.textContent = `选任意一天，会自动对齐到那一周的周一（${r.pattern.anchorMonday || '—'}）；` +
      `该周被视为${r.pattern.anchorIsBig === false ? '小' : '大'}周。`;
    wrap.append(note);
    const flip = el('button', 'small');
    flip.textContent = '把大小周整体对调';
    flip.style.marginTop = '8px';
    flip.addEventListener('click', () => {
      r.pattern.anchorIsBig = r.pattern.anchorIsBig === false;
      recompute();
      toast('已对调，请核对下面日历里最近那个周六');
    });
    wrap.append(flip);
    box.append(wrap);
  }

  if (r.pattern.kind === 'cycle') {
    const wrap = el('label', 'field');
    wrap.append(el('span', null, '循环起算日（这天是循环的第 1 天）'));
    const inp = el('input');
    inp.type = 'date';
    inp.value = r.pattern.cycle.anchor || TODAY;
    inp.addEventListener('change', () => {
      if (inp.value) { r.pattern.cycle.anchor = inp.value; recompute(); }
    });
    wrap.append(inp);
    box.append(wrap);

    const sl = el('label', 'field');
    sl.append(el('span', null, '一轮怎么排（每天一项，用空格分开；off 表示休）'));
    const ta = el('input');
    ta.type = 'text';
    ta.value = (r.pattern.cycle.slots || []).join(' ');
    ta.addEventListener('change', () => {
      const ids = new Set(r.shifts.map((s) => s.id));
      const slots = ta.value.trim().split(/\s+/).filter(Boolean)
        .map((s) => (s === 'off' || ids.has(s) ? s : 'off'));
      if (slots.length) { r.pattern.cycle.slots = slots; recompute(); }
    });
    sl.append(ta);
    const help = el('small');
    help.style.cssText = 'display:block;margin-top:5px;color:var(--ink-3);font-size:13px';
    help.textContent = '可用的班次 id：' + r.shifts.map((s) => s.id).join('、') + '、off';
    sl.append(help);
    box.append(sl);
  }

  // 班次
  for (const [i, s] of r.shifts.entries()) {
    const g = el('div', 'grid2');
    g.style.marginBottom = '10px';
    const n = el('label', 'field');
    n.append(el('span', null, `班次 ${i + 1} 名称`));
    const ni = el('input'); ni.type = 'text'; ni.value = s.name;
    ni.addEventListener('change', () => { s.name = ni.value.slice(0, 12) || s.id; recompute(); });
    n.append(ni);
    const t1 = el('label', 'field');
    t1.append(el('span', null, '上班'));
    const i1 = el('input'); i1.type = 'time'; i1.value = s.start;
    i1.addEventListener('change', () => { if (i1.value) { s.start = i1.value; recompute(); } });
    t1.append(i1);
    const t2 = el('label', 'field');
    t2.append(el('span', null, '下班'));
    const i2 = el('input'); i2.type = 'time'; i2.value = s.end;
    i2.addEventListener('change', () => { if (i2.value) { s.end = i2.value; recompute(); } });
    t2.append(i2);
    g.append(n, t1, t2);
    box.append(g);
  }

  const holi = el('div');
  holi.append(switchRow('跟随国家法定节假日', '放假的日子不上班', r.holidays.observeOff,
    (v) => { r.holidays.observeOff = v; recompute(); }));
  holi.append(switchRow('跟随调休补班', '被挪成工作日的周末要上班', r.holidays.observeMakeup,
    (v) => { r.holidays.observeMakeup = v; recompute(); }));
  box.append(holi);
}

function labeledSelect(label, value, options, onChange) {
  const wrap = el('label', 'field');
  wrap.append(el('span', null, label));
  const sel = el('select');
  for (const [v, t] of options) {
    const o = el('option', null, t);
    o.value = v;
    if (v === value) o.selected = true;
    sel.append(o);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  wrap.append(sel);
  return wrap;
}

function dowPicker(label, selected, onChange) {
  const wrap = el('label', 'field');
  wrap.append(el('span', null, label));
  const row = el('div', 'dow-pick');
  const cur = new Set(selected || []);
  for (let d = 1; d <= 7; d++) {
    const b = el('button', null, E.DOW_LABEL[d].slice(1));
    b.type = 'button';
    b.setAttribute('aria-pressed', cur.has(d) ? 'true' : 'false');
    b.addEventListener('click', () => {
      if (cur.has(d)) cur.delete(d); else cur.add(d);
      onChange([...cur].sort((a, b2) => a - b2));
    });
    row.append(b);
  }
  wrap.append(row);
  return wrap;
}

function switchRow(title, sub, checked, onChange) {
  const row = el('div', 'row');
  const lab = el('div', 'label');
  lab.append(el('b', null, title), el('small', null, sub));
  const sw = el('label', 'sw');
  const inp = el('input');
  inp.type = 'checkbox';
  inp.checked = !!checked;
  inp.addEventListener('change', () => onChange(inp.checked));
  sw.append(inp, el('span'));
  row.append(lab, sw);
  return row;
}

/* ── 提醒 ───────────────────────────────────────────── */

const SCOPE_LABEL = Object.fromEntries(
  Object.entries(E.REMINDER_SCOPES).map(([k, v]) => [k, v.label]));

function whenText(r) {
  const w = r.when || {};
  const off = w.offsetMin || 0;
  const mag = Math.abs(off);
  const human = mag >= 60 && mag % 60 === 0 ? `${mag / 60} 小时` : `${mag} 分钟`;
  if (w.anchor === 'fixed') return `每次 ${w.time}`;
  if (w.anchor === 'next-shiftStart') {
    return off ? `明天上班前 ${human}` : '明天上班时刻';
  }
  const base = w.anchor === 'shiftEnd' ? '下班' : '上班';
  if (off === 0) return `${base}当时`;
  return off < 0 ? `${base}前 ${human}` : `${base}后 ${human}`;
}

function renderReminders() {
  const box = $('#reminders');
  box.textContent = '';
  if (!state.rules) return;
  const counts = new Map();
  for (const o of state.occurrences) counts.set(o.reminderId, (counts.get(o.reminderId) || 0) + 1);

  for (const [i, r] of state.rules.reminders.entries()) {
    const row = el('div', 'rem' + (r.enabled === false ? ' off' : ''));
    const top = el('div', 'top');
    top.append(el('b', null, r.title || '(未命名提醒)'));
    const sw = el('label', 'sw');
    const inp = el('input');
    inp.type = 'checkbox';
    inp.checked = r.enabled !== false;
    inp.addEventListener('change', () => { r.enabled = inp.checked; recompute(); });
    sw.append(inp, el('span'));
    top.append(sw);
    row.append(top);
    row.append(el('div', 'meta',
      `${SCOPE_LABEL[r.on] || r.on} · ${whenText(r)} · 共 ${counts.get(r.id) || 0} 次`));

    const edit = el('div');
    edit.style.cssText = 'display:none;margin-top:10px';
    edit.append(labeledSelect('什么时候提醒', r.on,
      Object.entries(SCOPE_LABEL), (v) => { r.on = v; recompute(); }));
    edit.append(labeledSelect('相对什么时刻', (r.when && r.when.anchor) || 'shiftStart', [
      ['shiftStart', '当天上班时刻'],
      ['shiftEnd', '当天下班时刻'],
      ['next-shiftStart', '第二天的上班时刻'],
      ['fixed', '固定钟点'],
    ], (v) => { r.when.anchor = v; recompute(); }));

    if ((r.when && r.when.anchor) === 'fixed') {
      const w = el('label', 'field');
      w.append(el('span', null, '钟点'));
      const t = el('input'); t.type = 'time'; t.value = r.when.time || '08:00';
      t.addEventListener('change', () => { if (t.value) { r.when.time = t.value; recompute(); } });
      w.append(t);
      edit.append(w);
    } else {
      const w = el('label', 'field');
      w.append(el('span', null, '提前（负）/ 推后（正）多少分钟'));
      const t = el('input'); t.type = 'number'; t.step = '5'; t.value = String(r.when.offsetMin || 0);
      t.addEventListener('change', () => { r.when.offsetMin = +t.value || 0; recompute(); });
      w.append(t);
      edit.append(w);
    }

    const tw = el('label', 'field');
    tw.append(el('span', null, '提醒文字（可用 {班次} {上班} {下班} {明日上班} {原因} {星期}）'));
    const ti = el('input'); ti.type = 'text'; ti.value = r.title;
    ti.addEventListener('change', () => { r.title = ti.value.slice(0, 80); recompute(); });
    tw.append(ti);
    edit.append(tw);

    const del = el('button', 'small danger', '删掉这条提醒');
    del.addEventListener('click', () => {
      state.rules.reminders.splice(i, 1);
      recompute();
    });
    edit.append(del);

    const more = el('button', 'small');
    more.textContent = '编辑';
    more.style.marginTop = '8px';
    more.addEventListener('click', () => {
      const open = edit.style.display === 'block';
      edit.style.display = open ? 'none' : 'block';
      more.textContent = open ? '编辑' : '收起';
    });
    row.append(more, edit);
    box.append(row);
  }
  if (!state.rules.reminders.length) {
    box.append(el('div', 'hint', '还没有提醒。点下面的「＋ 加一条提醒」。'));
  }
}

/* ── 导出 ───────────────────────────────────────────── */

function renderExport() {
  if (!state.icsStats) return;
  const s = state.icsStats;
  $('#ics-stat').textContent =
    `${state.occurrences.length} 次提醒 → ${s.events} 个日历事件` +
    (s.series ? `（${s.series} 条重复规则 + ${s.singles} 条单独事件）` : '');
  $('#cal-stat').textContent = `${state.calStats.events} 个全天事件：哪天上班、哪天补班一眼可见`;
  renderPayload();

  const hint = $('#import-hint');
  hint.textContent = '';
  hint.append(strongLine('建议先在「日历」里新建一个空日历（比如叫「班表」），导入时选它。'));
  hint.append(document.createTextNode(
    '这样以后想全部撤掉，删掉那一个日历就行；导进默认日历的话，几百条事件得一条条删。'));
  if (state.icsWarn.length) {
    for (const w of state.icsWarn) hint.append(el('div', null, '⚠️ ' + w));
  }
  // 事件数一多，导入时那张预览清单就没法看了，事后想删也是一条条删。
  // 与其让人导完才发现，不如现在就把退路一起说了。
  if (s.events > 120) {
    const d = el('div');
    d.style.marginTop = '6px';
    d.append(el('strong', null, `这份有 ${s.events} 个事件，偏多。`));
    d.append(document.createTextNode(
      state.icsMode === 'expanded'
        ? '「写法」切回「重复规则」通常能压到十条以内。'
        : '把「范围」调短一些，或者减几条提醒。'));
    hint.append(d);
  }

  const truth = $('#alarm-truth');
  truth.textContent = '';
  truth.append(strongLine('先说清楚一件事：日历提醒不是闹钟。'));
  truth.append(document.createTextNode(
    '日历的提醒是普通通知——静音开关、专注模式、定时推送摘要都会把它压掉，' +
    '不像时钟 App 的闹钟能盖过铃声开关。想让它真能把你叫醒，' +
    '要么在「设置 → 专注模式 → 允许通知」里放行日历，' +
    '要么按下面这段用快捷指令去控制真正的闹钟。'));

  renderShortcutRecipe();
  renderWebcal();
}

/**
 * webcal:// 订阅。
 *
 * 这是 iOS 上最短的一条导入路径：点一下直接弹出日历的「订阅日历」表单——
 * 不经过文件 App、不经过分享面板、不产生下载，也不受「瞬时用户激活」的时间限制，
 * 因此加到主屏之后（iOS 26 起默认就是 Web App 模式）照样能用，
 * 而 <a download> 在那个模式下普遍是失效的。
 *
 * 代价是它需要一个能公开访问的 https 地址——我们这边全部在本机算，没有服务器，
 * 所以只能由用户自己把导出的 .ics 放上去（塞进自己的仓库 / Pages / 任意网盘直链）。
 * 换来的是：以后班规变了只改那个文件，手机自动同步；不想要了删掉一个订阅即可，
 * 而不是回头去删几百条事件。
 */
function renderWebcal() {
  const why = $('#webcal-why');
  why.textContent = '';
  why.append(strongLine('如果你愿意把 .ics 放到一个公开地址上，还有一条更省事的路。'));
  why.append(document.createTextNode(
    'webcal:// 链接点一下就直接弹出日历的「订阅日历」，不用经过文件 App，' +
    '加到主屏当 app 用时也照样能点得动。订阅之后班表是自动同步的：' +
    '以后班规变了只要覆盖那个文件；不想要了删掉这一个订阅就全没了，' +
    '不用回头一条条删事件。'));

  const note = $('#webcal-note');
  note.textContent = '';
  note.append(strongLine('订阅日历有两个开关会悄悄把提醒吞掉，务必检查：'));
  const ul = document.createElement('ul');
  ul.style.cssText = 'margin:6px 0 0;padding-left:18px';
  for (const t of [
    '订阅时那张表单里如果有「移除提醒 / Remove Alarms」，要保持关闭——打开的话整份日历的提醒会被全部剥掉，日历照常显示，但一声都不会响。',
    '订阅完成后在日历 App 里点这个订阅日历的 ⓘ，确认「事件提醒」是开着的。',
    '刷新频率是订阅时选的（建议「每天」）；iOS 电量低时会推迟，所以当天早上才改的班表未必来得及同步到手机。',
  ]) {
    const li = document.createElement('li');
    li.textContent = t;
    ul.append(li);
  }
  note.append(ul);
}

/** https://… → webcal://…（其它协议一律拒绝，别拼出一条打不开的链接） */
function toWebcal(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^webcal:\/\//i.test(s)) return s;
  if (!/^https:\/\//i.test(s)) return null;
  return 'webcal://' + s.slice('https://'.length);
}

function strongLine(text) {
  const d = el('div');
  d.append(el('strong', null, text));
  d.style.marginBottom = '4px';
  return d;
}

/**
 * 把「起床闹钟」那条提醒按响铃时刻分组。
 *
 * 为什么要分组：iPhone 的时钟闹钟是「固定时刻 + 重复星期」，改不了时间。
 * 双休、大小周只有一个起床点，一个闹钟开开关关就够了；
 * 但两班倒、三班倒每天起床时间不同，单个闹钟根本表达不了——
 * 得给每个班次各建一个闹钟，每晚只打开明天那个。
 * 分组结果决定了下面生成哪一版配方，以及要给出几段班表数据。
 */
function buildWakeGroups() {
  const wake = state.rules.reminders.find((r) => r.kind === 'alarm' && r.enabled !== false)
    || state.rules.reminders.find((r) => r.enabled !== false);
  if (!wake) return { groups: [], reminder: null };
  const byTime = new Map();
  for (const o of state.occurrences) {
    if (o.reminderId !== wake.id) continue;
    if (!byTime.has(o.time)) byTime.set(o.time, []);
    byTime.get(o.time).push(o.date.replace(/-/g, ''));
  }
  const groups = [...byTime.entries()]
    .map(([time, dates]) => ({ time, dates }))
    .sort((a, b) => a.time.localeCompare(b.time));
  return { groups, reminder: wake };
}

function renderPayload() {
  const { groups } = state.wake;
  const box = $('#payload');
  const total = groups.reduce((n, g) => n + g.dates.length, 0);
  $('#payload-stat').textContent = groups.length <= 1
    ? `${total} 个上班日 · 一段数据`
    : `${groups.length} 个起床时刻 · 共 ${total} 天 · 每段各放进一个「文本」动作`;
  box.textContent = groups.length <= 1
    ? (groups[0] ? groups[0].dates.join(' ') : '')
    : groups.map((g, i) => `【第 ${i + 1} 段 · ${g.time} 的闹钟】\n${g.dates.join(' ')}`).join('\n\n');
}

function payloadForCopy() {
  const { groups } = state.wake;
  if (groups.length <= 1) return groups[0] ? groups[0].dates.join(' ') : '';
  return groups.map((g, i) => `【第 ${i + 1} 段 · ${g.time} 的闹钟】\n${g.dates.join(' ')}`).join('\n\n');
}

function renderShortcutRecipe() {
  const why = $('#shortcut-why');
  why.textContent = '';
  why.append(strongLine('为什么这里不给你一个现成的快捷指令文件？'));
  why.append(document.createTextNode(
    '因为从 iOS 15 起，快捷指令文件必须经 Apple 签名才能导入，' +
    '网页生成的 .shortcut 在 iPhone 上一律打不开——这一步只能你在手机上建一次。' +
    '好消息是只建一次：以后班规变了，只要把下面这段数据重新粘进去就行。'));

  const { groups } = state.wake;
  const multi = groups.length > 1;
  const t = (i) => (groups[i] ? groups[i].time : '07:30');

  const steps = multi ? [
    `你的班次起床时间有 ${groups.length} 个（${groups.map((g) => g.time).join('、')}）。` +
      '时钟闹钟的时间是改不了的，所以<b>每个时刻各建一个闹钟</b>：' +
      groups.map((g) => g.time).join('、') +
      '，重复都选<b>每一天</b>，建完<b>全部关掉</b>。',
    '打开「快捷指令」App，新建一个快捷指令，命名为 <code>明早上班吗</code>。',
    `加 ${groups.length} 个「文本」动作，把下面那 ${groups.length} 段班表数据<b>各粘一段</b>进去。`,
    '加「日期」动作选“当前日期”，再加「调整日期」<code>加 1 天</code>。',
    '加「格式化日期」，日期格式选“自定”，填 <code>yyyyMMdd</code>。',
    `下面这组动作重复 ${groups.length} 遍，第 n 遍对着第 n 段文本和第 n 个闹钟：` +
      '「匹配文本」（文本＝第 n 段，正则＝上一步的“已格式化日期”）→' +
      '「如果」匹配<b>有任何值</b> →「打开/关闭闹钟」选第 n 个闹钟 →' +
      '<b>打开</b>，“否则”<b>关闭</b>。',
    '回到快捷指令首页 →「自动化」→ 新建「每天」<b>22:00</b> 运行这个快捷指令，' +
      '并把“运行前询问”关掉。',
  ] : [
    `先在「时钟」里建一个闹钟，时间 <b>${t(0)}</b>，重复选<b>每一天</b>，然后把它<b>关掉</b>。`,
    '打开「快捷指令」App，新建一个快捷指令，命名为 <code>明早上班吗</code>。',
    '加「文本」动作，把下面那段班表数据整段粘进去。',
    '加「日期」动作选“当前日期”，再加「调整日期」<code>加 1 天</code>。',
    '加「格式化日期」，日期格式选“自定”，填 <code>yyyyMMdd</code>。',
    '加「匹配文本」：文本选第 3 步那个「文本」，正则填第 5 步的「已格式化日期」。',
    '加「如果」：条件是“匹配「有任何值」”。',
    `“如果”里放「打开/关闭闹钟」→ 选第 1 步那个 ${t(0)} 的闹钟 → <b>打开</b>；` +
      '“否则”里放同一个动作 → <b>关闭</b>。',
    '回到快捷指令首页 →「自动化」→ 新建「每天」<b>22:00</b> 运行这个快捷指令，' +
      '并把“运行前询问”关掉。',
  ];
  const ol = $('#recipe');
  ol.textContent = '';
  for (const s of steps) {
    const li = document.createElement('li');
    li.innerHTML = s;          // 只有上面这段写死的说明文案，不含任何用户输入
    ol.append(li);
  }

  const tail = $('#recipe-tail');
  tail.textContent = '';
  tail.append(strongLine('建好之后可以存成文件，省得下次重建。'));
  tail.append(document.createTextNode(
    '在快捷指令里点这条指令的「分享」→「导出/存储为文件」→ 权限选「任何人」，' +
    '存出来的 .shortcut 是经 Apple 签名的，换机或者给同事都能直接导入。' +
    '（网页做不到这一步：签名只能在自己的 Apple 设备上完成。）' +
    '以后班规变了也不用重建，只要把上面的班表数据重新粘进那几个「文本」动作。'));
}

/* ── 递文件给 iOS ───────────────────────────────────── */

/**
 * 必须在 click 处理器里同步调用，且 text 要提前算好。
 * 中间任何一次 await 都会让瞬时用户激活过期，navigator.share 直接抛 NotAllowedError。
 */
function handOff(text, filename) {
  const file = new File([text], filename, { type: 'text/calendar' });

  if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
    // 只放 files。带上 title/text/url 的话 iOS 会丢掉文件、改成分享那段文字。
    navigator.share({ files: [file] }).then(
      () => toast('在分享面板里选「日历」就能导入'),
      (err) => {
        // 用户自己点了取消，不该再弹一个下载出来吓他一跳
        if (err && err.name === 'AbortError') return;
        downloadFallback(text, filename);
      },
    );
    return;
  }
  downloadFallback(text, filename);
}

function downloadFallback(text, filename) {
  // blob:，绝不用 data:（Safari 14+ 屏蔽 data: 顶层导航并忽略 download）
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  // 立刻 revoke 会让 WebKit 读不到字节、下载中断，延后收
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 60000);
  toast(isStandalone()
    ? '已触发下载。主屏 App 模式下载常被 iOS 拦，建议在 Safari 里打开本页'
    : '已下载，去「文件」里点开它');
}

function copyText(text, okMsg) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast(okMsg), () => toast('复制失败，请长按手动选取'));
  } else {
    toast('复制失败，请长按手动选取');
  }
}

/* ── 事件绑定 ───────────────────────────────────────── */

const EXAMPLES = [
  '大小周，早九晚六，这周要上周六',
  '双休，早上9点上班晚上6点下班，提前一小时起床',
  '单休，8点半上班，6点下班',
  '做四休三，早八晚八',
  '三班倒',
  '我们公司996',
];

function bind() {
  const chips = $('#examples');
  for (const ex of EXAMPLES) {
    const c = el('button', 'chip', ex);
    c.addEventListener('click', () => { $('#nl').value = ex; doParse(); });
    chips.append(c);
  }

  $('#btn-parse').addEventListener('click', doParse);

  $('#btn-ai').addEventListener('click', () => {
    const panel = $('#ai-panel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      $('#ai-prompt').value = P.buildPrompt($('#nl').value || '（把你的班规写在这里）', { today: TODAY });
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
  $('#btn-close-ai').addEventListener('click', () => { $('#ai-panel').hidden = true; });
  $('#btn-copy-prompt').addEventListener('click', () => copyText($('#ai-prompt').value, '提示词已复制'));

  $('#btn-adopt').addEventListener('click', () => {
    const raw = $('#ai-json').value.trim();
    if (!raw) return toast('先把模型返回的 JSON 粘进来');
    try {
      // 模型有时会连着 ```json 围栏一起给，容忍一下
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
      const { rules, problems, uncertainties } = P.adoptRules(cleaned, { today: TODAY });
      state.rules = rules;
      state.notes = [{ label: '来源', detail: '模型解析的 JSON（已逐字段校验）', confidence: 'sure' }];
      state.asks = [
        ...problems.map((p, i) => ({ id: 'p' + i, ask: p, why: '收编时发现的问题，已按安全值兜底' })),
        ...uncertainties.map((u, i) => ({ id: 'u' + i, ask: u, why: '模型自己标出来不确定的地方' })),
      ];
      $('#ai-panel').hidden = true;
      recompute();
      toast('已采用，请逐天核对下面的日历');
    } catch (e) {
      toast('这段不是合法 JSON：' + e.message);
    }
  });

  $('#prev-m').addEventListener('click', () => { shiftMonth(-1); });
  $('#next-m').addEventListener('click', () => { shiftMonth(1); });
  $('#today-m').addEventListener('click', () => {
    state.monthCursor = TODAY.slice(0, 7);
    state.selectedDay = TODAY;
    render();
  });

  $('#months').addEventListener('change', (e) => { state.months = +e.target.value; recompute(); });
  $('#ics-mode').addEventListener('change', (e) => { state.icsMode = e.target.value; recompute(); });

  const fname = () => (state.rules && state.rules.name ? state.rules.name : 'shift') .replace(/[^一-龥\w-]/g, '');
  $('#btn-share-ics').addEventListener('click', () => handOff(state.icsText, `${fname()}-提醒.ics`));
  $('#btn-dl-ics').addEventListener('click', () => downloadFallback(state.icsText, `${fname()}-提醒.ics`));
  $('#btn-share-cal').addEventListener('click', () => handOff(state.calText, `${fname()}-班表.ics`));
  $('#btn-dl-cal').addEventListener('click', () => downloadFallback(state.calText, `${fname()}-班表.ics`));

  $('#btn-copy-payload').addEventListener('click', () =>
    copyText(payloadForCopy(), '班表数据已复制，粘到快捷指令的「文本」里'));
  $('#btn-open-shortcuts').addEventListener('click', () => { location.href = 'shortcuts://'; });

  const webcalOf = () => {
    const u = toWebcal($('#webcal-url').value);
    if (!u) toast('请填一条 https:// 开头的公开地址');
    return u;
  };
  $('#btn-webcal').addEventListener('click', () => {
    const u = webcalOf();
    if (u) location.href = u;
  });
  $('#btn-copy-webcal').addEventListener('click', () => {
    const u = webcalOf();
    if (u) copyText(u, 'webcal 链接已复制');
  });

  $('#btn-add-rem').addEventListener('click', () => {
    state.rules.reminders.push({
      id: 'r' + Date.now().toString(36), enabled: true, kind: 'event', on: 'workday',
      when: { anchor: 'shiftStart', offsetMin: -30 }, title: '新提醒', alarmsMin: [0],
    });
    recompute();
  });

  $('#btn-export-json').addEventListener('click', () => {
    copyText(JSON.stringify(state.rules, null, 2), '规则 JSON 已复制');
  });
  $('#btn-import-json').addEventListener('click', () => {
    const raw = prompt('把之前导出的规则 JSON 粘进来：');
    if (!raw) return;
    try {
      const { rules, problems } = P.adoptRules(raw, { today: TODAY });
      state.rules = rules;
      state.asks = problems.map((p, i) => ({ id: 'p' + i, ask: p, why: '导入时的兜底处理' }));
      recompute();
      toast('已导入');
    } catch (e) { toast('JSON 无法解析：' + e.message); }
  });

  $('#hol-years').textContent = Object.keys(CN_HOLIDAYS).join('、') + ' 年';
}

function shiftMonth(delta) {
  const y = +state.monthCursor.slice(0, 4), m = +state.monthCursor.slice(5, 7);
  const z = (y * 12 + (m - 1)) + delta;
  state.monthCursor = `${String(Math.floor(z / 12)).padStart(4, '0')}-${String((z % 12) + 1).padStart(2, '0')}`;
  render();
}

function doParse() {
  const text = $('#nl').value.trim();
  if (!text) return toast('先写一句你的班规');
  const { rules, notes, questions } = P.parseWorkRules(text, { today: TODAY });
  state.rules = rules;
  state.notes = notes;
  state.asks = questions;
  state.monthCursor = TODAY.slice(0, 7);
  recompute();
  $('#sec-cal').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ── 启动 ───────────────────────────────────────────── */

bind();
const saved = load();
if (saved) {
  state.rules = saved;
  state.notes = [{ label: '来源', detail: '这台设备上次存的规则', confidence: 'sure' }];
  recompute();
} else {
  render();
}

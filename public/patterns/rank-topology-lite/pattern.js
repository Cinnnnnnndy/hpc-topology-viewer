/* rank-topology-lite · pattern.js
   抽象关系图：TP2×PP2×DP2=8 卡的简化拓扑，省略 EP。
   同源 pattern：/patterns/rank-topology-3d/（完整交互版）。
   这一份只回答两件事——「这张卡挂在组织树的哪个位置」与「选中它之后，
   执行活动 / 激活驻留两组内容长什么样」，用 compute-graph-viewer 的
   抽象图网页 prompt（深色极简、语义配色、直角连线、无装饰中间层）画。
*/
(function () {
  'use strict';

  // ── 拓扑：固定 TP2×PP2×DP2，省略 EP —— 简洁版不追求覆盖完整并行度组合 ──
  var TP = 2, PP = 2, DP = 2;
  var RANKS = [];
  for (var pp = 0; pp < PP; pp++) {
    for (var tp = 0; tp < TP; tp++) {
      for (var dp = 0; dp < DP; dp++) {
        var id = pp * (TP * DP) + tp * DP + dp;
        RANKS[id] = { id: id, pp: pp, tp: tp, dp: dp, x: 100 + 200 * id };
      }
    }
  }

  var qs = new URLSearchParams(location.search);
  var embed = qs.get('embed') === '1';

  function pickRank(v) {
    var n = parseInt(v, 10);
    return isFinite(n) && n >= 0 && n < RANKS.length ? n : 0;
  }
  var state = { selected: pickRank(qs.get('rank')) };

  // ── DOM helpers：一律绝对定位在 1600×900 的 #stage 里 ──────────────────
  var stage = document.getElementById('stage');
  var svg = document.getElementById('lines');

  function el(tag, cls, box) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (box) {
      n.style.left = box.x + 'px';
      n.style.top = box.y + 'px';
      if (box.w != null) n.style.width = box.w + 'px';
      if (box.h != null) n.style.height = box.h + 'px';
    }
    n.classList.add('abs');
    stage.appendChild(n);
    return n;
  }

  function line(x1, y1, x2, y2, key) {
    var l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1);
    l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    if (key) l.dataset.key = key;
    svg.appendChild(l);
    return l;
  }

  function centered(node, cx, width) {
    node.style.left = (cx - width / 2) + 'px';
    node.style.width = width + 'px';
    node.style.textAlign = 'center';
  }

  // ── 顶栏（embed=1 时收起）───────────────────────────────────────────
  if (!embed) {
    var title = el('div', 'hdr-title');
    title.textContent = '模型分片与训练设备映射 · 简洁版';
    var run = el('div', 'hdr-run');
    run.textContent = 'Run 01 · Step 15205';
    var link = el('div', 'hdr-link');
    link.innerHTML = '<a href="../rank-topology-3d/pattern.html">完整版 · 3D →</a>';
  }

  // ── 组织树：模型 → PP → TP → Rank（DP 导航条）───────────────────────
  var rootLabel = el('div', 'node-label lbl-root', { x: 0, y: 138, h: 20 });
  rootLabel.textContent = '模型 · 24 层';
  centered(rootLabel, 800, 220);

  line(800, 158, 800, 174, 'root');
  line(400, 174, 1200, 174, 'root');
  line(400, 174, 400, 190, 'pp0');
  line(1200, 174, 1200, 190, 'pp1');

  var ppMeta = [
    { key: 'pp0', cx: 400, text: 'PP 0 · 层 0–11' },
    { key: 'pp1', cx: 1200, text: 'PP 1 · 层 12–23' }
  ];
  var ppLabels = {};
  ppMeta.forEach(function (p) {
    var n = el('div', 'node-label lbl-pp', { x: 0, y: 190, h: 22 });
    n.textContent = p.text;
    centered(n, p.cx, 320);
    ppLabels[p.key] = n;

    line(p.cx, 212, p.cx, 228, p.key);
    var tpXs = [p.cx - 200, p.cx + 200];
    line(tpXs[0], 228, tpXs[1], 228, p.key);
  });

  var tpMeta = [
    { key: 'pp0.tp0', cx: 200, text: 'TP 0' },
    { key: 'pp0.tp1', cx: 600, text: 'TP 1' },
    { key: 'pp1.tp0', cx: 1000, text: 'TP 0' },
    { key: 'pp1.tp1', cx: 1400, text: 'TP 1' }
  ];
  var tpLabels = {};
  tpMeta.forEach(function (t) {
    var ppKey = t.key.split('.')[0];
    line(t.cx, 228, t.cx, 244, ppKey);

    var n = el('div', 'node-label lbl-tp', { x: 0, y: 244, h: 20 });
    n.textContent = t.text;
    centered(n, t.cx, 140);
    tpLabels[t.key] = n;

    line(t.cx, 264, t.cx, 276, t.key);
    var dpXs = [t.cx - 100, t.cx + 100];
    line(dpXs[0], 276, dpXs[1], 276, t.key);
  });

  var rankBars = {}, rankNums = {};
  RANKS.forEach(function (r) {
    var tpKey = 'pp' + r.pp + '.tp' + r.tp;
    line(r.x, 276, r.x, 288, 'rank' + r.id);

    var bar = el('div', 'rank-bar', { x: r.x - 25, y: 288, w: 50, h: 14 });
    bar.title = 'Rank ' + r.id + ' · TP ' + r.tp + ' · PP ' + r.pp + ' · DP ' + r.dp;
    bar.addEventListener('click', function () { select(r.id); });
    rankBars[r.id] = bar;

    var num = el('div', 'rank-num', { x: r.x - 25, y: 304, w: 50, h: 16 });
    num.textContent = 'R' + r.id;
    rankNums[r.id] = num;
  });

  // ── Rank 详情：标题 → 「执行活动」/「激活驻留」两组共同标题直连各自内容卡片 ──
  var rankTitle = el('div', 'rank-title', { x: 0, y: 404, h: 24 });
  centered(rankTitle, 800, 500);

  line(800, 428, 800, 444, 'detail');
  line(450, 444, 1150, 444, 'detail');
  line(450, 444, 450, 460, 'detail');
  line(1150, 444, 1150, 460, 'detail');

  var execLabel = el('div', 'group-label', { x: 0, y: 460, h: 24 });
  execLabel.textContent = '执行活动';
  centered(execLabel, 450, 300);
  var resLabel = el('div', 'group-label', { x: 0, y: 460, h: 24 });
  resLabel.textContent = '激活驻留';
  centered(resLabel, 1150, 300);

  line(450, 484, 450, 500, 'detail');
  line(1150, 484, 1150, 500, 'detail');

  el('div', 'card', { x: 140, y: 500, w: 620, h: 300 });
  el('div', 'card', { x: 840, y: 500, w: 620, h: 300 });

  var execCaption = el('div', 'card-caption', { x: 164, y: 524, w: 400, h: 20 });

  // 前向 → 通信(AllReduce) → 反向 → 通信(AllReduce) → 优化器：宽度只表达相对占比，
  // 没有真实计时依据，因此正文与底部说明都写「示意」，不暗示精确耗时。
  var blocks = [
    { cls: 'act-fwd', w: 170, label: '前向', title: '前向计算' },
    { cls: 'act-comm', w: 40, label: '', title: '通信 · AllReduce' },
    { cls: 'act-bwd', w: 170, label: '反向', title: '反向计算' },
    { cls: 'act-comm', w: 40, label: '', title: '通信 · AllReduce' },
    { cls: 'act-opt', w: 56, label: '优化器', title: '优化器更新' }
  ];
  var bx = 180;
  blocks.forEach(function (b) {
    var block = el('div', 'act-block ' + b.cls, { x: bx, y: 592, w: b.w, h: 56 });
    block.title = b.title;
    if (b.label) {
      var lab = el('div', 'act-caption-label', { x: bx, y: 652, w: b.w, h: 14 });
      lab.textContent = b.label;
    }
    bx += b.w + 8;
  });

  var execNote = el('div', 'card-note', { x: 164, y: 760, w: 560, h: 16 });
  execNote.textContent = '长度示意 · 非实测（前向 → 通信 → 反向 → 通信 → 优化器）';

  var actCaption = el('div', 'card-caption', { x: 864, y: 524, w: 500, h: 20 });
  actCaption.textContent = 'act.norm×2 输出 · 驻留 2 层';

  el('div', 'res-bar', { x: 920, y: 592, w: 380, h: 40 });
  var spawn = el('div', 'res-diamond res-spawn', { x: 913, y: 605 });
  spawn.title = '驻留产生';
  var release = el('div', 'res-diamond res-release', { x: 1293, y: 605 });
  release.title = '释放';

  var resNote = el('div', 'card-note', { x: 864, y: 760, w: 560, h: 16 });
  resNote.textContent = '驻留区间为组织关系示意 · 长度不代表实测耗时';

  // ── 图例与状态信息（embed=1 时收起）────────────────────────────────
  if (!embed) {
    var legend = [
      { swatch: '#4469EF', label: '前向' },
      { swatch: '#FF4C7C', label: '反向' },
      { swatch: '#05D793', label: '通信' },
      { swatch: '#FFAA3B', label: '优化器' },
      { swatch: 'rgba(142,74,206,.5)', label: '激活驻留' },
      { diamond: '#A856F7', label: '驻留产生' },
      { diamond: '#88C911', label: '释放' }
    ];
    legend.forEach(function (item, i) {
      var wrap = el('div', 'legend-item', { x: 40 + i * 125, y: 850, w: 120, h: 16 });
      var sw = document.createElement('div');
      sw.className = item.diamond ? 'legend-diamond' : 'legend-swatch';
      sw.style.background = item.diamond || item.swatch;
      var lab = document.createElement('div');
      lab.className = 'legend-label';
      lab.textContent = item.label;
      wrap.appendChild(sw);
      wrap.appendChild(lab);
    });

    var status = el('div', 'status-text', { x: 1140, y: 850, w: 420, h: 16 });
    status.textContent = '抽象示意：TP2×PP2×DP2=8 卡（省略 EP）';
  }

  // ── 选中态：更新标题/说明，路径上的连线与文字保持常态，其余降低透明度 ──
  function ancestryKeys(r) {
    return ['root', 'pp' + r.pp, 'pp' + r.pp + '.tp' + r.tp, 'rank' + r.id, 'detail'];
  }

  function select(id) {
    state.selected = id;
    var r = RANKS[id];
    var keep = ancestryKeys(r);

    Array.prototype.forEach.call(svg.querySelectorAll('line'), function (l) {
      var on = keep.indexOf(l.dataset.key) !== -1;
      l.classList.toggle('dim', !on);
      l.classList.toggle('active', on && l.dataset.key !== 'detail' && l.dataset.key !== 'root');
    });
    Object.keys(ppLabels).forEach(function (k) { ppLabels[k].classList.toggle('dim', keep.indexOf(k) === -1); });
    Object.keys(tpLabels).forEach(function (k) { tpLabels[k].classList.toggle('dim', keep.indexOf(k) === -1); });
    RANKS.forEach(function (other) {
      var isSel = other.id === id;
      rankBars[other.id].classList.toggle('selected', isSel);
      rankNums[other.id].classList.toggle('selected', isSel);
      rankNums[other.id].classList.toggle('dim', !isSel);
    });

    rankTitle.textContent = 'Rank R' + id + ' · TP ' + r.tp + ' · PP ' + r.pp + ' · DP ' + r.dp;
    // 微批次编号只是让详情区随选中变化，属于同一份示意数据，不代表真实调度顺序。
    execCaption.textContent = '微批次 ' + ((id % 3) + 1) + ' / 24';

    var next = new URLSearchParams(location.search);
    next.set('rank', String(id));
    history.replaceState(null, '', location.pathname + '?' + next.toString() + location.hash);
  }
  select(state.selected);

  // ── 等比缩放：整块 1600×900 画布随可用空间缩放，不产生纵向滚动 ─────────
  function fit() {
    var scale = Math.min(window.innerWidth / 1600, window.innerHeight / 900);
    stage.style.left = ((window.innerWidth - 1600 * scale) / 2) + 'px';
    stage.style.top = ((window.innerHeight - 900 * scale) / 2) + 'px';
    stage.style.transform = 'scale(' + scale + ')';
  }
  fit();
  window.addEventListener('resize', fit);

  if (embed) stage.classList.add('embed');
})();

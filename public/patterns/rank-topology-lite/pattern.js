/* rank-topology-lite · pattern.js
   TP2×PP2×DP2=8 卡的简化拓扑，省略 EP。同源 pattern：/patterns/rank-topology-3d/
   （完整交互版，Three.js）。这一份保留「可转动的三维卡阵」这个核心比喻——world 张
   卡壳排成的三维阵列，每只装它自己那一份——但把承载它的引擎换成纯 CSS 3D
   transform（无 three.js / WebGL），并去掉六档通信切换、preset、ZeRO、物理平铺
   这些控制面板，只留「转一转、点一张卡」。
   选中之后的详情区（执行活动 / 激活驻留）沿用 compute-graph-viewer 的
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
        RANKS[id] = { id: id, pp: pp, tp: tp, dp: dp };
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

  function line(x1, y1, x2, y2) {
    var l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1);
    l.setAttribute('x2', x2); l.setAttribute('y2', y2);
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

  // ── 3D 卡阵：world=8 张卡排成 TP×PP×DP 的可转动阵列（CSS 3D，无 three.js）──
  var H = 60; // 每根轴上两个位置分别落在 -H / +H
  var cubeViewport = el('div', 'cube-viewport', { x: 550, y: 56, w: 500, h: 250 });
  var cubeWorld = document.createElement('div');
  cubeWorld.className = 'cube-world';
  cubeViewport.appendChild(cubeWorld);

  var rankCards3d = {};
  RANKS.forEach(function (r) {
    var x = r.tp === 0 ? -H : H;
    var y = r.pp === 0 ? -H : H;
    var z = r.dp === 0 ? -H : H;
    var card = document.createElement('div');
    card.className = 'rank-card3d';
    card.dataset.rank = String(r.id);
    card.style.transform = 'translate3d(' + x + 'px,' + y + 'px,' + z + 'px)';
    card.innerHTML =
      '<div class="r3d-num">R' + r.id + '</div>' +
      '<div class="r3d-sub">TP' + r.tp + '·PP' + r.pp + '·DP' + r.dp + '</div>';
    cubeWorld.appendChild(card);
    rankCards3d[r.id] = card;
  });

  var cubeHint = el('div', 'cube-hint', { x: 550, y: 312, w: 500, h: 16 });
  cubeHint.textContent = '拖动旋转 · 水平 = TP · 纵向 = PP · 深度 = DP';

  // 精确点选：8 张卡各领一条等高短横线 + 编号，和 3D 卡阵共享同一份选中态——
  // 卡阵转到某个角度时后排的卡不好点，这一条兜底可以稳定选中任意一张。
  var rankBars = {}, rankNums = {};
  var stripXs = [555, 625, 695, 765, 835, 905, 975, 1045];
  RANKS.forEach(function (r) {
    var cx = stripXs[r.id];
    var bar = el('div', 'rank-bar', { x: cx - 25, y: 336, w: 50, h: 14 });
    bar.title = 'Rank ' + r.id + ' · TP ' + r.tp + ' · PP ' + r.pp + ' · DP ' + r.dp;
    bar.addEventListener('click', function () { select(r.id, true); });
    rankBars[r.id] = bar;

    var num = el('div', 'rank-num', { x: cx - 25, y: 354, w: 50, h: 16 });
    num.textContent = 'R' + r.id;
    rankNums[r.id] = num;
  });

  // 拖动旋转 + 静置时缓慢自转；用 elementFromPoint 而不是卡片自己的 click 监听器，
  // 这样「点一下」和「拖一下」不会因为 pointer capture 打架。
  var rot = { x: -18, y: -28 };
  var dragging = false, lastX = 0, lastY = 0, moved = 0;
  function applyRot() {
    cubeWorld.style.transform = 'rotateX(' + rot.x + 'deg) rotateY(' + rot.y + 'deg)';
  }
  applyRot();

  cubeViewport.addEventListener('pointerdown', function (e) {
    dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY;
    cubeViewport.setPointerCapture(e.pointerId);
  });
  cubeViewport.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    rot.y += dx * 0.4;
    rot.x = Math.max(-70, Math.min(20, rot.x - dy * 0.4));
    applyRot();
  });
  // 转一下或选一张之后就不再自转——继续转的话，刚点亮的选中卡马上又转走了，
  // 看不清「哪张卡长什么样」。自转只服务「还没碰过」的展示态。
  var userActed = false;
  function endDrag(e) {
    dragging = false;
    if (moved >= 6) { userActed = true; return; }
    if (e.clientX != null) {
      var under = document.elementFromPoint(e.clientX, e.clientY);
      var cardEl = under && under.closest('.rank-card3d');
      if (cardEl) select(parseInt(cardEl.dataset.rank, 10), true);
    }
  }
  cubeViewport.addEventListener('pointerup', endDrag);
  cubeViewport.addEventListener('pointercancel', function () { dragging = false; });

  var lastSpin = null;
  function spin(now) {
    if (lastSpin == null) lastSpin = now;
    var dt = now - lastSpin;
    lastSpin = now;
    if (!dragging && !userActed) {
      rot.y += dt * 0.012; // 缓慢自转，拖动或选中之后停住
      applyRot();
    }
    requestAnimationFrame(spin);
  }
  requestAnimationFrame(spin);

  // ── Rank 详情：标题 → 「执行活动」/「激活驻留」两组共同标题直连各自内容卡片 ──
  var rankTitle = el('div', 'rank-title', { x: 0, y: 404, h: 24 });
  centered(rankTitle, 800, 500);

  line(800, 428, 800, 444);
  line(450, 444, 1150, 444);
  line(450, 444, 450, 460);
  line(1150, 444, 1150, 460);

  var execLabel = el('div', 'group-label', { x: 0, y: 460, h: 24 });
  execLabel.textContent = '执行活动';
  centered(execLabel, 450, 300);
  var resLabel = el('div', 'group-label', { x: 0, y: 460, h: 24 });
  resLabel.textContent = '激活驻留';
  centered(resLabel, 1150, 300);

  line(450, 484, 450, 500);
  line(1150, 484, 1150, 500);

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

  // ── 选中态：3D 卡阵与导航条共享同一份状态，其余卡适度降低透明度 ─────────
  function select(id, isUserAction) {
    state.selected = id;
    if (isUserAction) userActed = true;
    var r = RANKS[id];

    RANKS.forEach(function (other) {
      var isSel = other.id === id;
      rankCards3d[other.id].classList.toggle('selected', isSel);
      rankCards3d[other.id].classList.toggle('dim', !isSel);
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

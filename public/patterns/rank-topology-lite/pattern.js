/* rank-topology-lite · pattern.js
   盘古 ProMoE · 4000 卡（TP8×PP5×DP50×EP2）的全量三维卡阵。同源 pattern：
   /patterns/rank-topology-3d/（完整交互版）。这一份保留「world 张卡壳排成的
   立体阵列」这个核心比喻，而且是**全量**——4000 张卡真的都在场，每张都是一个
   有六个面、会被光照出明暗的立方体（THREE.BoxGeometry + InstancedMesh），
   不是拿平面卡片摆位置充数。承载它的引擎因此换回 WebGL（three.js）——
   4000 个会转动的立体实例，纯 CSS/DOM 撑不住这个规模。
   「简化」落在别处：不做六档通信切换、preset 切换、ZeRO、物理平铺，
   只留「转一转、点一张卡（或直接输入 rank 跳转）」。
   选中之后的详情区（执行活动 / 激活驻留）沿用 compute-graph-viewer 的
   抽象图网页 prompt（深色极简、语义配色、直角连线、无装饰中间层）画，
   这份 prompt 只管详情区，不管 3D 卡阵本身。
*/
(function () {
  'use strict';

  // ── 拓扑：盘古 ProMoE 的公开并行度口径（demo.html 的 pangu 预置，world=4000）──
  var TP = 8, PP = 5, DP = 50, EP = 2;
  var WORLD = TP * PP * DP * EP;

  function idOf(tp, pp, dp, ep) { return ((pp * DP + dp) * TP + tp) * EP + ep; }
  function decode(id) {
    var ep = id % EP; id = (id - ep) / EP;
    var tp = id % TP; id = (id - tp) / TP;
    var dp = id % DP; id = (id - dp) / DP;
    var pp = id;
    return { tp: tp, pp: pp, dp: dp, ep: ep };
  }

  var qs = new URLSearchParams(location.search);
  var embed = qs.get('embed') === '1';

  function pickRank(v) {
    var n = parseInt(v, 10);
    return isFinite(n) && n >= 0 && n < WORLD ? n : 0;
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

  // ── 3D 卡阵：world=4000 张卡（盘古 ProMoE 预置 TP8×PP5×DP50×EP2）全量实例化 ──
  var CANVAS_BOX = { x: 200, y: 56, w: 1200, h: 270 };
  var canvasWrap = el('div', 'cube-canvas-wrap', CANVAS_BOX);
  var canvas = document.createElement('canvas');
  canvasWrap.appendChild(canvas);

  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(CANVAS_BOX.w, CANVAS_BOX.h, false);

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  var dl = new THREE.DirectionalLight(0xffffff, 0.85);
  dl.position.set(40, 70, 90);
  scene.add(dl);
  var dlFill = new THREE.DirectionalLight(0xffffff, 0.25);
  dlFill.position.set(-50, -20, -60);
  scene.add(dlFill);

  var camera = new THREE.PerspectiveCamera(42, CANVAS_BOX.w / CANVAS_BOX.h, 0.1, 2000);

  // 网格坐标：4 个并行维只有 3 根轴可用，DP=50 又比其余几维大得多，直接拿一根轴
  // 装它会拉成一条长条（试过，难看也不好转着看）。所以把 DP 拆成 10×5 两段，
  // 分别并进深度轴与纵向轴，凑出一个更接近立方体的外形——位置因此是直觉示意，
  // 不是一张可以直接读坐标的图，选中之后的真实 (TP,PP,DP,EP) 只看下方标题文字。
  var SPACING = 1.2;
  var DP_A = 10, DP_B = DP / DP_A; // 50 = 10 × 5
  var XN = TP * EP, YN = PP * DP_B, ZN = DP_A;
  function gridPos(tp, pp, dp, ep) {
    var dpa = dp % DP_A, dpb = (dp - dpa) / DP_A;
    var xi = tp * EP + ep, yi = pp * DP_B + dpb, zi = dpa;
    return {
      x: (xi - (XN - 1) / 2) * SPACING,
      y: (yi - (YN - 1) / 2) * SPACING,
      z: (zi - (ZN - 1) / 2) * SPACING
    };
  }

  var geo = new THREE.BoxGeometry(0.92, 0.92, 0.92);
  var mat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.75, metalness: 0.05 });
  var field = new THREE.InstancedMesh(geo, mat, WORLD);
  var dummy = new THREE.Object3D();
  for (var pp = 0; pp < PP; pp++) {
    for (var dp = 0; dp < DP; dp++) {
      for (var tp = 0; tp < TP; tp++) {
        for (var ep = 0; ep < EP; ep++) {
          var p = gridPos(tp, pp, dp, ep);
          dummy.position.set(p.x, p.y, p.z);
          dummy.updateMatrix();
          field.setMatrixAt(idOf(tp, pp, dp, ep), dummy.matrix);
        }
      }
    }
  }
  scene.add(field);

  // 选中态：单独一个略大的白色描边立方体，跟到选中实例的位置——不改 InstancedMesh
  // 本身的颜色缓冲区，逻辑更简单，也不影响其余 3999 张卡的中性灰底色。多数 rank
  // 都被压在实心卡阵内部，选中它时深度测试会让高亮标记被前排的卡挡住、什么都
  // 看不见——所以关掉 depthTest，让标记穿透显示，永远看得见选的是哪张。
  var highlightGeo = new THREE.BoxGeometry(1.28, 1.28, 1.28);
  var highlight = new THREE.Mesh(highlightGeo, new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.22, depthTest: false
  }));
  var highlightEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(highlightGeo),
    new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false })
  );
  highlight.renderOrder = 999;
  highlightEdges.renderOrder = 999;
  scene.add(highlight);
  scene.add(highlightEdges);

  var cubeHint = el('div', 'cube-hint', { x: 200, y: 330, w: 1200, h: 16 });
  cubeHint.textContent = '拖动旋转 · 4000 张卡按 TP·PP·DP·EP 摆成立体阵列，位置为直觉示意 · 真实坐标看下方标题';

  // 精确点选兜底：4000 张卡没法给每张摆一个按钮，直接输入 rank 跳转最可靠——
  // 卡阵转到某个角度时，深处的卡会被前排完全挡住，点不到。
  var jumpWrap = el('div', 'rank-jump', { x: 0, y: 352, h: 26 });
  centered(jumpWrap, 800, 360);
  jumpWrap.innerHTML =
    '<span class="rank-jump-label">跳转到 Rank</span>' +
    '<input type="number" class="rank-jump-input" min="0" max="' + (WORLD - 1) + '" step="1">' +
    '<span class="rank-jump-hint">0–' + (WORLD - 1) + ' · Enter 跳转</span>';
  var jumpInput = jumpWrap.querySelector('.rank-jump-input');
  jumpInput.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var n = parseInt(jumpInput.value, 10);
    if (isFinite(n)) select(Math.max(0, Math.min(WORLD - 1, n)), true);
  });

  // 拖动旋转（球坐标手摇）+ 静置时缓慢自转；转一下或选中一张卡之后自转停住——
  // 不然刚点亮的选中卡马上又转走，看不清「哪张卡长什么样」。
  var orbit = { theta: -0.55, phi: 0.32, radius: 52 };
  function applyOrbit() {
    camera.position.set(
      orbit.radius * Math.sin(orbit.theta) * Math.cos(orbit.phi),
      orbit.radius * Math.sin(orbit.phi),
      orbit.radius * Math.cos(orbit.theta) * Math.cos(orbit.phi)
    );
    camera.lookAt(0, 0, 0);
  }
  applyOrbit();

  var dragging = false, lastX = 0, lastY = 0, moved = 0, userActed = false;
  var raycaster = new THREE.Raycaster();
  var ndc = new THREE.Vector2();

  function pick(clientX, clientY) {
    var r = canvas.getBoundingClientRect();
    ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    var hit = raycaster.intersectObject(field)[0];
    return hit ? hit.instanceId : null;
  }

  canvasWrap.addEventListener('pointerdown', function (e) {
    dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY;
    canvasWrap.setPointerCapture(e.pointerId);
  });
  canvasWrap.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    orbit.theta += dx * 0.006;
    orbit.phi = Math.max(-1.2, Math.min(1.2, orbit.phi - dy * 0.006));
    applyOrbit();
  });
  canvasWrap.addEventListener('pointerup', function (e) {
    dragging = false;
    if (moved >= 6) { userActed = true; return; }
    var id = pick(e.clientX, e.clientY);
    if (id != null) select(id, true);
  });
  canvasWrap.addEventListener('pointercancel', function () { dragging = false; });

  var lastSpin = null;
  function frame(now) {
    if (lastSpin == null) lastSpin = now;
    var dt = now - lastSpin;
    lastSpin = now;
    if (!dragging && !userActed) {
      orbit.theta += dt * 0.00015; // 缓慢自转，拖动或选中之后停住
      applyOrbit();
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ── Rank 详情：标题 → 「执行活动」/「激活驻留」两组共同标题直连各自内容卡片 ──
  var rankTitle = el('div', 'rank-title', { x: 0, y: 404, h: 24 });
  centered(rankTitle, 800, 560);

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

    var status = el('div', 'status-text', { x: 1040, y: 850, w: 520, h: 16 });
    status.textContent = '盘古 ProMoE 预置 · TP8×PP5×DP50×EP2 = 4000 卡';
  }

  // ── 选中态：高亮方块跟到选中实例位置，标题与详情区随之更新 ─────────────
  function select(id, isUserAction) {
    state.selected = id;
    if (isUserAction) userActed = true;
    var r = decode(id);
    var p = gridPos(r.tp, r.pp, r.dp, r.ep);
    highlight.position.set(p.x, p.y, p.z);
    highlightEdges.position.set(p.x, p.y, p.z);
    jumpInput.value = String(id);

    rankTitle.textContent = 'Rank R' + id + ' · TP ' + r.tp + ' · PP ' + r.pp + ' · DP ' + r.dp + ' · EP ' + r.ep;
    // 微批次编号只是让详情区随选中变化，属于同一份示意数据，不代表真实调度顺序。
    execCaption.textContent = '微批次 ' + ((id % 24) + 1) + ' / 24';

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

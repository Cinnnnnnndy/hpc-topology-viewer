/* rank-topology-lite · pattern.js
   环绕式下钻画布：中央 iframe 是 /patterns/rank-topology-3d/pattern.html 本体
   （同源嵌入，不是拷贝），矩阵/排布/六档通信/preset/ZeRO/物理平铺一个字节不碰，
   固定落在 preset=pangu·theme=dark（矩阵自己支持的深色 token，不额外注入样式）。
   下钻一张卡（矩阵页自己上报的 postMessage pto:select）就在四周浮一张卫星卡，
   连一条细线回去——结构照抄 /patterns/incident-canvas/ 的「主视图 + 卫星 + 连线」，
   实现精简，没有整段搬它的代码。
*/
(function () {
  'use strict';

  var qs = new URLSearchParams(location.search);

  // ── 中央矩阵：固定 preset=pangu·theme=dark，view/card/vtab 沿用它自己的默认值 ──
  var frame = document.getElementById('matrixFrame');
  var matrixParams = new URLSearchParams({
    embed: '1', theme: 'dark', preset: 'pangu',
    view: 'chain', card: '1', vtab: '3d'
  });
  frame.src = '../rank-topology-3d/pattern.html?' + matrixParams.toString();

  // ── 无限画布：平移 + 缩放，抄 incident-canvas 的 view={x,y,k} + flyTo 缓动 ──
  var vp = document.getElementById('viewport');
  var world = document.getElementById('world');
  var conns = document.querySelector('#conns g');
  var satLayer = document.getElementById('satLayer');
  var mainView = document.getElementById('mainView');

  var view = { x: 0, y: 0, k: 1 };
  var MINK = 0.15, MAXK = 2.2;

  function applyView() {
    world.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.k + ')';
    vp.style.setProperty('--dot', (26 * view.k) + 'px');
    vp.style.setProperty('--dotx', view.x + 'px');
    vp.style.setProperty('--doty', view.y + 'px');
    document.getElementById('zVal').textContent = Math.round(view.k * 100) + '%';
  }
  function clampK(k) { return Math.max(MINK, Math.min(MAXK, k)); }
  function zoomAt(cx, cy, nk) {
    nk = clampK(nk);
    var wx = (cx - view.x) / view.k, wy = (cy - view.y) / view.k;
    view.k = nk; view.x = cx - wx * nk; view.y = cy - wy * nk;
    applyView();
  }
  function unionBox(list) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    list.forEach(function (b) {
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  var MAIN_BOX = { x: -680, y: -400, w: 1360, h: 800 };
  var flyRAF = null;
  function flyTo(box, pad, ms) {
    var r = vp.getBoundingClientRect();
    pad = pad == null ? 44 : pad;
    var k = clampK(Math.min((r.width - pad * 2) / box.w, (r.height - pad * 2) / box.h));
    var tx = (r.width - box.w * k) / 2 - box.x * k;
    var ty = (r.height - box.h * k) / 2 - box.y * k;
    cancelAnimationFrame(flyRAF);
    if (!ms) { view.k = k; view.x = tx; view.y = ty; applyView(); return; }
    var f = { x: view.x, y: view.y, k: view.k }, t0 = performance.now();
    (function step(now) {
      var q = Math.min(1, (now - t0) / ms);
      var e = q < .5 ? 2 * q * q : 1 - Math.pow(-2 * q + 2, 2) / 2;
      view.x = f.x + (tx - f.x) * e; view.y = f.y + (ty - f.y) * e;
      view.k = f.k + (k - f.k) * e;
      applyView();
      if (q < 1) flyRAF = requestAnimationFrame(step);
    })(t0);
  }
  function fitMain(ms) { flyTo(MAIN_BOX, 90, ms == null ? 420 : ms); }
  function fitAll(ms) {
    var boxes = [MAIN_BOX];
    Object.keys(satellites).forEach(function (k) { boxes.push(satellites[k].box); });
    flyTo(unionBox(boxes), 60, ms == null ? 420 : ms);
  }

  (function () {
    var down = null;
    vp.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      if (e.target.closest('button, a, input, iframe')) return;
      down = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
      vp.classList.add('is-panning');
      vp.setPointerCapture(e.pointerId);
    });
    vp.addEventListener('pointermove', function (e) {
      if (!down) return;
      view.x = down.vx + (e.clientX - down.x);
      view.y = down.vy + (e.clientY - down.y);
      applyView();
    });
    function up(e) {
      if (!down) return;
      down = null; vp.classList.remove('is-panning');
      try { vp.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
    }
    vp.addEventListener('pointerup', up);
    vp.addEventListener('pointercancel', up);
    vp.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = vp.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, view.k * Math.exp(-e.deltaY / 380));
    }, { passive: false });
  })();

  document.getElementById('zIn').addEventListener('click', function () {
    var r = vp.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, view.k * 1.25);
  });
  document.getElementById('zOut').addEventListener('click', function () {
    var r = vp.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, view.k * 0.8);
  });
  document.getElementById('fitMainBtn').addEventListener('click', function () { fitMain(); });
  document.getElementById('fitAllBtn').addEventListener('click', function () { fitAll(); });

  // ── 卫星卡：环绕矩阵四周八个方位，下钻越多摊得越大（无限画布） ──────────
  var SLOTS = [
    { dx: 0, dy: -1 }, { dx: 1, dy: -1 }, { dx: 1, dy: 0 }, { dx: 1, dy: 1 },
    { dx: 0, dy: 1 }, { dx: -1, dy: 1 }, { dx: -1, dy: 0 }, { dx: -1, dy: -1 }
  ];
  var SAT_W = 300, SAT_H = 156;
  function slotPos(index) {
    var ring = Math.floor(index / 8) + 1, slot = SLOTS[index % 8], gap = 70 * ring;
    var cx = slot.dx === 0 ? 0 : slot.dx * (MAIN_BOX.w / 2 + gap + SAT_W / 2);
    var cy = slot.dy === 0 ? 0 : slot.dy * (MAIN_BOX.h / 2 + gap + SAT_H / 2);
    return { x: cx - SAT_W / 2, y: cy - SAT_H / 2 };
  }

  var satellites = {}; // sel(rank) -> {el, line, box}
  function mainEdgePoint(toward) {
    // 主视图边框上离卫星最近的一点，连线不穿过卡片内容。
    var cx = Math.max(MAIN_BOX.x, Math.min(MAIN_BOX.x + MAIN_BOX.w, toward.x));
    var cy = Math.max(MAIN_BOX.y, Math.min(MAIN_BOX.y + MAIN_BOX.h, toward.y));
    return { x: cx, y: cy };
  }

  function coordLabel(groups) {
    if (!groups) return '';
    var s = 'TP ' + groups.t + ' · CP ' + groups.c + ' · PP ' + groups.p + ' · DP ' + groups.d;
    if (groups.e != null) s += ' · EP ' + groups.e;
    return s;
  }

  function spawnSatellite(sel, groups) {
    if (satellites[sel]) return satellites[sel];
    var index = Object.keys(satellites).length;
    var pos = slotPos(index);
    var box = { x: pos.x, y: pos.y, w: SAT_W, h: SAT_H };

    var card = document.createElement('div');
    card.className = 'sat';
    card.style.left = pos.x + 'px';
    card.style.top = pos.y + 'px';
    card.innerHTML =
      '<div class="sat-head">' +
        '<div class="sat-title">Rank R' + sel + '</div>' +
        '<button class="sat-close" title="收起">×</button>' +
      '</div>' +
      '<div class="sat-coords">' + coordLabel(groups) + '</div>' +
      '<div class="sat-blocks">' +
        '<div class="sat-block sat-fwd" title="前向"></div>' +
        '<div class="sat-block sat-comm" title="通信"></div>' +
        '<div class="sat-block sat-bwd" title="反向"></div>' +
        '<div class="sat-block sat-comm" title="通信"></div>' +
        '<div class="sat-block sat-opt" title="优化器"></div>' +
      '</div>' +
      '<div class="sat-note">执行活动 · 长度示意，非实测</div>';
    satLayer.appendChild(card);

    var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    conns.appendChild(line);

    var rec = { el: card, line: line, box: box };
    satellites[sel] = rec;
    layoutLine(rec);

    card.querySelector('.sat-close').addEventListener('click', function () {
      card.remove(); line.remove(); delete satellites[sel];
    });

    return rec;
  }

  function layoutLine(rec) {
    var cx = rec.box.x + rec.box.w / 2, cy = rec.box.y + rec.box.h / 2;
    var edge = mainEdgePoint({ x: cx, y: cy });
    rec.line.setAttribute('x1', edge.x); rec.line.setAttribute('y1', edge.y);
    rec.line.setAttribute('x2', cx); rec.line.setAttribute('y2', cy);
  }

  // ── 盘古预置的坐标算术：仅用于 URL 深链恢复卫星卡时的本地解码——实时下钻
  // 一律信矩阵页自己 postMessage 上报的 groups（真实、可能已被用户切换过预置），
  // 这份本地小算式假设的是固定 preset=pangu，不作为运行期的权威来源。 */
  // dp=100 不是 world/(tp*cp*pp*ep)——实测矩阵页自己上报的 config.dp 就是 100：
  // EP 不是「多开一批副本卡」，是同一批 rank 内部路由去哪几个专家，不参与 rank 计数。
  var PANGU_D = { tp: 8, cp: 1, dp: 100, pp: 5, ep: 2, etp: 1, moe: true };
  function coordsOfPangu(g) {
    var D = PANGU_D;
    return {
      t: g % D.tp,
      c: Math.floor(g / D.tp) % D.cp,
      d: Math.floor(g / (D.tp * D.cp)) % D.dp,
      p: Math.floor(g / (D.tp * D.cp * D.dp)) % D.pp
    };
  }
  function epOfPangu(t, c, d) {
    var D = PANGU_D;
    var q = (d * D.cp + c) * D.tp + t;
    return { ep: Math.floor(q / D.etp) % D.ep };
  }
  function groupsOfPangu(g) {
    var co = coordsOfPangu(g);
    return { t: co.t, c: co.c, d: co.d, p: co.p, e: epOfPangu(co.t, co.c, co.d).ep };
  }

  // ── 接矩阵页自己上报的下钻事件：pto:select 是它页内换选中卡时主动发的 ────
  window.addEventListener('message', function (ev) {
    if (ev.source !== frame.contentWindow) return;
    var d = ev.data;
    if (!d || d.type !== 'pto:select') return;
    if (d.sel == null) return;
    var before = Object.keys(satellites).length;
    spawnSatellite(d.sel, d.groups);
    if (Object.keys(satellites).length !== before) fitAll();
  });

  // ── URL 深链：?sel=12,45 打开时直接摆好对应卫星卡（假设默认盘古预置） ──
  var initialSel = (qs.get('sel') || '').split(',').map(function (s) { return parseInt(s, 10); })
    .filter(function (n) { return isFinite(n) && n >= 0 && n < 4000; });
  initialSel.forEach(function (n) { spawnSatellite(n, groupsOfPangu(n)); });

  fitMain(0);
  if (initialSel.length) setTimeout(function () { fitAll(600); }, 50);

  window.addEventListener('resize', function () { fitAll(0); });
})();

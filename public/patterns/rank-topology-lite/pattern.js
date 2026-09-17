/* rank-topology-lite · pattern.js
   拓扑本身就是全屏幕的无限画布：中央 iframe 铺满整个视口，边到边，一个像素
   不缩小——它就是 /patterns/rank-topology-3d/pattern.html 本体（同源嵌入，
   不是拷贝），矩阵/排布/六档通信/preset/ZeRO/物理平铺/它自己的拖动缩放镜头，
   全部原样在场，这一层不额外包一层镜头、不裁剪任何功能。固定给它
   preset=pangu·theme=dark（它自己支持的深色 token，不额外注入样式）。

   下钻一张卡（矩阵页自己上报的 postMessage pto:select）就在屏幕右边浮一张
   卫星卡——贴在视口上，不占用、不缩小主画布本身，随时可以再点开新的一张。
*/
(function () {
  'use strict';

  var qs = new URLSearchParams(location.search);

  // ── 中央矩阵：固定 preset=pangu·theme=dark，view/card/vtab 沿用它自己的默认值 ──
  var frame = document.getElementById('matrixFrame');
  var matrixParams = new URLSearchParams({
    embed: '1', theme: 'dark', preset: 'pangu',
    view: 'chain', card: '1', vtab: '3d',
    // fastcard=1：静置态把 4000 只素壳合批成按深度分桶的几百个 <path>，
    // 不再是每只卡各自十几个 DOM 节点——只有这个简洁版自己传这个参数，
    // 直接打开 rank-topology-3d 不受影响（demo.html 里默认关闭）。
    fastcard: '1'
  });
  frame.src = '../rank-topology-3d/pattern.html?' + matrixParams.toString();

  // ── 卫星卡：贴在屏幕右边的便签层，不跟随矩阵自己的镜头缩放/平移 ─────────
  var satLayer = document.getElementById('satLayer');
  var satellites = {};

  // 不放文字标签：卡上只留 rank 号（区分哪张卡、点哪张能收起）和一条执行
  // 活动色条，没有坐标行、没有色块逐个的提示文字。「非实测」这句仍然要说真话，
  // 但不再常驻占地方——挪进 sat-blocks 自己的 title，只在悬停时才弹出来。
  function spawnSatellite(sel) {
    if (satellites[sel]) return;
    var card = document.createElement('div');
    card.className = 'sat';
    card.innerHTML =
      '<div class="sat-head">' +
        '<div class="sat-id">' + sel + '</div>' +
        '<button class="sat-close" title="收起">×</button>' +
      '</div>' +
      '<div class="sat-blocks" title="执行活动 · 长度示意，非实测">' +
        '<div class="sat-block sat-fwd"></div>' +
        '<div class="sat-block sat-comm"></div>' +
        '<div class="sat-block sat-bwd"></div>' +
        '<div class="sat-block sat-comm"></div>' +
        '<div class="sat-block sat-opt"></div>' +
      '</div>';
    satLayer.insertBefore(card, satLayer.firstChild);
    satellites[sel] = card;
    card.querySelector('.sat-close').addEventListener('click', function () {
      card.remove(); delete satellites[sel];
    });
  }

  // ── 接矩阵页自己上报的下钻事件：pto:select 是它页内换选中卡时主动发的 ────
  window.addEventListener('message', function (ev) {
    if (ev.source !== frame.contentWindow) return;
    var d = ev.data;
    if (!d || d.type !== 'pto:select' || d.sel == null) return;
    spawnSatellite(d.sel);
  });

  // ── URL 深链：?sel=12,45 打开时直接摆好对应卫星卡 ──────────────────────
  (qs.get('sel') || '').split(',').forEach(function (s) {
    var n = parseInt(s, 10);
    if (isFinite(n) && n >= 0 && n < 4000) spawnSatellite(n);
  });
})();

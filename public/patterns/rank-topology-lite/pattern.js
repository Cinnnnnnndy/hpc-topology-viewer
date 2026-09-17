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
    view: 'chain', card: '1', vtab: '3d'
  });
  frame.src = '../rank-topology-3d/pattern.html?' + matrixParams.toString();

  // ── 卫星卡：贴在屏幕右边的便签层，不跟随矩阵自己的镜头缩放/平移 ─────────
  var satLayer = document.getElementById('satLayer');
  var satellites = {};

  function coordLabel(groups) {
    if (!groups) return '';
    var s = 'TP ' + groups.t + ' · CP ' + groups.c + ' · PP ' + groups.p + ' · DP ' + groups.d;
    if (groups.e != null) s += ' · EP ' + groups.e;
    return s;
  }

  function spawnSatellite(sel, groups) {
    if (satellites[sel]) return;
    var card = document.createElement('div');
    card.className = 'sat';
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
    satLayer.insertBefore(card, satLayer.firstChild);
    satellites[sel] = card;
    card.querySelector('.sat-close').addEventListener('click', function () {
      card.remove(); delete satellites[sel];
    });
  }

  // ── 盘古预置的坐标算术：仅用于 URL 深链恢复卫星卡时的本地解码——实时下钻
  // 一律信矩阵页自己 postMessage 上报的 groups（真实、可能已被用户切换过预置），
  // 这份本地小算式假设的是固定 preset=pangu，不作为运行期的权威来源。
  // world=4000=TP8×PP5×DP100：EP2 是同批 rank 内部的路由维度，不参与 rank 计数
  // （实测矩阵页上报的 config.dp 就是 100，不是按 world/(tp·cp·pp·ep) 算出的 50）。
  var PANGU_D = { tp: 8, cp: 1, dp: 100, pp: 5, ep: 2, etp: 1 };
  function coordsOfPangu(g) {
    var D = PANGU_D;
    return {
      t: g % D.tp,
      c: Math.floor(g / D.tp) % D.cp,
      d: Math.floor(g / (D.tp * D.cp)) % D.dp,
      p: Math.floor(g / (D.tp * D.cp * D.dp)) % D.pp
    };
  }
  function groupsOfPangu(g) {
    var co = coordsOfPangu(g);
    var q = (co.d * PANGU_D.cp + co.c) * PANGU_D.tp + co.t;
    return { t: co.t, c: co.c, d: co.d, p: co.p, e: Math.floor(q / PANGU_D.etp) % PANGU_D.ep };
  }

  // ── 接矩阵页自己上报的下钻事件：pto:select 是它页内换选中卡时主动发的 ────
  window.addEventListener('message', function (ev) {
    if (ev.source !== frame.contentWindow) return;
    var d = ev.data;
    if (!d || d.type !== 'pto:select' || d.sel == null) return;
    spawnSatellite(d.sel, d.groups);
  });

  // ── URL 深链：?sel=12,45 打开时直接摆好对应卫星卡（假设默认盘古预置） ──
  (qs.get('sel') || '').split(',').forEach(function (s) {
    var n = parseInt(s, 10);
    if (isFinite(n) && n >= 0 && n < 4000) spawnSatellite(n, groupsOfPangu(n));
  });
})();

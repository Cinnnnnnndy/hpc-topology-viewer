/* rank-topology-lite · pattern.js
   没点开卡：逻辑魔方 iframe 在最上层（盘古 ProMoE 预置，WebGL 实例化网格，
   素块、无标签、无性能问题——这正是"未点击之前"想要的默认视图，不在 SVG
   矩阵里另外拼一套弱化渲染）。
   点开一张卡：逻辑魔方自己 postMessage 上报 rubik-select，这一层把它的
   (tp,pp,rep) 坐标换算成并行拓扑矩阵自己的 rank 编号，把矩阵 iframe 换到
   最上层并带上 ?sel=——矩阵本体自己的选中态渲染（真实坐标、内存/容量读出、
   六档通信、兄弟卡高亮）原样接管，这一层不重画一遍。
*/
(function () {
  'use strict';

  var qs = new URLSearchParams(location.search);

  var rubikFrame = document.getElementById('rubikFrame');
  var matrixFrame = document.getElementById('matrixFrame');
  var backBtn = document.getElementById('backBtn');

  // ── 逻辑魔方：固定盘古 ProMoE 预置（tp8·pp5·dp100·ep2 = 4000 卡），深色主题 ──
  var rubikParams = new URLSearchParams({ theme: 'dark', tp: '8', pp: '5', dp: '100', ep: '2' });
  rubikFrame.src = '../../rubik-pattern.html?' + rubikParams.toString();

  // ── 并行拓扑矩阵：固定 preset=pangu·theme=dark，view/card/vtab 沿用它自己的默认值 ──
  // fastcard=1：矩阵共用的 demo.html 里的可选参数，默认关闭——这个简洁版传了它，
  // 详情态才会「不画坐标轴/EP 组框、无关联的卡直接不画、选中即飞焦、取消选中飞回
  // 默认机位」；不传就是 rank-topology-3d 自己原本的样子（标签/群组色照常画）。
  function matrixSrcFor(matrixSel) {
    var p = new URLSearchParams({
      embed: '1', theme: 'dark', preset: 'pangu', fastcard: '1',
      view: 'chain', card: '1', vtab: '3d', sel: String(matrixSel)
    });
    return '../rank-topology-3d/pattern.html?' + p.toString();
  }

  /* 逻辑魔方与并行拓扑矩阵各自实现了一遍"rank ↔ (tp,pp,dp) 坐标"的换算，
     内部打包顺序不一样，同一个数字在两边指的不是同一张卡：
       逻辑魔方（pattern.js）  rankOf = (rep*PP + pp) * TP + tp
       并行拓扑（demo.html）   rankOf = (pp*DP + dp) * TP + tp   （cp 固定 0）
     只有 tp 在两边都是最内层（同一个 %TP），pp/dp(rep) 的打包顺序不同，
     所以必须按坐标三元组换算，不能把 rank 数字直接抄过去——实测验证过：
     逻辑魔方 rank 830（tp6·pp3·rep20）对应并行拓扑 rank 2566，矩阵本体
     读出的坐标正是 tp6·cp0·dp20·pp3，与逻辑魔方报的坐标逐位一致。 */
  var MATRIX_D = { tp: 8, dp: 100 };
  function rubikSelToMatrixSel(sel) {
    return (sel.pp * MATRIX_D.dp + sel.rep) * MATRIX_D.tp + sel.tp;
  }

  function showDetail(matrixSel) {
    matrixFrame.src = matrixSrcFor(matrixSel);
    matrixFrame.classList.remove('is-hidden');
    rubikFrame.classList.add('is-hidden');
    backBtn.classList.remove('is-hidden');
  }

  function showOverview() {
    matrixFrame.classList.add('is-hidden');
    rubikFrame.classList.remove('is-hidden');
    backBtn.classList.add('is-hidden');
  }

  backBtn.addEventListener('click', showOverview);

  // ── 接逻辑魔方自己上报的下钻事件：rubik-select 是它页内换选中卡时主动发的 ──
  window.addEventListener('message', function (ev) {
    if (ev.source !== rubikFrame.contentWindow) return;
    var d = ev.data;
    if (!d || d.type !== 'rubik-select') return;
    if (d.sel && d.sel.rank != null) showDetail(rubikSelToMatrixSel(d.sel));
    else showOverview();
  });

  // ── URL 深链：?sel=<并行拓扑矩阵自己的 rank 编号> 打开时直接进详情态 ──────
  var qsel = parseInt(qs.get('sel'), 10);
  if (isFinite(qsel) && qsel >= 0 && qsel < 4000) showDetail(qsel);
})();

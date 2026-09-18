/* rank-topology-lite · pattern.js
   "无限画布"分三档取景，档位的真相全在矩阵 iframe 自己身上，这一层只是转发
   坐标、跟读档位、按档位摆宿主自己的 chrome（返回按钮、悬浮数据卡）：
     1 集群       —— 逻辑魔方 iframe 在最上层（盘古 ProMoE 预置，WebGL 实例化
                     网格，素块、无标签、无性能问题——这正是"未点击之前"想要的
                     默认视图，不在 SVG 矩阵里另外拼一套弱化渲染）。
     2 选中+兄弟   —— 逻辑魔方自己 postMessage 上报 rubik-select，这一层把它的
                     (tp,pp,rep) 坐标换算成并行拓扑矩阵自己的 rank 编号，把矩阵
                     iframe 换到最上层并带上 ?sel=——矩阵本体自己的选中态渲染
                     （真实坐标、内存/容量读出、六档通信、兄弟卡高亮）原样
                     接管，这一层不重画一遍。
     3 单卡下钻   —— 矩阵 iframe 内部再点一次选中卡，它自己切到 soloCard，
                     连兄弟卡也隐去；这一层不换 iframe，只跟着它上报的
                     pto:tier 消息换一档 chrome。
   退档同一条规矩——点空白/点返回按钮一次退一档，不直接甩回最外层，
   由矩阵 iframe 通过 pto:tier 消息把真实档位报回来，这一层永远是跟读，
   不自己猜。
*/
(function () {
  'use strict';

  var qs = new URLSearchParams(location.search);

  var rubikFrame = document.getElementById('rubikFrame');
  var matrixFrame = document.getElementById('matrixFrame');
  var backBtn = document.getElementById('backBtn');
  var briefCard = document.getElementById('briefCard');

  // ── 逻辑魔方：固定盘古 ProMoE 预置（tp8·pp5·dp100·ep2 = 4000 卡），深色主题 ──
  // color=neutral：默认就是素色（中性灰），不是负载热力橙→粉——这个简洁版要的
  // 默认态是"先看形状、不看颜色"，颜色留给选中/告警这些真正需要强调的状态。
  // 逻辑魔方自己独立打开（/rubik-pattern.html）默认仍是负载热力，这个参数只在
  // 这里传，不改它自己的默认值。
  // groupgap=3：拉开 tp/pp/dp/ep 各组之间的缝，4000 卡这种规模下"这是几段/几片"
  // 才读得出来——独立打开的 /rubik-pattern.html 默认 1（原样间距），这个参数
  // 只在这里传，呼应"默认状态下参考并行拓扑拉大间距、让分组更明显"那条反馈。
  var rubikParams = new URLSearchParams({ theme: 'dark', tp: '8', pp: '5', dp: '100', ep: '2', color: 'neutral', groupgap: '3' });
  rubikFrame.src = '../../rubik-pattern.html?' + rubikParams.toString();

  // ── 并行拓扑矩阵：固定 preset=pangu·theme=dark，view/card/vtab 沿用它自己的默认值 ──
  // fastcard=1：矩阵共用的 demo.html 里的可选参数，默认关闭——这个简洁版传了它，
  // 详情态才会「不画坐标轴/EP 组框、无关联的卡直接不画、选中即飞焦、取消选中飞回
  // 默认机位」；不传就是 rank-topology-3d 自己原本的样子（标签/群组色照常画）。
  // mono=1：整屏收成黑白灰阶——维度签名色、显存成分色、通信芯片、容量告警棱线、
  // 卡面填充一起退回中性（见 demo.html 里 ui.mono/VC_MONO/MEM_MONO 那段）。
  // 早先只传窄一档的 neutralsibs（只收兄弟卡棱线）时，芯片文字与卡面填充还是
  // 漏网的——"这里描边和填充还是不对"那条反馈说的正是这个缺口；mono 是同一件
  // 事的完整版，rank-topology-3d/net-slicing/model-netgraph 独立打开一个字节不变。
  function matrixSrcFor(matrixSel) {
    var p = new URLSearchParams({
      embed: '1', theme: 'dark', preset: 'pangu', fastcard: '1', mono: '1',
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

  /* ── 三档取景（"无限画布"就是这三档，矩阵本体 demo.html 里 ptoTier() 那段
     注释写的是同一件事，这里是宿主这一侧）──────────────────────────────
       1 集群       —— 逻辑魔方铺满，没有选中任何卡
       2 选中+兄弟   —— 矩阵接管，选中卡与它的兄弟卡都画，无关卡隐去
       3 单卡下钻    —— 再往里一层，连兄弟卡也隐去，看的是这一张卡内部
     档位真正的主人是矩阵 iframe 自己（sel / ui.soloCard 两个状态读出来的结论，
     见 demo.html 的 ptoTier()）；这里的 tier 只是**跟读**它通过 pto:tier
     报上来的数，不自己决定档位该是几——矩阵那边换档既可能来自宿主转发的
     指令，也可能来自画布上直接点击/点空白，宿主必须以它上报的为准。 */
  var tier = 1;

  function showDetail(matrixSel) {
    matrixFrame.src = matrixSrcFor(matrixSel);
    matrixFrame.classList.remove('is-hidden');
    rubikFrame.classList.add('is-hidden');
    backBtn.classList.remove('is-hidden');
    backBtn.textContent = '← 返回魔方视图';
    tier = 2;
    hideBrief();
  }

  function showOverview() {
    matrixFrame.classList.add('is-hidden');
    rubikFrame.classList.remove('is-hidden');
    backBtn.classList.add('is-hidden');
    tier = 1;
    hideBrief();
  }

  /* 返回按钮跟"点空白处"走同一条规矩——一次退一档，不是直接甩回最外层：
     第三档（单卡下钻）点一下退到第二档（选中+兄弟），矩阵 iframe 不用重新
     加载，只发一句 pto:tier 指令让它自己切换；已经在第二档才整层退回魔方。 */
  function stepBack() {
    if (tier === 3 && matrixFrame.contentWindow) {
      matrixFrame.contentWindow.postMessage({ type: 'pto:tier', tier: 2 }, '*');
      return;
    }
    showOverview();
  }
  backBtn.addEventListener('click', stepBack);

  // ── 接逻辑魔方自己上报的下钻事件：rubik-select 是它页内换选中卡时主动发的 ──
  // ── 接矩阵本体上报的换档事件：pto:tier 带着 {tier, sel, brief}，brief 是它
  //    已经算好的这只卡摘要（容量/层段/兄弟数/显存构成）——宿主自己不重算一遍，
  //    两边数字对不上是最难查的那种错。 ─────────────────────────────────
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d) return;
    if (ev.source === rubikFrame.contentWindow) {
      if (d.type !== 'rubik-select') return;
      if (d.sel && d.sel.rank != null) showDetail(rubikSelToMatrixSel(d.sel));
      else showOverview();
      return;
    }
    if (ev.source === matrixFrame.contentWindow) {
      if (d.type !== 'pto:tier') return;
      if (d.tier === 1) { showOverview(); return; }
      tier = d.tier;
      backBtn.textContent = tier === 3 ? '← 返回选中+兄弟' : '← 返回魔方视图';
      renderBrief(d.brief, tier);
    }
  });

  function hideBrief() {
    briefCard.classList.add('is-hidden');
    briefCard.innerHTML = '';
  }

  /* 悬浮数据卡：只在第二/三档出现（第一档——集群整体——目前没有现成的、
     已经算好的聚合读数可用，宁可不摆牌子也不在浮卡上编数字）。内容全部来自
     矩阵上报的 brief，不自己再算一遍；第三档多摆一份显存构成明细，因为那正是
     这一档要下钻着看的东西。level 只用字重/说法分挡，不引入色相——呼应
     "默认关掉颜色只有黑白"那条反馈，浮卡本身也不例外。 */
  var CAP_LABEL = { oom: '⚠ 超出容量', red: '⚠ 逼近红线', amber: '临界（黄线）', ok: '正常' };
  function renderBrief(brief, tier9) {
    if (!brief) { hideBrief(); return; }
    var gb = function (v) { return (Math.round(v * 10) / 10) + ' GB'; };
    var capBadge = '<span class="brief-badge' + (brief.cap.level === 'ok' ? '' : ' is-alert') + '">'
      + (CAP_LABEL[brief.cap.level] || brief.cap.level) + '</span>';
    var html = '<div class="brief-h">rank ' + brief.rank + capBadge + '</div>'
      + '<div class="brief-sub">tp' + brief.coord.tp + ' cp' + brief.coord.cp + ' dp' + brief.coord.dp
      + ' pp' + brief.coord.pp + (brief.coord.ep != null ? ' ep' + brief.coord.ep : '')
      + ' · L' + brief.layers.lo + '–L' + brief.layers.hi + '</div>';
    if (tier9 === 3) {
      html += brief.segs.map(function (s) {
        return '<div class="brief-row"><span>' + s.label + '</span><b>' + gb(s.gb) + '</b></div>';
      }).join('');
      html += '<div class="brief-row brief-total"><span>合计 / ' + brief.hbm + ' GB</span><b>' + gb(brief.cap.totGB) + '</b></div>';
    } else {
      html += '<div class="brief-row"><span>兄弟卡</span><b>' + brief.sibs + ' 张</b></div>'
        + '<div class="brief-row brief-total"><span>显存</span><b>' + gb(brief.cap.totGB) + ' / ' + brief.hbm + ' GB</b></div>';
    }
    briefCard.innerHTML = html;
    briefCard.classList.remove('is-hidden');
  }

  // ── URL 深链：?sel=<并行拓扑矩阵自己的 rank 编号> 打开时直接进详情态 ──────
  var qsel = parseInt(qs.get('sel'), 10);
  if (isFinite(qsel) && qsel >= 0 && qsel < 4000) showDetail(qsel);
})();

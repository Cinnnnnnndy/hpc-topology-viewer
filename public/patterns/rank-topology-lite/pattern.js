/* rank-topology-lite · pattern.js
   规模够大才值得用逻辑魔方当默认层（世界卡数 world ≤ 64 时，矩阵本体自己
   一屏就够清楚——64 张卡的 SVG 阵列不存在密度/性能问题，逻辑魔方那层
   "先看形状"的价值这时反而是多绕一圈）。按这条规则分两条路：

   world ≤ 64：直接铺满并行拓扑矩阵本体的原页（不传 fastcard/mono/solo，
     就是 rank-topology-3d 独立打开的样子），没有逻辑魔方、没有返回按钮、
     没有三档——矩阵自己的"选中/取消选中"手势已经够用，不必再包一层。

   world > 64（默认，盘古 ProMoE·4000 卡）："无限画布"分三档取景，档位越
   往里，画得越少、看得越细：
     1 集群       —— 逻辑魔方铺满，没有选中任何卡。
     2 选中+兄弟   —— 逻辑魔方里点一张方块，**留在逻辑魔方自己身上**：它自带
                     的"卡内魔方"局部聚焦（选中卡与它所在的行列一起被摄像机
                     框住，中间浮出这张卡自己的层/算子构成）已经是干净的效果，
                     不必换到矩阵那一屏再画一遍——矩阵在这个规模下要给每张
                     兄弟卡都摆通信芯片/容量告警，牌子挤在一起反而更花。
                     宿主右下角浮出一句极简的"↓ 单卡下钻"邀请，点了才进详情。
     3 单卡下钻    —— 点那句邀请，才真正换到并行拓扑矩阵本体（fastcard=1&
                     solo=1）：连兄弟卡也隐去，看的是这一张卡内部的填充版
                     ——真实容量读出、显存构成明细（保留原本的彩色：权重/
                     梯度/优化器态/专家/激活各自的颜色在说"这一块字节是
                     什么"，现在只服务一张卡，不会跟别的卡的颜色打架）、
                     卡内那一级通信。
   退档同一条规矩——点空白/点返回按钮一次退一档：第 3→2 档不换 iframe，
   只让矩阵切自己的 soloCard（一句 pto:tier 指令）；第 2→1 档才真的把矩阵
   藏起来，回到逻辑魔方（它本来就还停在原地，不用重新加载）。tier2 完全
   不涉及 iframe 切换，天然没有闪烁——切换的"丝滑"就是靠少切一次做到的，
   不是靠更长的过渡动画补出来的。
*/
(function () {
  'use strict';

  var qs = new URLSearchParams(location.search);

  var rubikFrame = document.getElementById('rubikFrame');
  var matrixFrame = document.getElementById('matrixFrame');
  var backBtn = document.getElementById('backBtn');
  var briefCard = document.getElementById('briefCard');

  /* 两档预置，world = tp×pp×dp（EP 折在 DP 内部，不进世界卡数——两个本体
     的 README 都确认过这个口径）。默认盘古 ProMoE，world=4000，走三档取景；
     ?preset=dense64 是 demo.html 自己现成的 64 卡预置，用来验证"world ≤ 64
     直接显示矩阵原页"这条规则确实会触发，不是摆着不用的死分支。
     modelName：全部命名/面包屑的唯一来源——不编一个新名字，直接抄 demo.html
     自己 PRESETS 数组里给这个 preset 起的名字（那份是"模型叫什么"这件事的
     权威出处），这一层不重复维护第二份。 */
  var PRESETS = {
    pangu: { tp: 8, pp: 5, dp: 100, ep: 2, matrixPreset: 'pangu', modelName: '盘古 ProMoE' },
    dense64: { tp: 4, pp: 4, dp: 4, ep: 1, matrixPreset: 'dense64', modelName: '稠密预置' }
  };
  var PS = PRESETS[qs.get('preset')] || PRESETS.pangu;
  var world = PS.tp * PS.pp * PS.dp;

  if (world <= 64) {
    /* 规模小：矩阵本体自己一屏就是全部——不铺逻辑魔方、不裁剪它的任何交互，
       与直接打开 /patterns/rank-topology-3d/ 逐字节相同。stitle 换成模型
       名称，跟三档取景那条路用的是同一个名字来源，不是另起一套说法。 */
    var plainP = new URLSearchParams({
      embed: '1', theme: 'dark', preset: PS.matrixPreset, card: '1', view: 'chain', vtab: '3d',
      stitle: PS.modelName + ' · ' + world + ' 卡'
    });
    matrixFrame.src = '../rank-topology-3d/pattern.html?' + plainP.toString();
    matrixFrame.classList.remove('is-hidden');
    rubikFrame.classList.add('is-hidden');
    return;
  }

  // ── 逻辑魔方：固定当前预置，深色主题 ──────────────────────────────────
  // color=neutral：默认就是素色（中性灰），不是负载热力橙→粉——这个简洁版要的
  // 默认态是"先看形状、不看颜色"，颜色留给选中/告警这些真正需要强调的状态。
  // 逻辑魔方自己独立打开（/rubik-pattern.html）默认仍是负载热力，这个参数只在
  // 这里传，不改它自己的默认值。
  // groupgap=3：拉开 tp/pp/dp/ep 各组之间的缝，这种规模下"这是几段/几片"才
  // 读得出来——独立打开的 /rubik-pattern.html 默认 1（原样间距），这个参数
  // 只在这里传，呼应"默认状态下参考并行拓扑拉大间距、让分组更明显"那条反馈。
  // brand=：逻辑魔方顶栏那块"逻辑魔方"招牌换成模型名称——同一条"用模型
  // 名称做全部命名"的规矩，这一层管得到的每一处都不留生造的产品名。
  // cclabels=0：收起"卡内魔方"那两枚钉在 3D 世界坐标上的字牌（行末算子名 +
  // 顶部"卡内 · L.."标题）——它们跟着相机转，规模一大会飘到这一层自己的
  // 悬浮数据卡/返回按钮那片地界上，跟已经在讲同一句话的右侧详情卡叠在一起
  // （反馈原话"不再这里显示只显示右侧卡片就好"）。彩色小格阵列本身照常画，
  // 少的只是文字；独立打开 /rubik-pattern.html 不受影响，默认还画这两枚牌。
  // axsel=0：选中一张卡时收起"贴在几何体上"那类轴刻度字牌（TP0/PP3 这种，
  // 世界尺寸固定）——第二档的镜头贴得极近（"局部聚焦"），这类字牌会占满
  // 大半个画布、糊住选中卡自己的坐标读出。坐标信息本来就写在 DOM 侧栏与
  // 悬浮数据卡里，画布里不用再重复一遍。
  // cc=0：选中一张卡时画布里那圈"卡内魔方"彩色小格阵列整个不画了——不只是
  // 字牌（cclabels 管那个），是格子本身。反馈原话"不是说去色的问题，是
  // 不要在画布中显示"：同一句话（rank / 层区间 / 对象持有情况）右侧详情卡
  // 已经摆得清清楚楚，画布这层不用再重复一份彩色阵列；"卡片还是保留彩色"
  // 指的是右侧详情卡与装载清单的颜色，那两处不受这条影响，独立打开
  // /rubik-pattern.html 也不受影响，默认还画这圈格子。
  var rubikParams = new URLSearchParams({
    theme: 'dark', tp: String(PS.tp), pp: String(PS.pp), dp: String(PS.dp), ep: String(PS.ep),
    color: 'neutral', groupgap: '3', brand: PS.modelName, cclabels: '0', axsel: '0', cc: '0'
  });
  rubikFrame.src = '../../rubik-pattern.html?' + rubikParams.toString();

  // ── 并行拓扑矩阵：只在第三档才加载，固定带 fastcard=1&solo=1 ─────────────
  // fastcard=1：矩阵共用的 demo.html 里的可选参数，默认关闭——这个简洁版传了它，
  // 详情态才会「不画坐标轴/EP 组框、无关联的卡直接不画、选中即飞焦」；不传就是
  // rank-topology-3d 自己原本的样子（标签/群组色照常画）。
  // solo=1：连兄弟卡也隐去，只看这一张卡内部——矩阵现在只在第三档才被打开，
  // 打开就直接是这一档，不必先落在"选中+兄弟"再等一次点击才往里走。
  // 不传 mono：早先给这一档也传过 mono=1（整屏收黑白灰阶），但反馈原话
  // "选中之后的内部填充维持之前的彩色"——显存构成（权重/梯度/优化器态/
  // 专家/激活…）各自的颜色不是装饰，是在说"这一块字节是什么"，solo 视图
  // 现在只服务一张卡（不再是一整条兄弟行），色相不会跟别的卡打架，彩色
  // 反而比黑白更好读。mono 继续保留给 rank-topology-3d/net-slicing/
  // model-netgraph 这类会同屏画很多卡、需要收敛色相的场景用。
  // stitle：矩阵原生的画布名字接管这块地时，续用同一个模型名称（"用模型
  // 名称来做全部的命名和面包屑"）——不换一套说法，读者从第二档点进来，
  // 左上角那行字只是从这一层渲染的换成矩阵自己渲染的，内容不跳。
  function matrixSrcFor(matrixSel) {
    var p = new URLSearchParams({
      embed: '1', theme: 'dark', preset: PS.matrixPreset, fastcard: '1', solo: '1',
      view: 'chain', card: '1', vtab: '3d', sel: String(matrixSel),
      stitle: PS.modelName + ' · rank ' + matrixSel
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
  function rubikSelToMatrixSel(sel) {
    return (sel.pp * PS.dp + sel.rep) * PS.tp + sel.tp;
  }

  var tier = 1;
  var pendingMatrixSel = null;   // 第二档选中的那张卡，换算好的矩阵 rank——第三档就是拿它去开矩阵

  /* 三档的"这是什么"这句话，全部交给当前显示的那个 iframe 自己的原生标题说，
     这一层不再另起一块牌子重复一遍：第一/二档是逻辑魔方自己的顶栏招牌
     （见 rubikParams 的 brand=，已经从它自己的默认名"逻辑魔方"换成模型
     名称）与它选中后自己浮出的"RANK / rank N"身份面板；第三档是矩阵自己的
     画布名字（见 matrixSrcFor 的 stitle=）。三处名字同一个来源（PS.modelName），
     读起来是一句话，不是宿主外挂一层跟原生标题抢地、还经常撞在一起的重复牌子。 */

  function showOverview() {
    matrixFrame.classList.add('is-hidden');
    rubikFrame.classList.remove('is-hidden');
    backBtn.classList.add('is-hidden');
    tier = 1;
    pendingMatrixSel = null;
    hideBrief();
  }

  /* 第二档：留在逻辑魔方身上，只换宿主自己这层的 chrome——返回按钮出现，
     右下角浮出"下钻"邀请。逻辑魔方的选中态是它自己的事（这一刻画面早就是
     对的，从来路径无关：可能是它刚刚 postMessage 报过来的新选中，也可能是
     从第三档退回来、它本来就还停在原地没变过），这个函数从不碰 rubikFrame，
     只管 sel（换算好的矩阵 rank，供下钻按钮用）与 subLine（下钻邀请那一行
     副标题，两条来路各自负责按自己手上有的坐标格式拼好再传进来）。 */
  function showTier2(matrixSel, subLine) {
    matrixFrame.classList.add('is-hidden');
    rubikFrame.classList.remove('is-hidden');
    backBtn.classList.remove('is-hidden');
    backBtn.textContent = '← 返回魔方视图';
    tier = 2;
    pendingMatrixSel = matrixSel;
    renderDrillInvite(matrixSel, subLine);
  }

  /* 第三档：真正换到矩阵那一屏，solo=1 直接落在"只看这一只"。 */
  function showDetail(matrixSel) {
    matrixFrame.src = matrixSrcFor(matrixSel);
    matrixFrame.classList.remove('is-hidden');
    rubikFrame.classList.add('is-hidden');
    backBtn.classList.remove('is-hidden');
    backBtn.textContent = '← 返回选中+兄弟';
    tier = 3;
    hideBrief();
  }

  /* 返回按钮跟"点空白处"走同一条规矩——一次退一档，不是直接甩回最外层：
     第三档点一下退到第二档，矩阵 iframe 不用重新加载，只发一句 pto:tier
     指令让它自己切换（切完它会自己上报新档位，交给下面的消息监听器接住）；
     第二档点一下才真的把矩阵藏起来、回到逻辑魔方。 */
  function stepBack() {
    if (tier === 3 && matrixFrame.contentWindow) {
      matrixFrame.contentWindow.postMessage({ type: 'pto:tier', tier: 2 }, '*');
      return;
    }
    showOverview();
  }
  backBtn.addEventListener('click', stepBack);

  // ── 接逻辑魔方自己上报的选中事件：rubik-select 是它页内换选中卡时主动发的——
  //    选中就是第二档，取消选中（点空白，它自己原有的手势）就退回第一档。 ──
  // ── 接矩阵本体上报的换档事件：pto:tier 带着 {tier, sel, brief}。矩阵现在
  //    只在第三档才被打开，收到 tier<3（矩阵里点空白退出 soloCard）就说明
  //    读者要退回第二档——切回逻辑魔方（它一直还停在原地、选中态没变过），
  //    副标题这时改用矩阵自己上报的 brief.coord/layers 拼（跟逻辑魔方自己
  //    的 tp/pp/rep 是两套坐标格式，不能混用同一个拼法）。 ──
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d) return;
    if (ev.source === rubikFrame.contentWindow) {
      if (d.type === 'rubik-drill') {
        /* 再点一次已经选中的那张方块 = 下钻——逻辑魔方自己报的坐标已经够
           换算出矩阵 rank，不用等 pendingMatrixSel（用户可能从深链或退档
           回来，那个变量这一刻不一定是这张卡），直接算一遍最准。 */
        if (d.sel && d.sel.rank != null) showDetail(rubikSelToMatrixSel(d.sel));
        return;
      }
      if (d.type !== 'rubik-select') return;
      if (d.sel && d.sel.rank != null) {
        var st9 = d.sel.stage;
        showTier2(rubikSelToMatrixSel(d.sel), 'tp' + d.sel.tp + ' pp' + d.sel.pp + ' rep' + d.sel.rep
          + (st9 ? ' · L' + st9.lo + '–L' + st9.hi : ''));
      } else showOverview();
      return;
    }
    if (ev.source === matrixFrame.contentWindow) {
      if (d.type !== 'pto:tier') return;
      if (d.tier === 3) {
        tier = 3;
        backBtn.textContent = '← 返回选中+兄弟';
        renderBrief(d.brief);
      } else if (d.sel != null && d.brief) {
        showTier2(d.sel, 'tp' + d.brief.coord.tp + ' cp' + d.brief.coord.cp + ' dp' + d.brief.coord.dp
          + ' pp' + d.brief.coord.pp + (d.brief.coord.ep != null ? ' ep' + d.brief.coord.ep : '')
          + ' · L' + d.brief.layers.lo + '–L' + d.brief.layers.hi);
      } else {
        showOverview();
      }
    }
  });

  function hideBrief() {
    briefCard.classList.remove('is-cta');
    briefCard.classList.add('is-hidden');
    briefCard.innerHTML = '';
  }

  /* 第二档的浮卡是一句邀请，不是数据——这一档故意不摆容量/显存数字：矩阵
     没打开，那些数字本来就不存在，编不出来；逻辑魔方自己已经在画面中间浮出
     "卡内 · L{lo}-L{hi}" 那张小牌子，宿主再摆一份等于同一句话说两遍。 */
  function renderDrillInvite(matrixSel, subLine) {
    briefCard.innerHTML = '<div class="brief-h">rank ' + matrixSel + '</div>'
      + '<div class="brief-sub">' + subLine + '</div>'
      + '<button type="button" class="brief-cta" data-act="drill">↓ 单卡下钻 · 查看填充详情</button>';
    briefCard.classList.add('is-cta');
    briefCard.classList.remove('is-hidden');
  }
  briefCard.addEventListener('click', function (ev) {
    if (ev.target.closest('[data-act="drill"]') && pendingMatrixSel != null) showDetail(pendingMatrixSel);
  });

  /* 第三档的浮卡才是真数据：内容全部来自矩阵上报的、已经算好的摘要
     （ptoRankBrief：坐标/层段/容量/显存构成）——宿主自己不重算一遍，读出
     面板与浮卡两套数字迟早对不上。容量告警只用文字/底色深浅分挡，不引入
     色相，呼应"默认关掉颜色只有黑白"那条反馈。 */
  var CAP_LABEL = { oom: '⚠ 超出容量', red: '⚠ 逼近红线', amber: '临界（黄线）', ok: '正常' };
  function renderBrief(brief) {
    if (!brief) { hideBrief(); return; }
    var gb = function (v) { return (Math.round(v * 10) / 10) + ' GB'; };
    var capBadge = '<span class="brief-badge' + (brief.cap.level === 'ok' ? '' : ' is-alert') + '">'
      + (CAP_LABEL[brief.cap.level] || brief.cap.level) + '</span>';
    var html = '<div class="brief-h">rank ' + brief.rank + capBadge + '</div>'
      + '<div class="brief-sub">tp' + brief.coord.tp + ' cp' + brief.coord.cp + ' dp' + brief.coord.dp
      + ' pp' + brief.coord.pp + (brief.coord.ep != null ? ' ep' + brief.coord.ep : '')
      + ' · L' + brief.layers.lo + '–L' + brief.layers.hi + '</div>'
      + brief.segs.map(function (s) {
        return '<div class="brief-row"><span>' + s.label + '</span><b>' + gb(s.gb) + '</b></div>';
      }).join('')
      + '<div class="brief-row brief-total"><span>合计 / ' + brief.hbm + ' GB</span><b>' + gb(brief.cap.totGB) + '</b></div>';
    briefCard.classList.remove('is-cta');
    briefCard.innerHTML = html;
    briefCard.classList.remove('is-hidden');
  }

  // ── URL 深链：?sel=<并行拓扑矩阵自己的 rank 编号> 打开时直接进第三档 ─────
  var qsel = parseInt(qs.get('sel'), 10);
  if (isFinite(qsel) && qsel >= 0 && qsel < world) showDetail(qsel);
})();

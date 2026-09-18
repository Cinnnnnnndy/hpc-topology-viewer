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
     2 同组定位   —— 逻辑魔方里点一张方块，**留在逻辑魔方自己身上**：它自带
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
   退档不靠宿主自己另起一颗按钮：点空白就是每一档自带的手势——逻辑魔方
   点空白取消选中（第 2→1 档），矩阵点空白退出 soloCard（第 3→2 档，
   一句 pto:tier 指令，不重新加载 iframe）。"← 返回…"那颗按钮删了（反馈
   原话"有了面包屑不要这个了"）：档位已经写在面包屑里（逻辑魔方顶栏的
   模型名 + rank 后缀、矩阵自己的画布名字），退档交给两个 iframe 原生就有
   的手势，不必再摆一层复述"你在哪/怎么回去"的按钮。tier2 完全不涉及
   iframe 切换，天然没有闪烁——切换的"丝滑"就是靠少切一次做到的，不是靠
   更长的过渡动画补出来的。
*/
(function () {
  'use strict';

  var qs = new URLSearchParams(location.search);

  var rubikFrame = document.getElementById('rubikFrame');
  var matrixFrame = document.getElementById('matrixFrame');
  var briefCard = document.getElementById('briefCard');
  var clusterBadge = document.getElementById('clusterBadge');

  /* 两档预置，world = tp×pp×dp（EP 折在 DP 内部，不进世界卡数——两个本体
     的 README 都确认过这个口径）。默认盘古 ProMoE，world=4000，走三档取景；
     ?preset=dense64 是 demo.html 自己现成的 64 卡预置，用来验证"world ≤ 64
     直接显示矩阵原页"这条规则确实会触发，不是摆着不用的死分支。
     modelName：全部命名/面包屑的唯一来源——不编一个新名字，直接抄 demo.html
     自己 PRESETS 数组里给这个 preset 起的名字（那份是"模型叫什么"这件事的
     权威出处），这一层不重复维护第二份。 */
  var PRESETS = {
    pangu: { tp: 8, pp: 5, dp: 100, ep: 2, matrixPreset: 'pangu', modelName: '盘古 ProMoE' },
    dense64: { tp: 4, pp: 4, dp: 4, ep: 1, matrixPreset: 'dense64', modelName: '稠密预置' },
    /* incident2048：demo.html 那份「2048卡·Router溢出复盘」预置的桥接条目——
       tp/pp/dp/ep 取值与 demo.html PRESETS 里 incident2048 的注释同一份推算
       （world=pp×edp×ep=4×8×64=2048 → dp=edp×ep=512、ep=64），两边用同一组
       数字，rank 号才能对得上。见下面 INCIDENT 数据块与 renderIncident()。 */
    incident2048: { tp: 1, pp: 4, dp: 512, ep: 64, matrixPreset: 'incident2048', modelName: '2048卡·Router溢出复盘' }
  };
  /* 面包屑第二段：反馈「面包屑应该是3层」「这一层没有对应的面包屑」——
     原来选中之后不管第二档（留在逻辑魔方，选中卡与它所在的并行组）还是第三档
     （下钻到矩阵），面包屑都只写"模型名 / rank N"两段，第二档这一步在面包屑里
     直接被跳过了。这里补成第三段，两处（逻辑魔方招牌的 tierlabel、矩阵
     stitle 的对应写法）用同一个字符串，读起来是同一句话。
     原来叫"选中+兄弟"，反馈"给一个更好的名称，这个太随意了"——那句读着
     像随手写的笔记（还带个"+"号），换成"同组定位"：这一档做的事就是把
     选中卡摆进它所在的 TP/PP/DP 并行组里定个位，还没下钻到字节级详情，
     名字直说这件事，不再是简写。 */
  var TIER2_LABEL = '同组定位';
  var PS = PRESETS[qs.get('preset')] || PRESETS.pangu;
  var world = PS.tp * PS.pp * PS.dp;

  /* ══════════════════════════════════════════════════════════════════════
     真实故障复盘数据（仅 preset=incident2048 时出现）——反馈「这里真实监控
     数据卡片放到哪个屋里」选了"总览+单卡下钻都要，带时间线联动"。
     逐字抄自 /incident-canvas/index.html 的 GROUPS / TRAIN_METRICS / BOARD /
     TRAIN_HOOKS（那份本身照抄 compute-graph-viewer 的 INCIDENT_GROUPS，数值
     一个没改）——这里只挑了卡片要用的字段（不带 mechanism 分相/chart 曲线，
     那部分是 incident-canvas 自己的画布长项，这一层不重新实现一遍），事件
     顺序、conclusion 原文、BOARD 每格的 v/s/why 逐位照抄，没有改写。
     这是**另一次独立的 2048 卡训练**的真实事故（见 incident2048 预置注释），
     不是"当前选中卡正在发生的事"——两侧显存构成卡（renderMemCards）用的是
     本页自己按架构字段估出的假设值，跟这里引用的事故原文数字并不是同一套
     口径，两者一起出现时不要混着读。 */
  var INCIDENT_PROBLEMS = [
    { id: 'problem-2', name: '问题2 · Router 溢出与通信死锁',
      lede: '报错点在 HCCL 通信超时，震中却在 Layer 38 的 Router——一次 FP8 数值溢出，经 EP barrier 与 PP 依赖扩散成 2048 卡停摆。',
      events: [
        { id: 'p1-warning', time: '15k', dim: '数值·预警', sev: 'warn', title: 'Loss scale 连续衰减',
          conclusion: 'Layer 38 的数值健康已提前恶化，AMP scaler 从 65536 衰减到 4096。' },
        { id: 'p1-nan', time: '15203', dim: '耗时·数值', sev: 'bad', title: 'Loss NaN / grad_norm Inf',
          conclusion: '异常只在多卡复现，Layer 38 是首个数值病灶候选。' },
        { id: 'p1-log', time: '+8ms', dim: '通信·日志', sev: 'bad', title: 'Plog 暴露 buffer 失配', rank: 1559,
          conclusion: '运行时 EP rank 23 的 send=0、recv=9832；通信报错同时携带 router_logits Inf 证据。' },
        { id: 'p1-a2a', time: '+30s', dim: '通信·耗时', sev: 'bad', title: 'All-to-all 超时，63 rank 空等', rank: 1559,
          conclusion: 'EP rank 23 是首个阻塞者，其余 63 个 EP rank 是 barrier 受害者，不应被判为 64 个独立根因。' },
        { id: 'p1-root', time: '-30s', dim: '数值·负载', sev: 'bad', root: true, title: 'Router FP8 溢出，E193 吸收 98% token',
          conclusion: '这是问题2的根因事件：FP8 softmax 溢出导致路由塌缩，而不是 HCCL 自身故障。' },
        { id: 'p1-spread', time: '+30.1s', dim: '通信·扩散', sev: 'bad', title: 'PP3 断裂，2048 NPU hang',
          conclusion: '报错点是通信 timeout，异常震中却在 Layer 38 Router；单点经 EP barrier 和 PP 依赖扩散至整网。' }
      ] },
    { id: 'problem-1', name: '问题1 · 显存峰值与碎片 OOM',
      lede: '显存从 55 GB 一路爬到顶：12 层激活的存活区间在前向末尾全部重叠，叠上 LM Head 的 logits 把 64 GB 顶满，最后死在一次 0.5 GB 的临时申请上。',
      events: [
        { id: 'p2-rise', time: '8000+', dim: '显存·趋势', sev: 'warn', title: '显存从 55 GB 持续爬升',
          conclusion: 'PP stage 3 的显存不再回落，吞吐同期下降 12.5%。' },
        { id: 'p2-cost', time: '12000', dim: '耗时·显存', sev: 'warn', title: '分配/释放 API 占时 7.4%',
          conclusion: '显存管理耗时 890 ms，明显高于正常值 2%；带宽利用率 78%，可排除纯带宽瓶颈。' },
        { id: 'p2-peak', time: '12000', dim: '显存·容量', sev: 'bad', title: '激活值占用 36.2 GB',
          conclusion: '激活值占峰值的 56.6%，是唯一可大幅缩减的组成。' },
        { id: 'p2-layer', time: '12000', dim: '显存·Layer', sev: 'warn', title: 'L38 单层激活达到 1.2 GB',
          conclusion: 'Layer 38 比普通 Dense 层高 1.7 倍，额外占用来自 expert dispatch buffer。' },
        { id: 'p2-oom', time: '12003', dim: '显存·OOM', sev: 'bad', root: true, title: 'EP rank 17（global rank 1553）触顶并发生碎片 OOM', rank: 1553,
          conclusion: '64/64 GB 容量不足是主因，83% 碎片率让 0.5 GB 临时 buffer 更早申请失败。' }
      ] }
  ];
  var INCIDENT_METRICS = [
    { k: 'loss',    name: 'lm loss',            want: '↓',    src: 'loss_func() → training_log()' },
    { k: 'gnorm',   name: 'grad_norm',          want: '稳定',  src: 'training_log()' },
    { k: 'lscale',  name: 'loss_scale',         want: '不触发', src: 'logger_and_track_metrics_callback.py:74' },
    { k: 'zeros',   name: 'num_zeros_in_grad',  want: '↓',    src: 'training_log()' },
    { k: 'tflops',  name: 'throughput',         want: '↑',    src: 'PretrainMetricConfig._compute_throughput' },
    { k: 'mfu',     name: 'MFU',                want: '↑',    src: 'PretrainMetricConfig._compute_mfu' },
    { k: 'tokday',  name: 'throughput_per_day', want: '↑',    src: '_build_log_dict:1505' },
    { k: 'steptime',name: 'elapsed time / iter',want: '↓',    src: '_build_log_dict:1491' },
    { k: 'lr',      name: 'learning_rate',      want: '按计划', src: 'lr scheduler（cosine / WSD）' },
    { k: 'mem',     name: 'mem_reserved_bytes', want: '平稳',  src: 'NPU 保留显存 / theoretical_memory' }
  ];
  var INCIDENT_HOOKS = [
    { k: 'nan',       name: 'NaN / Inf 检测',   src: 'check_for_nan_in_loss_and_grad', act: '任一 rank 的 loss 出现 NaN 直接报错退出' },
    { k: 'spike',     name: 'Loss Spike 监控',  src: 'loss_spike_monitor_callback',    act: '损失突然飙升时触发回调' },
    { k: 'heartbeat', name: 'Heartbeat 监控',   src: 'init_heartbeat_monitor_pid',     act: '训练进程无响应则重启' },
    { k: 'dataspeed', name: '数据生产速度告警', src: '_warn_data_production_speed',    act: '数据加载速度接近训练速度时告警' },
    { k: 'oom',       name: 'OOM 前兆',         src: 'mem_reserved_bytes 增长趋势',    act: '保留显存持续增长，容量见底' }
  ];
  var INCIDENT_BOARD = {
    'p1-warning': { hooks: ['spike'], m: {
      lscale: { v: '65536 → 4096', s: 'warn', why: '连续四次减半，越过三级预警线 8192' },
      loss: { v: '仍在正常区间', s: 'ok', why: '距崩溃尚有 53 step——这正是它作为预警的价值' } } },
    'p1-nan': { hooks: ['nan', 'spike'], m: {
      loss: { v: 'NaN', s: 'bad', why: '本轮梯度整段作废' },
      gnorm: { v: 'Inf', s: 'bad', why: '末段每 step 涨约一个数量级，越界在同层反向' },
      lscale: { v: '已退到 4096', s: 'warn', why: '再退也救不回来，溢出的是 logits 不是梯度尺度' } } },
    'p1-log': { hooks: [], m: {
      steptime: { v: '+8 ms 起', s: 'warn', why: '收发失配刚发生，还没变成等待' } } },
    'p1-a2a': { hooks: ['heartbeat'], m: {
      steptime: { v: '+30 000', s: 'bad', why: '等满 HCCL 超时阈值 30 s' },
      tflops: { v: '0（63 卡）', s: 'bad', why: '空等期间算力零产出，而日志上什么都不报' },
      mfu: { v: '0', s: 'bad', why: '同上——这正是「看起来通信很慢」最容易骗人的地方' },
      tokday: { v: '0', s: 'bad', why: '累计空转 63 × 30 s ≈ 1890 卡·秒' } } },
    'p1-root': { hooks: [], m: {
      zeros: { v: '247 / 256 专家无梯度', s: 'bad', why: '路由塌缩后它们再没收到过 token' },
      loss: { v: '—', s: 'na', why: '本事件采的是路由份额与 logits，不在这十格里' } } },
    'p1-spread': { hooks: ['heartbeat'], m: {
      steptime: { v: 'hang', s: 'bad', why: '依赖环闭合，4 个 stage 全停在等待上' },
      tflops: { v: '0（2048 卡）', s: 'bad', why: '99.95% 的卡只是被链条拖住的' },
      mfu: { v: '0', s: 'bad' }, tokday: { v: '0', s: 'bad' } } },
    'p2-rise': { hooks: ['oom'], m: {
      mem: { v: '55 → 63.7', s: 'bad', why: '4000 step 未回落，被留住的是一直活着的激活' },
      tokday: { v: '3200 → 2800 tokens/s', s: 'warn', why: '同期吞吐下降 12.5%' },
      tflops: { v: '同比 −12.5%', s: 'warn', why: '原文给的是 tokens/s，这一格按同一口径读' } } },
    'p2-cost': { hooks: [], m: {
      steptime: { v: '12 000', s: 'warn', why: '其中 890 ms（7.4%）花在显存分配/释放上，正常水位约 2%' },
      mem: { v: 'HBM 带宽 78%', s: 'ok', why: '可排除纯带宽瓶颈——贵在碎片整理与换页，不在搬数据' } } },
    'p2-peak': { hooks: ['oom'], m: {
      mem: { v: '64.0 / 64', s: 'bad', why: '激活占 56.6%，安全余量 0 GB' } } },
    'p2-layer': { hooks: [], m: {
      mem: { v: 'L38 单层 1.2', s: 'warn', why: '同段普通层 0.71 GB，多出来的 0.5 GB 来自 expert dispatch buffer' } } },
    'p2-oom': { hooks: ['oom'], m: {
      mem: { v: '已分配 60.1 / 64', s: 'bad', why: '碎片率 83%，最大连续块只有 0.32 GB' },
      steptime: { v: '中断', s: 'bad', why: '它一崩 PP3 就断，全网跟着停在等待上' } } }
  };
  var INCIDENT_SEVC = { ok: '#3FB950', warn: '#D29922', bad: '#F85149', na: '#6E6E6E' };
  var INCIDENT_SEVN = { ok: '正常', warn: '预警', bad: '告警', na: '未采' };

  if (world <= 64) {
    /* 规模小：矩阵本体自己一屏就是全部——不铺逻辑魔方、不裁剪它的任何交互，
       与直接打开 /patterns/rank-topology-3d/ 逐字节相同。stitle 换成模型
       名称，跟三档取景那条路用的是同一个名字来源，不是另起一套说法。
       分隔符用 "/"：反馈「都放成面包屑用/分隔」，与下面 tier3 那条、
       逻辑魔方自己的招牌（见 pattern.js 的 syncBrand）三处统一成同一套
       写法，不是"这条 · 那条 /"各写各的。 */
    var plainP = new URLSearchParams({
      embed: '1', theme: 'dark', preset: PS.matrixPreset, card: '1', view: 'chain', vtab: '3d',
      stitle: PS.modelName + ' / ' + world + ' 卡'
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
  // tierlabel=：面包屑第三段，见上面 TIER2_LABEL 的注释——独立打开
  // /rubik-pattern.html 不传这个参数，默认还是"模型名 / rank N"两段。
  // zoomsel=0.5：反馈「在这一步就做一个小的zoomin」附图是盘古预置选中一张
  // 卡后，那一列在 4000 卡满屏阵列里只有几个像素——选中时镜头往那张卡
  // 推近一半（不是矩阵那种贴近单卡的"局部聚焦"，这里镜头还是全景机位，
  // 只是缩小取景范围），取消选中飞回原机位。独立打开 /rubik-pattern.html
  // 不传这个参数，选中不受影响。
  // chrome=0：反馈「点击单卡会卡在这里」「去掉标签，下面的内容放到标题后面去」——
  // 附图是逻辑魔方自带的选中卡侧栏（.prc-info，"RANK"kicker+标题+键值表那一整套）
  // 在窄屏媒体查询下挪到画面底部，跟这一层自己的 briefCard/角标/corner-link 叠在
  // 一起，还用它的透明留白盖住了舞台——点上去点在了这张看不见的卡上，画布本身
  // 反而没反应，看着像"卡住了"。这一层右上角的 briefCard 早就把"选中的是哪张卡、
  // 什么坐标"说清楚了，.prc-info 与顶栏那一整套（形态/视角按钮、更多抽屉、图例）
  // 全是重复的第二份 chrome——直接让逻辑魔方自己那套别画，不止是这一个面板的
  // 样式问题。独立打开 /rubik-pattern.html 不传这个参数，默认还画，不受影响。
  var rubikParams = new URLSearchParams({
    theme: 'dark', tp: String(PS.tp), pp: String(PS.pp), dp: String(PS.dp), ep: String(PS.ep),
    color: 'neutral', groupgap: '3', brand: PS.modelName, cclabels: '0', axsel: '0', cc: '0',
    tierlabel: TIER2_LABEL, zoomsel: '0.5', chrome: '0'
  });
  rubikFrame.src = '../../rubik-pattern.html?' + rubikParams.toString();

  // ── 集群总览角标：一开场就借矩阵本体算一遍「多少张卡超容」，不用等读者
  //    下钻到第三档才看到真实数字 ────────────────────────────────────────
  // 容量/显存那套判定（capVerdict/memParts）全在矩阵共用的 demo.html 里，这
  // 一层不重算一遍（重算会有两套数）。矩阵本体现在只在第三档才真的打开、
  // 画满屏 SVG——但只要「算一遍聚合、报个数」，不需要真的铺开那张画。给
  // matrixFrame 先借用一次，带 ?brief=1：demo.html 收到这个参数会跳过
  // urlLoad 之后那一整套 render()，只算 ptoClusterBrief() 就地 postMessage
  // 报完，不建 SVG、不占那几秒的渲染开销。matrixFrame 这一刻仍然是
  // is-hidden（CSS 已经收着），第三档真正下钻时 showDetail() 照常把它的
  // src 换成真正的详情页——两次导航互不冲突，只是多一次不可见的加载。
  var clusterWorstRank = null;
  (function () {
    var bp = new URLSearchParams({ embed: '1', preset: PS.matrixPreset, brief: '1' });
    matrixFrame.src = '../rank-topology-3d/pattern.html?' + bp.toString();
  })();
  var CLUSTER_CAP_LABEL = { oom: '⚠ 超出容量', red: '⚠ 逼近红线', amber: '临界（黄线）' };
  function renderClusterBadge(brief) {
    if (!brief || !clusterBadge) return;
    var n = brief.n, level = n.oom > 0 ? 'oom' : n.red > 0 ? 'red' : n.amber > 0 ? 'amber' : 'ok';
    clusterWorstRank = brief.worst;
    var text = level === 'ok' ? (brief.world + ' 卡 · 全部正常')
      : CLUSTER_CAP_LABEL[level] + ' · ' + n[level] + '/' + brief.world + ' 卡';
    clusterBadge.textContent = text;
    clusterBadge.classList.toggle('is-alert', level !== 'ok');
    clusterBadge.classList.remove('is-hidden');
  }
  /* 点一下角标直接下钻到最惨那张卡（ratio 最高，聚合时顺手记下的）——不用先
     经过「随便选一张再看是不是这张最严重」。角标是全局状态，跟当前在哪一档
     无关，点开永远落在第三档，跟从档二点"↓ 单卡下钻"一致。 */
  clusterBadge && clusterBadge.addEventListener('click', function () {
    if (clusterWorstRank != null) showDetail(clusterWorstRank);
  });

  // ── 真实故障复盘面板：只在 incident2048 预置下出现 ────────────────────────
  // 底部常驻，跨三档都不收起——它讲的是另一起独立事故，不是"当前选中卡这一刻
  // 的状态"，所以不必跟着档位增删。时间线选中一个事件 → 下面十格指标卡按
  // INCIDENT_BOARD[事件id] 更新；没选中事件或这一格没被那次事件采到，一律
  // 显示"—"（INCIDENT_BOARD 里就没有对应的键），不拿"—"以外的东西顶格。
  var incidentPanel = document.getElementById('incidentPanel');
  var incidentSel = null;
  function incidentEventById(id) {
    for (var i = 0; i < INCIDENT_PROBLEMS.length; i++) {
      var evs = INCIDENT_PROBLEMS[i].events;
      for (var j = 0; j < evs.length; j++) if (evs[j].id === id) return evs[j];
    }
    return null;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function renderIncidentPanel() {
    if (!incidentPanel || PS.matrixPreset !== 'incident2048') return;
    var ev = incidentSel ? incidentEventById(incidentSel) : null;
    var board = incidentSel ? INCIDENT_BOARD[incidentSel] : null;
    var timelineHtml = INCIDENT_PROBLEMS.map(function (prob) {
      var dots = prob.events.map(function (e) {
        var on = e.id === incidentSel;
        return '<button type="button" class="ip-dot' + (on ? ' is-on' : '') + '" data-ev="' + e.id + '"'
          + ' style="--ip-sevc:' + INCIDENT_SEVC[e.sev] + '" title="' + esc(e.time + ' · ' + e.title) + '">'
          + '<span class="ip-dotmark"></span><span class="ip-dottime">' + esc(e.time) + '</span></button>';
      }).join('');
      return '<div class="ip-prob"><span class="ip-probname">' + esc(prob.name) + '</span><div class="ip-events">' + dots + '</div></div>';
    }).join('');
    var cardsHtml = INCIDENT_METRICS.map(function (m) {
      var cell = board && board.m && board.m[m.k];
      var v = cell ? cell.v : '—';
      var sevKey = cell ? cell.s : 'na';
      return '<div class="ip-card" style="--ip-sevc:' + INCIDENT_SEVC[sevKey] + '">'
        + '<div class="ip-k">' + esc(m.name) + '<span class="ip-want">要求 ' + esc(m.want) + '</span></div>'
        + '<div class="ip-v">' + esc(v) + '</div>'
        + (cell && cell.why ? '<div class="ip-why">' + esc(cell.why) + '</div>' : '<div class="ip-src">' + esc(m.src) + '</div>')
        + '</div>';
    }).join('');
    var headHtml = ev
      ? '<span class="ip-evtitle">' + esc(ev.title) + '</span><span class="ip-evsev" style="--ip-sevc:' + INCIDENT_SEVC[ev.sev] + '">' + INCIDENT_SEVN[ev.sev] + '</span>'
        + (ev.rank != null ? '<button type="button" class="ip-drill" data-act="ip-drill" data-rank="' + ev.rank + '">下钻 rank ' + ev.rank + ' →</button>' : '')
      : '<span class="ip-evtitle ip-evtitle-empty">先在时间线上点一个事件——十格读数按那一刻的原文填，没采到的写「—」</span>';
    var concHtml = ev ? '<div class="ip-conc">' + esc(ev.conclusion) + '</div>' : '';
    incidentPanel.innerHTML =
      '<div class="ip-hd">' + headHtml + '<button type="button" class="ip-collapse" data-act="ip-collapse" title="收起/展开">' + (incidentPanel.classList.contains('is-collapsed') ? '▲' : '▼') + '</button></div>'
      + concHtml
      + '<div class="ip-timeline">' + timelineHtml + '</div>'
      + '<div class="ip-cards">' + cardsHtml + '</div>'
      + '<div class="ip-foot">口径来自 pangu_sophon_pytorch · 这十条是真的会被打印、画成曲线的那几个；另一次独立 2048 卡训练的真实复盘，与当前预置的架构字段无关，不替它编一个。</div>';
    incidentPanel.classList.remove('is-hidden');
  }
  incidentPanel && incidentPanel.addEventListener('click', function (ev) {
    var dot = ev.target.closest('[data-ev]');
    if (dot) { incidentSel = dot.getAttribute('data-ev'); renderIncidentPanel(); return; }
    if (ev.target.closest('[data-act="ip-collapse"]')) { incidentPanel.classList.toggle('is-collapsed'); renderIncidentPanel(); return; }
    var drill = ev.target.closest('[data-act="ip-drill"]');
    if (drill) showDetail(parseInt(drill.getAttribute('data-rank'), 10));
  });
  renderIncidentPanel();

  // ── 并行拓扑矩阵：只在第三档才加载，固定带 fastcard=1&solo=1 ─────────────
  // fastcard=1：矩阵共用的 demo.html 里的可选参数，默认关闭——这个简洁版传了它，
  // 详情态才会「不画坐标轴/EP 组框、无关联的卡直接不画、选中即飞焦」；不传就是
  // rank-topology-3d 自己原本的样子（标签/群组色照常画）。
  // solo=1：连兄弟卡也隐去，只看这一张卡内部——矩阵现在只在第三档才被打开，
  // 打开就直接是这一档，不必先落在"同组定位"再等一次点击才往里走。
  // 不传 mono：早先给这一档也传过 mono=1（整屏收黑白灰阶），但反馈原话
  // "选中之后的内部填充维持之前的彩色"——显存构成（权重/梯度/优化器态/
  // 专家/激活…）各自的颜色不是装饰，是在说"这一块字节是什么"，solo 视图
  // 现在只服务一张卡（不再是一整条兄弟行），色相不会跟别的卡打架，彩色
  // 反而比黑白更好读。mono 继续保留给 rank-topology-3d/net-slicing/
  // model-netgraph 这类会同屏画很多卡、需要收敛色相的场景用。
  // stitle：矩阵原生的画布名字接管这块地时，续用同一个模型名称（"用模型
  // 名称来做全部的命名和面包屑"）——不换一套说法，读者从第二档点进来，
  // 左上角那行字只是从这一层渲染的换成矩阵自己渲染的，内容不跳。
  // 分隔符用 "/" 不用 "·"："都放成面包屑用/分隔"——与逻辑魔方招牌
  // （syncBrand）、上面 world≤64 那条 stitle 统一成同一套写法。三段式
  // （模型名 / TIER2_LABEL / rank N）跟逻辑魔方那边的 tierlabel 拼法
  // 完全一致：从第二档点"下钻"换到这一屏时，左上角那行字只是从逻辑魔方
  // 渲染的换成矩阵渲染的，字面上一个字不跳。
  function matrixSrcFor(matrixSel) {
    var p = new URLSearchParams({
      embed: '1', theme: 'dark', preset: PS.matrixPreset, fastcard: '1', solo: '1',
      view: 'chain', card: '1', vtab: '3d', sel: String(matrixSel),
      stitle: PS.modelName + ' / ' + TIER2_LABEL + ' / rank ' + matrixSel
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
    pendingMatrixSel = null;
    hideBrief();
  }

  /* 第二档：留在逻辑魔方身上，只换宿主自己这层的 chrome——右下角浮出"下钻"
     邀请。逻辑魔方的选中态是它自己的事（这一刻画面早就是对的，从来路径
     无关：可能是它刚刚 postMessage 报过来的新选中，也可能是从第三档退
     回来、它本来就还停在原地没变过），这个函数从不碰 rubikFrame，只管
     sel（换算好的矩阵 rank，供下钻按钮用）与 subLine（下钻邀请那一行
     副标题，两条来路各自负责按自己手上有的坐标格式拼好再传进来）。 */
  function showTier2(matrixSel, subLine) {
    matrixFrame.classList.add('is-hidden');
    rubikFrame.classList.remove('is-hidden');
    pendingMatrixSel = matrixSel;
    renderDrillInvite(matrixSel, subLine);
  }

  /* 第三档：真正换到矩阵那一屏，solo=1 直接落在"只看这一只"。 */
  function showDetail(matrixSel) {
    matrixFrame.src = matrixSrcFor(matrixSel);
    matrixFrame.classList.remove('is-hidden');
    rubikFrame.classList.add('is-hidden');
    hideBrief();
  }

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
      if (d.type === 'pto:cluster') { renderClusterBadge(d.brief); return; }
      if (d.type !== 'pto:tier') return;
      if (d.tier === 3) {
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

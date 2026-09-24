/* rank-topology-lite · pattern.js
   一条下钻链 + 三张常驻悬浮卡 + 一块可缩放的画布（结构见 pattern.html 顶部
   注释与 README）。分两条路：

   world ≤ 64（只有 ?preset=dense64 会落到这条）：直接铺满并行拓扑矩阵本体
     的原页（不传 fastcard/mono/solo，就是 rank-topology-3d 独立打开的样子），
     没有这套下钻链——矩阵自己的"选中/取消选中"手势已经够用，不必再包一层。

   world > 64（默认 moe504b32k·4096 卡；?preset=pangu/moe718b128k/incident2048
   也走这条）：level ∈ cluster / segment / card 由下钻状态决定画布铺哪张：
     cluster 集群 —— 灵衢物理拓扑（buildPhysSvg）：超节点 / L2 平面 / L1 SW /
                     POD / 板上的 CPU·NPU·DPU·NIC，NPU 按 PP 段着色。点 NPU =
                     选中 rank；点 POD/超节点 = 取景过去；点空白 = 复位。
     segment 段   —— 宇宙视图（buildUniverseSvg）取景到一条 PP 段的楔子
                     （goSegment，用 uniWedge 记的 viewBox 包围盒）。点叶子 =
                     选中 rank。
     （选中 rank：右卡先摆坐标行，再借矩阵本体一次不铺屏的 ?brief=1&sel=
       请求（requestTier2Brief），pto:rank-brief 回信原地升级成层区间/显存
       构成 + 物理位置 + 五个通信组各走哪一级（physInfoHtml）。）
     card 单卡    —— showDetail 换到矩阵本体（fastcard=1&solo=1）：真实容量
                     读出、显存构成（原色）、卡内那一级通信。矩阵里点空白退出
                     solo，pto:tier 报回来，退到进来之前那一层（backLevel）。
   面包屑（renderCrumb）每一级都能点回去。逻辑魔方 / 整网图 / 泳道图是底部
   工具条唤起的参考抽屉（openDrawer），不在主线上；逻辑魔方里点方块报上来
   的 rubik-select 换算之后走同一条 showTier2。

   落位是假设（PHYS / physOf）：rank 连续摆放。通信组成员（commGroups）与
   各组走哪一级链路（linkLevel）是从矩阵本体的 rankOf 公式算出来的。
*/
(function () {
  'use strict';

  var qs = new URLSearchParams(location.search);

  var matrixFrame = document.getElementById('matrixFrame');
  var detailFrame = document.getElementById('detailFrame');
  var briefCard = document.getElementById('briefCard');
  var universeStage = document.getElementById('universeStage');
  var physStage = document.getElementById('physStage');
  var boardStage = document.getElementById('boardStage');
  var leftCard = document.getElementById('leftCard');
  var topbar = document.getElementById('topbar');
  var crumbEl = document.getElementById('crumb');
  var dock = document.getElementById('dock');
  var drawer = document.getElementById('drawer');
  var drawerFrame = document.getElementById('drawerFrame');
  var drawerTitle = document.getElementById('drawerTitle');
  var alertBadge = document.getElementById('alertBadge');

  /* 预置表，world = tp×cp×pp×dp（EP 折在 DP 内部，不进世界卡数——两个本体
     的 README 都确认过这个口径，pangu_sophon_pytorch 项目代码里的
     data_parallel_size = world_size ÷ (TP×PP×CP) 也是同一条）。默认
     moe504b32k，world=4096，走三档取景（见下面「默认预置」注释）；
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
    incident2048: { tp: 1, pp: 4, dp: 512, ep: 64, matrixPreset: 'incident2048', modelName: '2048卡·Router溢出复盘' },
    /* moe718b128k：demo.html 那份 PRESETS.moe718b128k 的桥接条目，tp/cp/pp/dp/ep
       逐位照抄那边的 cfg（world=tp·cp·pp·dp=8·16·16·4=8192；dp=4 不是 1——
       逻辑魔方自己的模型要求 EP 必须整除 DP 本身，dp=1 时 ep(4) 除不尽会
       直接抛异常建模失败，dp=4 是两边约束都满足的最小值，demo.html 那份
       PRESETS 的注释里有完整推导）。这是第一个 cp>1 的桥接预置，之前
       pangu/dense64/incident2048 都是 cp=1（省了这个字段也一样），这档
       必须显式给 cp，不然逻辑魔方按 cp=1 建模型，跟矩阵本体的四维结构
       对不上、rank 换算全错。世界卡数公式与 rubikParams/
       rubikSelToMatrixSel 里补的 cp 项，见下面对应位置的注释。 */
    moe718b128k: { tp: 8, cp: 16, pp: 16, dp: 4, ep: 4, matrixPreset: 'moe718b128k', modelName: 'MoE 718B(A39B)·128K序列' },
    /* moe504b32k：demo.html 那份 PRESETS.moe504b32k 的桥接条目（同一个
       pangu_sophon_pytorch 项目里 504B/18B 激活那档、32K 序列），tp/cp/pp/
       dp/ep 逐位照抄那边的 cfg（world=4·8·8·16=4096）。dp=16 不是猜的：
       项目代码里 data_parallel_size = world_size ÷ (TP×PP×CP)、EP 落在 DP
       域内，EP 必须整除 DP，DP=EP=16 就是这组切分的最小合法值——比
       moe718b128k 那档"从一堆矛盾候选里挑一个"扎实。字段来源分层（real/
       assumed）见 demo.html 那条预置的注释，这里不重复第二份。 */
    moe504b32k: { tp: 4, cp: 8, pp: 8, dp: 16, ep: 16, matrixPreset: 'moe504b32k', zero: 1, modelName: 'MoE 504B(A18B)·32K序列' }
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
  /* 默认预置：先后改过三次。第一次反馈「改这里的默认配置」，从 pangu
     （4000卡演示规格）换成 moe718b128k（pangu_sophon_pytorch 项目里体量
     最大的一档真实 MoE）；随后反馈"这个的rank数量太多了……回退一步回到
     之前只用64个rank的时候"+"等到我们的形式确定之后再扩大rank的数量"，
     退回 dense64（world=64）；交互形式（三档取景、宇宙视图、故障复盘面板
     直接摆在最外层、第二档浮卡原地升级）定下来之后，反馈"我还是想用超大
     集群的数量，按照我之前给你提供的数据选择一个较大的集群数量和合适的
     切分"——8192 那档被明确否掉（"太大太卡了"），incident2048 的 ep=64
     也被质疑，最后按第三轮扫描出来的真实配置选了 moe504b32k：world=4096，
     跟 pangu 同一个量级（两种第一档画法都验证过不卡），但每个数字都能对
     到 config/llm/moe_504B_A18B/ 的 yaml 或从项目代码里的公式推出来，
     不再是"演示规格"。dense64/pangu/moe718b128k/incident2048 都没删，
     ?preset= 照样认得；dense64 现在是唯一一条会走 world ≤ 64 早退分支
     （直接铺矩阵原页）的预置。 */
  var PS = PRESETS[qs.get('preset')] || PRESETS.moe504b32k;
  /* 优化器切分档位（ZeRO 0–3），传给矩阵本体的 ?zero=，它的显存估算按这一档切模型态。
     moe504b32k 默认 1（分布式优化器：优化器状态沿 DP 切 16 份）——Megatron 系训练大 MoE
     的常规做法，64 GB 卡上能跑也要求如此；但 504B 那份 yaml 不在本仓库，未逐字核对，
     是假设。不切（0）时 4096 张卡里 3959 张顶出 64 GB，左列可切回去对比。 */
  /* 配置（工具条「配置」浮层，反馈「对应的配置也要拿过来，简化显示」）——都是 URL 即状态：
     hide=occ,num,rel,grp 关掉哪几类数据标注；obj=pp:2 并行对象高亮；cam=3d|front|side|top 与
     comm3=1 是单卡页的机位和通信连线。缺省都不写进链接。 */
  var ANN = (function () { var h = (qs.get('hide') || '').split(','); return { occ: h.indexOf('occ') < 0, num: h.indexOf('num') < 0, rel: h.indexOf('rel') < 0, grp: h.indexOf('grp') < 0 }; })();
  /* 机位只给 3D 与顶视：矩阵本体的 solo 飞焦在正视/侧视两个场景里不成立（那两屏是另一套 frontScene/sideScene，
     卡会飞出画面、整屏空白），所以不开放；老链接 cam=front|side 退回 3D。 */
  var DV = { vtab: qs.get('cam') === 'top' ? 'top' : '3d', comm: qs.get('comm3') === '1' };
  var OBJ = (function () { var m = /^(tp|cp|ep|dp|pp):(\d+)$/.exec(qs.get('obj') || ''); return m ? { dim: m[1], idx: +m[2] } : { dim: null, idx: 0 }; })();
  function setQS(k, v) {
    var u = new URLSearchParams(location.search);
    if (v == null || v === '') u.delete(k); else u.set(k, v);
    history.replaceState(null, '', location.pathname + (u.toString() ? '?' + u.toString() : '') + location.hash);
  }
  function objSize(d) { return d === 'cp' ? (PS.cp || 1) : d === 'ep' ? Math.max(1, PS.ep || 1) : PS[d]; }
  function objVal(r, d) { var c = coordOfRank(r); return d === 'ep' ? c.dp % Math.max(1, PS.ep || 1) : c[d]; }
  var ZERO = (function () { var z = parseInt(qs.get('zero'), 10); return isFinite(z) && z >= 0 && z <= 3 ? z : (PS.zero || 0); })();
  /* world 公式补上 cp：原来只有 tp×pp×dp，pangu/dense64/incident2048 都是
     cp=1（省了这个乘数结果一样），moe718b128k 是第一个 cp>1（=16）的桥接
     预置，不补的话这里算出的卡数只有真实 world 的 1/16，逻辑魔方与矩阵
     本体从一开始就对不上。PS.cp 缺省仍按 1 处理，旧预置的 world 逐位不变。 */
  var world = PS.tp * (PS.cp || 1) * PS.pp * PS.dp;

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
  var INCIDENT_SEVC = { ok: '#5C5C5C', warn: '#E3A33B', bad: '#F85149', na: '#3A3A3A' };   // 告警才用色：红 = 严重、琥珀 = 警告，其余灰

  // ── 真实故障复盘面板：直接摆在最外层拓扑上，不必先跳一次预置 ─────────────
  // 原来只在 ?preset=incident2048 才渲染，默认屏幕上只留一条「⚠ 真实故障
  // 复盘…」链接，点了才整页跳到 incident2048（另一份拓扑）才看得到数据。
  // 反馈「不希望问题定位的那一块儿和本身的拓扑是分离的，现在必须要点击
  // 左上角的告警才能进入有数据的界面，我希望这个界面直接显示在最外层的
  // 拓扑上」——这份数据本身（时间线/十格指标卡）跟当前正在看哪个预置的
  // 拓扑无关，是另一起独立训练的历史复盘，没有理由非要先跳转页面才能看到，
  // 所以这段渲染逻辑挪到 `world ≤ 64` 分流之前，任何预置打开都会显示（默认
  // 收起，跟以前一样，只是不再需要一次页面跳转才能展开）。
  //
  // 会跟着预置变的只有「下钻」按钮：事件里的 rank 号（1559/1553 这些）是
  // incident2048 那份 2048 卡拓扑自己坐标系里的真实 rank，当前预置不是
  // incident2048 时，这个数字在当前这张拓扑里根本不存在（比如默认的
  // dense64 只有 64 张卡）——不能假装它能在当前页面内下钻到同一张卡，那是
  // 编数据。所以按钮改成看当前预置：是 incident2048 就地下钻（跟以前
  // 一样）；不是的话，按钮改一句更诚实的说法并整页跳转到 incident2048（带
  // 上这个 rank 号），把读者带到这个数字真正有意义的那张拓扑上，不在当前
  // 页面里硬凑一个假坐标。
  var incidentPanel = document.getElementById('incidentPanel');
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  /* 平铺：11 个事件全部摊开，每张小卡只写这一刻真采到的读数（BOARD 里
     s==='na' 的「—」占位不算采到，不画）。反馈「这些数值卡片就是应该直接出现
     在进去的第1个视图中」+「通过 tab 的形式去切换查看数值比较费劲，平铺，
     空值横杠不要显示」——不再有"选中一个事件才显示十格"这一步；结论与来源
     收进 hover 的 title。 */
  function renderIncidentPanel() {
    if (!incidentPanel) return;
    var onIncident = PS.matrixPreset === 'incident2048';
    var lanes = INCIDENT_PROBLEMS.map(function (prob, i9) {
      var evs = prob.events.map(function (e) {
        var board = INCIDENT_BOARD[e.id], m = board && board.m ? board.m : {};
        var chips = INCIDENT_METRICS.filter(function (x) { return m[x.k] && m[x.k].s !== 'na'; }).map(function (x) {
          var c = m[x.k];
          // 标签用短键（loss/gnorm/mem…），全名与来源进 hover——同一行能放下更多真读数
          return '<span class="ip-m" style="--ip-sevc:' + INCIDENT_SEVC[c.s] + '" title="' + esc(x.name + (c.why ? ' · ' + c.why : '') + ' · 来源 ' + x.src) + '"><em>' + esc(x.k) + '</em>' + esc(c.v) + '</span>';
        }).join('');
        return '<div class="ip-ev' + (e.root ? ' is-root' : '') + '" style="--ip-sevc:' + INCIDENT_SEVC[e.sev] + '" title="' + esc(e.conclusion) + '">'
          + '<div class="ip-evhd"><span class="ip-time">' + esc(e.time) + '</span><span class="ip-title">' + esc(e.title) + '</span>'
          + (e.root ? '<span class="ip-root">根因</span>' : '')
          + (e.rank != null ? '<button type="button" class="ip-drill" data-act="ip-drill" data-rank="' + e.rank + '">' + ('rank ' + e.rank + ' →') + '</button>' : '')
          + '</div>'
          + (chips ? '<div class="ip-ms">' + chips + '</div>' : '')
          + '</div>';
      }).join('');
      var root = prob.events.filter(function (e) { return e.root; })[0];
      var open = !!incidentOpen[prob.id];
      return '<div class="ip-grp' + (open ? ' is-open' : '') + '">'
        + '<button type="button" class="ip-prob' + (open ? ' is-on' : '') + '" data-prob="' + prob.id + '" title="' + prob.events.length + ' 个事件 · 另一次 2048 卡训练的真实事故"><b>' + esc(prob.name.replace(/^问题\d+\s*·\s*/, '')) + '</b>'
        + '<span>' + prob.events.length + '</span></button>'
        + '<div class="ip-chain">' + evs + '</div></div>';
    });
    /* 告警全放左列（反馈「告警都放在左侧」「为什么左边一个右边一个」）：两条问题线上下叠，
       按时间先后——问题 1（step 12000，显存 OOM）在上，问题 2（step 15k，Router 溢出）在下。
       两者是同一次 2048 卡训练里的两个独立问题，不是因果。 */
    var order = INCIDENT_PROBLEMS.map(function (p9, i9) { return [p9.id, i9]; }).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
    incidentPanel.innerHTML = '<div class="ip-col ip-col-left">' + order.map(function (x) { return lanes[x[1]]; }).join('') + '</div>';
    incidentPanel.classList.remove('is-hidden');
  }
  // 先只出现问题，点了才展开这条问题线的链路
  var incidentOpen = {};
  /* 两条链的起点跟着左右卡的实际高度走：卡的内容一变（选中/取消选中）就重写
     CSS 变量，链自动让开。 */
  /* 性能：这两个变量只写在故障链那一层（#incidentPanel）上，且值不变就不写——原来写在根元素上，
     自定义属性会继承，每写一次整页 1.2 万个 SVG 元素都要重算样式，再读 offsetHeight 强制排版，
     一次 500ms，下钻「不丝滑」的大头就是它（反馈「下钻之后的场景不丝滑」）。 */
  var lastLcH = -1, lastRcH = -1, syncQueued = false;
  // 合并到下一帧再量：一次交互里会调好几次，而且量高度会逼浏览器立刻排版
  function syncCardHeights() {
    if (syncQueued) return; syncQueued = true;
    requestAnimationFrame(function () { syncQueued = false; doSyncCardHeights(); });
  }
  function doSyncCardHeights() {
    if (!incidentPanel) return;
    var lh = leftCard ? leftCard.offsetHeight : 0;
    var rh = briefCard && !briefCard.classList.contains('is-hidden') ? briefCard.offsetHeight : 0;
    if (lh !== lastLcH) { lastLcH = lh; incidentPanel.style.setProperty('--lc-h', lh + 'px'); }
    if (rh !== lastRcH) { lastRcH = rh; incidentPanel.style.setProperty('--rc-h', rh + 'px'); }
  }
  window.addEventListener('resize', syncCardHeights);
  incidentPanel && incidentPanel.addEventListener('click', function (ev) {
    var pb = ev.target.closest('[data-prob]');
    if (pb) { var id9 = pb.getAttribute('data-prob'); incidentOpen[id9] = !incidentOpen[id9]; renderIncidentPanel(); return; }
    var drill = ev.target.closest('[data-act="ip-drill"]');
    if (!drill) return;
    var rank9 = parseInt(drill.getAttribute('data-rank'), 10);
    if (PS.matrixPreset === 'incident2048') showDetail(rank9);
    else location.href = '?preset=incident2048&sel=' + rank9;
  });
  renderIncidentPanel();

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
    /* cp：缺省按 1（PS.cp||1）——pangu/dense64/incident2048 没有这个字段，
       String(undefined) 会变成字面量 "undefined" 传出去，||1 兜底成
       rubik-pattern.html 自己的默认值，三档旧预置的取景逐位不变；
       moe718b128k 第一次真的用上非 1 的 cp。 */
    theme: 'dark', tp: String(PS.tp), cp: String(PS.cp || 1), pp: String(PS.pp), dp: String(PS.dp), ep: String(PS.ep),
    color: 'neutral', groupgap: '3', brand: PS.modelName, cclabels: '0', axsel: '0', cc: '0',
    tierlabel: TIER2_LABEL, zoomsel: '0.5', chrome: '0'
  });
  // 逻辑魔方现在不是主线上的一档，是底部工具条唤起的参考抽屉（见 openDrawer）
  var rubikSrc = '../../rubik-pattern.html?' + rubikParams.toString();

  // ── 宇宙视图：第一档的第二种画法，内联 SVG 径向星图（不是 iframe） ─────
  // 中心 = 模型本身；第一圈 = 各条 PP 段（沿用这个仓库里"PP流水=段"的既有
  // 心智模型，跟逻辑魔方 PP流水形态、并行拓扑矩阵段落条讲的是同一件事，
  // 不是另起一套分类）；每段外沿撒开一批采样出的**真实** rank 当叶子点——
  // 叶子的 tp/cp/rep 坐标是在 tp×cp×dp 这条扁平轴上等距抽样出来的，不是
  // 摆拍凑数量，点开哪一颗都能换算出一个真实存在的 rank。
  // 这里不重新发明"选中之后干什么"：叶子点点击算出 sel 直接调
  // showTier2/rubikSelToMatrixSel，跟逻辑魔方 postMessage 报上来的走的
  // 是同一条路径、落的是同一张 briefCard——两种视图只是"从哪触发选中"
  // 不同，选中之后的下钻/详情渲染一个字不重复实现。
  // 故事线是一条下钻链，不是几个并列的 tab（反馈「按下钻的逻辑把整个视图串
  // 起来，而不是视图 tab 切换」）：
  //   cluster 集群 —— 灵衢物理拓扑：4096 张卡物理上怎么连（超节点/平面/SW/
  //                  POD/板上的 NPU·CPU·DPU·NIC），NPU 按 PP 段着色，并行
  //                  拓扑已经叠在物理图上；
  //   segment 段  —— 宇宙视图聚焦一条 PP 段：这一段在模型里怎么分组（TP×CP
  //                  子组 × DP 副本），从左卡的段按钮或右卡"看它所在的段"进；
  //   （任一层点一颗卡 = 选中 rank，右卡给层区间/显存/物理位置/通信组走哪一级）
  //   card 单卡    —— 矩阵 solo：这一张卡里装了什么。
  // 面包屑随时回退；逻辑魔方/整网图/泳道图是主线之外的参考抽屉（底部工具条）。
  // curSel 是当前选中的矩阵 rank，focusPP 是当前聚焦的 PP 段，tier 是档位
  // （1 集群 · 2 同组定位 · 3 单卡下钻），level 是画布现在停在哪一层。
  var level = 'cluster', backLevel = 'cluster';
  var universeBuilt = false, physBuilt = false;
  var curSel = null, focusPP = null, tier = 1;
  var uniWedge = [];   // 宇宙视图每条 PP 段（hub + 叶子）的 viewBox 包围盒，聚焦一段时取景用
  // 参考图那种暖金/紫青撞色，圈内按段循环取色，同一段的叶子跟着它所在的
  // hub 同色（深浅由 CSS 的 hover/dim 状态区分，不再按叶子逐个换色）。
  /* 回到简洁版最初的提示词：默认只有黑白，颜色只给告警（超容标红）。段 hub、
     段按钮、平面、链路种类全部靠灰阶/线型/粗细分，不引入色相。 */
  var HUB_PALETTE = ['#E8E8E8'];
  // 第二档副标题的公共写法：逻辑魔方 postMessage 上报的选中（见下面 message
  // 监听里的 rubik-select 分支）与宇宙视图叶子点击共用同一句拼法，唯一的
  // 差别是前者能带上 rubik-cube 自己算好的层区间（L{lo}-L{hi}），宇宙视图
  // 这条路径没有 rubik-cube 的模型可查，就不编一段假的层区间——宁可这一档
  // 副标题短一截，也不摆一个编出来的数字。
  function tier2SubLine(sel) {
    return 'tp' + sel.tp + ((PS.cp || 1) > 1 ? ' cp' + sel.cp : '') + ' pp' + sel.pp + ' rep' + sel.rep;
  }
  /* 把 count 个点铺进一段扇形楔子（原点 ox,oy · 中心角 baseAngle · 半张角
     fanHalf · 半径 [rNear,rFar]），按行铺开的网格，不是全挤在一条半径线上。
     反馈「这个宇宙视图中间的rank也要按照真实的数量来……现在的数量是远远
     不够的」——第一版把整段的叶子都摆在同一个半径上，count 一大（比如
     pangu 预置一个子组 100 颗）扇面里那点角宽度根本不够摊开，100 个点挤
     成了肉眼看着像 1 个点的一团——「数字是真的」但看不出「真的有这么多」，
     没解决反馈要的问题。这里改成二维网格：径向分成几"环"，同一环内再按
     角度摊开，两个维度一起摊，同样的角宽能摆下多得多的点、彼此还分得开。 */
  function wdExt(w, p) { if (p.x < w.x0) w.x0 = p.x; if (p.x > w.x1) w.x1 = p.x; if (p.y < w.y0) w.y0 = p.y; if (p.y > w.y1) w.y1 = p.y; }
  function layoutWedge(ox, oy, baseAngle, fanHalf, count, rNear, rFar) {
    var cols = Math.max(1, Math.min(count, Math.round(Math.sqrt(count * 2.4))));
    var rows = Math.ceil(count / cols);
    var pts = [];
    for (var k = 0; k < count; k++) {
      var row = Math.floor(k / cols);
      var rowStart = row * cols;
      var colsInRow = Math.min(cols, count - rowStart);
      var col = k - rowStart;
      var colT = colsInRow > 1 ? (col / (colsInRow - 1) - 0.5) * 2 : 0;
      var rowT = rows > 1 ? row / (rows - 1) : 0;
      var a = baseAngle + colT * fanHalf;
      var r = rNear + rowT * (rFar - rNear);
      pts.push({ x: ox + Math.cos(a) * r, y: oy + Math.sin(a) * r });
    }
    return pts;
  }
  function buildUniverseSvg() {
    var W = 1600, H = 1000, CX = W / 2, CY = H / 2;
    var PPN = PS.pp, TPN = PS.tp, CPN = PS.cp || 1, DPN = PS.dp;
    var R1 = 250, RSUB = 340, R2 = 460;
    // 真实数量，不抽样：外圈 hub = PP 段（不变），每段内再按 TP×CP 分出
    // 子组（groupCount，TP/CP 都是 1 时退化成没有子组，直接进内层），子组
    // 内的叶子 = 这个 (pp,tp,cp) 组合下**全部** DPN 个 rep，一个不少——
    // tp·cp·pp·dp 四个因子相乘正好等于 world，这一屏画的就是全部 world
    // 张卡，不是取景。
    var groupCount = TPN * CPN;
    // 叶子数一多，每颗都连一条到 hub/子 hub 的线只会糊成一团黑（100 条线
    // 挤在几十像素宽的楔子里，比不画还难看），加上每条 <line> 都是一个新
    // DOM 节点——数量一大直接翻倍。超过这个阈值就只画点、不画连线，靠点
    // 本身的聚簇位置读出"这是哪个子组的"，小数量（≤12，比如 moe718b128k
     // 一个子组只有 4 个 dp）继续画线，读起来更直接。
    var THREAD_MAX = 12;
    var hubsHtml = '', leavesHtml = '', linksHtml = '';
    for (var i = 0; i < PPN; i++) {
      var theta = (i / PPN) * Math.PI * 2 - Math.PI / 2;
      var hx = CX + Math.cos(theta) * R1, hy = CY + Math.sin(theta) * R1;
      var color = HUB_PALETTE[i % HUB_PALETTE.length];
      var wd = uniWedge[i] = { x0: hx - 30, y0: hy - 30, x1: hx + 30, y1: hy + 44 };
      linksHtml += '<line class="u-ray" data-pp="' + i + '" x1="' + CX + '" y1="' + CY + '" x2="' + hx.toFixed(1) + '" y2="' + hy.toFixed(1) + '""/>';
      hubsHtml += '<g class="u-hub" data-pp="' + i + '">'
        + '<rect class="u-hubcore" x="' + (hx - 11).toFixed(1) + '" y="' + (hy - 11).toFixed(1) + '" width="22" height="22"/>'
        + '<text class="u-hublabel" x="' + hx.toFixed(1) + '" y="' + (hy + 34).toFixed(1) + '" text-anchor="middle">PP' + i + '</text>'
        + '</g>';
      // 扇形半张角按"这一段跟相邻段隔多远"来定（相邻 hub 的夹角是
      // 2π/PPN），封顶在那个夹角的 42%——留出至少约 16% 的空隙，扇面才会
      // 读成"N 段各喷一束"而不是糊成一整条连续的外圈圆环。
      var fanHalf = Math.min(0.34, (Math.PI / PPN) * 0.42);
      if (groupCount <= 1) {
        // TP=CP=1：这一段没有第二层可分（比如 incident2048），DPN 个叶子
        // 铺进 hub 直接张开的那一整个楔子（径向 R1+50…R2）。
        var pts0 = layoutWedge(CX, CY, theta, fanHalf, DPN, R1 + 50, R2);
        for (var r0 = 0; r0 < DPN; r0++) {
          var p0 = pts0[r0]; wdExt(wd, p0);
          if (DPN <= THREAD_MAX) linksHtml += '<line class="u-thread" data-pp="' + i + '" x1="' + hx.toFixed(1) + '" y1="' + hy.toFixed(1) + '" x2="' + p0.x.toFixed(1) + '" y2="' + p0.y.toFixed(1) + '""/>';
          var sel0 = { tp: 0, cp: 0, pp: i, rep: r0 };
          leavesHtml += '<rect class="u-leaf" data-pp="' + i + '" data-tp="0" data-cp="0" data-rep="' + r0 + '"'
            + ' x="' + (p0.x - 3.5).toFixed(1) + '" y="' + (p0.y - 3.5).toFixed(1) + '" width="7" height="7">'
            + '<title>' + esc(tier2SubLine(sel0)) + '</title></rect>';
        }
      } else {
        // 有 TP/CP 结构：段内再分 groupCount 个子组（子 hub），子组之间的
        // 角距跟外圈"段与段之间留缝"是同一个道理——子扇半张角封顶在"这个
        // 子组自己的角位槽宽"的 42%，组与组之间才不会糊在一起。子组本身
        // 复用 .u-hub 这个类（只是多一个 .u-subhub 标记做小尺寸样式），
        // 点击时走跟点外圈 hub 一样的"聚焦这一整个 PP 段"逻辑——子组不是
        // 唯一 rank，点了下钻没有意义，只聚焦讲得通。
        var groupSpacing = groupCount > 1 ? (2 * fanHalf) / (groupCount - 1) : 2 * fanHalf;
        var subFanHalf = Math.min(groupSpacing * 0.42, 0.15);
        for (var g = 0; g < groupCount; g++) {
          var tp9 = g % TPN, cp9 = Math.floor(g / TPN) % CPN;
          var gt = groupCount > 1 ? (g / (groupCount - 1) - 0.5) * 2 * fanHalf : 0;
          var ga = theta + gt;
          var sx = CX + Math.cos(ga) * RSUB, sy = CY + Math.sin(ga) * RSUB;
          linksHtml += '<line class="u-ray is-sub" data-pp="' + i + '" x1="' + hx.toFixed(1) + '" y1="' + hy.toFixed(1) + '" x2="' + sx.toFixed(1) + '" y2="' + sy.toFixed(1) + '""/>';
          hubsHtml += '<rect class="u-hub u-subhub" data-pp="' + i + '" x="' + (sx - 3).toFixed(1) + '" y="' + (sy - 3).toFixed(1) + '" width="6" height="6">'
            + '<title>' + esc('pp' + i + ' tp' + tp9 + ((CPN > 1) ? ' cp' + cp9 : '')) + '</title></rect>';
          var pts = layoutWedge(CX, CY, ga, subFanHalf, DPN, RSUB + 30, R2);
          for (var r = 0; r < DPN; r++) {
            var p = pts[r]; wdExt(wd, p);
            if (DPN <= THREAD_MAX) linksHtml += '<line class="u-thread" data-pp="' + i + '" x1="' + sx.toFixed(1) + '" y1="' + sy.toFixed(1) + '" x2="' + p.x.toFixed(1) + '" y2="' + p.y.toFixed(1) + '""/>';
            var sel = { tp: tp9, cp: cp9, pp: i, rep: r };
            leavesHtml += '<rect class="u-leaf" data-pp="' + i + '" data-tp="' + tp9 + '" data-cp="' + cp9 + '" data-rep="' + r + '"'
              + ' x="' + (p.x - 2.5).toFixed(1) + '" y="' + (p.y - 2.5).toFixed(1) + '" width="5" height="5">'
              + '<title>' + esc(tier2SubLine(sel)) + '</title></rect>';
          }
        }
      }
    }
    // 稀疏星点只做氛围，不承载数据——数量固定、每次重建（理论上只建一次，
    // 见 renderUniverse 的 universeBuilt 守卫）位置会不一样，纯装饰，不影响
    // 任何可读信息。
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">'
      + '<g class="u-links">' + linksHtml + '</g>'
      + '<g class="u-leaves">' + leavesHtml + '</g>'
      + '<g class="u-hubs">' + hubsHtml + '</g>'
      + '<rect class="u-core" x="' + (CX - 30) + '" y="' + (CY - 30) + '" width="60" height="60"/>'
      + '<text class="u-corelabel" x="' + CX + '" y="' + (CY + 74) + '" text-anchor="middle">' + esc(PS.modelName) + '</text>'
      + '<text class="u-coresub" x="' + CX + '" y="' + (CY + 96) + '" text-anchor="middle">' + world + ' 卡 · ' + PPN + ' 段流水线</text>'
      + '</svg>';
  }
  function renderUniverse() {
    if (universeBuilt) return;
    universeStage.innerHTML = '<div class="zp-box">' + buildUniverseSvg() + '</div>';
    universeBuilt = true;
    if (typeof uniZP !== 'undefined' && uniZP) uniZP.reset();
    applyAlerts();
  }
  // 点一个 hub（段本身）= 聚焦这一段、把其余段的 hub/射线/叶子调暗，不下钻
  // （一段里有好几张卡，hub 本身不对应唯一 rank）；ppIdx=null 时全部复原。
  function focusHub(ppIdx) {
    if (!universeBuilt) return;
    var sel9 = ppIdx == null ? null : String(ppIdx);
    universeStage.querySelectorAll('.u-hub, .u-leaf, .u-ray, .u-thread').forEach(function (el) {
      el.classList.toggle('is-dim', sel9 != null && el.getAttribute('data-pp') !== sel9);
    });
  }
  // 拖拽平移之后松手的那一下 click 已被 attachZoomPan 在捕获阶段吃掉，
  // 这里收到的都是真正的点击。
  universeStage.addEventListener('click', function (ev) {
    var leaf = ev.target.closest('.u-leaf');
    if (leaf) {
      var sel = { tp: +leaf.getAttribute('data-tp'), cp: +leaf.getAttribute('data-cp'), pp: +leaf.getAttribute('data-pp'), rep: +leaf.getAttribute('data-rep') };
      var ms = rubikSelToMatrixSel(sel);
      if (ms === curSel) { var lb = leaf.getBBox(); uniZP.fitVB(lb.x, lb.y, lb.width, lb.height, 160); } else showTier2(ms, tier2SubLine(sel));
      return;
    }
    var hub = ev.target.closest('.u-hub');
    if (hub) { focusSegment(+hub.getAttribute('data-pp')); return; }
    showOverview();
  });

  // ── 灵衢物理拓扑：第一档的第三种画法，也是默认的第一屏 ──────────────────
  // 按 CANN NEXT 直播讲的 Ascend 950 积木（见 research/灵衢材料-学习笔记01）：
  //   板（Server 内 8 NPU，UB fullmesh）→ POD（64 NPU = 8 板，L1 灵衢 SW）
  //   → 128 卡组（2 个 POD，配 8 颗 L1 SW、每平面一颗）→ 超节点（1024P =
  //   8 组，8 个独立平面、每平面 4×SW2，L1/L2 构成 Clos，平面间无互联）
  //   → 超节点之间经 L2 走 UBoE。
  // rank 落到哪颗 NPU 配置里没有——这一层按「rank 连续摆放」这条**假设**
  // 推（r → 超节点 ⌊r/1024⌋ · POD ⌊r/64⌋ · 板 ⌊r/8⌋ · 槽 r%8），左卡上写明。
  // 在这条假设下，五个通信组各走哪一级链路是能算出来的：组内成员的最远
  // 一对落在同一块板 / 同一个 POD / 同一个超节点 / 跨超节点，就是它走的
  // 那一级——这部分是公式，不是编的；只有落位那一条是假设。
  var PHYS = { board: 8, pod: 64, group: 128, sp: 1024 };
  var physCount = {
    sp: Math.ceil(world / PHYS.sp), groups: Math.ceil(world / PHYS.group),
    pods: Math.ceil(world / PHYS.pod), boards: Math.ceil(world / PHYS.board)
  };
  function physOf(r) {
    return { sp: Math.floor(r / PHYS.sp), group: Math.floor(r / PHYS.group), pod: Math.floor(r / PHYS.pod), board: Math.floor(r / PHYS.board), slot: r % PHYS.board };
  }
  /* demo.html 的 rankOf = ((pp·DP + dp)·CP + cp)·TP + tp 的正反两向。 */
  function coordOfRank(r) {
    var TP = PS.tp, CP = PS.cp || 1, DP = PS.dp;
    return { tp: r % TP, cp: Math.floor(r / TP) % CP, dp: Math.floor(r / (TP * CP)) % DP, pp: Math.floor(r / (TP * CP * DP)) };
  }
  function rankOfCoord(c) { var TP = PS.tp, CP = PS.cp || 1, DP = PS.dp; return ((c.pp * DP + c.dp) * CP + c.cp) * TP + c.tp; }
  function coordLine(r) { var c = coordOfRank(r); return 'tp' + c.tp + ((PS.cp || 1) > 1 ? ' cp' + c.cp : '') + ' dp' + c.dp + ' pp' + c.pp; }
  /* 五个通信组的成员。EP 落在 DP 域内（ep_over_sp）：同一 (pp,cp,tp) 下的
     dp 按每 EP 个一桶，桶内的 rank 共享一组专家（demo.html 的 epOf 就是
     ep = dp % EP、edp = ⌊dp/EP⌋，这里取同一桶）。 */
  function commGroups(r) {
    var c = coordOfRank(r), g = { tp: [], cp: [], ep: [], dp: [], pp: [] }, i;
    for (i = 0; i < PS.tp; i++) g.tp.push(rankOfCoord({ tp: i, cp: c.cp, dp: c.dp, pp: c.pp }));
    for (i = 0; i < (PS.cp || 1); i++) g.cp.push(rankOfCoord({ tp: c.tp, cp: i, dp: c.dp, pp: c.pp }));
    var ep = Math.max(1, PS.ep || 1), blk = Math.floor(c.dp / ep);
    for (i = 0; i < PS.dp; i++) {
      var r2 = rankOfCoord({ tp: c.tp, cp: c.cp, dp: i, pp: c.pp });
      g.dp.push(r2);
      if (Math.floor(i / ep) === blk) g.ep.push(r2);
    }
    for (i = 0; i < PS.pp; i++) g.pp.push(rankOfCoord({ tp: c.tp, cp: c.cp, dp: c.dp, pp: i }));
    return g;
  }
  var LINK_LEVELS = ['板内', 'POD', 'SP', '跨 SP'];
  /* 8 个平面（直播第一页：L1/L2 按平面成 Clos，平面之间没有互联）只用 P1…P8 的
     标签区分，不按平面着色——黑白规则。PLANE_C 留着做统一灰阶入口。 */
  var PLANE_C = ['#6E6E6E', '#6E6E6E', '#6E6E6E', '#6E6E6E', '#6E6E6E', '#6E6E6E', '#6E6E6E', '#6E6E6E'];
  /* 五个通信组的描边只分灰阶：TP 白实线最粗、CP 浅灰、EP/DP 中灰、PP 白虚线。 */
  var GC = { tp: '#FFFFFF', cp: '#B4B4B4', ep: '#7A7A7A', dp: '#7A7A7A', pp: '#E8E8E8' };
  function levelBetween(a, b) {
    var p = physOf(a), q = physOf(b);
    return p.sp !== q.sp ? 3 : p.pod !== q.pod ? 2 : p.board !== q.board ? 1 : 0;
  }
  /* 集合通信组（TP/CP/EP/DP）：组里最远的一对决定这次集合走哪一级；
     PP 是相邻段之间的点对点，看的是相邻一跳里最远的那一跳。 */
  function linkLevel(ranks, chain) {
    var lv = 0, i;
    if (chain) { for (i = 1; i < ranks.length; i++) lv = Math.max(lv, levelBetween(ranks[i - 1], ranks[i])); }
    else { for (i = 1; i < ranks.length; i++) lv = Math.max(lv, levelBetween(ranks[0], ranks[i])); }
    return lv;
  }

  /* 一块板（Server 形态：8 NPU + 2 CPU，直播第二页）画成 POD 里的一行：
     [CPU CPU][8 颗 NPU][DPU][NIC×4]。CPU/DPU 各自一条 UB 上联到 L1 SW（第三页：
     CPU —UB— L1，DPU —PCIe— CPU、—UB— L1），NIC 走 RoCE 出到参数面（第二页
     Server 图里 NIC 挂在 NPU 下面、RoCE 出框），不进 L1——所以 NIC 那条线是
     另一种颜色、往上穿过 SW1 行。每板 1 颗 DPU / 4 张 NIC 是按第二页 Server
     图数的（4 个 NIC 框），直播没给每板 DPU 的确切数，这一项是示意。 */
  var GEO = { sw1: {}, sw2: {}, board: {} }, PITCH_ = 9, ROWP_ = 9, PODW_ = 126;
  function buildPhysSvg() {
    var SPN = physCount.sp, cols = SPN > 2 ? 2 : SPN, rows = Math.ceil(SPN / cols);
    var PITCH = PITCH_, ROWP = ROWP_, PODW = PODW_, PODH = 84, GAPP = 6, GRPW = PODW * 2 + GAPP, GRPGAP = 18;
    var SW1H = 16, PLANEH = 34, PAD = 18, HEAD = 26, GRPCOLS = 2;
    var GRPROWS = Math.ceil((PHYS.sp / PHYS.group) / GRPCOLS);
    var SPW = PAD * 2 + GRPCOLS * GRPW + (GRPCOLS - 1) * GRPGAP;
    var GRPH = SW1H + 8 + PODH;
    var SPH = HEAD + PLANEH + 14 + GRPROWS * GRPH + (GRPROWS - 1) * 16 + PAD;
    var SPGAP = 70, M = 40;
    var W = cols * SPW + (cols - 1) * SPGAP + M * 2, H = rows * SPH + (rows - 1) * SPGAP + M * 2;
    var panels = [], links = [], nodes = [], sps = [];
    for (var s = 0; s < SPN; s++) {
      var sx = M + (s % cols) * (SPW + SPGAP), sy = M + Math.floor(s / cols) * (SPH + SPGAP);
      sps.push({ x: sx, y: sy });
      var base = s * PHYS.sp, inSp = Math.min(PHYS.sp, world - base);
      panels.push('<rect class="p-sp" data-sp="' + s + '" x="' + sx + '" y="' + sy + '" width="' + SPW + '" height="' + SPH + '"/>'
        + '<text class="p-splabel" x="' + (sx + PAD) + '" y="' + (sy + 18) + '">SP' + s + ' · ' + inSp + '</text>');
      var planeW = (SPW - PAD * 2 - 7 * 8) / 8, py = sy + HEAD, planeC = [];
      for (var pl = 0; pl < 8; pl++) {
        var px = sx + PAD + pl * (planeW + 8), sw2w = (planeW - 12) / 4;
        panels.push('<rect class="p-plane" style="--pc:' + PLANE_C[pl] + '" x="' + px + '" y="' + py + '" width="' + planeW + '" height="' + PLANEH + '"><title>平面 ' + (pl + 1) + ' · 4×SW2 · 与平面内每颗 L1 成 Clos · 平面间无互联</title></rect>'
          + '<text class="p-planelabel" x="' + (px + planeW / 2) + '" y="' + (py + 13) + '" text-anchor="middle">P' + (pl + 1) + '</text>');
        for (var q = 0; q < 4; q++) panels.push('<use class="p-sw2" href="#hw-sw" x="' + (px + 6 + q * sw2w) + '" y="' + (py + PLANEH - 14) + '" width="' + (sw2w - 3) + '" height="10"/>');
        (GEO.sw2[s] = GEO.sw2[s] || [])[pl] = [0, 1, 2, 3].map(function (q9) { return { x: px + 6 + q9 * sw2w + (sw2w - 3) / 2, y: py + PLANEH - 4 }; });
        planeC.push({ x: px + planeW / 2, y: py + PLANEH });
      }
      var groups = Math.ceil(inSp / PHYS.group);
      for (var g = 0; g < groups; g++) {
        var gx = sx + PAD + (g % GRPCOLS) * (GRPW + GRPGAP), gy = sy + HEAD + PLANEH + 14 + Math.floor(g / GRPCOLS) * (GRPH + 16);
        var gBase = base + g * PHYS.group, sw1w = (GRPW - 7 * 4) / 8;
        for (var k = 0; k < 8; k++) {
          var swx = gx + k * (sw1w + 4);
          (GEO.sw1[gBase / PHYS.group] = GEO.sw1[gBase / PHYS.group] || [])[k] = { x: swx + sw1w / 2, top: gy, bot: gy + SW1H };
          panels.push('<rect class="p-sw1" style="--pc:' + PLANE_C[k] + '" x="' + swx + '" y="' + gy + '" width="' + sw1w + '" height="' + SW1H + '"><title>L1 SW · 平面 ' + (k + 1) + ' · 下接 2 个 POD 每颗 NPU 1 口 · 上接本平面 4×SW2（4 口）</title></rect>');
          panels.push('<use class="p-swicon" href="#hw-sw" x="' + (swx + 1) + '" y="' + (gy + 1) + '" width="' + (sw1w - 2) + '" height="' + (SW1H - 2) + '"/>');
          links.push('<line class="p-l2" style="--pc:' + PLANE_C[k] + '" x1="' + planeC[k].x + '" y1="' + planeC[k].y + '" x2="' + (swx + sw1w / 2) + '" y2="' + gy + '"/>');
        }
        if (g === 0) panels.push('<text class="p-sw1label" x="' + (gx + GRPW / 2) + '" y="' + (gy + SW1H - 4) + '" text-anchor="middle">L1 ×8</text>');
        for (var pd = 0; pd < 2; pd++) {
          var pBase = gBase + pd * PHYS.pod; if (pBase >= world) break;
          var pdx = gx + pd * (PODW + GAPP), pdy = gy + SW1H + 8, podIdx = Math.floor(pBase / PHYS.pod);
          panels.push('<rect class="p-pod" data-pod="' + podIdx + '" data-sp="' + s + '" x="' + pdx + '" y="' + pdy + '" width="' + PODW + '" height="' + PODH + '">'
            + '<title>POD ' + podIdx + ' · 8 板 · 64 NPU · 16 CPU · 每板 1 DPU · 4 NIC · 点一下取景，再点某一行进那块板</title></rect>');
          // 上联：CPU 列、NPU 列、DPU 列各一条 UB 到 L1 SW；NIC 列一条 RoCE 穿过 SW1 行出去
          [pdx + 11, pdx + 58, pdx + 101].forEach(function (ux) {
            links.push('<line class="p-l1" x1="' + ux + '" y1="' + (gy + SW1H) + '" x2="' + ux + '" y2="' + pdy + '"/>');
          });
          links.push('<line class="p-roce" x1="' + (pdx + 115) + '" y1="' + (gy - 3) + '" x2="' + (pdx + 115) + '" y2="' + pdy + '"/>');
          if (g === 0 && pd === 0) panels.push('<text class="p-rocelabel" x="' + (pdx + 119) + '" y="' + (gy - 4) + '">RoCE</text>');
          panels.push('<g class="lod1 p-colhd">'
            + '<text x="' + (pdx + 10.5) + '" y="' + (pdy + 4.2) + '" text-anchor="middle">CPU</text>'
            + '<text x="' + (pdx + 58) + '" y="' + (pdy + 4.2) + '" text-anchor="middle">NPU · POD ' + podIdx + '</text>'
            + '<text x="' + (pdx + 101) + '" y="' + (pdy + 4.2) + '" text-anchor="middle">DPU</text>'
            + '<text x="' + (pdx + 115) + '" y="' + (pdy + 4.2) + '" text-anchor="middle">NIC</text></g>');
          for (var b = 0; b < 8; b++) {
            var ry = pdy + 6 + b * ROWP + ROWP / 2, bIdx = Math.floor(pBase / PHYS.board) + b;
            GEO.board[bIdx] = { pdx: pdx, pdy: pdy, ry: ry, grp: gBase / PHYS.group, sp: s };
            panels.push('<rect class="p-board" data-board="' + bIdx + '" data-pod="' + podIdx + '" x="' + (pdx + 2) + '" y="' + (ry - ROWP / 2) + '" width="' + (PODW - 4) + '" height="' + ROWP + '"><title>板 ' + bIdx + ' · 2 CPU + 8 NPU + DPU + 4 NIC</title></rect>');
            /* 设备各有各的形：只有 NPU 是实心（填充 = 显存占用率这份数据），
               其余都是空心轮廓——CPU 方框、DPU 菱形、NIC 四根端口短竖线。 */
            // 图形直接用 hpc-topology-node 的 2D 图元（hw-icons.js 里的 <symbol>）：CPU 鲲鹏、DPU、NIC 擎天
            panels.push('<use class="p-cpu" href="#hw-cpu" x="' + (pdx + 4.6) + '" y="' + (ry - 2.6) + '" width="6.2" height="5.2"/>'
              + '<use class="p-cpu" href="#hw-cpu" x="' + (pdx + 11) + '" y="' + (ry - 2.6) + '" width="6.2" height="5.2"/>'
              + '<use class="p-dpu" href="#hw-dpu" x="' + (pdx + 97.4) + '" y="' + (ry - 3) + '" width="8" height="6"/>');
            for (var ni = 0; ni < 4; ni++) panels.push('<use class="p-nic" href="#hw-nic" x="' + (pdx + 107.2 + (ni % 2) * 6.8) + '" y="' + (ry - 3.4 + Math.floor(ni / 2) * 3.4) + '" width="6.4" height="3.2"/>');
            if (b > 0) panels.push('<line class="p-bdiv lod1" x1="' + (pdx + 3) + '" y1="' + (ry - ROWP / 2) + '" x2="' + (pdx + PODW - 3) + '" y2="' + (ry - ROWP / 2) + '"/>');
            for (var n = 0; n < 8; n++) {
              var r = pBase + b * 8 + n; if (r >= world) break;
              var c = coordOfRank(r);
              nodes.push('<rect class="p-npu" data-rank="' + r + '" data-pp="' + c.pp + '" data-pod="' + podIdx + '"'
                + ' x="' + (pdx + 22 + n * PITCH + 1) + '" y="' + (ry - 3.5) + '" width="7" height="7">'
                + '<title>rank ' + r + ' · ' + coordLine(r) + ' · 超节点' + s + ' POD' + podIdx + ' 板' + b + ' 槽' + n + '</title></rect>'
                + '<text class="p-npunum lod2" x="' + (pdx + 22 + n * PITCH + 4.5) + '" y="' + (ry + 3.55) + '" text-anchor="middle">' + r + '</text>'
                + '<use class="p-npupkg lod2" href="#hw-npu" x="' + (pdx + 22 + n * PITCH + 1) + '" y="' + (ry - 3.5) + '" width="7" height="5.25"/>'
                + '<rect class="p-npustrip lod2" x="' + (pdx + 22 + n * PITCH + 1.9) + '" y="' + (ry + 1.95) + '" width="5.2" height="0.45"/>');
            }
          }
        }
      }
    }
    // 超节点之间：L2 经 UBoE 互联。直播里只说"经 UBoE 跨超节点"，没给超节点间
    // 的具体拓扑，这里只把相邻面板连起来做示意，不假装知道是环还是全互联。
    for (var s2 = 1; s2 < SPN; s2++) {
      var A = sps[s2 - 1], B = sps[s2];
      if (Math.floor(s2 / cols) === Math.floor((s2 - 1) / cols)) {
        links.push('<line class="p-uboe" x1="' + (A.x + SPW) + '" y1="' + (A.y + HEAD + PLANEH / 2) + '" x2="' + B.x + '" y2="' + (B.y + HEAD + PLANEH / 2) + '"/>'
          + '<text class="p-uboelabel" x="' + (A.x + SPW + SPGAP / 2) + '" y="' + (A.y + HEAD + PLANEH / 2 - 6) + '" text-anchor="middle">UBoE</text>');
      } else {
        var U = sps[s2 - cols];
        links.push('<line class="p-uboe" x1="' + (U.x + SPW / 2) + '" y1="' + (U.y + SPH) + '" x2="' + (B.x + SPW / 2) + '" y2="' + B.y + '"/>'
          + '<text class="p-uboelabel" x="' + (U.x + SPW / 2 + 8) + '" y="' + (U.y + SPH + SPGAP / 2 + 3) + '">UBoE</text>');
      }
    }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' + lkDefs('p-')
      + '<g class="p-links">' + links.join('') + '</g><g class="p-panels">' + panels.join('') + '</g><g class="p-nodes">' + nodes.join('') + '</g></svg>';
  }
  /* ── 放大后在集群画布上原地画出一块板的全部关系（反馈「这些关系好像都看不到了，一个都不能少」）──
     放大到 3× 以上，指针所在的那块板（选中了 rank 就是它所在的那块）把直播四页里的关系原地展开：
     ① 板内 8 卡 UB fullmesh（28 条弧，7×X4）  ② 出板 Clos：每卡 8 口到本组 8 颗 L1（每平面 1 颗）
     ③ L1 → 本平面 4×SW2（L2，4 口）  ④ CPU —UB→ L1（8 口/C）  ⑤ H2D：CPU0 带 NPU0–3、CPU1 带 NPU4–7
     ⑥ CPU0 — CPU1 互联  ⑦ DPU —PCIe— CPU0、DPU —UB→ L1  ⑧ NIC k 挂 NPU 2k/2k+1（1 口 UB）
     ⑨ NIC / DPU —RoCE→ 出框（参数面）  ⑩ NIC 交换（CPU 1 口 / NIC 2 口）  ⑪ 框内 L2 交换板（L1 之间）；
     超节点之间的 UBoE 本来就画着。线型与板视图一致。 */
  var relBoard = null;
  function relSvg(b) {
    var G = GEO.board[b]; if (!G) return '';
    var L1 = GEO.sw1[G.grp] || [], P2 = GEO.sw2[G.sp] || [], out = [], x0 = G.pdx, ry = G.ry, i, k;
    var NX = function (n) { return x0 + 22 + n * PITCH_ + 4.5; }, NT = ry - 3.5, NB = ry + 3.5;
    var CPU = [x0 + 7.7, x0 + 14.1], DPU = x0 + 101.4, NIC = function (k9) { return { x: x0 + 107.2 + (k9 % 2) * 6.8 + 3.2, y: ry - 3.4 + Math.floor(k9 / 2) * 3.4 + 1.6 }; };
    // n：这根线属于哪颗 NPU（data-n，选中它就换激活样式）；稀疏干线加衬边（见上面「连线样式」）
    var SPARSE = { 'rel-ub': 1, 'rel-cpu': 1, 'rel-pcie': 1, 'rel-nic': 1, 'rel-roce': 1, 'rel-nsw': 1, 'rel-inf': 1, 'rel-h2d': 1 };
    function put(el, cls) { out.push(SPARSE[cls] ? cased(el) : el); }
    function na(n) { return n == null ? '' : typeof n === 'string' ? ' data-m="' + n + '"' : ' data-n="' + n + '"'; }
    function ln(cls, x1, y1, x2, y2, n) { put('<line class="' + cls + '"' + na(n) + ' x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>', cls); }
    function cv(cls, x1, y1, x2, y2, bend, n) { put('<path class="' + cls + '"' + na(n) + ' d="M' + x1 + ',' + y1 + ' Q' + ((x1 + x2) / 2) + ',' + (Math.min(y1, y2) + bend) + ' ' + x2 + ',' + y2 + '"/>', cls); }
    // ③ L1 → plane SW2
    L1.forEach(function (s1, k9) { (P2[k9] || []).forEach(function (s2) { ln('rel-l12', s1.x, s1.top, s2.x, s2.y); }); });
    // ② NPU → 8 L1   ④ CPU → 8 L1   ⑦ DPU → L1
    for (i = 0; i < 8; i++) L1.forEach(function (s1) { ln('rel-clos', NX(i), NT, s1.x, s1.bot, i); });
    CPU.forEach(function (cx) { L1.forEach(function (s1) { ln('rel-ub', cx, ry - 2.6, s1.x, s1.bot); }); });
    if (L1[7]) ln('rel-ub', DPU, ry - 3, L1[7].x, L1[7].bot);
    // ① fullmesh arcs (above the NPU row)
    for (i = 0; i < 8; i++) for (k = i + 1; k < 8; k++) cv('rel-mesh', NX(i), NT, NX(k), NT, -(0.6 + (k - i) * 0.55), i + ',' + k);
    // ⑤ H2D (below the row)   ⑥ CPU↔CPU   ⑦ DPU—PCIe—CPU0   ⑧ NIC ↔ NPU pair
    for (i = 0; i < 8; i++) cv('rel-h2d', CPU[i < 4 ? 0 : 1], ry + 2.6, NX(i), NB, 2.4 + (i % 4) * 0.5, i);
    ln('rel-cpu', CPU[0] + 3.1, ry, CPU[1] - 3.1, ry);
    cv('rel-pcie', DPU, ry + 3, CPU[0], ry + 2.6, 5.2);
    for (k = 0; k < 4; k++) { var nc = NIC(k); [2 * k, 2 * k + 1].forEach(function (n9) { cv('rel-nic', nc.x, nc.y + 1.6, NX(n9), NB, 3.6 + k * 0.4, n9); }); }
    // ⑩ NIC 交换（POD 形态图 SW·4N：每 CPU 1 口、每 NIC 2 口）——集群层没有这颗小交换的图元，
    //    画成 CPU1 → NIC 列的一条长弧（在 H2D 弧的更外一层）
    cv('rel-nsw', CPU[1], ry + 2.6, NIC(3).x, NIC(3).y + 1.6, 8.2);
    // ⑪ 框内 L2 交换板：本组 8 颗 L1 经交换板框内互联——在 L1 行上沿画一条横贯的汇流线
    if (L1[0] && L1[7]) ln('rel-inf', L1[0].x - 4, L1[0].top - 1.2, L1[7].x + 4, L1[7].top - 1.2);
    // ⑨ RoCE out of the frame (NICs and DPU), up past the L1 row
    for (k = 0; k < 4; k++) { var nr = NIC(k); ln('rel-roce', nr.x, nr.y - 1.6, nr.x, (L1[0] ? L1[0].top : ry) - 4); }
    ln('rel-roce', DPU, ry - 3, DPU, (L1[0] ? L1[0].top : ry) - 4);
    // the board row itself
    out.push('<rect class="rel-row" x="' + (x0 + 2) + '" y="' + (ry - ROWP_ / 2) + '" width="' + (PODW_ - 4) + '" height="' + ROWP_ + '"/>');
    return '<g class="rel lod1" pointer-events="none">' + out.join('') + '</g>';
  }
  function showRelations(b) {
    if (b === relBoard) return;
    relBoard = b;
    var svgEl = physStage.querySelector('.zp-box svg'); if (!svgEl) return;
    var old = svgEl.querySelector('g.rel'); if (old) old.remove();
    if (b == null) return;
    var tmp = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    tmp.innerHTML = relSvg(b);
    // 关系画在设备之下、结构之上：插在节点层前面，选中框仍在最上
    var nodesG = svgEl.querySelector('.p-nodes');
    svgEl.insertBefore(tmp.firstChild, nodesG);
  }
  physStage.addEventListener('pointerover', function (ev) {
    var svgEl = physStage.querySelector('.zp-box svg');
    if (!svgEl || !svgEl.classList.contains('lod1')) return;
    var t = ev.target.closest('.p-npu, .p-board');
    if (!t) return;
    var b = t.hasAttribute('data-board') ? +t.getAttribute('data-board') : physOf(+t.getAttribute('data-rank')).board;
    showRelations(b);
  });
  function renderPhys() {
    if (physBuilt) return;
    physStage.innerHTML = '<div class="zp-box">' + buildPhysSvg() + '</div>';
    physBuilt = true;
    if (typeof physZP !== 'undefined' && physZP) physZP.reset();
    applyAlerts();
  }
  /* 选中/聚焦态：选中了 rank 就按五个通信组描边、其余压暗；只聚焦了 PP 段就
     把别的段压暗；都没有就全亮。同时把所在 POD / 超节点的框点亮。 */
  function physApplySelection() {
    if (!physBuilt) return;
    var g = curSel != null && ANN.grp ? commGroups(curSel) : null, cls = {};
    if (g) ['pp', 'dp', 'ep', 'cp', 'tp'].forEach(function (k) { g[k].forEach(function (r) { cls[r] = 'g-' + k; }); });
    if (curSel != null) cls[curSel] = 'is-sel';
    var here = curSel != null ? physOf(curSel) : null;
    document.querySelectorAll('.phys-stage .p-npu').forEach(function (el) {
      var r = +el.getAttribute('data-rank'), extra;
      if (g) extra = cls[r] ? ' ' + cls[r] : ' is-dim';
      else if (curSel != null) extra = cls[r] ? ' ' + cls[r] : '';
      else if (OBJ.dim) extra = objVal(r, OBJ.dim) !== OBJ.idx ? ' is-dim' : '';
      else extra = focusPP != null && +el.getAttribute('data-pp') !== focusPP ? ' is-dim' : '';
      var nc = 'p-npu' + (el.hasAttribute('data-slot') ? ' p-bnpu' : '') + extra + ' ' + capClass(r);
      if (el.getAttribute('class') !== nc) el.setAttribute('class', nc);
    });
    if (universeBuilt) universeStage.querySelectorAll('.u-leaf').forEach(function (el) {
      var on = curSel != null && rubikSelToMatrixSel({ tp: +el.getAttribute('data-tp'), cp: +el.getAttribute('data-cp'), pp: +el.getAttribute('data-pp'), rep: +el.getAttribute('data-rep') }) === curSel;
      if (el.classList.contains('is-sel') !== on) el.classList.toggle('is-sel', on);
    });
    [physStage, boardStage, universeStage].forEach(markSelFrame);
    if (curSel != null) showRelations(physOf(curSel).board);
    if (drawerOpen === 'hier') renderHier();
    setTimeout(placeSelLabel, 0);
    // 板视图：选中那颗 NPU 自己的链路（出板 8 口、板内 fullmesh 7 根、H2D、NIC）换激活样式，其余退后；
    // 集群层放大后原地展开的那块板（.rel）同一套
    var slot = here != null && here.board === curBoard ? here.slot : null;
    markHot(boardStage, slot);
    markHot(physStage, here != null ? here.slot : null);
    flowDots(slot);
    physStage.querySelectorAll('.p-pod').forEach(function (el) { el.classList.toggle('is-on', here != null && +el.getAttribute('data-pod') === here.pod); });
    physStage.querySelectorAll('.p-sp').forEach(function (el) { el.classList.toggle('is-on', here != null && +el.getAttribute('data-sp') === here.sp); });
  }
  function markHot(root, slot) {
    root.querySelectorAll('[data-n], [data-m]').forEach(function (el) {
      var n = el.getAttribute('data-n'), m = el.getAttribute('data-m'), on;
      if (slot == null) on = null;
      else if (n != null) on = +n === slot;
      else { var ab = m.split(','); on = +ab[0] === slot || +ab[1] === slot; }
      el.classList.toggle('is-hot', on === true);
      el.classList.toggle('is-cold', on === false);
    });
  }
  /* 激活链路上跑的小圆点（hpc-topology-node Round 4：两颗、相差半个周期；速度 = 带宽——
     板内铜缆快、出板光 UB 慢）。只在板视图画：集群层那几根线不到 1px，点跑起来只是闪烁。 */
  function flowDots(slot) {
    var g = boardStage.querySelector('.b-flow'); if (!g) return;
    if (slot == null) { g.innerHTML = ''; return; }
    var html = [];
    boardStage.querySelectorAll('.b-links .is-hot').forEach(function (el) {
      var d = el.tagName === 'line' ? 'M' + el.getAttribute('x1') + ',' + el.getAttribute('y1') + ' L' + el.getAttribute('x2') + ',' + el.getAttribute('y2') : el.getAttribute('d');
      var fast = !el.classList.contains('b-fan'), dur = fast ? 0.9 : 1.4;
      [0, dur / 2].forEach(function (off) {
        html.push('<circle class="lk-dot" r="2.4"><animateMotion dur="' + dur + 's" begin="-' + off + 's" repeatCount="indefinite" path="' + d + '"/></circle>');
      });
    });
    g.innerHTML = html.join('');
  }
  /* 集群层的点击：NPU = 选中（再点 = 下钻）；POD 第一下 = 取景过去，取景之后
     再点它里面的某一行 = 进那块板（板视图）；超节点 = 取景；空白 = 取消选中/复位。 */
  var fitPod = null;
  function zoomToPod(r) {
    var pod = physStage.querySelector('.p-pod[data-pod="' + physOf(r).pod + '"]'); if (!pod) return;
    fitPod = +pod.getAttribute('data-pod');
    physStage.querySelectorAll('.p-pod.is-fit').forEach(function (el) { el.classList.remove('is-fit'); });
    pod.classList.add('is-fit');
    physZP.fitVB(+pod.getAttribute('x'), +pod.getAttribute('y'), +pod.getAttribute('width'), +pod.getAttribute('height'), 40);
  }
  physStage.addEventListener('click', function (ev) {
    var npu = ev.target.closest('.p-npu');
    /* 再点一次（双击）已选中的格 = 放大到它所在的 POD，看得见封装图元；不再直接下钻单卡——
       下钻只走右列「↓ 单卡」（反馈：双击之后跳到单卡那一屏「完全看不清」「这里为什么不放大了」） */
    if (npu) { var r = +npu.getAttribute('data-rank'); if (r === curSel) zoomToPod(r); else showTier2(r, coordLine(r)); return; }
    var row = ev.target.closest('.p-board');
    if (row && fitPod === +row.getAttribute('data-pod')) { goBoard(+row.getAttribute('data-board'), true); return; }
    var box = ev.target.closest('.p-pod, .p-sp');
    if (box) {
      var isPod = box.classList.contains('p-pod');
      fitPod = isPod ? +box.getAttribute('data-pod') : null;
      physStage.querySelectorAll('.p-pod.is-fit').forEach(function (el) { el.classList.remove('is-fit'); });
      if (isPod) box.classList.add('is-fit');
      physZP.fitVB(+box.getAttribute('x'), +box.getAttribute('y'), +box.getAttribute('width'), +box.getAttribute('height'), isPod ? 60 : 30);
      return;
    }
    if (curSel != null) { showOverview(true); return; }
    physZP.reset();
    showOverview();
  });

  // ── 板视图：一块板（Server 形态）的全部关系，按直播四页的图一处不落 ──────
  // 第二页 Server：8 NPU + 2 CPU（1650/鲲鹏），server 内 NPU 之间 UB fullmesh
  //   （每卡 7×X4 UB 口），出 server 走 Clos（每卡 8×X4 UB 口 → 8 颗 L1，每平面
  //   一颗）；H2D：A+K 2 口 UB（鲲鹏），A+X 走 4 口 PCIe SW（x86，第三页标卡）；
  //   NIC 1 口 UB 挂在 NPU 下面、RoCE 出框到参数面，每张 NIC 服务相邻两颗 NPU。
  // 第三页 POD：CPU 8 口/C 上 L1、NIC 2 口/N；标卡：CPU0—CPU1 互联，PCIe SW 各带
  //   4 卡 + 2 NIC。第四页机柜：DPU —PCIe— CPU、DPU —RoCE→ 外、CPU/NPU/DPU 各自
  //   —UB→ L1 灵衢 SW，L1 —UB→ L2（灵衢/以太），L2 —UB→ 其他机柜，超节点之间
  //   UBoE。第一页：每平面 4×SW2，L1/L2 成 Clos，平面间无互联。
  // 版式照第二页 Server 图：CPU 行在上，NPU 行居中，fullmesh 弧画在 NPU 行上方，
  //   NPU 往下 8 口扇出到 L1 行，L1 再到各自平面的 4×SW2。
  var curBoard = null, boardBuilt = null;
  /* ── 连线样式（反馈「连线按 hpc-topology-node 的连线样式适配；太细时要换显示方式」）──
     那边（硬件图元库 · 连线样式 Round 6）每条线是两层：一条底色衬边（casing）把交叉处
     切开，上面一条芯线，芯线的实线 / 虚线节奏区分介质——铜缆实线、光 UB 虚线 7 5、
     长距 UBoE 稀虚线 4 7 且半透明、RDMA 端头一个空心环；激活的链路芯线走流动虚线，
     上面有小圆点顺着线跑（速度 = 带宽）。这里去掉色相（本页只用中性灰，告警才上色），
     保留结构，并按粗细分档：
       · 稀疏的干线（CPU↔CPU、PCIe、UB→L1、RoCE、NIC 交换、UBoE、交换板）：近看一律加衬边
       · 成束的密线（出板 Clos 64 根、板内 fullmesh 28 根、L1→L2）：线一多一细，衬边和虚线
         只剩噪点，所以平时就是一根发丝线；只有选中那颗 NPU 自己的那几根换成激活样式
       · 集群总览（线宽不到 1px）：不画衬边、虚线收成实线（UBoE 除外），只看走向；
         放大到 3× 起衬边与虚线节奏才出来，板视图始终是近看档 */
  /* 端点（反馈「连线的开头和结尾有点生硬，给一个精致的端点」）：参照 hpc-topology-node 3D 线端的
     「底座环 + 白心」，2D 里做成 marker——底色实心环 + 灰描边 + 中心小点，像一个端口；并进总线的
     那一头是一颗实心汇接点。markerUnits=strokeWidth，跟线宽一起缩放，放大缩小比例不变；
     激活（选中那颗 NPU 的线）换白色、稍小一号，免得端点压过线本身。 */
  function lkDefs(p) {
    function port(id, ring, dot, r) {
      return '<marker id="' + p + id + '" viewBox="-5 -5 10 10" markerWidth="10" markerHeight="10" markerUnits="strokeWidth" refX="0" refY="0" orient="auto">'
        + '<circle r="' + r + '" fill="#111111" stroke="' + ring + '" stroke-width="0.9"/><circle r="' + (r * 0.36).toFixed(2) + '" fill="' + dot + '"/></marker>';
    }
    return '<defs>' + port('lkp', '#A0A0A0', '#C8C8C8', 2.6) + port('lkh', '#FFFFFF', '#FFFFFF', 2.1)
      + '<marker id="' + p + 'lkj" viewBox="-3 -3 6 6" markerWidth="6" markerHeight="6" markerUnits="strokeWidth" refX="0" refY="0"><circle r="1.7" fill="#A0A0A0"/></marker></defs>';
  }
  function cased(el) { return el.replace(/ class="[^"]*"/, ' class="lkc"').replace(/<title>[\s\S]*?<\/title>/, '') + el; }
  function buildBoardSvg(bIdx) {
    var W = 960, H = 590, base = bIdx * PHYS.board, pb = physOf(base);
    var NX = function (i) { return 152 + i * 100; };   // NPU/L1/L2 列中心
    var NPUY = 150, NPUH = 40, L1Y = 330, L1H = 24, SWBY = 386, SWBH = 20, L2Y = 452, L2H = 30, CPUY = 58;
    var bg = [], links = [], nodes = [], txt = [];
    /* 部件框：左边一枚 hpc-topology-node 的 2D 图元（hw-icons.js），右边是名字 */
    var BOX_ICON = { 'b-cpu': 'hw-cpu', 'b-dpu': 'hw-dpu', 'b-nic': 'hw-nic', 'b-l1': 'hw-sw', 'b-nsw': 'hw-sw', 'b-swb': 'hw-sw' };
    function box(cls, cx, y, w, h, label, title, attrs) {
      var ic = BOX_ICON[cls], ih = h - 6, iw = ih * 4 / 3, x0 = cx - w / 2;
      nodes.push('<g class="' + cls + '"' + (attrs || '') + '><rect x="' + x0 + '" y="' + y + '" width="' + w + '" height="' + h + '"/>'
        + (ic ? '<use href="#' + ic + '" x="' + (x0 + 3) + '" y="' + (y + 3) + '" width="' + iw + '" height="' + ih + '"/>' : '')
        + '<text x="' + (ic ? x0 + 3 + iw + (w - 3 - iw) / 2 : cx) + '" y="' + (y + h / 2 + 3.5) + '" text-anchor="middle">' + label + '</text>' + (title ? '<title>' + title + '</title>' : '') + '</g>');
    }
    // 参数面 RoCE 总线（顶）：NIC 与 DPU 都从这儿出框
    links.push(cased('<line class="b-roce b-bus" x1="60" y1="22" x2="900" y2="22"/>'));
    txt.push('<text class="b-lbl b-lbl-roce" x="904" y="25">RoCE</text>');
    // CPU 行：DPU · NIC0 · CPU0 · NIC1 · NIC2 · CPU1 · NIC3
    box('b-dpu', 72, CPUY, 64, 22, 'DPU', 'DPU · PCIe 接 CPU0 · UB 上 L1 · RoCE 出框');
    links.push(cased('<line class="b-roce" x1="72" y1="22" x2="72" y2="' + CPUY + '"/>'));
    for (var k = 0; k < 4; k++) {
      var nx = (NX(2 * k) + NX(2 * k + 1)) / 2;
      box('b-nic', nx, CPUY + 1, 58, 22, 'NIC' + k, 'NIC' + k + ' · 1 口 UB 挂 NPU' + (2 * k) + '/NPU' + (2 * k + 1) + ' · RoCE 出框', ' data-nic="' + k + '"');
      links.push(cased('<line class="b-roce" x1="' + nx + '" y1="22" x2="' + nx + '" y2="' + (CPUY + 2) + '"/>'));
      // RDMA 端头：NIC 顶上一个空心环（hpc-topology-node 的 RDMA 端点画法）
      nodes.push('<circle class="b-rdma" cx="' + nx + '" cy="' + (CPUY + 1) + '" r="3.2"/>');
      // NIC 交换（POD 形态图「SW 4*N · 2口/N」）：每张 NIC 2 口汇到右侧那颗小交换
      links.push(cased('<path class="b-nsw-l" d="M' + (nx + 16) + ',' + (CPUY + 1) + ' V48 H881"><title>NIC' + k + ' — NIC 交换 · 2 口</title></path>'));
      [2 * k, 2 * k + 1].forEach(function (i) {
        links.push('<line class="b-nicl" data-n="' + i + '" x1="' + nx + '" y1="' + (CPUY + 22) + '" x2="' + NX(i) + '" y2="' + NPUY + '"><title>NIC' + k + ' — NPU' + i + ' · UB 1 口</title></line>');
      });
    }
    [0, 1].forEach(function (c) {
      var cx = (NX(4 * c + 1) + NX(4 * c + 2)) / 2;
      box('b-cpu', cx, CPUY, 110, 34, 'CPU' + c, 'CPU' + c + ' · H2D 每卡 2 口 UB（x86 走 4 口 PCIe SW）· 8 口 UB 上 L1', ' data-cpu="' + c + '"');
      for (var i = 4 * c; i < 4 * c + 4; i++) links.push('<line class="b-h2d" data-n="' + i + '" x1="' + cx + '" y1="' + (CPUY + 34) + '" x2="' + NX(i) + '" y2="' + NPUY + '"><title>CPU' + c + ' — NPU' + i + ' · H2D · UB 2 口</title></line>');
    });
    var c0 = (NX(1) + NX(2)) / 2, c1 = (NX(5) + NX(6)) / 2;
    box('b-nsw', 905, CPUY + 1, 48, 22, 'SW', 'NIC 交换（POD 形态：SW 挂 4×NIC，每 NIC 2 口；每颗 CPU 1 口）');
    [c0, c1].forEach(function (cx9, ci) {
      links.push(cased('<path class="b-nsw-l" d="M' + (cx9 + 40) + ',' + CPUY + ' V40 H' + (897 + ci * 10) + ' V' + (CPUY + 1) + '"><title>CPU' + ci + ' — NIC 交换 · 1 口</title></path>'));
    });
    txt.push('<text class="b-lbl" x="905" y="' + (CPUY + 50) + '" text-anchor="middle">1口/C · 2口/N</text>');
    links.push(cased('<path class="b-cpul" d="M' + (c0 + 55) + ',' + (CPUY + 10) + ' C' + (c0 + 120) + ',' + (CPUY - 22) + ' ' + (c1 - 120) + ',' + (CPUY - 22) + ' ' + (c1 - 55) + ',' + (CPUY + 10) + '"><title>CPU0 — CPU1 互联</title></path>'));
    txt.push('<text class="b-lbl" x="' + ((c0 + c1) / 2) + '" y="' + (CPUY - 2) + '" text-anchor="middle">CPU↔CPU</text>');
    // DPU —PCIe— CPU0；DPU/CPU0 —UB— L1（走左边沿）；CPU1 —UB— L1（走右边沿）
    links.push(cased('<path class="b-pcie" d="M88,' + (CPUY + 22) + ' V' + (CPUY + 30) + ' H' + (c0 - 55) + '"><title>DPU — CPU0 · PCIe</title></path>'));
    txt.push('<text class="b-lbl" x="' + ((88 + c0 - 55) / 2) + '" y="' + (CPUY + 41) + '" text-anchor="middle">PCIe</text>');
    links.push(cased('<path class="b-ub" d="M56,' + (CPUY + 22) + ' V' + (CPUY + 34) + ' H20 V' + (L1Y + L1H / 2) + ' H' + (NX(0) - 32) + '"><title>DPU / CPU0 — L1 · UB</title></path>'));
    links.push(cased('<path class="b-ub" d="M' + (c0 - 55) + ',' + (CPUY + 34) + ' H20"/>'));
    links.push(cased('<path class="b-ub" d="M' + (c1 + 55) + ',' + (CPUY + 34) + ' H940 V' + (L1Y + L1H / 2) + ' H' + (NX(7) + 32) + '"><title>CPU1 — L1 · UB</title></path>'));
    txt.push('<text class="b-lbl" x="14" y="' + ((CPUY + L1Y) / 2) + '" text-anchor="middle" transform="rotate(-90 14 ' + ((CPUY + L1Y) / 2) + ')">UB → L1</text>');
    txt.push('<text class="b-lbl" x="946" y="' + ((CPUY + L1Y) / 2) + '" text-anchor="middle" transform="rotate(90 946 ' + ((CPUY + L1Y) / 2) + ')">UB → L1</text>');
    // NPU 行 + 板内 fullmesh（弧在行上方）
    for (var i = 0; i < 8; i++) {
      var r = base + i; if (r >= world) break;
      nodes.push('<g class="b-npug"><rect class="p-npu p-bnpu" data-rank="' + r + '" data-slot="' + i + '" data-pp="' + coordOfRank(r).pp + '" x="' + (NX(i) - 32) + '" y="' + NPUY + '" width="64" height="' + NPUH + '"><title>NPU' + i + ' · rank ' + r + ' · ' + coordLine(r) + '</title></rect>'
        + '<use class="b-npuicon" href="#hw-npu" x="' + (NX(i) - 32) + '" y="' + (NPUY + 4) + '" width="36" height="27"/>'
        + '<rect class="b-npustrip" x="' + (NX(i) - 28) + '" y="' + (NPUY + 34) + '" width="28" height="3"/>'
        + '<text class="b-npul" x="' + (NX(i) + 19) + '" y="' + (NPUY + 18) + '" text-anchor="middle">' + r + '</text><text class="b-npur" x="' + (NX(i) + 15) + '" y="' + (NPUY + 31) + '" text-anchor="middle">npu' + i + '</text></g>');
      for (var j = i + 1; j < 8; j++) {
        var off = 12 + (j - i) * 13;
        links.push('<path class="b-mesh" data-m="' + i + ',' + j + '" d="M' + NX(i) + ',' + NPUY + ' Q' + ((NX(i) + NX(j)) / 2) + ',' + (NPUY - off) + ' ' + NX(j) + ',' + NPUY + '"/>');
      }
    }
    txt.push('<text class="b-lbl b-lbl-mesh" x="' + ((NX(3) + NX(4)) / 2) + '" y="' + (NPUY - 58) + '" text-anchor="middle">fullmesh 7×X4</text>');
    // 出板：每颗 NPU 8 口，每口一颗 L1（每平面一颗）
    for (var i2 = 0; i2 < 8; i2++) for (var k2 = 0; k2 < 8; k2++) {
      if (base + i2 >= world) break;
      links.push('<line class="b-fan" data-n="' + i2 + '" style="--pc:' + PLANE_C[k2] + '" x1="' + NX(i2) + '" y1="' + (NPUY + NPUH) + '" x2="' + NX(k2) + '" y2="' + L1Y + '"/>');
    }
    txt.push('<text class="b-lbl" x="' + ((NX(3) + NX(4)) / 2) + '" y="' + (L1Y - 8) + '" text-anchor="middle">Clos 8×X4</text>');
    // L1 行（每平面一颗）→ 本平面 4×SW2（L2）
    for (var k3 = 0; k3 < 8; k3++) {
      box('b-l1', NX(k3), L1Y, 64, L1H, 'P' + (k3 + 1), 'L1 灵衢 SW · 平面 ' + (k3 + 1) + ' · 4 口 → 本平面 4×SW2', ' style="--pc:' + PLANE_C[k3] + '"');
      bg.push('<rect class="b-plane" style="--pc:' + PLANE_C[k3] + '" x="' + (NX(k3) - 32) + '" y="' + L2Y + '" width="64" height="' + L2H + '"><title>L2 · 平面 ' + (k3 + 1) + ' · 4×SW2 · 与本平面每颗 L1 成 Clos</title></rect>');
      for (var q = 0; q < 4; q++) {
        var qx = NX(k3) - 24 + q * 16;
        bg.push('<rect class="b-sw2" style="--pc:' + PLANE_C[k3] + '" x="' + (qx - 4) + '" y="' + (L2Y + L2H - 11) + '" width="10" height="6"/>');
        links.push('<line class="b-l12" style="--pc:' + PLANE_C[k3] + '" x1="' + NX(k3) + '" y1="' + (L1Y + L1H) + '" x2="' + (qx + 1) + '" y2="' + (L2Y + L2H - 11) + '"/>');
      }
      txt.push('<text class="b-lbl b-lbl-plane" x="' + NX(k3) + '" y="' + (L2Y + 12) + '" text-anchor="middle">P' + (k3 + 1) + '</text>');
      links.push(cased('<line class="b-ub b-out" x1="' + NX(k3) + '" y1="' + (L2Y + L2H) + '" x2="' + NX(k3) + '" y2="' + (L2Y + L2H + 22) + '"/>'));
    }
    txt.push('<text class="b-lbl" x="' + ((NX(3) + NX(4)) / 2) + '" y="' + (L2Y - 8) + '" text-anchor="middle">框间 4×X4</text>');
    /* 框内 L2「交换板」（POD 形态图：L2 层 2*SW + 2*SW，每颗 L1 出 4 口，作框内板间互联；
       同一块交换板配成 8 口时也可以出框）。本页的 1024P 组网按第一页「单层 SW 出框」画，
       交换板这一层画在 L1 与平面之间，只连 L1、两侧短线表示它通向框内其他板。 */
    [(NX(1) + NX(2)) / 2, (NX(5) + NX(6)) / 2].forEach(function (sx, si) {
      box('b-swb', sx, SWBY, 76, SWBH, '2×SW', '框内 L2 交换板 ' + (si ? 'B' : 'A') + ' · 2×SW · 每颗 L1 4 口 · 框内板间互联（配 8 口时可出框）');
      for (var k4 = 0; k4 < 8; k4++) links.push('<line class="b-swbl" x1="' + NX(k4) + '" y1="' + (L1Y + L1H) + '" x2="' + (sx - 30 + k4 * 60 / 7) + '" y2="' + SWBY + '"/>');
      links.push(cased('<line class="b-swbx" x1="' + (sx + (si ? 38 : -38)) + '" y1="' + (SWBY + SWBH / 2) + '" x2="' + (si ? 948 : 12) + '" y2="' + (SWBY + SWBH / 2) + '"><title>交换板 → 框内其他板</title></line>'));
    });
    txt.push('<text class="b-lbl" x="' + ((NX(3) + NX(4)) / 2) + '" y="' + (SWBY + 14) + '" text-anchor="middle">框内 4口 · 交换板</text>');
    // 底部总线不加衬边：上面落下来的 8 根短线要在它身上汇成一排汇接点，衬边会把接点切掉
    links.push('<line class="b-ub b-bus" x1="60" y1="' + (L2Y + L2H + 22) + '" x2="' + (NX(3) + 40) + '" y2="' + (L2Y + L2H + 22) + '"/>'
      + '<line class="b-uboe b-bus" x1="' + (NX(4) - 40) + '" y1="' + (L2Y + L2H + 22) + '" x2="900" y2="' + (L2Y + L2H + 22) + '"/>');
    txt.push('<text class="b-lbl b-lbl-ub" x="60" y="' + (L2Y + L2H + 36) + '">UB → POD</text>'
      + '<text class="b-lbl b-lbl-uboe" x="900" y="' + (L2Y + L2H + 36) + '" text-anchor="end">UBoE → SuperPoD</text>');
    return '<svg class="near" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' + lkDefs('b-')
      + '<g class="b-bg">' + bg.join('') + '</g><g class="b-links">' + links.join('') + '</g><g class="b-flow"></g><g class="b-nodes">' + nodes.join('') + '</g><g class="b-txt">' + txt.join('') + '</g></svg>';
  }
  function renderBoard(bIdx) {
    if (boardBuilt === bIdx) return;
    boardStage.innerHTML = '<div class="zp-box">' + buildBoardSvg(bIdx) + '</div>';
    boardBuilt = bIdx;
    applyAlerts();
  }
  boardStage.addEventListener('click', function (ev) {
    var npu = ev.target.closest('.p-npu');
    if (npu) { var r = +npu.getAttribute('data-rank'); if (r !== curSel) showTier2(r, coordLine(r)); return; }
    if (curSel != null) { showOverview(true); return; }
    boardZP.reset();
  });

  // ── 画布缩放/平移：滚轮以指针为中心缩放，拖拽平移，双击/工具条复位 ────
  // 变换写在 <svg> 元素的 CSS transform 上（合成器路径，几千个图元不重光栅化，
  // 与 demo.html 的 applyViewTransform 同一个理由）。拖动过就吃掉随后的
  // click（捕获阶段），免得松手时误触叶子/NPU。
  /* 缩放时线宽不变：不再把倍数写成根上的继承变量 --zk（一改就让舞台里上万个元素全部重算样式，
     回到集群一次 300ms+），而是开场时把 CSS 里所有用到 var(--zk) 的描边规则登记下来，每个舞台
     缩放时往一张专用 <style> 里写一份「#舞台 选择器 { stroke-width: 基准/倍数 }」——只有真正带描边的
     那几百个元素被重算。倍数没变就不写。 */
  var ZK_RULES = null, zkSheet = document.createElement('style'), zkText = {}, zkLast = {};
  document.head.appendChild(zkSheet);
  function collectZkRules() {
    ZK_RULES = [];
    Array.prototype.forEach.call(document.styleSheets, function (sh) {
      var rules; try { rules = sh.cssRules; } catch (e) { return; }
      Array.prototype.forEach.call(rules || [], function (r) {
        if (!r.style) return;
        var v = r.style.getPropertyValue('stroke-width'), m = /calc\(\s*([0-9.]+)px\s*\/\s*var\(--zk/.exec(v);
        if (m) ZK_RULES.push({ sel: r.selectorText, px: +m[1], imp: r.style.getPropertyPriority('stroke-width') });
      });
    });
  }
  function setZoomStroke(stage, k) {
    if (!stage.id) return;
    var kk = Math.round(k * 100) / 100;
    if (zkLast[stage.id] === kk) return;
    zkLast[stage.id] = kk;
    if (!ZK_RULES) collectZkRules();
    zkText[stage.id] = ZK_RULES.map(function (r) {
      return r.sel.split(',').map(function (x) { return '#' + stage.id + ' ' + x.trim(); }).join(', ') + ' { stroke-width: ' + (r.px / kk).toFixed(3) + 'px' + (r.imp ? ' !important' : '') + '; }';
    }).join('\n');
    zkSheet.textContent = Object.keys(zkText).map(function (id) { return zkText[id]; }).join('\n');
  }
  function safeArea(R) {
    var bc = document.body.classList, l = 312, r = 312, t = 64, b = 72;
    if (bc.contains('panel-right')) r = drawer.offsetWidth + 40;
    if (bc.contains('panel-left')) l = drawer.offsetWidth + 40;
    if (bc.contains('panel-bottom')) b = drawer.offsetHeight + 72;
    return { x: l, y: t, w: Math.max(200, R.width - l - r), h: Math.max(200, R.height - t - b) };
  }
  function attachZoomPan(stage) {
    var st = { k: 1, tx: 0, ty: 0, stage: stage, drag: null, moved: false };
    function svg() { return stage.querySelector('.zp-box svg'); }
    // 参照系是 .zp-box（不动的盒子），不是被 transform 过的 <svg>。用 offset*
    // 而不是 getBoundingClientRect：舞台切换那 .5s 里 .is-hidden 的 scale(1.5)
    // 过渡会把矩形量大，取景就落偏；offset* 是布局值，不受 transform 影响，
    // 舞台本身 fixed inset:0，所以 offsetLeft/Top 就是视口坐标。
    st.rect = function () {
      var b = stage.querySelector('.zp-box');
      if (!b) return stage.getBoundingClientRect();
      return { left: b.offsetLeft, top: b.offsetTop, width: b.offsetWidth, height: b.offsetHeight };
    };
    function apply() { var s = svg(); if (!s) return; s.style.transformOrigin = '0 0'; s.style.transform = 'translate(' + st.tx + 'px,' + st.ty + 'px) scale(' + st.k + ')'; setZoomStroke(stage, st.k); s.classList.toggle('lod1', st.k >= 3); s.classList.toggle('lod2', st.k >= 6); if (curSel != null) markSelFrame(stage); placeSelLabel(); }
    /* 画布铺满整个视口（反馈「左边不要做成单独的面板，卡片悬浮在画布上、毛玻璃、不遮挡后面」），
       四周的卡是半透明悬浮的；取景时把内容摆进卡与卡之间那块「安全区」的正中，初始/复位也一样。 */
    st.reset = function () { var s = svg(); if (!s) { st.k = 1; st.tx = 0; st.ty = 0; apply(); return; } var vb = s.viewBox.baseVal; st.fitVB(vb.x, vb.y, vb.width, vb.height, 0); };
    st.zoomAt = function (f, px, py) {
      st.auto = false;
      var k2 = Math.min(16, Math.max(0.4, st.k * f)); f = k2 / st.k;
      st.tx = px - (px - st.tx) * f; st.ty = py - (py - st.ty) * f; st.k = k2; apply();
    };
    /* 按 viewBox 坐标取景（不量 DOM 矩形：舞台切换时 .is-hidden 的 scale 过渡
       会把矩形量歪）：先算 meet 缩放下这块区域落在盒子里的像素位置，再解出
       让它居中撑满的 k/tx/ty。 */
    st.fitVB = function (x, y, w, h, pad) {
      var s = svg(); if (!s) return;
      var vb = s.viewBox.baseVal, R = st.rect();
      var m = Math.min(R.width / vb.width, R.height / vb.height);
      var ox = (R.width - vb.width * m) / 2, oy = (R.height - vb.height * m) / 2;
      var px = ox + (x - vb.x) * m, py = oy + (y - vb.y) * m, pw = w * m, ph = h * m, S = safeArea(R);
      var k = Math.min(16, Math.max(0.2, Math.min((S.w - pad * 2) / pw, (S.h - pad * 2) / ph)));
      st.k = k; st.tx = S.x + S.w / 2 - k * (px + pw / 2); st.ty = S.y + S.h / 2 - k * (py + ph / 2); apply();
      st.last = [x, y, w, h, pad]; st.auto = true;
    };
    /* 面板开合 / 窗口变化后安全区变了：用户没手动缩放拖动过，就按上一次的取景目标重新摆正；
       手动动过就不抢镜头。 */
    st.refit = function () { if (st.auto && st.last) st.fitVB.apply(null, st.last); };
    stage.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var R = st.rect();
      st.zoomAt(Math.exp(-ev.deltaY * 0.0015), ev.clientX - R.left, ev.clientY - R.top);
    }, { passive: false });
    stage.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      st.drag = { x: ev.clientX, y: ev.clientY, tx: st.tx, ty: st.ty }; st.moved = false;
    });
    window.addEventListener('pointermove', function (ev) {
      if (!st.drag) return;
      var dx = ev.clientX - st.drag.x, dy = ev.clientY - st.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) st.moved = true;
      if (st.moved) { st.auto = false; st.tx = st.drag.tx + dx; st.ty = st.drag.ty + dy; apply(); }
    });
    window.addEventListener('pointerup', function () { st.drag = null; });
    stage.addEventListener('click', function (ev) { if (st.moved) { ev.stopPropagation(); ev.preventDefault(); st.moved = false; } }, true);
    stage.addEventListener('dblclick', function (ev) { if (!ev.target.closest('.p-npu, .u-leaf, .p-pod, .p-board, .u-hub')) st.reset(); });
    return st;
  }
  var uniZP = attachZoomPan(universeStage), physZP = attachZoomPan(physStage), boardZP = attachZoomPan(boardStage);
  (function () { var r0 = physZP.reset; physZP.reset = function () { fitPod = null; physStage.querySelectorAll('.p-pod.is-fit').forEach(function (el) { el.classList.remove('is-fit'); }); r0(); }; })();
  function curZP() { return level === 'segment' ? uniZP : level === 'board' ? boardZP : physZP; }

  // ── 底部工具条：缩放 + 三个参考抽屉 ─────────────────────────────────────
  var DRAWERS = {
    netgraph: { title: '整网图', src: function () { return '../model-netgraph/pattern.html?' + new URLSearchParams({ embed: '1', theme: 'dark', preset: PS.matrixPreset }).toString(); } },
    // 泳道是 compute-graph-viewer 的上游拷贝，画的是它自己那份 32 卡示例，不接
    // 当前预置——标题里带一句，不冒充。
    swimlane: { title: '泳道图 · 上游 32 卡示例', src: function () { return '../../combo-workbench/swimlane.html?chrome=0&theme=dark'; } },
    rubik: { title: '逻辑魔方', src: function () { return rubikSrc; } },
    hier: { title: '层级剖面', native: true }
  };
  /* 三个参考面板不悬浮在画布上，而是像 combo-workbench 的槽位那样占一边、把
     画布挤过去：泳道图在下方（一条横向的时间轴，天然横着放），整网图在右侧，
     逻辑魔方在左侧。哪一边开着，那一边的悬浮卡/链路就让位（CSS 按 body 上的
     panel-* 类收起），.zp-box 的内边距同步收缩，画布始终完整可见、不被压。 */
  var DRAWER_POS = { netgraph: 'bottom', swimlane: 'bottom', rubik: 'right', hier: 'right' };
  var PANEL_W0 = { rubik: 0.4, hier: 372 };
  /* 下方面板各自的默认高度：泳道只有几条道，矮一点；整网图要看层结构，高一点 */
  var PANEL_H0 = { swimlane: 272, netgraph: 0.46 };
  var drawerOpen = null;
  function openDrawer(key) {
    ['at-left', 'at-right', 'at-bottom'].forEach(function (c) { drawer.classList.remove(c); });
    ['panel-left', 'panel-right', 'panel-bottom'].forEach(function (c) { document.body.classList.remove(c); });
    if (drawerOpen === key || !key) {
      drawerOpen = null; drawer.classList.add('is-hidden');
    } else {
      drawerOpen = key; drawerTitle.textContent = DRAWERS[key].title;
      var nat = !!DRAWERS[key].native;
      drawerFrame.style.display = nat ? 'none' : ''; drawerBody.hidden = !nat;
      if (nat) renderHier();
      else { var src = DRAWERS[key].src(); if (drawerFrame.getAttribute('src') !== src) drawerFrame.src = src; }
      drawer.classList.add('at-' + DRAWER_POS[key]); document.body.classList.add('panel-' + DRAWER_POS[key]);
      applyPanelHeight(); applyPanelWidth();
      drawer.setAttribute('data-panel', key);
      drawer.classList.remove('is-hidden');
    }
    dock.querySelectorAll('[data-drawer]').forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-drawer') === drawerOpen); });
    syncCardHeights(); curZP().refit(); syncLinked(true);
  }
  drawer.addEventListener('click', function (ev) { if (ev.target.closest('[data-act="drawer-close"]')) openDrawer(null); });
  /* 面板尺寸可拖：泳道（下方）拖上沿改高度，整网图/魔方（左右）拖内沿改宽度。尺寸写成
     根元素上的 --pb-h / --ps-w，画布可视区、工具条、两条链都跟着这两个变量让位；
     记在本机（localStorage，读不到就用默认），双击拖动条复位。 */
  var drawerBody = document.getElementById('drawerBody');
  var drawerGrip = document.getElementById('drawerGrip'), rootStyle = document.documentElement.style;
  function panelKey(k) { return 'rtl.panel.' + k + '.' + drawerOpen; }
  function setPanelSize(k, px, noSave) {
    if (k === 'h') px = Math.max(140, Math.min(window.innerHeight - 200, px));
    else px = Math.max(320, Math.min(window.innerWidth - 480, px));
    rootStyle.setProperty(k === 'h' ? '--pb-h' : '--ps-w', px + 'px');
    if (!noSave) try { localStorage.setItem(panelKey(k), String(Math.round(px))); } catch (e) {}
  }
  /* 打开某个下方面板时换上它自己的高度（记过的优先，否则默认） */
  function applyPanelHeight() {
    if (DRAWER_POS[drawerOpen] !== 'bottom') return;
    var v = 0; try { v = +localStorage.getItem(panelKey('h')); } catch (e) {}
    var d0 = PANEL_H0[drawerOpen] || 220;
    setPanelSize('h', v || (d0 < 1 ? d0 * window.innerHeight : d0), true);
  }
  /* 侧边面板各自的默认宽度：魔方要看立体网格，宽；层级剖面是一列窄条，窄 */
  function applyPanelWidth() {
    if (DRAWER_POS[drawerOpen] === 'bottom') return;
    var v = 0; try { v = +localStorage.getItem(panelKey('w')); } catch (e) {}
    var d0 = PANEL_W0[drawerOpen] || 0.4;
    setPanelSize('w', v || (d0 < 1 ? d0 * window.innerWidth : d0), true);
  }
  drawerGrip.addEventListener('pointerdown', function (ev) {
    ev.preventDefault();
    var pos = DRAWER_POS[drawerOpen]; if (!pos) return;
    var r = drawer.getBoundingClientRect();
    document.body.classList.add('is-resizing');
    function mv(e) {
      if (pos === 'bottom') setPanelSize('h', r.bottom - e.clientY);
      else if (pos === 'left') setPanelSize('w', e.clientX - r.left);
      else setPanelSize('w', r.right - e.clientX);
      syncCardHeights(); placeSelLabel();
    }
    function up() {
      document.body.classList.remove('is-resizing'); curZP().refit(); if (drawerOpen === 'hier') renderHier();
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
    }
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  });
  drawerGrip.addEventListener('dblclick', function () {
    var k = DRAWER_POS[drawerOpen] === 'bottom' ? 'h' : 'w';
    try { localStorage.removeItem(panelKey(k)); } catch (e) {}
    if (k === 'h') applyPanelHeight(); else applyPanelWidth();
    syncCardHeights(); placeSelLabel();
  });
  dock.addEventListener('click', function (ev) {
    if (ev.target.closest('[data-pop="cfg"]')) { toggleCfg(); return; }
    var d = ev.target.closest('[data-drawer]');
    if (d) { openDrawer(d.getAttribute('data-drawer')); return; }
    var b = ev.target.closest('[data-zoom]'); if (!b) return;
    var z = curZP(), R = z.rect(), a = b.getAttribute('data-zoom');
    if (a === 'reset') z.reset(); else z.zoomAt(a === 'in' ? 1.4 : 1 / 1.4, R.width / 2, R.height / 2);
  });

  // ── 顶栏：面包屑（集群 › PP 段 › rank › 单卡），每一级都能点回去 ──────────
  topbar.addEventListener('click', function (ev) {
    var cr = ev.target.closest('[data-cr]');
    if (!cr) return;
    var to = cr.getAttribute('data-cr');
    if (to === 'root') { physZP.reset(); showOverview(); }
    else if (to === 'pp') goSegment(focusPP, true);
    else if (to === 'board') goBoard(curBoard, true);
    else if (to === 'rank') showTier2(curSel, pendingSubLine || coordLine(curSel));
  });
  function renderCrumb() {
    var parts = ['<button type="button" class="cr" data-cr="root">集群</button>'];
    var mid = level === 'card' ? backLevel : level;
    if (mid === 'segment' && focusPP != null) parts.push(level === 'segment' && curSel == null ? '<span class="cr is-cur">PP' + focusPP + '</span>' : '<button type="button" class="cr" data-cr="pp">PP' + focusPP + '</button>');
    if (mid === 'board' && curBoard != null) parts.push(level === 'board' && curSel == null ? '<span class="cr is-cur">板 ' + curBoard + '</span>' : '<button type="button" class="cr" data-cr="board">板 ' + curBoard + '</button>');
    if (curSel != null) parts.push(tier === 3 ? '<button type="button" class="cr" data-cr="rank">rank ' + curSel + '</button>' : '<span class="cr is-cur">rank ' + curSel + '</span>');
    if (tier === 3) parts.push('<span class="cr is-cur">单卡</span>');
    crumbEl.innerHTML = parts.join('<i>›</i>');
    document.body.classList.toggle('t3', tier === 3 && !detailFrame.classList.contains('is-hidden'));
    syncCardHeights();
    placeSelLabel();
    syncLinked();
  }

  // ── 左卡：模型/切分/物理规模 + PP 段入口 + 图例 + 落位假设 ──────────────
  /* 左侧：标题（模型名）+ 规模两行 + PP 段柱状选择器 + 灰度图例，不套卡片。
     每段一根柱、共用基线：柱高 = 这一段里占用率最高那张卡（合计 / HBM），
     柱的灰度与画布上的格子同一把尺；虚线是 100% 容量线。只有选中那根柱顶上
     写具体数值，点柱 = 进这一段。 */
  var ppPeak = null;
  function ppPeaks() {
    if (ppPeak || !lastCluster || !lastCluster.ratio) return ppPeak;
    ppPeak = [];
    for (var i = 0; i < PS.pp; i++) ppPeak.push({ v: 0, r: null });
    lastCluster.ratio.forEach(function (v, r) { var k = coordOfRank(r).pp; if (v > ppPeak[k].v) { ppPeak[k].v = v; ppPeak[k].r = r; } });
    return ppPeak;
  }
  function ratioClass(v) { return !lastCluster ? '' : v > 1 ? 'c3' : v >= lastCluster.red ? 'c2' : v >= lastCluster.amber ? 'c1' : 'c0'; }
  /* 容量告警也在左列（反馈「告警都放在左侧」「一起放在左侧」）：只写有的那几档，
     紧跟一颗「→ rank N」跳到最严重那张；全部正常时整块不出现。 */
  function capAlertHtml() {
    if (!lastCluster) return '';
    var n = lastCluster.n, rows = [['超容', n.oom, 'is-bad'], ['红线', n.red, 'is-warn']].filter(function (x) { return x[1] > 0; });
    if (!rows.length) return '';
    return '<div class="lc-cap">' + rows.map(function (x) { return '<div class="lc-caprow ' + x[2] + '"><span>' + x[0] + '</span><b>' + x[1] + '</b></div>'; }).join('')
      + (lastCluster.worst != null ? '<button type="button" class="brief-cta" data-act="worst">→ rank ' + lastCluster.worst + '</button>' : '') + '</div>';
  }
  function renderLeftCard() {
    var pk = ppPeaks(), N = PS.pp, W = 200, H = 50, BASE = 36, gap = 10;
    var bw = (W - gap * (N - 1)) / N, top = Math.max(1.1, pk ? Math.max.apply(null, pk.map(function (x) { return x.v; })) : 1.1);
    var y100 = BASE - (1 / top) * (BASE - 12), bars = '';
    for (var i = 0; i < N; i++) {
      var v = pk ? pk[i].v : 0.5, h = Math.max(2, (v / top) * (BASE - 12)), x = i * (bw + gap), on = focusPP === i;
      bars += '<g class="pb' + (on ? ' is-on' : '') + '" data-pp="' + i + '"><rect class="pb-hit" x="' + x + '" y="0" width="' + bw + '" height="' + H + '"/>'
        + '<rect class="pb-bar ' + (pk ? ratioClass(v) : 'c-none') + '" x="' + x + '" y="' + (BASE - h) + '" width="' + bw + '" height="' + h + '"/>'
        + (on && pk ? '<text class="pb-val" x="' + (x + bw / 2) + '" y="' + (BASE - h - 4) + '" text-anchor="middle">' + Math.round(v * 100) + '%' + '</text>' : '')
        + '<text class="pb-num" x="' + (x + bw / 2) + '" y="' + (BASE + 12) + '" text-anchor="middle">pp' + i + '</text></g>';
    }
    var lg = lastCluster ? '<div class="lc-legend" title="格子/柱的灰度 = 显存占用率（合计 / HBM），超出容量标红"><i class="lg c0"></i><i class="lg c1"></i><i class="lg c2"></i><i class="lg c3"></i>'
      + '<span>' + Math.round(lastCluster.amber * 100) + '</span><span>' + Math.round(lastCluster.red * 100) + '</span><span>100%</span></div>' : '';
    var cap = capAlertHtml();
    leftCard.innerHTML = '<div class="gcard"><h1 class="lc-title">' + esc(PS.modelName) + '</h1>'
      + '<div class="lc-sub">' + world + ' · tp' + PS.tp + ((PS.cp || 1) > 1 ? ' cp' + PS.cp : '') + ' pp' + PS.pp + ' dp' + PS.dp + ' ep' + PS.ep + '</div>'
      + '<div class="lc-sub" title="rank 按连续摆放落位（配置里没有 rank→NPU 映射），这是假设">' + physCount.sp + ' SP · ' + physCount.pods + ' POD · ' + physCount.boards + ' 板 *</div>'
      + '</div><div class="gcard"><svg class="pbars" viewBox="0 -14 ' + W + ' ' + (H + 14) + '" width="' + W + '" height="' + (H + 14) + '"><line class="pb-cap" x1="0" x2="' + W + '" y1="' + y100 + '" y2="' + y100 + '"/><line class="pb-base" x1="0" x2="' + W + '" y1="' + BASE + '" y2="' + BASE + '"/>' + bars + '</svg>'
      + lg + '</div>'
      + (cap ? '<div class="gcard">' + cap + '</div>' : '');
    syncCardHeights();
  }
  leftCard.addEventListener('click', function (ev) {
    if (ev.target.closest('[data-act="worst"]') && lastCluster && lastCluster.worst != null) { showTier2(lastCluster.worst, coordLine(lastCluster.worst)); return; }
    var b = ev.target.closest('.pb'); if (!b) return;
    goSegment(+b.getAttribute('data-pp'));
  });
  /* 进"段"这一层：画布换成宇宙视图并取景到这条 PP 段。keepSel=true 时保留
     已选中的 rank（它就在这一段里）；否则清掉选中。 */
  function goSegment(k, keepSel) {
    if (k == null) k = 0;
    if (!keepSel || (curSel != null && coordOfRank(curSel).pp !== k)) { curSel = null; pendingMatrixSel = null; pendingSubLine = null; tier = 1; rankTipOpen = false; }
    else if (curSel != null) tier = 2;   // 从单卡层退回来：还选着，但已不在单卡档
    level = 'segment'; focusPP = k;
    showTier1Visual();
    uniZP.reset();
    var wd = uniWedge[k];
    if (wd) uniZP.fitVB(wd.x0, wd.y0, wd.x1 - wd.x0, wd.y1 - wd.y0, 50);
    if (curSel == null) renderRightIdle(); else renderDrillInvite(curSel, pendingSubLine || coordLine(curSel), lastBrief && lastBrief.rank === curSel ? lastBrief : null);
    renderLeftCard(); renderCrumb();
  }
  /* 进「板」这一层：画布换成这块板的 Server 形态图。keepSel=true 且选中的 rank
     就在这块板上时保留选中；否则清掉。 */
  function goBoard(b, keepSel) {
    if (b == null) return;
    if (!keepSel || (curSel != null && physOf(curSel).board !== b)) { curSel = null; pendingMatrixSel = null; pendingSubLine = null; tier = 1; rankTipOpen = false; }
    else if (curSel != null) tier = 2;
    level = 'board'; curBoard = b;
    showTier1Visual();
    boardZP.reset();
    if (curSel == null) renderRightIdle(); else renderDrillInvite(curSel, pendingSubLine || coordLine(curSel), lastBrief && lastBrief.rank === curSel ? lastBrief : null);
    renderLeftCard(); renderCrumb();
  }
  /* 换 ZeRO 档：URL 跟着改（URL 即状态），矩阵重算一遍——单卡层直接重载那一屏；
     其余层借一次 ?brief=1（带 sel 时同一次回信里也有集群聚合），回信到了格子、柱、
     角标、右列都按新口径重画。 */
  var clusterStale = false;
  function setZero(z) {
    if (z === ZERO) return;
    ZERO = z; lastBrief = null; ppPeak = null;
    var u = new URLSearchParams(location.search);
    if (z === (PS.zero || 0)) u.delete('zero'); else u.set('zero', String(z));
    history.replaceState(null, '', location.pathname + (u.toString() ? '?' + u.toString() : '') + location.hash);
    if (tier === 3) { clusterStale = true; loadDetail(curSel); }
    else if (curSel != null) requestTier2Brief(curSel);
    else requestClusterBrief();
    renderLeftCard();
  }
  function focusSegment(k) {
    focusPP = k;
    focusHub(k);
    physApplySelection();
    renderLeftCard(); renderCrumb();
  }

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
  var lastCluster = null, lastBrief = null;
  (function () {
    requestClusterBrief();
  })();
  function requestClusterBrief() {
    var bp = new URLSearchParams({ embed: '1', preset: PS.matrixPreset, brief: '1', zero: String(ZERO) });
    matrixFrame.src = '../rank-topology-3d/pattern.html?' + bp.toString();
  }
  /* 聚合结果进右卡的第一档内容（原来是左上角一颗角标，现在三张卡的位置固定，
     集群容量就是右卡在没选中任何卡时该说的那句话）。 */
  function renderClusterBadge(brief) {
    if (!brief) return;
    lastCluster = brief; ppPeak = null;
    oomSet = {};
    (brief.oom || []).forEach(function (r) { oomSet[r] = 1; });
    applyAlerts();
    if (tier === 1) renderRightIdle(); else if (curSel != null) showRankBadge(curSel);
    if (drawerOpen === 'hier') renderHier();
  }
  /* rank 默认全白，只有顶出容量（level==='oom'）的卡标红——颜色只给告警用，
     不给 PP 段用（段的颜色只留在左卡的段按钮与宇宙视图的 hub 上）。 */
  /* 灰度 = 占用率（合计 / HBM），全页同一把尺：c0 < 黄线 ≤ c1 < 红线 ≤ c2 ≤ 100% < c3。
     越满越亮，超容最亮；选中用纯白边框，不改这一格的灰度。 */
  var oomSet = null;
  function capClass(r) {
    var R = lastCluster && lastCluster.ratio ? lastCluster.ratio[r] : null;
    if (oomSet && oomSet[r]) return 'c3';   // 超容以矩阵本体的判定为准（它还算优化器步临时区），与角标同一个数
    if (R == null) return '';
    return R >= lastCluster.red ? 'c2' : R >= lastCluster.amber ? 'c1' : 'c0';
  }
  function applyAlerts() {
    if (!oomSet) return;
    document.querySelectorAll('.phys-stage .p-npu').forEach(function (el) {
      var c = capClass(+el.getAttribute('data-rank'));
      ['c0', 'c1', 'c2', 'c3'].forEach(function (k) { el.classList.toggle(k, k === c); });
    });
    universeStage.querySelectorAll('.u-leaf').forEach(function (el) {
      var sel = { tp: +el.getAttribute('data-tp'), cp: +el.getAttribute('data-cp'), pp: +el.getAttribute('data-pp'), rep: +el.getAttribute('data-rep') };
      var c = capClass(rubikSelToMatrixSel(sel));
      ['c0', 'c1', 'c2', 'c3'].forEach(function (k) { el.classList.toggle(k, k === c); });
    });
    renderLeftCard();
  }

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
      embed: '1', theme: 'dark', preset: PS.matrixPreset, zero: String(ZERO), fastcard: '1', solo: '1', memcards: '0', plate: '0', comm: DV.comm ? '1' : '0', solozoom: '44',
      view: 'chain', card: '1', vtab: DV.vtab, sel: String(matrixSel),
      stitle: PS.modelName + ' / ' + TIER2_LABEL + ' / rank ' + matrixSel
    });
    return '../rank-topology-3d/pattern.html?' + p.toString();
  }

  /* 第二档悄悄问矩阵本体要这张卡自己的显存构成——跟集群角标那次 ?brief=1
     借用是同一条"不铺满屏 SVG、只要 ptoRankBrief() 那份已经算好的摘要"的
     路，多带一个 sel=矩阵 rank。反馈「现在看不到rank中间的层和分片了还有
     显存」：cc=0/cclabels=0 把逻辑魔方画布里"卡内魔方"那份显示去掉之后
     （见 rubikParams 的注释），第二档原来只留一句"↓ 单卡下钻"邀请、不摆
     数字——那时候数字确实拿不到（矩阵没打开，编不出来），现在矩阵本体能
     在不渲染整屏的前提下就把这张卡的层区间/显存构成算完发回来（demo.html
     那边的改动同样是 opt-in，只在已有的 brief=1 分支里加一步，其他消费
     这份 demo.html 的 pattern 不传 sel 就不会触发，行为不变），没理由再让
     读者多点一次"下钻"才看到。选中就立刻发起这次请求，回信之前浮卡先
     显示邀请那版（不留空白，见 renderDrillInvite），回信到了再原地升级
     成真数据——这一步不换档，读者仍在第二档，"下钻"按钮还在，点了才真的
     飞到矩阵那一屏（solo）。 */
  function requestTier2Brief(matrixSel) {
    var bp = new URLSearchParams({ embed: '1', preset: PS.matrixPreset, brief: '1', zero: String(ZERO), sel: String(matrixSel) });
    matrixFrame.src = '../rank-topology-3d/pattern.html?' + bp.toString();
  }

  /* 逻辑魔方与并行拓扑矩阵各自实现了一遍"rank ↔ (tp,cp,pp,dp) 坐标"的换算，
     内部打包顺序不一样，同一个数字在两边指的不是同一张卡：
       逻辑魔方（pattern.js）  rankOf = ((rep*PP + pp)*CP + cp) * TP + tp
       并行拓扑（demo.html）   rankOf = ((pp*DP + dp)*CP + cp) * TP + tp
     只有 tp 在两边都是最内层（同一个 %TP），pp/dp(rep) 的打包顺序不同，
     所以必须按坐标三元组换算，不能把 rank 数字直接抄过去——实测验证过：
     逻辑魔方 rank 830（tp6·pp3·rep20）对应并行拓扑 rank 2566，矩阵本体
     读出的坐标正是 tp6·cp0·dp20·pp3，与逻辑魔方报的坐标逐位一致。
     cp 那一项：pangu/dense64/incident2048 都是 CP=1，sel.cp 恒为 0、
     PS.cp 缺省按 1，这一项乘完加完等于没有，公式跟改动前逐位相同；
     moe718b128k（CP=16）是第一个用上它的预置——逻辑魔方的 onSelect
     payload 补了 cp 字段（见 vendor/rubik-cube/pattern.js 的注释）才有
     这个数可用。 */
  function rubikSelToMatrixSel(sel) {
    return ((sel.pp * PS.dp + sel.rep) * (PS.cp || 1) + (sel.cp || 0)) * PS.tp + sel.tp;
  }

  var pendingMatrixSel = null;   // 第二档选中的那张卡，换算好的矩阵 rank——第三档就是拿它去开矩阵
  var pendingSubLine = null;     // 第二档那行坐标副标题——brief 回信之后原地升级要用同一句

  /* 三档的"这是什么"这句话，全部交给当前显示的那个 iframe 自己的原生标题说，
     这一层不再另起一块牌子重复一遍：第一/二档是逻辑魔方自己的顶栏招牌
     （见 rubikParams 的 brand=，已经从它自己的默认名"逻辑魔方"换成模型
     名称）与它选中后自己浮出的"RANK / rank N"身份面板；第三档是矩阵自己的
     画布名字（见 matrixSrcFor 的 stitle=）。三处名字同一个来源（PS.modelName），
     读起来是一句话，不是宿主外挂一层跟原生标题抢地、还经常撞在一起的重复牌子。 */

  /* 第一档有两种画法（逻辑魔方 iframe / 宇宙视图内联 SVG），由 universeMode
     决定当前显示哪一个——showOverview/showTier2 共用这一个开关函数，不必
     各自重复一遍"显哪个、藏哪个"。matrixFrame 两处都要藏：从第三档退回来
     时它还开着。 */
  /* 画布停在哪一层就铺哪张：cluster = 灵衢物理，segment = 宇宙视图；card 层
     由 showDetail 自己切矩阵。两张 SVG 舞台都受同一套选中/聚焦状态驱动。 */
  function showTier1Visual() {
    matrixFrame.classList.add('is-hidden');
    detailFrame.classList.add('is-hidden');
    clearTimeout(detailRevealT); detailRevealT = null; document.body.classList.remove('is-loading');
    if (clusterStale) { clusterStale = false; if (curSel != null) requestTier2Brief(curSel); else requestClusterBrief(); }
    if (level === 'segment') renderUniverse(); else if (level === 'board') renderBoard(curBoard); else renderPhys();
    universeStage.classList.toggle('is-hidden', level !== 'segment');
    boardStage.classList.toggle('is-hidden', level !== 'board');
    physStage.classList.toggle('is-hidden', level === 'segment' || level === 'board');
    dock.classList.remove('is-hidden');
    focusHub(focusPP);
    physApplySelection();
  }

  /* 回到当前这一层的"没选中"态。keepLevel=true 只取消选中、留在原来那一层
     （段层就还在段里）；否则回到集群层、清掉段聚焦。 */
  function showOverview(keepLevel) {
    tier = 1; curSel = null; pendingMatrixSel = null; pendingSubLine = null; rankTipOpen = false;
    if (!keepLevel) { level = 'cluster'; focusPP = null; }
    showTier1Visual();
    renderRightIdle(); renderLeftCard(); renderCrumb();
  }

  /* 第二档：留在第一档那个视图身上（逻辑魔方或宇宙视图，看 universeMode），
     只换宿主自己这层的 chrome——右下角浮出"下钻"邀请。选中态是那个视图
     自己的事（这一刻画面早就是对的，来路无关：可能是刚刚报上来的新选中，
     也可能是从第三档退回来、本来就还停在原地没变过），这个函数只管 sel
     （换算好的矩阵 rank，供下钻按钮用）与 subLine（下钻邀请那一行副标题，
     各来路按自己手上的坐标格式拼好再传进来，见 tier2SubLine）。 */
  function showTier2(matrixSel, subLine) {
    tier = 2; curSel = matrixSel; pendingMatrixSel = matrixSel; pendingSubLine = subLine;
    focusPP = coordOfRank(matrixSel).pp;
    if (level === 'card') level = backLevel;
    showTier1Visual();
    renderDrillInvite(matrixSel, subLine, lastBrief && lastBrief.rank === matrixSel ? lastBrief : null);
    if (!(lastBrief && lastBrief.rank === matrixSel)) requestTier2Brief(matrixSel); else loadDetail(matrixSel);
    renderLeftCard(); renderCrumb();
  }

  /* 第三档：真正换到矩阵那一屏，solo=1 直接落在"只看这一只"。三张卡不动：
     右卡先留着第二档已经拿到的数字，矩阵自己的 pto:tier 回报到了再换成它
     报的那份（同一个 ptoRankBrief，数字一样，只是去掉"下钻"按钮）。 */
  /* ── 单卡层不卡顿（反馈「不丝滑的是下钻之后的场景，要从代码上处理」）──────────────
     原来点「↓ 单卡」那一刻才把 1.4 万行的矩阵本体装进 iframe：加载、首渲、再飞 560ms
     镜头、420ms 后重渲收尾——读者看着一块空白慢慢长出一张卡。现在单卡页单独占一个
     detailFrame，**选中一张卡、显存读数回来之后就在后台预载**（隐藏着把镜头也飞完）；
     点下钻时它多半已经就绪，直接淡入。没就绪就原画面不动、面包屑挂个「…」，等它报
     pto:tier=3（首渲完成）后再留 700ms 让镜头落定，然后才淡入；5 秒兜底。
     matrixFrame 只剩「借来算数」（brief=1）这一个用途，永远不显示。 */
  var detailSrc = null, detailReady = false, detailRevealT = null;
  function loadDetail(sel) {
    var src = matrixSrcFor(sel);
    if (src === detailSrc) return;
    detailSrc = src; detailReady = false; detailFrame.src = src;
  }
  function revealDetail() {
    clearTimeout(detailRevealT); detailRevealT = null;
    document.body.classList.remove('is-loading');
    if (tier !== 3) return;
    detailFrame.classList.remove('is-hidden');
    universeStage.classList.add('is-hidden');
    physStage.classList.add('is-hidden');
    boardStage.classList.add('is-hidden');
    renderCrumb();
  }
  function showDetail(matrixSel) {
    tier = 3; curSel = matrixSel; pendingMatrixSel = matrixSel;
    if (focusPP == null) focusPP = coordOfRank(matrixSel).pp;
    if (level !== 'card') backLevel = level;
    level = 'card';
    loadDetail(matrixSel);
    openDrawer(null);
    if (detailReady) revealDetail();
    else { document.body.classList.add('is-loading'); clearTimeout(detailRevealT); detailRevealT = setTimeout(revealDetail, 5000); }
    if (lastBrief && lastBrief.rank === matrixSel) renderBrief(lastBrief);
    else renderDrillInvite(matrixSel, pendingSubLine || coordLine(matrixSel), null, true);
    renderLeftCard(); renderCrumb();
  }

  // ── 接逻辑魔方自己上报的选中事件：rubik-select 是它页内换选中卡时主动发的——
  //    选中就是第二档，取消选中（点空白，它自己原有的手势）就退回第一档。 ──
  // ── 接矩阵本体上报的换档事件：pto:tier 带着 {tier, sel, brief}。矩阵现在
  //    只在第三档才被打开，收到 tier<3（矩阵里点空白退出 soloCard）就说明
  //    读者要退回第二档——切回逻辑魔方（它一直还停在原地、选中态没变过），
  //    副标题这时改用矩阵自己上报的 brief.coord/layers 拼（跟逻辑魔方自己
  //    的 tp/pp/rep 是两套坐标格式，不能混用同一个拼法）。 ──
  /* ── 跨视图联动（反馈「泳道、整网、层级、魔方和中间的集群图，相同的元素要可以联动选中和显示」）──
     宿主是唯一的选中源：curSel（rank）/ focusPP（PP 段）一变（每条改状态的路径最后都走
     renderCrumb），就推给当前开着的那个参考面板；面板里点了什么，也折回同一条
     showTier2 / focusSegment 路径，于是集群 / 板 / 段三张画布、左右卡、面包屑一起跟。
       逻辑魔方  → rubik-cmd select（魔方自己的 rank 序：rep 在外、pp 在内，见 rubikIdxOf）
                 ← rubik-select
       整网图    → pto:state hl.rank（同一个矩阵预置，rank 号一一对应）；只聚焦段时 filters.p
                 ← pto:select
       泳道      → pto:state filters {t,e,p}——它画的是上游 32 卡示例（TP2·EP2·PP4），只传落在
                   这个范围里的那几维，超出的维传 null，不去假装定位到一条不相干的泳道
                 ← pto:swimlane-select 的 groups.p → 聚焦同号 PP 段
       层级剖面  本页原生：重画即高亮（POD / 板 / NPU 三张格子），点格子 = 选中
     回声：面板报上来的那一次改动不再推回同一个面板（linkMute），否则泳道自己的选中态会被
     宿主的 filters 盖掉；魔方收到 select 会再报一次 rubik-select，同一张卡直接忽略。 */
  var linkSent = {}, linkMute = false;
  function rubikIdxOf(ms) { var c = coordOfRank(ms); return ((c.dp * PS.pp + c.pp) * (PS.cp || 1) + c.cp) * PS.tp + c.tp; }
  function fromPanel(fn) { linkMute = true; try { fn(); } finally { linkMute = false; } }
  function syncLinked(force) {
    if (!drawerOpen) return;
    var key = curSel + '|' + focusPP;
    if (!force && linkSent[drawerOpen] === key) return;
    linkSent[drawerOpen] = key;
    if (drawerOpen === 'hier') { renderHier(); return; }
    if (linkMute) return;
    var w = drawerFrame.contentWindow; if (!w) return;
    var c = curSel != null ? coordOfRank(curSel) : null, pp = c ? c.pp : focusPP;
    var NOF = { t: null, e: null, p: null, d: null };
    if (drawerOpen === 'rubik') w.postMessage({ type: 'rubik-cmd', cmd: 'select', value: curSel != null ? rubikIdxOf(curSel) : null }, '*');
    else if (drawerOpen === 'netgraph') {
      w.postMessage(curSel != null ? { type: 'pto:state', filters: NOF, hl: { rank: curSel } }
        : pp != null ? { type: 'pto:state', hl: null, filters: { t: null, e: null, p: pp, d: null } }
        : { type: 'pto:state', hl: null, filters: NOF }, '*');
    } else if (drawerOpen === 'swimlane') {
      var ep = c ? c.dp % (PS.ep || 1) : null;
      w.postMessage({ type: 'pto:state', filters: { t: c && c.tp < 2 ? c.tp : null, e: ep != null && ep < 2 ? ep : null, p: pp != null && pp < 4 ? pp : null } }, '*');
    }
  }
  drawerFrame.addEventListener('load', function () { if (drawerOpen && drawerOpen !== 'hier') { delete linkSent[drawerOpen]; setTimeout(function () { syncLinked(true); }, 300); } });

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d) return;
    if (drawerFrame && ev.source === drawerFrame.contentWindow) {
      if (d.type === 'pto:select') {
        // 整网图里点了一张卡 / 点空白
        if (typeof d.sel === 'number' && d.sel >= 0 && d.sel < world) { if (d.sel !== curSel) fromPanel(function () { showTier2(d.sel, coordLine(d.sel)); }); }
        else if (d.sel == null && curSel != null) fromPanel(function () { showOverview(true); });
        return;
      }
      if (d.type === 'pto:swimlane-select') {
        // 泳道点了一节：它的 rank 是示例里的 32 卡编号，对不上本预置；能对上的是 PP 段号
        var gp = d.groups && d.groups.p;
        if (typeof gp === 'number' && gp >= 0 && gp < PS.pp) fromPanel(function () {
          if (curSel != null && coordOfRank(curSel).pp !== gp) showOverview(true);
          focusSegment(gp);
        });
        return;
      }
      if (d.type === 'rubik-drill') {
        /* 再点一次已经选中的那张方块 = 下钻——逻辑魔方自己报的坐标已经够
           换算出矩阵 rank，不用等 pendingMatrixSel（用户可能从深链或退档
           回来，那个变量这一刻不一定是这张卡），直接算一遍最准。 */
        if (d.sel && d.sel.rank != null) showDetail(rubikSelToMatrixSel(d.sel));
        return;
      }
      if (d.type !== 'rubik-select') return;
      // 宿主刚推过去的那张卡，魔方会原样再报一次——同一张卡 / 本来就没选中，都不再走一遍
      if (d.sel && d.sel.rank != null && rubikSelToMatrixSel(d.sel) === curSel) return;
      if (!(d.sel && d.sel.rank != null) && curSel == null) return;
      linkMute = true;
      try {
      if (d.sel && d.sel.rank != null) {
        var st9 = d.sel.stage;
        /* cp 只在 PS.cp>1 时才显示——d.sel.cp===0 是合法坐标（CP>1 时也有
           第 0 段），不能拿它的真假值判断"要不要显示"，得看这份预置本身
           有没有 CP 这根轴。 */
        showTier2(rubikSelToMatrixSel(d.sel), 'tp' + d.sel.tp
          + ((PS.cp || 1) > 1 ? ' cp' + d.sel.cp : '') + ' pp' + d.sel.pp + ' rep' + d.sel.rep
          + (st9 ? ' · L' + st9.lo + '–L' + st9.hi : ''));
      } else showOverview();
      } finally { linkMute = false; }
      return;
    }
    if (ev.source === matrixFrame.contentWindow) {
      if (d.type === 'pto:cluster') { renderClusterBadge(d.brief); return; }
      if (d.type === 'pto:rank-brief') {
        // 这次借用可能是为了一张早就不再选中的卡（读者点得快，回信滞后）——
        // 只在还是当前这张卡时才拿去升级浮卡，旧回信直接丢弃。
        if (d.brief) { lastBrief = d.brief; placeSelLabel(); }
        if (d.brief && d.brief.rank === pendingMatrixSel && tier === 2) { renderDrillInvite(pendingMatrixSel, pendingSubLine, d.brief); loadDetail(pendingMatrixSel); }
        return;
      }
      return;
    }
    if (ev.source === detailFrame.contentWindow) {
      if (d.type !== 'pto:tier') return;
      if (d.tier === 3) {
        // 预载完成（可能是在后台、读者还没点下钻）：记下就绪；读者已经在等这一张就留 700ms 让镜头落定再淡入
        detailReady = true;
        if (tier === 3 && d.sel === curSel) { renderBrief(d.brief); if (detailFrame.classList.contains('is-hidden')) { clearTimeout(detailRevealT); detailRevealT = setTimeout(revealDetail, 700); } }
        else if (d.brief) lastBrief = d.brief;
        return;
      }
      if (tier !== 3 || detailFrame.classList.contains('is-hidden')) return;   // 后台那张的消息不驱动界面
      if (d.sel != null && d.brief) {
        showTier2(d.sel, 'tp' + d.brief.coord.tp + ' cp' + d.brief.coord.cp + ' dp' + d.brief.coord.dp
          + ' pp' + d.brief.coord.pp + (d.brief.coord.ep != null ? ' ep' + d.brief.coord.ep : '')
          + ' · L' + d.brief.layers.lo + '–L' + d.brief.layers.hi);
      } else {
        showOverview();
      }
    }
  });

  /* 右卡第一档：集群容量汇总（矩阵借用 ?brief=1 算出来的聚合数）+ 一键跳到
     最严重的那张卡。不摆别的——这一档右卡只回答"全网现在怎么样"。 */
  /* 第一层不默认摊开容量面板：右上角只有一颗角标（红 = 有卡顶出容量），点它才
     弹出 tips（容量各档 + 最严重 rank）。 */
  var alertTipOpen = false;
  function renderRightIdle() {
    briefCard.classList.remove('is-cta');
    // 没选中 rank 时右侧什么都不放：容量告警已经在左列
    alertBadge.classList.add('is-hidden'); briefCard.classList.add('is-hidden'); alertTipOpen = false; syncCardHeights(); return;
    briefCard.classList.toggle('is-tip', true);
    if (!lastCluster) {
      alertBadge.classList.add('is-hidden');
      briefCard.classList.add('is-hidden');
    } else {
      var n = lastCluster.n, ok = lastCluster.world - n.oom - n.red - n.amber;
      alertBadge.textContent = n.oom > 0 ? '⚠ ' + n.oom : (n.red > 0 ? '⚠ ' + n.red : '✓');
      alertBadge.classList.toggle('is-quiet', n.oom === 0 && n.red === 0);
      alertBadge.classList.toggle('is-on', alertTipOpen);
      alertBadge.classList.remove('is-hidden');
      var rows = [['超容', n.oom], ['红线', n.red], ['黄线', n.amber], ['ok', ok]].filter(function (x) { return x[1] > 0; });
      briefCard.innerHTML = '<div class="brief-h">' + lastCluster.world + ' 卡</div>'
        + rows.map(function (x) { return '<div class="brief-row"><span>' + x[0] + '</span><b>' + x[1] + '</b></div>'; }).join('')
        + (lastCluster.worst != null ? '<button type="button" class="brief-cta" data-act="worst">→ rank ' + lastCluster.worst + '</button>' : '');
      briefCard.classList.toggle('is-hidden', !alertTipOpen);
    }
    syncCardHeights();
  }
  alertBadge.addEventListener('click', function () {
    if (curSel == null) { alertTipOpen = !alertTipOpen; renderRightIdle(); }
    else { rankTipOpen = !rankTipOpen; rerenderRank(); }
  });
  /* 选中卡的物理位置 + 五个通信组各走哪一级链路（落位假设见左卡）。EP 跟 DP
     成员完全一样时（DP=EP）合成一行，不摆两行一样的话。 */
  function physInfoHtml(r) {
    var p = physOf(r), g = commGroups(r);
    var rows = [['tp', 'TP', g.tp], ['cp', 'CP', g.cp]];
    if (g.ep.length === g.dp.length) rows.push(['ep', 'EP=DP', g.dp]);
    else { rows.push(['ep', 'EP', g.ep]); rows.push(['dp', 'DP', g.dp]); }
    rows.push(['pp', 'PP', g.pp]);
    var html = '<div class="brief-k">group</div>' + rows.filter(function (x) { return x[2].length > 1; }).map(function (x) {
      var lv = linkLevel(x[2], x[0] === 'pp');
      return '<div class="brief-row"><span><i class="gc" style="background:' + GC[x[0]] + '"></i>' + x[1] + ' ×' + x[2].length + '</span><b>' + LINK_LEVELS[lv] + '</b></div>';
    }).join('');
    // 这颗 NPU 自己的物理链路（直播第二/四页的 Server/机柜关系，槽位 → CPU/NIC 是
    // 板视图里同一套配对：CPU 各带 4 卡、NIC 各带相邻 2 卡）
    var phy = '<div class="brief-k">link</div>'
      + '<div class="brief-row"><span>fullmesh</span><b>×7</b></div>'
      + '<div class="brief-row"><span>Clos</span><b>L1 ×8</b></div>'
      + '<div class="brief-row"><span>H2D</span><b>CPU' + (p.slot < 4 ? 0 : 1) + '</b></div>'
      + '<div class="brief-row"><span>RoCE</span><b>NIC' + Math.floor(p.slot / 2) + '</b></div>';
    return '<div class="brief-k" title="落位为假设：rank 连续摆放">SP' + p.sp + ' · POD' + p.pod + ' · 板' + p.board + ' · 槽' + p.slot + ' *</div>' + html + phy;
  }

  /* rank 详情卡的正文（容量徽标 + 坐标/层区间 + 显存构成 + 合计）——第二档
     升级之后与第三档共用同一份拼法：两边的数字都来自矩阵本体同一个
     ptoRankBrief()（见 requestTier2Brief 与 matrixSrcFor 各自怎么问它要），
     这里只拼一次版式，不为两档各写一份、读出两套数。容量告警只用文字/
     底色深浅分挡，不引入色相，呼应"默认关掉颜色只有黑白"那条反馈。 */
  var CAP_LABEL = { oom: '超容', red: '红线', amber: '黄线', ok: 'ok' };
  function gbFmt(v) { return (Math.round(v * 10) / 10) + ' GB'; }
  function coordSubLine(brief) {
    return 'tp' + brief.coord.tp + ' cp' + brief.coord.cp + ' dp' + brief.coord.dp
      + ' pp' + brief.coord.pp + (brief.coord.ep != null ? ' ep' + brief.coord.ep : '')
      + ' · L' + brief.layers.lo + '–L' + brief.layers.hi;
  }
  function memBriefHtml(brief) {
    var capBadge = '<span class="brief-badge' + (brief.cap.level === 'ok' ? '' : ' is-alert') + '">'
      + (CAP_LABEL[brief.cap.level] || brief.cap.level) + '</span>';
    // 档名只留头两三个字：「权重 (bf16)」→「权重」、「激活·在途6μb」→「激活」
    return '<div class="brief-h">rank ' + brief.rank + capBadge + '</div>'
      + '<div class="brief-sub">' + coordSubLine(brief) + '</div>'
      + brief.segs.map(function (s) {
        return '<div class="brief-row"><span>' + String(s.label).replace(/\s*[（(].*$/, '').replace(/[·／/].*$/, '') + '</span><b>' + gbFmt(s.gb) + '</b></div>';
      }).join('')
      + '<div class="brief-row brief-total"><span>合计</span><b>' + gbFmt(brief.cap.totGB).replace(' GB', '') + ' / ' + brief.hbm + ' GB</b></div>';
  }

  /* 第二档的浮卡：选中的瞬间先摆一句邀请（brief 还没回来，不留空白）；
     requestTier2Brief 那次借用回信之后（brief 参数非空、rank 对得上），
     原地升级成跟第三档一样详细的卡片——层区间/显存构成不再是编不出来的
     数字。"↓ 单卡下钻"按钮两种状态都留着：这一步升级的只是内容详细度，
     不是换档，点了才真的飞到矩阵那一屏（solo）。 */
  function renderDrillInvite(matrixSel, subLine, brief, noCta) {
    var cta = noCta ? '' : (level !== 'segment' ? '<button type="button" class="brief-cta" data-act="seg">→ pp' + coordOfRank(matrixSel).pp + '</button>' : '')
      + (level !== 'board' ? '<button type="button" class="brief-cta" data-act="board">→ 板' + physOf(matrixSel).board + '</button>' : '')
      + '<button type="button" class="brief-cta" data-act="drill">↓ 单卡</button>';
    if (brief && brief.rank === matrixSel) {
      briefCard.innerHTML = memBriefHtml(brief) + physInfoHtml(matrixSel) + cta;
    } else {
      briefCard.innerHTML = '<div class="brief-h">rank ' + matrixSel + '</div>'
        + '<div class="brief-sub">' + subLine + '</div>' + physInfoHtml(matrixSel) + cta;
    }
    briefCard.classList.toggle('is-cta', !noCta);
    showRankBadge(matrixSel);
  }
  /* 选中 rank 之后右侧不默认摊开详情：只留一颗「rank N ⚠」角标，点它才弹卡
     （反馈「点击小的告警徽标再出现具体信息，不要默认悬浮在右侧」）。再点一次
     已选中的 NPU/叶子 = 直接下钻，不必先开卡。 */
  var rankTipOpen = false;
  function showRankBadge(r) {
    var bad = !!(oomSet && oomSet[r]);
    alertBadge.textContent = 'rank ' + r + (bad ? ' ⚠' : '');
    alertBadge.classList.toggle('is-quiet', !bad);
    alertBadge.classList.toggle('is-on', rankTipOpen);
    alertBadge.classList.remove('is-hidden');
    briefCard.classList.add('is-tip');
    briefCard.classList.toggle('is-hidden', !rankTipOpen);
    syncCardHeights();
  }
  function rerenderRank() {
    if (tier === 3 && lastBrief && lastBrief.rank === curSel) renderBrief(lastBrief);
    else renderDrillInvite(curSel, pendingSubLine || coordLine(curSel), lastBrief && lastBrief.rank === curSel ? lastBrief : null, tier === 3);
  }
  briefCard.addEventListener('click', function (ev) {
    if (ev.target.closest('[data-act="drill"]') && pendingMatrixSel != null) { showDetail(pendingMatrixSel); return; }
    if (ev.target.closest('[data-act="seg"]') && curSel != null) { goSegment(coordOfRank(curSel).pp, true); return; }
    if (ev.target.closest('[data-act="board"]') && curSel != null) { goBoard(physOf(curSel).board, true); return; }
    if (ev.target.closest('[data-act="worst"]') && lastCluster && lastCluster.worst != null) showTier2(lastCluster.worst, coordLine(lastCluster.worst));
  });

  /* 第三档的浮卡：不再留"下钻"按钮（已经在这一档了），正文跟第二档升级后
     共用同一个 memBriefHtml + physInfoHtml。 */
  function renderBrief(brief) {
    if (!brief) { renderRightIdle(); return; }
    lastBrief = brief;
    briefCard.classList.remove('is-cta');
    // 单卡层矩阵自己已经把显存构成摆成浮卡贴在卡壳旁边了，右卡不再重复那五行
    // （消融），只留矩阵画布上没有的：物理位置与通信组链路等级。
    // 矩阵 solo 那群显存浮卡与引线关掉了（memcards=0），数字直接放这张右卡
    briefCard.innerHTML = memBriefHtml(brief) + physInfoHtml(brief.rank);
    showRankBadge(brief.rank);
  }


  /* ── 层级剖面（工具条「层级」，右侧面板；反馈「这个部分也要加进来」）─────────────────
     引自 cube-cockpit.html 的「层级剖面」（combo-workbench 第三格），按本页的数据与视觉重做成
     原生的一列，而不是嵌那份彩色页面：L7 Global → L6 集群 → L5 超节点 → L4 POD → L3 板 →
     L2 NPU → L1 Die → L0 Core-Group。L4/L3/L2 是正方形宫格，灰度 = 占用率（同画布那把尺，超容红），
     聚合层取峰值；每一层标出在这一层内闭合的并行维度（由本页的 linkLevel 算，不是写死）。
     点 POD / 板 / NPU 画布跟着走；选中的那一格描白。 */
  var hierAgg = null;
  function hierAggregates() {
    if (hierAgg && hierAgg.src === lastCluster) return hierAgg;
    var R = lastCluster && lastCluster.ratio, n = world, pod = [], board = [], i;
    for (i = 0; i < n; i++) {
      var v = R ? R[i] : null, bad = !!(oomSet && oomSet[i]), p9 = Math.floor(i / PHYS.pod), b9 = Math.floor(i / PHYS.board);
      if (!pod[p9]) pod[p9] = { v: -1, bad: false }; if (!board[b9]) board[b9] = { v: -1, bad: false };
      if (v != null) { pod[p9].v = Math.max(pod[p9].v, v); board[b9].v = Math.max(board[b9].v, v); }
      if (bad) { pod[p9].bad = true; board[b9].bad = true; }
    }
    hierAgg = { src: lastCluster, pod: pod, board: board };
    return hierAgg;
  }
  var HC = { c0: '#4A4A4A', c1: '#808080', c2: '#BDBDBD', c3: '#F85149', none: '#282828' };
  function cellColor(v, bad) { if (bad) return HC.c3; if (v == null || v < 0 || !lastCluster) return HC.none; return v >= lastCluster.red ? HC.c2 : v >= lastCluster.amber ? HC.c1 : HC.c0; }
  function drawGrid(cv, n, cols, grp, cell, gap, ggap, colorOf, selIdx) {
    /* 每一层都撑满面板宽（反馈「所有层级都适配宽度，不要一个长一个短」）：cell 只是下限参考，
       实际格宽 = (可用宽 − 缝) / 列数，格子保持正方形 */
    var ng = Math.floor((cols - 1) / grp), avail = cv.parentNode ? cv.parentNode.clientWidth : 0;
    if (avail > 0) cell = Math.max(2, (avail - (cols - 1) * gap - ng * ggap) / cols);
    var rows = Math.ceil(n / cols), W = cols * cell + (cols - 1) * gap + ng * ggap, H = rows * (cell + gap) - gap;
    var d = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = W * d; cv.height = H * d; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    var ctx = cv.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0);
    var rects = [];
    for (var i = 0; i < n; i++) {
      var c = i % cols, r = Math.floor(i / cols), x = c * (cell + gap) + Math.floor(c / grp) * ggap, y = r * (cell + gap);
      ctx.fillStyle = colorOf(i); ctx.fillRect(x, y, cell, cell); rects.push([x, y]);
    }
    if (selIdx != null && rects[selIdx]) { ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1.5; ctx.strokeRect(rects[selIdx][0] - 1, rects[selIdx][1] - 1, cell + 2, cell + 2); }
    cv._hit = function (px, py) {
      for (var k = 0; k < rects.length; k++) if (px >= rects[k][0] - gap / 2 && px < rects[k][0] + cell + gap / 2 && py >= rects[k][1] - gap / 2 && py < rects[k][1] + cell + gap / 2) return k;
      return -1;
    };
  }
  function hierDims() {
    var r0 = curSel != null ? curSel : 0, g = commGroups(r0), by = { 0: [], 1: [], 2: [], 3: [] };
    var rows = [['TP', g.tp, false], ['CP', g.cp, false]];
    if (g.ep.length === g.dp.length) rows.push(['EP=DP', g.dp, false]); else { rows.push(['EP', g.ep, false]); rows.push(['DP', g.dp, false]); }
    rows.push(['PP', g.pp, true]);
    rows.forEach(function (x) { if (x[1].length > 1) by[linkLevel(x[1], x[2])].push(x[0] + '×' + x[1].length); });
    return by;   // 0 板内 → L3，1 POD → L4，2 SP → L5，3 跨 SP → L6
  }
  function renderHier() {
    if (!drawerBody || drawerOpen !== 'hier') return;
    var A = hierAggregates(), dims = hierDims(), here = curSel != null ? physOf(curSel) : null;
    var nPod = physCount.pods, nBoard = physCount.boards;
    function hd(lv, nm, ct, dm) {
      return '<div class="hv-hd"><span class="hv-lv">' + lv + '</span><span class="hv-nm">' + nm + '</span><span class="hv-ct">' + ct + '</span>'
        + (dm && dm.length ? '<span class="hv-dims">' + dm.join(' · ') + '</span>' : '') + '</div>';
    }
    var sp = '';
    for (var i = 0; i < physCount.sp; i++) sp += '<button type="button" class="hv-chip' + (here && here.sp === i ? ' is-on' : '') + '" data-hsp="' + i + '">SP' + i + '</button>';
    var die = ['D0 · 计算', 'D1 · 计算', 'D2 · IO', 'D3 · IO'].map(function (t) { return '<span class="hv-die' + (t.indexOf('IO') > 0 ? ' is-io' : '') + '">' + t + '</span>'; }).join('');
    var cg = ''; for (var k = 0; k < 32; k++) cg += '<i></i>';
    drawerBody.innerHTML = '<div class="hv">'
      + '<div class="hv-row is-ghost">' + hd('L7', 'Global', 'N 集群 · DCN') + '</div>'
      + '<div class="hv-row">' + hd('L6', '集群', world + ' NPU', dims[3]) + '<button type="button" class="hv-bar" data-hact="root">' + physCount.sp + ' SP · ' + nPod + ' POD · ' + nBoard + ' 板</button></div>'
      + '<div class="hv-row">' + hd('L5', '超节点', physCount.sp + ' · 1024 NPU/SP', dims[2]) + '<div class="hv-chips">' + sp + '</div></div>'
      + '<div class="hv-row">' + hd('L4', 'POD', nPod + ' · 64 NPU/POD', dims[1]) + '<canvas class="hv-grid" data-hl="pod"></canvas></div>'
      + '<div class="hv-row">' + hd('L3', '板', nBoard + ' · 8 NPU + 2 CPU', dims[0]) + '<canvas class="hv-grid" data-hl="board"></canvas></div>'
      + '<div class="hv-row">' + hd('L2', 'NPU', world + ' · 昇腾 950') + '<canvas class="hv-grid" data-hl="chip"></canvas></div>'
      + '<div class="hv-row">' + hd('L1', 'Die', '×4 / 卡') + '<div class="hv-dies">' + die + '</div></div>'
      + '<div class="hv-row">' + hd('L0', 'Core-Group', '×32 / 卡 · AIC / AIV') + '<div class="hv-cg">' + cg + '</div></div>'
      + '</div>';
    var cvs = drawerBody.querySelectorAll('canvas.hv-grid');
    drawGrid(cvs[0], nPod, 16, 8, 17, 2, 4, function (i9) { return cellColor(A.pod[i9] && A.pod[i9].v, A.pod[i9] && A.pod[i9].bad); }, here ? here.pod : null);
    drawGrid(cvs[1], nBoard, 32, 8, 7, 1, 4, function (i9) { return cellColor(A.board[i9] && A.board[i9].v, A.board[i9] && A.board[i9].bad); }, here ? here.board : null);
    drawGrid(cvs[2], world, 64, 8, 4, 1, 2, function (i9) { return cellColor(lastCluster && lastCluster.ratio ? lastCluster.ratio[i9] : null, !!(oomSet && oomSet[i9])); }, curSel);
  }
  function ensureCluster() { if (tier === 3 || level !== 'cluster') { showOverview(); } }
  drawerBody && drawerBody.addEventListener('click', function (ev) {
    var t = ev.target;
    if (t.closest('[data-hact="root"]')) { physZP.reset(); showOverview(); return; }
    var spb = t.closest('[data-hsp]');
    if (spb) { ensureCluster(); var el = physStage.querySelector('.p-sp[data-sp="' + spb.getAttribute('data-hsp') + '"]'); if (el) physZP.fitVB(+el.getAttribute('x'), +el.getAttribute('y'), +el.getAttribute('width'), +el.getAttribute('height'), 30); return; }
    if (t.tagName !== 'CANVAS' || !t._hit) return;
    var rc = t.getBoundingClientRect(), k = t._hit(ev.clientX - rc.left, ev.clientY - rc.top); if (k < 0) return;
    var kind = t.getAttribute('data-hl');
    if (kind === 'pod') { ensureCluster(); zoomToPod(k * PHYS.pod); }
    else if (kind === 'board') goBoard(k, false);
    else if (kind === 'chip') showTier2(k, coordLine(k));
  });
  drawerBody && drawerBody.addEventListener('mousemove', function (ev) {
    var t = ev.target; if (t.tagName !== 'CANVAS' || !t._hit) return;
    var rc = t.getBoundingClientRect(), k = t._hit(ev.clientX - rc.left, ev.clientY - rc.top), kind = t.getAttribute('data-hl');
    t.title = k < 0 ? '' : kind === 'pod' ? 'POD ' + k : kind === 'board' ? '板 ' + k : 'rank ' + k + ' · ' + coordLine(k);
  });

  /* ── 配置浮层（工具条「配置」；反馈「对应的配置也要拿过来，简化显示」）──────────────────
     把 combo-workbench 顶栏的「并行配置 / 并行对象 / 数据标注」与矩阵本体设置面板里和本页
     相关的那几项，收成一张小浮层：
       并行配置 —— 预置切换（整页按 ?preset= 重载）+ ZeRO 档；切分五维只读显示
       并行对象 —— 选一维 + 一个下标，画布上只亮这一组（与选中 rank 互斥，选中时以选中为准）
       数据标注 —— 占用率着色 / rank 号 / 板内关系 / 通信组 四类，逐类开关
       单卡     —— 机位 3D·正视·侧视·顶视 与 通信连线开关，作用在下钻后的矩阵本体
     其余（搜索、观察层级、卡片内容、设备排列、图层……）是矩阵自己那一屏的事，不搬。 */
  var cfgPop = document.getElementById('cfgPop'), cfgOpen = false;
  var PRESET_ORDER = ['moe504b32k', 'moe718b128k', 'pangu', 'incident2048', 'dense64'];
  function segBtns(attr, items, cur) {
    return '<div class="cf-seg">' + items.map(function (x) { return '<button type="button" data-' + attr + '="' + x[0] + '"' + (String(x[0]) === String(cur) ? ' class="is-on"' : '') + '>' + x[1] + '</button>'; }).join('') + '</div>';
  }
  function renderCfg() {
    var curKey = PRESET_ORDER.filter(function (k) { return PRESETS[k] === PS; })[0] || 'moe504b32k';
    var dimsTxt = 'tp' + PS.tp + ((PS.cp || 1) > 1 ? ' cp' + PS.cp : '') + ' pp' + PS.pp + ' dp' + PS.dp + ' ep' + PS.ep;
    var objDims = ['tp', 'cp', 'ep', 'dp', 'pp'].filter(function (d) { return objSize(d) > 1; });
    var od = OBJ.dim, n9 = od ? objSize(od) : 0;
    cfgPop.innerHTML = '<div class="cf-sec"><div class="cf-k">并行配置</div>'
      + '<select class="cf-sel" data-cf="preset">' + PRESET_ORDER.filter(function (k) { return PRESETS[k]; }).map(function (k) { return '<option value="' + k + '"' + (k === curKey ? ' selected' : '') + '>' + esc(PRESETS[k].modelName) + '</option>'; }).join('') + '</select>'
      + '<div class="cf-sub">' + world + ' · ' + dimsTxt + '</div>'
      + '<div class="cf-line"><span>zero</span>' + segBtns('zero', [[0, '0'], [1, '1'], [2, '2'], [3, '3']], ZERO) + '</div></div>'
      + '<div class="cf-sec"><div class="cf-k">并行对象</div>'
      + segBtns('odim', [['', '无']].concat(objDims.map(function (d) { return [d, d.toUpperCase()]; })), od || '')
      + (od ? '<div class="cf-line cf-step"><button type="button" data-ostep="-1">‹</button><b>' + od + ' ' + OBJ.idx + '</b><span>/ ' + n9 + '</span><button type="button" data-ostep="1">›</button></div>' : '') + '</div>'
      + '<div class="cf-sec"><div class="cf-k">数据标注</div>'
      + [['occ', '占用率'], ['num', 'rank 号'], ['rel', '板内关系'], ['grp', '通信组']].map(function (x) { return '<label class="cf-chk"><input type="checkbox" data-ann="' + x[0] + '"' + (ANN[x[0]] ? ' checked' : '') + '><span>' + x[1] + '</span></label>'; }).join('') + '</div>'
      + '<div class="cf-sec"><div class="cf-k">单卡</div>'
      + '<div class="cf-line"><span>机位</span>' + segBtns('cam', [['3d', '3D'], ['top', '顶视']], DV.vtab) + '</div>'
      + '<label class="cf-chk"><input type="checkbox" data-dvcomm="1"' + (DV.comm ? ' checked' : '') + '><span>通信连线</span></label></div>';
  }
  function toggleCfg(on) {
    cfgOpen = on == null ? !cfgOpen : on;
    if (cfgOpen) renderCfg();
    cfgPop.classList.toggle('is-hidden', !cfgOpen);
    dock.querySelectorAll('[data-pop="cfg"]').forEach(function (b) { b.classList.toggle('is-on', cfgOpen); });
  }
  function applyAnn() { ['occ', 'num', 'rel'].forEach(function (k) { document.body.classList.toggle('ann-no' + k, !ANN[k]); }); }
  function refreshDetail() { if (tier === 3) { loadDetail(curSel); } }
  cfgPop.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.getAttribute('data-cf') === 'preset') { var u = new URLSearchParams(location.search); u.set('preset', t.value); ['sel', 'obj', 'zero'].forEach(function (k) { u.delete(k); }); location.search = u.toString(); return; }
    var a = t.getAttribute('data-ann');
    if (a) { ANN[a] = t.checked; setQS('hide', ['occ', 'num', 'rel', 'grp'].filter(function (k) { return !ANN[k]; }).join(',')); applyAnn(); physApplySelection(); return; }
    if (t.hasAttribute('data-dvcomm')) { DV.comm = t.checked; setQS('comm3', DV.comm ? '1' : ''); refreshDetail(); }
  });
  cfgPop.addEventListener('click', function (ev) {
    var b;
    if ((b = ev.target.closest('[data-zero]'))) { setZero(+b.getAttribute('data-zero')); renderCfg(); return; }
    if ((b = ev.target.closest('[data-odim]'))) { var d = b.getAttribute('data-odim') || null; OBJ = { dim: d, idx: 0 }; setQS('obj', d ? d + ':0' : ''); if (d && curSel != null) showOverview(true); physApplySelection(); renderCfg(); return; }
    if ((b = ev.target.closest('[data-ostep]')) && OBJ.dim) { var n = objSize(OBJ.dim); OBJ.idx = (OBJ.idx + +b.getAttribute('data-ostep') + n) % n; setQS('obj', OBJ.dim + ':' + OBJ.idx); physApplySelection(); renderCfg(); return; }
    if ((b = ev.target.closest('[data-cam]'))) { DV.vtab = b.getAttribute('data-cam'); setQS('cam', DV.vtab === '3d' ? '' : DV.vtab); refreshDetail(); renderCfg(); }
  });
  document.addEventListener('pointerdown', function (ev) { if (cfgOpen && !ev.target.closest('#cfgPop, [data-pop="cfg"]')) toggleCfg(false); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && cfgOpen) toggleCfg(false); });
  applyAnn();

  /* 选中框：纯白边框套在选中格外面、中间留一圈底色缝——格子本身的灰度（数据）不动，
     在最亮的超容格上也看得出来。 */
  function markSelFrame(stage) {
    var svgEl = stage.querySelector('.zp-box svg'); if (!svgEl) return;
    var fr = svgEl.querySelector('.sel-frame'), el = curSel != null ? stage.querySelector('.is-sel') : null;
    if (!el) { if (fr) fr.remove(); return; }
    if (!fr) { fr = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); fr.setAttribute('class', 'sel-frame'); }
    svgEl.appendChild(fr);
    /* 框选直接描在图元自己的外边框上（反馈「框选样式直接在图元外边框高亮」）：看得见封装图标时
       （板视图、集群 6× 以上）贴着图标的圆角外框；否则贴着这一格本身。不再留缝、不再另起一个大框。 */
    var icon = null, lod2 = svgEl.classList.contains('lod2') || stage === boardStage;
    if (lod2) { icon = el.nextElementSibling; while (icon && icon.tagName !== 'use') icon = icon.nextElementSibling; }
    var tgt = icon || el, x = +tgt.getAttribute('x'), y = +tgt.getAttribute('y'), w = +tgt.getAttribute('width'), h = +tgt.getAttribute('height');
    if (!isFinite(x) || !w) { var bb = el.getBBox(); x = bb.x; y = bb.y; w = bb.width; h = bb.height; }
    fr.setAttribute('x', x); fr.setAttribute('y', y); fr.setAttribute('width', w); fr.setAttribute('height', h);
    fr.setAttribute('rx', icon ? w * 7.5 / 48 : 0);
  }
  /* 选中标注：只给当前选中的那一格，放在它左上侧、一根短细引线连过去，
     不压在主体上；缩放/平移/换层时跟着重算位置，出了画布可视区就收起。 */
  var selLabel = document.getElementById('selLabel'), selLead = document.getElementById('selLead');
  function placeSelLabel() {
    if (!selLabel) return;
    var stage = tier === 3 || curSel == null ? null : level === 'segment' ? universeStage : level === 'board' ? boardStage : physStage;
    var el = stage && (stage.querySelector('.sel-frame') || stage.querySelector('.is-sel')), box = stage && stage.querySelector('.zp-box');
    if (!el || !box) { selLabel.classList.add('is-hidden'); selLead.classList.add('is-hidden'); return; }
    var r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
    if (r.right < b.left || r.left > b.right || r.bottom < b.top || r.top > b.bottom) { selLabel.classList.add('is-hidden'); selLead.classList.add('is-hidden'); return; }
    /* 画布上不再挂文字标注（反馈「不要让字和标签遮挡主体」）：选中只靠白框，rank 名在右上角角标里 */
    if (true) { selLabel.classList.add('is-hidden'); selLead.classList.add('is-hidden'); return; }
    var gb = lastBrief && lastBrief.rank === curSel ? ' · ' + gbFmt(lastBrief.cap.totGB) : '';
    selLabel.innerHTML = 'rank ' + curSel + '<span>' + gb + '</span>';
    var ax = r.left, ay = r.top, ex = ax - 16, ey = ay - 16;
    selLabel.style.left = (ex - selLabel.offsetWidth) + 'px'; selLabel.style.top = (ey - selLabel.offsetHeight + 4) + 'px';
    selLead.setAttribute('style', 'left:' + ex + 'px;top:' + ey + 'px;width:' + (ax - ex) + 'px;height:' + (ay - ey) + 'px');
    selLabel.classList.remove('is-hidden'); selLead.classList.remove('is-hidden');
  }
  window.addEventListener('resize', placeSelLabel);
  var refitT = 0;
  window.addEventListener('resize', function () { clearTimeout(refitT); refitT = setTimeout(function () { curZP().refit(); if (drawerOpen === 'hier') renderHier(); }, 120); });

  // ── 开场：三张卡 + 顶栏就位，第一档默认铺灵衢物理拓扑；?view=universe/rubik
  //    换另外两种画法（旧链接 ?view=universe 照样认得）。 ────────────────────
  topbar.classList.remove('is-hidden');
  leftCard.classList.remove('is-hidden');
  showOverview();
  /* 归档版（PP 段径向星图）：默认直接落在段视图；?pp=<段号> 指定哪一段，?view=cluster 回到集群 */
  if (qs.get('view') !== 'cluster') { var qpp = parseInt(qs.get('pp'), 10); goSegment(isFinite(qpp) && qpp >= 0 && qpp < PS.pp ? qpp : 0); }

  // ── URL 深链：?sel=<并行拓扑矩阵自己的 rank 编号> 打开时直接进第三档 ─────
  var qsel = parseInt(qs.get('sel'), 10);
  if (isFinite(qsel) && qsel >= 0 && qsel < world) showDetail(qsel);
})();

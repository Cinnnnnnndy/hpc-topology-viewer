/*! © 2026 王欣迪 (Cindy_wxd) · SPDX-License-Identifier: Apache-2.0 · 使用、修改或再分发须保留本署名与 NOTICE */
/* shard-device-map · pattern.js
   一条下钻链 + 三张常驻悬浮卡 + 一块可缩放的画布（结构见 pattern.html 顶部
   注释与 README）。分两条路：

   world ≤ 64（只有 ?preset=dense64 会落到这条）：直接铺满并行拓扑矩阵本体
     的原页（不传 fastcard/mono/solo，就是 rank-topology-3d 独立打开的样子），
     没有这套下钻链——矩阵自己的"选中/取消选中"手势已经够用，不必再包一层。

   world > 64（默认 moe504b32k·4096 卡；?preset=pangu/moe718b128k/incident2048
   也走这条）：level ∈ cluster / board / card 由下钻状态决定画布铺哪张：
     cluster 集群 —— 灵衢物理拓扑（buildPhysSvg）：超节点 / L2 平面 / L1 SW /
                     POD / 板上的 CPU·NPU·DPU·NIC，NPU 按 PP 段着色。点 NPU =
                     选中 rank；点 POD/超节点 = 取景过去；点空白 = 复位。
     （原来还有一层 segment 段——宇宙视图 / 径向星图聚焦一条 PP 段。反馈「这个视图先不做，
       归档到另一个分支」：整份代码存在分支 claude/pp-segment-radial-archive，发布在
       /patterns/pp-segment-radial/，启动页有卡片。本页左卡的 PP 段按钮现在只在原地聚焦那一段。）
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
    incident2048: { tp: 1, pp: 4, dp: 512, ep: 64, matrixPreset: 'incident2048', modelName: '2048 NPU · Router overflow' },
    /* moe718b128k：demo.html 那份 PRESETS.moe718b128k 的桥接条目，tp/cp/pp/dp/ep
       逐位照抄那边的 cfg（world=tp·cp·pp·dp=8·16·16·4=8192；dp=4 不是 1——
       逻辑魔方自己的模型要求 EP 必须整除 DP 本身，dp=1 时 ep(4) 除不尽会
       直接抛异常建模失败，dp=4 是两边约束都满足的最小值，demo.html 那份
       PRESETS 的注释里有完整推导）。这是第一个 cp>1 的桥接预置，之前
       pangu/dense64/incident2048 都是 cp=1（省了这个字段也一样），这档
       必须显式给 cp，不然逻辑魔方按 cp=1 建模型，跟矩阵本体的四维结构
       对不上、rank 换算全错。世界卡数公式与 rubikParams/
       rubikSelToMatrixSel 里补的 cp 项，见下面对应位置的注释。 */
    moe718b128k: { tp: 8, cp: 16, pp: 16, dp: 4, ep: 4, matrixPreset: 'moe718b128k', modelName: 'MoE 718B(A39B)·128K seq' },
    /* moe504b32k：demo.html 那份 PRESETS.moe504b32k 的桥接条目（同一个
       pangu_sophon_pytorch 项目里 504B/18B 激活那档、32K 序列），tp/cp/pp/
       dp/ep 逐位照抄那边的 cfg（world=4·8·8·16=4096）。dp=16 不是猜的：
       项目代码里 data_parallel_size = world_size ÷ (TP×PP×CP)、EP 落在 DP
       域内，EP 必须整除 DP，DP=EP=16 就是这组切分的最小合法值——比
       moe718b128k 那档"从一堆矛盾候选里挑一个"扎实。字段来源分层（real/
       assumed）见 demo.html 那条预置的注释，这里不重复第二份。 */
    moe504b32k: { tp: 4, cp: 8, pp: 8, dp: 16, ep: 16, matrixPreset: 'moe504b32k', zero: 1, modelName: 'MoE 504B(A18B)·32K seq' }
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
  /* ── 切分只有一个来源（反馈「全篇要和集群数目、切分数目对得上，是同一套系统；之后改各个切分的数值，
     整体要一起改」）：预置给默认值，URL 的 tp / cp / pp / dp / ep 覆盖它（设置浮层「并行配置」改的就是这几个）；
     world = tp×cp×pp×dp。本页所有画法（物理图、层级剖面、泳道、通信组、数据卡）读的都是这一份 PS，
     借来算数与画单卡的矩阵本体、整网图、逻辑魔方也一律由 splitParams() / rubikParams 把同一组数显式带过去，
     不再各自按预置名去查自己那份表——改一处，全篇一起变。
     物理链同理：矩阵本体默认按 CloudMatrix384（一个超节点 384 卡）判跨超节点，本页画的是 Ascend 950 1024P，
     所以一并传 perNode=8（板）/ nodeRack=8（POD = 8 板）/ podCards=1024（超节点），两边对「这条边跨不跨超节点」
     给同一个答案。 */
  var PS = (function () {
    var base = PRESETS[qs.get('preset')] || PRESETS.moe504b32k, o = {}, k;
    for (k in base) o[k] = base[k];
    ['tp', 'cp', 'pp', 'dp', 'ep'].forEach(function (d) { var v = parseInt(qs.get(d), 10); if (isFinite(v) && v >= 1) o[d] = v; });
    o.cp = o.cp || 1; o.ep = o.ep || 1;
    o.custom = ['tp', 'cp', 'pp', 'dp', 'ep'].some(function (d) { return qs.has(d); });
    return o;
  })();
  var PHYS_CHAIN = { perNode: 8, nodeRack: 8, podCards: 1024 };
  /* 引擎（自带、与站内旧页面无关）：./engine/matrix.html 是这一版矩阵本体的分叉，./engine/rubik.html 是逻辑魔方的分叉，
     依赖全在 ./vendor/。原来借用的 /patterns/rank-topology-3d/、/patterns/model-netgraph/ 是发布时往同一份 demo 里注入
     默认取景参数得到的——这里在拼地址时自己补上同一组默认值（只补缺席的，显式传的优先）。 */
  var ENG_3D = { view: 'chain', card: '1', vtab: '3d', stitle: '模型分片与训练设备映射', embed: '1' };
  var ENG_NG = { view: 'chain', cuts: 'pcte', rank: '0', vtab: 'side', stitle: 'Network Graph', embed: '1', notitle: '1' };   // 10.18：抽屉头已写 Network Graph，引擎不再画第二遍题面
  function engineSrc(def, q) {
    q = new URLSearchParams(q);
    for (var k in def) if (!q.has(k)) q.set(k, def[k]);
    return './engine/matrix.html?' + q.toString();
  }
  function splitParams(o) {
    o.preset = PS.matrixPreset;
    o.world = String(PS.tp * PS.cp * PS.pp * PS.dp); o.tp = String(PS.tp); o.cp = String(PS.cp); o.pp = String(PS.pp); o.ep = String(PS.ep);
    for (var k in PHYS_CHAIN) o[k] = String(PHYS_CHAIN[k]);
    return o;
  }
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
  /* 单卡层：机位、通信连线总闸与逐维开关（commk3=tp,ep… 只列开着的）、兄弟 rank 显示档
     （sibs=on 展开，缺省 ghost 隐约——超大集群里兄弟可能上百张，默认不全放） */
  var DV = { vtab: qs.get('cam') === 'top' ? 'top' : '3d', comm: qs.get('comm3') === '1',
    commk: (function () { var o = {}, h = qs.has('commk3') ? String(qs.get('commk3')).split(',') : null; ['tp', 'cp', 'ep', 'pp', 'dp'].forEach(function (k) { o[k] = !h || h.indexOf(k) >= 0; }); return o; })(),
    sibs: qs.get('sibs') === 'on' ? 'on' : 'ghost',
    /* 单卡里画什么：显存板（mem）/ 整网里这张卡拿走哪一片（net）/ 逐层算子块（comp） */
    rv: qs.get('rv3') === 'net' || qs.get('rv3') === 'comp' ? qs.get('rv3') : 'mem' };
  var OBJ = (function () { var m = /^(tp|cp|ep|dp|pp):(\d+)$/.exec(qs.get('obj') || ''); return m ? { dim: m[1], idx: +m[2] } : { dim: null, idx: 0 }; })();
  function setQS(k, v) {
    var u = new URLSearchParams(location.search);
    if (v == null || v === '') u.delete(k); else u.set(k, v);
    history.replaceState(null, '', location.pathname + (u.toString() ? '?' + u.toString() : '') + location.hash);
  }
  function objSize(d) { return d === 'cp' ? (PS.cp || 1) : d === 'ep' ? Math.max(1, PS.ep || 1) : PS[d]; }
  function objVal(r, d) { var c = coordOfRank(r); return d === 'ep' ? ((c.dp * PS.cp + c.cp) * PS.tp + c.tp) % Math.max(1, PS.ep) : c[d]; }   // EP 下标 = 矩阵 epOf 的 ep
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
    { id: 'problem-2', name: '问题2 · Router 溢出与 Comm 死锁',
      lede: '报错点在 HCCL Comm 超时，震中却在 Layer 38 的 Router——一次 FP8 数值溢出，经 EP barrier 与 PP 依赖扩散成 2048 NPU 停摆。',
      events: [
        { id: 'p1-warning', time: '15k', dim: '数值·预警', sev: 'warn', title: 'Loss scale 连续衰减',
          conclusion: 'Layer 38 的数值健康已提前恶化，AMP scaler 从 65536 衰减到 4096。' },
        { id: 'p1-nan', time: '15203', dim: '耗时·数值', sev: 'bad', title: 'Loss NaN / grad_norm Inf',
          conclusion: '异常只在多 NPU 复现，Layer 38 是首个数值病灶候选。' },
        { id: 'p1-log', time: '+8ms', dim: 'Comm·日志', sev: 'bad', title: 'Plog 暴露 buffer 失配', rank: 1559,
          conclusion: '运行时 EP rank 23 的 send=0、recv=9832；Comm 报错同时携带 router_logits Inf 证据。' },
        { id: 'p1-a2a', time: '+30s', dim: 'Comm·耗时', sev: 'bad', title: 'All-to-all 超时，63 rank 空等', rank: 1559,
          conclusion: 'EP rank 23 是首个阻塞者，其余 63 个 EP rank 是 barrier 受害者，不应被判为 64 个独立根因。' },
        { id: 'p1-root', time: '-30s', dim: '数值·负载', sev: 'bad', root: true, title: 'Router FP8 溢出，E193 吸收 98% token',
          conclusion: '这是问题2的根因事件：FP8 softmax 溢出导致路由塌缩，而不是 HCCL 自身故障。' },
        { id: 'p1-spread', time: '+30.1s', dim: 'Comm·扩散', sev: 'bad', title: 'PP3 断裂，2048 NPU hang',
          conclusion: '报错点是 Comm timeout，异常震中却在 Layer 38 Router；单点经 EP barrier 和 PP 依赖扩散至整网。' }
      ] },
    { id: 'problem-1', name: '问题1 · 显存 Peak 与碎片 OOM',
      lede: '显存从 55 GB 一路爬到顶：12 层 Activations 的存活区间在前向末尾全部重叠，叠上 LM Head 的 logits 把 64 GB 顶满，最后死在一次 0.5 GB 的临时申请上。',
      events: [
        { id: 'p2-rise', time: '8000+', dim: '显存·趋势', sev: 'warn', title: '显存从 55 GB 持续爬升',
          conclusion: 'PP stage 3 的显存不再回落，Throughput 同期下降 12.5%。' },
        { id: 'p2-cost', time: '12000', dim: '耗时·显存', sev: 'warn', title: '分配/释放 API 占时 7.4%',
          conclusion: '显存管理耗时 890 ms，明显高于正常值 2%；带宽利用率 78%，可排除纯带宽瓶颈。' },
        { id: 'p2-peak', time: '12000', dim: '显存·容量', sev: 'bad', title: 'Activations 占用 36.2 GB',
          conclusion: 'Activations 占 Peak 的 56.6%，是唯一可大幅缩减的组成。' },
        { id: 'p2-layer', time: '12000', dim: '显存·Layer', sev: 'warn', title: 'L38 单层 Activations 达到 1.2 GB',
          conclusion: 'Layer 38 比普通 Dense 层高 1.7 倍，额外占用来自 expert dispatch buffer。' },
        { id: 'p2-oom', time: '12003', dim: '显存·OOM', sev: 'bad', root: true, title: 'EP rank 17（global rank 1553）触顶并发生碎片 OOM', rank: 1553,
          conclusion: '64/64 GB 容量不足是主因，83% 碎片率让 0.5 GB 临时 buffer 更早申请失败。' }
      ] }
  ];
  var INCIDENT_METRICS = [
    { k: 'loss', l: 'Loss',    name: 'lm loss',            want: '↓',    src: 'loss_func() → training_log()' },
    { k: 'gnorm', l: 'Grad Norm',   name: 'grad_norm',          want: '稳定',  src: 'training_log()' },
    { k: 'lscale', l: 'Loss Scale',  name: 'loss_scale',         want: '不触发', src: 'logger_and_track_metrics_callback.py:74' },
    { k: 'zeros', l: 'Zero Grads',   name: 'num_zeros_in_grad',  want: '↓',    src: 'training_log()' },
    { k: 'tflops', l: 'TFLOPS',  name: 'throughput',         want: '↑',    src: 'PretrainMetricConfig._compute_throughput' },
    { k: 'mfu', l: 'MFU',     name: 'MFU',                want: '↑',    src: 'PretrainMetricConfig._compute_mfu' },
    { k: 'tokday', l: 'Throughput',  name: 'throughput_per_day', want: '↑',    src: '_build_log_dict:1505' },
    { k: 'steptime', l: 'Step Time', name: 'elapsed time / iter',want: '↓',    src: '_build_log_dict:1491' },
    { k: 'lr', l: 'LR',      name: 'learning_rate',      want: '按计划', src: 'lr scheduler（cosine / WSD）' },
    { k: 'mem', l: '显存',     name: 'mem_reserved_bytes', want: '平稳',  src: 'NPU 保留显存 / theoretical_memory' }
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
      steptime: { v: '+30,000 ms', s: 'bad', why: '等满 HCCL 超时阈值 30 s' },
      tflops: { v: '0（63 NPU）', s: 'bad', why: '空等期间算力零产出，而日志上什么都不报' },
      mfu: { v: '0', s: 'bad', why: '同上——这正是「看起来 Comm 很慢」最容易骗人的地方' },
      tokday: { v: '0', s: 'bad', why: '累计空转 63 × 30 s ≈ 1890 NPU·秒' } } },
    'p1-root': { hooks: [], m: {
      zeros: { v: '247 / 256 专家无梯度', s: 'bad', why: '路由塌缩后它们再没收到过 token' },
      loss: { v: '—', s: 'na', why: '本事件采的是路由份额与 logits，不在这十格里' } } },
    'p1-spread': { hooks: ['heartbeat'], m: {
      steptime: { v: 'hang', s: 'bad', why: '依赖环闭合，4 个 stage 全停在等待上' },
      tflops: { v: '0（2048 NPU）', s: 'bad', why: '99.95% 的 NPU 只是被链条拖住的' },
      mfu: { v: '0', s: 'bad' }, tokday: { v: '0', s: 'bad' } } },
    'p2-rise': { hooks: ['oom'], m: {
      mem: { v: '55 → 63.7 GB', s: 'bad', why: '4000 step 未回落，被留住的是一直活着的 Activations' },
      tokday: { v: '3,200 → 2,800 tok/s', s: 'warn', why: '同期 Throughput 下降 12.5%' },
      tflops: { v: '同比 −12.5%', s: 'warn', why: '原文给的是 tokens/s，这一格按同一口径读' } } },
    'p2-cost': { hooks: [], m: {
      steptime: { v: '12,000 ms', s: 'warn', why: '其中 890 ms（7.4%）花在显存分配/释放上，正常水位约 2%' },
      mem: { v: 'HBM 带宽 78%', s: 'ok', why: '可排除纯带宽瓶颈——贵在碎片整理与换页，不在搬数据' } } },
    'p2-peak': { hooks: ['oom'], m: {
      mem: { v: '64.0 / 64 GB', s: 'bad', why: 'Activations 占 56.6%，安全余量 0 GB' } } },
    'p2-layer': { hooks: [], m: {
      mem: { v: 'L38 单层 1.2', s: 'warn', why: '同段普通层 0.71 GB，多出来的 0.5 GB 来自 expert dispatch buffer' } } },
    'p2-oom': { hooks: ['oom'], m: {
      mem: { v: '已分配 60.1 / 64', s: 'bad', why: '碎片率 83%，最大连续块只有 0.32 GB' },
      steptime: { v: '中断', s: 'bad', why: '它一崩 PP3 就断，全网跟着停在等待上' } } }
  };
  var INCIDENT_SEVC = { ok: '#5C5C5C', warn: '#FAB219', bad: '#F85149', na: '#3A3A3A' };   // 告警才用色：红 = 严重、琥珀 = 警告，其余灰

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
  /* 故障复盘并进顶上的告警清单（反馈「告警和左侧的显存 Peak 还有溢出的关系是什么？如果是一起的，就合并到顶上的告警中间去」）：
     左列原来那两条（显存 Peak 与碎片 OOM / Router 溢出与 Comm 死锁）就是告警清单里「Post-mortem」那两行，同一份数据摆了两处。
     现在左列不再画，事件链改在告警清单里就地展开（chainHtml），rank 按钮照旧能下钻。 */
  function incidentChainHtml(prob) {
    return prob.events.map(function (e) {
      var board = INCIDENT_BOARD[e.id], m = board && board.m ? board.m : {};
      var chips = INCIDENT_METRICS.filter(function (x) { return m[x.k] && m[x.k].s !== 'na'; }).map(function (x) {
        var c = m[x.k];
        return '<span class="ip-m" style="--ip-sevc:' + INCIDENT_SEVC[c.s] + '" title="' + esc(x.name + (c.why ? ' · ' + c.why : '') + ' · 来源 ' + x.src) + '"><em>' + esc(x.l || x.k) + '</em>' + esc(c.v) + '</span>';
      }).join('');
      return '<div class="ip-ev' + (e.root ? ' is-root' : '') + '" style="--ip-sevc:' + INCIDENT_SEVC[e.sev] + '" title="' + esc(e.conclusion) + '">'
        + '<div class="ip-evhd"><span class="ip-time">' + esc(e.time) + '</span><span class="ip-title">' + esc(e.title) + '</span>'
        + (e.root ? '<span class="ip-root">根因</span>' : '')
        + (e.rank != null ? '<button type="button" class="ip-drill" data-act="ip-drill" data-rank="' + e.rank + '">' + ('rank ' + e.rank) + '</button>' : '')
        + '</div>' + (chips ? '<div class="ip-ms">' + chips + '</div>' : '') + '</div>';
    }).join('');
  }
  function incidentDrill(rank9) {
    if (PS.matrixPreset === 'incident2048') showDetail(rank9);
    else location.href = '?preset=incident2048&sel=' + rank9;
  }
  function renderIncidentPanel() {
    if (!incidentPanel) return;
    incidentPanel.innerHTML = ''; incidentPanel.classList.add('is-hidden');
    if (typeof renderJourney === 'function' && typeof journey !== 'undefined') renderJourney();
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
    /* 下方面板打开时是挤压关系（反馈「泳道打开和上面是挤压关系，上面应该出现滚动条而不是和泳道重叠」）：
       左卡的可用高度 = 视口 − 顶 − 下方面板 − 底下故障列要占的那截，装不下就在卡内滚动 */
    if (leftCard) {
      var pbH = document.body.classList.contains('panel-bottom') && !drawer.classList.contains('is-hidden') ? drawer.offsetHeight + 10 : 0;
      var ipl = incidentPanel.querySelector('.ip-col-left'), avail = window.innerHeight - (leftCard.offsetTop || 56) - 16 - pbH;
      var ipH = ipl ? vsContentH(ipl) : 0, ipNeed = ipH ? Math.min(ipH, Math.round(avail * 0.4)) + 8 : 0;   // 故障列内容自身的高（scrollHeight 会被列高撑大，不用）
      var mh = Math.max(120, avail - ipNeed) + 'px';
      if (leftCard.style.maxHeight !== mh) leftCard.style.maxHeight = mh;
    }
    var lh = leftCard ? leftCard.offsetHeight : 0;
    var rh = briefCard && !briefCard.classList.contains('is-hidden') ? briefCard.offsetHeight : 0;
    if (lh !== lastLcH) { lastLcH = lh; incidentPanel.style.setProperty('--lc-h', lh + 'px'); }
    if (rh !== lastRcH) { lastRcH = rh; incidentPanel.style.setProperty('--rc-h', rh + 'px'); }
    // 右侧数据卡列接在右卡下面（右卡收起时顶到右卡原位）
    if (typeof shardL !== 'undefined' && shardL) { var t8 = (leftCard.offsetTop || 16) + lh + 8; if (shardL._top !== t8) { shardL._top = t8; shardL.style.top = t8 + 'px'; } }
    if (typeof dataCol !== 'undefined' && dataCol) { var t9 = (briefCard.offsetTop || 60) + (rh ? rh + 8 : 0); if (dataCol._top !== t9) { dataCol._top = t9; dataCol.style.top = t9 + 'px'; } }
  }
  /* 小屏（笔记本 1280×720 / 1366×768 这一档）：高度不到 840 或宽度不到 1400 就收紧——卡片内边距、行高、卡间距压一档，
     rank 卡五档显存收成一根分段条、四行链路收成一行；大屏不变 */
  function syncCompact() { document.body.classList.toggle('is-compact', window.innerHeight < 840 || window.innerWidth < 1400); }
  syncCompact();
  window.addEventListener('resize', function () { syncCompact(); syncCardHeights(); });
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
    /* 规模小：矩阵本体自己一屏就是全部——不铺 Logical Cube、不裁剪它的任何交互，
       与直接打开 /patterns/rank-topology-3d/ 逐字节相同。stitle 换成模型
       名称，跟三档取景那条路用的是同一个名字来源，不是另起一套说法。
       分隔符用 "/"：反馈「都放成面包屑用/分隔」，与下面 tier3 那条、
       Logical Cube 自己的招牌（见 pattern.js 的 syncBrand）三处统一成同一套
       写法，不是"这条 · 那条 /"各写各的。 */
    var plainP = new URLSearchParams(splitParams({
      embed: '1', theme: 'dark', card: '1', view: 'chain', vtab: '3d',
      stitle: PS.modelName + ' / ' + world + ' 卡'
    }));
    matrixFrame.src = engineSrc(ENG_3D, plainP);
    matrixFrame.classList.remove('is-hidden');
    return;
  }


  // ── Logical Cube：固定当前预置，深色主题 ──────────────────────────────────
  // color=neutral：默认就是素色（中性灰），不是负载热力橙→粉——这个简洁版要的
  // 默认态是"先看形状、不看颜色"，颜色留给选中/告警这些真正需要强调的状态。
  // Logical Cube 自己独立打开（/rubik-pattern.html）默认仍是负载热力，这个参数只在
  // 这里传，不改它自己的默认值。
  // groupgap=3：拉开 tp/pp/dp/ep 各组之间的缝，这种规模下"这是几段/几片"才
  // 读得出来——独立打开的 /rubik-pattern.html 默认 1（原样间距），这个参数
  // 只在这里传，呼应"默认状态下参考并行拓扑拉大间距、让分组更明显"那条反馈。
  // brand=：Logical Cube 顶栏那块"Logical Cube"招牌换成模型名称——同一条"用模型
  // 名称做全部命名"的规矩，这一层管得到的每一处都不留生造的产品名。
  // cclabels=0：收起"卡内魔方"那两枚钉在 3D 世界坐标上的字牌（行末算子名 +
  // 顶部"卡内 · L.."标题）——它们跟着相机转，规模一大会飘到这一层自己的
  // 悬浮数据卡/返回按钮那片地界上，跟已经在讲同一句话的右侧详情卡叠在一起
  // （反馈原话"不再这里显示只显示右侧卡片就好"）。彩色小格阵列本身照常画，
  // 少的只是文字；独立打开 /rubik-pattern.html 不受影响，默认还画这两枚牌。
  // axsel=0：选中一张 NPU 时收起"贴在几何体上"那类轴刻度字牌（TP0/PP3 这种，
  // 世界尺寸固定）——第二档的镜头贴得极近（"局部聚焦"），这类字牌会占满
  // 大半个画布、糊住选中卡自己的坐标读出。坐标信息本来就写在 DOM 侧栏与
  // 悬浮数据卡里，画布里不用再重复一遍。
  // cc=0：选中一张 NPU 时画布里那圈"卡内魔方"彩色小格阵列整个不画了——不只是
  // 字牌（cclabels 管那个），是格子本身。反馈原话"不是说去色的问题，是
  // 不要在画布中显示"：同一句话（rank / 层区间 / 对象持有情况）右侧详情卡
  // 已经摆得清清楚楚，画布这层不用再重复一份彩色阵列；"卡片还是保留彩色"
  // 指的是右侧详情卡与装载清单的颜色，那两处不受这条影响，独立打开
  // /rubik-pattern.html 也不受影响，默认还画这圈格子。
  // tierlabel=：面包屑第三段，见上面 TIER2_LABEL 的注释——独立打开
  // /rubik-pattern.html 不传这个参数，默认还是"模型名 / rank N"两段。
  // zoomsel=0.5：反馈「在这一步就做一个小的zoomin」附图是盘古预置选中一张
  // 卡后，那一列在 4000 卡满屏阵列里只有几个像素——选中时镜头往那张 NPU
  // 推近一半（不是矩阵那种贴近 NPU 的"局部聚焦"，这里镜头还是全景机位，
  // 只是缩小取景范围），取消选中飞回原机位。独立打开 /rubik-pattern.html
  // 不传这个参数，选中不受影响。
  // chrome=0：反馈「点击 NPU 会卡在这里」「去掉标签，下面的内容放到标题后面去」——
  // 附图是 Logical Cube 自带的选中卡侧栏（.prc-info，"RANK"kicker+标题+键值表那一整套）
  // 在窄屏媒体查询下挪到画面底部，跟这一层自己的 briefCard/角标/corner-link 叠在
  // 一起，还用它的透明留白盖住了舞台——点上去点在了这张看不见的 NPU 上，画布本身
  // 反而没反应，看着像"卡住了"。这一层右上角的 briefCard 早就把"选中的是哪张 NPU、
  // 什么坐标"说清楚了，.prc-info 与顶栏那一整套（形态/视角按钮、更多抽屉、图例）
  // 全是重复的第二份 chrome——直接让 Logical Cube 自己那套别画，不止是这一个面板的
  // 样式问题。独立打开 /rubik-pattern.html 不传这个参数，默认还画，不受影响。
  var rubikParams = new URLSearchParams({
    /* cp：缺省按 1（PS.cp||1）——pangu/dense64/incident2048 没有这个字段，
       String(undefined) 会变成字面量 "undefined" 传出去，||1 兜底成
       rubik-pattern.html 自己的默认值，三档旧预置的取景逐位不变；
       moe718b128k 第一次真的用上非 1 的 cp。 */
    theme: 'dark', tp: String(PS.tp), cp: String(PS.cp || 1), pp: String(PS.pp), dp: String(PS.dp), ep: String(PS.ep),
    /* 10.17：魔方抬头同本页标题的写法（「MoE 504B A18B · 32K seq / rank N」）——不再多一段「同组定位」、模型名也不再是括号写法 */
    color: 'neutral', groupgap: '3', brand: String(PS.modelName).replace(/\(([^)]+)\)\s*·?\s*/, ' $1 · '), cclabels: '0', axsel: '0', cc: '0',
    zoomsel: '0.5', chrome: '0',
    rankorder: 'pp'   // 魔方显示的 rank 号换成本页的编号（10.16：原来标题写的是魔方内部序号，选 1267 显示成 1875）
  });
  // Logical Cube 现在不是主线上的一档，是底部工具条唤起的参考抽屉（见 openDrawer）
  var rubikSrc = './engine/rubik.html?' + rubikParams.toString();

  // 故事线是一条下钻链，不是几个并列的 tab：
  //   cluster 集群 —— 灵衢物理拓扑：4096 张 NPU 物理上怎么连；左卡的 PP 段按钮 = 原地聚焦一段
  //   board   板   —— 一块板的 Server 形态图
  //   （任一层点一颗卡 = 选中 rank，右卡给层区间/显存/物理位置/Comm 组走哪一级）
  //   card NPU    —— 矩阵 solo：这一张 NPU 里装了什么。
  // 面包屑随时回退；Logical Cube/Network Graph/泳道图/Hierarchy 是主线之外的参考面板（底部工具条）。
  // curSel 是当前选中的矩阵 rank，focusPP 是当前聚焦的 PP 段，tier 是档位
  // （1 集群 · 2 同组定位 · 3 NPU 下钻），level 是画布现在停在哪一层。
  var level = 'cluster', backLevel = 'cluster';
  var physBuilt = false;
  var curSel = null, focusPP = null, tier = 1;

  // ── 灵衢物理拓扑：第一档的第三种画法，也是默认的第一屏 ──────────────────
  // 按 CANN NEXT 直播讲的 Ascend 950 积木（见 research/灵衢材料-学习笔记01）：
  //   板（Server 内 8 NPU，UB fullmesh）→ POD（64 NPU = 8 板，L1 灵衢 SW）
  //   → 128 卡组（2 个 POD，配 8 颗 L1 SW、每平面一颗）→ SuperPoD（1024P =
  //   8 组，8 个独立平面、每平面 4×SW2，L1/L2 构成 Clos，平面间无互联）
  //   → SuperPoD 之间经 L2 走 UBoE。
  // rank 落到哪颗 NPU 配置里没有——这一层按「rank 连续摆放」这条**假设**
  // 推（r → SuperPoD ⌊r/1024⌋ · POD ⌊r/64⌋ · 板 ⌊r/8⌋ · 槽 r%8），左卡上写明。
  // 在这条假设下，五个 Comm 组各走哪一级链路是能算出来的：组内成员的最远
  // 一对落在同一块 Board / 同一个 POD / 同一个 SuperPoD / Cross-SuperPoD，就是它走的
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
  /* EP 组与矩阵本体（demo.html epOf / epMembers，etp=1）同一个口径：同一段（pp）里把 (dp, cp, tp) 拉平成
     q = (dp·CP + cp)·TP + tp，连续 EP 个 q 成一组（Megatron 的 tp-ep-dp 排法）。原来这里写成「DP 维上每 EP 个
     副本一桶」，EP 组会被算到跨 SP，跟矩阵说的（组内 16 张是连号的，落在一个 POD 里）对不上。 */
  function epQ(c) { return (c.dp * PS.cp + c.cp) * PS.tp + c.tp; }
  function epMembers(r) {
    var c = coordOfRank(r), E = Math.max(1, PS.ep), q0 = Math.floor(epQ(c) / E) * E, out = [];
    for (var e = 0; e < E; e++) { var q = q0 + e; out.push(rankOfCoord({ tp: q % PS.tp, cp: Math.floor(q / PS.tp) % PS.cp, dp: Math.floor(q / (PS.tp * PS.cp)) % PS.dp, pp: c.pp })); }
    return out;
  }
  function commGroups(r) {
    var c = coordOfRank(r), g = { tp: [], cp: [], ep: [], dp: [], pp: [] }, i;
    for (i = 0; i < PS.tp; i++) g.tp.push(rankOfCoord({ tp: i, cp: c.cp, dp: c.dp, pp: c.pp }));
    for (i = 0; i < (PS.cp || 1); i++) g.cp.push(rankOfCoord({ tp: c.tp, cp: i, dp: c.dp, pp: c.pp }));
    for (i = 0; i < PS.dp; i++) g.dp.push(rankOfCoord({ tp: c.tp, cp: c.cp, dp: i, pp: c.pp }));
    g.ep = epMembers(r);
    for (i = 0; i < PS.pp; i++) g.pp.push(rankOfCoord({ tp: c.tp, cp: c.cp, dp: c.dp, pp: i }));
    return g;
  }
  /* 10.17 术语：SuperPoD 一律 SuperPoD——「SP」在 Network Graph 里是序列并行（Sequence Parallel），同一个缩写不能指两件事 */
  var LINK_LEVELS = ['Board', 'POD', 'SuperPoD', 'Cross-SuperPoD'];
  /* 8 个平面（直播第一页：L1/L2 按平面成 Clos，平面之间没有互联）只用 P1…P8 的
     标签区分，不按平面着色——黑白规则。PLANE_C 留着做统一灰阶入口。 */
  var PLANE_C = ['#6E6E6E', '#6E6E6E', '#6E6E6E', '#6E6E6E', '#6E6E6E', '#6E6E6E', '#6E6E6E', '#6E6E6E'];
  /* 五个 Comm 组的描边只分灰阶：TP 白实线最粗、CP 浅灰、EP/DP 中灰、PP 白虚线。 */
  /* 维度色：本页 CSS 变量 --c-* 这一套；NPU 页（demo.html slabgap）也换成同一套，全篇一个颜色一个意思 */
  var GC = { tp: 'var(--c-tp)', cp: 'var(--c-cp)', ep: 'var(--c-ep)', dp: 'var(--c-dp)', pp: 'var(--c-pp)' };
  function dimDot(d) { return '<i class="gc" style="background:' + GC[d] + '"></i>'; }
  function levelBetween(a, b) {
    var p = physOf(a), q = physOf(b);
    return p.sp !== q.sp ? 3 : p.pod !== q.pod ? 2 : p.board !== q.board ? 1 : 0;
  }
  /* 集合 Comm 组（TP/CP/EP/DP）：组里最远的一对决定这次集合走哪一级；
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
     另一种颜色、往上穿过 SW1 行。每 Board 1 颗 DPU / 4 张 NIC 是按第二页 Server
     图数的（4 个 NIC 框），直播没给每 Board DPU 的确切数，这一项是示意。 */
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
        + '<text class="p-splabel" x="' + (sx + PAD) + '" y="' + (sy + 18) + '">SuperPoD ' + s + ' · ' + inSp + '</text>');
      var planeW = (SPW - PAD * 2 - 7 * 8) / 8, py = sy + HEAD, planeC = [];
      for (var pl = 0; pl < 8; pl++) {
        var px = sx + PAD + pl * (planeW + 8), sw2w = (planeW - 12) / 4;
        panels.push('<rect class="p-plane" style="--pc:' + PLANE_C[pl] + '" x="' + px + '" y="' + py + '" width="' + planeW + '" height="' + PLANEH + '"><title>平面 ' + (pl + 1) + ' · 4×SW2 · 与平面内每颗 L1 成 Clos · 平面间无互联</title></rect>'
          + '<text class="p-planelabel" x="' + (px + planeW / 2) + '" y="' + (py + 13) + '" text-anchor="middle">P' + (pl + 1) + '</text>');
        for (var q = 0; q < 4; q++) panels.push('<use class="p-sw2" href="#hw-sw" x="' + (px + 6 + q * sw2w) + '" y="' + (py + PLANEH - 14) + '" width="' + (sw2w - 3) + '" height="10"/>');
        (GEO.sw2[s] = GEO.sw2[s] || [])[pl] = [0, 1, 2, 3].map(function (q9) { return { x: px + 6 + q9 * sw2w + (sw2w - 3) / 2, y: py + PLANEH - 4 }; });
        planeC.push({ x: px + planeW / 2, y: py + PLANEH });
      }
      var groups = Math.ceil(inSp / PHYS.group), l2s = [];
      for (var g = 0; g < groups; g++) {
        var gx = sx + PAD + (g % GRPCOLS) * (GRPW + GRPGAP), gy = sy + HEAD + PLANEH + 14 + Math.floor(g / GRPCOLS) * (GRPH + 16);
        var gBase = base + g * PHYS.group, sw1w = (GRPW - 7 * 4) / 8;
        for (var k = 0; k < 8; k++) {
          var swx = gx + k * (sw1w + 4);
          (GEO.sw1[gBase / PHYS.group] = GEO.sw1[gBase / PHYS.group] || [])[k] = { x: swx + sw1w / 2, top: gy, bot: gy + SW1H };
          panels.push('<rect class="p-sw1" style="--pc:' + PLANE_C[k] + '" x="' + swx + '" y="' + gy + '" width="' + sw1w + '" height="' + SW1H + '"><title>L1 SW · 平面 ' + (k + 1) + ' · 下接 2 个 POD 每颗 NPU 1 口 · 上接本平面 4×SW2（4 口）</title></rect>');
          panels.push('<use class="p-swicon" href="#hw-sw" x="' + (swx + 1) + '" y="' + (gy + 1) + '" width="' + (sw1w - 2) + '" height="' + (SW1H - 2) + '"/>');
          l2s.push({ g: g, k: k, x: swx + sw1w / 2, top: gy, col: g % GRPCOLS, row: Math.floor(g / GRPCOLS) });
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
            panels.push('<rect class="p-board" data-board="' + bIdx + '" data-pod="' + podIdx + '" x="' + (pdx + 2) + '" y="' + (ry - ROWP / 2) + '" width="' + (PODW - 4) + '" height="' + ROWP + '"><title>Board ' + bIdx + ' · 2 CPU + 8 NPU + DPU + 4 NIC</title></rect>');
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
                + '<title>rank ' + r + ' · ' + coordLine(r) + ' · SuperPoD ' + s + ' · POD ' + podIdx + ' · Board ' + b + ' · Slot ' + n + '</title></rect>');
              // rank 号 / 封装图标 / 占用条这三件只在放大到 6× 以上才看得见：不在这里一次建 4096×3 个，见 ensurePodDetail
            }
          }
        }
      }
      /* L1 → 本平面 SW2（与板视图同一套直角线束，10.12）：原来 64 根斜线从各组 L1 直拉到平面，交叉成网。
         现在每颗 L1 往上到本组上方的一条轨道，横到两列组中间的走线槽，槽里每根一条车道一路往上，
         到平面下方再各走一条轨道横到本平面、落上去。槽内左半给左列组（上面的组在外）、右半给右列组；
         同一组 8 根在槽里按平面顺序排，拐出去互不横穿 */
      var CX = sx + PAD + GRPW + GRPGAP / 2, LP = 0.25, nRow = Math.ceil(groups / GRPCOLS);
      var zoneB = sy + HEAD + PLANEH + 14 - 1.2;
      var lanes = {}, li = 0;
      for (var rw = 0; rw < nRow; rw++) for (var k8 = 0; k8 < 8; k8++) lanes[(rw * GRPCOLS) + ',' + k8] = li++;
      for (rw = nRow - 1; rw >= 0; rw--) for (k8 = 0; k8 < 8; k8++) lanes[(rw * GRPCOLS + 1) + ',' + k8] = li++;
      var lx0 = CX - (li - 1) / 2 * LP;
      var upL = l2s.filter(function (e) { return planeC[e.k].x < CX; }), upR = l2s.filter(function (e) { return planeC[e.k].x >= CX; });
      var laneX = function (e) { return lx0 + lanes[e.g + ',' + e.k] * LP; };
      upL.sort(function (a, b) { return laneX(a) - laneX(b); });
      upR.sort(function (a, b) { return laneX(b) - laneX(a); });
      var topY = {};
      upL.forEach(function (e, n) { topY[e.g + ',' + e.k] = zoneB - n * 0.35; });
      upR.forEach(function (e, n) { topY[e.g + ',' + e.k] = zoneB - n * 0.35; });
      l2s.forEach(function (e) {
        var ly = e.top - 1.5 - (e.col ? e.k : 7 - e.k) * 0.6, lx = laneX(e), ty = topY[e.g + ',' + e.k];
        var dx = planeC[e.k].x + (e.g - (groups - 1) / 2) * 0.5;
        links.push('<path class="p-l2" style="--pc:' + PLANE_C[e.k] + '" d="' + rp([[e.x, e.top], [e.x, ly], [lx, ly], [lx, ty], [dx, ty], [dx, planeC[e.k].y]], 1.2) + '"/>');
      });
    }
    // SuperPoD 之间：L2 经 UBoE 互联。直播里只说"经 UBoE Cross-SuperPoD"，没给 SuperPoD 间
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
     放大到 3× 以上，指针所在的那块 Board（选中了 rank 就是它所在的那块）把直播四页里的关系原地展开：
     ① Board 内 8 卡 UB fullmesh（28 条弧，7×X4）  ② 出 Board Clos：每 NPU 8 口到本组 8 颗 L1（每平面 1 颗）
     ③ L1 → 本平面 4×SW2（L2，4 口）  ④ CPU —UB→ L1（8 口/C）  ⑤ H2D：CPU0 带 NPU0–3、CPU1 带 NPU4–7
     ⑥ CPU0 — CPU1 互联  ⑦ DPU —PCIe— CPU0、DPU —UB→ L1  ⑧ NIC k 挂 NPU 2k/2k+1（1 口 UB）
     ⑨ NIC / DPU —RoCE→ 出框（参数面）  ⑩ NIC 交换（CPU 1 口 / NIC 2 口）  ⑪ 框内 L2 交换板（L1 之间）；
     SuperPoD 之间的 UBoE 本来就画着。线型与板视图一致。 */
  var relBoard = null;
  function relSvg(b) {
    var G = GEO.board[b]; if (!G) return '';
    var L1 = GEO.sw1[G.grp] || [], P2 = GEO.sw2[G.sp] || [], out = [], x0 = G.pdx, ry = G.ry, i, k;
    var NX = function (n) { return x0 + 22 + n * PITCH_ + 4.5; }, NT = ry - 3.5, NB = ry + 4.1;   // NB：rank 号下沿（往下的线不穿字）
    var CPU = [x0 + 7.7, x0 + 14.1], DPU = x0 + 101.4, NIC = function (k9) { return { x: x0 + 107.2 + (k9 % 2) * 6.8 + 3.2, y: ry - 3.4 + Math.floor(k9 / 2) * 3.4 + 1.6 }; };
    /* 与板视图同一套画法（10.12，反馈「按现在的方案全局调整」）：直角走线 + 小圆角、每根线一条车道、束里先拐的在外道、
       每根线垫底色描边（lod2 才显出来）。束内间距 BQ、轨道层距 DQ（集群坐标，一格 NPU 宽 7） */
    var BQ = 0.5, DQ = 0.5, R9 = 0.8;   // 束内间距 = 轨道层距，全图同一个值（反馈「间距不一致」）
    /* 板行之间只有 2 格缝，线只能从别的行身上过：展开关系时这个 POD 的其余行让位——盖一层与 POD 同色的底（当前这一行挖空），
       线画在干净的底上，不压任何器件、也不被任何器件盖住（反馈「连线遮挡」）。移开 / 取消选中就恢复 */
    var PY = G.pdy, PH = 84, PW = PODW_, rr = 7, top0 = ry - ROWP_ / 2, bot0 = ry + ROWP_ / 2;
    out.push('<path class="rel-scrim" fill-rule="evenodd" d="M' + (x0 + rr) + ',' + PY + ' H' + (x0 + PW - rr) + ' Q' + (x0 + PW) + ',' + PY + ' ' + (x0 + PW) + ',' + (PY + rr)
      + ' V' + (PY + PH - rr) + ' Q' + (x0 + PW) + ',' + (PY + PH) + ' ' + (x0 + PW - rr) + ',' + (PY + PH) + ' H' + (x0 + rr) + ' Q' + x0 + ',' + (PY + PH) + ' ' + x0 + ',' + (PY + PH - rr)
      + ' V' + (PY + rr) + ' Q' + x0 + ',' + PY + ' ' + (x0 + rr) + ',' + PY + ' Z M' + (x0 + 2) + ',' + top0 + ' V' + bot0 + ' H' + (x0 + PW - 2) + ' V' + top0 + ' Z"/>');
    function na(n) { return n == null ? '' : typeof n === 'string' ? ' data-m="' + n + '"' : ' data-n="' + n + '"'; }
    function pt(cls, pts, n) { out.push(cased('<path class="' + cls + '"' + na(n) + ' d="' + rp(pts, R9) + '"/>')); }
    function ln(cls, x1, y1, x2, y2, n) { out.push(cased('<line class="' + cls + '"' + na(n) + ' x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>')); }
    function dir(a, b9) { return b9 < a ? -1 : 1; }
    /* ── 上方：出 Board Clos（8 NPU × 8 L1）+ CPU / DPU 的 UB 上联。L1 行下沿与 POD 上沿之间 8 条平面轨道（平面 k 走第 k 条，
       越往下越先拐）；每颗 NPU / CPU 顶边出一束往上直穿过上面几行，拐进各自平面的轨道，再从 L1 下沿中点落进去 */
    if (L1.length === 8) {
      var TY = function (k9) { return L1[0].bot + 1.5 + k9 * DQ; };
      var up = function (cls, cx, top, pitch, n, only) {
        var ks = only || [0, 1, 2, 3, 4, 5, 6, 7];
        var m = laneMap(cx, ks.map(function (k9) { return { key: k9, d: dir(cx, L1[k9].x), f: TY(k9) }; }), pitch);
        ks.forEach(function (k9) { pt(cls, [[m[k9], top], [m[k9], TY(k9)], [L1[k9].x, TY(k9)], [L1[k9].x, L1[k9].bot]], n); });
      };
      for (i = 0; i < 8; i++) up('rel-clos', NX(i), NT, BQ, i);
      CPU.forEach(function (cx) { up('rel-ub', cx, ry - 2.6, BQ); });
      up('rel-ub', DPU - 0.8, ry - 3, BQ, null, [7]);
      // ③ L1 → 本平面 4×SW2：L1 顶边一束 4 道，往上到平面行下面各走一条轨道（32 条，层距 0.4），再落到各颗 SW2
      L1.forEach(function (s1, k9) {
        var s2s = P2[k9] || []; if (!s2s.length) return;
        var T2 = function (q9) { return s2s[0].y + 4 + 0.8 + (k9 * 4 + q9) * 0.4; };   // 32 条挤在平面行下 14 格里，层距取 0.4
        var m = laneMap(s1.x, s2s.map(function (s2, q9) { return { key: q9, d: dir(s1.x, s2.x), f: T2(q9) }; }), 0.4);
        s2s.forEach(function (s2, q9) { pt('rel-l12', [[m[q9], s1.top], [m[q9], T2(q9)], [s2.x, T2(q9)], [s2.x, s2.y]]); });
      });
    }
    /* ── 下方：板行下面的分层轨道，由浅到深：fullmesh（28 对各占一层一段）→ CPU0 H2D ×4 → CPU1 H2D ×4 → NIC ×8 → NIC 交换 → PCIe。
       NPU 底边一束 9 道：H2D 最左、fullmesh 7 道（套环顺序）、NIC 最右 */
    // H2D 从左边的 CPU 来、NIC 从右边来，都比 fullmesh 拐得晚：落在束的正中间（H2D 偏左、NIC 偏右）
    var MP = meshPlan(NX, BQ, function () { return [{ key: 'h', d: -1, f: -100 }, { key: 'n', d: 1, f: -100 }]; }), MYr = function (L) { return NB + 1 + L * DQ; };
    var dH = function (n) { return MYr(MP.mTop) + 1 + n * DQ; };   // n = 0..7：CPU0 的 4 根在上（近的浅），CPU1 的 4 根在下
    var dN = function (n) { return dH(8) + (7 - n) * DQ; };          // NIC → NPU n：近的（n 大）浅
    var dS = dN(-1), dP = dS + DQ;                                    // NIC 交换、PCIe 最深
    /* 选中卡在这块 Board 上时：它连向同组 TP 卡的 fullmesh 标 is-tp（白 = 选中），连向其余卡的是连带（浅灰）；同组 TP 卡加一圈连带选中框 */
    var sS = curSel != null && physOf(curSel).board === b ? physOf(curSel).slot : null, tpS = {};
    if (sS != null) commGroups(curSel).tp.forEach(function (r9) { var q9 = physOf(r9); if (q9.board === b && r9 !== curSel) tpS[q9.slot] = 1; });
    for (i = 0; i < 8; i++) for (k = i + 1; k < 8; k++) {
      var yy = MYr(MP.MLV[i + ',' + k]), tp9 = sS != null && ((i === sS && tpS[k]) || (k === sS && tpS[i]));
      pt('rel-mesh' + (tp9 ? ' is-tp' : ''), [[MP.ML(i, k), NB], [MP.ML(i, k), yy], [MP.ML(k, i), yy], [MP.ML(k, i), NB]], i + ',' + k);
    }
    Object.keys(tpS).forEach(function (n) { out.push('<rect class="rel-relf" x="' + (NX(+n) - 3.6) + '" y="' + (ry - 4.1) + '" width="7.2" height="5.7" rx="1.3"/>'); });   // 贴封装图标外 0.6，同选中白框一个画法
    var cB = [0, 1].map(function (c) {
      var it = [];
      for (var n = 4 * c; n < 4 * c + 4; n++) it.push({ key: 'h' + n, d: 1, f: -dH(n) });
      it.push(c ? { key: 's', d: 1, f: -dS } : { key: 'p', d: 1, f: -dP });
      return laneMap(CPU[c], it, BQ);
    });
    for (i = 0; i < 8; i++) { var cm = cB[i < 4 ? 0 : 1], hx = cm['h' + i];
      pt('rel-h2d', [[hx, ry + 2.6], [hx, dH(i)], [MP.LM[i].h, dH(i)], [MP.LM[i].h, NB]], i); }
    for (k = 0; k < 4; k++) {
      var nc = NIC(k), it2 = [2 * k, 2 * k + 1].map(function (n) { return { key: n, d: -1, f: -dN(n) }; });
      if (k === 3) it2.push({ key: 's', d: -1, f: -dS });
      var nm = laneMap(nc.x, it2, BQ);
      [2 * k, 2 * k + 1].forEach(function (n) { pt('rel-nic', [[nm[n], nc.y + 1.6], [nm[n], dN(n)], [MP.LM[n].n, dN(n)], [MP.LM[n].n, NB]], n); });
      if (k === 3) pt('rel-nsw', [[cB[1].s, ry + 2.6], [cB[1].s, dS], [nm.s, dS], [nm.s, nc.y + 1.6]]);   // ⑩ NIC 交换（CPU1 1 口 → NIC 列）
    }
    pt('rel-pcie', [[DPU, ry + 3], [DPU, dP], [cB[0].p, dP], [cB[0].p, ry + 2.6]]);   // ⑦ DPU —PCIe— CPU0
    ln('rel-cpu', CPU[0] + 3.1, ry, CPU[1] - 3.1, ry);                                 // ⑥ CPU↔CPU
    // ⑪ 框内 L2 交换板：本组 8 颗 L1 经交换板框内互联——在 L1 行上沿画一条横贯的汇流线
    if (L1[0] && L1[7]) ln('rel-inf', L1[0].x - 4, L1[0].top - 1.2, L1[7].x + 4, L1[7].top - 1.2);
    // ⑨ RoCE 出框（NIC、DPU），往上穿过 L1 行
    for (k = 0; k < 4; k++) { var nr = NIC(k); ln('rel-roce', nr.x, nr.y - 1.6, nr.x, (L1[0] ? L1[0].top : ry) - 4); }
    ln('rel-roce', DPU + 0.8, ry - 3, DPU + 0.8, (L1[0] ? L1[0].top : ry) - 4);
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
    // 关系画在设备之上（下面垫一层挖空当前行的暗底，见 relSvg），选中框仍在最上
    var frame = svgEl.querySelector('.sel-frame');
    svgEl.insertBefore(tmp.firstChild, frame && frame.parentNode === svgEl ? frame : null);
  }
  physStage.addEventListener('pointerover', function (ev) {
    var svgEl = physStage.querySelector('.zp-box svg');
    if (!svgEl || !svgEl.classList.contains('lod1')) return;
    var t = ev.target.closest('.p-npu, .p-board');
    if (!t) return;
    var b = t.hasAttribute('data-board') ? +t.getAttribute('data-board') : physOf(+t.getAttribute('data-rank')).board;
    showRelations(b);
  });
  /* 放大到 6×（lod2）才出现的逐卡细节（rank 号 / 封装图标 / 占用条）按 POD 懒建：只给画面里看得见的那几个 POD 建，
     建过的留着。逐帧看过，原来一次建 4096×3 个、跨进 6× 那一下四万个图元一起重算样式，取景到一个 POD 要卡 1.7 秒。 */
  var podDetailDone = {};
  function ensurePodDetail(zp) {
    var svgEl = physStage.querySelector('.zp-box svg');
    /* NPU 图标与 CPU / DPU / NIC 同一档出现（反馈「CPU、DPU 都用了图标，NPU 还是方块」）：放大到 3×（lod1）就换成封装图标 + 占用条；
       3× 以下每格只有两三个像素，图标认不出、而且那一格的灰度就是占用热力图，仍用方块。rank 号字太小，仍到 6×（lod2）才出。 */
    if (!svgEl || !svgEl.classList.contains('lod1')) return;
    var vb = svgEl.viewBox.baseVal, R = zp.rect(), m = Math.min(R.width / vb.width, R.height / vb.height);
    var ox = (R.width - vb.width * m) / 2, oy = (R.height - vb.height * m) / 2;
    function sx(px) { return ((px - zp.tx) / zp.k - ox) / m + vb.x; }
    function sy(py) { return ((py - zp.ty) / zp.k - oy) / m + vb.y; }
    var x0 = sx(0), x1 = sx(R.width), y0 = sy(0), y1 = sy(R.height);
    physStage.querySelectorAll('.p-pod').forEach(function (pod) {
      var i = pod.getAttribute('data-pod'); if (podDetailDone[i]) return;
      var x = +pod.getAttribute('x'), y = +pod.getAttribute('y'), w = +pod.getAttribute('width'), h = +pod.getAttribute('height');
      if (x > x1 || x + w < x0 || y > y1 || y + h < y0) return;
      podDetailDone[i] = true;
      physStage.querySelectorAll('.p-npu[data-pod="' + i + '"]').forEach(function (el) {
        var ex = +el.getAttribute('x'), ey = +el.getAttribute('y');
        // 图标收一号（7→6 宽）让出一截：rank 号完整落在图标与占用条的**下方**居中，不再贴着占用条
        el.insertAdjacentHTML('afterend', '<text class="p-npunum lod2" x="' + (ex + 3.5) + '" y="' + (ey + 7.35) + '" text-anchor="middle">' + el.getAttribute('data-rank') + '</text>'
          + '<use class="p-npupkg lod1" href="#hw-npu" x="' + (ex + 0.5) + '" y="' + ey + '" width="6" height="4.5"/>'
          + '<rect class="p-npustrip lod1" x="' + (ex + 1.25) + '" y="' + (ey + 4.75) + '" width="4.5" height="0.4"/>');
      });
    });
  }
  function renderPhys() {
    if (physBuilt) return;
    physStage.innerHTML = '<div class="zp-box">' + buildPhysSvg() + '</div>';
    podDetailDone = {};
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
    [physStage, boardStage].forEach(markSelFrame);
    if (curSel != null) { relBoard = null; showRelations(physOf(curSel).board); }   // 选中变了就重画：选中 / 连带选中的标记画在关系图里
    renderPanel();
    setTimeout(placeSelLabel, 0);
    // 板视图：选中那颗 NPU 自己的链路（出板 8 口、板内 fullmesh 7 根、H2D、NIC）换激活样式，其余退后；
    // 集群层放大后原地展开的那块板（.rel）同一套
    var slot = here != null && here.board === curBoard ? here.slot : null;
    markHot(boardStage, slot);
    liftMesh(slot);
    /* 直角走线里同一列 / 同一条轨道被好几根线共用：选中那颗的线挪到最后画，才不会被旁边退后的线盖住 */
    var lkG = boardStage.querySelector('.b-links');
    // 选中一颗 NPU 时整张板进「聚焦」档：与它无关的干线（RoCE / UB / PCIe / NIC 交换 …）一起退暗，只留它自己的那几根亮着
    var bSvg = boardStage.querySelector('svg'); if (bSvg) bSvg.classList.toggle('has-sel', slot != null);
    if (lkG) boardStage.querySelectorAll('.b-links > .is-hot').forEach(function (el) {
      var cs = el.previousElementSibling;   // 它自己的底色描边一起挪，交叉处照样被切开
      if (cs && cs.classList.contains('lkc')) lkG.appendChild(cs);
      lkG.appendChild(el);
    });
    // 选中 NPU 与同板 TP 组员之间的 fullmesh 弧：标 is-tp（TP 流量走的就是这几根）
    var tpSlots = {};
    if (slot != null) commGroups(curSel).tp.forEach(function (r9) { var q9 = physOf(r9); if (q9.board === curBoard && r9 !== curSel) tpSlots[q9.slot] = 1; });
    boardStage.querySelectorAll('.b-mesh').forEach(function (el) { var ab = el.getAttribute('data-m').split(','); el.classList.toggle('is-tp', !!(slot != null && ((+ab[0] === slot && tpSlots[+ab[1]]) || (+ab[1] === slot && tpSlots[+ab[0]])))); });
    markHot(physStage, here != null ? here.slot : null);
    flowDots(slot);
    physStage.querySelectorAll('.p-pod').forEach(function (el) { el.classList.toggle('is-on', here != null && +el.getAttribute('data-pod') === here.pod); });
    physStage.querySelectorAll('.p-sp').forEach(function (el) { el.classList.toggle('is-on', here != null && +el.getAttribute('data-sp') === here.sp); });
  }
  /* 选中一颗 NPU 时它那 7 根 fullmesh 的层距要一致（反馈「间距不一致」）：全局排层时这 7 根散在不同层、间隔忽大忽小。
     选中就把它们抬到所有背景层之上、按距离一层一层排（近的在下），层距同束内间距；左右两侧同距离的两根共用一层（方向相反不相叠）。
     取消选中还原 */
  function liftMesh(slot) {
    var sv = boardStage.querySelector('svg[data-lift]'); if (!sv) return;
    var L = sv.getAttribute('data-lift').split(',').map(Number), AT0 = L[0], Y0 = L[1], bp = L[2];
    boardStage.querySelectorAll('.b-mesh[data-d0]').forEach(function (el) {
      el.setAttribute('d', el.getAttribute('data-d0')); el.removeAttribute('data-d0');
      var cs = el.previousElementSibling; if (cs && cs.classList.contains('lkc')) cs.setAttribute('d', el.getAttribute('d'));
    });
    if (slot == null) return;
    boardStage.querySelectorAll('.b-mesh.is-hot').forEach(function (el) {
      var ab = el.getAttribute('data-m').split(',').map(Number), xs = el.getAttribute('data-x').split(',').map(Number);
      var y = Y0 - Math.abs(ab[1] - ab[0]) * bp - bp;
      el.setAttribute('data-d0', el.getAttribute('d'));
      el.setAttribute('d', rp([[xs[0], AT0], [xs[0], y], [xs[1], y], [xs[1], AT0]], 2));
      var cs = el.previousElementSibling; if (cs && cs.classList.contains('lkc')) cs.setAttribute('d', el.getAttribute('d'));
    });
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
  var NO_FLOW_DOTS = true;
  function flowDots(slot) {
    var g = boardStage.querySelector('.b-flow'); if (!g) return;
    // 板视图不在台上（集群 / 单卡）时不留会动的点：藏着的 SVG 动画一样逐帧重绘
    if (slot == null || level !== 'board' || tier === 3) { if (g.firstChild) g.innerHTML = ''; return; }
    /* 顺线跑的珠子不画了：定格时它们就是一颗颗停在线中段的点，读不出是什么（反馈「有些点飘在不知道哪里」）；
       选中那颗 NPU 的线已经换成激活样式，「哪几根在走」不靠珠子说 */
    if (NO_FLOW_DOTS) { if (g.firstChild) g.innerHTML = ''; return; }
    var html = [];
    boardStage.querySelectorAll('.b-links .is-hot').forEach(function (el) {
      var d = el.tagName === 'line' ? 'M' + el.getAttribute('x1') + ',' + el.getAttribute('y1') + ' L' + el.getAttribute('x2') + ',' + el.getAttribute('y2') : el.getAttribute('d');
      var fast = !el.classList.contains('b-fan'), dur = fast ? 0.9 : 1.4;
      [0, dur / 2].forEach(function (off) {
        html.push('<circle class="lk-dot" r="1.7"><animateMotion dur="' + dur + 's" begin="-' + off + 's" repeatCount="indefinite" path="' + d + '"/></circle>');
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
    physZP.fitVB(+pod.getAttribute('x'), +pod.getAttribute('y'), +pod.getAttribute('width'), +pod.getAttribute('height'), 40, true);
    renderDataCards();
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
      physZP.fitVB(+box.getAttribute('x'), +box.getAttribute('y'), +box.getAttribute('width'), +box.getAttribute('height'), isPod ? 60 : 30, true);
      renderDataCards();
      return;
    }
    if (curSel != null) { showOverview(true); return; }
    physZP.reset(true);
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
  /* 端点：一颗比线略粗的实心小点，颜色跟线走。原来是「底色实心环 + 描边 + 中心点」的端口环，
     几根线收在同一颗 NPU 上时七八只环叠成一团，比线本身还重（反馈「端点太强势」）。
     markerUnits=strokeWidth，跟线宽一起缩放；汇接点（并进总线那头）同样是点，再淡一档。 */
  function lkDefs(p) {
    function port(id, col, r, op) {
      return '<marker id="' + p + id + '" viewBox="-3 -3 6 6" markerWidth="6" markerHeight="6" markerUnits="strokeWidth" refX="0" refY="0">'
        + '<circle r="' + r + '" fill="' + col + '" fill-opacity="' + op + '"/></marker>';
    }
    return '<defs>' + port('lkp', '#A0A0A0', 1.3, .85) + port('lkh', '#FFFFFF', 1.2, .9) + port('lkj', '#8A8A8A', 1.15, .8) + '</defs>';
  }
  /* 直角走线 + 圆角转弯（反馈「连线凌乱」「又有直线又有弧线」）：板视图所有连线统一成横平竖直，
     转角收 r 的小圆角；零长段、共线点先剔掉，同一列 / 同一条轨道上的线自然叠成一根 */
  function rp(pts, r) {
    var q = [pts[0]];
    for (var i = 1; i < pts.length; i++) { var a = q[q.length - 1]; if (a[0] !== pts[i][0] || a[1] !== pts[i][1]) q.push(pts[i]); }
    for (i = q.length - 2; i > 0; i--) { var u = q[i - 1], v = q[i], w = q[i + 1]; if ((u[0] === v[0] && v[0] === w[0]) || (u[1] === v[1] && v[1] === w[1])) q.splice(i, 1); }
    function f(n) { return Math.round(n * 10) / 10; }
    var d = 'M' + f(q[0][0]) + ',' + f(q[0][1]);
    for (i = 1; i < q.length - 1; i++) {
      var p0 = q[i - 1], p1 = q[i], p2 = q[i + 1];
      var d1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), d2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), rr = Math.min(r, d1 / 2, d2 / 2);
      d += ' L' + f(p1[0] - (p1[0] - p0[0]) / d1 * rr) + ',' + f(p1[1] - (p1[1] - p0[1]) / d1 * rr)
        + ' Q' + f(p1[0]) + ',' + f(p1[1]) + ' ' + f(p1[0] + (p2[0] - p1[0]) / d2 * rr) + ',' + f(p1[1] + (p2[1] - p1[1]) / d2 * rr);
    }
    var z = q[q.length - 1];
    return d + ' L' + f(z[0]) + ',' + f(z[1]);
  }
  var RC = 5;   // 圆角半径
  /* 板内 fullmesh 的线束排法（板视图与集群放大后原地展开的那块板共用）：
     ML(i, j) = NPU i 那一束里通往 j 的车道——套环顺序，近的伙伴在外道、远的在里道；
     MLV[i,j] = 这一对走第几层——按跨距从短到长依次放进最低一层、且不与这层已有横段相叠 */
  function meshPlan(NX, bp, extras) {
    /* 每颗 NPU 那一束（fullmesh 7 道 + extras：H2D、NIC 这类从远处来、最后才拐的线）按 laneMap 的通用规则排：
       近的伙伴先拐、在外道；H2D / NIC 最晚拐，自动落在束的正中间——两侧往外拐的 fullmesh 不会再横穿它们 */
    var LM = [];
    for (var n = 0; n < 8; n++) {
      var it = [];
      for (var m = 0; m < 8; m++) if (m !== n) it.push({ key: m, d: m < n ? -1 : 1, f: -Math.abs(m - n) });
      LM.push(laneMap(NX(n), it.concat(extras ? extras(n) : []), bp));
    }
    var ML = function (i, j) { return LM[i][j]; };
    var MLV = {}, lv = [], top = 0, pr = [];
    for (var a = 0; a < 8; a++) for (var b = a + 1; b < 8; b++) pr.push([a, b]);
    pr.sort(function (u, v) { return (u[1] - u[0]) - (v[1] - v[0]) || u[0] - v[0]; });
    pr.forEach(function (q) {
      var x0 = ML(q[0], q[1]), x1 = ML(q[1], q[0]), L = 0;
      while (lv[L] && lv[L].some(function (r) { return x0 < r[1] + bp && x1 > r[0] - bp; })) L++;
      (lv[L] = lv[L] || []).push([x0, x1]); MLV[q[0] + ',' + q[1]] = L; top = Math.max(top, L);
    });
    return { ML: ML, LM: LM, MLV: MLV, mTop: top };
  }
  /* 一束线的车道分配（通用规则，同 BMC bus-wiring）：往左拐的排在左、往右拐的排在右，**先拐出去的在外道**——
     束里的线拐出去时不横穿同束的其他线。items: { key, d: −1 左 / +1 右, f: 越大越先拐 }，返回 key → x */
  function laneMap(cx, items, pitch) {
    var L = items.filter(function (t) { return t.d < 0; }).sort(function (a, b) { return b.f - a.f; });
    var R = items.filter(function (t) { return t.d >= 0; }).sort(function (a, b) { return a.f - b.f; });
    var o = L.concat(R), m = {};
    o.forEach(function (t, n) { m[t.key] = cx + (n - (o.length - 1) / 2) * pitch; });
    return m;
  }
  function cased(el, cc) { return el.replace(/ class="[^"]*"/, ' class="' + (cc || 'lkc') + '"').replace(/ data-[nm]="[^"]*"/g, '').replace(/<title>[\s\S]*?<\/title>/, '') + el; }
  function buildBoardSvg(bIdx) {
    var W = 960, H = 590, base = bIdx * PHYS.board, pb = physOf(base);
    var NX = function (i) { return 152 + i * 100; };   // NPU/L1/L2 列中心 = 每颗器件图标的中线
    var NPUY = 194, NPUH = 58, L1Y = 340, L1H = 24, SWBY = 418, SWBH = 20, L2Y = 484, L2H = 30, CPUY = 58;   // 名字挪到图标下方后各行之间多留一截
    /* 端点只落在图元上（反馈「算中点的时候不要带上文字」「文字统一放在图标下方居中」）：
       每个器件图标居中、名字在图标正下方居中；从上面来的线接图标**顶边中点**，侧向的线接图标**左右边中点**
       （名字挪到下面之后两侧是空的），往下走的线从**名字下沿中点**出——不穿过字 */
    var AT = NPUY + 4, NB = NPUY + 57;   // NPU：图标顶边 / 名字下沿
    /* 上方三层走线轨道（由上到下）：H2D 分叉 · NIC 分叉 · fullmesh 7 层（跨距 d 的那一对走第 d 层）；
       NPU 顶边三个口：H2D 在左 −9、fullmesh 居中、NIC 在右 +9，互不共线 */
    /* 线束（参考 BMC bus-wiring：每根线一条自己的车道、平行不合并，线心间距约 1.8× 线宽，外包一圈底色描边）：
       NPU 顶边出 fullmesh 7 根一束、底边出 Clos 8 根一束，束内间距 BP；H2D、NIC 并进顶边那一束最左、最右两道（±4·BP），顶边 9 道等距 */
    var BP = 2.2, HFY = 128, NFY = 136;
    /* fullmesh：NPU i 那一束里通往 j 的车道。套环顺序——近的伙伴在外道、远的在里道：
       往左拐的从最左道起依次是 i−1、i−2 … 0，往右拐的从最右道起依次是 i+1 … 7，
       外道拐得低、里道拐得高，同一束里的线拐出去时互不横穿 */
    // H2D 从本 CPU 那边来（NPU 0–3 → CPU0、4–7 → CPU1），NIC 从本 NIC 那边来；NIC 轨道更低、先拐 → 两根里 NIC 在外
    var MP = meshPlan(NX, BP, function (n) {
      var cx = (NX(4 * (n >> 2) + 1) + NX(4 * (n >> 2) + 2)) / 2, nx = (NX(2 * (n >> 1)) + NX(2 * (n >> 1) + 1)) / 2;
      return [{ key: 'h', d: cx < NX(n) ? -1 : 1, f: -100 }, { key: 'n', d: nx < NX(n) ? -1 : 1, f: -99 }];
    }), ML = MP.ML, MLV = MP.MLV, mTop = MP.mTop;
    var MY = function (L) { return AT - 9 - L * BP; };   // 离开 NPU 先直走一截（束的「颈」）再分叉
    /* 下方：出板 Clos 8 条平面轨道（平面 k 走第 k 条）；NPU 列往下穿过全部轨道，L1 k 只从第 k 条落下 */
    var CY = function (k) { return (NB + L1Y) / 2 - 3.5 * BP + k * BP; };   // 8 条平面轨道，间距同束内，整组落在 NPU 行与 L1 行正中
    /* Clos：NPU i 那一束里去平面 k 的车道。往左拐的按 k 升序排在左边（最外道拐进最上面那条轨道），
       往右拐的按 k 降序排在右边（最外道 i+1 拐进它们当中最上面那条），本平面那一道居中、直落到 L1——束里的线拐出去互不横穿 */
    var CL = function (i, k) { var o = k <= i ? k : i + (7 - k) + 1; return NX(i) + (o - 3.5) * BP; };
    var bg = [], links = [], nodes = [], txt = [];
    var BOX_ICON = { 'b-cpu': 'hw-cpu', 'b-dpu': 'hw-dpu', 'b-nic': 'hw-nic', 'b-l1': 'hw-sw', 'b-nsw': 'hw-sw', 'b-swb': 'hw-sw' };
    // 图元在 48×36 viewBox 里实际画到哪（留白不算）：端点贴的是看得见的边
    var ICV = { 'hw-cpu': [2, 1, 46, 35], 'hw-nic': [3, 4, 45, 32], 'hw-dpu': [3, 4, 45, 32], 'hw-sw': [0, 3, 48, 26] };
    /* 部件：图标居中 + 名字在下。返回端口：x 图标中线，t / b 图标顶 / 底边，m 竖向中线，l / r 左右边，lb 名字下沿 */
    function box(cls, cx, y, w, h, label, title, attrs) {
      var ic = BOX_ICON[cls], ih = h - 6, iw = ih * 4 / 3, ix = cx - iw / 2, iy = y + 3, v = ICV[ic];
      nodes.push('<g class="' + cls + '"' + (attrs || '') + '><rect x="' + (cx - w / 2) + '" y="' + y + '" width="' + w + '" height="' + (h + 15) + '"/>'
        + '<use href="#' + ic + '" x="' + ix + '" y="' + iy + '" width="' + iw + '" height="' + ih + '"/>'
        + '<text x="' + cx + '" y="' + (y + h + 11) + '" text-anchor="middle">' + label + '</text>' + (title ? '<title>' + title + '</title>' : '') + '</g>');
      var t = iy + v[1] * ih / 36, b = iy + v[3] * ih / 36;
      return { x: cx, t: t, b: b, m: (t + b) / 2, l: ix + v[0] * iw / 48, r: ix + v[2] * iw / 48, lb: y + h + 15, ix: ix, iy: iy, iw: iw, ih: ih };   // 图标与名字之间留 5 左右
    }
    // 参数面 RoCE 总线（顶）：NIC 与 DPU 都从这儿出框
    links.push(cased('<line class="b-roce b-bus" x1="60" y1="22" x2="900" y2="22"/>'));
    txt.push('<text class="b-lbl b-lbl-roce" x="904" y="25">RoCE</text>');
    // CPU 行：DPU · NIC0 · CPU0 · NIC1 · NIC2 · CPU1 · NIC3 · SW
    var DP = box('b-dpu', 72, CPUY, 64, 22, 'DPU', 'DPU · PCIe 接 CPU0 · UB 上 L1 · RoCE 出框');
    links.push(cased('<line class="b-roce" x1="' + DP.x + '" y1="22" x2="' + DP.x + '" y2="' + DP.t + '"/>'));
    var SW = box('b-nsw', 905, CPUY + 1, 48, 22, 'SW', 'NIC 交换（POD 形态：SW 挂 4×NIC，每 NIC 2 口；每颗 CPU 1 口）');
    /* 进 NIC 交换的 6 根（NIC0 · CPU0 · NIC1 · NIC2 · CPU1 · NIC3，按源从左到右编号）：各走一条轨道、在 SW 顶边各占一道——
       最左的源走最上面那条、落进最右一道，一根套一根，不再并成一条横线 */
    var NSI = { nic: [0, 2, 3, 5], cpu: [1, 4] };
    function nswPath(sx0, sy0, idx) { var ty = 36 + idx * BP, lx = SW.x + (2.5 - idx) * BP; return rp([[sx0, sy0], [sx0, ty], [lx, ty], [lx, SW.t]], RC); }
    for (var k = 0; k < 4; k++) {
      var NC = box('b-nic', (NX(2 * k) + NX(2 * k + 1)) / 2, CPUY + 1, 58, 22, 'NIC' + k, 'NIC' + k + ' · 1 口 UB 挂 NPU' + (2 * k) + '/NPU' + (2 * k + 1) + ' · RoCE 出框', ' data-nic="' + k + '"');
      links.push(cased('<line class="b-roce" x1="' + NC.x + '" y1="22" x2="' + NC.x + '" y2="' + NC.t + '"/>'));
      // RDMA 端头：NIC 顶上一个空心环（hpc-topology-node 的 RDMA 端点画法）
      nodes.push('<circle class="b-rdma" cx="' + NC.x + '" cy="' + NC.t + '" r="3.2"/>');
      // NIC 交换（POD 形态图「SW 4*N · 2口/N」）：每张 NIC 2 口汇到右侧那颗小交换的顶边中点
      links.push(cased('<path class="b-nsw-l" d="' + nswPath(NC.x + 3 * BP, NC.t, NSI.nic[k]) + '"><title>NIC' + k + ' — NIC 交换 · 2 口</title></path>', 'lkc lkd'));
      // NIC 底边两道：左道去 NPU 2k（往左拐）、右道去 NPU 2k+1（往右拐），同一条轨道、方向相反不相叠
      [2 * k, 2 * k + 1].forEach(function (i, s9) {
        var lx = NC.x + (s9 - 0.5) * BP;
        links.push(cased('<path class="b-nicl" data-n="' + i + '" d="' + rp([[lx, NC.lb], [lx, NFY], [MP.LM[i].n, NFY], [MP.LM[i].n, AT]], RC) + '"><title>NIC' + k + ' — NPU' + i + ' · UB 1 口</title></path>', 'lkc lkd'));
      });
    }
    var CPB = [];
    var CP = [0, 1].map(function (c) {
      var A = box('b-cpu', (NX(4 * c + 1) + NX(4 * c + 2)) / 2, CPUY, 110, 34, 'CPU' + c, 'CPU' + c + ' · H2D 每 NPU 2 口 UB（x86 走 4 口 PCIe SW）· 8 口 UB 上 L1', ' data-cpu="' + c + '"');
      /* CPU 底边一束：CPU0 = PCIe · UB · H2D 0 1 2 3，CPU1 = H2D 4 5 6 7 · UB（从左到右）。往左拐的外道拐得早、往右拐的外道拐得早，
         束里拐出去互不横穿；lane(o) 是第 o 道，yy(n) 是第 n 条轨道 */
      var nL = c ? 5 : 6, lane = function (o) { return A.x + (o - (nL - 1) / 2) * BP; }, yy = function (n) { return HFY - 14 + n * BP; };
      CPB[c] = { lane: lane, yy: yy };
      var H2 = c ? [[0, 0], [1, 1], [2, 2], [3, 1]] : [[2, 2], [3, 3], [4, 1], [5, 0]];   // [车道, 轨道]
      for (var i = 4 * c; i < 4 * c + 4; i++) { var h2 = H2[i - 4 * c], hx = lane(h2[0]), hy = yy(h2[1]);
        links.push(cased('<path class="b-h2d" data-n="' + i + '" d="' + rp([[hx, A.lb], [hx, hy], [MP.LM[i].h, hy], [MP.LM[i].h, AT]], RC) + '"><title>CPU' + c + ' — NPU' + i + ' · H2D · UB 2 口</title></path>', 'lkc lkd')); }
      links.push(cased('<path class="b-nsw-l" d="' + nswPath(A.x, A.t, NSI.cpu[c]) + '"><title>CPU' + c + ' — NIC 交换 · 1 口</title></path>', 'lkc lkd'));
      return A;
    });
    txt.push('<text class="b-lbl" x="' + SW.x + '" y="' + (CPUY + 50) + '" text-anchor="middle">1口/C · 2口/N</text>');
    // CPU0 右边中点 ↔ CPU1 左边中点：直角绕上去，从 NIC1 / NIC2 头顶越过
    var CCY = 32;
    links.push(cased('<path class="b-cpul" d="' + rp([[CP[0].r, CP[0].m], [CP[0].r + 12, CP[0].m], [CP[0].r + 12, CCY], [CP[1].l - 12, CCY], [CP[1].l - 12, CP[1].m], [CP[1].l, CP[1].m]], RC) + '"><title>CPU0 — CPU1 互联</title></path>'));
    txt.push('<text class="b-lbl" x="' + ((CP[0].x + CP[1].x) / 2) + '" y="' + (CCY + 3) + '" text-anchor="middle">CPU↔CPU</text>');   // 骑在横段上
    // L1 行（每平面一颗）：先定位置，左右两根 UB 干线要接它们的侧边中点
    var L1A = [];
    for (var k3 = 0; k3 < 8; k3++) L1A.push(box('b-l1', NX(k3), L1Y, 64, L1H, 'P' + (k3 + 1), 'L1 灵衢 SW · 平面 ' + (k3 + 1) + ' · 4 口 → 本平面 4×SW2', ' style="--pc:' + PLANE_C[k3] + '"'));
    /* 状态点（10.14，照 hpc-topology-node：状态色嵌在图元体内——交换机是「首个端口点」变色，不另浮标记）：
       L1 承载 POD 内的 EP All-to-All，路由失衡超告警线时首个端口点亮琥珀；平时不画 */
    L1A.forEach(function (A) {
      nodes.push('<rect class="b-led" x="' + (A.ix + A.iw / 48) + '" y="' + (A.iy + 10 * A.ih / 36) + '" width="' + (2 * A.iw / 48) + '" height="' + (2 * A.ih / 36) + '" rx="0.4"/>');
    });
    // DPU —PCIe— CPU0（两头都从名字下沿出）；DPU/CPU0 —UB— L1 P1 左边中点（走左边沿）；CPU1 —UB— L1 P8 右边中点（走右边沿）
    /* DPU 底边两道（UB 在左往左拐、PCIe 在右往右拐）；CPU0 束最左两道是 PCIe、UB。DPU 与 CPU0 的 UB 各走各的：
       DPU 在外（x=20、从下面进 P1），CPU0 在里（x=20+BP、从上面进 P1），不再在半路并成一根 */
    var C0 = CPB[0], PCY = C0.yy(0);
    links.push(cased('<path class="b-pcie" d="' + rp([[DP.x + BP / 2, DP.lb], [DP.x + BP / 2, PCY], [C0.lane(0), PCY], [C0.lane(0), CP[0].lb]], RC) + '"><title>DPU — CPU0 · PCIe</title></path>'));
    txt.push('<text class="b-lbl" x="' + (DP.x + 42) + '" y="' + (PCY - 3) + '" text-anchor="middle">PCIe</text>');
    links.push(cased('<path class="b-ub" d="' + rp([[DP.x - BP / 2, DP.lb], [DP.x - BP / 2, PCY], [20, PCY], [20, L1A[0].m + BP / 2], [L1A[0].l, L1A[0].m + BP / 2]], RC) + '"><title>DPU — L1 · UB</title></path>'));
    links.push(cased('<path class="b-ub" d="' + rp([[C0.lane(1), CP[0].lb], [C0.lane(1), C0.yy(1)], [20 + BP, C0.yy(1)], [20 + BP, L1A[0].m - BP / 2], [L1A[0].l, L1A[0].m - BP / 2]], RC) + '"><title>CPU0 — L1 · UB</title></path>'));
    var C1 = CPB[1];
    links.push(cased('<path class="b-ub" d="' + rp([[C1.lane(4), CP[1].lb], [C1.lane(4), C1.yy(0)], [940, C1.yy(0)], [940, L1A[7].m], [L1A[7].r, L1A[7].m]], RC) + '"><title>CPU1 — L1 · UB</title></path>'));
    txt.push('<text class="b-lbl" x="14" y="' + ((CPUY + L1Y) / 2) + '" text-anchor="middle" transform="rotate(-90 14 ' + ((CPUY + L1Y) / 2) + ')">UB → L1</text>');
    txt.push('<text class="b-lbl" x="946" y="' + ((CPUY + L1Y) / 2) + '" text-anchor="middle" transform="rotate(90 946 ' + ((CPUY + L1Y) / 2) + ')">UB → L1</text>');
    // NPU 行 + 板内 fullmesh（弧在行上方）：图标居中，rank 号放在图标下方
    for (var i = 0; i < 8; i++) {
      var r = base + i; if (r >= world) break;
      nodes.push('<g class="b-npug"><rect class="p-npu p-bnpu" data-rank="' + r + '" data-slot="' + i + '" data-pp="' + coordOfRank(r).pp + '" x="' + (NX(i) - 32) + '" y="' + NPUY + '" width="64" height="' + NPUH + '"><title>NPU' + i + ' · rank ' + r + ' · ' + coordLine(r) + '</title></rect>'
        + '<use class="b-npuicon" href="#hw-npu" x="' + (NX(i) - 18) + '" y="' + (NPUY + 4) + '" width="36" height="27"/>'
        + '<rect class="b-npustrip" x="' + (NX(i) - 14) + '" y="' + (NPUY + 34) + '" width="28" height="3"/>'
        + '<rect class="b-relf" x="' + (NX(i) - 21) + '" y="' + (NPUY + 1) + '" width="42" height="33" rx="7.5"/>'   // 连带选中框：同组成员
        + '<text class="b-npul" x="' + NX(i) + '" y="' + (NPUY + 53) + '" text-anchor="middle">' + r + '</text></g>');   // 只写全局 rank 号；板内槽号（npuN）只进悬停
      for (var j = i + 1; j < 8; j++) {
        var ly = MY(MLV[i + ',' + j]);
        links.push(cased('<path class="b-mesh" data-m="' + i + ',' + j + '" data-x="' + ML(i, j).toFixed(1) + ',' + ML(j, i).toFixed(1) + '" d="' + rp([[ML(i, j), AT], [ML(i, j), ly], [ML(j, i), ly], [ML(j, i), AT]], 2) + '"/>', 'lkc lkd'));
      }
    }
    // 各层走线的名字统一收在左侧留白里、右对齐，不压在线上
    var LX = NX(0) - 42;
    txt.push('<text class="b-lbl b-lbl-mesh" x="' + LX + '" y="' + ((MY(0) + MY(mTop)) / 2 + 3) + '" text-anchor="end">fullmesh 7×X4</text>');
    // 出板：每颗 NPU 8 口（名字下沿中点出），每口一颗 L1（每平面一颗，接图标顶边中点）
    for (var i2 = 0; i2 < 8; i2++) for (var k2 = 0; k2 < 8; k2++) {
      if (base + i2 >= world) break;
      links.push(cased('<path class="b-fan" data-n="' + i2 + '" style="--pc:' + PLANE_C[k2] + '" d="' + rp(i2 === k2 ? [[CL(i2, k2), NB], [CL(i2, k2), L1A[k2].t]] : [[CL(i2, k2), NB], [CL(i2, k2), CY(k2)], [CL(k2, k2), CY(k2)], [CL(k2, k2), L1A[k2].t]], 2) + '"/>', 'lkc lkd'));
    }
    txt.push('<text class="b-lbl" x="' + LX + '" y="' + ((CY(0) + CY(7)) / 2 + 3) + '" text-anchor="end">Clos 8×X4</text>');
    /* L1 底边一束 6 道：去本平面 4×SW2（q0–q3）+ 去交换板 A / B。往左拐的外道在左、往右拐的外道在右；
       去交换板的拐得早（外道），去 SW2 的一直落到平面上方才分叉（里道） */
    function L1L(k9, t) {
      var ord = k9 <= 1 ? ['q0', 'q1', 'q2', 'q3', 'B', 'A'] : k9 >= 6 ? ['A', 'B', 'q0', 'q1', 'q2', 'q3'] : ['A', 'q0', 'q1', 'q2', 'q3', 'B'];
      return NX(k9) + (ord.indexOf(t) - 2.5) * BP;
    }
    // 去交换板的 16 根各走一条轨道：同一块交换板从同一侧来的，越远的越靠下、落进越外的那道（交换板顶边 8 道，第 k 道接 L1 k）
    function swbY(k9, si) { var lv = si ? (k9 <= 5 ? 5 - k9 : k9 - 6) : (k9 <= 1 ? 1 - k9 : k9 - 2); return L1Y + L1H + 20 + (si ? 6 + lv : lv) * BP; }
    // L1 → 本平面 4×SW2（L2）
    for (k3 = 0; k3 < 8; k3++) {
      bg.push('<rect class="b-plane" style="--pc:' + PLANE_C[k3] + '" x="' + (NX(k3) - 32) + '" y="' + L2Y + '" width="64" height="' + L2H + '"><title>L2 · 平面 ' + (k3 + 1) + ' · 4×SW2 · 与本平面每颗 L1 成 Clos</title></rect>');
      for (var q = 0; q < 4; q++) {
        var qx = NX(k3) - 24 + q * 16, lx9 = L1L(k3, 'q' + q), ty9 = L2Y - 14 - (q === 0 || q === 3 ? BP : 0);   // 外道（q0 / q3）先拐
        bg.push('<rect class="b-sw2" style="--pc:' + PLANE_C[k3] + '" x="' + (qx - 4) + '" y="' + (L2Y + L2H - 11) + '" width="10" height="6"/>');
        links.push(cased('<path class="b-l12" style="--pc:' + PLANE_C[k3] + '" d="' + rp([[lx9, L1A[k3].lb], [lx9, ty9], [qx + 1, ty9], [qx + 1, L2Y + L2H - 11]], 3) + '"/>', 'lkc lkd'));
      }
      txt.push('<text class="b-lbl b-lbl-plane" x="' + NX(k3) + '" y="' + (L2Y + 12) + '" text-anchor="middle">P' + (k3 + 1) + '</text>');
      links.push(cased('<line class="b-ub b-out" x1="' + NX(k3) + '" y1="' + (L2Y + L2H) + '" x2="' + NX(k3) + '" y2="' + (L2Y + L2H + 22) + '"/>'));
    }
    txt.push('<text class="b-lbl" x="' + LX + '" y="' + (L2Y + L2H / 2 + 3) + '" text-anchor="end">框间 4×X4</text>');
    /* 框内 L2「交换板」（POD 形态图：L2 层 2*SW + 2*SW，每颗 L1 出 4 口，作框内板间互联；
       同一块交换板配成 8 口时也可以出框）。本页的 1024P 组网按第一页「单层 SW 出框」画，
       交换板这一层画在 L1 与平面之间，只连 L1、两侧短线表示它通向框内其他板。 */
    [(NX(1) + NX(2)) / 2, (NX(5) + NX(6)) / 2].forEach(function (sx, si) {
      var SB = box('b-swb', sx, SWBY, 76, SWBH, '2×SW', '框内 L2 交换板 ' + (si ? 'B' : 'A') + ' · 2×SW · 每颗 L1 4 口 · 框内 Board 间互联（配 8 口时可出框）');
      for (var k4 = 0; k4 < 8; k4++) { var sl = L1L(k4, si ? 'B' : 'A'), sy9 = swbY(k4, si), sbx = SB.x + (k4 - 3.5) * BP;
        links.push(cased('<path class="b-swbl" d="' + rp([[sl, L1A[k4].lb], [sl, sy9], [sbx, sy9], [sbx, SB.t]], 3) + '"/>', 'lkc lkd')); }
      links.push(cased('<line class="b-swbx" x1="' + (si ? SB.r : SB.l) + '" y1="' + SB.m + '" x2="' + (si ? 948 : 12) + '" y2="' + SB.m + '"><title>交换板 → 框内其他板</title></line>'));
    });
    txt.push('<text class="b-lbl" x="' + ((NX(3) + NX(4)) / 2) + '" y="' + (SWBY + 14) + '" text-anchor="middle">框内 4口 · 交换板</text>');
    // 底部总线不加衬边：上面落下来的 8 根短线要在它身上汇成一排汇接点，衬边会把接点切掉
    links.push('<line class="b-ub b-bus" x1="60" y1="' + (L2Y + L2H + 22) + '" x2="' + (NX(3) + 40) + '" y2="' + (L2Y + L2H + 22) + '"/>'
      + '<line class="b-uboe b-bus" x1="' + (NX(4) - 40) + '" y1="' + (L2Y + L2H + 22) + '" x2="900" y2="' + (L2Y + L2H + 22) + '"/>');
    txt.push('<text class="b-lbl b-lbl-ub" x="60" y="' + (L2Y + L2H + 36) + '">UB → POD</text>'
      + '<text class="b-lbl b-lbl-uboe" x="900" y="' + (L2Y + L2H + 36) + '" text-anchor="end">UBoE → SuperPoD</text>');
    /* 连线上的数据（10.13）：四个槽位，对应四级闭合——板内（fullmesh）· POD（出板 Clos）· SP（L2 UB 总线）· 跨 SP（UBoE 总线）。
       每个槽位放在那一类线旁边一块空着的地方（不压线、不挪版式），文字由 boardLinkLabels 按当前配置填 */
    var ZX = (NX(3) + NX(4)) / 2, BUSY = L2Y + L2H + 22;
    [[0, ZX, MY(mTop) - 8 * BP - 4], [1, ZX, CY(7) + 9], [2, (NX(1) + NX(2)) / 2, BUSY - 4], [3, (NX(5) + NX(6)) / 2, BUSY - 4]].forEach(function (q) {
      txt.push('<text class="b-dlbl" data-lv="' + q[0] + '" x="' + q[1] + '" y="' + q[2] + '" text-anchor="middle"></text>');
    });
    // 选中时把那颗 NPU 的 fullmesh 抬到最上面一组连续轨道（见 liftMesh）：这里记下起点与层距
    return '<svg class="near" data-lift="' + AT + ',' + MY(mTop) + ',' + BP + '" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' + lkDefs('b-')
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
        /* 虚线段长同样按屏幕像素定（--zdash: 实 空，单位 px）：缩放时段长不跟着变，任何倍数下虚线疏密一致 */
        var zd = (r.style.getPropertyValue('--zdash') || '').trim();
        if (zd) ZK_RULES.push({ sel: r.selectorText, dash: zd.split(/\s+/).map(Number) });
        /* 字号按屏幕像素定（--zfs: px）：标签不随缩放变大变小（审计：3× 时 UBoE / SP 标签比 POD、NPU 字大出一截；板视图数据标签铺满时只有 3px） */
        var zf = parseFloat(r.style.getPropertyValue('--zfs'));
        if (zf) ZK_RULES.push({ sel: r.selectorText, fs: zf });
      });
    });
  }
  function setZoomStroke(stage, k) {
    if (!stage.id) return;
    var kk = Math.pow(1.15, Math.round(Math.log(k) / Math.log(1.15)));   // ×1.15 一档：同一档内不重写样式表
    if (zkLast[stage.id] === kk) return;
    zkLast[stage.id] = kk;
    if (!ZK_RULES) collectZkRules();
    zkText[stage.id] = ZK_RULES.map(function (r) {
      var sel = r.sel.split(',').map(function (x) { return '#' + stage.id + ' ' + x.trim(); }).join(', ');
      if (r.dash) return sel + ' { stroke-dasharray: ' + r.dash.map(function (d) { return (d / kk).toFixed(3); }).join(' ') + '; }';
      if (r.fs) return sel + ' { font-size: ' + (r.fs / kk).toFixed(3) + 'px; }';
      return sel + ' { stroke-width: ' + (r.px / kk).toFixed(3) + 'px' + (r.imp ? ' !important' : '') + '; }';
    }).join('\n');
    zkSheet.textContent = Object.keys(zkText).map(function (id) { return zkText[id]; }).join('\n');
  }
  // 系统设置了「减少动态效果」就不飞镜头、不做卡片入场，直接落到终态
  var REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
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
    /* 逐帧看过：放大到一个 POD 那一下卡 3 秒——apply 里换了线宽样式表、切了 lod 类，紧接着 markSelFrame 的 getBBox
       与 placeSelLabel 的 getBoundingClientRect 在同一个处理函数里把四万个图元的样式重算强制同步做完。现在：
         · 变换本身立刻写（合成器路径，不重算样式）；
         · 线宽样式表按 ×1.15 一档量化，滚轮 / 拖动进行中不写，停手 120ms 后写一次；
         · 选中框与标注挪到下一帧，跟浏览器本来就要做的那次样式计算合并。 */
    var strokeT = 0, frameQ = false;
    function apply() {
      var s = svg(); if (!s) return;
      s.style.transformOrigin = '0 0'; s.style.transform = 'translate(' + st.tx + 'px,' + st.ty + 'px) scale(' + st.k + ')';
      /* 无限画布的点阵底（反馈「无限画布加点状背景，淡一些」）：点跟着画布平移 / 缩放一起走；间距 = 24px × 缩放，
         按 2 的幂折回 [20, 40) 之间——放大、缩小都不会糊成一片或稀到看不见（Figma 那种画法） */
      var sp = 24 * st.k; while (sp >= 40) sp /= 2; while (sp < 20) sp *= 2;
      var bx = ((st.tx % sp) + sp) % sp, by = ((st.ty % sp) + sp) % sp;
      stage.style.setProperty('--dot-s', sp.toFixed(2) + 'px'); stage.style.setProperty('--dot-x', bx.toFixed(1) + 'px'); stage.style.setProperty('--dot-y', by.toFixed(1) + 'px');
      clearTimeout(strokeT);
      if (st.gesture) strokeT = setTimeout(function () { st.gesture = false; setZoomStroke(stage, st.k); if (stage === physStage) { ensurePodDetail(st); if (curSel != null) markSelFrame(stage); } }, 120);
      else setZoomStroke(stage, st.k);
      /* 飞行途中细节档取起止两端里较低的那一档：拉远一起飞就换成轻的画法（逐帧画的是轻图），推近则保持轻的画法到落地再加细节。
         中途不切档——切一次就是四万个图元重算样式 */
      var lk = st.flying ? st.flyLodK : st.k;
      if (s.classList.contains('lod1') !== (lk >= 3)) s.classList.toggle('lod1', lk >= 3);
      if (s.classList.contains('lod2') !== (lk >= 6)) s.classList.toggle('lod2', lk >= 6);
      var zr = lk / (st.kFit || 1);   // 板视图连线上的小数据标签：相对「铺满」那一档放大到 1.5× 起出现
      if (s.classList.contains('lodz') !== (zr >= 1.5)) s.classList.toggle('lodz', zr >= 1.5);
      if (!frameQ) { frameQ = true; requestAnimationFrame(function () { frameQ = false; if (stage === physStage && !st.gesture) ensurePodDetail(st); if (curSel != null) markSelFrame(stage); placeSelLabel(); }); }
    }
    /* 画布铺满整个视口（反馈「左边不要做成单独的面板，卡片悬浮在画布上、毛玻璃、不遮挡后面」），
       四周的卡是半透明悬浮的；取景时把内容摆进卡与卡之间那块「安全区」的正中，初始/复位也一样。 */
    st.reset = function (anim, done) { var s = svg(); if (!s) { st.k = 1; st.tx = 0; st.ty = 0; apply(); return; } var vb = s.viewBox.baseVal; st.fitVB(vb.x, vb.y, vb.width, vb.height, 0, anim, function () { st.kFit = st.k; apply(); if (done) done(); }); };
    /* ── 镜头飞行（层级串联动画）：取景不再一帧跳过去，而是 ~480ms 缓入缓出飞过去。
       缩放按对数插值、屏幕中心对着的那一点按线性插值——放大缩小的速度感均匀，不会前半段猛冲。
       飞行中走手势那条路：线宽样式表与 LOD 不逐帧切，落地后一次切完；reduced-motion 下直接落地。 */
    /* 合成层只在一次推近飞行期间存在：任何新的飞行 / 直接取景开始前先撤掉上一只（被打断的飞行不会跑到自己的收尾，
       漏掉的合成层会把光栅比例钉在高倍，下一次拉远就是整张图按高倍重画——逐帧看过，3.9 秒） */
    function dropLayer() { if (st.layer) { st.layer.style.willChange = ''; st.layer = null; } }
    st.fly = function (k1, tx1, ty1, dur, done) {
      cancelAnimationFrame(st.flyRaf); dropLayer();
      if (REDUCED || !dur) { st.k = k1; st.tx = tx1; st.ty = ty1; st.flying = false; apply(); if (done) done(); return; }   // dropLayer 已在上面做过
      var R = st.rect(), cx = R.width / 2, cy = R.height / 2, k0 = st.k;
      var p0x = (cx - st.tx) / k0, p0y = (cy - st.ty) / k0, p1x = (cx - tx1) / k1, p1y = (cy - ty1) / k1, t0 = performance.now();
      st.flying = true; st.gesture = true; st.flyLodK = Math.min(k0, k1);
      /* 推近时把 SVG 提成合成层：合成器按起飞时的比例光栅化一次、之后直接放大位图，不逐帧重画四万个图元；落地后撤掉，
         按新比例清晰重画一次。拉远不提：合成层的光栅比例会钉在起飞时的高倍，拉远到全图等于按高倍把整张图光栅一遍（逐帧看过，2.8 秒） */
      if (k1 > k0 * 1.05) { st.layer = svg(); if (st.layer) st.layer.style.willChange = 'transform'; }
      (function step(now) {
        var u = Math.min(1, (now - t0) / dur), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
        var k = k0 * Math.pow(k1 / k0, e), px = p0x + (p1x - p0x) * e, py = p0y + (p1y - p0y) * e;
        st.k = k; st.tx = cx - k * px; st.ty = cy - k * py;
        if (u >= 1) { st.k = k1; st.tx = tx1; st.ty = ty1; st.flying = false; st.flyRaf = 0; dropLayer(); apply(); if (done) done(); return; }
        apply(); st.flyRaf = requestAnimationFrame(step);
      })(t0);
    };
    /* 下钻的「推近」：把选中那一格挪到安全区正中、镜头再推近 factor 倍（推之前的镜头由 trail 记，见「层级串联」） */
    st.pushTo = function (x, y, w, h, factor, dur) {
      var s = svg(); if (!s) return;
      var vb = s.viewBox.baseVal, R = st.rect(), m = Math.min(R.width / vb.width, R.height / vb.height);
      var ox = (R.width - vb.width * m) / 2, oy = (R.height - vb.height * m) / 2, S = safeArea(R);
      var pcx = ox + (x + w / 2 - vb.x) * m, pcy = oy + (y + h / 2 - vb.y) * m, k1 = Math.min(16, st.k * factor);
      st.fly(k1, S.x + S.w / 2 - k1 * pcx, S.y + S.h / 2 - k1 * pcy, dur);
    };
    /* 把 viewBox 里的一块区域 (vx,vy,vw,vh) 飞到屏幕上的一个矩形 (sx,sy,sw,sh)：按宽度对齐、竖直居中——进板的「接缝」用 */
    st.flyToRect = function (vx, vy, vw, vh, sx, sy, sw, sh, dur, done) {
      var s = svg(); if (!s) { if (done) done(); return; }
      var vb = s.viewBox.baseVal, R = st.rect(), m = Math.min(R.width / vb.width, R.height / vb.height);
      var ox = (R.width - vb.width * m) / 2, oy = (R.height - vb.height * m) / 2;
      var bx0 = ox + (vx - vb.x) * m, by = oy + (vy + vh / 2 - vb.y) * m, k = Math.min(16, sw / (vw * m));
      st.auto = false; st.fly(k, sx - R.left - k * bx0, sy - R.top + sh / 2 - k * by, dur, done);
    };
    st.cam = function () { return { k: st.k, tx: st.tx, ty: st.ty, auto: st.auto, last: st.last }; };
    st.flyToCam = function (c, dur) { st.auto = c.auto; st.last = c.last; st.fly(c.k, c.tx, c.ty, dur); };
    // 读者自己动手（滚轮 / 拖动）就打断正在飞的镜头，从当前位置接手
    st.stopFly = function () { if (st.flyRaf) { cancelAnimationFrame(st.flyRaf); st.flyRaf = 0; st.flying = false; dropLayer(); } };
    st.zoomAt = function (f, px, py) {
      st.stopFly(); st.auto = false;
      var k2 = Math.min(16, Math.max(0.4, st.k * f)); f = k2 / st.k;
      st.tx = px - (px - st.tx) * f; st.ty = py - (py - st.ty) * f; st.k = k2; apply();
    };
    /* 按 viewBox 坐标取景（不量 DOM 矩形：舞台切换时 .is-hidden 的 scale 过渡
       会把矩形量歪）：先算 meet 缩放下这块区域落在盒子里的像素位置，再解出
       让它居中撑满的 k/tx/ty。 */
    st.fitVB = function (x, y, w, h, pad, anim, done) {
      var s = svg(); if (!s) return;
      var vb = s.viewBox.baseVal, R = st.rect();
      var m = Math.min(R.width / vb.width, R.height / vb.height);
      var ox = (R.width - vb.width * m) / 2, oy = (R.height - vb.height * m) / 2;
      var px = ox + (x - vb.x) * m, py = oy + (y - vb.y) * m, pw = w * m, ph = h * m, S = safeArea(R);
      var k = Math.min(16, Math.max(0.2, Math.min((S.w - pad * 2) / pw, (S.h - pad * 2) / ph)));
      var tx1 = S.x + S.w / 2 - k * (px + pw / 2), ty1 = S.y + S.h / 2 - k * (py + ph / 2);
      st.last = [x, y, w, h, pad]; st.auto = true;
      if (anim) st.fly(k, tx1, ty1, 480, done);
      else { cancelAnimationFrame(st.flyRaf); dropLayer(); st.flying = false; st.k = k; st.tx = tx1; st.ty = ty1; apply(); if (done) done(); }
    };
    /* 面板开合 / 窗口变化后安全区变了：用户没手动缩放拖动过，就按上一次的取景目标重新摆正；
       手动动过就不抢镜头。 */
    st.refit = function () { if (st.auto && st.last) st.fitVB.apply(null, st.last); };
    stage.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var R = st.rect();
      st.gesture = true;
      st.zoomAt(Math.exp(-ev.deltaY * 0.0015), ev.clientX - R.left, ev.clientY - R.top);
    }, { passive: false });
    stage.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      st.stopFly();
      st.drag = { x: ev.clientX, y: ev.clientY, tx: st.tx, ty: st.ty }; st.moved = false;
    });
    window.addEventListener('pointermove', function (ev) {
      if (!st.drag) return;
      var dx = ev.clientX - st.drag.x, dy = ev.clientY - st.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) st.moved = true;
      if (st.moved) { st.auto = false; st.tx = st.drag.tx + dx; st.ty = st.drag.ty + dy; apply(); }
    });
    window.addEventListener('pointerup', function () { if (st.drag && st.moved && stage === physStage) ensurePodDetail(st); st.drag = null; });
    stage.addEventListener('click', function (ev) { if (st.moved) { ev.stopPropagation(); ev.preventDefault(); st.moved = false; } }, true);
    stage.addEventListener('dblclick', function (ev) { if (!ev.target.closest('.p-npu, .u-leaf, .p-pod, .p-board, .u-hub')) st.reset(); });
    return st;
  }
  var physZP = attachZoomPan(physStage), boardZP = attachZoomPan(boardStage);
  (function () { var r0 = physZP.reset; physZP.reset = function (anim, done) { fitPod = null; if (trail && trail.zp === physZP) trail = null; physStage.querySelectorAll('.p-pod.is-fit').forEach(function (el) { el.classList.remove('is-fit'); }); r0(anim, done); if (typeof renderDataCards === 'function') renderDataCards(); }; })();
  function curZP() { return level === 'board' ? boardZP : physZP; }

  // ── 底部工具条：缩放 + 三个参考抽屉 ─────────────────────────────────────
  var DRAWERS = {
    netgraph: { title: 'Network Graph', src: function () { return engineSrc(ENG_NG, splitParams({ embed: '1', theme: 'dark' })); } },
    /* 泳道：原来嵌的是 compute-graph-viewer 的上游拷贝，画的是它自己那份 32 卡示例（PP4·TP2·EP2），
       段号、rank 号都对不上本预置，联动不起来。反馈「修改泳道的数据，让它也能和集群联动」——换成本页原生：
       按当前预置（PP、GA、每段层数）算一步 1F1B 调度，见 renderSwim。 */
    swimlane: { title: 'Swimlane', native: true },
    rubik: { title: 'Logical Cube', src: function () { return rubikSrc; } },
    hier: { title: 'Hierarchy', native: true }
  };
  /* 三个参考面板不悬浮在画布上，而是像 combo-workbench 的槽位那样占一边、把
     画布挤过去：泳道图在下方（一条横向的时间轴，天然横着放），整网图在右侧，
     逻辑魔方在左侧。哪一边开着，那一边的悬浮卡/链路就让位（CSS 按 body 上的
     panel-* 类收起），.zp-box 的内边距同步收缩，画布始终完整可见、不被压。 */
  var DRAWER_POS = { netgraph: 'bottom', swimlane: 'bottom', rubik: 'right', hier: 'right' };
  var PANEL_W0 = { rubik: 0.4, hier: 372 };
  /* 下方面板各自的默认高度：泳道只有几条道，矮一点；整网图要看层结构，高一点 */
  var PANEL_H0 = { swimlane: 270, netgraph: 0.46 };
  var drawerOpen = null;
  function openDrawer(key) {
    ['at-left', 'at-right', 'at-bottom'].forEach(function (c) { drawer.classList.remove(c); });
    ['panel-left', 'panel-right', 'panel-bottom'].forEach(function (c) { document.body.classList.remove(c); });
    if (drawerOpen === key || !key) {
      drawerOpen = null; drawer.classList.add('is-hidden');
    } else {
      drawerOpen = key; drawerTitle.textContent = DRAWERS[key].title;
      var nat = !!DRAWERS[key].native;
      /* 逻辑魔方自己的模型要求 EP 整除 DP（它把 EP 折进 DP 轴）；矩阵本体不要求（EP 在 tp·cp·dp 拉平后连号取）。
         切分改到魔方画不了的组合时，面板直说，不去加载一个会报错的魔方。 */
      var cubeNo = key === 'rubik' && PS.dp % PS.ep !== 0;
      drawerFrame.style.display = nat || cubeNo ? 'none' : ''; drawerBody.hidden = !(nat || cubeNo);
      if (cubeNo) drawerBody.innerHTML = '<div class="sw-wait">Logical Cube 要求 EP 整除 DP：当前 ep' + PS.ep + ' · dp' + PS.dp + '，画不了</div>';
      else if (nat) renderPanel();
      else if (!cubeNo) { var src = DRAWERS[key].src(); if (drawerFrame.getAttribute('src') !== src) drawerFrame.src = src; }
      drawer.classList.add('at-' + DRAWER_POS[key]); document.body.classList.add('panel-' + DRAWER_POS[key]);
      applyPanelHeight(); applyPanelWidth();
      drawer.setAttribute('data-panel', key);
      drawer.classList.remove('is-hidden');
    }
    dock.querySelectorAll('[data-drawer]').forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-drawer') === drawerOpen); });
    syncCardHeights(); curZP().refit(); syncLinked(true); requestAnimationFrame(function () { requestAnimationFrame(syncOverFade); });
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
      document.body.classList.remove('is-resizing'); curZP().refit(); renderPanel();
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
    if (to === 'root') { trail = null; physZP.reset(true); showOverview(); }
    else if (to === 'board') goBoard(cr.hasAttribute('data-b') ? +cr.getAttribute('data-b') : curBoard, true);
    else if (to === 'rank') showTier2(curSel, pendingSubLine || coordLine(curSel));
  });
  var crumbN = 1;
  /* 大标题排版（反馈「大标题的字体字号不太好看」）：模型名拆成主名 + 规格小标——
     「MoE 504B(A18B)·32K序列」→ 主名「MoE 504B」大一号、字重高一档；「A18B · 32K 序列」小一号、浅一档。
     拉丁与汉字之间补半角空格，括号与间隔点统一成「 · 」。没有括号 / 间隔点的名字原样当主名。 */
  function titleHtml(name) {
    name = String(name || ''); var main = name, rest = [], k = name.search(/[(（]/);
    if (k > 0) {
      var e = name.slice(k + 1).search(/[)）]/), inner = e >= 0 ? name.slice(k + 1, k + 1 + e) : name.slice(k + 1);
      var after = e >= 0 ? name.slice(k + 2 + e).replace(/^\s*[·・]\s*/, '') : '';
      main = name.slice(0, k); rest = [inner, after];
    } else if ((k = name.indexOf('·')) > 0) { main = name.slice(0, k); rest = [name.slice(k + 1)]; }
    var meta = rest.filter(function (x) { return x && x.trim(); }).map(function (x) { return x.trim(); }).join(' · ');
    meta = meta.replace(/([0-9A-Za-z])([\u4e00-\u9fff])/g, '$1 $2').replace(/([\u4e00-\u9fff])([0-9A-Za-z])/g, '$1 $2');
    return '<span class="cr-main">' + esc(main.trim()) + '</span>' + (meta ? '<span class="cr-meta">' + esc(meta) + '</span>' : '');
  }

  function renderCrumb() {
    /* 标题即面包屑（反馈「标题和顶部居中的面包屑合并到标题的位置，点它回退」）：模型名是根，
       往下 板 N / rank N / 单卡，除了当前这一级都能点回去 */
    var mid = level === 'card' ? backLevel : level;
    var atRoot = !(mid === 'board' && curBoard != null) && curSel == null && tier !== 3;
    // 根（模型名）永远可点：在集群层点它 = 画布复位
    var parts = ['<button type="button" class="cr cr-root' + (atRoot ? ' is-cur' : '') + '" data-cr="root" title="' + esc(PS.modelName) + '">' + titleHtml(PS.modelName) + '</button>'];
    /* 面包屑不随来路变（审计：从板视图下钻是「Board 158 / rank 1267 / 单卡」，从集群或 ?sel= 进来少了 Board 那一段）：
       选中了 rank 就总带它所在的 Board，点它进那块板 */
    var bCr = mid === 'board' && curBoard != null ? curBoard : curSel != null ? physOf(curSel).board : null;
    if (bCr != null) parts.push(level === 'board' && curSel == null ? '<span class="cr is-cur">Board ' + bCr + '</span>' : '<button type="button" class="cr" data-cr="board" data-b="' + bCr + '">Board ' + bCr + '</button>');
    if (curSel != null) parts.push(tier === 3 ? '<button type="button" class="cr" data-cr="rank">rank ' + curSel + '</button>' : '<span class="cr is-cur">rank ' + curSel + '</span>');
    if (tier === 3) parts.push('<span class="cr is-cur">NPU</span>');   // 10.17：「单卡」统一叫 NPU（同 4096 NPU、8 NPU + 2 CPU）
    crumbEl.innerHTML = parts.join('<i>/</i>');
    // 往下走了一级：新出现的那一段从左边滑进来；往回退不播
    if (parts.length > crumbN && !REDUCED) { var last9 = crumbEl.querySelector('.cr:last-child'); if (last9) last9.classList.add('cr-new'); }
    crumbN = parts.length;
    document.body.classList.toggle('t3', tier === 3 && !detailFrame.classList.contains('is-hidden'));
    syncWarm();
    // 每一屏只留对这一屏有意义的东西（见 README「每一屏讲什么」）：板与单卡不看整个集群的段峰值、超容名单与故障复盘链
    document.body.classList.toggle('lv-board', level === 'board' && tier !== 3);
    syncCardHeights();
    placeSelLabel();
    syncLinked();
    renderDataCards();
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
  function renderLeftCard() {
    var pk = ppPeaks(), N = PS.pp, W = 200, H = 50, BASE = 36, gap = 10;
    var bw = (W - gap * (N - 1)) / N, top = Math.max(1.1, pk ? Math.max.apply(null, pk.map(function (x) { return x.v; })) : 1.1);
    var y100 = BASE - (1 / top) * (BASE - 12), bars = '';
    for (var i = 0; i < N; i++) {
      var v = pk ? pk[i].v : 0.5, h = Math.max(2, (v / top) * (BASE - 12)), x = i * (bw + gap), on = focusPP === i;
      bars += '<g class="pb' + (on ? ' is-on' : '') + '" data-pp="' + i + '"><rect class="pb-hit" x="' + x + '" y="0" width="' + bw + '" height="' + H + '"/>'
        + '<rect class="pb-bar ' + (pk ? ratioClass(v) : 'c-none') + '" x="' + x + '" y="' + (BASE - h) + '" width="' + bw + '" height="' + h + '"/>'
        + (on && pk ? '<text class="pb-val" x="' + (x + bw / 2) + '" y="' + (BASE - h - 4) + '" text-anchor="middle">' + Math.round(v * 100) + '%' + '</text>' : '')
        + '<text class="pb-num" x="' + (x + bw / 2) + '" y="' + (BASE + 12) + '" text-anchor="middle">PP' + i + '</text></g>';
    }
    var lg = lastCluster ? '<div class="lc-legend" title="格子/柱的灰度 = 显存占用率（合计 / HBM），超出容量标红"><i class="lg c0"></i><i class="lg c1"></i><i class="lg c2"></i><i class="lg c3"></i>'
      + '<span>' + Math.round(lastCluster.amber * 100) + '</span><span>' + Math.round(lastCluster.red * 100) + '</span><span>100%</span></div>' : '';
    // 模型名挪到左上角的标题面包屑里（#crumb），左卡只留配置
    /* 配置卡照相机界面那张「iPhone · 2時 · 4K·30·HEVC·HDR」：一个大数（卡数）+ 一排胶囊（各维切分）+ 一行灰字（物理规模） */
    var chips = [['TP', PS.tp], ['CP', PS.cp || 1], ['PP', PS.pp], ['DP', PS.dp], ['EP', PS.ep], ['ZeRO', ZERO]].filter(function (x) { return x[0] === 'ZeRO' || x[1] > 1; });
    leftCard.innerHTML = '<div class="gcard lc-cfg">'
      + '<div class="lc-big">' + world + '<small>NPU</small></div>'
      + '<div class="lc-chips">' + chips.map(function (x) { return '<span class="lc-chip"><em>' + x[0] + '</em>' + x[1] + '</span>'; }).join('') + '</div>'
      + '<div class="lc-sub" title="rank 按连续摆放落位（配置里没有 rank→NPU 映射），这是假设">' + physCount.sp + ' SuperPoD · ' + physCount.pods + ' POD · ' + physCount.boards + ' Board *</div>'
      + '</div><div class="gcard lc-pp"><div class="lc-sub">PP Stage · Peak Usage</div><svg class="pbars" viewBox="0 -14 ' + W + ' ' + (H + 14) + '" width="' + W + '" height="' + (H + 14) + '"><line class="pb-cap" x1="0" x2="' + W + '" y1="' + y100 + '" y2="' + y100 + '"/><line class="pb-base" x1="0" x2="' + W + '" y1="' + BASE + '" y2="' + BASE + '"/>' + bars + '</svg>'
      + lg + '</div>'
      + capCardHtml()
      + (splitErr ? '<div class="gcard lc-err"><div class="dc-r is-bad"><span>Split</span><b>Invalid</b></div>' + splitErr.errors.slice(0, 3).map(function (e) { return '<div class="dc-sub">' + esc(e.replace(/（[^）]*）/g, '')) + '</div>'; }).join('') + '</div>' : '')
      + (splitDiff ? '<div class="gcard lc-err"><div class="dc-r is-bad"><span>vs Engine</span><b>Mismatch</b></div><div class="dc-sub">' + esc(splitDiff.join(' · ')) + '</div></div>' : '');
    syncCardHeights();
  }
  leftCard.addEventListener('click', function (ev) {
    if (ev.target.closest('[data-act="worst"]') && lastCluster && lastCluster.worst != null) { showTier2(lastCluster.worst, coordLine(lastCluster.worst)); return; }
    var wr = ev.target.closest('[data-dact="sel"]'); if (wr) { var r9 = +wr.getAttribute('data-r'); showTier2(r9, coordLine(r9)); return; }
    // PP 段按钮：原地聚焦这一段（其余段压暗），再点一次取消；不再换到段视图（段视图已归档）
    var b = ev.target.closest('.pb'); if (!b) return;
    var k9 = +b.getAttribute('data-pp');
    if (curSel != null && coordOfRank(curSel).pp !== k9) showOverview(true);
    focusSegment(focusPP === k9 && curSel == null ? null : k9);
  });
  /* 进「板」这一层：画布换成这块板的 Server 形态图。keepSel=true 且选中的 rank
     就在这块板上时保留选中；否则清掉。 */
  /* 进板的串联：集群图先把镜头飞到这块板那一行，落地再换到板视图（板视图从略小的比例「落」进来）；
     回集群时集群图还停在这块板上，点标题复位就是一路拉远——进出同一条路径 */
  function goBoard(b, keepSel) {
    if (b == null) return;
    if (!REDUCED && level !== 'board' && tier !== 3 && !physStage.classList.contains('is-hidden')) {
      /* 接缝：先在看不见的板视图里量出它那 8 颗 NPU 落在屏幕上的位置，再让集群镜头把这块板的 8 格正好飞到那里——
         淡入的那一下，格子原地换成板视图里的 NPU，前后是同一排东西，没有尺度跳变 */
      var a8 = physStage.querySelector('.p-npu[data-rank="' + (b * PHYS.board) + '"]'), z8 = physStage.querySelector('.p-npu[data-rank="' + Math.min(world - 1, b * PHYS.board + PHYS.board - 1) + '"]');
      if (a8 && z8) {
        renderBoard(b); boardZP.reset();
        /* 量的是**图标**不是命中框：命中框比图标宽（下面还带着名字），按它对齐格子会落到图标旁边。
           首尾两格的中心对到首尾两颗图标的中心，比例由这两段距离定 */
        var n0 = boardStage.querySelector('.p-bnpu[data-slot="0"] + .b-npuicon'), n7 = boardStage.querySelector('.p-bnpu[data-slot="' + (PHYS.board - 1) + '"] + .b-npuicon');
        if (n0 && n7) {
          var r0 = n0.getBoundingClientRect(), r7 = n7.getBoundingClientRect();
          var ax = +a8.getAttribute('x'), zx = +z8.getAttribute('x') + +z8.getAttribute('width'), cw = +a8.getAttribute('width'), chh = +a8.getAttribute('height');
          var c0x = (r0.left + r0.right) / 2, c7x = (r7.left + r7.right) / 2, ccy = (r0.top + r0.bottom) / 2;
          var sk = (c7x - c0x) / Math.max(1e-6, zx - ax - cw);
          setTrail(physZP);
          physZP.flyToRect(ax, +a8.getAttribute('y'), zx - ax, chh, c0x - cw / 2 * sk, ccy - chh / 2 * sk, (zx - ax) * sk, chh * sk, 520,
            function () { if (level !== 'board') goBoardNow(b, keepSel); });
          return;
        }
      }
    }
    goBoardNow(b, keepSel);
  }
  /* 板视图「搭起来」：落地那一刻 NPU 那一排（刚刚与集群格子对齐的那一排）先在，其余按离它的竖直距离由近到远
     依次淡入——CPU / fullmesh 弧、往下扇出到 L1、L1、再到各平面 SW2。只动小图（板视图几百个元素）的 opacity */
  var buildT = 0;
  function boardBuildIn() {
    if (REDUCED) return;
    var sv = boardStage.querySelector('svg'), npu = boardStage.querySelector('.p-bnpu'); if (!sv || !npu) return;
    var ay = +npu.getAttribute('y') + +npu.getAttribute('height') / 2, H = sv.viewBox.baseVal.height || 590;
    boardStage.querySelectorAll('.b-bg > *, .b-links > *, .b-nodes > *, .b-txt > *').forEach(function (el) {
      var bb; try { bb = el.getBBox(); } catch (e) { return; }
      var d = Math.abs(bb.y + bb.height / 2 - ay) / H;
      el.style.setProperty('--bd', Math.round(Math.min(1, d * 1.6) * 520) + 'ms');
    });
    clearTimeout(buildT);
    boardStage.classList.add('is-building');
    buildT = setTimeout(function () { boardStage.classList.remove('is-building'); }, 1200);
  }
  function goBoardNow(b, keepSel) {
    var entering = level !== 'board';
    if (!keepSel || (curSel != null && physOf(curSel).board !== b)) { curSel = null; pendingMatrixSel = null; pendingSubLine = null; tier = 1; rankTipOpen = true; }
    else if (curSel != null) tier = 2;
    level = 'board'; curBoard = b;
    showTier1Visual();
    boardZP.reset();
    if (entering) boardBuildIn();
    if (curSel == null) renderRightIdle(); else renderDrillInvite(curSel, pendingSubLine || coordLine(curSel), lastBrief && lastBrief.rank === curSel ? lastBrief : null);
    renderLeftCard(); renderCrumb();
  }
  /* 换 ZeRO 档：URL 跟着改（URL 即状态），矩阵重算一遍——单卡层直接重载那一屏；
     其余层借一次 ?brief=1（带 sel 时同一次回信里也有集群聚合），回信到了格子、柱、
     角标、右列都按新口径重画。 */
  var clusterStale = false;
  function setZero(z) {
    if (z === ZERO) return;
    saveBase();
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
  var lastCluster = null, lastBrief = null, rawBrief = null;
  /* 推理工况（?mode=infer）：集群的逐卡占用率 / 四档计数 / 最满那张卡换成推理口径（矩阵本体 ptoInferMem：
     权重 + KV cache + workspace + 预留，没有梯度与优化器态）——画布灰度、容量卡、「最满」、诊断那一步都跟着换。 */
  function viewBrief(b) {
    if (!b || b.ok === false || MODE !== 'infer' || !b.infer) return b;
    var o = {}; for (var k in b) o[k] = b[k];
    o.n = b.infer.n; o.oom = b.infer.oom; o.ratio = b.infer.ratio; o.worst = b.infer.worst;
    return o;
  }
  (function () {
    requestClusterBrief();
  })();
  function requestClusterBrief() {
    briefBase = briefSrc(); briefLive = false;
    matrixFrame.src = briefBase;
  }
  /* 聚合结果进右卡的第一档内容（原来是左上角一颗角标，现在三张卡的位置固定，
     集群容量就是右卡在没选中任何卡时该说的那句话）。 */
  /* 两边是不是同一套数：矩阵报回它实际按哪组切分算的（brief.config），与本页 PS 逐项核对；
     切分不合法（改错了）时矩阵报 ok:false + 原因，本页在左列与设置里当场说清楚。 */
  var splitErr = null, splitDiff = null;
  function renderClusterBadge(brief) {
    if (!brief) return;
    if (brief.ok === false) { splitErr = brief; lastCluster = null; renderLeftCard(); if (cfgOpen) renderCfg(); return; }
    splitErr = null;
    if (brief.config) {
      var want = { world: world, tp: PS.tp, cp: PS.cp, pp: PS.pp, dp: PS.dp, ep: PS.ep, podCards: PHYS_CHAIN.podCards };
      splitDiff = Object.keys(want).filter(function (k) { return brief.config[k] !== want[k]; }).map(function (k) { return k + ' ' + want[k] + '≠' + brief.config[k]; });
      if (splitDiff.length) console.warn('shard-device-map: 矩阵与本页切分不一致', splitDiff); else splitDiff = null;
    }
    rawBrief = brief; lastCluster = viewBrief(brief); ppPeak = null;
    // 维度色不再拿矩阵报来的那套覆盖：单卡页（slabgap）反过来用本页这套（--c-*），全篇一个颜色一个意思
    oomSet = {};
    (lastCluster.oom || []).forEach(function (r) { oomSet[r] = 1; });
    applyAlerts();
    if (tier === 1) renderRightIdle(); else if (curSel != null) showRankBadge(curSel);
    renderPanel();
    renderDataCards();
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
  /* 连线上的小标签：每一维通信量写在它闭合的那一级链路旁（闭合级别同 Closure 卡，按 rank 连续落位推）。
     平时只在放大到 1.5× 起出现（svg.lodz）；超阈值的读数（EP 路由失衡 > 告警线、PP 气泡 > 25%）琥珀色，不放大也在 */
  function boardLinkLabels() {
    var sv = boardStage.querySelector('svg');
    var C = lastCluster, B = rawBrief, P = B && B.perf, M = P && P.moe, H = P && P.health, dd = hierDims();
    /* 口径跟着这块板走（审计：板标签原来写全网值——EP 失衡写成全网峰值 1.18×，本板所在段是 1.16×；DP 写全网 8.1GB，本段 rank 卡是 7.7GB）：
       板上 8 张卡同一个 PP 段；有本板某张卡的读数就用它的，EP 失衡取本段峰值 */
    var bSt = curBoard != null ? coordOfRank(curBoard * PHYS.board).pp : null;
    var rb = lastBrief && lastBrief.detail && lastBrief.detail.comm && curBoard != null && physOf(lastBrief.rank).board === curBoard ? lastBrief.detail.comm : null, rc = {};
    if (rb) rb.forEach(function (c) { if (c.exact) rc[c.dim] = unitEN(c.txt); });
    var sImb = function (st) { if (!(M && H && M.imbL)) return null; var a = stageImb(M, H).filter(function (x) { return x.pp === st; })[0]; return a || null; };
    var val = function (d) {
      if (!C) return '';
      if (rc[d.toLowerCase()] && !(d === 'DP' && MODE === 'infer')) return rc[d.toLowerCase()];
      if (d === 'TP' && C.comm && C.comm.tp) return unitEN(C.comm.tp.txt);
      if (d === 'PP' && C.comm && C.comm.pp) return unitEN(C.comm.pp.txt);
      if (d === 'DP' && C.comm && C.comm.dp && MODE !== 'infer') return unitEN(C.comm.dp.txt);
      if (d === 'EP' && M) return 'A2A ≤' + Math.round(M.a2aMB) + ' MB';
      return '';
    };
    var warn = function (d) {
      if (d === 'EP' && M && H) { var si = bSt != null ? sImb(bSt) : { v: M.imbMax }; if (si && si.v > H.thrImb) return si.v.toFixed(2) + '× > ' + H.thrImb; }
      if (d === 'PP' && MODE === 'train' && B && B.bubble > 0.25) return 'bubble ' + pct(B.bubble);
      return '';
    };
    if (sv) sv.querySelectorAll('.b-dlbl').forEach(function (el) {
      var parts = [], hot = false;
      (dd[+el.getAttribute('data-lv')] || []).forEach(function (x) {
        var d = x.split('×')[0], v = val(d), w = warn(d); if (!v && !w) return;
        if (w) hot = true;
        parts.push('<tspan class="dl-k">' + d + '</tspan> ' + esc(v) + (w ? ' <tspan class="is-warn">' + esc(w) + '</tspan>' : ''));
      });
      el.innerHTML = parts.join('<tspan class="dl-sep">  ·  </tspan>');
      el.classList.toggle('has-warn', hot);
    });
    // 链路状态：EP 路由失衡超线 → 板视图 L1 端口点亮琥珀、选中卡出板 Clos（它的 EP 走这几根）由白改琥珀；集群放大后的原地关系同一条规则
    // 板视图：本板所在段越线才标；集群放大后的原地关系：选中卡所在段越线才标（没选中就不标链路状态）
    if (sv) sv.classList.toggle('st-ep', !!warn('EP'));
    var pSv = physStage.querySelector('.zp-box svg'), cSt = curSel != null ? coordOfRank(curSel).pp : null, ci = cSt != null ? sImb(cSt) : null;
    if (pSv) pSv.classList.toggle('st-ep', !!(ci && H && ci.v > H.thrImb));
  }
  function applyAlerts() {
    boardLinkLabels();
    if (!oomSet) return;
    document.querySelectorAll('.phys-stage .p-npu').forEach(function (el) {
      var c = capClass(+el.getAttribute('data-rank'));
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
    var p = new URLSearchParams(splitParams({
      embed: '1', theme: 'dark', zero: String(ZERO), fastcard: '1', solo: '1', memcards: '0', plate: '0', comm: DV.comm ? '1' : '0', solozoom: DV.sibs === 'on' ? '9' : '44',
      sibs: DV.sibs, clbl: '0', lstyle: 'flow', capln: 'reach', slabgap: '1', ggap: '1', notitle: '1', rankview: DV.rv, commk: ['tp', 'cp', 'ep', 'pp', 'dp'].filter(function (k) { return DV.commk[k]; }).join(','),
      view: 'chain', card: '1', vtab: DV.vtab, sel: String(matrixSel),
      stitle: PS.modelName + ' / ' + TIER2_LABEL + ' / rank ' + matrixSel
    }));
    return engineSrc(ENG_3D, p);
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
  /* 借数那一格加载一次就留着：同一组切分 / ZeRO 下再问别的卡，用 pto:brief 消息就地问，不重载整页（见 demo.html） */
  var briefBase, briefLive;   // 不带初值：上面的 IIFE 已先调过 requestClusterBrief 赋过值，这里再赋 null 会把它冲掉
  function briefSrc(extra) { return engineSrc(ENG_3D, splitParams(Object.assign({ embed: '1', brief: '1', zero: String(ZERO) }, extra || {}))); }
  function requestTier2Brief(matrixSel) {
    var base = briefSrc();
    if (briefLive && briefBase === base && matrixFrame.contentWindow) { matrixFrame.contentWindow.postMessage({ type: 'pto:brief', sel: matrixSel }, '*'); return; }
    briefBase = base; briefLive = false;
    matrixFrame.src = briefSrc({ sel: String(matrixSel) });
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

  /* 画布停在哪一层就铺哪张：cluster = 灵衢物理，board = 板视图；card 层由 showDetail
     自己切矩阵。showOverview/showTier2 共用这一个开关函数；matrixFrame / detailFrame
     都要藏：从第三档退回来时它还开着。两张 SVG 舞台受同一套选中/聚焦状态驱动。 */
  /* 藏起来的单卡矩阵停住动画：它跟本页同一条主线程，藏着还在逐帧重绘，本页的每一次点击都得排在它后面
     （逐帧看过：返回板视图那一下晚了 1.7 秒才动） */
  function cueDetail(what) { if (REDUCED) return; try { detailFrame.contentWindow && detailFrame.contentWindow.postMessage({ type: 'pto:solo', play: what }, '*'); } catch (e) {} }
  function pauseDetail(on) { if (on) detailSettleAt = performance.now(); try { detailFrame.contentWindow && detailFrame.contentWindow.postMessage({ type: 'pto:solo', pause: on }, '*'); } catch (e) {} }
  /* 换台：新的一层先抬到最上面淡入，旧的一层在下面保持不透明，等新的一层淡入完（.3s）再收起。
     逐帧看过：两层同时一出一进时，新的一层刚从 opacity 0 显出来还没光栅化完（集群图四万个图元），旧的一层已经按时
     淡掉了——中间闪一两帧黑。 */
  /* ── 层级串联（进板、下钻、返回）只在这一处记「之前」：trail = 进去之前那一层的镜头。
     回到同一层时用一次就丢；回到别的层、或点标题复位，就作废——不跨状态引用旧镜头，免得某条别的路径
     回来时镜头莫名其妙飞回很久以前的位置。 */
  var trail = null;
  /* 预载好的单卡页只在「选中了一张卡、还没下钻」（第二档）时以 1% 压在最上层预热；其余时候完全透明——
     集群层没有选中时不留任何一层旧单卡的影子 */
  function syncWarm() { document.body.classList.toggle('detail-warm', tier === 2 && detailReady); }
  function setTrail(zp) { trail = { zp: zp, cam: zp.cam(), level: level }; }
  function pullTrail() {
    var t = trail; trail = null;
    if (!t || t.level !== level || t.zp !== (level === 'board' ? boardZP : physZP)) return;
    t.zp.flyToCam(t.cam, 480);
  }
  var stageHideT = 0;
  function showStage(el) {
    var all = [physStage, boardStage, detailFrame];
    clearTimeout(stageHideT);
    all.forEach(function (s9) { s9.classList.toggle('is-top', s9 === el); });
    el.classList.remove('is-hidden');
    stageHideT = setTimeout(function () {
      all.forEach(function (s9) { if (s9 !== el && !s9.classList.contains('is-hidden')) { s9.classList.add('is-hidden'); if (s9 === detailFrame) pauseDetail(true); } });
    }, 320);
  }
  function showTier1Visual() {
    matrixFrame.classList.add('is-hidden');
    clearTimeout(detailRevealT); detailRevealT = null; document.body.classList.remove('is-loading');
    if (clusterStale) { clusterStale = false; if (curSel != null) requestTier2Brief(curSel); else requestClusterBrief(); }
    if (level === 'board') renderBoard(curBoard); else renderPhys();
    showStage(level === 'board' ? boardStage : physStage);
    pullTrail();   // 从单卡 / 板回到记下镜头的那一层：拉回进去之前的取景
    dock.classList.remove('is-hidden');
    physApplySelection();
  }

  /* 回到当前这一层的"没选中"态。keepLevel=true 只取消选中、留在原来那一层
     （段层就还在段里）；否则回到集群层、清掉段聚焦。 */
  function showOverview(keepLevel) {
    tier = 1; curSel = null; pendingMatrixSel = null; pendingSubLine = null; rankTipOpen = true;
    if (!keepLevel) { level = 'cluster'; focusPP = null; }
    showTier1Visual();
    renderRightIdle(); renderLeftCard(); renderCrumb();
  }

  /* 第二档：留在当前那张画布上（集群或板），
     只换宿主自己这层的 chrome——右下角浮出"下钻"邀请。选中态是那个视图
     自己的事（这一刻画面早就是对的，来路无关：可能是刚刚报上来的新选中，
     也可能是从第三档退回来、本来就还停在原地没变过），这个函数只管 sel
     （换算好的矩阵 rank，供下钻按钮用）与 subLine（下钻邀请那一行副标题，
     各来路按自己手上的坐标格式拼好再传进来）。 */
  function showTier2(matrixSel, subLine) {
    tier = 2; curSel = matrixSel; pendingMatrixSel = matrixSel; pendingSubLine = subLine;
    focusPP = coordOfRank(matrixSel).pp;
    if (level === 'card') level = backLevel;
    showTier1Visual();
    renderDrillInvite(matrixSel, subLine, lastBrief && lastBrief.rank === matrixSel ? lastBrief : null);
    if (!(lastBrief && lastBrief.rank === matrixSel)) requestTier2Brief(matrixSel); else preloadDetail(matrixSel);
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
  /* 什么时候淡入单卡页：等它「静下来」。逐帧看过，报就绪之后单卡页自己还会再收一次镜头（约 1 秒后、逐帧改 DOM），
     入场淡入动画藏着时也不会走；这时显出来，画面在淡入中间一直在变、要重新光栅化，中间空白 0.6–0.9 秒。
     单卡页与本页同源，直接盯它的 DOM：静了 250ms → 停住一次（入场动画走到终态）→ 再留 200ms 给后台光栅化 → 淡入。
     读者点得快就原画面不动、面包屑挂「…」；3 秒兜底。 */
  var detailMutAt = 0, detailSettleAt = 0, detailMO = null;
  /* 单卡页的正文是无衬线（Inter），底角那组「选组 − ＋」会露出一套别的字：同源，落地时把它的两套字体变量都指到本页的等宽栈，
     并把同一份 JetBrains Mono 样式表挂进去（字体是按文档加载的，本页加载过的它用不上） */
  function monoDetail() {
    var d = detailFrame.contentDocument; if (!d || !d.documentElement) return;
    var mono = getComputedStyle(document.documentElement).getPropertyValue('--mono').trim();
    // 它的字体变量定义在 .pt-root 上，挂在根节点上够不着：注入一条更具体的规则（html .pt-root）盖过去
    if (mono && d.head && !d.getElementById('lq-mono-v')) { var st = d.createElement('style'); st.id = 'lq-mono-v'; st.textContent = 'html .pt-root{--font-sans:' + mono + ';--pt-sans:' + mono + ';--pt-mono:' + mono + '}'; d.head.appendChild(st); }
    // 同一份 @font-face 挂进去（字体按文档加载；地址按本页解析成绝对路径，单卡页在别的目录下也找得到）
    if (d.head && !d.getElementById('lq-mono')) {
      var fs = [].map.call(document.styleSheets, function (sh) { try { return [].filter.call(sh.cssRules, function (r) { return r.type === 5; }).map(function (r) { return r.cssText; }).join('\n'); } catch (e) { return ''; } }).join('\n');
      var base = new URL('./', location.href).href;
      var sf = d.createElement('style'); sf.id = 'lq-mono'; sf.textContent = fs.replace(/url\("\.\//g, 'url("' + base); d.head.appendChild(sf);
    }
  }
  detailFrame.addEventListener('load', function () {
    detailMutAt = performance.now(); detailSettleAt = 0;
    try { monoDetail(); } catch (e) { /* 跨源时不动它 */ }
    try {
      if (detailMO) detailMO.disconnect();
      var root9 = detailFrame.contentDocument.documentElement;
      // 暂停本身会改根节点的 class（pt-paused），那一下不算「还在动」
      detailMO = new MutationObserver(function (l) { if (l.some(function (r) { return !(r.target === root9 && r.attributeName === 'class'); })) detailMutAt = performance.now(); });
      detailMO.observe(root9, { subtree: true, childList: true, attributes: true, characterData: true });
    } catch (e) { detailMO = null; }
  });
  function scheduleReveal() {
    clearTimeout(detailRevealT);
    var t0 = performance.now();
    (function tick() {
      if (tier !== 3) return;
      var now = performance.now();
      var still = now - detailMutAt >= 250, settled = detailSettleAt > detailMutAt && now - detailSettleAt >= 200;
      if ((still && settled) || now - t0 > 3000) { revealDetail(); return; }
      if (still && !(detailSettleAt > detailMutAt)) pauseDetail(true);
      document.body.classList.add('is-loading');
      detailRevealT = setTimeout(tick, 60);
    })();
  }
  /* 选中那一刻的预载往后挪：选中动画（镜头 + 高亮，约 600ms）先走完、主线程空下来再装 NPU 页，
     否则隐藏 iframe 的首渲和选中动画抢同一条主线程，逐帧看就是 100–150ms 的连续长帧。
     真正下钻（showDetail）不等，直接装。 */
  var preloadT = 0;
  function preloadDetail(sel) {
    clearTimeout(preloadT);
    preloadT = setTimeout(function () {
      var go = function () { if (tier === 2 && curSel === sel) loadDetail(sel); };
      if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 1200 }); else go();
    }, 650);
  }
  function loadDetail(sel) {
    clearTimeout(preloadT);
    var src = matrixSrcFor(sel);
    if (src === detailSrc) return;
    detailSrc = src; detailReady = false; detailFrame.src = src;
  }
  function revealDetail() {
    clearTimeout(detailRevealT); detailRevealT = null;
    document.body.classList.remove('is-loading');
    if (tier !== 3) return;
    pauseDetail(true);   // 显出来之前再停一次：停的同时把还悬着的入场动画走到终态，淡入时画面已经是完整的
    /* 落地编排：壳（玻璃框）随淡入出现，里面的显存板先藏着；淡入走完、放开动画的那一刻，板自下而上逐档码上去 */
    cueDetail('stack');
    showStage(detailFrame);
    // 放开动画放到淡入走完之后：放开那一下 NPU 页整页重算样式、重绘，赶在淡入中间做就是一两帧空白
    setTimeout(function () { if (tier === 3) pauseDetail(false); }, 360);
    renderCrumb();
  }
  function showDetail(matrixSel) {
    // 下钻的串联：当前画布（集群 / 板）先朝选中那一格推近，NPU 页准备好后从这个推近的画面上淡入；返回时再拉回来
    if (tier !== 3 && !REDUCED) {
      var zp9 = level === 'board' ? boardZP : physZP, st9 = level === 'board' ? boardStage : physStage;
      var el9 = st9.querySelector('.p-npu[data-rank="' + matrixSel + '"]');
      if (el9 && !st9.classList.contains('is-hidden')) { setTrail(zp9); zp9.pushTo(+el9.getAttribute('x'), +el9.getAttribute('y'), +el9.getAttribute('width'), +el9.getAttribute('height'), 1.9, 620); }
    }
    tier = 3; curSel = matrixSel; pendingMatrixSel = matrixSel;
    if (focusPP == null) focusPP = coordOfRank(matrixSel).pp;
    if (level !== 'card') backLevel = level;
    level = 'card';
    loadDetail(matrixSel);
    flowDots(null);   // 板视图的流动点藏着也在逐帧重绘：下钻时收掉
    openDrawer(null);
    if (detailReady) scheduleReveal();
    else { document.body.classList.add('is-loading'); clearTimeout(detailRevealT); detailRevealT = setTimeout(revealDetail, 5000); }
    if (lastBrief && lastBrief.rank === matrixSel) renderBrief(lastBrief);
    else renderDrillInvite(matrixSel, pendingSubLine || coordLine(matrixSel), null, true);
    renderLeftCard(); renderCrumb();
  }

  // ── 接 Logical Cube 自己上报的选中事件：rubik-select 是它页内换选中卡时主动发的——
  //    选中就是第二档，取消选中（点空白，它自己原有的手势）就退回第一档。 ──
  // ── 接矩阵本体上报的换档事件：pto:tier 带着 {tier, sel, brief}。矩阵现在
  //    只在第三档才被打开，收到 tier<3（矩阵里点空白退出 soloCard）就说明
  //    读者要退回第二档——切回 Logical Cube（它一直还停在原地、选中态没变过），
  //    副标题这时改用矩阵自己上报的 brief.coord/layers 拼（跟 Logical Cube 自己
  //    的 tp/pp/rep 是两套坐标格式，不能混用同一个拼法）。 ──
  /* ── 跨视图联动（反馈「泳道、整网、层级、魔方和中间的集群图，相同的元素要可以联动选中和显示」）──
     宿主是唯一的选中源：curSel（rank）/ focusPP（PP 段）一变（每条改状态的路径最后都走
     renderCrumb），就推给当前开着的那个参考面板；面板里点了什么，也折回同一条
     showTier2 / focusSegment 路径，于是集群 / 板 / 段三张画布、左右卡、面包屑一起跟。
       Logical Cube  → rubik-cmd select（魔方自己的 rank 序：rep 在外、pp 在内，见 rubikIdxOf）
                 ← rubik-select
       Network Graph    → pto:state hl.rank（同一个矩阵预置，rank 号一一对应）；只聚焦段时 filters.p
                 ← pto:select
       泳道      本页原生（按当前预置算的 1F1B）：重画即高亮所在段、多一条选中 rank 的道；点一段 = 聚焦
       Hierarchy  本页原生：重画即高亮（POD / 板 / NPU 三张格子），点格子 = 选中
     回声：面板报上来的那一次改动不再推回同一个面板（linkMute），否则泳道自己的选中态会被
     宿主的 filters 盖掉；魔方收到 select 会再报一次 rubik-select，同一张 NPU 直接忽略。 */
  var linkSent = {}, linkMute = false;
  function rubikIdxOf(ms) { var c = coordOfRank(ms); return ((c.dp * PS.pp + c.pp) * (PS.cp || 1) + c.cp) * PS.tp + c.tp; }
  function fromPanel(fn) { linkMute = true; try { fn(); } finally { linkMute = false; } }
  function syncLinked(force) {
    if (!drawerOpen) return;
    var key = curSel + '|' + focusPP;
    if (!force && linkSent[drawerOpen] === key) return;
    linkSent[drawerOpen] = key;
    if (DRAWERS[drawerOpen].native) { renderPanel(); return; }
    if (linkMute) return;
    var w = drawerFrame.contentWindow; if (!w) return;
    var c = curSel != null ? coordOfRank(curSel) : null, pp = c ? c.pp : focusPP;
    var NOF = { t: null, e: null, p: null, d: null };
    if (drawerOpen === 'rubik') w.postMessage({ type: 'rubik-cmd', cmd: 'select', value: curSel != null ? rubikIdxOf(curSel) : null }, '*');
    else if (drawerOpen === 'netgraph') {
      w.postMessage(curSel != null ? { type: 'pto:state', filters: NOF, hl: { rank: curSel } }
        : pp != null ? { type: 'pto:state', hl: null, filters: { t: null, e: null, p: pp, d: null } }
        : { type: 'pto:state', hl: null, filters: NOF }, '*');
    }
  }
  drawerFrame.addEventListener('load', function () { if (drawerOpen && !DRAWERS[drawerOpen].native) { delete linkSent[drawerOpen]; setTimeout(function () { syncLinked(true); }, 300); } });

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d) return;
    if (drawerFrame && ev.source === drawerFrame.contentWindow) {
      if (d.type === 'pto:select') {
        // Network Graph 里点了一张 NPU / 点空白
        if (typeof d.sel === 'number' && d.sel >= 0 && d.sel < world) { if (d.sel !== curSel) fromPanel(function () { showTier2(d.sel, coordLine(d.sel)); }); }
        else if (d.sel == null && curSel != null) fromPanel(function () { showOverview(true); });
        return;
      }
      if (d.type === 'rubik-drill') {
        /* 再点一次已经选中的那张方块 = 下钻——Logical Cube 自己报的坐标已经够
           换算出矩阵 rank，不用等 pendingMatrixSel（用户可能从深链或退档
           回来，那个变量这一刻不一定是这张 NPU），直接算一遍最准。 */
        if (d.sel && d.sel.rank != null) showDetail(rubikSelToMatrixSel(d.sel));
        return;
      }
      if (d.type !== 'rubik-select') return;
      // 宿主刚推过去的那张 NPU，魔方会原样再报一次——同一张 NPU / 本来就没选中，都不再走一遍
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
      if (d.type === 'pto:cluster') { briefLive = true; renderClusterBadge(d.brief); return; }
      if (d.type === 'pto:rank-brief') {
        // 这次借用可能是为了一张早就不再选中的 NPU（读者点得快，回信滞后）——
        // 只在还是当前这张 NPU 时才拿去升级浮卡，旧回信直接丢弃。
        if (d.brief) { lastBrief = d.brief; placeSelLabel(); renderDataCards(); boardLinkLabels(); }
        if (d.brief && d.brief.rank === pendingMatrixSel && tier === 2) { renderDrillInvite(pendingMatrixSel, pendingSubLine, d.brief); preloadDetail(pendingMatrixSel); }
        return;
      }
      return;
    }
    if (ev.source === detailFrame.contentWindow) {
      if (d.type !== 'pto:tier') return;
      if (d.tier === 3) {
        // NPU 层里点了一张兄弟 rank：矩阵原地换选（仍在 solo），宿主跟着换，不重载
        if (tier === 3 && d.sel != null && d.sel !== curSel && !detailFrame.classList.contains('is-hidden')) { adoptSolo(d.sel, d.brief); return; }
        // 预载完成（可能是在后台、读者还没点下钻）：记下就绪；读者已经在等这一张就等它静下来再淡入（scheduleReveal）
        detailReady = true; syncWarm();
        if (detailFrame.classList.contains('is-hidden')) pauseDetail(true);
        if (tier === 3 && d.sel === curSel) { renderBrief(d.brief); if (detailFrame.classList.contains('is-hidden')) scheduleReveal(); }
        else if (d.brief) { lastBrief = d.brief; boardLinkLabels(); }
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
     最严重的那张 NPU。不摆别的——这一档右卡只回答"全网现在怎么样"。 */
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
        + (lastCluster.worst != null ? '<button type="button" class="brief-cta" data-act="worst">rank ' + lastCluster.worst + '</button>' : '');
      briefCard.classList.toggle('is-hidden', !alertTipOpen);
    }
    syncCardHeights();
  }
  alertBadge.addEventListener('click', function () {
    if (curSel == null) { alertTipOpen = !alertTipOpen; renderRightIdle(); }
    else { rankTipOpen = !rankTipOpen; rerenderRank(); renderDataCards(); }
  });
  /* 选中卡的物理位置 + 五个 Comm 组各走哪一级链路（落位假设见左卡）。 */
  function physInfoHtml(r) {
    var p = physOf(r), g = commGroups(r);
    var rows = [['tp', 'TP', g.tp], ['cp', 'CP', g.cp]];
    rows.push(['ep', 'EP', g.ep]); rows.push(['dp', 'DP', g.dp]);
    rows.push(['pp', 'PP', g.pp]);
    /* 并行组与「Comm」合成一张表（原来右卡一份 group、下面数据卡再一份 Comm，五维列两遍）：
       维 ×组大小 · 闭合在哪一级 · 一次搬多少（CP/EP 由路由与切法当场决定，写「—」） */
    var cm = {}, B9 = DCK.comm && lastBrief && lastBrief.rank === r && lastBrief.detail;   // 设置里关掉「Comm」这一类就不带量
    if (B9 && B9.comm) B9.comm.forEach(function (c) { cm[c.dim] = c; });
    var html = '<div class="brief-k">Group</div>' + rows.filter(function (x) { return x[2].length > 1; }).map(function (x) {
      var lv = linkLevel(x[2], x[0] === 'pp'), c = x[0] === 'dp' && MODE === 'infer' ? null : cm[x[0]];   // 推理没有 DP 梯度同步：同 Communication 卡，不给量
      var vol = B9 ? '<b class="' + (c && c.exact ? '' : 'is-na') + '"' + (c && c.how ? ' title="' + esc(c.how) + '"' : '') + '>' + (c && c.exact ? esc(unitEN(c.txt)) : '—') + '</b>' : '';
      return '<div class="brief-row brief-row3"><span><i class="gc" style="background:' + GC[x[0]] + '"></i>' + x[1] + ' ×' + x[2].length + '</span><em>' + LINK_LEVELS[lv] + '</em>' + vol + '</div>';
    }).join('');
    // 这颗 NPU 自己的物理链路（直播第二/四页的 Server/机柜关系，槽位 → CPU/NIC 是
    // 板视图里同一套配对：CPU 各带 4 卡、NIC 各带相邻 2 卡）
    // 小屏（is-compact）：四行链路收成一行
    var phy = '<div class="brief-links"><div class="brief-k">Link</div>'
      + '<div class="brief-row"><span>fullmesh</span><b>×7</b></div>'
      + '<div class="brief-row"><span>Clos</span><b>L1 ×8</b></div>'
      + '<div class="brief-row"><span>H2D</span><b>CPU' + (p.slot < 4 ? 0 : 1) + '</b></div>'
      + '<div class="brief-row"><span>RoCE</span><b>NIC' + Math.floor(p.slot / 2) + '</b></div></div>'
      + '<div class="brief-row brief-link1"><span>Link</span><b>mesh×7 · L1×8 · CPU' + (p.slot < 4 ? 0 : 1) + ' · NIC' + Math.floor(p.slot / 2) + '</b></div>';
    return '<div class="brief-k brief-loc" title="落位为假设：rank 连续摆放">SuperPoD ' + p.sp + ' · POD ' + p.pod + ' · Board ' + p.board + ' · Slot ' + p.slot + '<sup>*</sup></div>' + html + phy;
  }

  /* rank 详情卡的正文（容量徽标 + 坐标/层区间 + 显存构成 + 合计）——第二档
     升级之后与第三档共用同一份拼法：两边的数字都来自矩阵本体同一个
     ptoRankBrief()（见 requestTier2Brief 与 matrixSrcFor 各自怎么问它要），
     这里只拼一次版式，不为两档各写一份、读出两套数。容量告警只用文字/
     底色深浅分挡，不引入色相，呼应"默认关掉颜色只有黑白"那条反馈。 */
  var CAP_LABEL = { oom: 'OOM', red: 'Critical', amber: 'Warn', ok: 'OK' };
  /* 指标名一律英文（反馈「指标的命名全部采用英文」）：矩阵本体报上来的显存档名是中文，这里按开头换 */
  var MEM_EN = [[/^权重/, 'Weights'], [/^AllGather/, 'AG Window'], [/^梯度/, 'Grads'], [/^优化器步/, 'Opt Step Tmp'], [/^优化器/, 'Optimizer'], [/^激活/, 'Activations'], [/^碎片/, 'Reserve']];
  function memEN(label) { var t = String(label); for (var i = 0; i < MEM_EN.length; i++) if (MEM_EN[i][0].test(t)) return MEM_EN[i][1]; return t.replace(/\s*[（(].*$/, '').replace(/[·／/].*$/, ''); }
  /* 矩阵报的通信量单位是中文；10.17 同时把「7.7GB /步」规整成「7.7 GB/step」——数值与单位空一格、单位里不留空格，全站一种写法 */
  function unitEN(t) { return String(t).replace(/\/层/g, '/layer').replace(/\/步/g, '/step').replace(/(\d)(MB|GB|KB|TB)/g, '$1 $2').replace(/ \/(layer|step|μb)/g, '/$1'); }   // 矩阵报的 Comm 量单位是中文
  function gbFmt(v) { return (Math.round(v * 10) / 10) + ' GB'; }
  function coordSubLine(brief) {
    return 'tp' + brief.coord.tp + ' cp' + brief.coord.cp + ' dp' + brief.coord.dp
      + ' pp' + brief.coord.pp + (brief.coord.ep != null ? ' ep' + brief.coord.ep : '')
      + ' · L' + brief.layers.lo + '–L' + brief.layers.hi;
  }
  /* 推理口径的这一段（按 PP 段）显存：四档 + 合计 + 档位 */
  function inferMem(pp) {
    var I = rawBrief && rawBrief.infer; if (!I || !I.stages[pp]) return null;
    var st = I.stages[pp], G = Math.pow(2, 30), M = rawBrief.memCol || {}, hbm = rawBrief.hbm, v = st.tot / G / hbm;
    return { totGB: st.tot / G, hbm: hbm, level: v > 1 ? 'oom' : v >= rawBrief.red ? 'red' : v >= rawBrief.amber ? 'amber' : 'ok', bmax: st.bmax,
      segs: [{ label: 'Weights', gb: st.w / G, col: M.w }, { label: 'KV Cache', gb: st.kv / G, col: M.act }, { label: 'Workspace', gb: st.ws / G, col: M.otmp }, { label: 'Reserve', gb: st.rsv / G, col: M.rsv }] };
  }
  function memBriefHtml(brief) {
    var IM = MODE === 'infer' && brief.coord ? inferMem(brief.coord.pp) : null;
    if (IM) {   // 推理工况：显存构成换成推理口径，其余（坐标 / 层区间）不变
      var b2 = {}; for (var k9 in brief) b2[k9] = brief[k9];
      b2.cap = { level: IM.level, totGB: IM.totGB }; b2.segs = IM.segs; b2.detail = { segs: IM.segs.map(function (x) { return { col: x.col }; }) };
      brief = b2;
    }
    var capBadge = '<span class="brief-badge' + (brief.cap.level === 'ok' ? '' : ' is-alert') + '">'
      + (CAP_LABEL[brief.cap.level] || brief.cap.level) + '</span>';
    // 档名只留头两三个字：「权重 (bf16)」→「权重」、「Activations·在途6μb」→「Activations」
    return '<div class="brief-h">rank ' + brief.rank + capBadge + '</div>'
      + '<div class="brief-sub">' + coordSubLine(brief) + '</div>'
      // 先答「装得下吗」：合计紧跟在抬头下面，逐档构成排在它后面
      + '<div class="brief-row brief-total"><span>Total</span><b>' + gbFmt(brief.cap.totGB).replace(' GB', '') + ' / ' + brief.hbm + ' GB</b></div>'
      // 小屏（is-compact）：五档收成合计下面一根按 HBM 比例的分段条，悬停看名字与 GB；大屏照旧逐行
      + '<div class="brief-segbar">' + brief.segs.map(function (s, i) {
        var dc = brief.detail && brief.detail.segs && brief.detail.segs[i], col = (dc && dc.col) || '#6A6A6A';
        var nm = memEN(s.label);
        return '<i style="width:' + Math.max(0.6, Math.min(100, s.gb / brief.hbm * 100)).toFixed(2) + '%;background:' + col + '" title="' + esc(nm + ' ' + gbFmt(s.gb)) + '"></i>';
      }).join('') + '</div>'
      + '<div class="brief-segrows">' + brief.segs.map(function (s) {
        return '<div class="brief-row"><span>' + memEN(s.label) + '</span><b>' + gbFmt(s.gb) + '</b></div>';
      }).join('') + '</div>';
  }

  /* 第二档的浮卡：选中的瞬间先摆一句邀请（brief 还没回来，不留空白）；
     requestTier2Brief 那次借用回信之后（brief 参数非空、rank 对得上），
     原地升级成跟第三档一样详细的 NPU 片——层区间/显存构成不再是编不出来的
     数字。"↓ NPU 下钻"按钮两种状态都留着：这一步升级的只是内容详细度，
     不是换档，点了才真的飞到矩阵那一屏（solo）。 */
  function renderDrillInvite(matrixSel, subLine, brief, noCta) {
    var cta = noCta ? '' : (level !== 'board' ? '<button type="button" class="brief-cta" data-act="board">Board ' + physOf(matrixSel).board + '</button>' : '')
      + '<button type="button" class="brief-cta is-primary" data-act="drill">NPU</button>';
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
  /* 右上角那枚「rank N」描边标签删掉（反馈）：选中即直接在右列最上面摊开 rank 卡，
     超容与否由卡抬头的徽标说；再点一次选中的那张 = 下钻，照旧 */
  var rankTipOpen = true;
  var briefAnimRank = null, briefAnimFlip = false;
  function showRankBadge(r) {
    alertBadge.classList.add('is-hidden');
    // 换了一张 NPU：rank 卡整张淡入上浮一次（两套同样的动画名交替，同一元素也能重播，不用强制回流）
    if (r !== briefAnimRank && !REDUCED) { briefAnimRank = r; briefAnimFlip = !briefAnimFlip; briefCard.classList.remove('card-in-a', 'card-in-b'); briefCard.classList.add(briefAnimFlip ? 'card-in-a' : 'card-in-b'); }
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
    if (ev.target.closest('[data-act="board"]') && curSel != null) { goBoard(physOf(curSel).board, true); return; }
    if (ev.target.closest('[data-act="worst"]') && lastCluster && lastCluster.worst != null) showTier2(lastCluster.worst, coordLine(lastCluster.worst));
  });

  /* 第三档的浮卡：不再留"下钻"按钮（已经在这一档了），正文跟第二档升级后
     共用同一个 memBriefHtml + physInfoHtml。 */
  function renderBrief(brief) {
    if (!brief) { renderRightIdle(); return; }
    lastBrief = brief;
    briefCard.classList.remove('is-cta');
    // NPU 层矩阵自己已经把显存构成摆成浮卡贴在卡壳旁边了，右卡不再重复那五行
    // （消融），只留矩阵画布上没有的：物理位置与 Comm 组链路等级。
    // 矩阵 solo 那群显存浮卡与引线关掉了（memcards=0），数字直接放这张右卡
    // NPU 层：显存各档已经拆成 3D 卡两侧的小卡（数据卡「显存各档」开着时），右卡不再重复
    briefCard.innerHTML = (tier === 3 && DCK.state && brief.detail ? '<div class="brief-h">rank ' + brief.rank + '<span class="brief-badge' + (brief.cap && brief.cap.level !== 'ok' ? ' is-alert' : '') + '">' + (brief.cap ? CAP_LABEL[brief.cap.level] || brief.cap.level : 'OK') + '</span></div><div class="brief-sub">' + coordSubLine(brief) + '</div>' : memBriefHtml(brief))   /* NPU 层抬头同第二档：rank · 档位标 · 坐标（含 ep）· 层段 */ + physInfoHtml(brief.rank);
    showRankBadge(brief.rank);
    renderDataCards();
  }


  /* ── Hierarchy（工具条「层级」，右侧面板；反馈「这个部分也要加进来」）─────────────────
     引自 cube-cockpit.html 的「Hierarchy」（combo-workbench 第三格），按本页的数据与视觉重做成
     原生的一列，而不是嵌那份彩色页面：L7 Global → L6 集群 → L5 SuperPoD → L4 POD → L3 板 →
     L2 NPU → L1 Die → L0 Core-Group。L4/L3/L2 是正方形宫格，灰度 = 占用率（同画布那把尺，超容红），
     聚合层取 Peak；每一层标出在这一层内闭合的并行维度（由本页的 linkLevel 算，不是写死）。
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
    rows.push(['EP', g.ep, false]); rows.push(['DP', g.dp, false]);
    rows.push(['PP', g.pp, true]);
    rows.forEach(function (x) { if (x[1].length > 1) by[linkLevel(x[1], x[2])].push(x[0] + '×' + x[1].length); });
    return by;   // 0 Board 内 → L3，1 POD → L4，2 SP → L5，3 跨 SP → L6
  }
  function renderHier() {
    if (!drawerBody || drawerOpen !== 'hier') return;
    var A = hierAggregates(), dims = hierDims(), here = curSel != null ? physOf(curSel) : null;
    var nPod = physCount.pods, nBoard = physCount.boards;
    function hd(lv, nm, ct, dm) {
      return '<div class="hv-hd"><span class="hv-lv">' + lv + '</span><span class="hv-nm">' + nm + '</span><span class="hv-ct">' + ct + '</span>'
        + (dm && dm.length ? '<span class="hv-dims">' + dm.map(function (t) { var k = t.slice(0, 2).toLowerCase(); return GC[k] ? '<b style="color:' + GC[k] + '">' + t + '</b>' : t; }).join(' · ') + '</span>' : '') + '</div>';
    }
    var sp = '';
    for (var i = 0; i < physCount.sp; i++) sp += '<button type="button" class="hv-chip' + (here && here.sp === i ? ' is-on' : '') + '" data-hsp="' + i + '">SuperPoD ' + i + '</button>';
    var die = ['D0 · Compute', 'D1 · Compute', 'D2 · IO', 'D3 · IO'].map(function (t) { return '<span class="hv-die' + (t.indexOf('IO') > 0 ? ' is-io' : '') + '">' + t + '</span>'; }).join('');
    var cg = ''; for (var k = 0; k < 32; k++) cg += '<i></i>';
    drawerBody.innerHTML = '<div class="hv">'
      + '<div class="hv-row is-ghost">' + hd('L7', 'Global', 'N Clusters · DCN') + '</div>'
      + '<div class="hv-row">' + hd('L6', 'Cluster', world + ' NPU', dims[3]) + '<button type="button" class="hv-bar" data-hact="root">' + physCount.sp + ' SuperPoD · ' + nPod + ' POD · ' + nBoard + ' Board</button></div>'
      + '<div class="hv-row">' + hd('L5', 'SuperPoD', physCount.sp + ' · 1024 NPU/SuperPoD', dims[2]) + '<div class="hv-chips">' + sp + '</div></div>'
      + '<div class="hv-row">' + hd('L4', 'POD', nPod + ' · 64 NPU/POD', dims[1]) + '<canvas class="hv-grid" data-hl="pod"></canvas></div>'
      + '<div class="hv-row">' + hd('L3', 'Board', nBoard + ' · 8 NPU + 2 CPU', dims[0]) + '<canvas class="hv-grid" data-hl="board"></canvas></div>'
      + '<div class="hv-row">' + hd('L2', 'NPU', world + ' · Ascend 950') + '<canvas class="hv-grid" data-hl="chip"></canvas></div>'
      + '<div class="hv-row">' + hd('L1', 'Die', '×4 / NPU') + '<div class="hv-dies">' + die + '</div></div>'
      + '<div class="hv-row">' + hd('L0', 'Core-Group', '×32 / NPU · AIC / AIV') + '<div class="hv-cg">' + cg + '</div></div>'
      + '</div>';
    var cvs = drawerBody.querySelectorAll('canvas.hv-grid');
    drawGrid(cvs[0], nPod, 16, 8, 17, 2, 4, function (i9) { return cellColor(A.pod[i9] && A.pod[i9].v, A.pod[i9] && A.pod[i9].bad); }, here ? here.pod : null);
    drawGrid(cvs[1], nBoard, 32, 8, 7, 1, 4, function (i9) { return cellColor(A.board[i9] && A.board[i9].v, A.board[i9] && A.board[i9].bad); }, here ? here.board : null);
    drawGrid(cvs[2], world, 64, 8, 4, 1, 2, function (i9) { return cellColor(lastCluster && lastCluster.ratio ? lastCluster.ratio[i9] : null, !!(oomSet && oomSet[i9])); }, curSel);
  }
  /* ── 原生泳道：本预置一步训练的 1F1B 调度 ──────────────────────────────────────────
     每段（PP 号）一条道，道上是这一段处理的全部 GA 个 micro-batch：前向（蓝）、反向（粉），
     调度按标准 1F1B（第 p 段先灌 PP−p−1 个前向，之后一前一后，最后排空反向）逐个解依赖算出来；
     空出来的就是流水气泡，占比 = (PP−1)/GA，与流水卡同一个数。时间以「一个 μb 的前向」为 1、
     反向按 2 计——相对时长，不是实测毫秒（右下角挂「示意」）。选中 rank 时，在它所在那一段下面多
     一条它自己的道，并标出它这一步的 Comm：段边界收发 Activations/梯度（绿竖线）、步末 DP 同步。
     联动：画布上选中 / 聚焦哪一段，这里那一段亮、其余压暗；点一条道（或道上的块）= 聚焦那一段，
     再点取消；悬停一个 μb，它在各段上的前向反向一起亮。 */
  var swimCache = null;
  function sched1F1B(P, M) {
    var ops = [], free = [], out = [], fEnd = {}, bEnd = {}, p, i;
    for (p = 0; p < P; p++) {
      var w = Math.min(P - p - 1, M), q = [];
      for (i = 0; i < w; i++) q.push(['F', i]);
      for (i = 0; i < M - w; i++) { q.push(['F', w + i]); q.push(['B', i]); }
      for (i = M - w; i < M; i++) q.push(['B', i]);
      ops.push(q); free.push(0); out.push([]);
    }
    for (var guard = 0; guard < P * M * 4; guard++) {
      var moved = false;
      for (p = 0; p < P; p++) {
        var op = ops[p][0]; if (!op) continue;
        var dep = op[0] === 'F' ? (p === 0 ? 0 : fEnd[(p - 1) + ':' + op[1]]) : (p === P - 1 ? fEnd[p + ':' + op[1]] : bEnd[(p + 1) + ':' + op[1]]);
        if (dep === undefined) continue;
        var st = Math.max(free[p], dep), en = st + (op[0] === 'F' ? 1 : 2);
        (op[0] === 'F' ? fEnd : bEnd)[p + ':' + op[1]] = en; free[p] = en;
        out[p].push({ k: op[0], m: op[1], s: st, e: en }); ops[p].shift(); moved = true;
      }
      if (!moved) break;
    }
    return { lanes: out, T: Math.max.apply(null, free) };
  }
  /* 泳道（10.3.0 重画，反馈「非常不精致、数据重复罗列」）：
     - 稳态 1F1B 每个 μb 都是同一个「F 一格 + B 两格」的节拍，原样平铺 32 个 μb 就是一条条条形码。
       这里把所有段都进了稳态之后的中间一大截折起来（折掉的长度取节拍 3 的整数倍，两边的块首尾对得上），
       折缝处每行一个「⋯」，顶上写折了几个 μb；只留预热 → 进稳态的两拍 → 出稳态 → 冷却，气泡（阶梯形的空白）一眼可见。
     - 顶上的 0/10/20… 是相对时长单位，没有读数意义，换成三段相位：预热 / 稳态 / 冷却。
     - 选中 rank 不再在它那一段下面再复制一行同样的块：直接在那一段上叠 P2P 收发与步末 DP 同步，标签换成 rank 号。
     - 页脚只留图例与气泡率（PP 数就是行数，不再重复写）。 */
  function swimFold(S) {
    var tA = 0, tB = Infinity;
    S.lanes.forEach(function (L) {
      var fb = null, lf = null;
      L.forEach(function (x) { if (x.k === 'B' && fb == null) fb = x.s; if (x.k === 'F') lf = x.e; });
      if (fb != null) tA = Math.max(tA, fb); if (lf != null) tB = Math.min(tB, lf);
    });
    var c1 = tA + 6, n = Math.floor((tB - 6 - c1) / 3);
    return n >= 3 ? { c1: c1, c2: c1 + n * 3, n: n, tA: tA, tB: tB } : null;
  }
  /* 推理泳道（?mode=infer）：一批请求先 prefill——提示词切成 4 块，逐段流水（每块 3 格）；首 token 出来之后进 decode——
     PP 路请求轮流在飞（M = PP，流水刚好灌满），每个 token 过每一段 1 格，上一个 token 从末段出来下一个才能从首段进。
     依赖驱动的列表调度，与训练 1F1B 同一套写法；稳态 decode 一轮 = PP 格，折叠长度取它的整数倍。 */
  function schedInfer(P) {
    var C = 4, N = 24, M = P, ops = [], free = [], out = [], done = {}, p, i;
    for (p = 0; p < P; p++) {
      var q = [];
      for (i = 0; i < C; i++) q.push(['P', i, 0]);
      for (var t = 0; t < N; t++) for (var m = 0; m < M; m++) q.push(['D', m, t]);
      ops.push(q); free.push(0); out.push([]);
    }
    for (var guard = 0; guard < P * (C + N * M) * 3; guard++) {
      var moved = false;
      for (p = 0; p < P; p++) {
        var op = ops[p][0]; if (!op) continue;
        var dep = p > 0 ? done[(p - 1) + ':' + op.join(',')]
          : op[0] === 'P' ? 0 : op[2] === 0 ? done[(P - 1) + ':P,' + (C - 1) + ',0'] : done[(P - 1) + ':D,' + op[1] + ',' + (op[2] - 1)];
        if (dep === undefined) continue;
        var st = Math.max(free[p], dep), en = st + (op[0] === 'P' ? 3 : 1);
        done[p + ':' + op.join(',')] = en; free[p] = en;
        out[p].push({ k: op[0], m: op[1], t: op[2], s: st, e: en }); ops[p].shift(); moved = true;
      }
      if (!moved) break;
    }
    var pe = 0; out[P - 1].forEach(function (b) { if (b.k === 'P') pe = b.e; });
    return { lanes: out, T: Math.max.apply(null, free), prefillEnd: pe, N: N, C: C };
  }
  function swimFoldInfer(S, P) {
    var tA = 0, tB = Infinity;
    S.lanes.forEach(function (L) {
      var fd = null, ld = null;
      L.forEach(function (x) { if (x.k === 'D') { if (fd == null) fd = x.s; ld = x.e; } });
      if (fd != null) tA = Math.max(tA, fd); if (ld != null) tB = Math.min(tB, ld);
    });
    var c1 = tA + 2 * P, n = Math.floor((tB - 2 * P - c1) / P);
    return n >= 3 ? { c1: c1, c2: c1 + n * P, n: n, tA: tA, tB: tB } : null;
  }
  /* ── 泳道画法：复用并行拓扑工作台（combo-workbench/swimlane.html「MB07 生命周期泳道」）那一套（反馈「泳道的样式尽量复用
     之前并行拓扑工作台的泳道」）——同一份设计系统组件 vendor/swimlane-task/pattern.js 的 drawTaskBar 画条（淡底 + 实色 + 顶 1px
     高光 + 细边），条内同样的 chevron 细线表示方向（前向 › / 反向 ‹）、条宽够就写标签；左侧同样的圆角对象标签「PP0 · L0–5」；
     行高 / 条高同一套比例（22 / 16，这里压到 20 / 14）、隔行底纹、行分隔线、刻度竖线；空闲的行首 / 行尾同样铺一截大号 › / ‹
     纹理（等上游 Activations / 等下游梯度）；Comm 与工作台一样用绿色块；色值取工作台 COLORS（forward #4369EF / backward #FF4B7B /
     comm #04D793）。
     保留本页的两条：稳态折叠（「⋯ 20 μb ⋯」）与去色——工作台自己的「聚焦」画法是非聚焦事件整体换成中性灰、37% 不透明，
     本页默认就处在这种聚焦态：只有关键点（聚焦 / 选中的那一段、选中 rank、指针所在的那个 μb）上工作台的实色，其余一律中性灰。 */
  /* 10.16 颜色只表示状态（审计：前向蓝 = DP 维度蓝、反向 #FF4B7B 贴着告警红）：选中那一行的计算块用选中色（前向白、反向浅灰，方向靠 › ‹ 纹理），
     其余行中性灰；Comm 块用它所属维度的签名色——P2P 属 PP、梯度同步属 DP，同 NPU / Network Graph 里那两维一个颜色 */
  var SW_COL = { forward: '#F2F2F2', backward: '#B8B8BA', comm: '#F472B6', dp: '#4369EF', muted: '#5C5C5E' };
  var swimHover = null, swimGeo = null;
  function swimFont(w, px) { return w + ' ' + px + 'px ' + (getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace'); }
  function swimRR(ctx, x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
  // 工作台 drawChevronTrack：条内等距的方向细线
  function swimChevrons(ctx, x, y, w, h, dir, color) {
    if (w <= 0) return;
    var step = 6, inset = .65;
    ctx.save(); swimRR(ctx, x, y, w, h, 3); ctx.clip();
    ctx.strokeStyle = color; ctx.lineWidth = .55; ctx.lineJoin = 'miter';
    for (var px = x - step; px < x + w + step; px += step) {
      ctx.beginPath();
      if (dir > 0) { ctx.moveTo(px + inset, y + inset); ctx.lineTo(px + step - inset, y + h / 2); ctx.lineTo(px + inset, y + h - inset); }
      else { ctx.moveTo(px + step - inset, y + inset); ctx.lineTo(px + inset, y + h / 2); ctx.lineTo(px + step - inset, y + h - inset); }
      ctx.stroke();
    }
    ctx.restore();
  }
  // 工作台 drawLaneGlyphTrack：行首 / 行尾空闲处的一截大号 › / ‹ 纹理
  function swimGlyphs(ctx, x, y, w, h, dir, color) {
    if (w <= 4) return;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = color; ctx.globalAlpha = .32; ctx.font = swimFont('800', 17); ctx.textBaseline = 'middle';
    var g = dir > 0 ? '›' : '‹', st = ctx.measureText(g).width + 3;
    for (var px = x + 3; px < x + w + st; px += st) ctx.fillText(g, px, y + h / 2 + .5);
    ctx.restore();
  }
  function renderSwim() {
    if (!drawerBody || drawerOpen !== 'swimlane') return;
    var C = lastCluster, M = C && C.model ? C.model.ga : null, P = PS.pp;
    if (!M) { drawerBody.innerHTML = '<div class="sw-wait">…</div>'; return; }
    var INF = MODE === 'infer';
    if (!swimCache || swimCache.P !== P || swimCache.M !== M || swimCache.inf !== INF) swimCache = { P: P, M: M, inf: INF, S: INF ? schedInfer(P) : sched1F1B(P, M) };
    var S = swimCache.S, T = S.T, lps = C.model.lps || Math.round(C.model.layers / P), F = INF ? swimFoldInfer(S, P) : swimFold(S);
    var W = Math.max(360, drawerBody.clientWidth - 32), GUT = 150, HEAD = 26, RH = 20, BH = 14, G = F ? 46 : 0;
    var cut = F ? F.c2 - F.c1 : 0, sx = (W - GUT - 10 - G) / (T - cut);
    var X = function (t) { return GUT + (F && t > F.c1 ? (t >= F.c2 ? (t - cut) * sx + G : F.c1 * sx + G * (t - F.c1) / cut) : t * sx); };
    var fp = curSel != null ? coordOfRank(curSel).pp : focusPP, H = HEAD + P * RH + 2;
    var cv = drawerBody.querySelector('canvas.sw-cv');
    if (!cv) {
      drawerBody.innerHTML = '<div class="sw-wrap"><canvas class="sw-cv"></canvas><div class="sw-legend"></div><div class="sw-tip" hidden></div></div>';
      cv = drawerBody.querySelector('canvas.sw-cv');
    }
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px';
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    var TXT = 'rgba(255,255,255,.90)', MUT = 'rgba(255,255,255,.40)', SUB = 'rgba(255,255,255,.06)';
    var hm = swimHover && swimHover.key, bars = [];
    // 表头：相位（工作台是 ms 刻度，本页的时间是相对格数，改写成相位名）+ 相位分界竖线
    var tA = F ? F.tA : T * 0.2, tB = F ? F.tB : T * 0.8;
    var ph = INF ? [['Prefill', 0, S.prefillEnd], ['Decode', S.prefillEnd, T]] : [['Warmup', 0, tA], ['Steady 1F1B', tA, tB], ['Cooldown', tB, T]];
    ctx.font = swimFont('600', 11); ctx.fillStyle = TXT; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText('Lane / Object', 10, HEAD / 2);
    ph.forEach(function (q, i) {
      var x1 = X(q[1]);
      if (i) { ctx.strokeStyle = SUB; ctx.beginPath(); ctx.moveTo(Math.round(x1) + .5, HEAD - 6); ctx.lineTo(Math.round(x1) + .5, H); ctx.stroke(); }
      ctx.font = swimFont('500', 10); ctx.fillStyle = MUT; ctx.fillText(q[0], x1 + 4, HEAD / 2);
    });
    if (F) {
      var fx = X(F.c1) + G / 2;
      ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,.62)'; ctx.fillText('⋯ ' + F.n + ' ' + (INF ? 'token' : 'μb') + ' ⋯', fx, HEAD / 2 + 9);
      ctx.textAlign = 'left';
    }
    ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.beginPath(); ctx.moveTo(0, HEAD - .5); ctx.lineTo(W, HEAD - .5); ctx.stroke();
    for (var p = 0; p < P; p++) {
      var y = HEAD + p * RH, by = y + (RH - BH) / 2, isR = curSel != null && p === fp, key = fp != null && p === fp;
      // 隔行底纹 + 行分隔线（工作台同款）
      if (p % 2) { ctx.fillStyle = 'rgba(255,255,255,.035)'; ctx.fillRect(0, y, W, RH); }
      if (key) { ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(0, y, W, RH); }
      ctx.strokeStyle = SUB; ctx.beginPath(); ctx.moveTo(0, y + RH - .5); ctx.lineTo(W, y + RH - .5); ctx.stroke();
      // 左侧对象标签：圆角胶囊「PP0 · L0–5」+ 语义（选中 rank 时写 rank 号）
      ctx.font = swimFont('650', 10);
      var tag = 'PP' + p + ' · L' + (p * lps) + '–L' + ((p + 1) * lps - 1), tw = ctx.measureText(tag).width + 14, th = 16, ty = y + (RH - th) / 2;
      swimRR(ctx, 10, ty, tw, th, 6); ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fill();
      ctx.strokeStyle = key ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.16)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = key || fp == null ? TXT : 'rgba(255,255,255,.55)'; ctx.fillText(tag, 17, ty + th / 2 + .25);
      if (isR) { ctx.font = swimFont('600', 10); ctx.fillStyle = TXT; ctx.fillText('rank ' + curSel, 10 + tw + 8, y + RH / 2 + .25); }
      var L = S.lanes[p], fwdK = INF ? 'P' : 'F', firstF = null, lastB = null;
      L.forEach(function (b0) { if (b0.k === fwdK && firstF == null) firstF = b0.s; if (b0.k === 'B') lastB = b0.e; });
      // 行首 / 行尾空闲纹理：等上游 Activations（›）、等下游梯度（‹）
      if (firstF > 0) swimGlyphs(ctx, GUT, by, X(firstF) - GUT - 2, BH, 1, key ? SW_COL.forward : SW_COL.muted);
      if (lastB != null && lastB < T) swimGlyphs(ctx, X(lastB) + 2, by, X(T) - X(lastB) - 2, BH, -1, key ? SW_COL.backward : SW_COL.muted);
      if (F) { ctx.font = swimFont('700', 11); ctx.fillStyle = key ? 'rgba(255,255,255,.7)' : 'rgba(255,255,255,.28)'; ctx.textAlign = 'center'; ctx.fillText('⋯', X(F.c1) + G / 2, y + RH / 2); ctx.textAlign = 'left'; }
      L.forEach(function (b) {
        var segs = !F || b.e <= F.c1 || b.s >= F.c2 ? [[b.s, b.e]] : b.s >= F.c1 && b.e <= F.c2 ? [] : [[b.s, Math.min(b.e, F.c1)], [Math.max(b.s, F.c2), b.e]].filter(function (q) { return q[1] - q[0] > 0 && (q[1] <= F.c1 || q[0] >= F.c2); });
        var fwd = b.k === 'F' || b.k === 'P' || b.k === 'D', mk = (b.k === 'D' ? 'd' : b.k === 'P' ? 'p' : 'm') + b.m;
        var hot = key || (hm != null && hm === mk), col = hot ? (fwd && b.k !== 'D' ? SW_COL.forward : SW_COL.backward) : SW_COL.muted;
        var lab = b.k === 'P' ? 'P' + (b.m + 1) : b.k === 'D' ? 't' + b.t : b.k + b.m;
        segs.forEach(function (q) {
          var x1 = X(q[0]) + .5, w = Math.max(2, X(q[1]) - x1 - 1);
          ctx.save(); if (!hot) ctx.globalAlpha = .38;
          if (window.PtoSwimlaneTaskPattern) window.PtoSwimlaneTaskPattern.drawTaskBar(ctx, { x: x1, y: by, width: w, height: BH, baseColor: col, task: { label: lab }, isSelected: hot && hm === mk, isEmphasized: hot, fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace' });
          else { swimRR(ctx, x1, by, w, BH, 3); ctx.fillStyle = col; ctx.fill(); }
          swimChevrons(ctx, x1, by, w, BH, b.k === 'B' ? -1 : 1, hot ? 'rgba(0,0,0,.32)' : 'rgba(142,142,144,.38)');
          ctx.restore();
          bars.push({ x: x1, y: by, w: w, h: BH, p: p, b: b, mk: mk });
        });
        // 选中 rank 那一段：段边界的 P2P（工作台的绿色 Comm 块，这里压成 3px 窄条贴在条的收 / 发两端）
        if (isR && segs.length === 1 && segs[0][0] === b.s && segs[0][1] === b.e) {
          var recv = fwd ? p > 0 : p < P - 1, send = fwd ? p < P - 1 : p > 0;
          ctx.fillStyle = SW_COL.comm;
          if (recv) { swimRR(ctx, X(b.s) - 1, by - 1, 3, BH + 2, 1.5); ctx.fill(); }
          if (send) { swimRR(ctx, X(b.e) - 2.5, by - 1, 3, BH + 2, 1.5); ctx.fill(); }
        }
      });
      if (isR && !INF) {
        var tEnd = L[L.length - 1].e, dx = X(tEnd) + 2, dw = Math.max(20, X(T) - dx);
        if (window.PtoSwimlaneTaskPattern) window.PtoSwimlaneTaskPattern.drawTaskBar(ctx, { x: dx, y: by, width: dw, height: BH, baseColor: SW_COL.dp, task: { label: 'DP AllReduce' }, isEmphasized: true, fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace' });
        bars.push({ x: dx, y: by, w: dw, h: BH, p: p, dp: true });
      }
    }
    // 推理：首 token 那一刻（TTFT）一根竖虚线
    if (INF) { var mx = Math.round(X(S.prefillEnd)) + .5; ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.35)';   /* 虚线一律改实线（10.12） */ ctx.beginPath(); ctx.moveTo(mx, HEAD - 6); ctx.lineTo(mx, H); ctx.stroke(); ctx.restore(); }
    // 分隔：对象列与时间轴之间一根竖线（工作台同款）
    ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.beginPath(); ctx.moveTo(GUT - 6.5, 0); ctx.lineTo(GUT - 6.5, H); ctx.stroke();
    swimGeo = { HEAD: HEAD, RH: RH, P: P, bars: bars, W: W };
    // 图例（工作台 .legend：色块 + 名称；前向 / 反向色块带 chevron 纹理）
    var busy = M * 3, idle = T - busy, lg = drawerBody.querySelector('.sw-legend');
    lg.innerHTML = (INF
      ? '<span><i class="is-flow is-forward" style="--legend-color:' + SW_COL.forward + '"></i>Prefill</span><span><i class="is-flow is-backward" style="--legend-color:' + SW_COL.backward + '"></i>Decode</span>'
        + '<span><i style="--legend-color:' + SW_COL.comm + '"></i>P2P</span><span><i class="is-dash"></i>TTFT</span>'
        + '<span class="sw-kv">TTFT <b>424 ms</b> · TPOT <b>96 ms</b> · In-flight ' + P + '</span>'
      : '<span><i class="is-flow is-forward" style="--legend-color:' + SW_COL.forward + '"></i>Forward</span><span><i class="is-flow is-backward" style="--legend-color:' + SW_COL.backward + '"></i>Backward</span>'
        + '<span><i style="--legend-color:' + SW_COL.comm + '"></i>P2P</span><span><i style="--legend-color:' + SW_COL.dp + '"></i>DP AllReduce</span><span><i class="is-idle">›‹</i>Idle</span>'
        + '<span class="sw-kv">Bubble <b>' + pct(idle / busy) + '</b> · μb ' + M + '</span>')
      + '<em title="' + (INF ? 'prefill 一块按 3 格、decode 一个 token 过一段按 1 格：相对时长；TTFT/TPOT 取自盘古 Pro MoE 技术报告，只当量级参考' : '时间以一个 μb 的前向为 1、反向按 2 计：相对时长，不是实测') + '">' + (INF ? 'In-flight = PP' : 'Backward = 2× Forward') + '</em>';
  }
  function swimHit(ev) {
    var cv = drawerBody.querySelector('canvas.sw-cv'); if (!cv || !swimGeo) return null;
    var r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    var bar = null; for (var i = swimGeo.bars.length - 1; i >= 0; i--) { var q = swimGeo.bars[i]; if (x >= q.x && x <= q.x + q.w && y >= q.y - 2 && y <= q.y + q.h + 2) { bar = q; break; } }
    var row = y >= swimGeo.HEAD ? Math.floor((y - swimGeo.HEAD) / swimGeo.RH) : -1;
    return { bar: bar, row: row >= 0 && row < swimGeo.P ? row : -1, x: x, y: y };
  }
  function swimClick(ev) {
    var h9 = swimHit(ev); if (!h9 || h9.row < 0) return;
    var p = h9.row;
    if (curSel != null && coordOfRank(curSel).pp === p) return;
    if (curSel == null && focusPP === p) { focusSegment(null); return; }
    if (curSel != null) showOverview(true);
    focusSegment(p);
  }
  drawerBody && drawerBody.addEventListener('mousemove', function (ev) {
    if (drawerOpen !== 'swimlane') return;
    var h9 = swimHit(ev), tip = drawerBody.querySelector('.sw-tip'); if (!h9 || !tip) return;
    var nk = h9.bar && !h9.bar.dp ? h9.bar.mk : null;
    if ((swimHover && swimHover.key) !== nk) { swimHover = nk ? { key: nk } : null; renderSwim(); tip = drawerBody.querySelector('.sw-tip'); }
    drawerBody.querySelector('canvas.sw-cv').style.cursor = h9.row >= 0 ? 'pointer' : '';
    if (!h9.bar) { tip.hidden = true; return; }
    var b = h9.bar.b, t9 = h9.bar.dp ? 'DP AllReduce · grad sync' + (lastCluster && lastCluster.comm && lastCluster.comm.dp ? ' · ' + unitEN(lastCluster.comm.dp.txt) : '')
      : b.k === 'P' ? 'Prefill · chunk ' + (b.m + 1) : b.k === 'D' ? 'Decode · group ' + b.m + ' · token ' + b.t : (b.k === 'F' ? 'Forward' : 'Backward') + ' · μb ' + b.m;
    tip.innerHTML = '<b>PP' + h9.bar.p + '</b> ' + esc(t9) + (b ? '<span>t ' + b.s + ' → ' + b.e + '</span>' : '');
    tip.hidden = false; tip.style.left = Math.min(h9.x + 12, swimGeo.W - 220) + 'px'; tip.style.top = (h9.y + 14) + 'px';
  });
  drawerBody && drawerBody.addEventListener('mouseleave', function () {
    if (drawerOpen !== 'swimlane') return;
    var tip = drawerBody.querySelector('.sw-tip'); if (tip) tip.hidden = true;
    if (swimHover) { swimHover = null; renderSwim(); }
  });
  function renderPanel() { if (drawerOpen === 'hier') renderHier(); else if (drawerOpen === 'swimlane') renderSwim(); }
  function ensureCluster() { if (tier === 3 || level !== 'cluster') { showOverview(); } }
  drawerBody && drawerBody.addEventListener('click', function (ev) {
    var t = ev.target;
    if (drawerOpen === 'swimlane') { swimClick(ev); return; }
    if (t.closest('[data-hact="root"]')) { physZP.reset(); showOverview(); return; }
    var spb = t.closest('[data-hsp]');
    if (spb) { ensureCluster(); var el = physStage.querySelector('.p-sp[data-sp="' + spb.getAttribute('data-hsp') + '"]'); if (el) physZP.fitVB(+el.getAttribute('x'), +el.getAttribute('y'), +el.getAttribute('width'), +el.getAttribute('height'), 30, true); return; }
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
    t.title = k < 0 ? '' : kind === 'pod' ? 'POD ' + k : kind === 'board' ? 'Board ' + k : 'rank ' + k + ' · ' + coordLine(k);
  });

  /* ── 配置浮层（工具条「配置」；反馈「对应的配置也要拿过来，简化显示」）──────────────────
     把 combo-workbench 顶栏的「并行配置 / 并行对象 / 数据标注」与矩阵本体设置面板里和本页
     相关的那几项，收成一张小浮层：
       并行配置 —— 预置切换（整页按 ?preset= 重载）+ ZeRO 档；切分五维只读显示
       并行对象 —— 选一维 + 一个下标，画布上只亮这一组（与选中 rank 互斥，选中时以选中为准）
       数据标注 —— 占用率着色 / rank 号 / Board 内关系 / Comm 组 四类，逐类开关
       NPU     —— 机位 3D·正视·侧视·顶视 与 Comm 连线开关，作用在下钻后的矩阵本体
     其余（搜索、观察层级、卡片内容、设备排列、图层……）是矩阵自己那一屏的事，不搬。 */
  var cfgPop = document.getElementById('cfgPop'), cfgOpen = false;
  var PRESET_ORDER = ['moe504b32k', 'moe718b128k', 'pangu', 'incident2048', 'dense64'];
  function segBtns(attr, items, cur) {
    return '<div class="cf-seg">' + items.map(function (x) { return '<button type="button" data-' + attr + '="' + x[0] + '"' + (String(x[0]) === String(cur) ? ' class="is-on"' : '') + '>' + x[1] + '</button>'; }).join('') + '</div>';
  }
  /* 切分草稿：浮层里 ×2 / ÷2 调好，「应用」一次写进 URL 重载——物理图、组、泳道、矩阵、Network Graph、魔方全部按新的一组数重建 */
  var SPD = null;
  function renderCfg() {
    var curKey = PRESETS[qs.get('preset')] ? qs.get('preset') : 'moe504b32k';
    if (!SPD) SPD = { tp: PS.tp, cp: PS.cp, pp: PS.pp, dp: PS.dp, ep: PS.ep };
    var dW = SPD.tp * SPD.cp * SPD.pp * SPD.dp, dirty = ['tp', 'cp', 'pp', 'dp', 'ep'].some(function (d) { return SPD[d] !== PS[d]; });
    var objDims = ['tp', 'cp', 'ep', 'dp', 'pp'].filter(function (d) { return objSize(d) > 1; });
    var od = OBJ.dim, n9 = od ? objSize(od) : 0;
    cfgPop.innerHTML = '<div class="cf-sec"><div class="cf-k">并行配置</div>'
      + '<select class="cf-sel" data-cf="preset">' + PRESET_ORDER.filter(function (k) { return PRESETS[k]; }).map(function (k) { return '<option value="' + k + '"' + (k === curKey ? ' selected' : '') + '>' + esc(PRESETS[k].modelName) + '</option>'; }).join('') + '</select>'
      + '<div class="cf-split">' + ['tp', 'cp', 'pp', 'dp', 'ep'].map(function (d) {
          return '<div class="cf-sp"><span>' + d.toUpperCase() + '</span><button type="button" data-sp="' + d + '" data-sx="0.5">−</button><b' + (SPD[d] !== PS[d] ? ' class="is-mod"' : '') + '>' + SPD[d] + '</b><button type="button" data-sp="' + d + '" data-sx="2">+</button></div>';
        }).join('') + '</div>'
      + '<div class="cf-line cf-all"><span>World ' + dW + '</span><button type="button" data-spapply="1"' + (dirty ? '' : ' disabled') + '>应用</button><button type="button" data-spreset="1"' + (PS.custom || dirty ? '' : ' disabled') + '>复位</button></div>'
      + (splitErr ? '<div class="cf-err">' + esc(splitErr.errors[0].replace(/（[^）]*）/g, '')) + (splitErr.fixes && splitErr.fixes.length ? '<br>' + esc(splitErr.fixes.slice(0, 3).join(' · ')) : '') + '</div>' : '')
      + '<div class="cf-line"><span>ZeRO</span>' + segBtns('zero', [[0, '0'], [1, '1'], [2, '2'], [3, '3']], ZERO) + '</div></div>'
      + '<div class="cf-sec"><div class="cf-k">并行对象</div>'
      + segBtns('odim', [['', '无']].concat(objDims.map(function (d) { return [d, d.toUpperCase()]; })), od || '')
      + (od ? '<div class="cf-line cf-step"><button type="button" data-ostep="-1">‹</button><b>' + od + ' ' + OBJ.idx + '</b><span>/ ' + n9 + '</span><button type="button" data-ostep="1">›</button></div>' : '') + '</div>'
      + '<div class="cf-sec"><div class="cf-k">数据标注</div>'
      + [['occ', 'Usage'], ['num', 'rank'], ['rel', 'On-board'], ['grp', 'Comm Group']].map(function (x) { return '<label class="cf-chk"><input type="checkbox" data-ann="' + x[0] + '"' + (ANN[x[0]] ? ' checked' : '') + '><span>' + x[1] + '</span></label>'; }).join('') + '</div>'
      + '<div class="cf-sec"><div class="cf-k">数据卡</div>'
      + '<div class="cf-line"><span>工况</span>' + segBtns('mode', [['train', 'Train'], ['infer', 'Inference']], MODE) + '</div>'
      + '<div class="cf-grid">' + DCT.map(function (x) { return '<label class="cf-chk"><input type="checkbox" data-dk="' + x[0] + '"' + (DCK[x[0]] ? ' checked' : '') + '><span>' + x[1] + '</span></label>'; }).join('') + '</div>'
      + '<div class="cf-line cf-all"><button type="button" data-dall="1">全开</button><button type="button" data-dall="0">全关</button></div></div>'
      + '<div class="cf-sec"><div class="cf-k">NPU</div>'
      + '<div class="cf-line"><span>机位</span>' + segBtns('cam', [['3d', '3D'], ['top', '顶视']], DV.vtab) + '</div>'
      + '<div class="cf-line"><span>兄弟</span>' + segBtns('sibs', [['ghost', '隐约'], ['on', '展开']], DV.sibs) + '</div>'
      + '<label class="cf-chk"><input type="checkbox" data-dvcomm="1"' + (DV.comm ? ' checked' : '') + '><span>Comm Links</span></label>'
      + (DV.comm ? '<div class="cf-line cf-ck">' + ['tp', 'cp', 'ep', 'pp', 'dp'].map(function (k) { return '<label class="cf-chk"><input type="checkbox" data-dvck="' + k + '"' + (DV.commk[k] ? ' checked' : '') + '><span>' + k.toUpperCase() + '</span></label>'; }).join('') + '</div>' : '') + '</div>';
  }
  function toggleCfg(on) {
    cfgOpen = on == null ? !cfgOpen : on;
    if (cfgOpen) renderCfg();
    cfgPop.classList.toggle('is-hidden', !cfgOpen);
    dock.querySelectorAll('[data-pop="cfg"]').forEach(function (b) { b.classList.toggle('is-on', cfgOpen); });
  }
  function applyAnn() { ['occ', 'num', 'rel'].forEach(function (k) { document.body.classList.toggle('ann-no' + k, !ANN[k]); }); }
  /* NPU 层的开关不重载矩阵：已就绪就发 pto:solo 原地换，同时把 detailSrc 改成等价的新地址
     （之后 loadDetail 同一张 NPU 不会因为地址变了再加载一遍）；还没就绪就走地址。 */
  function refreshDetail(camOnly) {
    if (tier !== 3 && !detailSrc) return;
    if (detailReady && !camOnly && detailFrame.contentWindow) {
      detailFrame.contentWindow.postMessage({ type: 'pto:solo', sibs: DV.sibs, comm: DV.comm, commk: DV.commk, rankview: DV.rv }, '*');
      detailSrc = matrixSrcFor(curSel);
    } else if (tier === 3) loadDetail(curSel);
    syncSoloDock();
  }
  function saveDV() {
    setQS('comm3', DV.comm ? '1' : ''); setQS('sibs', DV.sibs === 'on' ? 'on' : ''); setQS('rv3', DV.rv === 'mem' ? '' : DV.rv);
    var ck = ['tp', 'cp', 'ep', 'pp', 'dp'].filter(function (k) { return DV.commk[k]; });
    setQS('commk3', ck.length === 5 ? '' : ck.join(','));
  }
  function adoptSolo(r, brief) {
    curSel = r; pendingMatrixSel = r; focusPP = coordOfRank(r).pp;
    // 从板视图下钻进来的：换选的兄弟可能在另一块 Board 上，面包屑里的「板 N」跟着它走（否则回去落到旧板、选中被清掉）
    if (backLevel === 'board') curBoard = physOf(r).board;
    detailSrc = matrixSrcFor(r);
    detailFrame.contentWindow && detailFrame.contentWindow.postMessage({ type: 'pto:solo', stitle: PS.modelName + ' / ' + TIER2_LABEL + ' / rank ' + r }, '*');
    cueDetail('stack');   // 换到兄弟 rank：它的板同样逐档码上去
    if (brief) renderBrief(brief);
    physApplySelection(); renderLeftCard(); renderCrumb();
  }
  function syncSoloDock() {
    dock.querySelectorAll('[data-solo]').forEach(function (b) {
      var k = b.getAttribute('data-solo');
      b.classList.toggle('is-on', k === 'sibs' ? DV.sibs === 'on' : DV.comm);
    });
    dock.querySelectorAll('[data-rv]').forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-rv') === DV.rv); });
  }
  dock.addEventListener('click', function (ev) {
    var rv = ev.target.closest('[data-rv]');
    if (rv) { DV.rv = rv.getAttribute('data-rv'); saveDV(); refreshDetail(); cueDetail('stack'); return; }
    var b = ev.target.closest('[data-solo]'); if (!b) return;
    if (b.getAttribute('data-solo') === 'sibs') DV.sibs = DV.sibs === 'on' ? 'ghost' : 'on';
    else DV.comm = !DV.comm;
    saveDV(); refreshDetail(); if (cfgOpen) renderCfg();
  });
  cfgPop.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.getAttribute('data-cf') === 'preset') { saveBase(true); var u = new URLSearchParams(location.search); u.set('preset', t.value); ['sel', 'obj', 'zero'].forEach(function (k) { u.delete(k); }); location.search = u.toString(); return; }
    var a = t.getAttribute('data-ann');
    if (a) { ANN[a] = t.checked; setQS('hide', ['occ', 'num', 'rel', 'grp'].filter(function (k) { return !ANN[k]; }).join(',')); applyAnn(); physApplySelection(); return; }
    if (t.hasAttribute('data-dvcomm')) { DV.comm = t.checked; saveDV(); refreshDetail(); renderCfg(); }
    var ck9 = t.getAttribute('data-dvck');
    if (ck9) { DV.commk[ck9] = t.checked; saveDV(); refreshDetail(); }
    var dk = t.getAttribute('data-dk');
    if (dk) { DCK[dk] = t.checked; saveDCK(); }
  });
  function saveDCK() {
    setQS('dhide', DCT.filter(function (x) { return !DCK[x[0]]; }).map(function (x) { return x[0]; }).join(','));
    renderDataCards(); if (lastBrief && tier === 3) renderBrief(lastBrief);
  }
  cfgPop.addEventListener('click', function (ev) {
    var b;
    if ((b = ev.target.closest('[data-zero]'))) { setZero(+b.getAttribute('data-zero')); renderCfg(); return; }
    if ((b = ev.target.closest('[data-odim]'))) { var d = b.getAttribute('data-odim') || null; OBJ = { dim: d, idx: 0 }; setQS('obj', d ? d + ':0' : ''); if (d && curSel != null) showOverview(true); physApplySelection(); renderCfg(); return; }
    if ((b = ev.target.closest('[data-ostep]')) && OBJ.dim) { var n = objSize(OBJ.dim); OBJ.idx = (OBJ.idx + +b.getAttribute('data-ostep') + n) % n; setQS('obj', OBJ.dim + ':' + OBJ.idx); physApplySelection(); renderCfg(); return; }
    if ((b = ev.target.closest('[data-mode]'))) { setMode(b.getAttribute('data-mode')); return; }
    if ((b = ev.target.closest('[data-dall]'))) { var on9 = b.getAttribute('data-dall') === '1'; DCT.forEach(function (x) { DCK[x[0]] = on9; }); saveDCK(); renderCfg(); return; }
    if ((b = ev.target.closest('[data-sp]'))) { var d8 = b.getAttribute('data-sp'), v8 = Math.round(SPD[d8] * +b.getAttribute('data-sx')); if (v8 >= 1 && v8 <= 4096) SPD[d8] = v8; renderCfg(); return; }
    if ((b = ev.target.closest('[data-spapply]')) || (b = ev.target.closest('[data-spreset]'))) {
      var u8 = new URLSearchParams(location.search), base8 = PRESETS[qs.get('preset')] || PRESETS.moe504b32k, reset8 = b.hasAttribute('data-spreset');
      ['tp', 'cp', 'pp', 'dp', 'ep'].forEach(function (d) { var v = reset8 ? null : SPD[d]; if (v == null || v === (base8[d] || 1)) u8.delete(d); else u8.set(d, String(v)); });
      ['sel', 'obj'].forEach(function (k) { u8.delete(k); });
      saveBase(true); location.search = u8.toString(); return;
    }
    if ((b = ev.target.closest('[data-sibs]'))) { DV.sibs = b.getAttribute('data-sibs'); saveDV(); refreshDetail(); renderCfg(); return; }
    if ((b = ev.target.closest('[data-cam]'))) { DV.vtab = b.getAttribute('data-cam'); setQS('cam', DV.vtab === '3d' ? '' : DV.vtab); refreshDetail(true); renderCfg(); }
  });
  document.addEventListener('pointerdown', function (ev) { if (cfgOpen && !ev.target.closest('#cfgPop, [data-pop="cfg"]')) toggleCfg(false); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && cfgOpen) toggleCfg(false); });
  applyAnn();
  syncSoloDock();

  /* ── 数据卡（反馈「训练/推理过程中要看哪些数据、不同大小看哪些数据，做成悬浮小卡飘在四周，
     设置里能按类型开关——非常重要」+「把并行拓扑里点开 rank 的那张 NPU 拆开，每个小切分和对应的数值
     做成单独的 NPU，放在 NPU 视图四周」）──────────────────────────────────────────────
     调研（仓库里的研究笔记 + 并行拓扑/Network Graph/泳道已有的数据开关）归成九类，设置里逐类开关，
     URL ?dhide=键,键；工况 训练 / 推理 用 ?mode=infer 切。每张 NPU 右上角一个小标，说清这数是什么口径：
       实算 —— 并行拓扑矩阵本体算的（ptoClusterBrief / ptoRankBrief，与矩阵同一批函数）
       假设 —— 落位按 rank 连续摆放推的（配置里没有 rank→NPU 映射）
       示意 —— 不是这套硬件/这次训练的实测：步时分解与推理指标取自盘古 Pro MoE 技术报告
                （src/scene/data.ts 的 STEP_DECOMP / WORKLOAD，Ascend 800I A2），只当量级参考
     哪一层出哪几张（主卡默认开）：
       集群   容量分布 · Comm 闭合 · 流水气泡 · 步时分解（训练）/ 推理指标（推理）
       POD    POD 负载 · 本级闭合
       板     八卡占用 · 板载配对
       rank   Comm 载荷（显存构成 / 位置 / Comm 组已在右卡）
       NPU   右卡那份读出拆成一张张小卡，贴在 3D 卡两侧：左边模型态（权重 → 逐块切分、梯度、
              优化器态），右边执行态（Activations、优化器步临时区、碎片）+ 各维 Comm 载荷 + 流水 */
  var DCT = [['cap', 'Capacity'], ['state', '显存'], ['wshard', '权重切分'], ['comm', 'Comm'], ['pipe', 'Pipeline'],
    ['thr', 'Throughput'], ['step', 'Step Time'], ['moe', 'MoE'], ['health', 'Training Health'], ['pub', 'Reference'],
    ['phys', 'On-board'], ['infer', 'Inference'], ['inc', '历史事故'], ['cmp', 'Before / After']];
  var DCK = (function () { var h = (qs.get('dhide') || '').split(','), o = {}; DCT.forEach(function (x) { o[x[0]] = h.indexOf(x[0]) < 0; }); return o; })();
  var MODE = qs.get('mode') === 'infer' ? 'infer' : 'train';
  var dataCol = document.getElementById('dataCol'), shardL = document.getElementById('shardL');

  /* ── 目的导向的引导（反馈「不喜欢步骤条，要以任务为导向 / 以告警定位为导向，按用户的目的来引导」）────────────
     标题正上方居中一枚玻璃胶囊：左边工况（Train / Inference），右边几个「我要做什么」——没有序号、没有先后，
     谁来都先看自己要的那一件。第一个永远是「定位告警」：角标是当前要处理的告警数；点开在胶囊下面列出告警，
     按严重度排（超容 → 红线 → 数值 / 路由告警层 → 气泡 → 参考读数 → 历史故障复盘），每条一句「是什么 · 在哪」，
     点一下直接定位：到那张 NPU（下钻 rank）、到那一段（PP 段聚焦）、或展开那条故障链。
     其余几个目的：点了只留这件事用得上的数据卡，画布 / 面板切到该看的地方，下面一行灰字是这件事要回答的问题；
     再点一次 = 回到全部。URL ?goal=键。NPU 层（第三档）不按目的收卡。 */
  /* 场景而不是数据类型（反馈「这里应该是场景，而不是按数据类型」）：每个场景是用户在训练 / 推理里的一件事，
     点开后把这件事要用到的几类数据一起摆出来（容量、Comm、流水……跨类组合），画布 / 面板切到该看的地方。 */
  var GOALS = {
    train: [
      { k: 'alert', n: '故障定位', q: '', cards: ['cap', 'state', 'health', 'moe', 'pipe', 'inc'], go: 'alerts' },
      { k: 'plan', n: '切分规划', q: '这套切分装得下吗？每一维 Comm 在哪一层闭合？', cards: ['cap', 'state', 'wshard', 'comm', 'pipe'], go: 'hier' },
      { k: 'map', n: '设备映射', q: '每个 rank 落在哪张物理卡上？同一组的卡挨不挨着？', cards: ['comm', 'phys', 'cap'], go: 'map' },
      { k: 'perf', n: '性能调优', q: 'Throughput、Step Time、Bubble、MoE 负载正常吗？慢在哪一段？', cards: ['thr', 'step', 'pipe', 'moe', 'health'], go: 'swim' },
      { k: 'tune', n: '变更评估', q: '改了 ZeRO / 切分 / 预置之后，变好还是变差？', cards: ['cmp', 'cap', 'state', 'step', 'thr', 'pipe'], go: 'cfg' }
    ],
    infer: [
      { k: 'alert', n: '故障定位', q: '', cards: ['cap', 'state', 'moe', 'infer'], go: 'alerts' },
      { k: 'plan', n: '部署规划', q: '权重 + KV Cache 放得下吗？Batch 还能加多少？', cards: ['cap', 'state', 'wshard', 'comm'], go: 'hier' },
      { k: 'perf', n: '时延优化', q: 'TTFT、TPOT 达标吗？慢在 prefill 还是 decode？', cards: ['infer', 'moe', 'comm', 'state'], go: 'swim' },
      { k: 'tune', n: '扩缩评估', q: '加卡或改切分之后，装得下、够快吗？', cards: ['cmp', 'infer', 'cap', 'state', 'comm'], go: 'cfg' }
    ]
  };
  function stageOf(k) { return (GOALS[MODE] || []).filter(function (x) { return x.k === k; })[0] || null; }
  var STAGE = stageOf(qs.get('goal') || ''), stageObj = false, alertAt = -1;
  function stageShows(key) { return !STAGE || tier === 3 || STAGE.cards.indexOf(key) >= 0; }
  var journey = document.createElement('nav');
  journey.className = 'journey is-hidden'; journey.setAttribute('aria-label', '按目的引导');
  document.body.appendChild(journey);
  /* 告警清单：每条 {sev: crit|warn|info|past, t: 指标（英文）, w: 在哪, go: 定位} */
  /* 每个 PP 段自己的路由失衡 Peak：{ pp, v, at }（imbL 从 health.l0 那一层起逐层排）——告警清单、板视图连线标签、链路状态共用这一个口径 */
  function stageImb(M, H) {
    var lps = (lastCluster && lastCluster.model && lastCluster.model.lps) || 1, by = {};
    M.imbL.forEach(function (v, i) { var L = i + H.l0, s9 = Math.min(PS.pp - 1, Math.floor(L / lps)); if (!by[s9] || v > by[s9].v) by[s9] = { pp: s9, v: v, at: L }; });
    return Object.keys(by).map(function (k) { return by[k]; });
  }
  function computeAlerts() {
    var C = lastCluster, B = rawBrief, out = [];
    if (!C || !B || B.ok === false) return out;
    var lps = (C.model && C.model.lps) || 1, ppOf = function (l) { return Math.min(PS.pp - 1, Math.floor(l / lps)); };
    var goRank = function (r) { return function () { if (tier === 3) showOverview(true); showTier2(r, coordLine(r)); }; };
    var goSeg = function (pp) { return function () { if (tier !== 1 || curSel != null) showOverview(true); focusSegment(pp); }; };
    var wr = C.worst, wv = wr != null && C.ratio ? C.ratio[wr] : null;
    if (C.n && C.n.oom) out.push({ sev: 'crit', t: 'OOM · ' + C.n.oom + ' ranks', w: 'rank ' + wr + ' · ' + pct(wv), go: goRank(wr) });
    if (C.n && C.n.red) out.push({ sev: 'warn', t: 'Critical 88% · ' + C.n.red + ' ranks', w: 'rank ' + wr + ' · ' + pct(wv), go: goRank(wr) });
    if (MODE === 'infer' && B.infer && B.infer.bmax < B.infer.batch) {
      var sp9 = 0; B.infer.stages.forEach(function (x, i) { if (x.bmax < B.infer.stages[sp9].bmax) sp9 = i; });
      out.push({ sev: 'crit', t: 'KV Cache overflow · Max Batch ' + B.infer.bmax + ' < ' + B.infer.batch, w: 'PP' + sp9, go: goSeg(sp9) });
    }
    var P = B.perf, H = P && P.health, M = P && P.moe;
    if (H && MODE === 'train') {
      var hot = H.amaxL.map(function (v, i) { return [v, i + H.l0]; }).filter(function (x) { return x[0] > H.thrAmax; }).sort(function (a, b) { return b[0] - a[0]; });
      hot.slice(0, 3).forEach(function (x) { out.push({ sev: 'warn', t: 'Amax ' + x[0].toFixed(2) + ' > ' + H.thrAmax, w: 'L' + x[1] + ' · PP' + ppOf(x[1]), go: goSeg(ppOf(x[1])) }); });
      if (H.warn) out.push({ sev: 'info', t: '告警 Layers · ' + H.warn + ' / ' + H.n, w: 'Network Graph', go: function () { if (drawerOpen !== 'netgraph') openDrawer('netgraph'); } });
    }
    /* 路由失衡按 PP 段逐段报（同 Amax 的写法、带阈值）：原来只报全网最高那一层，别的段也越线时画布标了琥珀、清单里却没有 */
    if (M && H && M.imbL) {
      var ov = stageImb(M, H).filter(function (x) { return x.v > H.thrImb; }).sort(function (a, b) { return b.v - a.v; });
      // 一条汇总：Peak · 越线段数；「在哪」列出全部越线段（画布上哪一段标了琥珀，这里都能找到）
      if (ov.length) out.push({ sev: 'warn', t: 'Routing Imbalance ' + ov[0].v.toFixed(2) + '× > ' + H.thrImb + (ov.length > 1 ? ' · ' + ov.length + ' stages' : ''),
        w: ov.map(function (x) { return 'PP' + x.pp; }).join(' · '), go: goSeg(ov[0].pp) });
    }
    if (MODE === 'train' && B.bubble > 0.25) out.push({ sev: 'warn', t: 'Bubble ' + pct(B.bubble) + ' > 25%', w: 'PP ' + PS.pp + ' · GA ' + (C.model ? C.model.ga : '—'), go: function () { if (drawerOpen !== 'swimlane') openDrawer('swimlane'); } });
    if (wr != null && !(C.n && (C.n.oom || C.n.red))) out.push({ sev: 'info', t: 'Peak Usage ' + pct(wv), w: 'rank ' + wr, go: goRank(wr) });
    // 历史复盘：另一次 2048 NPU 训练的两起真实事故——是上面同类告警一路恶化下去的样子（显存类 ↔ 问题 1，路由 / 数值类 ↔ 问题 2）
    var REL = { 'problem-1': 'OOM · Critical · Peak Usage', 'problem-2': 'Routing Imbalance · Amax' };
    if (DCK.inc) INCIDENT_PROBLEMS.slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; }).forEach(function (pb) {
      out.push({ sev: 'past', t: pb.name.replace(/^问题\d+\s*·\s*/, ''), w: pb.events.length + ' 起', rel: REL[pb.id], pm: pb });
    });
    return out;
  }
  var SEV_RANK = { crit: 0, warn: 1, info: 2, past: 3 };
  function renderJourney() {
    var goals = GOALS[MODE] || [], AL = computeAlerts().sort(function (a, b) { return SEV_RANK[a.sev] - SEV_RANK[b.sev]; }), live = AL.filter(function (x) { return x.sev === 'crit' || x.sev === 'warn'; }).length;
    var worst = AL.reduce(function (m, x) { return Math.min(m, SEV_RANK[x.sev]); }, 9);
    journey.innerHTML = '<div class="jn-bar"><div class="jn-mode">'
      + [['train', 'Train'], ['infer', 'Inference']].map(function (x) { return '<button type="button" data-jmode="' + x[0] + '"' + (x[0] === MODE ? ' class="is-on"' : '') + '>' + x[1] + '</button>'; }).join('')
      + '</div><div class="jn-goals">' + goals.map(function (x) {
        var badge = x.k === 'alert' && live ? '<i class="jn-badge' + (worst === 0 ? ' is-crit' : '') + '">' + live + '</i>' : '';
        return '<button type="button" data-stage="' + x.k + '" class="' + (STAGE === x ? 'is-cur' : '') + (x.k === 'alert' ? ' jn-alert' : '') + '"' + (x.q ? ' title="' + esc(x.q) + '"' : '') + '>' + x.n + badge + '</button>';
      }).join('') + '</div></div>'
      + (STAGE && STAGE.k === 'alert'
        ? '<div class="jn-alerts">' + (AL.length ? AL.map(function (x, i) {
            /* 两类不是一回事（反馈「live 当前配置和真实事故的关系是什么？不是同样的就用简洁的名词概括」）：
               当前告警 = 按当前配置实时算出来的风险；历史事故 = 另一次 2048 NPU 训练里真实发生过的事故，是同类告警一路恶化下去的样子 */
            var head = i === 0 && x.sev !== 'past' ? '<div class="jn-sec" title="按当前配置实时算出来的风险">当前告警</div>' : x.sev === 'past' && (i === 0 || AL[i - 1].sev !== 'past') ? '<div class="jn-sec" title="另一次 2048 卡训练里真实发生过的事故——同类告警一路恶化下去的样子">历史事故</div>' : '';
            if (x.pm) {
              var op = !!incidentOpen[x.pm.id];
              return head + '<div class="jn-pm ip-grp' + (op ? ' is-open' : '') + '"><button type="button" class="jn-al is-past' + (op ? ' is-on' : '') + '" data-pm="' + x.pm.id + '"><i></i><b>' + esc(x.t) + '</b><span>' + esc(x.w) + '</span></button>'   /* 10.16：行尾不再写「展开 / 收起」（动词）；展开态由整行 is-on 表示 */
                + '<div class="jn-rel">同类告警 · ' + esc(x.rel || '') + '</div><div class="ip-chain">' + incidentChainHtml(x.pm) + '</div></div>';
            }
            return head + '<button type="button" class="jn-al is-' + x.sev + (i === alertAt ? ' is-on' : '') + '" data-alert="' + i + '"><i></i><b>' + esc(x.t) + '</b><span>' + esc(x.w) + '</span></button>';   // 10.16：行尾不再写「定位」（动词），整行可点
          }).join('') : '<div class="jn-none">没有告警</div>') + '</div>'
        : '');   // 场景下面那行问句不再出（反馈「不要胶囊下面那段话」），问句只留在场景按钮的悬停提示里
    journey._alerts = AL;
    journey.classList.toggle('is-hidden', world <= 64);
  }
  function stageGo(st) {
    if (stageObj) { stageObj = false; OBJ = { dim: null, idx: 0 }; setQS('obj', ''); physApplySelection(); }
    if (!st) return;
    var g = st.go;
    if (g === 'hier' || g === 'map') { if (tier !== 1 || level !== 'cluster') { physZP.reset(); showOverview(); } }
    // 每个目的只开它自己的参考面板，上一个留下的面板收起
    var want = g === 'hier' ? 'hier' : g === 'swim' ? 'swimlane' : null;
    if (g === 'swim' && tier === 3) showOverview(true);
    if (g !== 'alerts' && drawerOpen !== want) openDrawer(want);
    if (g === 'map') {
      var d9 = ['tp', 'ep', 'cp', 'dp'].filter(function (d) { return objSize(d) > 1; })[0];
      if (d9) { OBJ = { dim: d9, idx: 0 }; stageObj = true; setQS('obj', d9 + ':0'); physApplySelection(); }
    }
    if (g === 'cfg') toggleCfg(true);
    renderCfg();
  }
  function setStage(k) {
    var st = k ? stageOf(k) : null;
    if (st && st === STAGE) st = null;   // 再点一次当前那个目的 = 回到全部
    STAGE = st; alertAt = -1; setQS('goal', st ? st.k : '');
    stageGo(st);
    renderDataCards(); renderJourney();
  }
  function setMode(m) {
    MODE = m === 'infer' ? 'infer' : 'train'; setQS('mode', MODE === 'infer' ? 'infer' : '');
    // 换工况时尽量停在同名的那个目的（定位告警 / 容量 / 比改动两边都有），没有就回到全部
    if (STAGE) { STAGE = stageOf(STAGE.k); setQS('goal', STAGE ? STAGE.k : ''); }
    alertAt = -1;
    if (rawBrief && rawBrief.ok !== false) renderClusterBadge(rawBrief);
    if (curSel != null) rerenderRank();
    if (drawerOpen === 'swimlane') renderSwim();
    renderDataCards(); renderCfg(); renderJourney();
  }
  journey.addEventListener('click', function (ev) {
    var dr = ev.target.closest('[data-act="ip-drill"]'); if (dr) { incidentDrill(parseInt(dr.getAttribute('data-rank'), 10)); return; }
    var pm = ev.target.closest('[data-pm]'); if (pm) { var id9 = pm.getAttribute('data-pm'); incidentOpen[id9] = !incidentOpen[id9]; renderJourney(); return; }
    var a = ev.target.closest('[data-alert]');
    if (a) { var i9 = +a.getAttribute('data-alert'), x9 = journey._alerts && journey._alerts[i9]; if (x9 && x9.go) { alertAt = i9; x9.go(); renderJourney(); } return; }
    var b = ev.target.closest('[data-stage]'); if (b) { setStage(b.getAttribute('data-stage')); return; }
    var m = ev.target.closest('[data-jmode]'); if (m && m.getAttribute('data-jmode') !== MODE) setMode(m.getAttribute('data-jmode'));
  });
  var DC_TAG = { calc: 'Calc', asm: 'Est.', demo: 'Demo', pub: 'Public' };
  function dcRow(k, v, cls, tip) { return '<div class="dc-r' + (cls ? ' ' + cls : '') + '"' + (tip ? ' title="' + esc(tip) + '"' : '') + '><span>' + k + '</span><b>' + v + '</b></div>'; }
  function dcBar(frac, cls) { return '<i class="dc-bar' + (cls ? ' ' + cls : '') + '"><i style="width:' + Math.max(0, Math.min(100, frac * 100)).toFixed(1) + '%"></i></i>'; }
  function dcCard(key, title, body, tag, tip, big) {
    if (!DCK[key] || !stageShows(key)) return '';
    return '<section class="dcard" data-dk="' + key + '"' + (tip ? ' title="' + esc(tip) + '"' : '') + '><div class="dc-h"><span class="dc-t">' + title + '</span>'
      + '</div>'   // 口径小标（Demo / Public / Est.）不上卡面（反馈「不要这几个标记」），口径说明留在整张 NPU 的悬停提示里
      + (big != null ? '<div class="dc-big">' + big + '</div>' : '') + body + '</section>';
  }
  function pct(x) { return x == null ? '—' : (x * 100).toFixed(x < 0.1 ? 1 : 0) + '%'; }
  function gb(x) { return x >= 10 ? x.toFixed(0) : x.toFixed(1); }
  function closureRows() {
    var d = hierDims(), L = LINK_LEVELS, h = '';
    for (var i = 0; i < 4; i++) if (d[i].length) h += dcRow(L[i], d[i].join(' '));
    return h;
  }
  function rangeStats(lo, hi) {
    var R = lastCluster && lastCluster.ratio; if (!R) return null;
    var mx = -1, sum = 0, n = 0, over = 0;
    for (var r = lo; r < hi && r < R.length; r++) { var v = R[r]; mx = Math.max(mx, v); sum += v; n++; if (oomSet && oomSet[r]) over++; }
    return n ? { peak: mx, avg: sum / n, over: over, n: n } : null;
  }
  var STEP_DEMO = {
    pretrain: [['Compute', .58], ['Comm', .30], ['访存', .12]]   // 10.17：访存 ≠ 显存容量；原写 Memory 与「显存」撞义
  };
  function stepRows(parts) { return parts.map(function (x) { return '<div class="dc-r dc-rbar"><span>' + x[0] + '</span>' + dcBar(x[1]) + '<b>' + pct(x[1]) + '</b></div>'; }).join(''); }
  var SRC_DEMO = '盘古 Pro MoE 技术报告（Ascend 800I A2 实测）· src/scene/data.ts——不是本硬件、本次训练的读数，只当量级参考';
  /* ── 卡片的阅读顺序（反馈「按用户从先到后看的顺序组织卡片」）────────────────────────
     左列答「这是什么、装得下吗」：配置 → 这一层的容量（集群 / POD / 板 / NPU 合计→逐档）→ 告警；
     右列答「选中的是谁、跟谁 Comm、怎么随时间跑」：选中对象（rank 卡）→ Comm / 闭合 / 板载 → 流水 → 步时。
     每一层都按这一个顺序摆，读者换层不用重新找。 */
  /* ── 性能卡（反馈「页面上的性能数据还是少」+「把 Network Graph 上那几类数据放到周边卡片」）──────────────
     数都来自矩阵本体的 ptoPerf（pto:cluster / pto:brief 里的 perf 字段），与 Network Graph 同一批函数、同一个种子：
       Throughput      FLOPs 公式 × 假设的 Peak 与 MFU——不是实测，卡角标「假设」，悬停写全公式
       MoE       本 NPU 专家 / μb token / All-to-All 派发上限是实算；Pmax、熵、失衡、容量利用是 Network Graph「MoE」那一类的示意读数
       训练健康  Network Graph「数值 / 梯度 / 训练」三类的示意读数：梯度 L2、Δ/W、Activation Amax、告警层（与图上标橙的层同一套阈值）
       公开读数  openPangu-2.0 训练代码发布时公开的效率数字（只有相对提升，没有公开 MFU / 每 NPUThroughput） */
  /* ── 卡内小图（反馈「数据用合适的图表：折线、条形、仪表盘」）─────────────────────────────
     单系列一律灰阶（这一页的彩色已经被五维与告警占了：维度色一色一义，红 = 超容）；超阈值的那几根用状态色
     warning 琥珀，且旁边总有文字行写明——颜色从不单独表意。字用文字色，不用数据色；网格 / 轴是一根发丝线。
     每个标记都挂 <title>：悬停出读数，同一个数在卡里的文字行也读得到（悬停只是增强）。 */
  var VZ_W = 204;   // 右列卡内宽（224 − 左右各 10 内边距）；左列 252
  function vzT(t) { return '<title>' + esc(t) + '</title>'; }
  function vzSvg(w, h, body, cls) { return '<svg class="vz' + (cls ? ' ' + cls : '') + '" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' + body + '</svg>'; }
  // 仪表盘：半圆，底轨同一灰阶浅一档，填充到比例；中间写读数
  function vzGauge(frac, big, sub, tip) {
    var w = 86, h = 52, cx = w / 2, cy = 45, r = 36, f = Math.max(0, Math.min(1, frac)), a = Math.PI * (1 - f);
    var ex = cx + r * Math.cos(a), ey = cy - r * Math.sin(a);
    return vzSvg(w, h, '<path class="vz-track" d="M' + (cx - r) + ',' + cy + ' A' + r + ',' + r + ' 0 0 1 ' + (cx + r) + ',' + cy + '"/>'
      + (f > 0 ? '<path class="vz-arc" d="M' + (cx - r) + ',' + cy + ' A' + r + ',' + r + ' 0 0 1 ' + ex.toFixed(2) + ',' + ey.toFixed(2) + '"/>' : '')
      + '<text class="vz-gv" x="' + cx + '" y="' + (cy - 6) + '" text-anchor="middle">' + big + '</text>'
      + '<text class="vz-ax" x="' + cx + '" y="' + (cy + 5) + '" text-anchor="middle">' + sub + '</text>' + vzT(tip), 'vz-gauge');
  }
  // 进度条：同一灰阶的底轨 + 填充；thr 给了画一根刻度，超过就换状态色
  /* 刻度尺（反馈「试试类似这样的 UI 风格」——FinalCut Camera 的色温 / 色调滑尺）：细刻度一排，每 25% 一根长刻度，
     读数是一根亮针；针左边的刻度亮、右边暗；阈值那一根刻度用琥珀（状态色，只给阈值用） */
  function vzMeter(frac, thr, tip, w) {
    w = w || VZ_W; var f = Math.max(0, Math.min(1, frac)), warn = thr != null && frac > thr, N = 40, h = '';
    for (var i = 0; i <= N; i++) {
      var x = (i / N) * (w - 2) + 1, major = i % 10 === 0, t = i / N;
      var isThr = thr != null && Math.abs(t - thr) < 0.5 / N;
      h += '<rect class="' + (isThr ? 'vz-rthr' : t <= f ? 'vz-ron' : 'vz-roff') + '" x="' + (x - 0.5).toFixed(1) + '" y="' + (major || isThr ? 3 : 6) + '" width="1" height="' + (major || isThr ? 10 : 7) + '"/>';
    }
    h += '<rect class="' + (warn ? 'vz-warn' : 'vz-needle') + '" x="' + (f * (w - 2) + 1 - 1).toFixed(1) + '" y="0" width="2" height="16" rx="1"/>';
    return vzSvg(w, 16, h + vzT(tip));
  }
  // 堆叠条：部分构成整体；段与段之间留 2px 底色缝；要强调的那一段亮、其余灰；图例放在条下面
  function vzStack(parts, emph, w) {
    w = w || VZ_W; var x = 0, gap = 2, tot = parts.reduce(function (a, p) { return a + p[1]; }, 0), avail = w - gap * (parts.length - 1), h = '';
    parts.forEach(function (p, i) {
      var sw = avail * p[1] / tot, cls = p[0] === emph ? 'vz-fill' : 'vz-mute';
      h += '<rect class="' + cls + '" x="' + x.toFixed(1) + '" y="0" width="' + sw.toFixed(1) + '" height="8" rx="' + (i === 0 || i === parts.length - 1 ? 3 : 0) + '">' + vzT(p[0] + ' ' + pct(p[1])) + '</rect>';
      x += sw + gap;
    });
    return vzSvg(w, 8, h) + '<div class="vz-legend">' + parts.map(function (p) { return '<span><i class="' + (p[0] === emph ? 'is-on' : '') + '"></i>' + p[0] + ' <b>' + pct(p[1]) + '</b></span>'; }).join('') + '</div>';
  }
  // 逐层折线：x = 层，y = 读数；阈值一根琥珀发丝线；Peak 一个带底色环的点；null（稠密层）处断开
  function vzLine(vals, x0, lo, hi, thr, fmt, name, w, H0) {
    w = w || VZ_W; var H = H0 || 56, pl = 26, pr = 4, pt = 6, pb = 12, pw = w - pl - pr, ph = H - pt - pb, n = vals.length;
    function X(i) { return pl + (n > 1 ? pw * i / (n - 1) : pw / 2); }
    function Y(v) { return pt + ph * (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)); }
    var d = '', pen = false, pk = -1, h = '';
    vals.forEach(function (v, i) { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1); pen = true; if (pk < 0 || v > vals[pk]) pk = i; });
    h += '<line class="vz-grid" x1="' + pl + '" x2="' + (w - pr) + '" y1="' + (pt + ph) + '" y2="' + (pt + ph) + '"/>';
    h += '<text class="vz-ax" x="' + (pl - 3) + '" y="' + (pt + ph + 3) + '" text-anchor="end">' + fmt(lo) + '</text><text class="vz-ax" x="' + (pl - 3) + '" y="' + (pt + 3) + '" text-anchor="end">' + fmt(hi) + '</text>';
    if (thr != null) h += '<line class="vz-thr" x1="' + pl + '" x2="' + (w - pr) + '" y1="' + Y(thr).toFixed(1) + '" y2="' + Y(thr).toFixed(1) + '">' + vzT('告警线 ' + fmt(thr)) + '</line>';
    h += '<path class="vz-line" d="' + d + '"/>';
    if (pk >= 0) h += '<circle class="vz-ring" cx="' + X(pk).toFixed(1) + '" cy="' + Y(vals[pk]).toFixed(1) + '" r="4"/><circle class="' + (thr != null && vals[pk] > thr ? 'vz-warn' : 'vz-fill') + '" cx="' + X(pk).toFixed(1) + '" cy="' + Y(vals[pk]).toFixed(1) + '" r="2.6"/>';
    h += '<text class="vz-ax" x="' + pl + '" y="' + (H - 1) + '">L' + x0 + '</text><text class="vz-ax" x="' + (w - pr) + '" y="' + (H - 1) + '" text-anchor="end">L' + (x0 + n - 1) + '</text>';
    // 悬停：每层一条透明竖带（比点宽得多），读出这一层的值
    var bw = n > 1 ? pw / (n - 1) : pw;
    vals.forEach(function (v, i) { h += '<rect class="vz-hit" x="' + (X(i) - bw / 2).toFixed(1) + '" y="0" width="' + bw.toFixed(1) + '" height="' + (pt + ph) + '">' + vzT('L' + (x0 + i) + ' · ' + name + ' ' + (v == null ? '—（稠密层）' : fmt(v))) + '</rect>'; });
    return vzSvg(w, H, h);
  }
  // 逐层柱：从 0 起；超阈值的柱用琥珀，其余灰；阈值一根发丝线
  function vzCols(vals, warnL, x0, hi, thr, fmt, name, w, H0) {
    w = w || VZ_W; var H = H0 || 50, pl = 26, pr = 4, pt = 4, pb = 12, pw = w - pl - pr, ph = H - pt - pb, n = vals.length;
    var gap = n > 24 ? 1 : 2, bw = Math.min(24, (pw - gap * (n - 1)) / n), used = n * bw + gap * (n - 1), ox = pl + (pw - used) / 2, h = '';
    function Y(v) { return pt + ph * (1 - Math.min(hi, v) / hi); }
    h += '<line class="vz-grid" x1="' + pl + '" x2="' + (w - pr) + '" y1="' + (pt + ph) + '" y2="' + (pt + ph) + '"/>';
    h += '<text class="vz-ax" x="' + (pl - 3) + '" y="' + (pt + ph + 3) + '" text-anchor="end">0</text><text class="vz-ax" x="' + (pl - 3) + '" y="' + (Y(thr) + 3).toFixed(1) + '" text-anchor="end">' + thr + '</text>';
    vals.forEach(function (v, i) {
      var x = ox + i * (bw + gap), y = Y(v), r = Math.min(2, bw / 2);
      h += '<path class="' + (warnL[i] ? 'vz-warn' : 'vz-mute') + '" d="M' + x.toFixed(1) + ',' + (pt + ph) + 'V' + (y + r).toFixed(1) + 'Q' + x.toFixed(1) + ',' + y.toFixed(1) + ' ' + (x + r).toFixed(1) + ',' + y.toFixed(1)
        + 'H' + (x + bw - r).toFixed(1) + 'Q' + (x + bw).toFixed(1) + ',' + y.toFixed(1) + ' ' + (x + bw).toFixed(1) + ',' + (y + r).toFixed(1) + 'V' + (pt + ph) + 'Z"/>';
      h += '<rect class="vz-hit" x="' + (x - gap / 2).toFixed(1) + '" y="0" width="' + (bw + gap).toFixed(1) + '" height="' + (pt + ph) + '">' + vzT('L' + (x0 + i) + ' · ' + name + ' ' + fmt(v) + (warnL[i] ? ' · 告警' : '')) + '</rect>';
    });
    h += '<line class="vz-thr" x1="' + pl + '" x2="' + (w - pr) + '" y1="' + Y(thr).toFixed(1) + '" y2="' + Y(thr).toFixed(1) + '"/>';
    h += '<text class="vz-ax" x="' + pl + '" y="' + (H - 1) + '">L' + x0 + '</text><text class="vz-ax" x="' + (w - pr) + '" y="' + (H - 1) + '" text-anchor="end">L' + (x0 + n - 1) + '</text>';
    return vzSvg(w, H, h);
  }
  // 行内迷你折线（跟在一行读数后面）
  function vzSpark(vals, tip) {
    var w = 56, h = 14, mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), n = vals.length, d = '';
    vals.forEach(function (v, i) { d += (i ? 'L' : 'M') + (n > 1 ? 1 + (w - 2) * i / (n - 1) : w / 2).toFixed(1) + ',' + (1 + (h - 2) * (1 - (v - mn) / ((mx - mn) || 1))).toFixed(1); });
    return vzSvg(w, h, '<path class="vz-spark" d="' + d + '"/>' + vzT(tip), 'vz-inline');
  }
  // 以 1× 为共同基线的横条：几项相对提升摆在一起比
  function vzIdx(items, w) {
    var H = items.length * 16 + 10, pl = 70, pr = 34, pw = w - pl - pr, mx = 2.2, h = '';
    function X(v) { return pl + pw * v / mx; }
    h += '<line class="vz-grid" x1="' + X(1).toFixed(1) + '" x2="' + X(1).toFixed(1) + '" y1="0" y2="' + (H - 10) + '"/><text class="vz-ax" x="' + X(1).toFixed(1) + '" y="' + (H - 1) + '" text-anchor="middle">1×</text>';
    items.forEach(function (it, i) {
      var y = i * 16 + 2;
      h += '<text class="vz-lb" x="0" y="' + (y + 8) + '">' + it[0] + '</text>'
        + '<path class="vz-fill" d="M' + pl + ',' + y + 'H' + (X(it[1]) - 3).toFixed(1) + 'Q' + X(it[1]).toFixed(1) + ',' + y + ' ' + X(it[1]).toFixed(1) + ',' + (y + 3) + 'V' + (y + 7) + 'Q' + X(it[1]).toFixed(1) + ',' + (y + 10) + ' ' + (X(it[1]) - 3).toFixed(1) + ',' + (y + 10) + 'H' + pl + 'Z">' + vzT(it[0] + ' ' + it[2]) + '</path>'
        + '<text class="vz-v" x="' + (X(it[1]) + 4).toFixed(1) + '" y="' + (y + 8) + '">' + it[2] + '</text>';
    });
    // 1× 基线压在条上（底色缝）：条被切成「基线」与「提升」两段，提升多少一眼可见
    h += '<line class="vz-cut" x1="' + X(1).toFixed(1) + '" x2="' + X(1).toFixed(1) + '" y1="0" y2="' + (H - 10) + '"/>';
    return vzSvg(w, H, h);
  }
  function fmtN(x) { return x >= 1e9 ? (x / 1e9).toFixed(x >= 1e10 ? 0 : 1) + 'G' : x >= 1e6 ? (x / 1e6).toFixed(x >= 1e7 ? 0 : 1) + 'M' : x >= 1e4 ? (x / 1e3).toFixed(0) + 'K' : String(Math.round(x)); }
  function thrCard(P) {
    if (!P || !P.thr) return '';
    var T = P.thr;
    return dcCard('thr', 'Throughput', '<div class="vz-kpi">' + vzGauge(T.mfu, pct(T.mfu), 'MFU', 'MFU ' + pct(T.mfu) + '（假设：盘古 Ultra MoE 报告量级，openPangu-2.0 未公开）')
      + '<div class="vz-stat"><b>' + Math.round(T.tgs) + '</b><span>tok/s · per NPU</span><em>step ' + T.stepS.toFixed(1) + ' s</em></div></div>'
      + dcRow('Cluster', fmtN(T.tokS) + ' tok/s') + dcRow('Tokens / Step', fmtN(T.tokStep), '', 'gbs ' + T.gbs + ' × seq')
      + dcRow('FLOPs / Token', (T.fTok / 1e9).toFixed(0) + ' GFLOP', '', '6·N激活（≈' + (T.nAct / 1e9).toFixed(1) + 'B 矩阵参数）+ 6·L·h·s 因果注意力；共享专家、MLA、DSA/SWA 稀疏未计入'),
      'asm', '步时 = 每步 token × 每 token FLOPs ÷（卡数 × 峰值 ' + T.peakTF + ' TFLOPS × MFU）；峰值按昇腾 910 标称 FP16，MFU 是假设值——看量级与随切分怎么变，不是实测');
  }
  function moeCard(P, scope) {
    var M = P && P.moe; if (!M) return '';
    var x2 = function (v) { return v.toFixed(2) + '×'; };
    // rank / NPU 层（scope 给了）只留本段自己的读数：本 NPU 专家 / μb token / A2A 是配置级的，集群层已经写过
    var head = (scope ? '' : '<div class="vz-cap">Routing Imbalance / Layer</div>') + vzLine(M.imbL, P.health.l0, 1, 1.2, 1.15, x2, 'Imbalance', null, scope ? 44 : 56)
      + dcRow('Imbalance', x2(M.imb) + ' avg', '', '逐层路由失衡；> 1.15× 与 Network Graph 同一条告警线')
      + dcRow('Capacity Util', pct(M.cap)) + vzMeter(M.cap, null, '专家容量利用 ' + pct(M.cap));
    var hero = x2(M.imbMax) + '<small>peak · L' + M.imbAt + '</small>';
    if (scope) return dcCard('moe', 'MoE · ' + scope, head, 'demo', 'Network Graph「MoE」那一类的示意读数，只看本段的层', hero);
    return dcCard('moe', 'MoE', head
      + dcRow('Local Experts', M.ePer + ' / ' + M.experts + ' · top' + M.topk)
      + dcRow('μb token', fmtN(M.tokMb), '', 'per μb per NPU = mbs × seq ÷ CP')
      + dcRow('A2A Dispatch', '≤' + Math.round(M.a2aMB) + ' MB', '', '每层每 μb 上限：token × topk × h × 2B，没算同卡去重')
      + dcRow('Pmax · Entropy', M.pmax.toFixed(2) + ' · ' + M.ent.toFixed(2)),
      'demo', '本 NPU 专家 / μb token / A2A 派发上限是实算；失衡、Router Pmax / 熵、容量利用与 Network Graph「MoE」那一类同一套示意读数', hero);
  }
  function healthCard(P, scope, w) {
    var H = P && P.health; if (!H || MODE !== 'train') return '';
    var f1 = function (v) { return v.toFixed(1); };
    var head = (scope ? '' : '<div class="vz-cap">Activation Amax / Layer</div>') + vzCols(H.amaxL, H.amaxL.map(function (v) { return v > H.thrAmax; }), H.l0, 10, H.thrAmax, f1, 'Amax', w, scope ? 40 : 50)
      + '<div class="dc-r"><span>Grad L2</span>' + vzSpark(H.gradL, '逐层梯度 L2：L' + H.l0 + '–L' + H.l1) + '<b>' + H.grad.toFixed(2) + '</b></div>';
    return dcCard('health', scope ? 'Training Health · ' + scope : 'Training Health', head
      + (scope ? '' : '<div class="dc-more">' + dcRow('Amax Peak', H.amax.toFixed(1) + ' · L' + H.amaxAt) + dcRow('Δ/W', H.uRatio.toExponential(1)) + dcRow('Step', H.step + ' · ckpt/' + H.ckpt) + '</div>'),
      'demo', 'Network Graph「数值 / 梯度 / 训练」三类的示意读数（step 18420 那一次快照），同一层在 Network Graph 与这里读到同一个数',
      H.warn + '<small>/ ' + H.n + ' 告警 Layers</small>');
  }
  function pubCard() {
    return dcCard('pub', 'Reference', vzIdx([['SuperPoD Affinity', 1.3, '+30%'], ['512K Throughput', 1.5, '+50%'], ['Infer/NPU', 2, '2×']], 252)
      + dcRow('Pretrain', '34T tok'),
      'pub', 'openPangu-2.0 训练代码开源时的公开数字（2026-09-28，TechNode / IT之家）：只有相对提升，未公开 MFU、每 NPU Throughput 与步时');
  }
  /* 左列：这一层的容量卡（接在配置卡里，告警面板照旧排在它下面） */
  function capCardHtml() {
    var C = lastCluster;
    if (tier === 3) return '';
    if (level === 'board' && curBoard != null) {
      var b0 = curBoard * PHYS.board, st = rangeStats(b0, b0 + PHYS.board), R = C && C.ratio, bars = '';
      for (var i = 0; i < 8 && b0 + i < world; i++) bars += '<div class="dc-r dc-rbar"><span>' + (b0 + i) + '</span>' + dcBar(R ? Math.min(1, R[b0 + i]) : 0, oomSet && oomSet[b0 + i] ? 'is-bad' : '') + '<b>' + (R ? pct(R[b0 + i]) : '—') + '</b></div>';
      return dcCard('cap', 'Board ' + curBoard, (st ? dcRow('Peak', pct(st.peak)) : '') + bars, 'calc');
    }
    if (curSel == null && fitPod != null) {
      var p0 = fitPod * PHYS.pod, sp = rangeStats(p0, p0 + PHYS.pod);
      return dcCard('cap', 'POD ' + fitPod, sp ? dcRow('Peak', pct(sp.peak)) + dcRow('Mean', pct(sp.avg)) + dcRow('OOM', sp.over, sp.over ? 'is-bad' : '') : dcRow('Reading', '…'), 'calc');
    }
    if (!C) return '';
    var n = C.n, W = C.world, rows = [['OK', n.ok, ''], ['Warn', n.amber, ''], ['Critical', n.red, n.red ? 'is-warn' : ''], ['OOM', n.oom, n.oom ? 'is-bad' : '']];   // 阈值（70 / 88%）进悬停释义，行名不带百分比——长的「Critical 88%」挤进条里
    // 左列：容量（装得下吗）→ 训练健康（稳不稳）→ 公开读数；告警面板排在它们下面
    return capClusterHtml(C, n, W, rows) + (MODE === 'infer' ? inferMemCard() : C.perf ? healthCard(C.perf, null, 252) : '') + pubCard();
  }
  /* 推理 · 显存：最满那一段的四档（关键点 KV cache 高亮，其余灰）+ 合计 + 每条 KV + 并发上限 */
  function inferMemCard(pp) {
    var I = rawBrief && rawBrief.infer; if (!I) return '';
    if (pp == null) { pp = 0; I.stages.forEach(function (x, i) { if (x.tot > I.stages[pp].tot) pp = i; }); }
    var IM = inferMem(pp), G = Math.pow(2, 30);
    return dcCard('state', '显存 · Inference' + (PS.pp > 1 ? ' · PP' + pp : ''),
      vzStack(IM.segs.map(function (x) { return [x.label, x.gb / IM.totGB]; }), 'KV Cache')
      + dcRow('KV Cache', gb(IM.segs[1].gb) + ' GB · ' + I.batch + '×' + (I.ctx >= 1024 ? Math.round(I.ctx / 1024) + 'K' : I.ctx))
      + dcRow('KV / Seq', (I.kvSeq / G).toFixed(3) + ' GB')
      + dcRow('Max Batch', IM.bmax, IM.bmax < I.batch ? 'is-bad' : ''),
      'asm', '推理口径（矩阵 ptoInferMem）：权重 bf16 按同一套 TP/EP/PP 常驻，无梯度 / 优化器态；KV = 2×本段层数×本 NPU KV 头×headDim×seq/cp×并发×2B（MHA/GQA 口径，MLA、量化 KV 未建模——是上限）；并发上限按 90% HBM 算',
      (Math.round(IM.totGB * 10) / 10) + '<small>/ ' + IM.hbm + ' GB · Total</small>');
  }
  function capClusterHtml(C, n, W, rows) {
    return dcCard('cap', 'Capacity', rows.map(function (x) { return '<div class="dc-r dc-rbar' + (x[2] ? ' ' + x[2] : '') + '"><span>' + x[0] + '</span>' + dcBar(x[1] / W, x[2]) + '<b>' + x[1] + '</b></div>'; }).join('')
      + (C.worst != null ? dcRow('Peak rank', '<button type="button" class="dc-link" data-dact="sel" data-r="' + C.worst + '">rank ' + C.worst + '</button>') : ''), 'calc', null,
      C.worst != null ? pct(C.ratio[C.worst]) + '<small>Peak Usage</small>' : null);
  }
  /* 右列：关系（Comm / 闭合 / 板载）→ 时间（流水 → 步时）。选中了 rank 但 rank 卡还收着时，右列保持这一层原来那几张，
     不先冒出一张孤零零的「流水」；rank 卡打开后才换成这张 NPU 自己的流水，排在 rank 卡下面。 */
  /* ── 调优对比（旅程「调优 / 扩缩」那一步：反馈「改了参数之后没有前后对比」）──────────────────────────
     改 ZeRO 档、改切分「应用」、换预置的那一刻，先把当前这一组读数存成「改前」（切分 / 预置会整页重载，
     所以同时写进 sessionStorage，重载后读回一次就删）；新读数回来后，右列最上面一张「改前 → 改后」：
     每项一行，改后近白、改前灰、差值带 ▲▼——变差的那一项差值用琥珀（状态色，只给这一种用途），变好不着色。
     卡头 × 清掉对比。只比同一个工况（训练 / 推理）里有意义的几项。 */
  var BASE = (function () { try { var v = sessionStorage.getItem('sdm.base'); sessionStorage.removeItem('sdm.base'); return v ? JSON.parse(v) : null; } catch (e) { return null; } })();
  function snapNow() {
    var B = rawBrief; if (!B || B.ok === false) return null;
    var pk = 0; (B.ratio || []).forEach(function (v) { if (v > pk) pk = v; });
    var T = B.perf && B.perf.thr, I = B.infer, it = 0;
    if (I) I.stages.forEach(function (x) { if (x.tot > it) it = x.tot; });
    return { cfg: 'tp' + PS.tp + ((PS.cp || 1) > 1 ? ' cp' + PS.cp : '') + ' pp' + PS.pp + ' dp' + PS.dp + ' ep' + PS.ep + ' · z' + ZERO,
      model: PS.modelName, peak: pk, oom: B.n ? B.n.oom : 0, red: B.n ? B.n.red : 0, bubble: B.bubble,
      tgs: T ? T.tgs : null, step: T ? T.stepS : null, mfu: T ? T.mfu : null,
      itot: I ? it / Math.pow(2, 30) : null, bmax: I ? I.bmax : null, ioom: I ? I.n.oom : null };
  }
  function saveBase(persist) {
    var s9 = snapNow(); if (!s9) return;
    BASE = s9;
    if (persist) try { sessionStorage.setItem('sdm.base', JSON.stringify(s9)); } catch (e) {}
  }
  function cmpRow(k, a, b, fmt, lowerBetter) {
    if (a == null || b == null) return '';
    var d = b - a, same = Math.abs(d) < 1e-9 || fmt(a) === fmt(b), worse = !same && (lowerBetter ? d > 0 : d < 0);
    return '<div class="dc-r dc-cmp' + (same ? ' is-same' : worse ? ' is-worse' : ' is-better') + '"><span>' + k + '</span><b><s>' + fmt(a) + '</s> ' + fmt(b)
      + '<i>' + (same ? '=' : (d > 0 ? '▲' : '▼')) + '</i></b></div>';
  }
  function cmpCard() {
    if (!BASE || tier === 3) return '';
    var N = snapNow(); if (!N) return '';
    var f1 = function (x) { return (Math.round(x * 10) / 10).toFixed(1); }, fi = function (x) { return String(Math.round(x)); };
    var rows = (BASE.model !== N.model ? dcRow('Model', esc(N.model)) : '')
      + '<div class="dc-cmp-cfg"><s>' + esc(BASE.cfg) + '</s><span>→ ' + esc(N.cfg) + '</span></div>';
    if (MODE === 'infer') rows += cmpRow('Memory GB', BASE.itot, N.itot, f1, true) + cmpRow('Max Batch', BASE.bmax, N.bmax, fi, false) + cmpRow('OOM Ranks', BASE.ioom, N.ioom, fi, true);
    else rows += cmpRow('Peak Usage', BASE.peak, N.peak, pct, true) + cmpRow('OOM Ranks', BASE.oom, N.oom, fi, true) + cmpRow('Critical Ranks', BASE.red, N.red, fi, true)
      + cmpRow('Bubble', BASE.bubble, N.bubble, pct, true) + cmpRow('tok/s · per NPU', BASE.tgs, N.tgs, fi, false) + cmpRow('Step Time s', BASE.step, N.step, f1, true);
    return dcCard('cmp', 'Before / After', rows, null, '改前 = 最近一次改 ZeRO / 切分 / 预置之前的读数；变差的差值用琥珀，变好不着色')
      .replace('</span></div>', '</span><button type="button" class="dc-x" data-act="cmp-clear" title="清掉对比">×</button></div>');
  }
  function levelCards() {
    var C = lastCluster, out = [];
    if (tier === 3) return out;
    var rankOpen = curSel != null && tier === 2 && rankTipOpen;
    if (level === 'board' && curBoard != null) {
      out.push(dcCard('phys', 'On-board', dcRow('H2D', '0–3→CPU0 · 4–7→CPU1') + dcRow('NIC', 'k ↔ 2k, 2k+1') + dcRow('fullmesh', '7×X4')
        + dcRow('Clos', '8×X4 → L1') + dcRow('NIC SW', '1口/C · 2口/N')   /* 同板视图画布上的叫法（审计：卡里写 Intra-board / Off-board，画布写 fullmesh / Clos） */, 'asm', '按 CANN NEXT 直播四页的 POD / Server 形态图；rank 落位按连续摆放推'));
    } else if (curSel == null && fitPod != null) {
      var dd = hierDims();
      out.push(dcCard('comm', 'Closure', (dd[0].length ? dcRow('Board', dd[0].join(' ')) : '') + (dd[1].length ? dcRow('POD', dd[1].join(' ')) : '') + dcRow('Beyond POD', (dd[2].concat(dd[3])).join(' ') || '—'), 'asm'));
    } else if (!rankOpen) {
      out.push(cmpCard());
      if (C) {
        out.push(dcCard('comm', 'Comm', closureRows()
          + (C.comm && C.comm.tp ? dcRow('TP', unitEN(C.comm.tp.txt), '', C.comm.tp.how) : '') + (C.comm && C.comm.pp ? dcRow('PP', unitEN(C.comm.pp.txt), '', C.comm.pp.how) : '') + (C.comm && C.comm.dp && MODE !== 'infer' ? dcRow('DP', unitEN(C.comm.dp.txt), '', C.comm.dp.how) : '')
          + dcRow('UB · RoCE', '196 · 50 GB/s'), 'calc', '闭合级别按 rank 连续落位推（假设）；字节按矩阵 commLoad9；CP / EP 各边不等，不给数'));
        if (C.model && MODE !== 'infer') out.push(dcCard('pipe', 'Pipeline', vzMeter(C.bubble, 0.25, '气泡 ' + pct(C.bubble) + '；刻度 = 25% 告警线') + dcRow('PP · GA', PS.pp + ' · ' + C.model.ga) + dcRow('Layers / Stage', C.model.lps) + dcRow('μb', C.model.mbs + '×' + C.model.seq),
          'calc', '(PP−1)/GA；>25% 告警，GA<PP 灌不满', pct(C.bubble) + '<small>Bubble</small>'));
      }
      if (MODE === 'train' && C) out.push(thrCard(C.perf));
      if (MODE === 'train') out.push(dcCard('step', 'Step Time', vzStack(STEP_DEMO.pretrain, 'Comm'), 'demo', SRC_DEMO));
      else out.push(dcCard('infer', 'Inference', dcRow('TPOT', '96 ms') + dcRow('Prefill', '4828 tok/s') + dcRow('Decode', '1148 tok/s') + dcRow('Batch', '64'),
        'demo', SRC_DEMO + '；显存见「显存 · 推理」卡（按本页切分估算）', '424<small>ms · TTFT</small>'));
      if (C && C.perf) out.push(moeCard(C.perf));
    }
    if (rankOpen) {
      var B = lastBrief && lastBrief.rank === curSel ? lastBrief : null, Dt = B && B.detail;
      // Comm 并进右卡的 group 表；层区间已在右卡抬头
      if (Dt) out.push(dcCard('pipe', 'Pipeline', vzMeter(Dt.bubble, 0.25, '气泡 ' + pct(Dt.bubble) + '；刻度 = 25% 告警线') + dcRow('ZeRO', Dt.zero), 'calc', null, pct(Dt.bubble) + '<small>Bubble</small>'));
      if (Dt && Dt.perf) { var sc9 = 'L' + Dt.perf.health.l0 + '–L' + Dt.perf.health.l1; out.push(moeCard(Dt.perf, sc9)); out.push(healthCard(Dt.perf, sc9)); }
    }
    return out;
  }
  var CUT_NAME = { tp: 'TP', ep: 'EP', cp: 'CP', sp: 'SP', none: 'Rep' };
  /* NPU 层：并行拓扑读出卡（renderRankMem）拆开——每一档、权重带里的每一块各一张小卡，接在左列配置卡
     下面往下排（反馈「从告警继续往下排」，不另起第二列）。卡面只放名字、切法、GB 与一句归属/相位；
     点开 = 读出卡里点开那一块时的那一栏（memBlockDetail 原文拆出来的：dt/dd 行、腔图、对应 Comm、兄弟 rank），
     再点收起。 */
  var dcOpen = {}, dcOpenRank = null;
  /* 点开之后也只留 key / value（反馈「字太多、只留 key 和 value、不要解释」）：括号里的说明、整句解释的行、
     ⓘ 那句、兄弟 rank那句都不上卡面；对应 Comm 只留「维 原语」一行一条；腔图留第一张（本 NPU 拿的是哪一格）。 */
  var BLK_EN = { '形状': 'Shape', '切法': 'Split', '每卡': 'Per NPU', '每 NPU': 'Per NPU', '归属': 'Owner', '相位': 'Phase', '生命周期': 'Lifetime', '通信': 'Comm', '参数': 'Params' };
  function kvClean(v) { return v.replace(/的切法$/, '').replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim(); }
  function blockBody(k) {
    var B = lastBrief && lastBrief.detail && lastBrief.detail.blocks && lastBrief.detail.blocks[k];
    if (!B) return '';
    var rows = B.rows.map(function (r) {
      // 「这一块 / 这一档」开头那个 GB 数卡头已经有了，只留后半：每层形状 / 参数量
      var v = kvClean(r[1]).replace(/^[\d.,]+ GB( · )?/, '');
      var k = r[0] === '这一块' ? 'Per Layer' : r[0] === '这一档' ? 'Params' : (BLK_EN[r[0]] || r[0]);
      return [k, v.replace(/^每层 /, '').replace(' M 参数 ×', 'M ×')];
    }).filter(function (r) { return r[1] && r[1].length <= 34 && r[0] !== '它是什么'; });
    var comm = B.comm.map(function (c) {
      var d = /^(TP|CP|EP|PP|DP|SP)/.exec(c.head), pr = /(AllToAll|AllGather|ReduceScatter|AllReduce|Send\/Recv|P2P|Broadcast)/i.exec(c.head);
      return d ? d[1] + (pr ? ' ' + pr[1] : '') : '';
    }).filter(Boolean);
    var h = '<div class="dc-open"' + (B.note ? ' title="' + esc(B.note) + '"' : '') + '>';
    h += rows.map(function (r) { return dcRow(esc(r[0]), esc(r[1])); }).join('');
    if (comm.length) h += dcRow('Comm', esc(comm.join(' · ')));
    /* 进一步的切分（反馈「点开单个图例会对 Activations / 权重做进一步的切分显示，这部分也放进可展开的 NPU 片」）：矩阵读出卡点开一块时
       给的那几张图都带上——字节按刀的占比条、这一块在三根轴（ℓ × h × e / ℓ × s × b）上本 NPU 拿的是哪一格、
       Activations 还有 1F1B 此刻压着几份 μb；只去掉「生命周期」那张（讲的是时间不是切分，右侧流水卡已经有）。每张图上一行小标题。 */
    B.figs.filter(function (f) { return !/淡的那几格可点/.test(f.cap); }).forEach(function (f) {
      var cap = f.cap.replace(/（[^）]*）/g, '').replace(/\s+/g, ' ').trim();
      h += '<div class="dc-fig"><div class="dc-fig-cap">' + esc(cap.length > 40 ? cap.slice(0, 39) + '…' : cap) + '</div>' + f.svg + '</div>';
    });
    return h + '</div>';
  }
  function splitCard(key, dk, title, chip, big, sub, isSub, col, chipCol) {
    if (!DCK[dk]) return '';
    var open = !!dcOpen[key];
    // 消融：卡面只留名字、切法、数值；归属/相位/怎么切收进悬停
    return '<section class="dcard is-split' + (isSub ? ' is-sub' : '') + (open ? ' is-open' : '') + '" data-bk="' + esc(key) + '" title="' + (sub ? sub + ' · ' : '') + (open ? '收起' : '点开') + '">'
      + '<div class="dc-h"><span class="dc-t">' + (col ? '<i class="gc" style="background:' + col + '"></i>' : '') + title + (chip ? '<span class="dc-cut"' + (chipCol ? ' style="background:' + chipCol + '"' : '') + '>' + chip + '</span>' : '') + '</span><b class="dc-v">' + big + '</b></div>'
      + (open ? blockBody(key) : '') + '</section>';
  }
  function shardCards() {
    var B = lastBrief && lastBrief.rank === curSel ? lastBrief : null, Dt = B && B.detail, L = [];
    if (tier !== 3 || !Dt) return L;
    if (dcOpenRank !== curSel) { dcOpen = {}; dcOpenRank = curSel; }   // 点开的那一块只属于点开它时那张 NPU
    // 模型态在前（权重 → 逐块、梯度、优化器态、AllGather 窗口），执行态在后（Activations、临时区、碎片）
    var ORD = { w: 0, agw: 1, g: 2, opt: 3, otmp: 4, act: 5, rsv: 6 };
    // 推理工况：3D 卡仍按训练口径画，这里先放一张推理口径的本 NPU 显存
    if (MODE === 'infer' && B.coord) L.push(inferMemCard(B.coord.pp));
    // 先答「装得下吗」：合计 / HBM 一张 NPU 排在最前，逐档构成跟在后面
    if (DCK.state && B.cap) L.push('<section class="dcard dc-total' + (B.cap.level === 'ok' ? '' : ' is-alert') + '"><div class="dc-h"><span class="dc-t">' + (MODE === 'infer' ? 'Total · Training' : 'Total') + '</span></div><div class="dc-big">'
      + (Math.round(B.cap.totGB * 10) / 10) + '<small>/ ' + B.hbm + ' GB</small></div>' + vzMeter(B.cap.totGB / B.hbm, 0.88, '合计 / HBM；刻度 = 88% 告警线') + '</section>');
    Dt.segs.slice().sort(function (a, b) { return (ORD[a.k] == null ? 9 : ORD[a.k]) - (ORD[b.k] == null ? 9 : ORD[b.k]); }).forEach(function (s) {
      L.push(splitCard(s.k, 'state', esc(memEN(s.label)), s.zdiv > 1 ? '1/' + s.zdiv : '', gb(s.gb) + '<small> GB</small>', esc([s.own, s.life].filter(Boolean).join(' · ')), false, s.col));
      if (s.k === 'w' && s.sub) s.sub.forEach(function (x) {
        L.push(splitCard('w:' + x.id, 'wshard', esc(x.id), CUT_NAME[x.cut] || esc(x.cut), gb(x.gb) + '<small> GB</small>', esc(x.how), true, null, GC[x.cut] || null));
      });
    });
    return L;
  }
  function t3SideCards() {
    var B = lastBrief && lastBrief.rank === curSel ? lastBrief : null, Dt = B && B.detail, R = [];
    if (tier !== 3 || !Dt) return R;
    // Comm 并进右卡的 group 表（维 · 闭合级 · 一次搬多少），这里不再单列；层区间已在右卡抬头
    R.push(dcCard('pipe', 'Pipeline', vzMeter(Dt.bubble, 0.25, '气泡 ' + pct(Dt.bubble) + '；刻度 = 25% 告警线') + dcRow('PP · GA', PS.pp + ' · ' + Dt.model.ga) + dcRow('ZeRO', Dt.zero ? Dt.zero : '0'), 'calc', null, pct(Dt.bubble) + '<small>Bubble</small>'));
    if (Dt.perf) { var sc9 = 'L' + Dt.perf.health.l0 + '–L' + Dt.perf.health.l1; R.push(moeCard(Dt.perf, sc9)); R.push(healthCard(Dt.perf, sc9)); }
    return R;
  }
  var dcQueued = false;
  var dcCtx = null, dcEnterT = 0;
  function renderDataCards() {
    if (dcQueued) return; dcQueued = true;
    requestAnimationFrame(function () {
      dcQueued = false;
      document.body.classList.toggle('dc-noinc', !DCK.inc || !stageShows('inc'));
      renderJourney();
      renderLeftCard();   // 容量卡住在左列配置卡里，跟着这一层（集群 / POD / 板）一起换
      var lv = (tier === 3 ? t3SideCards() : levelCards()).filter(Boolean), sh = shardCards().filter(Boolean);
      /* 卡片入场（层级串联动画）：只在「上下文」换了（层 / 档 / 选中 / 板 / POD / NPU 内容）时，
         新插进来的 NPU 错峰淡入上浮；同一上下文里的重画（点开切分卡等）不再播，免得一闪一闪 */
      var ctx9 = [tier, level, curSel, curBoard, fitPod, DV.rv].join('|'), fresh9 = ctx9 !== dcCtx;
      dcCtx = ctx9;
      [dataCol, shardL, leftCard].forEach(function (el) { el.classList.toggle('dc-enter', fresh9 && !REDUCED); });
      clearTimeout(dcEnterT); if (fresh9) dcEnterT = setTimeout(function () { [dataCol, shardL, leftCard].forEach(function (el) { el.classList.remove('dc-enter'); }); }, 900);
      dataCol.innerHTML = lv.join(''); dataCol.classList.toggle('is-hidden', !lv.length);
      shardL.innerHTML = sh.join(''); shardL.classList.toggle('is-hidden', !sh.length);
      [dataCol, shardL, leftCard].forEach(function (el) { for (var i9 = 0; i9 < el.children.length; i9++) el.children[i9].style.setProperty('--i', Math.min(i9, 12)); });
      doSyncCardHeights();
      requestAnimationFrame(syncOverFade);
    });
  }
  /* 列内滚动用「虚拟滚动」而不是 overflow:auto（反馈「玻璃要有透明度」）：Chromium 里真正在滚的容器会把里面卡片的
     backdrop-filter 截断——卡片只能「看到」容器自己，看不到后面的画布，磨砂模糊整个失效（右列数据卡从来就没糊上过）。
     这里列容器一律 overflow:hidden，滚轮 / 拖滚动条时改列上的 --sy，卡片用 translate 整体上移；滚动条是自绘的 4px 细条，
     只有装不下时才出现。四种列共用：左卡、右侧数据列、NPU 层左列、故障列（.vs-host）。 */
  function vsHosts() { return document.querySelectorAll('.vs-host'); }
  function vsContentH(el) {
    var h = 0;
    for (var i = 0; i < el.children.length; i++) { var c = el.children[i]; if (c.classList.contains('vs-bar')) continue; h = Math.max(h, c.offsetTop + c.offsetHeight); }
    return h;
  }
  function vsMax(el) { var m = Math.ceil(vsContentH(el) - el.clientHeight); return m > 4 ? m + 2 : 0; }   // 差几像素（卡片投影、取整）不算装不下
  function vsSet(el, v) {
    var max = vsMax(el); v = Math.max(0, Math.min(max, v || 0)); el._sy = v;
    el.style.setProperty('--sy', v + 'px');
    var bar = el.querySelector(':scope > .vs-bar');
    if (!bar) { bar = document.createElement('i'); bar.className = 'vs-bar'; el.appendChild(bar); }
    var ch = el.clientHeight, th = max ? Math.max(24, ch * ch / (ch + max)) : 0;
    bar.style.height = th + 'px'; bar.style.top = (max ? (ch - th) * v / max : 0) + 'px';
    el.classList.toggle('is-over', max > 0);
    el.classList.toggle('at-end', !max || v >= max - 1);
  }
  function syncOverFade() { vsHosts().forEach(function (el) { vsSet(el, el._sy); }); }
  [dataCol, shardL, leftCard].forEach(function (el) { el.classList.add('vs-host'); });
  window.addEventListener('wheel', function (ev) {
    var el = ev.target.closest && ev.target.closest('.vs-host'); if (!el) return;
    if (!vsMax(el)) return;
    ev.preventDefault();
    vsSet(el, (el._sy || 0) + (ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY));
  }, { passive: false });
  // 拖滚动条
  document.addEventListener('pointerdown', function (ev) {
    var bar = ev.target.closest && ev.target.closest('.vs-bar'); if (!bar) return;
    ev.preventDefault(); ev.stopPropagation();
    var el = bar.parentElement, y0 = ev.clientY, s0 = el._sy || 0, max = vsMax(el), ch = el.clientHeight, th = bar.offsetHeight;
    el.classList.add('is-drag');
    function mv(e) { vsSet(el, s0 + (e.clientY - y0) * max / Math.max(1, ch - th)); }
    function up() { el.classList.remove('is-drag'); window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); }
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  }, true);
  window.addEventListener('resize', function () { requestAnimationFrame(syncOverFade); });
  shardL.addEventListener('click', function (ev) {
    var c = ev.target.closest('[data-bk]'); if (!c) return;
    var k = c.getAttribute('data-bk'); dcOpen[k] = !dcOpen[k]; renderDataCards();
  });
  dataCol.addEventListener('click', function (ev) {
    if (ev.target.closest('[data-act="cmp-clear"]')) { BASE = null; renderDataCards(); return; }
    var b = ev.target.closest('[data-dact="sel"]'); if (!b) return;
    var r = +b.getAttribute('data-r'); showTier2(r, coordLine(r));
  });

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
    var icon = null, lod2 = svgEl.classList.contains('lod1') || stage === boardStage;   // 图标从 3× 起就有
    // 板视图：图标紧跟在 NPU 后面；集群：rank 号后面那一个（懒建之前没有就退回格子本身，不去错抓下一张卡的图标）
    if (lod2) { var n1 = el.nextElementSibling; icon = n1 && n1.tagName === 'use' ? n1 : (n1 && n1.classList.contains('p-npunum') ? n1.nextElementSibling : null); }
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
    var stage = tier === 3 || curSel == null ? null : level === 'board' ? boardStage : physStage;
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
  window.addEventListener('resize', function () { clearTimeout(refitT); refitT = setTimeout(function () { curZP().refit(); renderPanel(); }, 120); });

  // ── 开场：三张卡 + 顶栏就位，第一档默认铺灵衢物理拓扑（旧链接 ?view=universe 不再换画法：
  //    段视图已归档到 /patterns/pp-segment-radial/）。 ────────────────────
  topbar.classList.remove('is-hidden');
  leftCard.classList.remove('is-hidden');
  showOverview();

  // ── URL 深链：?sel=<并行拓扑矩阵自己的 rank 编号> 打开时直接进第三档 ─────
  var qsel = parseInt(qs.get('sel'), 10);
  if (isFinite(qsel) && qsel >= 0 && qsel < world) showDetail(qsel);
  else if (STAGE) stageGo(STAGE);   // ?stage= 深链：落到这一步该看的地方
})();

/* ── 英文术语的中文释义（反馈「用英文词的话，hover 要显示中文和对应的含义」）─────────────────────────────
   页面上凡是用英文的指标 / 术语（卡片标题、行名、图例、配置开关、参考面板标题、告警条目），悬停都出「中文 — 含义」。
   一份词表 + 一个观察器：各处重画后自动补上 title，不改各处的拼法。按「整串相等 → 以词条开头」匹配，长词条优先。 */
(function () {
  'use strict';
  var G = {
    'Capacity': '容量 — 每张 NPU 显存占用落在哪一档：OK / Warn / Critical / OOM',
    'OK': '正常 — 显存占用低于 70%',
    'Warn': '预警 — 占用 ≥ 70%，已经没有余量吃一次路由抖动',
    'Critical': '临界 — 占用 ≥ 88%，再有一点波动就 OOM',
    'Critical 88%': '临界 — 占用 ≥ 88%，再有一点波动就 OOM',
    'OOM': '显存溢出 — 占用超过 HBM 容量，这一刻放不下',
    'Peak rank': '最满的卡 — 全网显存占用率最高的那个 rank，点一下下钻',
    'Peak Usage': '峰值占用 — 全网显存占用率最高的那张 NPU',
    'Usage': '占用率 — 每张 NPU 的显存占用（合计 / HBM），画布灰度即此值',
    'Peak': '峰值 — 这一组卡里占用率最高的那张',
    'Mean': '均值 — 这一组卡的平均占用率',
    'Reading': '读数',
    'Board': '板 — 同一块 Board 上的 8 张 NPU（Board 内 UB fullmesh）',
    'PP Stage · Peak Usage': 'PP 段峰值占用 — 每个流水段里占用率最高那张 NPU 的占用',
    'Training Health': '训练健康 — 数值稳定性与梯度状态（Activation Amax、梯度范数、更新比）',
    'Activation Amax / Layer': '逐层激活最大值 — 超过 9.35 的层标琥珀，有 FP8 / BF16 溢出风险',
    '告警 Layers': '告警层 — Activation Amax 超阈或路由失衡超阈的层数',
    'Grad L2': '梯度 L2 范数 — 逐层梯度的大小，突增 / 突降说明训练不稳',
    'Amax Peak': '激活峰值 — 全网最大的 Activations 及其所在层',
    'Amax': '激活最大值（absolute max）— 超阈说明数值有溢出风险',
    'Δ/W': '更新比 — 一步参数更新量相对参数本身的量级',
    'Step': '训练步 — 当前步数与 checkpoint 间隔',
    'Reference': '参考读数 — openPangu-2.0 开源时公布的相对提升（无绝对值）',
    'SuperPoD Affinity': '按 SuperPoD 拓扑亲和编排带来的提升',
    '512K Throughput': '512K 序列吞吐 — 超长序列训练的 Throughput 提升',
    'Infer/NPU': '单 NPU 推理 — 单 NPU 推理性能提升',
    'Pretrain': '预训练 token 量',
    'Comm': '通信 — 各并行维度的 Comm 在哪一层闭合、一次搬多少',
    'Comm': '通信（communication）',
    'Comm Group': '通信组 — 画布上标出同一并行组的 NPU',
    'Comm Links': '通信连线 — NPU 视图里画出与兄弟 rank之间的 Comm',
    'Comm Layers': '通信图层 — 把 Comm 按维叠回图上',
    'Closure': '闭合 — 这一维 Comm 在哪一级（Board 内 / POD / SuperPoD）就能完成',
    'Beyond POD': '出 POD — 需要跨 POD 才能完成的维度',
    'Cross-SuperPoD': '需要走 SuperPoD 之间的网络',
    'SuperPoD': '1024 NPU 组成的一个高速互联域',
    'SP': '序列并行（Sequence Parallel）— norm 这类不改特征维的算子沿 token 切，复用 TP 组',
    'POD': 'POD — SuperPoD 里的一组 Board',
    'On-board': '板载 — Board 内的 CPU / NIC / NPU 配对与连线',
    'Intra-board': '板内 — 同一块 Board 上的 NPU 互联',
    'Off-board': '出板 — Board 上 NPU 连到 L1 交换',
    'Pipeline': '流水线 — PP 流水并行的气泡与 μb',
    'Pipeline · Bubble': '流水线 · 气泡',
    'Bubble': '气泡 — 流水线空转的占比，约 (PP−1)/GA',
    'Layers / Stage': '每段层数 — 每个 PP 段负责几层',
    'μb': '微批次（micro-batch）',
    'μb token': '每个 μb 在每张 NPU 上的 token 数',
    'Throughput': '吞吐 — 每 NPU 每秒处理的 token 数与 MFU',
    'MFU': '模型算力利用率 — 实际训练 FLOPs / 硬件 Peak FLOPs',
    'Cluster': '全网 — 整个集群每秒处理的 token',
    'Tokens / Step': '每步 token 数 — 一步训练吃进的 token',
    'FLOPs / Token': '每 token 计算量',
    'Step Time': '步时 — 一步训练的时间构成（计算 / Comm / 访存）',
    'Compute': '计算',
    'MoE': '混合专家（Mixture of Experts）',
    'Routing Imbalance / Layer': '逐层路由失衡 — 最忙专家负载 / 平均负载，> 1.15× 告警',
    'Routing Imbalance': '路由失衡 — 最忙专家负载 / 平均负载，> 1.15× 告警',
    'Imbalance': '失衡 — 最忙专家负载 / 平均负载',
    'Capacity Util': '专家容量利用率 — 专家槽位被用上的比例',
    'Local Experts': '本 NPU 专家数 — 这张 NPU 上放了几个专家 / 共几个 · top-k',
    'A2A Dispatch': 'A2A 派发量 — 每层每个 μb 发往其他 NPU 的 token 数据量上限',
    'Pmax · Entropy': '路由最大概率 · 路由熵 — 路由有多「偏」',
    'Inference': '推理',
    '显存 · Inference': '推理显存 — 权重 + KV cache + 工作区 + 预留',
    'TTFT': '首 token 时延（Time To First Token）',
    'TPOT': '每个输出 token 的时延（Time Per Output Token）',
    'Prefill': '预填充 — 一次性处理完整个提示词',
    'Prefill': '预填充 — 一次性处理完整个提示词',
    'Decode': '解码 — 逐个生成输出 token',
    'Decode': '解码 — 逐个生成输出 token',
    'Batch': '并发请求数',
    'Total': '合计 — 这张 NPU 的显存总占用 / HBM 容量',
    'Total · Training': '合计（训练口径）',
    'Weights': '权重',
    'Grads': '梯度',
    'Optimizer': '优化器状态（fp32 主参数 + 两份动量）',
    'Opt Step Tmp': '优化器步临时区 — 步末梯度归约的临时副本',
    'AG Window': 'AllGather 窗口 — ZeRO-3 计算时拼回完整参数的那一截',
    'Activations': '激活 — 前向留给反向用的中间结果',
    'Reserve': '碎片 / 预留',
    'KV Cache': '键值缓存 — 推理时每条序列每层缓存的 K / V',
    'KV Cache overflow': 'KV 缓存放不下 — 按当前并发，KV cache 超出显存',
    'Workspace': '工作区 — prefill 计算的临时 Activations',
    'KV / Seq': '每条序列的 KV cache 大小',
    'Max Batch': '最大并发 — 按 90% HBM 能容纳的并发请求数',
    'Before / After': '改前 / 改后 — 最近一次改 ZeRO / 切分 / 预置前后的读数对比',
    'Model': '模型',
    'Memory GB': '显存合计（GB）',
    'OOM Ranks': '超容的卡数',
    'Critical Ranks': '越过 88% 告警线的卡数',
    'tok/s · per NPU': '每 NPU 每秒 token 数',
    'Step Time s': '步时（秒）',
    'Swimlane': '泳道 — 各 PP 段按时间排开的前向 / 反向（推理：prefill / decode）',
    'Network Graph': '模型结构与各层切分',
    'Logical Cube': 'TP × PP × DP 的逻辑排布',
    'Hierarchy': '层级剖面 — Cluster → SuperPoD → POD → Board → NPU → Die',
    'Layers': '层构成 — 这张 NPU 负责的 Layer 与各 Layer 的构成',
    'Forward': '前向',
    'Backward': '反向',
    'P2P': '点对点通信 — PP 段之间传 Activations / 梯度',
    'P2P / DP Sync': '点对点通信 / 数据并行梯度同步',
    'DP AllReduce': '数据并行梯度同步（AllReduce）',
    'Idle': '空闲 — 等上游 Activations（›）或下游梯度（‹）',
    'Warmup': '预热 — 流水线逐段灌满',
    'Steady 1F1B': '稳态 — 每段一前向一反向交替',
    'Cooldown': '冷却 — 流水线逐段排空',
    'Train': '训练',
    'rank': 'rank 号 — 分布式训练进程的编号，一个 rank 绑一张 NPU',
    'Router': '路由 — MoE 把 token 分给哪个专家',
    'Timeline': '时序 — 什么时候搬、有没有被计算藏住',
    'Payload': '载荷 — 一次搬多少',
    'Fabric': '载体 — 走哪张网（SuperPoD 内 UB / Cross-SuperPoD RoCE）',
    'Group': '并行组 — 这张 NPU 所在的各维并行组、闭合级别与 Comm 量',
    'Link': '物理链路 — 这张 NPU 的 Board 内互联、交换、CPU、网卡',
    'Lane / Object': '泳道 / 对象',
    'Utilization': '占用率',
    'TP': '张量并行（Tensor Parallel）— 把一层的矩阵按行 / 列切到几张 NPU',
    'PP': '流水并行（Pipeline Parallel）— 按层切成几段，段与段之间传激活',
    'DP': '数据并行（Data Parallel）— 每份模型吃不同的数据，步末同步梯度',
    'CP': '上下文并行（Context Parallel）— 把长序列切到几张 NPU',
    'EP': '专家并行（Expert Parallel）— MoE 的专家分到不同卡',
    'SP ': '序列并行',
    'ZeRO': 'ZeRO — 把优化器状态 / 梯度 / 权重沿数据并行切开，档位越高省得越多',
    'PP · GA': 'PP 段数 · 梯度累积步数（GA，一步里的 μb 数）',
    'GA': '梯度累积步数 — 一步里的 μb 数',
    'UB · RoCE': 'UB SuperPoD 内互联 · RoCE 跨 SuperPoD 网络的带宽',
    'fullmesh': '板内全互联 — 8 张 NPU 两两直连',
    'Clos': 'Clos 交换网络 — Board 上 NPU 连到 L1 交换',
    'H2D': 'Host to Device — 卡连到哪颗 CPU',
    'RoCE': 'RoCE 网络 — NPU 用哪块 NIC 走 Cross-SuperPoD 网络',
    'experts': '专家权重',
    'attn.q': 'Attention Q 投影权重',
    'attn.kv': 'Attention K / V 投影权重',
    'attn.out': 'Attention 输出投影权重',
    'router': '路由权重 — MoE 选专家的那一层',
    'norm×2': '两层归一化（RMSNorm）的权重',
    'Rep': '复制 — 每张 NPU 一份，不切分'
  };
  var KEYS = Object.keys(G).sort(function (a, b) { return b.length - a.length; });
  function lookup(t) {
    t = (t || '').replace(/\s+/g, ' ').trim(); if (!t || t.length > 60) return null;
    if (G[t]) return G[t];
    for (var i = 0; i < KEYS.length; i++) { var k = KEYS[i]; if (t.indexOf(k) === 0 && /^[\s·:>\d(（/A-Z×]/.test(t.slice(k.length))) return G[k] + (t.length > k.length ? '\n' + t : ''); }
    return null;
  }
  var SEL = '.dc-t, .dc-r > span:first-child, .lc-sub, .vz-cap, .vz-legend span, .sw-legend span, .sw-legend .sw-kv, .cf-chk span, .cf-seg button, .jn-mode button, #drawerTitle, .brief-row > span:first-child, .brief-row3 > span, .brief-k, .jn-al b, .dc-cmp > span';
  var q = false;
  function apply() {
    q = false;
    document.querySelectorAll(SEL).forEach(function (el) {
      var t = el.textContent, g = lookup(t);
      if (el.querySelector('.dc-cut')) t = el.firstChild && el.firstChild.nodeType === 3 ? el.firstChild.nodeValue : t, g = lookup(t);
      if (!g) { if (el.dataset.gloss) { el.removeAttribute('title'); delete el.dataset.gloss; } return; }
      if (el.dataset.gloss === g) return;
      el.setAttribute('title', g); el.dataset.gloss = g; el.classList.add('has-gloss');
    });
  }
  new MutationObserver(function () { if (!q) { q = true; requestAnimationFrame(apply); } }).observe(document.body, { childList: true, subtree: true, characterData: true });
  apply();
})();

/**
 * pto rubik-cube pattern —— 「逻辑魔方」独立 pattern。
 *
 * 从 cube-cockpit.html 的逻辑魔方抽出（形态/轴标/正交 2D/粒度提示/四维通信组/读图钥匙 全保留），
 * 并把并行度做成配置：默认 TP=2 · PP=4 · EP=8 · DP(A2A 域)=16 → 稠密层副本 128 · rank 总数 1024。
 * 注册为 window.PtoRubikCubePattern：
 *   createModel(config) → 纯布局/拓扑模型（无 Three.js 依赖，可单测/复用）
 *   mount(container, opts) → 完整交互渲染器（需 window.THREE，r128 即可）
 *
 * 保留的核心表达（与 cockpit 逻辑魔方一致，仅数字随配置变化）：
 *   · 5 种形态：标准（X=TP·Y=PP·Z=DP）/ DP平铺（副本宫格）/ EP聚簇（专家桶墙）/
 *     TP切片（权重墙）/ PP流水（段横向展开）——切形态=换投影轴，飞行动画重排；
 *   · 每形态的 3D 坐标网格框 + 轴标注 + 关键结构线（「为什么这样摆 · 这个形状帮你看什么」）；
 *   · 1 小块 = 1 卡（rank）=（TP,PP,DP）坐标交点 · EP 折入 DP 轴（桶↔卡非 1:1）；
 *   · 正交 顶/前/侧 2D 视角 + 被折叠深度维的剖面逐层翻 + 「每格=几张卡」粒度小贴士；
 *   · 选中一张卡 → TP/PP/DP/EP 四维通信组同屏高亮（维度签名色）；
 *   · 状态热力 / 按维分组着色透镜 · 异常注入（异常的形状 → 根因类别）。
 *
 * 之后与整网图（model-graphviz）/ 专家图结合的挂点：handle.selectLayer(l)（整网层 → 魔方水平切片）、
 * handle.selectBucket(e)（专家桶 → 整面墙）、opts.onSelect（rank 反查多维身份）。
 */
(function registerPtoRubikCubePattern(global) {
  'use strict';

  /* ── 并行度配置：rank 总数 = tp × pp × dp（默认 2×4×128 = 1024）。
        EP 不参与乘法（与 cockpit 白皮书语义一致：EP 折入 DP 轴，不新增轴）——
        ep 只要求整除 dp：副本 rep 持有专家桶 rep%ep，相邻 ep 个副本构成
        1 个 A2A 域，共 dp/ep 个域（默认 128/8 = 16）。 ── */
  // 默认 = 盘古 Pro MoE 真实训练策略（TP8·EP2·PP5·4K NPU → dp = 4000/(8×5) = 100，
  // EP2 折入其中 → 50 个 A2A 域）。出处 data/ascend-workload-pangu-moe.json ← arXiv 2505.21411。
  const DEFAULTS = {
    tp: 8, pp: 5, dp: 100, ep: 2,
    layers: 48,            // 整网层数 → 每 PP 段 layers/pp 层
    experts: 64,           // 路由专家总数 → 每桶 experts/ep 个
    hotBuckets: [0, 2],    // 示意热点专家桶（标暖色）
  };

  /* ══ 布局规则（单一事实源）════════════════════════════════════════════
     目标：任何 (tp,pp,dp,ep) 组合都自动排布好，形态只声明「意图」不写死数值，
     以后加维度（CP/SP…）或加形态只需按同样规则声明。三条规则：

       ① 卡块尺寸恒定（CARD）——换形态、换配置都不改变一张卡的大小；
       ② 单维轴步距 = CARD[轴] + 缝隙(成员数) × 层级倍率。缝隙按成员数分档：
          成员越多缝越紧（长轴不被拉成细丝），越少缝越松（短轴不退化成薄片）；
          层级倍率表达意图：dense 密排 · normal 常规 · spread 留白 · emph 强调分离；
       ③ 复合轴（外维分块 · 内维紧邻，如「板 / 墙」）：外维步距 = 内维总跨度 +
          分块留白（按跨度成比例），于是任何规模下块与块都清楚分开、不重叠；
       ④ 2D 可读性约束：任一正交视角（顶/前/侧）下，屏幕两根轴的「最细步距」之比
          ≤ MAX_RATIO。否则一轴被拉成稀疏条纹——例如 DP 平铺的板在顶视里只有 1 张卡
          厚，若行距按板宽取（方形宫格），每格 98% 是空的、完全读不出结构。因此
          分块轴的块间距以「同屏另一轴最细步距 × MAX_RATIO」封顶（见 clampFor2D）。

     不变量：任一轴步距 ≥ 该轴卡块尺寸 + 最小缝（0.13×0.55 ≈ 0.07）→ 永不重叠。 */
  // 卡块是正方体：同一张卡在任何形态、任何视角下都呈现同样的形状。若做成长方体，
  // 某个维度落到哪根轴上、卡就把哪个面朝向你，读起来像「卡被转了 90°」——同一种东西
  // 在不同视图里长得不一样，正是 cockpit 当年修过的失衡问题。
  const CARD = { x: 0.6, y: 0.6, z: 0.6 };
  const GAP_BY_N = (n) => (n <= 4 ? 0.85 : n <= 12 ? 0.6 : n <= 48 ? 0.3 : 0.13);
  const TIER = { dense: 0.55, normal: 1, spread: 1.8, emph: 4 };
  const stepOf = (ax, n, tier) => CARD[ax] + GAP_BY_N(n) * TIER[tier || 'normal'];
  const padOf = (span) => Math.max(0.9, span * 0.34);        // 块间留白（随块跨度成比例）
  const MAX_RATIO = 4;                                       // 同屏两轴最细步距的比值上限
  // 把分块步距压到「同屏另一轴最细步距」的 MAX_RATIO 倍以内（下限 = 该轴卡块 + 缝）
  const clampFor2D = (want, ax, ...coPitches) =>
    Math.max(CARD[ax] + 0.3, Math.min(want, MAX_RATIO * Math.min(...coPitches)));

  /* 一个训练 step 的通信阶段（与集群驾驶舱 cube-cockpit.html 的 PHASES 同一套语义）：
     时间轴按阶段读，而不是抽象的秒——每个阶段由哪根并行轴主导、走哪层总线、负载多高
     都不同，热力场因此随阶段变化（TP 组齐动 / PP 接力波沿流水级前进 / EP 浪涌点亮热点桶 /
     DP 全网梯度）。 */
  const PHASES = [
    { id: 'TP', dim: 'TP', name: 'TP · 前向 AllReduce', bus: '节点内 UB · 高频', load: 0.92 },
    { id: 'PP', dim: 'PP', name: 'PP · 阶段接力 Send/Recv', bus: 'Pod 内跨 Host · 中频', load: 0.45 },
    { id: 'EP', dim: 'EP', name: 'EP · MoE AllToAll 浪涌', bus: 'Pod 内全互联 · 浪涌', load: 0.88 },
    { id: 'DP', dim: 'DP', name: 'DP · 梯度 AllReduce', bus: '跨 Pod Scale-Out · 低频大包', load: 0.60 },
  ];
  const STEP_SEC = 12;                                       // 一个 step 的墙钟时长（每阶段 3s）

  /* ════════ 设计系统色卡解析（3D 用不了 CSS 变量 → 挂载/切主题时把 token 读成色值）════════
     所有 3D 着色都从 PTO Design System 的 token 取：
       · 负载热力 = --success → --warning → --danger（与图例色带同源，颜色逐格一致）
       · 异常组   = --danger
       · 分组着色 = highlight 六族（copy-blue / accum-orange / l0a-violet / ub-green /
                    mte-amber / l0b-deep-violet）的 400 与 600 两档，共 12 色循环
       · 网格 / 外框 / 字牌底与描边 = --border-* · --surface-* · --foreground-*
       · 字牌字体 = --font-sans
     唯一的例外：TP 的维度签名色需要一个既非红黄绿（状态色专用）又不与 DP 蓝 / EP 紫
     撞色的青，而设计系统色卡里没有青族 → 由 pattern 提供 --dim-tp，并在 README 标记
     为待回portal 上游（同上游对 .toggle-outline 的处理方式）。 */
  const TOKEN_KEYS = [
    '--background', '--surface-1', '--surface-2', '--foreground', '--foreground-secondary',
    '--foreground-muted', '--border-default', '--border-strong', '--primary', '--success',
    '--warning', '--danger', '--accent', '--font-sans', '--font-mono',
    '--highlight-copy-blue-300', '--highlight-accum-orange-300', '--highlight-l0a-violet-300',
    '--highlight-ub-green-300', '--highlight-mte-amber-300', '--highlight-l0b-deep-violet-300',
    '--highlight-copy-blue-400', '--highlight-accum-orange-400', '--highlight-l0a-violet-400',
    '--highlight-ub-green-400', '--highlight-mte-amber-400', '--highlight-l0b-deep-violet-400',
    '--highlight-copy-blue-600', '--highlight-accum-orange-600', '--highlight-l0a-violet-600',
    '--highlight-ub-green-600', '--highlight-mte-amber-600', '--highlight-l0b-deep-violet-600',
    '--highlight-ub-green-700', '--highlight-mte-amber-500',
    '--dim-tp',
  ];
  // css 颜色 → {r,g,b,a}（支持 #rgb/#rrggbb/#rrggbbaa 与 rgb()/rgba()）
  function cssRGBA(c) {
    c = (c || '').trim();
    let m = /^#([0-9a-f]{3,8})$/i.exec(c);
    if (m) {
      let h = m[1];
      if (h.length === 3) h = h.split('').map((x) => x + x).join('');
      const n = parseInt(h.slice(0, 6), 16);
      return { r: (n >> 16 & 255) / 255, g: (n >> 8 & 255) / 255, b: (n & 255) / 255, a: h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
    }
    m = /^rgba?\(([^)]+)\)$/i.exec(c);
    if (m) {
      const p = m[1].split(/[,/\s]+/).filter(Boolean).map(parseFloat);
      return { r: p[0] / 255, g: p[1] / 255, b: p[2] / 255, a: p.length > 3 ? p[3] : 1 };
    }
    return { r: 0.5, g: 0.5, b: 0.5, a: 1 };
  }
  const hex2 = (v) => ('0' + Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16)).slice(-2);

  /* 维度签名色的 token 映射（PP/DP/EP 在色卡里有精确对应，TP 见上文说明） */
  const DIM_TOKEN = { TP: '--dim-tp', PP: '--warning', DP: '--primary', EP: '--highlight-l0a-violet-400' };
  /* 物理链路层级色（B 档）：同机 UB 用色卡里的 ub-green（名字与语义天然对上），
     Pod 内 rail 用 mte-amber，跨 Pod 用 l0b-deep-violet——三者都不与四维签名色撞。
     不用红黄绿是因为红/黄在本 pattern 里是状态色（负载/异常）专用。 */
  const TIER_TOKEN = {
    ub: '--highlight-ub-green-400',
    rail: '--highlight-mte-amber-400',
    out: '--highlight-l0b-deep-violet-600',
  };
  /* 分组着色调色板：六族 × 两档（深 600 → 浅 300），共 12 色。
     不用 400/500 档：那两档是色卡里彩度最高的一段（ub-green-400 #B3F141、
     mte-amber-400 #F4CB22 尤甚），几百上千张卡同屏铺满时会糊成一片荧光。
     600 档饱和度相当但明度低一截、300 档明度高但彩度降下来——两档都落在"能分辨、
     不刺眼"的区间，且深浅交替本身又多给了一层区分度。
     ub-green 整族偏荧光，深档取 700（橄榄绿）而不是 600。
     排序不是「先排完深档再排浅档」：六族里蓝 / 靛 / 紫三族色相只差 25~55°，一旦同档相邻
     就分不开（PP0 深蓝 vs PP4 深靛）。所以两档交错着排——前 6 位先用四个真正拉得开的
     色相（蓝·橙·橄榄·紫），第 5、6 位改用浅档的琥珀与靛，靠明度差把近色相拆开。
     分组数通常 ≤8，前几位的可分辨度最值钱。 */
  const GROUP_TOKENS = [
    '--highlight-copy-blue-600', '--highlight-accum-orange-600', '--highlight-ub-green-700',
    '--highlight-l0a-violet-600', '--highlight-mte-amber-500', '--highlight-l0b-deep-violet-300',
    '--highlight-accum-orange-300', '--highlight-copy-blue-300', '--highlight-ub-green-300',
    '--highlight-l0a-violet-300', '--highlight-l0b-deep-violet-600', '--highlight-mte-amber-300',
  ];

  /* ════════════════════════ 纯布局模型 ════════════════════════ */
  function createModel(userCfg) {
    const C = Object.assign({}, DEFAULTS, userCfg || {});
    const TP = C.tp | 0, PP = C.pp | 0, EP = C.ep | 0;
    const REP = C.dp | 0;                 // 稠密层 DP 副本数（EP 折入其中，不参与乘法）
    if (TP < 1 || PP < 1 || EP < 1 || REP < 1) throw new Error('rubik-cube: tp/pp/dp/ep 均须 ≥ 1');
    if (REP % EP) throw new Error(`ep(${EP}) 须整除 dp(${REP})——EP 折入 DP 轴，不参与乘法`);
    const DOM = REP / EP;                 // A2A 域数（专家数据并行组）
    const N = TP * PP * REP;              // rank 总数 = tp × pp × dp
    const LPS = Math.max(1, Math.round(C.layers / PP));            // 每段层数
    const EXP_PER = Math.max(1, Math.floor(C.experts / EP));       // 每桶专家数
    // ── 轴步距（布局规则推导）──
    const CY = 9;                                    // 逻辑体离地高度（各形态统一）
    const tpStep = stepOf('x', TP);                  // 板 / 墙内 TP 列步距
    const ppStep = stepOf('y', PP);                  // 板 / 墙内 PP 行步距
    const blockW = TP * tpStep;                      // 一面墙的宽度（EP 聚簇：内维 TP 一字排开）
    /* DP 平铺的「板」：把板内 TP 折成 (TPC 列 × TPD 排)，让板有厚度——一字排开的板
       只有 1 张卡厚，在顶视/侧视里都退化成稀疏条纹。取「宽 ≥ 深」且世界跨度最接近
       方形的分法（TP=8 → 4×2 · TP=16 → 4×4 · TP=2 → 2×1）。 */
    const tpStepZ = stepOf('z', TP);                 // 板内 TP「排」的纵深步距
    const TPC = (() => {
      const ideal = Math.sqrt(TP * tpStepZ / tpStep), lo = Math.sqrt(TP) - 1e-9;
      let best = TP, err = Infinity;
      for (let c = 1; c <= TP; c++) {
        if (TP % c || c < lo) continue;              // 只取宽 ≥ 深的分法，保住「板」的横向读法
        const e = Math.abs(Math.log(c / ideal));
        if (e < err) { err = e; best = c; }
      }
      return best;
    })();
    const TPD = TP / TPC;
    // 分块格距统一用同一条公式：「块在该轴的跨度 + padOf(该跨度)」，逐轴各算各的。
    const dptBlockW = TPC * tpStep, dptBlockD = TPD * tpStepZ;
    const dptCellX = dptBlockW + padOf(dptBlockW);
    const dptCellZ = clampFor2D(dptBlockD + padOf(dptBlockD), 'z', tpStep, ppStep);
    // 宫格行列数：按「世界跨度近方形」取，而不是按数量取方阵——板是宽而薄的
    // （列距 ≫ 行距），数量方阵会把顶视与轴测拉成长条。
    const COLS = (() => {
      const ideal = Math.max(1, Math.sqrt(REP * dptCellZ / dptCellX));
      let best = 1, err = Infinity;
      for (let c = 1; c <= REP; c++) {
        if (REP % c) continue;
        const e = Math.abs(Math.log(c / ideal));
        if (e < err) { err = e; best = c; }
      }
      return best;
    })();
    const ROWS = REP / COLS;

    // rank 编码：rank = (rep*PP + pp)*TP + tp
    const tpOf = (r) => r % TP;
    const ppOf = (r) => ((r / TP) | 0) % PP;
    const repOf = (r) => (r / (TP * PP)) | 0;
    const epOf = (r) => repOf(r) % EP;            // 持有的专家桶
    const domOf = (r) => (repOf(r) / EP) | 0;     // 所属 A2A 域
    const gxOf = (r) => repOf(r) % COLS;          // DP 平铺列
    const gzOf = (r) => (repOf(r) / COLS) | 0;    // DP 平铺行
    const rankOf = (tp, pp, rep) => (rep * PP + pp) * TP + tp;
    const stageLayerRange = (s) => ({ lo: s * LPS + 1, hi: Math.min(C.layers, (s + 1) * LPS) });
    const expRange = (e) => 'E' + (e * EXP_PER) + '-' + (e * EXP_PER + EXP_PER - 1);

    /* ── 物理落位（可选输入）：逻辑 rank → 装在哪台机、哪个 Pod ──────────────
       逻辑魔方本身只讲「谁和谁一组」，不讲「谁和谁插在一起」。给出落位后，同一条
       逻辑边就能标出它实际跨了哪层链路：
         同机  → UB（节点内全互联，带宽最高、延迟最低）
         同 Pod 跨机 → Pod 内 rail / Scale-Up
         跨 Pod → Scale-Out（最贵的一跳）
       默认按 rank 连号装机（rank 编码本就是 TP 最内层 → TP 组自然落在同一台机内，
       与真实作业的 rank-to-node 映射一致）。宿主可用 placement 覆盖每机卡数/每 Pod
       机数，或直接给 slots 数组做任意映射。 */
    const PLC = Object.assign({ cardsPerHost: 8, hostsPerPod: 32 }, C.placement || {});
    const CPH = Math.max(1, PLC.cardsPerHost | 0);          // 每台机的卡数
    const HPP = Math.max(1, PLC.hostsPerPod | 0);           // 每个 Pod 的机数
    const CPP = CPH * HPP;                                  // 每个 Pod 的卡数
    const slotOf = (r) => (PLC.slots && PLC.slots[r] != null ? PLC.slots[r] | 0 : r);
    const hostOf = (r) => (slotOf(r) / CPH) | 0;
    const podOf = (r) => (slotOf(r) / CPP) | 0;
    const HOSTS = Math.ceil(N / CPH), PODS = Math.ceil(N / CPP);
    // 一条逻辑边实际跨了哪层链路
    const tierOf = (a, b) => (hostOf(a) === hostOf(b) ? 'ub' : podOf(a) === podOf(b) ? 'rail' : 'out');

    // 居中偏移
    const cT = (TP - 1) / 2, cP = (PP - 1) / 2, cR = (REP - 1) / 2,
      cE = (EP - 1) / 2, cD = (DOM - 1) / 2, cG = (COLS - 1) / 2, cZ = (ROWS - 1) / 2;

    /* 各形态的轴间距——全部由上面的布局规则推导（不再逐形态手调常量）。
       每个形态只声明「哪根轴放哪个维、用什么层级」，换任何并行数字都自动成立。 */
    const SP = {
      // 标准：三根语义轴各一维，常规层级 —— 位置即多维坐标
      std: { sx: tpStep, sy: ppStep, sz: stepOf('z', REP), cy: CY },
      // DP 平铺：外维 = 副本宫格（列距 = 板宽 + 留白 · 行距受 2D 约束）· 内维 = 板内 TP 列 / PP 行
      dpt: { gapX: dptCellX, gapZ: dptCellZ, tp: tpStep, tpz: tpStepZ, pp: ppStep, y0: 1.0, cols: TPC, rows: TPD },
      // EP 聚簇：外维 = 桶墙（墙宽 + 块间留白）· 内维 = 墙内 TP 列 · Z = A2A 域（留白层级，域界可读）
      ep: { gapE: blockW + padOf(blockW), tp: tpStep, pp: stepOf('y', PP), dom: stepOf('z', DOM, 'spread'), cy: CY },
      // TP切片 / PP流水 是「强调类」形态：主轴用 emph 层级（4×）拉开，强调
      // 「墙拉开查同槽位 / 段拉开找慢段」的读法。这个 4× 正好卡在 MAX_RATIO 上，
      // 2D 里主轴会显得稀疏 —— 靠 axBlockFrames 给每块套框把条纹读成整块，不靠压步距
      // （压了这两个形态就没意义了）。
      tps: { gapT: stepOf('x', TP, 'emph'), pp: stepOf('y', PP), rep: stepOf('z', REP), cy: CY },
      ppf: { gapP: stepOf('x', PP, 'emph'), tp: stepOf('y', TP), rep: stepOf('z', REP), cy: CY },
    };

    // 5 种形态的 rank → 世界坐标（out 为 {x,y,z} 或 THREE.Vector3 均可）
    function posOf(r, mode, out) {
      out = out || { x: 0, y: 0, z: 0 };
      const tp = tpOf(r), pp = ppOf(r), rep = repOf(r);
      if (mode === 1) {          // DP 平铺：副本宫格，每副本一块 TP(列×排)×PP 的板（找慢副本）
        const s = SP.dpt, tc = tp % TPC, td = (tp / TPC) | 0;
        out.x = (gxOf(r) - cG) * s.gapX + (tc - (TPC - 1) / 2) * s.tp;
        out.y = s.y0 + (PP - 1 - pp) * s.pp;
        out.z = (gzOf(r) - cZ) * s.gapZ + (td - (TPD - 1) / 2) * s.tpz;
        return out;
      }
      if (mode === 2) {          // EP 专家桶墙：桶成墙（同墙=持有相同专家）· 墙内 X=TP 列 · Y=PP · Z=A2A 域
        const s = SP.ep;
        out.x = (epOf(r) - cE) * s.gapE + (tp - cT) * s.tp;
        out.y = s.cy + (cP - pp) * s.pp;
        out.z = (domOf(r) - cD) * s.dom;
        return out;
      }
      if (mode === 3) {          // TP 切片：权重墙沿 X 拉开，一面墙=全集群同槽位切片
        const s = SP.tps;
        out.x = (tp - cT) * s.gapT;
        out.y = s.cy + (cP - pp) * s.pp;
        out.z = (rep - cR) * s.rep;
        return out;
      }
      if (mode === 4) {          // PP 流水：段横向展开成流水线（找慢段/气泡）
        const s = SP.ppf;
        out.x = (pp - cP) * s.gapP;
        out.y = s.cy + (tp - cT) * s.tp;
        out.z = (rep - cR) * s.rep;
        return out;
      }
      const s = SP.std;          // 标准：X=TP · Y=PP · Z=DP（位置即多维坐标）
      out.x = (tp - cT) * s.sx;
      out.y = s.cy + (cP - pp) * s.sy;
      out.z = (rep - cR) * s.sz;
      return out;
    }

    // 正交 2D 被折叠的「深度」维（顶↓Y · 前↓Z · 侧↓X），随形态不同 —— 对齐 cockpit ODEP 表
    const depthDims = {
      tp: { n: TP, lab: 'TP' }, pp: { n: PP, lab: 'PP' }, rep: { n: REP, lab: 'DP' },
      ep: { n: EP, lab: '专家桶' }, dom: { n: DOM, lab: 'A2A域' },
      gx: { n: COLS, lab: '副本列' }, gz: { n: ROWS, lab: '副本行' },
      tpc: { n: TPC, lab: '板内TP列' }, tpd: { n: TPD, lab: '板内TP排' },
    };
    const depthIdxOf = (r, dim) => dim === 'tp' ? tpOf(r) : dim === 'pp' ? ppOf(r)
      : dim === 'rep' ? repOf(r) : dim === 'ep' ? epOf(r) : dim === 'dom' ? domOf(r)
        : dim === 'gx' ? gxOf(r) : dim === 'gz' ? gzOf(r)
          : dim === 'tpc' ? tpOf(r) % TPC : dim === 'tpd' ? (tpOf(r) / TPC) | 0 : 0;

    /* 五种形态都给满 顶/前/侧。曾经把 TP切片/PP流水 的 2D 收编掉（只留轴测），理由是
       「与标准共享 TP/PP/DP 三轴、三平面两两重合」——那个判断只对了一半：
         · TP切片 的轴分配确实与标准相同，但主轴是 emph 层级（步距 4×），2D 里墙与墙之间
           是看得见的空档，而标准里是密排——同一个平面，「哪一片」在这里才数得清；
         · PP流水 干脆换了轴分配（X=PP · Y=TP，标准是 X=TP · Y=PP），三个平面全是新的。
       真正的问题从来不是重合，而是主轴 4× 步距会让 2D 散成稀疏条纹。解法是给每一块套框
       （axBlockFrames），条纹立刻读成「一面墙 / 一段」。 */
    const D_STD = { 1: ['pp'], 2: ['rep'], 3: ['tp'] };   // 视角 → 被折进视线的维（可多个）
    const modes = [
      {
        key: 'std', name: '标准', short: '标准',
        sub: `标准 X=TP Y=PP(模型深度) Z=DP`,
        why: `位置即多维坐标：X=TP·Y=PP·Z=DP 同屏三维 · 着色透镜再叠第 4 维（换形态只换投影轴）`,
        viewLabels: { 1: '顶 DP-TP 面', 2: '前 TP-PP 面', 3: '侧 DP-PP 面' }, depth: D_STD,
        views: [0, 1, 2, 3],
      },
      {
        key: 'dpt', name: 'DP平铺', short: 'DP',
        sub: `DP 平铺：${REP} 副本各自成板（找慢副本）`,
        why: `副本间只在步末做梯度 AllReduce · 发暗/掉队的那块板 = 慢副本`,
        viewLabels: { 1: '顶 副本网格', 2: '前 列-PP 面', 3: '侧 行-PP 面' },
        // 板内 TP 折成「列×排」后板有了厚度：顶视每个副本是一片瓦（而非一条线），
        // 侧视也不再塌陷 → 三个正交视角都成立。
        depth: { 1: ['pp'], 2: ['gz', 'tpd'], 3: ['gx', 'tpc'] },
        views: [0, 1, 2, 3],
      },
      {
        key: 'ep', name: 'EP聚簇', short: 'EP',
        sub: `EP 聚簇：${EP} 专家桶成墙（桶=MoE 组 · 每桶复现于 ${DOM} 个 A2A 域 · 桶↔卡非 1:1）`,
        why: `桶故障 = 整面墙同红 · 域热点 = 横穿 ${EP} 墙的一排过热 · 桶↔卡非 1:1`,
        viewLabels: { 1: '顶 桶-域 面', 2: '前 桶-PP 面', 3: '侧 域-PP 面' },
        depth: { 1: ['pp'], 2: ['dom'], 3: ['ep', 'tp'] },   // 侧视同时折叠墙序与墙内 TP（域数多，仍成阵）
        views: [0, 1, 2, 3],
      },
      {
        key: 'tps', name: 'TP切片', short: 'TP',
        sub: `TP 切片：${TP} 片权重墙 · 一面墙=全集群同槽位切片（查同槽位系统性故障）`,
        why: `同槽位系统性故障（整批同号卡坏件）= 一面墙集体异常`,
        viewLabels: { 1: '顶 DP-TP 面', 2: '前 TP-PP 面', 3: '侧 DP-PP 面' }, depth: D_STD,
        views: [0, 1, 2, 3],
      },
      {
        key: 'ppf', name: 'PP流水', short: 'PP',
        sub: `PP 流水：${PP} 段横向展开 · 左=Stage0 右=Stage${PP - 1}（找慢段/气泡）`,
        why: `只有 PP 适合说「哪段层在哪」· ${PP} 段各 ${LPS} 层 · 慢段拖住下游 = 右侧板变暗 · 空档=bubble`,
        viewLabels: { 1: '顶 DP-PP 面', 2: '前 PP-TP 面', 3: '侧 DP-TP 面' },
        depth: { 1: ['tp'], 2: ['rep'], 3: ['pp'] },
        views: [0, 1, 2, 3],
      },
    ];

    // 四维通信组（选中 rank 的对端）——语义与 cockpit activePeerChips 一致
    function commGroup(r, dim) {
      const tp = tpOf(r), pp = ppOf(r), rep = repOf(r), out = [];
      if (dim === 'TP') { for (let t = 0; t < TP; t++) out.push(rankOf(t, pp, rep)); }
      else if (dim === 'PP') { for (let p = 0; p < PP; p++) out.push(rankOf(tp, p, rep)); }
      else if (dim === 'DP') {                       // 同位副本（全量 AllReduce·显示采样）
        const step = Math.max(1, REP >> 4);
        for (let d = 0; d < REP; d += step) out.push(rankOf(tp, pp, d));
      } else {                                       // EP：A2A 域内同位 rank（每桶各出 1 员互发）
        const d0 = domOf(r) * EP;
        for (let e = 0; e < EP; e++) out.push(rankOf(tp, pp, d0 + e));
      }
      return out;
    }

    // 各形态包围盒（轴标注/取景用）
    const boundsCache = {};
    function boundsOf(mode) {
      if (boundsCache[mode]) return boundsCache[mode];
      const b = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9, z0: 1e9, z1: -1e9 };
      const v = { x: 0, y: 0, z: 0 };
      for (let r = 0; r < N; r++) {
        posOf(r, mode, v);
        if (v.x < b.x0) b.x0 = v.x; if (v.x > b.x1) b.x1 = v.x;
        if (v.y < b.y0) b.y0 = v.y; if (v.y > b.y1) b.y1 = v.y;
        if (v.z < b.z0) b.z0 = v.z; if (v.z > b.z1) b.z1 = v.z;
      }
      return (boundsCache[mode] = b);
    }

    return {
      config: C, TP, PP, EP, DOM, REP, N, LPS, EXP_PER, COLS, ROWS, TPC, TPD, SP, CARD,
      tpOf, ppOf, repOf, epOf, domOf, gxOf, gzOf, rankOf,
      stageLayerRange, expRange, posOf, boundsOf,
      modes, depthDims, depthIdxOf, commGroup,
      // 物理落位
      placement: { cardsPerHost: CPH, hostsPerPod: HPP, cardsPerPod: CPP, hosts: HOSTS, pods: PODS },
      hostOf, podOf, tierOf,
      hotBuckets: new Set((C.hotBuckets || []).filter((e) => e < EP)),
    };
  }

  /* ════════════════════════ 渲染器 ════════════════════════ */
  function mount(container, opts) {
    opts = opts || {};
    const THREE = global.THREE;
    if (!THREE) throw new Error('PtoRubikCubePattern.mount 需要 window.THREE（three r128）先行加载');
    // 模型可整体重建（工具栏「并行」输入排 / setConfig API 自由改维度）：
    // 维度快照用 let + syncDims 同步，mount 内所有引用自动跟随新配置。
    let model = createModel(opts.config);
    let TP, PP, EP, DOM, REP, N, LPS;
    const syncDims = () => { ({ TP, PP, EP, DOM, REP, N, LPS } = model); };
    syncDims();

    /* ── 状态 ── */
    const S = {
      mode: opts.mode | 0,
      view: 0,                       // 0=轴测 · 1=顶 · 2=前 · 3=侧
      sliceOn: false, sliceVal: 0,   // 正交剖面：单层查看被折叠的深度维
      colorBy: 'load',               // load | tp | pp | dp | ep | host | pod（后两个 = 物理落位透镜）
      anom: 'none',                  // none | tp | pp | dp | ep（异常注入 → 「异常的形状」）
      playing: true,
      theme: opts.theme === 'light' ? 'light' : 'dark',
      sel: null, hover: null,        // 选中/悬停 rank
      // 连线图层（每项都可单独关闭）与集合算法。focus=选中聚焦：与选中卡无关的卡压暗
      wire: { members: true, lines: true, outline: true, movers: true, focus: true },
      algo: 'auto',                  // auto（按维选原语）/ ring / tree

      selEdge: null,                 // 选中的通信边（C 档：宿主据此点亮物理链路）
      more: false,                   // 工具栏抽屉（着色/注入/连线/时间/并行）是否展开
      selLayer: null,                // 整网层 → 魔方水平切片（整网图联动挂点）
      t: 0,
    };
    const isDark = () => S.theme !== 'light';
    const themeC = (dark, light) => (isDark() ? dark : light);
    /* 设计系统 token → 具体色值（切主题时重读；3D 材质只能吃具体色值） */
    const TOK = {};
    function readTokens() {
      let cs = null;
      try { cs = getComputedStyle(root); } catch (e) { /* noop */ }
      TOKEN_KEYS.forEach((k) => { TOK[k] = cs ? (cs.getPropertyValue(k) || '').trim() : ''; });
    }
    // token → 不透明色（半透明 token 先按 --background 合成，Three 的材质吃不了 alpha 色）
    function tokRGB(key, fallback) {
      const c = cssRGBA(TOK[key] || fallback || '#808080');
      if (c.a >= 0.999) return c;
      const bg = cssRGBA(TOK['--background'] || '#101010');
      return { r: bg.r + (c.r - bg.r) * c.a, g: bg.g + (c.g - bg.g) * c.a, b: bg.b + (c.b - bg.b) * c.a, a: 1 };
    }
    const tokHex = (key, fallback) => { const c = tokRGB(key, fallback); return '#' + hex2(c.r) + hex2(c.g) + hex2(c.b); };
    const dimc = (d) => tokHex(DIM_TOKEN[d]);
    const tierc = (k) => tokHex(TIER_TOKEN[k]);          // 物理链路层级色（同机 / Pod 内 / 跨 Pod）
    const groupColor = (i) => tokHex(GROUP_TOKENS[i % GROUP_TOKENS.length]);

    /* ── DOM 骨架 ── */
    const root = document.createElement('div');
    root.className = 'prc-root';
    root.setAttribute('data-theme', S.theme);
    root.innerHTML = [
      '<div class="prc-stage"></div>',
      opts.chrome === false ? '' : [
        // 常驻只留「形态 / 视角」——它们决定画面本身怎么摆；其余（着色/注入/连线/时间/
        // 并行）是筛选与工况，收进一个可开合的抽屉，默认收起，画面因此干净。
        // 顶栏（对齐设计系统 sidecar 的页头）：左边是这张图叫什么 + 规格小签，
        // 右边是配置（形态 / 视角两组互斥控件 + 「更多」抽屉）。
        '<div class="prc-topbar">',
        '  <div class="prc-brandname">逻辑魔方</div>',
        '  <div class="prc-tools">',
        '    <span class="prc-group segmented-control prc-row-modes"></span>',
        '    <span class="prc-group segmented-control prc-row-views"></span>',
        '    <span class="prc-timewrap">',
        '      <button class="prc-playbtn btn btn-sm prc-iconbtn" type="button"></button>',
        '      <div class="prc-timepop panel-shell"><span class="prc-lab">时间</span></div>',
        '    </span>',
        '    <button class="prc-morebtn btn btn-sm prc-iconbtn" type="button"></button>',
        // 宿主控件（主题切换等）的插槽：放进同一张卡，按钮才成套
        '    <span class="prc-toolslot"></span>',
        '  </div>',
        '</div>',
        '<div class="prc-more panel-shell">',
        '  <div class="prc-row prc-row-lens"><span class="prc-lab">着色</span></div>',
        '  <div class="prc-row prc-row-anom"><span class="prc-lab">注入</span></div>',
        '  <div class="prc-row prc-row-wire"><span class="prc-lab">连线</span></div>',
        '  <div class="prc-row prc-row-cfg"><span class="prc-lab">并行</span></div>',
        '</div>',
        '<div class="prc-pill stat-chip"></div>',
        '<div class="prc-legend panel-shell"></div>',
        '<div class="prc-info panel-shell"></div>',
      ].join(''),
      '<div class="prc-tip"></div>',
    ].join('');
    container.appendChild(root);
    readTokens();   // 挂进文档后才能解析 token（detached 元素读不到 computed style）
    const $ = (sel) => root.querySelector(sel);
    const stageEl = $('.prc-stage'), tipEl = $('.prc-tip');

    /* ── three 场景 ── */
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    stageEl.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -500, 1000);
    /* 打光总增益必须 ≈ 1：MeshStandard 的出射色 = 材质色 ×(环境 + 平行×N·L)，
       原来 0.85+0.55 意味着朝光的顶面拿到 1.4× —— token 里本就高彩度的色一乘就顶到
       通道上限，几百张卡铺满屏幕时集体读成荧光。改成 环境 0.74 + 主光 0.32 + 背光 0.10：
       顶面 ≈1.0（所见即 token 色），立面 ≈0.85，背面靠背光托住不发死，
       三个可见面仍差出 ~15% 的明度阶梯，立体感不丢。 */
    scene.add(new THREE.AmbientLight(0xffffff, 0.74));
    const dl = new THREE.DirectionalLight(0xffffff, 0.32); dl.position.set(18, 30, 12); scene.add(dl);
    const dlFill = new THREE.DirectionalLight(0xffffff, 0.10); dlFill.position.set(-14, 6, -18); scene.add(dlFill);

    const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
    const dummy = new THREE.Object3D(), cTmp = new THREE.Color();

    // 卡阵列：InstancedMesh，1 小块 = 1 卡（rank）。维度改变时整体重建（buildField）。
    const BOXG = new THREE.BoxGeometry(CARD.x, CARD.y, CARD.z);   // 卡块尺寸 = 布局规则的 CARD（恒定）
    const boxMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.02 });
    let chips = null;
    let cur, target, scl;
    let settling = true;
    // 卡块尺寸全形态恒定（用户约定：换形态不改变一张卡的大小）——各形态布局的格步距
    // 均按「装得下固定卡块」设计（见 SP 注释），无需按形态缩放。
    function buildField() {
      if (chips) { scene.remove(chips); if (chips.dispose) chips.dispose(); }
      chips = new THREE.InstancedMesh(BOXG, boxMat, N);
      chips.frustumCulled = false;
      scene.add(chips);
      // 位置缓冲：cur → target 飞行 lerp（切形态的重排动画）
      cur = new Float32Array(N * 3); target = new Float32Array(N * 3); scl = new Float32Array(N);
      const v = { x: 0, y: 0, z: 0 };
      for (let r = 0; r < N; r++) {
        model.posOf(r, S.mode, v);
        cur[r * 3] = v.x; cur[r * 3 + 1] = v.y; cur[r * 3 + 2] = v.z;
        target[r * 3] = v.x; target[r * 3 + 1] = v.y; target[r * 3 + 2] = v.z;
        scl[r] = 1;
      }
      settling = true;
    }
    buildField();
    function retarget() {
      const v = { x: 0, y: 0, z: 0 };
      for (let r = 0; r < N; r++) {
        model.posOf(r, S.mode, v);
        target[r * 3] = v.x; target[r * 3 + 1] = v.y; target[r * 3 + 2] = v.z;
      }
      settling = true;
    }

    // 焦点/悬停/关联标记
    function edgeBox(color) {
      // 焦点线框跟着卡块尺寸走（CARD 是正方体）——沿用旧的各向异性尺寸会框成扁盒子，
      // 与卡对不上、也更难看清选中的是哪一张。
      const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(CARD.x * 1.34, CARD.y * 1.34, CARD.z * 1.34));
      return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false }));
    }
    const hovBox = edgeBox(0x9ecbff);
    hovBox.visible = false; hovBox.renderOrder = 7;
    scene.add(hovBox);
    /* 选中标记 = 卡自己的颜色做的「涟漪呼吸灯」，不是外框。
       深色细框在浅底上又硬又抢，而且和卡是两种语言；改成两样东西：
         · 光晕：一个比卡略大的盒子，只渲染背面（BackSide）——于是它只在卡的四周
           透出一圈光，不会盖在卡的正面上（正面一旦被盖，卡自己的着色就读不准了）；
         · 涟漪：两圈线框从卡向外扩散并淡出，错相位循环，像水波一样一圈接一圈。
       两者的颜色都取「这张卡此刻的颜色」（负载/分组/异常都跟着变），所以它读起来是
       这张卡在发光，而不是有人在它外面套了个框。 */
    const selColor = new THREE.Color();
    const selHalo = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, side: THREE.BackSide, depthWrite: false, depthTest: false }));
    selHalo.renderOrder = 4; selHalo.visible = false; scene.add(selHalo);
    const selRipples = [0, 1].map(() => {
      const m = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
        new THREE.LineBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false, depthTest: false }));
      m.renderOrder = 7; m.visible = false; scene.add(m);
      return m;
    });
    let selColorAt = -1;
    function updateSelFx(nowMs) {
      const on = S.sel != null && S.sel < N;
      selHalo.visible = on; selRipples.forEach((m) => { m.visible = on; });
      if (!on) return;
      if (nowMs - selColorAt > 200) {              // 颜色跟着卡走（热力随阶段变），不必每帧算
        selColorAt = nowMs;
        selColor.copy(colorOfRank(S.sel));
        // 太暗的卡（暗色主题的低负载）给一点提亮，光晕才透得出来
        const hsl = {}; selColor.getHSL(hsl);
        if (hsl.l < 0.42) selColor.setHSL(hsl.h, Math.min(1, hsl.s * 1.1), 0.52);
        selHalo.material.color.copy(selColor);
        selRipples.forEach((m) => m.material.color.copy(selColor));
      }
      const p = V3(cur[S.sel * 3], cur[S.sel * 3 + 1], cur[S.sel * 3 + 2]);
      // 光晕：随呼吸轻微起伏
      const b = 1 + 0.06 * Math.sin(nowMs / 380);
      selHalo.position.copy(p);
      selHalo.scale.setScalar(CARD.x * 2.05 * b);
      selHalo.material.opacity = 0.26 + 0.08 * (b - 1) / 0.06;
      // 涟漪：两圈错相位向外扩散并淡出
      selRipples.forEach((m, i) => {
        const t = ((nowMs / 1500) + i * 0.5) % 1;
        m.position.copy(p);
        m.scale.setScalar(CARD.x * (1.5 + t * 2.6));
        m.material.opacity = 0.55 * (1 - t) * (1 - t);
      });
    }

    // 选中的那一段通信边：加粗重画一根管（点选后要看得见自己点中了哪一段）
    let selEdgeMesh = null;
    function drawSelEdge() {
      if (selEdgeMesh) { scene.remove(selEdgeMesh); selEdgeMesh.geometry.dispose(); selEdgeMesh.material.dispose(); selEdgeMesh = null; }
      const e = S.selEdge;
      if (!e || e.from >= N || e.to >= N) return;
      const p = (r) => V3(cur[r * 3], cur[r * 3 + 1], cur[r * 3 + 2]);
      const a = p(e.from), b = p(e.to);
      const path = new THREE.CurvePath(); path.add(new THREE.LineCurve3(a, b));
      selEdgeMesh = new THREE.Mesh(
        new THREE.TubeGeometry(path, 2, CARD.x * 0.3, 8, false),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(tokHex('--foreground')), transparent: true, opacity: 0.85, depthTest: false }));
      selEdgeMesh.renderOrder = 9; scene.add(selEdgeMesh);
    }

    /* 四维通信组的成员标记。原先是半透明实体盒罩在卡上——盒色与卡色叠在一起，卡自己的
       着色（负载 / 分组 / 异常）就读不准了；改成「只有棱、没有面」的线框，并且**贴着卡的
       外沿**（1.02×）：比卡大一圈时，一串框在等距视角下棱线互相错开、叠成菱形格纹，
       看着像一排箭头——贴合之后它就只是卡自己的描边。谁是成员主要靠聚焦（无关卡压暗），
       这层描边只是补一个「就是这几张」的确认。
       实例上限要盖住最大的通信域（DP 组可达 dp 张卡），否则线连过去的卡有一半没有标记，
       看上去就是「线没连到卡上」。 */
    const PEER_MAX = 1024;
    const peerDims = ['TP', 'PP', 'DP', 'EP'];
    /* 注意：不能用 InstancedMesh + EdgesGeometry —— InstancedMesh 是 Mesh，会把
       EdgesGeometry 的「每两点一条边」当成「每三点一个三角形」来画，卡面上于是浮出
       一个个斜三角。正确做法是一条 LineSegments，把所有成员的框顶点合并进一个缓冲，
       在 rebuildComm 里按当前成员位置重填。 */
    const EDGE_TPL = (() => {
      const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(CARD.x * 1.02, CARD.y * 1.02, CARD.z * 1.02));
      const a = Float32Array.from(g.attributes.position.array);
      g.dispose();
      return a;                                   // 24 个点（12 条棱）的相对坐标
    })();
    const peerMeshes = peerDims.map((d) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PEER_MAX * EDGE_TPL.length), 3));
      geo.setDrawRange(0, 0);
      const m = new THREE.LineSegments(geo,
        new THREE.LineBasicMaterial({ color: new THREE.Color(dimc(d)), transparent: true, opacity: 0.6, depthTest: false }));
      m.frustumCulled = false; m.renderOrder = 5; m.visible = false; scene.add(m);
      return m;
    });
    // 域轮廓：每维一个线框盒（把该组成员整体包起来），穿透方块可见
    const outlineBoxes = peerDims.map((d) => {
      const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
      const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(dimc(d)), transparent: true, opacity: 0.6, depthTest: false });
      const box = new THREE.LineSegments(geo, mat);
      box.renderOrder = 6; box.visible = false; scene.add(box);
      return box;
    });
    // 方向粒子：沿「此刻主导维」的走线跑，进度 = 阶段内进度（Ring 前半 RS / 后半 AG）
    const MOVERS = 10;
    const moverGroup = new THREE.Group(); scene.add(moverGroup);
    const moverMeshes = Array.from({ length: MOVERS }, () => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(CARD.x * 0.15, 8, 8),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, depthTest: false }));
      m.renderOrder = 8; m.visible = false; moverGroup.add(m); return m;
    });
    let moverPaths = [];
    const _hsl = new THREE.Color(), _h = { h: 0, s: 0, l: 0 };
    // 折线上按参数 s∈[0,1) 取点
    const _mv = new THREE.Vector3();
    function pointOnPath(pts, s) {
      if (pts.length < 2) return pts[0] || _mv.set(0, 0, 0);
      let total = 0; const segLen = [];
      for (let i = 1; i < pts.length; i++) { const l = pts[i].distanceTo(pts[i - 1]); segLen.push(l); total += l; }
      if (total <= 0) return pts[0];
      let want = (s - Math.floor(s)) * total;
      for (let i = 0; i < segLen.length; i++) {
        if (want <= segLen[i]) return _mv.copy(pts[i]).lerp(pts[i + 1], segLen[i] ? want / segLen[i] : 0);
        want -= segLen[i];
      }
      return pts[pts.length - 1];
    }
    const pathLen = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += pts[i].distanceTo(pts[i - 1]); return L; };
    /* 流动点：点数按「路有多长」分配，不是把 10 个点全撒到同一条路上——
       短路（比如 TP=2 的两卡之间只有一格）本来只放得下一个点，撒十个就挤成一条毛毛虫。 */
    function updateMovers() {
      if (!S.wire.movers || !moverPaths.length) { moverMeshes.forEach((m) => { m.visible = false; }); return; }
      const u = phaseU();
      // Ring：RS 段跑一圈、AG 段再跑一圈。快慢按这一阶段的通信节奏给（图元库里
      // 「速率对应带宽·时延」的同一约定）：TP 节点内 UB 最快 · EP 浪涌次之 ·
      // PP 接力常规 · DP 跨 Pod 低频大包最慢。
      const RATE = { TP: 2.2, EP: 1.6, PP: 1.0, DP: 0.65 };
      const t = ((u < 0.5 ? u * 2 : (u - 0.5) * 2) * (RATE[PHASES[phaseIdx()].dim] || 1)) % 1;
      const lens = moverPaths.map((p) => pathLen(p.pts));
      const total = lens.reduce((a, b) => a + b, 0) || 1;
      const SPACING = CARD.x * 3.2;            // 两点之间至少隔三格卡宽，看得出是「一串在跑」
      let k = 0;
      for (let i = 0; i < moverPaths.length && k < MOVERS; i++) {
        const path = moverPaths[i];
        if (!path || path.pts.length < 2 || lens[i] <= 0) continue;
        const byLen = Math.max(1, Math.floor(lens[i] / SPACING));
        const byShare = Math.max(1, Math.round(MOVERS * lens[i] / total));
        const n = Math.min(byLen, byShare, MOVERS - k);
        for (let j = 0; j < n; j++) {
          const m = moverMeshes[k++];
          m.position.copy(pointOnPath(path.pts, (t + j / n) % 1));
          // 「暗点」取线芯同色的深色调（同色系压暗，不是中性黑）：点落在线上，对比来自
          // 它与线芯的明度差，同色系因此既看得清又与整条线和谐。
          _hsl.copy(new THREE.Color(path.color)).getHSL(_h);
          m.material.color.setHSL(_h.h, Math.min(1, _h.s * 1.05), Math.min(_h.l * 0.42, 0.26));
          m.material.opacity = 0.92;
          m.visible = true;
        }
      }
      for (; k < MOVERS; k++) moverMeshes[k].visible = false;
    }

    // 通信线（TubeGeometry 曲线 + 标签）——穿透方块可见
    const commGroupG = new THREE.Group(); scene.add(commGroupG);
    function clearComm() {
      while (commGroupG.children.length) {
        const o = commGroupG.children.pop();
        if (o.geometry) o.geometry.dispose();
        if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
      }
    }
    /* 走线 = 逐段直线的管（不是样条！CatmullRom 会在控制点之间外扩成弧，成员散布时
       整条线看起来「不连在卡上」——通信是点到点的，线就必须点到点）。
       画法沿用硬件图元库「连线样式 Pattern」的三层结构（hpc-topology-node 图元库 · 第 6 组）：
         ① casing —— 比线芯粗一圈的「底色外套」，把线从它穿过的卡面上剥离出来，
            于是线清楚、卡也没被染色（图元库里是白色 casing，这里取 --background，
            明暗主题各自成立）；
         ② glow core —— 彩色线芯（维度签名色），细而实；
         ③ 流动暗点 —— 见 moverMeshes：沿线跑的小圆点，方向即数据流向，
            速度对应这一阶段的通信节奏。三层里只有 ③ 表达方向，不用箭头。 */
    /* 一段管 = 一条折线。注意：**不能把整条折线交给一个 TubeGeometry**——
       TubeGeometry 内部按 getPointAt（等弧长）采样，长短不一的段会让采样点落不到折线
       拐点上，线于是从卡旁边抄近路（端点仍然精确，只测端点查不出来，这是「线没连到卡上」
       第三次复发的成因）。所以直线折线由 rebuildComm 拆成逐段调用，这里只画两点之间的
       一根直管；外凸弧（长边）本来就没有中间的卡要对齐，可以整条交给曲线。 */
    function commLine(points, color, opacity, r, meta) {
      if (points.length < 2) return null;
      const path = points.length === 2
        ? new THREE.LineCurve3(points[0], points[1])
        : new THREE.CatmullRomCurve3(points.slice(), false, 'catmullrom', 0);
      const seg = Math.max(2, (points.length - 1) * 3), rad = r || 0.08;
      const casing = new THREE.Mesh(
        new THREE.TubeGeometry(path, seg, rad * 2.3, 5, false),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(tokHex('--background')), transparent: true, opacity: opacity * 0.62, depthWrite: false, depthTest: false }));
      casing.renderOrder = 5; commGroupG.add(casing);
      const mesh = new THREE.Mesh(
        new THREE.TubeGeometry(path, seg, rad, 5, false),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: false }));
      mesh.renderOrder = 6;
      if (meta) mesh.userData.edge = meta;      // 这段线是谁到谁 → 可被点选，交给宿主去点亮物理路径
      commGroupG.add(mesh);
      return mesh;
    }

    /* ── 字牌（高分辨率圆角 label，随主题）──────────────────────────────────
       排版纪律对齐设计系统的 model-architecture-training-sidecar pattern：
         · 字牌是「跟着场景缩放的几何标注」，因此允许小于 UI 的 12px 下限，但要有下限
           与兜底——这里给 MIN_LABEL_PX 的屏幕像素地板（按当前相机换算世界尺寸），
           兜底是悬停 tooltip 与右上信息卡（固定屏幕尺寸、同样的信息）；
         · 语义色只落在「名字」上，解释性文字用中性次级前景色（两段式字牌），
           annotation 的对比度始终低于模型本身；
         · 字牌绝不盖住它所标注的东西：远离盒子的横幅用中性引线牵回去，而不是压上去。 */
    const MIN_LABEL_PX = 9;
    const worldPerPx = () => (2 * cam.half) / Math.max(1, stageEl.clientHeight);
    /* 字牌样式逐条复刻设计系统 sidecar pattern 的 operator-label / stage-label：
         · 极小号 850 字重的 mono（技术标记的语气，不是标题）；
         · 底 = 语义色 10% 兑底色（几乎只是一层薄纸），描边 = 语义色 30%，圆角 ≈0.47em；
         · 字色 = 语义色 68% 兑 --foreground（明暗主题都够暗/够亮，且保住色相）；
         · 底色光晕（text-shadow 的 canvas 等价物）代替不透明大白板，压在卡上也读得清。 */
    const _mA = new THREE.Color(), _mB = new THREE.Color();
    const mixHex = (a, b, t) => '#' + _mA.set(a).lerp(_mB.set(b), t).getHexString();
    /* sub：第二行「规格」——照搬 sidecar 的 stage-label 分工，第一行是这块**是谁**
       （维度签名色），第二行是这块**里面有什么**（中性次级色、更小号、带字距）。
       两行合一张牌，比「一个名字 + 旁边另起一个标记」少一次视线跳转，也不会各自飘走。 */
    function makeLabel(text, color, w, sub, maxWorld) {
      const SS = 4, fontPx = 40, subPx = 27, gapY = 7, padX = 26, padY = 9;
      const segs = Array.isArray(text) ? text : [{ t: String(text), c: color }];
      text = segs.map((x) => x.t).join('');
      const FONT = `850 ${fontPx}px ${TOK['--font-mono'] || "'JetBrains Mono','Fira Code','Consolas',monospace"}`;
      const SUBF = `600 ${subPx}px ${TOK['--font-mono'] || "'JetBrains Mono','Fira Code','Consolas',monospace"}`;
      const meas = document.createElement('canvas').getContext('2d');
      meas.font = FONT;
      const titleW = Math.ceil(meas.measureText(text).width);
      meas.font = SUBF;
      const subW = sub ? Math.ceil(meas.measureText(sub).width) : 0;
      meas.font = FONT;
      const bw = Math.max(titleW, subW) + padX * 2;
      const bh = fontPx + (sub ? gapY + subPx : 0) + padY * 2;
      // 四周留一圈完全空白的画布边（PAD）：贴图的透明像素 RGB 是黑的，线性过滤/多级
      // 渐远纹理会把黑边混进最外一圈——描边若压在画布边界上，圆角处就会渗出黑边。
      // 底与描边都往里缩，非透明像素永远被同色包着，边缘再插值也只会插到底色。
      const PAD = 5;
      const tw = bw + PAD * 2, th = bh + PAD * 2;
      const cv = document.createElement('canvas'); cv.width = tw * SS; cv.height = th * SS;
      const c = cv.getContext('2d'); c.scale(SS, SS);
      const bg = tokHex('--background'), fg = tokHex('--foreground');
      const rr = fontPx * 0.47;
      c.fillStyle = mixHex(bg, color, 0.1);
      c.beginPath(); c.roundRect(PAD, PAD, bw, bh, rr); c.fill();
      c.lineWidth = 1.6; c.strokeStyle = mixHex(bg, color, 0.3);
      c.beginPath(); c.roundRect(PAD + 1, PAD + 1, bw - 2, bh - 2, rr); c.stroke();
      c.font = FONT; c.textAlign = 'left'; c.textBaseline = 'middle';
      c.shadowColor = bg; c.shadowBlur = 7;                 // 底色光晕：压在卡上也读得清
      const titleY = sub ? PAD + padY + fontPx / 2 : th / 2;
      let x = (tw - titleW) / 2;
      segs.forEach((sg) => {
        c.fillStyle = mixHex(fg, sg.c || color, 0.68);
        c.fillText(sg.t, x, titleY);
        x += meas.measureText(sg.t).width;
      });
      if (sub) {
        c.font = SUBF;
        c.fillStyle = mixHex(bg, tokHex('--foreground-secondary'), 0.86);
        c.fillText(sub, (tw - subW) / 2, titleY + fontPx / 2 + gapY + subPx / 2);
      }
      c.shadowBlur = 0;
      const tex = new THREE.CanvasTexture(cv);
      tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = true;
      try { tex.anisotropy = renderer.capabilities.getMaxAnisotropy(); } catch (e) { /* noop */ }
      tex.needsUpdate = true;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
      let worldW = w * tw / 512;
      const px = (worldW * (fontPx / tw)) / worldPerPx();
      if (px < MIN_LABEL_PX) worldW *= Math.min(1.8, MIN_LABEL_PX / px);   // 封顶 1.8×：地板是兜底，不是放大器
      /* maxWorld：把牌宽钉死在一个世界尺寸上。w 是「512px 贴图 = w 个世界单位」的比例，
         贴图宽度又随文案长度变——所以同一个 w，字多的牌就更宽，靠调 w 控宽度必然失手。
         块标必须按**块步距**定宽（否则压到隔壁块头上），且不能被上面的像素地板放大出去，
         故给一个硬上限：文案长短、缩放远近都不改变它占几个块位。 */
      if (maxWorld) worldW = Math.min(worldW, maxWorld);
      sp.scale.set(worldW, worldW * th / tw, 1);
      sp.material.userData.baseOp = 1;
      return sp;
    }

    /* ── 轴标注（每形态一套：网格框 + 刻度 + 语义标注 + 关键结构线）── */
    const axGroup = new THREE.Group(); scene.add(axGroup);
    // 网格线材质登记表：聚焦（选中压暗）时整体提亮——卡退成背景，格子接手空间参照
    const gridMats = [];
    function clearAxes() {
      gridMats.length = 0;
      while (axGroup.children.length) {
        const o = axGroup.children.pop();
        if (o.geometry) o.geometry.dispose();
        if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
      }
    }
    /* 标注的世界包围盒：取景只按卡的包围盒算的话，摆在模型外侧的标记（尤其块标那种
       又宽又要错行的）在小规格下会被推出画布——相机贴得越近，同样的世界偏移越出框。
       这里记录当前视角下**真正会显示**的标记占了多大，fitView 把它并进取景范围，
       于是「标记跑到画布外」这一类问题在任何配置下都不会再出现。 */
    let axBox = null;
    function axBoxAdd(sp) {
      const w = sp.scale.x / 2, h = sp.scale.y / 2, p = sp.position;
      const e = { x0: p.x - w, x1: p.x + w, y0: p.y - h, y1: p.y + h, z0: p.z - w, z1: p.z + w };
      if (!axBox) { axBox = e; return; }
      axBox.x0 = Math.min(axBox.x0, e.x0); axBox.x1 = Math.max(axBox.x1, e.x1);
      axBox.y0 = Math.min(axBox.y0, e.y0); axBox.y1 = Math.max(axBox.y1, e.y1);
      axBox.z0 = Math.min(axBox.z0, e.z0); axBox.z1 = Math.max(axBox.z1, e.z1);
    }
    function rebuildAxBox() {
      axBox = null;
      axGroup.traverse((o) => { if (o.isSprite && o.visible) axBoxAdd(o); });
    }
    function applyGridEmphasis() {
      const k = focusOn() ? 1.6 : 1;
      gridMats.forEach((m) => { m.opacity = Math.min(1, m.userData.baseOp * k * (settling ? 0.45 : 1)); });
    }
    // 字牌尺度：世界尺寸随模型尺度伸缩，使标注在屏幕上占比恒定（相机按包围盒取景，
    // 固定世界尺寸的字牌在小规格下会被放大到盖满画面——128 卡与 4000 卡差 6 倍）。
    let LS = 1;
    function updateLabelScale() {
      const b = model.boundsOf(S.mode);
      const span = Math.max(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0);
      LS = Math.min(1.6, Math.max(0.3, span / 52));
    }
    // 标注离盒子的偏移量同样随尺度收缩（固定偏移会让小规格下的横幅飘到画布外/被工具栏遮住），
    // 但留 0.5 下限，避免贴到方块上。
    // 标记与网格/轴的距离：横幅撤掉后没必要再留大留白，整体收到原来的 55%——
    // 标记贴着它标注的那根格线，读图时不用来回找对应关系。
    const D = (v) => v * 0.55 * Math.max(0.5, LS);
    // 长文案「读图横幅」（w≥5）只在轴测视图显示：正交 2D 取景很紧，横幅字牌（世界尺寸随文本
    // 长度膨胀）会盖满画面——2D 里只留短刻度标（TP0/DP127/层段标尺…），语义讲解交给 HUD。
    /* 长横幅（w ≥ 5 的整句解释）不再画进 3D：它们是「散文」而不是「标记」——浮在模型上
       又大又抢，还挡卡。按设计系统 sidecar pattern 的分工，几何标注只留短标记
       （TP0 / DP99 / S0·L1-10 / 桶3 / 列2…），整句解释交给固定屏幕位置的 UI——
       这里收进「形态」问号气泡（axNotes → DYN.modes），信息一句不少。 */
    let axNotes = [];
    function axText(text, color, w, pos, anchor, sub, maxWorld) {
      // w >= 5 = 散文横幅 → 不画，收进问号气泡。给了 maxWorld 的是块标：它的 w 只是
      // 「先按文案量出宽度，再由 maxWorld 钉死」的起点，不是横幅，别被这条拦下。
      if (w >= 5 && !maxWorld) {
        axNotes.push(Array.isArray(text) ? text.map((x) => x.t).join('') : String(text));
        return null;
      }
      const l = makeLabel(text, color, w * 0.92 * LS, sub, maxWorld);   // 标记要小：语气是技术注记，不是标题
      l.position.copy(pos);
      l.userData.banner = w >= 5 && !maxWorld;   // 同上：块标不是横幅，别跟着「只在 3D 出现」
      axGroup.add(l);
      // 引线：横幅坐在模型外面时，用一根中性细线牵回它标注的位置——既不压住卡，
      // 也不让读者去猜这句话说的是哪根轴（对比度低于模型本身，annotation 不抢戏）。
      if (anchor) {
        const from = l.position.clone().lerp(anchor, Math.min(0.5, (l.scale.y * 0.7) / Math.max(0.01, l.position.distanceTo(anchor))));
        const g = new THREE.BufferGeometry().setFromPoints([from, anchor]);
        const m = new THREE.LineBasicMaterial({ color: new THREE.Color(tokHex('--border-strong')), transparent: true, opacity: isDark() ? 0.5 : 0.6 });
        const ln = new THREE.Line(g, m);
        ln.userData.banner = l.userData.banner;      // 与横幅同进退（2D 视角里一起隐藏）
        axGroup.add(ln);
      }
      return l;
    }
    // 两段式横幅：名字用维度签名色、解释用中性次级前景色
    const seg2 = (head, hc, rest) => [{ t: head, c: hc }, { t: rest, c: tokHex('--foreground-secondary') }];
    /* 只在某几个视角出现的标记。正交 2D 把一根轴折进视线，标记在那根轴上的偏移随之
       失效——3D 里「浮在块顶上方」的一排块标，到顶视会全部塌到 z=0 那一行、互相叠死。
       所以块标做成两份：3D/前视用长名（浮在块顶），顶视换一份短名摆到场外，
       标注轴被折掉的视角（TP 切片的侧视、PP 流水的侧视）干脆不出。
       视角切换只改可见性，不重建场景（renderAxes 很贵）。 */
    const axOnly = (l, views) => { if (l) l.userData.views = views; return l; };
    function applyAxVisibility() {
      axGroup.traverse((o) => {
        if (!o.isSprite) return;
        if (o.userData.banner) { o.visible = S.view === 0; return; }
        if (o.userData.views) o.visible = o.userData.views.indexOf(S.view) >= 0;
      });
      rebuildAxBox();
    }
    function axSeg(pairs, color, opacity) {
      if (!pairs.length) return null;
      const g = new THREE.BufferGeometry().setFromPoints(pairs);
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
      mat.userData.baseOp = opacity;
      gridMats.push(mat);
      axGroup.add(new THREE.LineSegments(g, mat));
      return mat;
    }
    function axLine(a, b, colorHex, r) {
      const dir = b.clone().sub(a), len = dir.length();
      const geo = new THREE.CylinderGeometry(r || 0.07, r || 0.07, len, 8, 1);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.92 }));
      mesh.position.copy(a.clone().add(b).multiplyScalar(0.5));
      mesh.quaternion.setFromUnitVectors(V3(0, 1, 0), dir.normalize());
      axGroup.add(mesh);
    }
    /* 轴向不画任何裸线：圆锥箭头（3D 建模语汇）与「轴脊」细线都试过——散落在模型外的
       短线读者认不出是什么，反而像画错的通信连线。轴的语义交给带该维签名色的网格线，
       范围与方向交给刻度标与文案。axLine 只保留给「有明确所指」的结构线（TP 切片的
       墙间连点）。
       大 3D 坐标网格框（底 XZ + 背 XY + 左 YZ 三张网格 + 描边棱线；floorOnly 只铺地面）。
       tint = {x,y,z} 时，该轴的格边界线用这一维的签名色画并加一档不透明度——
       网格自己就说明「这根轴切的是哪一维、切成几格」，因此不再需要轴向箭头。 */
    function axGridBox(b, xt, yt, zt, floorOnly, tint) {
      const hx = (c) => new THREE.Color(c).getHex();
      const grid = hx(tokHex('--border-default')), frame = hx(tokHex('--border-strong'));
      const gridOp = isDark() ? 0.42 : 0.6, tintOp = isDark() ? 0.62 : 0.78, frameOp = isDark() ? 0.85 : 0.95;
      const t = tint || {};
      const sx = [], sy = [], sz = [];
      xt.forEach((x) => { sx.push(V3(x, b.y0, b.z0), V3(x, b.y0, b.z1)); if (!floorOnly) sx.push(V3(x, b.y0, b.z0), V3(x, b.y1, b.z0)); });
      if (!floorOnly) yt.forEach((y) => { sy.push(V3(b.x0, y, b.z0), V3(b.x1, y, b.z0), V3(b.x0, y, b.z0), V3(b.x0, y, b.z1)); });
      zt.forEach((z) => { sz.push(V3(b.x0, b.y0, z), V3(b.x1, b.y0, z)); if (!floorOnly) sz.push(V3(b.x0, b.y0, z), V3(b.x0, b.y1, z)); });
      axSeg(sx, t.x ? hx(t.x) : grid, t.x ? tintOp : gridOp);
      axSeg(sy, t.y ? hx(t.y) : grid, t.y ? tintOp : gridOp);
      axSeg(sz, t.z ? hx(t.z) : grid, t.z ? tintOp : gridOp);
      const E = floorOnly
        ? [[b.x0, b.y0, b.z0, b.x1, b.y0, b.z0], [b.x0, b.y0, b.z1, b.x1, b.y0, b.z1], [b.x0, b.y0, b.z0, b.x0, b.y0, b.z1], [b.x1, b.y0, b.z0, b.x1, b.y0, b.z1]]
        : [[b.x0, b.y0, b.z0, b.x1, b.y0, b.z0], [b.x0, b.y0, b.z1, b.x1, b.y0, b.z1], [b.x0, b.y0, b.z0, b.x0, b.y0, b.z1], [b.x1, b.y0, b.z0, b.x1, b.y0, b.z1],
        [b.x0, b.y0, b.z0, b.x0, b.y1, b.z0], [b.x1, b.y0, b.z0, b.x1, b.y1, b.z0], [b.x0, b.y0, b.z1, b.x0, b.y1, b.z1],
        [b.x0, b.y1, b.z0, b.x1, b.y1, b.z0], [b.x0, b.y1, b.z0, b.x0, b.y1, b.z1]];
      const fr = []; E.forEach((e) => fr.push(V3(e[0], e[1], e[2]), V3(e[3], e[4], e[5])));
      axSeg(fr, frame, frameOp);
    }
    /* 强调块的框：TP切片 / PP流水 把主轴按 emph（4×）拉开成「墙 / 段」。轴测下空档本身
       就说明了分段，但正交 2D 里主轴一稀疏，卡就散成条纹——数不清「这是第几片 / 第几段」，
       当年 2D 被收编正是因为这个。给每一块套一圈签名色细框，条纹当场读成整块。
       框贴着卡本身（不是网格框）：只外扩半张卡 + 一点余量，既不与卡穿插，也不像另起一个
       坐标系。四条竖棱只画到块高的两端，中间留空——满框在 3D 里会织成一片网。 */
    function axBlockFrames(n, centerX, half, bb, colorHex) {
      const m = 0.34, y0 = bb.y0 - CARD.y / 2 - m, y1 = bb.y1 + CARD.y / 2 + m;
      const z0 = bb.z0 - CARD.z / 2 - m, z1 = bb.z1 + CARD.z / 2 + m;
      const pts = [];
      for (let i = 0; i < n; i++) {
        const c = centerX(i), x0 = c - half, x1 = c + half;
        [y0, y1].forEach((y) => {                                  // 上下两圈
          pts.push(V3(x0, y, z0), V3(x1, y, z0), V3(x1, y, z0), V3(x1, y, z1),
            V3(x1, y, z1), V3(x0, y, z1), V3(x0, y, z1), V3(x0, y, z0));
        });
        [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].forEach(([x, z]) => {   // 四角竖棱（整根：只画两端会读成断开的括号）
          pts.push(V3(x, y0, z), V3(x, y1, z));
        });
      }
      axSeg(pts, new THREE.Color(colorHex).getHex(), isDark() ? 0.5 : 0.62);
    }
    const R = (n, f) => Array.from({ length: n }, (_, i) => f(i));
    /* 网格线 = 格边界（卡永远落在格子里、不被线穿过）——各形态各轴统一这一条约定。
       原先分块轴画边界、其余轴画「穿过卡中心的刻度」，同一个框里两种约定混用，
       看起来就是「和网格没对齐」。线过多时等间隔抽样（每 k 格一条，仍是边界）。 */
    function cellLines(n, step, center, maxLines) {
      const first = (center || 0) - n * step / 2, last = first + n * step;
      const stride = Math.max(1, Math.ceil(n / (maxLines || 12)));
      const out = [];
      for (let i = 0; i <= n; i += stride) out.push(first + i * step);
      if (out[out.length - 1] !== last) out.push(last);
      return out;
    }
    const span1 = (a) => ({ lo: a[0], hi: a[a.length - 1] });

    // 每种形态 = 换一根投影轴：讲清「为什么这样重排 · 这个形状帮你看什么」——一个小方块 = 1 颗卡（rank）
    function renderAxes() {
      clearAxes();
      axNotes = [];
      updateLabelScale();
      const TPc = dimc('TP'), PPc = dimc('PP'), DPc = dimc('DP'), EPc = dimc('EP'),
        NTc = tokHex('--foreground-secondary');   // 中性注释 = 次级前景色
      const hx = (c) => new THREE.Color(c).getHex();
      const TPw = hx(TPc), PPw = hx(PPc), EPw = hx(EPc), NTw = hx(NTc);
      const sp = model.SP;
      const v = { x: 0, y: 0, z: 0 };
      const pos = (tp, pp, rep) => { model.posOf(model.rankOf(tp, pp, rep), S.mode, v); return V3(v.x, v.y, v.z); };
      if (S.mode === 0) {
        const s = sp.std, xT = (t) => (t - (TP - 1) / 2) * s.sx, yS = (p) => s.cy + ((PP - 1) / 2 - p) * s.sy, zD = (d) => (d - (REP - 1) / 2) * s.sz;
        const xL = cellLines(TP, s.sx, 0), yL = cellLines(PP, s.sy, s.cy), zL = cellLines(REP, s.sz, 0, 9);
        const b = { x0: span1(xL).lo, x1: span1(xL).hi, y0: span1(yL).lo, y1: span1(yL).hi, z0: span1(zL).lo, z1: span1(zL).hi };
        axGridBox(b, xL, yL, zL, false, { x: TPc, y: PPc, z: DPc });
        axText('TP0', TPc, 1.6, V3(xT(0), b.y0 - D(1), b.z1 + D(1.4))); axText('TP' + (TP - 1), TPc, 1.6, V3(xT(TP - 1), b.y0 - D(1), b.z1 + D(1.4)));
        axText(seg2(`TP×${TP}`, TPc, ` 同一层切 ${TP} 片 · 层内 AllReduce（横向格线）`), TPc, 7,
          V3(0, b.y0 - D(2.6), b.z1 + D(3.2)), V3(0, b.y0, b.z1));
        axText('DP0', DPc, 1.6, V3(b.x1 + D(1.6), b.y0 - D(1), zD(0))); axText('DP' + (REP - 1), DPc, 2, V3(b.x1 + D(1.8), b.y0 - D(1), zD(REP - 1)));
        axText(seg2(`DP×${REP}`, DPc, ' 完整副本 · 数据不同 · 梯度 AllReduce'), DPc, 8,
          V3(b.x1 + D(5), b.y0 - D(2.6), 0), V3(b.x1, b.y0, 0));
        axText(seg2(`PP×${PP}`, PPc, ` 模型深度 L1（上）→L${model.config.layers}（下） · 段间 P2P`), PPc, 7.6,
          V3(b.x0 - D(1.5), b.y1 + D(1.6), b.z0), V3(b.x0, b.y1, b.z0));
        axText('1 小块 = 1 卡（rank）= (TP,PP,DP) 坐标交点 · 另叠 EP 桶', NTc, 9, V3(0, b.y1 + D(3.6), 0));
        // 层段标尺：每个 PP 段 "S0·L1-12"（左后棱一列）
        for (let s2 = 0; s2 < PP; s2++) {
          const lr = model.stageLayerRange(s2);
          const l = makeLabel(`S${s2}·L${lr.lo}-${lr.hi}`, tokHex('--warning'), 2.6 * LS);
          l.position.set(b.x0 - D(3.4), yS(s2), b.z0 - D(1)); axGroup.add(l);
        }
      } else if (S.mode === 1) {
        const s = sp.dpt, COLS = model.COLS, ROWS = model.ROWS;
        const bb = model.boundsOf(1);
        // 网格 = 宫格的「格边界」（由板中心 ± 半格推出）。若沿用 rank 包围盒，X 会整体
        // 偏掉半个板宽 → 板落在格子左侧、网格与内容对不上。
        const xL = cellLines(COLS, s.gapX, 0, 14), zL = cellLines(ROWS, s.gapZ, 0, 14);
        const b = { x0: span1(xL).lo, x1: span1(xL).hi, y0: 0, y1: bb.y1 + 0.6, z0: span1(zL).lo, z1: span1(zL).hi };
        axGridBox(b, xL, [], zL, true, { x: DPc, z: DPc });
        R(COLS, (i) => axText('列' + i, DPc, 1.7, V3(b.x0 + (i + 0.5) * s.gapX, b.y0, b.z1 + D(1.8))));
        R(ROWS, (i) => axText('行' + i, DPc, 1.7, V3(b.x1 + D(2.2), b.y0, b.z0 + (i + 0.5) * s.gapZ)));
        axText('DP0', DPc, 1.8, pos(0, 0, 0).add(V3(0, 1.6, 0)));
        axText('DP' + (REP - 1), DPc, 2.1, pos(0, 0, REP - 1).add(V3(0, 1.6, 0)));
        axText(seg2(`DP 平铺 · ${REP} 块板`, DPc, ` = ${REP} 份完整副本（副本号=行×${COLS}+列 · 参数相同 · 各吃不同数据）`), DPc, 11,
          V3(0, b.y1 + D(3.4), 0), V3(0, b.y1, 0));
        const p00 = pos(0, PP - 1, 0), p10 = pos(TP - 1, PP - 1, 0), pTop = pos(0, 0, 0);
        // 板内两根轴只用文案标注：板内格线试过（一块板上单独铺一层格子，在一字排开的
        // 100 块板里像块悬空面板）、轴脊短线也试过（散在模型外，像画错的连线）——都撤了。
        axText(model.TPD > 1 ? `板内 TP×${TP} = ${model.TPC}列×${model.TPD}排` : `板内横=TP×${TP}`,
          TPc, model.TPD > 1 ? 4.6 : 3.4, p00.clone().add(V3(0.6, -1.9, 0)));
        axText(`板内竖=PP×${PP} L1（上）→L${model.config.layers}（下）`, PPc, 5, pTop.clone().add(V3(0.4, 1.7, 0)));
      } else if (S.mode === 2) {
        const s = sp.ep;
        const bb = model.boundsOf(2);
        // X 网格 = 墙的格边界（同上，避免整体偏掉半个墙宽）；Z 网格线落在真实的域位置上
        // （域少则逐域画，域多则等间隔抽 5 条），不再是与内容无关的等分线。
        const xL = cellLines(EP, s.gapE, 0), yL = cellLines(PP, s.pp, s.cy), zL = cellLines(DOM, s.dom, 0, 9);
        const b = { x0: span1(xL).lo, x1: span1(xL).hi, y0: span1(yL).lo, y1: span1(yL).hi, z0: span1(zL).lo, z1: span1(zL).hi };
        axGridBox(b, xL, yL, zL, false, { x: EPc, y: PPc, z: DPc });
        for (let e = 0; e < EP; e++) {
          const hot = model.hotBuckets.has(e);
          axText(`桶${e} ${model.expRange(e)}${hot ? ' 热点' : ''}`, hot ? tokHex('--warning') : EPc, 3.2,
            V3((e - (EP - 1) / 2) * s.gapE, b.y1 + D(1.2) + (e % 3) * 1.45, 0));
        }
        axText(seg2(`${EP} 面墙`, EPc, ` = ${EP} 个专家分桶（桶=MoE 组 · 同墙=同专家 · 热点桶标暖色）`), EPc, 10,
          V3(0, b.y1 + D(4.2), 0), V3(0, b.y1, 0));
        const rowZ = bb.z0;
        axText(`1 个 A2A 域 = 横穿 ${EP} 面墙的同一排 · 每桶各出 1 员互发`, EPc, 9, V3(0, b.y0 - D(1.7), rowZ));
        axText(`域0（近）→域${DOM - 1}（远）`, NTc, 3.6, V3(b.x1 + D(3.6), b.y0 - D(1.5), 0));
        axText(`墙内竖=PP×${PP}`, PPc, 3.6, V3(b.x0 - D(1.4), b.y1 + D(1.3), 0));
      } else if (S.mode === 3) {
        const s = sp.tps, zD = (d) => (d - (REP - 1) / 2) * s.rep;
        const bb = model.boundsOf(3);
        const xL = cellLines(TP, s.gapT, 0), yL = cellLines(PP, s.pp, s.cy), zL = cellLines(REP, s.rep, 0, 9);
        const b = { x0: span1(xL).lo, x1: span1(xL).hi, y0: span1(yL).lo, y1: span1(yL).hi, z0: span1(zL).lo, z1: span1(zL).hi };
        axGridBox(b, xL, yL, zL, false, { x: TPc, y: PPc, z: DPc });
        axBlockFrames(TP, (t) => bb.x0 + t * s.gapT, CARD.x / 2 + 0.34, bb, TPc);
        for (let t = 0; t < TP; t++) {
          /* 块标做成两行牌：第一行「这块是谁」（TP 切片 0 · 第 1/8 片），
             第二行「这块里面有什么」（PP ×5 · DP ×100 = 500 卡）。
             尺寸与错行是一对：块步距只有 3 个世界单位，而标记有屏幕像素下限
             （最多放大 1.8×）——单排放不下这么宽的牌，错两行后同排相邻隔了两个块步距，
             放大到头也不撞。 */
          // 牌宽钉在 1.75 个块步距上、并错两行：同排相邻隔两个步距，怎么都不撞。
          // 三个落点：3D 浮在块顶 · 前视摆到场下（场上那条带被右上角粒度贴士占着）·
          // 顶视 Y 被折掉 → 改摆到 z 方向的场外。
          /* 详略按视角分：等距轴测里 +X 投影向右下、+Y 向上，两者几乎抵消——错行救不了，
             把牌加宽只会更糟。3D 里分段本来就由块框交代清楚了，所以只给一枚身份小牌；
             两行的完整规格牌留给正交 2D（那里横向摆得开，且下方大片空着）。 */
          const tSub = `PP ×${PP} · DP ×${REP} = ${PP * REP} 卡`;
          // 错行位移同样走 D()：写死世界单位的话，小规格（相机贴得近）会把牌甩出取景框
          const tTit = `TP 切片 ${t} · ${t + 1}/${TP}`, tW = s.gapT * 1.6, tj = (t % 2) * D(3.8);
          axOnly(axText(`TP${t}`, TPc, 2.4, V3(bb.x0 + t * s.gapT, b.y1 + D(1.3) + tj, 0)), [0]);
          axOnly(axText(tTit, TPc, 6, V3(bb.x0 + t * s.gapT, b.y0 - D(1.6) - tj, 0), null, tSub, tW), [2]);
          // 顶视留下的两根轴里有 DP（成员最多的那根，默认 100）——整幅被拉成细长条，
          // 规格牌按块步距钉宽后字会小到读不出，这里只给身份小牌，规格看前视那一屏。
          axOnly(axText(`TP${t}`, TPc, 2.4, V3(bb.x0 + t * s.gapT, b.y0, b.z1 + D(1.5) + tj)), [1]);
        }
        axText(seg2(`${TP} 面墙`, TPc, ` = 每层权重的 ${TP} 个切片 · 一面墙 = 全网同槽位卡`), TPc, 9.5,
          V3(0, b.y1 + D(4.2), 0), V3(0, b.y1, 0));
        const dots = R(TP, (t) => V3(bb.x0 + t * s.gapT, b.y1 + D(0.4), b.z0));
        for (let k = 0; k < TP - 1; k++) axLine(dots[k], dots[k + 1], TPw, 0.07 * Math.max(0.45, LS));
        // 连点的半径也随尺度走：固定 0.2 在小规格下（相机贴得近）会胀成大圆球
        const dotR = 0.2 * Math.max(0.45, LS);
        dots.forEach((p) => { const d = new THREE.Mesh(new THREE.SphereGeometry(dotR, 8, 8), new THREE.MeshBasicMaterial({ color: TPw })); d.position.copy(p); axGroup.add(d); });
        axText(`同一 TP 组的 ${TP} 卡 → 分属 ${TP} 面墙 · 层内 AllReduce 拼回完整权重`, TPc, 9.5, V3(0, b.y1 + D(0.4), b.z0 - D(2.4)));
        axOnly(axText('DP0', DPc, 1.6, V3(b.x1 + D(1.5), b.y0 - D(0.7), zD(0))), [0, 1, 3]);
        axOnly(axText('DP' + (REP - 1), DPc, 2, V3(b.x1 + D(1.7), b.y0 - D(0.7), zD(REP - 1))), [0, 1, 3]);
        axOnly(axText(`墙内竖=PP×${PP}`, PPc, 3.6, V3(b.x0 - D(1.4), b.y1 + D(1.3), 0)), [0, 2, 3]);
        axOnly(axText(`同槽位 TP0…TP${TP - 1} 各一面墙`, TPc, 3.4, V3(0, b.y0, b.z0 - D(1.6))), [1]);
      } else {
        const s = sp.ppf, zD = (d) => (d - (REP - 1) / 2) * s.rep;
        const bb = model.boundsOf(4);
        const xL = cellLines(PP, s.gapP, 0), zL = cellLines(REP, s.rep, 0, 9);
        const b = { x0: span1(xL).lo, x1: span1(xL).hi, y0: bb.y0 - 0.8, y1: bb.y1 + 0.8, z0: span1(zL).lo, z1: span1(zL).hi };
        axGridBox(b, xL, [], zL, true, { x: PPc, z: DPc });
        axBlockFrames(PP, (st) => bb.x0 + st * s.gapP, CARD.x / 2 + 0.34, bb, PPc);
        for (let st = 0; st < PP; st++) {
          const lr = model.stageLayerRange(st);
          // PP 只有几段、块步距更宽 → 牌钉在 0.94 个步距上，单排就摆得下（落点同上）
          const pSub = `TP ×${TP} · DP ×${REP} = ${TP * REP} 卡`;
          const pTit = `PP Stage ${st} · L${lr.lo}-L${lr.hi}`, pW = s.gapP * 0.94;
          // 3D 里不错行：+X 向右下、+Y 向上，错行会把两枚牌推到一起；沿块步距自然排开
          // 已经形成一道斜梯，反而是读得清的那种
          axOnly(axText(`S${st} L${lr.lo}-${lr.hi}`, PPc, 3.2, V3(bb.x0 + st * s.gapP, b.y1 + D(1.6), 0)), [0]);
          axOnly(axText(pTit, PPc, 6, V3(bb.x0 + st * s.gapP, b.y0 - D(1.9), 0), null, pSub, pW), [2]);
          axOnly(axText(`S${st}`, PPc, 2.4, V3(bb.x0 + st * s.gapP, b.y0, b.z1 + D(1.5))), [1]);   // 同上：顶视含 DP 轴，只给身份牌
        }
        axText(seg2(`前向激活 S0→S${PP - 1}`, PPc, `（左→右）· 反向梯度 ← · 段间 P2P · 每段=连续 ${LPS} 层`), PPc, 10.5,
          V3(0, b.y1 + D(4.9), 0), V3(0, b.y1 + D(0.6), 0));
        axOnly(axText('DP0', DPc, 1.6, V3(b.x1 + D(1.6), b.y0 - D(0.5), zD(0))), [0, 1, 3]);
        axOnly(axText('DP' + (REP - 1), DPc, 2, V3(b.x1 + D(1.8), b.y0 - D(0.5), zD(REP - 1))), [0, 1, 3]);
        axOnly(axText(`段内竖=TP×${TP}`, TPc, 3.4, V3(b.x0 - D(1.6), b.y1 + D(1.3), b.z0)), [0, 2, 3]);
        axOnly(axText(`S0（首段）→S${PP - 1}（末段）`, PPc, 3.4, V3(0, b.y0, b.z0 - D(1.6))), [1]);
      }
      applyGridEmphasis();   // 网格材质刚重建 → 若正处于聚焦态，立刻补回加强
    }

    // 选中整网层 → 魔方水平切片（标准形态的紫色 slab —— 整网图联动挂点）
    const slabMat = new THREE.MeshBasicMaterial({ color: 0x9B3CF6, transparent: true, opacity: 0.16, depthWrite: false });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), slabMat);
    slab.visible = false; scene.add(slab);
    function updateSlab() {
      if (S.selLayer == null || S.mode !== 0) { slab.visible = false; return; }
      const st = Math.min(PP - 1, (S.selLayer / LPS) | 0);
      const s = model.SP.std, b = model.boundsOf(0);
      slab.scale.set((b.x1 - b.x0) + 2.4, s.sy * 0.92, (b.z1 - b.z0) + 2.4);
      slab.position.set(0, s.cy + ((PP - 1) / 2 - st) * s.sy, 0);
      slab.visible = true;
    }

    /* ── 着色：状态热力 / 分组透镜 / 异常注入 ── */
    const rng = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
    // 时间 = 一个 step 内的位置（0→1），按 4 个通信阶段读（对齐集群驾驶舱）
    const phaseIdx = () => Math.min(PHASES.length - 1, (S.t * PHASES.length) | 0);
    const phaseU = () => S.t * PHASES.length - phaseIdx();       // 阶段内进度 0→1
    // 负载场随阶段变化：每个阶段由哪根并行轴主导，就在那根轴上呈现相应的形状
    function load01(r) {
      const ph = PHASES[phaseIdx()], u = phaseU();
      const h1 = rng(r), h2 = rng(r * 7.3);
      let v = ph.load;
      if (ph.id === 'TP') {                          // 层内 AllReduce：同 TP 组齐动，副本间轻微错峰
        v *= 0.88 + 0.24 * Math.sin(6.283 * (u + model.repOf(r) * 0.013));
      } else if (ph.id === 'PP') {                   // 阶段接力：波锋沿流水级前进，其余级在等
        const d = Math.abs((model.ppOf(r) + 0.5) / PP - u);
        v *= d < 0.5 / PP + 0.1 ? 1.35 : 0.5 + 0.3 * h1;
      } else if (ph.id === 'EP') {                   // A2A 浪涌：热点桶更烫，各 A2A 域错峰互发
        v *= (model.hotBuckets.has(model.epOf(r)) ? 1.12 : 0.8)
          * (0.9 + 0.22 * Math.sin(6.283 * (u + model.domOf(r) * 0.07)));
      } else {                                       // 梯度 AllReduce：全网齐动，个体差异露出慢副本
        v *= 0.85 + 0.3 * h2;
      }
      return Math.max(0.04, Math.min(1, v * (0.94 + 0.12 * h1)));
    }
    const anomBucket = () => Math.min(3, EP - 1);            // 注入的示意桶号（EP 小时自动收到合法桶）
    function inAnomGroup(r) {
      if (S.anom === 'tp') return model.tpOf(r) === 0;       // TP 槽 0：全网同槽位卡
      if (S.anom === 'pp') return model.ppOf(r) === 0;       // PP 级 0：一整个流水段
      if (S.anom === 'dp') return model.repOf(r) === 0;      // DP 副本 0：一份完整拷贝
      if (S.anom === 'ep') return model.epOf(r) === anomBucket();   // EP 桶：持有该桶的所有 rank（越区示意）
      return false;
    }
    const rgbCss = (c) => `#${c.getHexString()}`;
    // 负载热力 = 图例那条色带本身：--success → --warning → --danger 三段线性插值
    const RAMP_A = new THREE.Color(), RAMP_B = new THREE.Color();
    function loadColor(v) {
      v = Math.max(0, Math.min(1, v));
      const lo = v < 0.5 ? '--success' : '--warning', hi = v < 0.5 ? '--warning' : '--danger';
      RAMP_A.set(tokHex(lo)); RAMP_B.set(tokHex(hi));
      return cTmp.copy(RAMP_A).lerp(RAMP_B, v < 0.5 ? v * 2 : (v - 0.5) * 2);
    }
    /* 注入态的「其余」：健康色但压成背景。
       用满彩度的 --success 会让红绿各占半屏、势均力敌，注入的那一组反而不跳——
       注入这个模式的全部意义就是「异常组一眼看见」，其余是参照物不是并列项。
       故按低负载取色后再向 --background 拉一半：色相还在（还读得出「这些是好的」），
       但明度/彩度都退到红组之下。图例的「其余」色块走同一个函数，因此永远等于画面。 */
    const REST_BG = new THREE.Color();
    function restColor(r) {
      loadColor(0.16 + rng(r * 3.1) * 0.1);
      REST_BG.set(tokHex('--background'));
      return cTmp.lerp(REST_BG, isDark() ? 0.55 : 0.48);
    }
    function colorOfRank(r) {
      if (S.anom !== 'none') {
        if (inAnomGroup(r)) return cTmp.set(tokHex('--danger'));
        return restColor(r);
      }
      if (S.colorBy !== 'load') {
        // 逻辑分组（TP/PP/DP/EP）与物理分组（主机 / Pod）用同一套分组色环：
        // 「按主机着色」正是看逻辑组与物理落位的亲和度——同色连成块 = 这一组正好装在一台机里。
        const g = S.colorBy === 'tp' ? model.tpOf(r) : S.colorBy === 'pp' ? model.ppOf(r)
          : S.colorBy === 'dp' ? model.repOf(r) : S.colorBy === 'host' ? model.hostOf(r)
            : S.colorBy === 'pod' ? model.podOf(r) : model.epOf(r);
        return cTmp.set(groupColor(g));
      }
      return loadColor(load01(r));
    }
    // 正交剖面：非当前层 → 压暗（并在写矩阵时缩小），保持空间参照又不喧宾
    // 一个正交视角可能同时折叠多个维（例：EP 聚簇的侧视把「墙序 ep」与「墙内 tp」
    // 一起折进视线）→ 每格重叠的卡数 = 各折叠维成员数之积。剖面按最外层维逐层翻。
    function curDepth() {
      if (S.view === 0) return null;
      const dims = model.modes[S.mode].depth[S.view];
      if (!dims || !dims.length) return null;
      const info = dims.map((k) => Object.assign({ key: k }, model.depthDims[k]));
      return {
        dims: info,
        slice: info[0],                                           // 剖面翻的是最外层维
        fold: info.reduce((a, d) => a * d.n, 1),                  // 每格重叠卡数
        label: info.map((d) => `${d.lab}×${d.n}`).join(' × '),
      };
    }
    const ghosted = (r) => {
      const d = curDepth();
      return !!(d && S.sliceOn && model.depthIdxOf(r, d.slice.key) !== S.sliceVal);
    };
    /* 选中聚焦：选中一张卡后，与它四个通信域都无关的卡退成背景。
       上千张卡各自有色时，四维高亮会被淹没（尤其分组着色）——把无关的压暗 + 缩小，
       让「这张卡和谁一组」当场跳出来；网格与外框此时反过来加强，空间参照不丢。
       和剖面共用一套 dim 机制，可在「连线」行随时关掉。 */
    const relSet = new Set();
    function buildRelSet() {
      relSet.clear();
      if (S.sel == null) return;
      relSet.add(S.sel);
      peerDims.forEach((d) => model.commGroup(S.sel, d).forEach((r) => relSet.add(r)));
    }
    const focusOn = () => S.wire.focus && S.sel != null;
    // 0=正常 · 1=聚焦压暗（保留形体做参照）· 2=剖面压暗（更狠）
    const dimLv = (r) => (ghosted(r) ? 2 : focusOn() && !relSet.has(r) ? 1 : 0);
    const BG_C = new THREE.Color();
    // 压暗的唯一算法（图例色块与卡块共用，图例因此永远等于画面）：
    // 打光总增益已归到 ≈1（见上方光源注释），所以这里的系数就是最终看到的压暗幅度；
    // 若哪天又调亮打光，这几个系数要跟着往下压，否则「压暗」会看起来还是一片亮。
    function applyDim(c, lv) {
      if (!lv) return c;
      BG_C.set(tokHex('--background'));
      if (lv === 2) return c.multiplyScalar(isDark() ? 0.22 : 0.55).lerp(BG_C, 0.35);
      return c.multiplyScalar(isDark() ? 0.18 : 0.66).lerp(BG_C, isDark() ? 0.58 : 0.66);
    }
    const _sw = new THREE.Color();
    const dimSwatch = (lv) => rgbCss(applyDim(_sw.set(tokHex('--foreground-secondary')), lv));
    function recolor() {
      for (let r = 0; r < N; r++) {
        applyDim(colorOfRank(r), dimLv(r));
        chips.setColorAt(r, cTmp);
      }
      if (chips.instanceColor) chips.instanceColor.needsUpdate = true;
    }
    function reScale() {
      let dirty = false;
      for (let r = 0; r < N; r++) {
        // 选中的那张卡本身也长大一档：只有框的话，缩得很小时框和卡糊成一个点
        const lv = dimLv(r), want = r === S.sel ? 1.45 : lv === 2 ? 0.3 : lv === 1 ? 0.42 : 1;
        if (scl[r] !== want) { scl[r] = want; dirty = true; }
      }
      if (dirty) settling = true;
    }
    // 选中/聚焦开关变化后统一刷新（重算关联集合 → 压暗与缩放）
    function refreshFocus() { buildRelSet(); reScale(); recolor(); applyGridEmphasis(); renderLegend(); }

    /* ── 相机：轴测（等距可旋转）+ 顶/前/侧 正交锁轴（拖动即转回 3D），取景随形态包围盒 ── */
    // 等距轴测（isometric）的标准机位：方位 45°、仰角 asin(tan30°) ≈ 35.26°
    // —— 三根世界轴等比缩短、互成 120°，这才是「轴测」该有的样子。
    const ISO = { theta: Math.PI / 4, phi: Math.asin(Math.tan(Math.PI / 6)) };
    const cam = { theta: ISO.theta, phi: ISO.phi, half: 30, cx: 0, cy: 8, cz: 0, panX: 0, panY: 0 };
    function fitView() {
      const b = model.boundsOf(S.mode);
      // 轴标注留白随模型尺度自适应（固定留白会让小规格模型只占画面一小块）
      const span = Math.max(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0);
      const mx = Math.min(5, Math.max(1.0, span * 0.06));
      // 半尺寸 = rank 中心包围盒 + 卡块自身半尺寸（包围盒只含中心点）+ 标注留白
      let ex = (b.x1 - b.x0) / 2 + CARD.x / 2 + mx;
      let ey = (b.y1 - b.y0) / 2 + CARD.y / 2 + mx * 0.6;
      let ez = (b.z1 - b.z0) / 2 + CARD.z / 2 + mx;
      cam.cx = (b.x0 + b.x1) / 2; cam.cy = (b.y0 + b.y1) / 2; cam.cz = (b.z0 + b.z1) / 2;
      // 并入当前视角下真正会显示的标记：取景以卡心为中心，所以每根轴取「标记探出中心
      // 多远」的最大值。封 3 倍，防某个异常标记把整幅缩成一小团。
      if (axBox) {
        const capX = ex * 3, capY = ey * 3, capZ = ez * 3;
        ex = Math.min(capX, Math.max(ex, Math.abs(axBox.x0 - cam.cx), Math.abs(axBox.x1 - cam.cx)));
        ey = Math.min(capY, Math.max(ey, Math.abs(axBox.y0 - cam.cy), Math.abs(axBox.y1 - cam.cy)));
        ez = Math.min(capZ, Math.max(ez, Math.abs(axBox.z0 - cam.cz), Math.abs(axBox.z1 - cam.cz)));
      }
      cam.panX = 0; cam.panY = 0;
      const w = stageEl.clientWidth || 800, h = stageEl.clientHeight || 600, asp = w / h;
      // 模型在屏幕右/上方向的半跨度（hw, hh）——正交三视图直取，轴测按相机基向量投影
      // （近似式在小尺度下会让方块溢出画布）
      let hw, hh;
      if (S.view === 1) { hw = ex; hh = ez; }             // 顶视：屏幕 横=X 纵=Z
      else if (S.view === 2) { hw = ex; hh = ey; }        // 前视：横=X 纵=Y
      else if (S.view === 3) { hw = ez; hh = ey; }        // 侧视：横=Z 纵=Y
      else {
        const st = Math.abs(Math.sin(cam.theta)), ct = Math.abs(Math.cos(cam.theta));
        const sp = Math.abs(Math.sin(cam.phi)), cp = Math.abs(Math.cos(cam.phi));
        hw = ex * st + ez * ct;
        hh = ey * cp + sp * (ex * ct + ez * st);
      }
      // 让开左上角的工具栏卡片：放宽取景后把模型偏向右下。偏移量以「放宽后的实际余量」
      // 封顶，宽扁模型不会被推出画布（面板尺寸从 DOM 实测；chrome:false 的嵌入用法无面板 → 不偏移）。
      const bar = root.querySelector('.prc-topbar');
      const br = bar ? bar.getBoundingClientRect() : null;
      const bx = br && br.width < w * 0.8 ? Math.min(0.18, (br.width / w) * 0.3) : 0;
      const by = br ? Math.min(0.18, (br.height / h) * 0.42) : 0;
      cam.half = Math.max(hh, hw / asp) * 1.05 * (1 + Math.max(bx, by));
      const halfW = cam.half * asp;
      cam.panX = -Math.min(bx * halfW, Math.max(0, halfW - hw));    // 相机左移 → 模型右移
      cam.panY = Math.min(by * cam.half, Math.max(0, cam.half - hh)); // 相机上移 → 模型下移
    }
    function applyCamera() {
      const w = stageEl.clientWidth || 800, h = stageEl.clientHeight || 600, asp = w / h;
      camera.left = -cam.half * asp; camera.right = cam.half * asp;
      camera.top = cam.half; camera.bottom = -cam.half;
      const c = V3(cam.cx, cam.cy, cam.cz);
      const D = 300;
      if (S.view === 1) { camera.position.set(c.x, c.y + D, c.z); camera.up.set(0, 0, -1); }
      else if (S.view === 2) { camera.position.set(c.x, c.y, c.z + D); camera.up.set(0, 1, 0); }
      else if (S.view === 3) { camera.position.set(c.x + D, c.y, c.z); camera.up.set(0, 1, 0); }
      else {
        const sp = Math.sin(cam.phi), cp = Math.cos(cam.phi);
        camera.position.set(c.x + D * cp * Math.cos(cam.theta), c.y + D * sp, c.z + D * cp * Math.sin(cam.theta));
        camera.up.set(0, 1, 0);
      }
      camera.lookAt(c);
      // 平移（拖拽 / 让开工具栏的取景偏移）：位置与视线目标必须偏移同一个向量，
      // 否则视线方向被改变 → 投影斜切（不再是正经的等距轴测）。
      camera.updateMatrixWorld();
      const right = V3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
      const up = V3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
      const shift = right.multiplyScalar(cam.panX).add(up.multiplyScalar(cam.panY));
      camera.position.add(shift);
      camera.lookAt(c.clone().add(shift));
      camera.updateProjectionMatrix();
    }

    /* ── 通信组重建（选中 rank → 四维对端 + 连线 + 标签）── */
    /* 集合原语的数据流（对齐驾驶舱「算法展开」）：一个通信域按什么算法收发，就画什么形状。
         TP / DP = AllReduce → Ring（成环，前半程 ReduceScatter、后半程 AllGather）或 Tree（二叉树）
         PP      = P2P 接力  → 链
         EP      = AllToAll  → 域内互发（成员少画全连，多则退化成星形，避免边数爆炸）
       S.algo='auto' 时按上表选，也可强制 ring / tree。 */
    // AllToAll 画全连的成员上限：8 个成员就是 28 条边，糊成一片什么也看不清 →
    // 超过就退化成「以选中卡为中心的星形」（它自己收发谁，本来也是读图的重点）。
    const A2A_MESH_MAX = 5;
    function primOf(d) { return d === 'EP' ? 'AllToAll' : d === 'PP' ? 'P2P' : 'AllReduce'; }
    function algoOf(d) {
      if (d === 'EP' || d === 'PP') return d === 'EP' ? 'a2a' : 'chain';
      return S.algo === 'tree' ? 'tree' : 'ring';        // auto/ring → Ring AllReduce
    }
    /* 一个域的「走线」：返回若干条 rank 折线（不是坐标——每一段要知道两端是谁，
       才能判断它实际跨了哪层物理链路），并标出这一段该不该画成外凸弧。
       为什么要弧：一个通信组的成员在多数形态里是共线的（标准形态的 TP 组是一行、
       DP 组是一列），此时 Ring 的闭合边、Tree 的跨层边若也走直线，就与相邻链完全
       重叠——两种算法画出来一模一样，只有文字在变。跨越多个成员的「长边」因此外凸，
       Ring 成了「一条链 + 一道回程弧」，Tree 成了经典的弧形二叉树。 */
    function edgesOf(d, members) {
      const out = [], algo = algoOf(d);
      const seg = (ranks, arc) => out.push({ ranks, arc: !!arc });
      if (algo === 'chain') { seg(members.slice()); return out; }             // PP 接力链
      if (algo === 'ring') {                                                  // Ring：链 + 回程弧
        seg(members.slice());
        if (members.length > 2) seg([members[members.length - 1], members[0]], true);
        return out;
      }
      if (algo === 'tree') {                                                  // Tree：二叉树边
        for (let i = 1; i < members.length; i++) {
          const par = (i - 1) >> 1;
          seg([members[par], members[i]], i - par > 1);
        }
        return out;
      }
      if (members.length <= A2A_MESH_MAX) {                                   // AllToAll：全连
        for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) seg([members[i], members[j]], j - i > 1);
      } else {                                                                // 成员多 → 退化成星形
        members.forEach((r) => { if (r !== S.sel) seg([S.sel, r]); });
      }
      return out;
    }
    /* 长边的外凸弧：二次贝塞尔，两端严格落在卡心（端点不许飘——「线没连到卡上」修过一次），
       只有中间鼓出去。鼓的方向取与边垂直、尽量朝上的那一侧；鼓的高度随边长增长但封顶。 */
    function arcPts(a, b) {
      const dir = b.clone().sub(a), len = dir.length();
      if (len < 1e-6) return [a, b];
      dir.divideScalar(len);
      let up = V3(0, 1, 0);
      if (Math.abs(dir.dot(up)) > 0.9) up = V3(0, 0, 1);
      const perp = up.sub(dir.clone().multiplyScalar(up.dot(dir))).normalize();
      // 鼓的高度：够把长边从相邻链上分开就行——按边长给一点、封顶在两格卡宽以内。
      // 早期按边长 30% 起鼓（封顶 9 格），几条弧就把整个模型盖住了。
      const c = a.clone().add(b).multiplyScalar(0.5).add(perp.multiplyScalar(Math.min(len * 0.12, CARD.x * 2.2)));
      const pts = [], K = 8;   // 8 段足够圆滑；再细会把重排动画期间的每帧重建拖慢
      for (let i = 0; i <= K; i++) {
        const t = i / K, u = 1 - t;
        pts.push(a.clone().multiplyScalar(u * u).add(c.clone().multiplyScalar(2 * u * t)).add(b.clone().multiplyScalar(t * t)));
      }
      return pts;
    }

    function rebuildComm() {
      clearComm();
      peerMeshes.forEach((m) => { m.geometry.setDrawRange(0, 0); m.visible = false; });
      moverPaths = [];
      outlineBoxes.forEach((o) => { o.visible = false; });
      buildRelSet();               // 关联集合与连线同源：谁被画成对端，谁就不被聚焦压暗
      if (S.sel == null) return;
      const gp = (r) => V3(cur[r * 3], cur[r * 3 + 1], cur[r * 3 + 2]);
      const curDim = PHASES[phaseIdx()].dim;
      peerDims.forEach((d, di) => {
        const members = model.commGroup(S.sel, d);
        const mesh = peerMeshes[di];
        const buf = mesh.geometry.attributes.position;
        const V = EDGE_TPL.length;                 // 每个成员 24 点 × 3 分量
        let n = 0;
        members.forEach((r) => {
          if (r === S.sel || n >= PEER_MAX) return;
          const p = gp(r), base = n * V;
          for (let k = 0; k < V; k += 3) {
            buf.array[base + k] = EDGE_TPL[k] + p.x;
            buf.array[base + k + 1] = EDGE_TPL[k + 1] + p.y;
            buf.array[base + k + 2] = EDGE_TPL[k + 2] + p.z;
          }
          n++;
        });
        mesh.geometry.setDrawRange(0, n * (V / 3));
        buf.needsUpdate = true;
        mesh.visible = S.wire.members && n > 0;
        const colorHex = new THREE.Color(dimc(d)).getHex();
        // 当前阶段主导的那一维加一档亮度与粗细（四维一律清晰可见，只是主导维更亮）
        const on = curDim === d;
        // 线要细：一屏可能同时有四维的走线，管壁按卡宽的 1/12 起算，主导维再粗一档。
        const op = on ? 0.95 : 0.45, rad = (on ? 1.2 : 0.8) * CARD.x * 0.085;
        mesh.material.opacity = on ? 0.7 : 0.28;
        const segs = edgesOf(d, members);
        const paths = segs.map((sg) => (sg.arc ? arcPts(gp(sg.ranks[0]), gp(sg.ranks[1])) : sg.ranks.map(gp)));
        if (S.wire.lines) {
          // 折线逐段建管：每段两点，端点与拐点都严格落在卡心（整条折线交给一个
          // TubeGeometry 会按弧长采样，中间拐点被抄近路）。弧（长边）整条画。
          // 走线只按「维」着色：试过按物理层级逐段上色，线太细、又和 TP 组重合，
          // 基本看不出层级差别 → 物理的事交给信息卡的段数统计（文字更准）。
          segs.forEach((sg, i) => {
            if (sg.arc) { commLine(paths[i], colorHex, op, rad, { dim: d, ranks: sg.ranks }); return; }
            const pts = paths[i];
            for (let k = 1; k < pts.length; k++) {
              commLine([pts[k - 1], pts[k]], colorHex, op, rad, { dim: d, ranks: [sg.ranks[k - 1], sg.ranks[k]] });
            }
          });
        }
        if (on) moverPaths = paths.map((pts) => ({ pts, color: colorHex }));   // 粒子只跑「此刻」这一维
        // 域轮廓：把这一组的成员用一个线框包起来——切到对应形态时组会 snap 成整块，
        // 轮廓于是直接画出「这一组在这种堆法下是什么形状」（对齐驾驶舱 COMM 镜头的域轮廓）
        if (S.wire.outline) {
          const box = outlineBoxes[di];
          const bb = new THREE.Box3();
          members.forEach((r) => bb.expandByPoint(gp(r)));
          bb.expandByScalar(CARD.x * 0.75);
          const size = bb.getSize(new THREE.Vector3()), ctr = bb.getCenter(new THREE.Vector3());
          box.scale.set(Math.max(size.x, 0.01), Math.max(size.y, 0.01), Math.max(size.z, 0.01));
          box.position.copy(ctr);
          box.material.color.set(colorHex);
          box.material.opacity = on ? 0.8 : 0.3;
          box.visible = true;
        }
      });
      // 选中卡上方原先挂一句「此刻 TP · Ring ReduceScatter 段 · 其余三维…」：
      // 同样是散文，而且信息卡与图例已经在说同一件事 → 从 3D 里撤掉（同 axNotes 的道理）。
    }

    /* ── HUD / 图例 / 粒度贴士 / 信息卡 ── */
    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
    /* 左下的「读图钥匙」HUD 已删除：常驻大段文字太占画面。形态的读法进了「形态」问号
       气泡（随当前形态变化），异常读法在「注入」问号里，当前阶段看时间轴与图例。 */
    function renderHud() { }
    function renderPill() {
      const pill = $('.prc-pill'); if (!pill) return;
      const d = curDepth();
      if (!d) { pill.classList.remove('show'); pill.innerHTML = ''; return; }
      pill.classList.add('show');
      // 「每格=几张卡」：正交 2D 里同一格可能是 1 张卡，也可能是多个折叠维的乘积张卡
      // 重叠（例：侧视同时折叠墙序与墙内 TP）——必须如实写清楚，别让人以为一格一卡。
      const rest = d.fold / d.slice.n;   // 开剖面后仍被折叠的卡数（多折叠维时 > 1）
      pill.innerHTML = S.sliceOn
        ? (rest > 1
          ? `${ICON.grid} 每格 = <b class="prc-hot">${rest} 张卡重叠</b>（剖面 ${esc(d.slice.lab)}=${S.sliceVal} · 其余维仍折叠）`
          : `${ICON.grid} 每格 = <b class="prc-ok">1 张卡</b>（剖面 ${esc(d.slice.lab)}=${S.sliceVal}）`)
        : `${ICON.grid} 每格 = <b class="prc-hot">${d.fold} 张卡重叠</b>（${esc(d.label)} 折入视线 · 开剖面逐层翻）`;
    }
    // 图例必须跟着「当前卡块着色」走：分组着色时列出各组的实际配色，负载着色时给色带，
    // 注入异常时给异常组——否则切了着色图例纹丝不动，读者按图例根本对不上画面。
    /* 图例 = 只回答「这个颜色叫什么」：分「着色 / 连线」两段，每段一行一条，
       条目只有色块 + 名字。为什么、怎么读（此刻主导是什么意思、压暗代表什么、
       同色非同组…）一律收进对应那排控件的问号气泡——图例不承担解释。 */
    function renderLegend() {
      const lg = $('.prc-legend'); if (!lg) return;
      const row = (c, t) => `<div class="prc-lgrow"><i style="background:${c}"></i><span>${esc(t)}</span></div>`;
      const sec = (t) => `<div class="prc-lgsec">${esc(t)}</div>`;
      const parts = [];
      if (S.anom !== 'none') {
        const what = { tp: 'TP 槽 0', pp: 'PP 级 0', dp: 'DP 副本 0', ep: `EP 桶 ${anomBucket()}` }[S.anom];
        parts.push(sec('着色 · 异常注入'), row('var(--danger)', `异常组 ${what}`), row(rgbCss(restColor(2)), '其余'));
      } else if (S.colorBy === 'load') {
        parts.push(sec('着色 · 状态热力'),
          `<div class="prc-lgrow prc-ramp"><i></i><span>负载 低→高</span></div>`);
      } else {
        const key = S.colorBy, pl = model.placement;
        const n = key === 'tp' ? TP : key === 'pp' ? PP : key === 'dp' ? REP
          : key === 'host' ? pl.hosts : key === 'pod' ? pl.pods : EP;
        const lab = { tp: 'TP', pp: 'PP', dp: 'DP副本', ep: 'EP桶', host: '主机', pod: 'Pod' }[key];
        const MAXC = 6, shown = Math.min(n, MAXC);
        parts.push(sec(`着色 · 按 ${lab} 分组`));
        for (let i = 0; i < shown; i++) parts.push(row(groupColor(i), `${lab}${i}`));
        if (n > shown) parts.push(`<div class="prc-lgrow"><i style="background:transparent"></i><span class="prc-dim">… 共 ${n} 组</span></div>`);
      }
      const d = curDepth();
      if (d && S.sliceOn) parts.push(row(dimSwatch(2), '剖面外'));
      if (focusOn()) parts.push(row(dimSwatch(1), '无关卡'));
      if (S.sel != null) {
        const anyOn = S.wire.members || S.wire.lines || S.wire.outline || S.wire.movers;
        if (anyOn) {
          const cur = PHASES[phaseIdx()].dim;
          parts.push(sec('连线 · 通信域'));
          peerDims.forEach((dm) => {
            const algo = dm === 'EP' ? 'AllToAll' : dm === 'PP' ? 'P2P 链'
              : `AllReduce ${S.algo === 'tree' ? 'Tree' : 'Ring'}`;
            parts.push(`<div class="prc-lgrow${dm === cur ? ' is-now' : ''}"><i style="background:${dimc(dm)}"></i><span>${esc(dm + ' ' + algo)}</span></div>`);
          });
        }
      }
      lg.innerHTML = parts.join('');
    }
    // 此刻主导维走到集合原语的哪一段（Ring 前半 ReduceScatter / 后半 AllGather）
    function ringStage() {
      const d = PHASES[phaseIdx()].dim;
      if (primOf(d) === 'AllReduce' && algoOf(d) === 'ring') return `Ring ${phaseU() < 0.5 ? 'ReduceScatter' : 'AllGather'} 段`;
      return primOf(d);
    }
    // 选中的那条通信边（点线之后）：谁到谁、跨了哪层物理链路
    function edgeLine() {
      const e = S.selEdge; if (!e) return '';
      return `<b>${e.dim} ${e.prim}</b> rank ${e.from} → ${e.to}` +
        ` · <span style="color:${tierc(e.tier)}">${TIER_LAB[e.tier]}</span>` +
        `<span class="prc-dim">（机${e.hosts[0]}→${e.hosts[1]} · Pod${e.pods[0]}→${e.pods[1]}）</span>`;
    }
    /* 点选详情面板：结构照搬设计系统 sidecar 的 inspector——kicker（类别）→ 标题（是谁）
       → 一句定义 → 键值表（取值）→ 结论条（此刻状态 / 选中的那条边）。 */
    function kv(lab, val) {
      return `<div class="prc-kvrow"><span class="prc-kvlab">${lab}</span><span class="prc-kvval">${val}</span></div>`;
    }
    function renderInfo() {
      const info = $('.prc-info'); if (!info) return;
      if (S.sel == null) { info.classList.remove('show'); info.innerHTML = ''; return; }
      const r = S.sel, st = model.ppOf(r), lr = model.stageLayerRange(st), e = model.epOf(r);
      const ph = PHASES[phaseIdx()], pl = model.placement;
      info.classList.add('show');
      const tally = physTally(r), edge = edgeLine();
      info.innerHTML =
        `<button class="prc-infoclose btn btn-sm" type="button" aria-label="取消选中">${ICON.close}</button>` +
        `<div class="prc-kicker">RANK</div>` +
        `<div class="prc-title">rank ${r} <span class="prc-dim">/ ${N}</span></div>` +
        `<p class="prc-prose">这张卡同时属于四个通信域：换形态只改变它摆在哪，不改变下面这四个身份。</p>` +
        `<div class="prc-kv">` +
        kv('TP 槽位', `<b style="color:${dimc('TP')}">TP${model.tpOf(r)}</b> <span class="prc-dim">/ ${TP}</span>`) +
        kv('PP 段', `<b style="color:${dimc('PP')}">PP${st}</b> <span class="prc-dim">S${st}·L${lr.lo}-${lr.hi}</span>`) +
        kv('DP 副本', `<b style="color:${dimc('DP')}">${model.repOf(r)}</b> <span class="prc-dim">/ ${REP}</span>`) +
        kv('EP 桶 · A2A 域', `<b style="color:${dimc('EP')}">桶${e}</b> <span class="prc-dim">${model.expRange(e)} · 域${model.domOf(r)}</span>`) +
        kv('物理落位', `<b>机${model.hostOf(r)} · Pod${model.podOf(r)}</b> <span class="prc-dim">${pl.cardsPerHost} 卡/机</span>`) +
        `</div>` +
        `<div class="prc-status">此刻 <b style="color:${dimc(ph.dim)}">${ph.dim}</b> 主导 · ${esc(ringStage())}` +
        (tally ? ` · ${tally.replace(/^<br>/, '')}` : '') + `</div>` +
        (edge ? `<div class="prc-status is-edge">${edge.replace(/^<br>/, '')}</div>` : '');
      const close = info.querySelector('.prc-infoclose');
      if (close) close.addEventListener('click', () => api.select(null));
    }

    /* 「此刻这一维的走线各跨了哪层」——3D 里画层级色线看不出来（线太细、又和 TP 组
       重合），改用这一行文字给量：跨 Pod 的段越多，这次集合越贵。 */
    function physTally(r) {
      const d = PHASES[phaseIdx()].dim;
      const segs = edgesOf(d, model.commGroup(r, d));
      const cnt = { ub: 0, rail: 0, out: 0 };
      segs.forEach((sg) => { const rs = sg.ranks; for (let i = 1; i < rs.length; i++) cnt[model.tierOf(rs[i - 1], rs[i])]++; });
      const tot = cnt.ub + cnt.rail + cnt.out;
      if (!tot) return '';
      const one = (k, lab) => (cnt[k] ? `<span style="color:${tierc(k)}">${lab} ${cnt[k]}</span>` : '');
      return `<br><span class="prc-dim">此刻 ${d} 走线 ${tot} 段：</span> ` +
        [one('ub', '同机'), one('rail', 'Pod内'), one('out', '跨Pod')].filter(Boolean).join(' · ');
    }

    /* ── 工具栏 ── */
    // Lucide 风格线性图标（内联 SVG · stroke=currentColor · 无 emoji）
    const ICON = {
      play: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
      pause: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
      grid: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>',
      clock: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
      key: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 8.3-8.3M16 7l2 2M13.5 9.5l2 2"/></svg>',
      alert: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 3 20h18L12 4z"/><path d="M12 10v4M12 17.5v.5"/></svg>',
      sliders: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
      close: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
      help: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.2 9.3a3 3 0 0 1 5.8 1c0 2-2.9 2.6-2.9 4"/><path d="M12 17.5v.5"/></svg>',
    };
    /* 每一排控件的「这是什么」——hover / 键盘聚焦弹出说明。
       写法像一小段文档：标题 → 一句定义 → 选项清单（<dl>）→ 注意事项，
       最后由 DYN 追加一块「此刻」状态。控件名只有两个字，说不清「注入和着色是什么
       关系」这类问题；又不该把长文案常驻在画面上，所以一律收进气泡。 */
    const HELP = {
      modes: `<h4>形态 · 同一批卡换一种堆法</h4>
        <p>只改变卡摆在哪（谁挨着谁），不改变卡本身、也不改变颜色。哪一维被堆成「一整块」，那一维的问题就现出形状。</p>
        <dl>
          <dt>标准</dt><dd>位置即多维坐标：X=TP · Y=PP（模型深度，上→下 = L1→末层）· Z=DP</dd>
          <dt>DP</dt><dd>每个副本一块板、排成宫格</dd>
          <dt>EP</dt><dd>每个专家桶一面墙</dd>
          <dt>TP</dt><dd>坐标系与标准相同，只把 TP 轴拉开成墙</dd>
          <dt>PP</dt><dd>换轴：段沿水平摊成流水线</dd>
        </dl>
        <p class="prc-helpnote">TP / PP 的正交 2D 与标准完全重合，因此不出视角切换——它们的价值只在 3D 的「拉开」：把一格之隔变成一堵墙之隔。</p>`,
      views: `<h4>视角 · 怎么看这堆卡</h4>
        <dl>
          <dt>3D</dt><dd>可拖拽旋转的等距轴测</dd>
          <dt>顶 / 前 / 侧</dt><dd>正交锁轴的 2D 投影，会把与视线平行的维折叠</dd>
          <dt>剖面</dt><dd>只看被折叠那一维的某一层，其余压暗</dd>
        </dl>
        <p>按钮上的「DP-TP 面」读作<b>平面</b>而不是乘法：破折号两侧是这一屏留下的两根屏幕轴（横 DP、纵 TP），没写出来的第三根就是被折进视线的那一维。这一格里真正相乘的只有 rank 总数 TP×PP×DP，视角本身不改变任何数量。</p>
        <p class="prc-helpnote">折叠不隐瞒：每格重叠多少张卡写在右上角的粒度贴士里。任何正交视角下拖动，都会从当前朝向无缝转回 3D。</p>`,
      lens: `<h4>着色 · 给卡上色的镜头</h4>
        <p>只改颜色，不改结构。</p>
        <dl>
          <dt>状态热力</dt><dd>当前通信阶段的负载，绿→黄→红，跟着时间轴走</dd>
          <dt>TP / PP / DP / EP</dt><dd>按该维的组号上色，同色即同组——用来肉眼验证「这种堆法下同组是不是真的连成一块」</dd>
          <dt>主机 / Pod</dt><dd>按物理落位上色，看 rail 亲和：同色连成块 = 这一组正好装在一台机 / 一个 Pod 里</dd>
        </dl>
        <p class="prc-helpnote">右下角图例只列「颜色 + 名字」。组数超过色环时会 12 色循环，<b>同色不一定同组</b>，以「… 共 N 组」为准；图例里的灰色两条是被压暗的卡（剖面外 / 与选中卡无关），不是另一个组。</p>`,
      anom: `<h4>注入 · 假装某一维出故障</h4>
        <p>看它在各形态下长什么形状。</p>
        <p><b>与着色的关系</b>：注入不是另一种镜头，而是<b>接管</b>着色——一旦注入非「无」，卡色改由故障决定（受影响的卡＝危险红，其余按低负载淡色），上面选的着色镜头暂时让位，图例也随之切换；选回「无」即恢复。</p>
        <p class="prc-helpnote">例：注入 EP桶3 → 标准形态下是一圈周期条带，切到 EP 聚簇就 snap 成一整面墙，这就是「热点桶」的形状。</p>`,
      wire: `<h4>连线 · 选中卡的四个通信域怎么收发</h4>
        <p>必须先选中一张卡（点画面里的小方块），否则没有对象可画。</p>
        <dl>
          <dt>成员</dt><dd>同域对端卡的线框描边</dd>
          <dt>通信线</dt><dd>按集合算法画的走线</dd>
          <dt>域轮廓</dt><dd>把该组整体框起来，看这组在当前堆法下是什么形状</dd>
          <dt>粒子</dt><dd>沿「此刻主导维」走线跑的暗点，方向即数据流向</dd>
          <dt>聚焦</dt><dd>把与选中卡无关的卡压暗、网格反过来加强</dd>
          <dt>算法</dt><dd>AllReduce 画成 Ring（前半 ReduceScatter / 后半 AllGather）还是 Tree；PP 恒为 P2P 链、EP 恒为 AllToAll</dd>
        </dl>
        <p class="prc-helpnote">图例「连线」段里<b>加粗的那条 = 此刻主导维</b>（走线加亮、粒子只跑它）。走线可点：悬停报这一段是谁到谁、跨的是同机 UB / Pod 内 rail / 跨 Pod；点一下选中该段并抛给宿主（onSelectEdge）去点亮物理链路。物理落位默认 8 卡/机 · 32 机/Pod（rank 连号装机，TP 组因此天然同机），要改走 setPlacement API。</p>`,
      time: `<h4>时间 · 一个训练 step 的 4 个通信阶段</h4>
        <dl>
          <dt>TP</dt><dd>前向 AllReduce —— 节点内 UB · 高频</dd>
          <dt>PP</dt><dd>阶段接力 Send/Recv —— Pod 内跨 Host · 中频</dd>
          <dt>EP</dt><dd>MoE AllToAll 浪涌 —— Pod 内全互联 · 浪涌</dd>
          <dt>DP</dt><dd>梯度 AllReduce —— 跨 Pod Scale-Out · 低频大包</dd>
        </dl>
        <p class="prc-helpnote">热力着色与方向粒子都跟着阶段走；轨道可拖拽定位，播放/暂停在顶栏。当前阶段也写在选中卡的详情面板里。</p>`,
      cfg: `<h4>并行 · 这套魔方由多少卡、怎么切</h4>
        <p>rank 总数 = TP×PP×DP。<b>EP 不乘进卡数</b>——它折在 DP 轴上（要求 EP 整除 DP），DP/EP = AllToAll 域的个数。</p>
        <p class="prc-helpnote">改完数字按 Apply 整体重建。两个预设：盘古 Pro MoE 真实训练策略（8·5·100·2 = 4000 卡）、128 卡小规格（2·4·16·8）。</p>`,
    };
    /* 问号气泡里的「当前状态」部分：形态的读法、注入的读法、连线的空态提示——
       这些原先常驻在画面上（左下 HUD、工具栏行尾的说明），太占地方，一律收进气泡。 */
    const DYN = {
      modes: () => {
        const m = model.modes[S.mode];
        // 当前形态「给你看什么」——一格之隔 vs 一堵墙之隔，各自对应哪类问题
        const DETAIL = {
          std: `三根语义轴各放一维，一张卡的位置就是它的 (TP,PP,DP) 坐标；`
            + `第 4 维 EP 靠着色透镜叠上去。这是「查身份」的形态，不是「找形状」的形态。`,
          dpt: `一块板 = 一份完整副本（板内 TP×${TP} 折成 ${model.TPC}列×${model.TPD}排、竖向是 PP×${PP}），`
            + `${REP} 块板排成宫格。副本之间只在步末做梯度 AllReduce → <b>慢副本 = 宫格里干净的一整块板发暗</b>。`,
          ep: `一面墙 = 一个专家桶（同墙 = 持有同一批专家），每桶复现于 ${DOM} 个 A2A 域。`
            + `<b>热点/坏桶 = 一整面墙同色</b>；横穿所有墙的同一排 = 一个 A2A 域（每桶各出 1 员互发）。桶↔卡非 1:1。`,
          tps: `坐标系与标准完全相同，只把 TP 轴的间距拉到「强调」档：<b>一面墙 = 全网 TP 槽位相同的卡</b>`
            + `（横跨所有 PP 段与所有 DP 副本，共 ${PP * REP} 张）。同槽位的系统性问题——固件/驱动版本不一致、`
            + `某槽位风道差、某条 rail 上的第 k 张卡——在标准形态里是每隔 ${TP} 张出现一次的周期细条纹，`
            + `在这里是<b>一整面墙同红</b>（注入「TP槽0」可当场对照）。选中一张卡时，它的 TP AllReduce 组`
            + `= 每面墙各一张，连线横穿全部 ${TP} 面墙——这就是「每次层内 AllReduce 要跨过多少堵墙」。`,
          ppf: `这个形态<b>换了轴</b>：X=PP（段，左→右就是前向数据流）· Y=TP · Z=DP。`
            + `<b>一面墙 = 一个流水段的所有卡</b>（连续 ${LPS} 层 × 所有 TP × 所有 DP）。`
            + `慢段 = 一整面墙偏暗，而且<b>下游的墙跟着暗</b>（等上游喂数据 = 气泡）；`
            + `墙顶的 S0·L1-${LPS} 标尺回答「这段管哪些层」。选中卡的 PP 接力组在这里是一条`
            + `从左到右穿过所有墙的链——正是流水线本身的形状。`,
        }[m.key] || '';
        return `<div class="prc-helpnow"><b>此刻：${esc(m.sub)}</b>` + (DETAIL ? `<p>${DETAIL}</p>` : '') +
          `<p>为什么这样摆：${esc(m.why)}</p>` +
          (axNotes.length ? '<ul>' + axNotes.map((t) => `<li>${esc(t)}</li>`).join('') + '</ul>' : '') +
          (S.selLayer != null && S.mode === 0 ? `<p>正高亮整网 L${S.selLayer + 1} 切片</p>` : '') + '</div>';
      },
      views: () => {
        const md = model.modes[S.mode], d = curDepth();
        const what = S.view === 0
          ? '3D 等距轴测 · 三根轴同屏，拖动可转'
          : `${md.viewLabels[S.view]} —— 屏幕两根轴之外，${d ? esc(d.label) : '第三根轴'} 被折进视线`;
        return `<div class="prc-helpnow"><b>此刻：</b>${esc(md.name)} · ${what}`
          + (d ? `，每格重叠 ${d.fold} 张卡${S.sliceOn ? `（正翻 ${d.slice.lab} 第 ${S.sliceVal + 1} 层）` : '（可开剖面逐层翻）'}` : '')
          + '</div>';
      },
      anom: () => {
        const note = {
          none: '', 
          tp: '当前注入 TP 槽 0：全网同槽位卡集体标红 → 切「TP切片」= 一面墙集体异常（同槽位系统性坏件的形状）',
          pp: '当前注入 PP 级 0：物理上散成条纹 → 切「PP流水」= 最左一整段全红（慢段/坏段的形状）',
          dp: '当前注入 DP 副本 0：切「DP平铺」= 宫格里干净的一块板全红（慢副本的形状）',
          ep: `当前注入 EP 桶 ${anomBucket()}：标准形态下是周期条带 → 切「EP聚簇」= 一整面墙同红（热点/坏桶的形状 · 桶↔卡非 1:1）`,
        }[S.anom];
        return note ? `<div class="prc-helpnow"><b>${esc(note)}</b></div>` : '';
      },
      wire: () => (S.sel == null
        ? '<div class="prc-helpnow"><b>现在还没选卡 → 没有连线可画</b>：点画面里任意一个小方块（点上面任一图层按钮也会自动替你选一张）。</div>'
        : `<div class="prc-helpnow"><b>此刻：</b>TP/DP=AllReduce(${S.algo === 'tree' ? 'Tree' : 'Ring'}) · PP=P2P 链 · EP=AllToAll` +
          (S.wire.focus ? ' · 聚焦开：无关卡已压暗' : '') + '</div>'),
    };
    const helpBubbles = {};
    function syncHelp() {
      Object.keys(DYN).forEach((k) => {
        const b = helpBubbles[k];
        if (b) b.innerHTML = (HELP[k] || '') + DYN[k]();
      });
    }
    function helpDot(key) {
      const s = document.createElement('span');
      s.className = 'prc-help';
      s.tabIndex = 0;
      s.setAttribute('aria-label', '说明');
      s.innerHTML = ICON.help;
      // 气泡贴边翻转：问号靠右时改成右对齐、靠下时改成向上弹，免得跑到屏幕外
      const place = () => {
        const rr = root.getBoundingClientRect(), dr = s.getBoundingClientRect();
        s.classList.toggle('is-right', dr.left - rr.left > rr.width * 0.5);
        s.classList.toggle('is-up', dr.bottom - rr.top > rr.height * 0.6);
      };
      s.addEventListener('pointerenter', place);
      s.addEventListener('focus', place);
      const bub = document.createElement('span');
      bub.className = 'prc-helptip';
      bub.innerHTML = (HELP[key] || '') + (DYN[key] ? DYN[key]() : '');
      helpBubbles[key] = bub;
      s.appendChild(bub);
      return s;
    }
    // 设计系统按钮：secondary(.btn) + 小号(.btn-sm)，选中态用 .is-selected
    function chipBtn(label, onClick) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-sm';
      b.textContent = label;
      b.addEventListener('click', onClick);
      return b;
    }
    let modeBtns = [], viewBtns = [], lensBtns = [], anomBtns = [], playBtn = null, sliceBox = null, sliceRange = null, sliceLab = null;
    let cfgInputs = null, cfgRead = null, cfgErr = null;
    let wireBtns = [], algoBtns = [];
    let timeTrack = null, timeHead = null, moreBtn = null;
    function syncTimeUI() {
      if (!timeTrack) return;
      const pi = phaseIdx();
      timeTrack.querySelectorAll('.prc-pseg').forEach((el, i) => el.classList.toggle('on', i === pi));
      timeHead.style.left = (S.t * 100) + '%';
      // 阶段名/总线不再挂在时间行：文案长度随阶段变化，会把整排挤成两行、上下跳动。
      // 常驻位置交给左下 HUD 的「此刻」一行，解释交给行首问号，轨道段自己带 title。
    }
    // 「并行」输入排：TP/PP/DP/EP 任意填数 → setConfig 整体重建魔方（回车或「应用」提交）
    function applyCfg() {
      if (!cfgInputs) return;
      const res = api.setConfig({ tp: +cfgInputs.tp.value, pp: +cfgInputs.pp.value, dp: +cfgInputs.dp.value, ep: +cfgInputs.ep.value });
      if (!res.ok && cfgErr) cfgErr.textContent = '✗ ' + res.error;
    }
    // 顶栏会随宽度换行变高 → 把实际高度写回 CSS 变量，抽屉/贴士/详情卡都据此让位
    function syncBarH() {
      const bar = root.querySelector('.prc-topbar');
      if (bar) root.style.setProperty('--prc-barh', Math.round(bar.getBoundingClientRect().height) + 'px');
      const more = root.querySelector('.prc-more');
      const open = root.classList.contains('is-open');
      root.style.setProperty('--prc-moreh', (open && more ? Math.round(more.getBoundingClientRect().height) : 0) + 'px');
    }
    function syncCfgUI() {
      if (!cfgInputs) return;
      cfgInputs.tp.value = TP; cfgInputs.pp.value = PP; cfgInputs.dp.value = REP; cfgInputs.ep.value = EP;
      // 读数只补输入框没说的部分（乘法与折叠结果），别把已经摆在旁边的四个数再抄一遍
      cfgRead.textContent = `= ${N} rank · EP 折入 DP → ${DOM} 域`;
      cfgErr.textContent = '';
    }
    function syncChrome() {
      syncHelp(); syncBarH();                                           // 问号气泡与标题规格随状态更新
      if (anomBtns[4]) anomBtns[4].textContent = `EP桶${anomBucket()}`;   // 示意桶号随 EP 收缩
      modeBtns.forEach((b, i) => b.classList.toggle('is-selected', i === S.mode));
      const md = model.modes[S.mode];
      const vlist = md.views || [0, 1, 2, 3];
      viewBtns.forEach((b, i) => {
        b.style.display = vlist.includes(i) ? '' : 'none';        // 视角收编：重合平面不出按钮
        b.classList.toggle('is-selected', i === S.view);
        if (i > 0) b.textContent = md.viewLabels[i];
      });
      // 只剩 3D 一个视角的形态（TP切片 / PP流水，2D 与标准重合）：整组不显示，
      // 一个孤零零的「3D」按钮既没有可切换的对象，也让人以为别的被禁用了
      const vg = root.querySelector('.prc-row-views');
      if (vg) vg.style.display = vlist.length > 1 ? '' : 'none';
      const vhelp = vg && vg.nextElementSibling && vg.nextElementSibling.classList.contains('prc-help') ? vg.nextElementSibling : null;
      if (vhelp) vhelp.style.display = vlist.length > 1 ? '' : 'none';
      const lensKeys = ['load', 'tp', 'pp', 'dp', 'ep', 'host', 'pod'];
      lensBtns.forEach((b, i) => b.classList.toggle('is-selected', lensKeys[i] === S.colorBy));
      const anomKeys = ['none', 'tp', 'pp', 'dp', 'ep'];
      anomBtns.forEach((b, i) => b.classList.toggle('is-selected', anomKeys[i] === S.anom));
      const wireKeys = ['members', 'lines', 'outline', 'movers', 'focus'];
      wireBtns.forEach((b, i) => b.classList.toggle('is-selected', !!S.wire[wireKeys[i]]));
      const algoKeys = ['auto', 'ring', 'tree'];
      algoBtns.forEach((b, i) => b.classList.toggle('is-selected', algoKeys[i] === S.algo));

      if (moreBtn) {
        // 只留图标：顶栏右侧那两个按钮不带文字（标题交给 title/aria-label）
        moreBtn.innerHTML = ICON.sliders;
        moreBtn.title = moreBtn.ariaLabel = S.more ? '收起设置' : '更多设置';
        moreBtn.setAttribute('aria-label', moreBtn.title);
        moreBtn.classList.toggle('is-selected', S.more);
      }
      if (playBtn) {
        playBtn.innerHTML = S.playing ? ICON.pause : ICON.play;
        playBtn.title = S.playing ? `暂停（此刻 ${PHASES[phaseIdx()].id}）` : `播放（此刻 ${PHASES[phaseIdx()].id}）`;
        playBtn.setAttribute('aria-label', playBtn.title);
        playBtn.classList.toggle('is-selected', S.playing);
      }
      if (sliceBox) {
        const d = curDepth();
        sliceBox.style.display = d ? '' : 'none';
        if (d) {
          sliceRange.max = String(d.slice.n - 1);
          if (S.sliceVal > d.slice.n - 1) S.sliceVal = 0;
          sliceRange.value = String(S.sliceVal);
          sliceRange.disabled = !S.sliceOn;
          sliceLab.textContent = S.sliceOn ? `${d.slice.lab}=${S.sliceVal}` : `剖面关（${d.label} 折叠）`;
          sliceBox.querySelector('.btn').classList.toggle('is-selected', S.sliceOn);
        }
      }
    }
    if (opts.chrome !== false) {
      // 每排行首「名称 + 问号」：问号 hover/聚焦弹出这一排是什么、和别的排什么关系
      [['modes', '.prc-row-modes'], ['views', '.prc-row-views'], ['lens', '.prc-row-lens'],
        ['anom', '.prc-row-anom'], ['wire', '.prc-row-wire'], ['time', '.prc-timepop'], ['cfg', '.prc-row-cfg']]
        .forEach(([k, sel]) => {
          const lab = $(sel + ' .prc-lab');
          if (lab) { lab.insertAdjacentElement('afterend', helpDot(k)); return; }
          const row = $(sel);                       // 顶栏里的形态/视角没有行首标签 → 问号跟在这一组后面
          if (row) row.insertAdjacentElement('afterend', helpDot(k));
        });
      const rowModes = $('.prc-row-modes'), rowViews = $('.prc-row-views'), rowLens = $('.prc-row-lens'), rowAnom = $('.prc-row-anom');
      modeBtns = model.modes.map((m, i) => {
        const b = rowModes.appendChild(chipBtn(m.short || m.name, () => api.setMode(i)));
        b.title = m.name; b.setAttribute('aria-label', m.name);   // 短名按钮，全名进 title
        return b;
      });
      viewBtns = ['3D', '顶', '前', '侧'].map((t, i) => rowViews.appendChild(chipBtn(t, () => api.setView(i))));
      // 抽屉开关（着色 / 注入 / 连线 / 时间 / 并行）——独立按钮，不挤在视角行里
      moreBtn = $('.prc-morebtn');
      moreBtn.addEventListener('click', () => {
        S.more = !S.more;
        root.classList.toggle('is-open', S.more);
        syncChrome(); resize();
      });
      sliceBox = document.createElement('span'); sliceBox.className = 'prc-slice';
      sliceBox.appendChild(chipBtn('剖面', () => { S.sliceOn = !S.sliceOn; refresh2D(); }));
      sliceRange = document.createElement('input'); sliceRange.type = 'range'; sliceRange.min = '0'; sliceRange.max = '1'; sliceRange.value = '0';
      sliceRange.addEventListener('input', () => { S.sliceVal = sliceRange.value | 0; refresh2D(); });
      sliceLab = document.createElement('span'); sliceLab.className = 'prc-mono';
      sliceBox.appendChild(sliceRange); sliceBox.appendChild(sliceLab);
      rowViews.appendChild(sliceBox);
      const lensSeg = rowLens.appendChild(Object.assign(document.createElement('span'), { className: 'segmented-control' }));
      lensBtns = [['状态热力', 'load'], ['TP', 'tp'], ['PP', 'pp'], ['DP', 'dp'], ['EP', 'ep'],
        ['主机', 'host'], ['Pod', 'pod']]
        .map(([t, k]) => lensSeg.appendChild(chipBtn(t, () => { S.colorBy = k; recolor(); renderLegend(); syncChrome(); })));
      /* 时间轴 = 一个 step 的 4 个通信阶段（对齐集群驾驶舱）。
         播放/暂停常驻顶栏（只有图标），阶段轨道悬停时才弹出——它不是常用控件，
         但要随手够得着；弹层里可以直接拖拽定位，拖拽期间不收起。 */
      const rowTime = $('.prc-timepop');
      playBtn = $('.prc-playbtn');
      playBtn.addEventListener('click', () => { S.playing = !S.playing; syncChrome(); });
      timeTrack = document.createElement('div'); timeTrack.className = 'prc-phasetrack';
      PHASES.forEach((ph, i) => {
        const seg = document.createElement('div');
        seg.className = `prc-pseg prc-ph-${ph.id}`;
        seg.textContent = ph.id;
        seg.title = `${ph.name} · ${ph.bus}`;
        seg.dataset.ph = String(i);
        timeTrack.appendChild(seg);
      });
      timeHead = document.createElement('div'); timeHead.className = 'prc-playhead';
      timeTrack.appendChild(timeHead);
      const scrub = (ev) => {
        const r = timeTrack.getBoundingClientRect();
        S.t = Math.min(0.999, Math.max(0, (ev.clientX - r.left) / r.width));
        if (S.colorBy === 'load' && S.anom === 'none') recolor();
        rebuildComm(); syncTimeUI(); renderHud();
      };
      const timeWrap = $('.prc-timewrap');
      timeTrack.addEventListener('pointerdown', (ev) => {
        timeTrack.setPointerCapture(ev.pointerId); timeWrap.classList.add('is-dragging'); scrub(ev);
      });
      timeTrack.addEventListener('pointermove', (ev) => { if (ev.buttons & 1) scrub(ev); });
      global.addEventListener('pointerup', () => timeWrap.classList.remove('is-dragging'));
      rowTime.appendChild(timeTrack);
      // 连线图层：五个独立开关（都可关）+ 集合算法选择
      const rowWire = $('.prc-row-wire');
      const wireSeg = rowWire.appendChild(Object.assign(document.createElement('span'), { className: 'prc-chips' }));
      wireBtns = [['成员', 'members'], ['通信线', 'lines'], ['域轮廓', 'outline'], ['粒子', 'movers'], ['聚焦', 'focus']]
        .map(([t, k]) => wireSeg.appendChild(chipBtn(t, () => {
          S.wire[k] = !S.wire[k];
          if (k === 'movers' && !S.wire.movers) moverMeshes.forEach((m) => { m.visible = false; });
          // 连线只在「选中一张卡」之后才有东西可画：开图层时若还没选卡，先替用户选一张
          // 居中的代表卡（否则按钮亮着、画面却毫无变化，看上去像开关坏了）。
          if (S.sel == null && (S.wire.members || S.wire.lines || S.wire.outline || S.wire.movers)) {
            api.select(model.rankOf(TP >> 1, PP >> 1, REP >> 1));
          }
          else { rebuildComm(); refreshFocus(); renderInfo(); syncChrome(); }
        })));
      rowWire.appendChild(Object.assign(document.createElement('span'), { className: 'prc-lab prc-lab-inline', textContent: '算法' }));
      const algoSeg = rowWire.appendChild(Object.assign(document.createElement('span'), { className: 'segmented-control' }));
      algoBtns = [['自动', 'auto'], ['Ring', 'ring'], ['Tree', 'tree']]
        .map(([t, k]) => algoSeg.appendChild(chipBtn(t, () => { S.algo = k; rebuildComm(); renderLegend(); syncChrome(); })));

      const anomSeg = rowAnom.appendChild(Object.assign(document.createElement('span'), { className: 'segmented-control' }));
      anomBtns = [['无', 'none'], ['TP槽0', 'tp'], ['PP级0', 'pp'], ['DP副本0', 'dp'], ['EP桶3', 'ep']]
        .map(([t, k]) => anomSeg.appendChild(chipBtn(t, () => { S.anom = k; recolor(); renderHud(); renderLegend(); syncChrome(); })));
      const rowCfg = $('.prc-row-cfg');
      const mkDim = (lab) => {
        const wrap = document.createElement('span'); wrap.className = 'prc-cfgitem';
        const l = document.createElement('span'); l.textContent = lab; wrap.appendChild(l);
        const inp = document.createElement('input');
        inp.type = 'number'; inp.min = '1'; inp.step = '1';
        inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') applyCfg(); });
        wrap.appendChild(inp); rowCfg.appendChild(wrap);
        return inp;
      };
      cfgInputs = { tp: mkDim('TP'), pp: mkDim('PP'), dp: mkDim('DP'), ep: mkDim('EP') };
      { const b = chipBtn('Apply', applyCfg); b.classList.add('btn-solid'); rowCfg.appendChild(b); }
      cfgErr = document.createElement('span'); cfgErr.className = 'prc-cfgerr'; rowCfg.appendChild(cfgErr);
      const cfgFoot = document.createElement('div'); cfgFoot.className = 'prc-rowfoot'; rowCfg.appendChild(cfgFoot);
      cfgRead = document.createElement('span'); cfgRead.className = 'prc-mono'; cfgFoot.appendChild(cfgRead);
      // 快捷预设（标签按 TP·PP·DP·EP 顺序）：
      //  · 盘古 Pro MoE 真实训练策略（data/ascend-workload-pangu-moe.json，
      //    TP8·EP2·PP5·4K NPU → dp = 4000/(8×5) = 100，EP2 折入其中）；
      //  · 128 卡小规格（单超节点量级）：tp2×pp4×dp16 = 128，EP8 折入 DP → 2 个 A2A 域。
      cfgFoot.appendChild(chipBtn('盘古ProMoE 8·5·100·2', () => api.setConfig({ tp: 8, pp: 5, dp: 100, ep: 2 })));
      cfgFoot.appendChild(chipBtn('128卡 2·4·16·8', () => api.setConfig({ tp: 2, pp: 4, dp: 16, ep: 8 })));
    }
    function refresh2D() { reScale(); recolor(); renderPill(); renderLegend(); syncChrome(); }

    /* ── 交互：悬停 tooltip / 点选 / 拖拽旋转（任何视角，正交下转回 3D）/ 滚轮缩放 ── */
    const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
    function aimAt(ev) {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(mouse, camera);
    }
    function pick(ev) {
      aimAt(ev);
      const hit = ray.intersectObject(chips)[0];
      return hit && hit.instanceId != null ? hit.instanceId : null;
    }
    /* 连线也可点选（C 档挂点）：命中哪根管 → 再按命中点就近判定是这根折线的哪一段，
       于是拿到「谁 → 谁、哪一维、哪种原语、跨了哪层物理链路」。宿主可据此去点亮
       自己那套物理路径（本 pattern 不搬运物理拓扑几何）。 */
    const _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3(), _ab = new THREE.Vector3(), _ap = new THREE.Vector3();
    function segDist(a, b, p) {
      _ab.copy(b).sub(a); _ap.copy(p).sub(a);
      const l2 = _ab.lengthSq();
      const t = l2 ? Math.max(0, Math.min(1, _ap.dot(_ab) / l2)) : 0;
      return _p2.copy(a).addScaledVector(_ab, t).distanceTo(p);
    }
    function pickEdge(ev) {
      if (!S.wire.lines || S.sel == null) return null;
      aimAt(ev);
      const hits = ray.intersectObjects(commGroupG.children, false);
      const hit = hits.find((h) => h.object.userData.edge);
      if (!hit) return null;
      const meta = hit.object.userData.edge, rs = meta.ranks;
      const gp = (r) => _p1.set(cur[r * 3], cur[r * 3 + 1], cur[r * 3 + 2]).clone();
      let bi = 1, bd = Infinity;
      for (let i = 1; i < rs.length; i++) {
        const d = segDist(gp(rs[i - 1]), gp(rs[i]), hit.point);
        if (d < bd) { bd = d; bi = i; }
      }
      const a = rs[bi - 1], b = rs[bi];
      return {
        dim: meta.dim, from: a, to: b,
        prim: primOf(meta.dim), algo: algoOf(meta.dim),
        tier: model.tierOf(a, b),
        hosts: [model.hostOf(a), model.hostOf(b)],
        pods: [model.podOf(a), model.podOf(b)],
        distance: hit.distance,
      };
    }
    const TIER_LAB = { ub: '同机 UB', rail: 'Pod 内跨机 rail', out: '跨 Pod Scale-Out' };
    let drag = null;
    renderer.domElement.addEventListener('pointerdown', (ev) => { drag = { x: ev.clientX, y: ev.clientY, moved: false }; });
    global.addEventListener('pointerup', () => { drag = null; });
    renderer.domElement.addEventListener('pointermove', (ev) => {
      if (drag && (ev.buttons & 1)) {
        const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        // 任何视角拖动都是旋转：正交 顶/前/侧 下拖动 → 从当前朝向无缝转回 3D（轴测态）
        if (S.view !== 0 && drag.moved) {
          if (S.view === 1) cam.phi = 1.35;                                    // 顶 → 近俯视起步
          else { cam.phi = 0.14; cam.theta = S.view === 2 ? Math.PI / 2 : 0; } // 前/侧 → 对应方位起步
          S.view = 0;
          applyAxVisibility(); refresh2D(); renderPill();
        }
        cam.theta += dx * 0.006;
        cam.phi = Math.max(0.08, Math.min(1.45, cam.phi + dy * 0.005));
        drag.x = ev.clientX; drag.y = ev.clientY;
        return;
      }
      const r = pick(ev);
      const e = r == null ? pickEdge(ev) : null;      // 卡优先；没命中卡再看连线
      S.hover = r;
      const showTip = (html) => {
        const rc = root.getBoundingClientRect();
        tipEl.style.display = 'block';
        tipEl.style.left = (ev.clientX - rc.left + 14) + 'px';
        tipEl.style.top = (ev.clientY - rc.top + 12) + 'px';
        tipEl.innerHTML = html;
      };
      if (r != null) {
        const st = model.ppOf(r), lr = model.stageLayerRange(st);
        showTip(`rank ${r} · TP${model.tpOf(r)} PP${st}(L${lr.lo}-${lr.hi}) DP${model.repOf(r)} · 桶${model.epOf(r)} 域${model.domOf(r)}`);
      } else if (e) {
        showTip(`${e.dim} ${e.prim} · rank ${e.from} → ${e.to} · <span style="color:${tierc(e.tier)}">${TIER_LAB[e.tier]}</span>`);
      } else tipEl.style.display = 'none';
    });
    renderer.domElement.addEventListener('pointerleave', () => { S.hover = null; tipEl.style.display = 'none'; });
    renderer.domElement.addEventListener('click', (ev) => {
      if (drag && drag.moved) return;
      const r = pick(ev);
      if (r == null) {
        const e = pickEdge(ev);
        if (e) { api.selectEdge(e); return; }      // 点在连线上 → 只报边，不动选中的卡
      }
      api.select(r == null ? null : r);
    });
    renderer.domElement.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      cam.half = Math.max(4, Math.min(220, cam.half * (ev.deltaY > 0 ? 1.1 : 0.9)));
    }, { passive: false });

    /* ── 主循环 ── */
    let raf = 0, lastRecolor = -1, lastMs = null, lastTimeUi = -1, lastPhase = -1, lastSettling = false;
    function frame(nowMs) {
      raf = global.requestAnimationFrame(frame);
      // 累加制时钟：时间轴游标可拖动定位（绝对时钟会把拖动的 S.t 覆盖掉）
      const dt = lastMs == null ? 0 : (nowMs - lastMs) / 1000;
      lastMs = nowMs;
      if (S.playing) S.t = (S.t + Math.min(dt, 0.1) / STEP_SEC) % 1;   // t ∈ [0,1) = 一个 step 内的位置
      // 状态热力随阶段流动（280ms 重染一次；透镜/异常静态无需重染）
      if (S.playing && S.colorBy === 'load' && S.anom === 'none' && nowMs - lastRecolor > 280) { lastRecolor = nowMs; recolor(); }
      if (S.playing && nowMs - lastTimeUi > 200) {
        lastTimeUi = nowMs;
        const ph = phaseIdx(); syncTimeUI();
        if (ph !== lastPhase) { lastPhase = ph; renderHud(); renderLegend(); renderInfo(); rebuildComm(); }   // 换阶段 → 主导维/图例/信息卡随之切换
      }
      // 重排飞行期间标注降一档不透明度（结束后恢复）：飞行中卡在动、标注还在原位，
      // 满不透明的字牌会看着像卡在半空的贴纸。
      if (settling !== lastSettling) {
        lastSettling = settling;
        axGroup.traverse((o) => {
          const m = o.material;
          if (!m || m.opacity == null) return;
          if (m.userData.baseOp == null) m.userData.baseOp = m.opacity;
          m.opacity = m.userData.baseOp * (settling ? 0.45 : 1);
        });
      }
      /* 位置飞行（切形态重排动画；稳定后停写省 CPU）。
         用「按时间」的缓动而不是「按帧」的固定系数：4000 卡时每帧要写 4000 个矩阵、
         还要重建连线，帧率掉到 10fps 上下——固定 0.14/帧 就变成了要飞好几秒，而且
         期间卡与线都停在半路，看上去就像「线没连到卡上」。
         收尾一律精确吸附（cur = target），杜绝残留误差。 */
      if (settling) {
        const k = dt > 0 ? 1 - Math.pow(0.0015, Math.min(dt, 0.25) / 0.5) : 1;   // 0.5s 走完 99.85%
        let moving = false;
        for (let r = 0; r < N; r++) {
          const i = r * 3;
          for (let c = 0; c < 3; c++) {
            const d = target[i + c] - cur[i + c];
            if (Math.abs(d) > 0.004) { cur[i + c] += d * k; moving = true; }
            else cur[i + c] = target[i + c];                                     // 到位就吸附
          }
          dummy.position.set(cur[i], cur[i + 1], cur[i + 2]);
          dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(scl[r]); dummy.updateMatrix();
          chips.setMatrixAt(r, dummy.matrix);
        }
        chips.instanceMatrix.needsUpdate = true;
        if (S.sel != null) { rebuildComm(); if (S.selEdge) drawSelEdge(); }   // 通信线/对端/选中边随重排飞行
        if (!moving) settling = false;
      }
      // 焦点/悬停框跟随实时位置
      const place = (box, r) => {
        if (r == null || r < 0 || r >= N) { box.visible = false; return; }
        box.visible = true; box.position.set(cur[r * 3], cur[r * 3 + 1], cur[r * 3 + 2]);
      };
      place(hovBox, S.hover === S.sel ? null : S.hover);
      updateSelFx(nowMs);
      updateMovers();
      applyCamera();
      renderer.render(scene, camera);
    }

    /* ── 尺寸 ── */
    function resize() {
      const w = stageEl.clientWidth || 800, h = stageEl.clientHeight || 600;
      renderer.setSize(w, h);
      syncBarH();                 // 顶栏换行会变高，抽屉与右上角的卡都靠这个变量让位
      fitView();
    }
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(stageEl);

    /* ── 对外 API ── */
    const api = {
      get model() { return model; }, state: S,
      // 自由改并行度：整体重建（校验 ep 整除 dp、rank 上限），布局/轴标/图例/HUD 全部跟随新配置
      setConfig(cfg) {
        let next;
        try { next = createModel(Object.assign({}, model.config, cfg || {})); }
        catch (e) { return { ok: false, error: e.message.replace(/^rubik-cube: /, '') }; }
        if (next.N > 65536) return { ok: false, error: `rank = ${next.N} 超出渲染上限 65536` };
        model = next; syncDims();
        S.sel = null; S.hover = null; S.sliceVal = 0;
        buildField();
        clearComm(); peerMeshes.forEach((m2) => { m2.geometry.setDrawRange(0, 0); m2.visible = false; });
        fitView(); renderAxes(); applyAxVisibility(); fitView(); updateSlab();
        refresh2D(); renderPill();
        renderHud(); renderLegend(); renderInfo(); syncCfgUI();
        return { ok: true, ranks: model.N };
      },
      setMode(m) {
        S.mode = Math.max(0, Math.min(model.modes.length - 1, m | 0));
        // 收编后的形态只允许自己声明的视角；正交下切过去自动落回轴测
        if (!(model.modes[S.mode].views || [0, 1, 2, 3]).includes(S.view)) S.view = 0;
        retarget(); fitView(); renderAxes(); applyAxVisibility(); fitView(); updateSlab();
        renderHud(); renderPill(); syncChrome(); refresh2D();
      },
      setView(v) {
        if (!(model.modes[S.mode].views || [0, 1, 2, 3]).includes(v | 0)) return;
        // 点「轴测」= 回到标准等距机位（拖歪之后也能一键复位，按钮在任何时候都有反馈）
        if ((v | 0) === 0) { cam.theta = ISO.theta; cam.phi = ISO.phi; }
        S.view = v | 0; fitView(); applyAxVisibility(); fitView(); refresh2D(); renderPill();
      },
      setSlice(on, val) { S.sliceOn = !!on; if (val != null) S.sliceVal = val | 0; refresh2D(); },
      setColorBy(k) { S.colorBy = k; recolor(); renderLegend(); syncChrome(); },
      setAnomaly(k) { S.anom = k; recolor(); renderHud(); renderLegend(); syncChrome(); },
      select(r) {
        S.sel = r;
        if (S.selEdge) { S.selEdge = null; drawSelEdge(); if (opts.onSelectEdge) opts.onSelectEdge(null); }
        rebuildComm(); refreshFocus(); renderInfo(); syncChrome();
        if (opts.onSelect) {
          opts.onSelect(r == null ? null : {
            rank: r, tp: model.tpOf(r), pp: model.ppOf(r), rep: model.repOf(r),
            bucket: model.epOf(r), domain: model.domOf(r), stage: model.stageLayerRange(model.ppOf(r)),
          });
        }
      },
      /* C 档挂点：选中一条通信边 → 回调宿主（例如驾驶舱据此点亮对应的物理链路），
         同时在场景里把这一段加粗高亮。传 null 取消。 */
      selectEdge(e) {
        S.selEdge = e || null;
        drawSelEdge();
        if (opts.onSelectEdge) opts.onSelectEdge(S.selEdge);
        renderInfo();
        return S.selEdge;
      },
      selectLayer(l) { S.selLayer = l; updateSlab(); syncChrome(); },            // 整网图 → 魔方水平切片
      selectBucket(e) {                                                        // 专家图 → 整面墙（切 EP 聚簇并选中桶内代表卡）
        if (e == null) { api.select(null); return; }
        api.setMode(2); api.select(model.rankOf(0, 0, (e | 0) % EP));
      },
      setTheme(theme) {
        S.theme = theme === 'light' ? 'light' : 'dark';
        root.setAttribute('data-theme', S.theme);
        readTokens();                     // 色卡随主题重解析
        applySceneBg();
        renderAxes(); applyAxVisibility(); fitView(); recolor(); rebuildComm(); renderLegend(); renderHud();
      },
      setPlaying(p) { S.playing = !!p; syncChrome(); },
      // 连线图层开关（可全关）与集合算法
      setWire(w) {
        Object.assign(S.wire, w || {});
        if (!S.wire.movers) moverMeshes.forEach((m) => { m.visible = false; });
        rebuildComm(); refreshFocus(); renderInfo(); syncChrome();
      },
      // 物理落位（B 档）：每机卡数 / 每 Pod 机数，或 slots 数组做任意 rank→槽位映射
      setPlacement(pl) {
        const keep = S.sel;        // 只是换装机方式，逻辑魔方没变 → 选中的卡不该被清掉
        const res = api.setConfig({ placement: Object.assign({}, model.config.placement, pl || {}) });
        if (res.ok && keep != null && keep < model.N) api.select(keep);
        return res;
      },
      setAlgo(a) { S.algo = a === 'tree' ? 'tree' : a === 'ring' ? 'ring' : 'auto'; rebuildComm(); renderLegend(); syncChrome(); },
      // 定位到 step 内的某个位置（0→1）或某个阶段：t 可传 0..1，或 {phase:'EP'}
      setTime(t) {
        const v = (t && typeof t === 'object' && t.phase)
          ? (Math.max(0, PHASES.findIndex((p) => p.id === t.phase)) + 0.5) / PHASES.length
          : Math.min(0.999, Math.max(0, +t || 0));
        S.t = v;
        recolor(); rebuildComm(); syncTimeUI(); renderHud(); renderLegend(); renderInfo();
        return { t: S.t, phase: PHASES[phaseIdx()].id };
      },
      phases: PHASES,
      scene, camera,               // 只读挂点：宿主联动与自动化校验（连线端点是否落在卡心）用
      resize,
      destroy() {
        global.cancelAnimationFrame(raf);
        if (ro) ro.disconnect();
        clearComm(); clearAxes();
        renderer.dispose();
        root.remove();
      },
    };

    /* ── 启动 ── */
    // 场景底色 = 设计系统的 --background（同页面外壳，明暗由 token 层切换）
    function applySceneBg() {
      let c = '';
      try { c = getComputedStyle(root).getPropertyValue('--background').trim(); } catch (e) { /* noop */ }
      scene.background = new THREE.Color(c || (isDark() ? '#101010' : '#F5F5F5'));
    }
    applySceneBg();
    resize(); fitView(); renderAxes(); applyAxVisibility(); fitView(); updateSlab();
    recolor(); renderHud(); renderPill(); renderLegend(); renderInfo(); syncChrome(); syncCfgUI(); syncTimeUI();
    raf = global.requestAnimationFrame(frame);
    return api;
  }

  global.PtoRubikCubePattern = { version: '0.2.0', DEFAULTS, DIM_TOKEN, GROUP_TOKENS, createModel, mount };
})(typeof window !== 'undefined' ? window : this);

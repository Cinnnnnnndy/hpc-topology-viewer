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
    hotBuckets: [0, 2],    // 示意热点专家桶（★）
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
    '--warning', '--danger', '--accent', '--font-sans',
    '--highlight-copy-blue-400', '--highlight-accum-orange-400', '--highlight-l0a-violet-400',
    '--highlight-ub-green-400', '--highlight-mte-amber-400', '--highlight-l0b-deep-violet-400',
    '--highlight-copy-blue-600', '--highlight-accum-orange-600', '--highlight-l0a-violet-600',
    '--highlight-ub-green-600', '--highlight-mte-amber-600', '--highlight-l0b-deep-violet-600',
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
  // 分组着色调色板：highlight 六族 400 档 → 再接 600 档（相邻组尽量不同族，色相差最大）
  const GROUP_TOKENS = [
    '--highlight-copy-blue-400', '--highlight-accum-orange-400', '--highlight-l0a-violet-400',
    '--highlight-ub-green-400', '--highlight-mte-amber-400', '--highlight-l0b-deep-violet-400',
    '--highlight-copy-blue-600', '--highlight-accum-orange-600', '--highlight-l0a-violet-600',
    '--highlight-ub-green-600', '--highlight-mte-amber-600', '--highlight-l0b-deep-violet-600',
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
      // TP切片 / PP流水 是「强调类」形态（2D 已收编到标准）：主轴用 emph 层级拉开，
      // 强调「墙拉开查同槽位 / 段拉开找慢段」的读法，其余轴与标准同构。
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

    // 视角收编（方案 A）：每个 2D 平面只属于一个形态。标准/TP切片/PP流水 共享同一坐标系
    // （TP/PP/DP 三轴），三者的 顶/前/侧 两两重合——格阵三平面（DP×TP·TP×PP·DP×PP）由
    // 「标准」独占；TP切片/PP流水 只保留轴测（价值在 3D 的强调读法），note2d 指路。
    // DP平铺/EP聚簇 引入新分组轴，三个 2D 平面均独有，全保留。
    const D_STD = { 1: ['pp'], 2: ['rep'], 3: ['tp'] };   // 视角 → 被折进视线的维（可多个）
    const NOTE_2D = '正交 2D 与「标准」形态重合 → 格阵平面到标准里看';
    const modes = [
      {
        key: 'std', name: '标准',
        sub: `标准 X=TP Y=PP(模型深度) Z=DP`,
        why: `位置即多维坐标：X=TP·Y=PP·Z=DP 同屏三维 · 着色透镜再叠第 4 维（换形态只换投影轴）`,
        viewLabels: { 1: '顶 DP×TP', 2: '前 TP×PP', 3: '侧 DP×PP' }, depth: D_STD,
        views: [0, 1, 2, 3],
      },
      {
        key: 'dpt', name: 'DP平铺',
        sub: `DP 平铺：${REP} 副本各自成板（找慢副本）`,
        why: `副本间只在步末做梯度 AllReduce · 发暗/掉队的那块板 = 慢副本`,
        viewLabels: { 1: '顶 副本网格', 2: '前 列×PP', 3: '侧 行×PP' },
        // 板内 TP 折成「列×排」后板有了厚度：顶视每个副本是一片瓦（而非一条线），
        // 侧视也不再塌陷 → 三个正交视角都成立。
        depth: { 1: ['pp'], 2: ['gz', 'tpd'], 3: ['gx', 'tpc'] },
        views: [0, 1, 2, 3],
      },
      {
        key: 'ep', name: 'EP聚簇',
        sub: `EP 聚簇：${EP} 专家桶成墙（桶=MoE 组 · 每桶复现于 ${DOM} 个 A2A 域 · 桶↔卡非 1:1）`,
        why: `桶故障 = 整面墙同红 · 域热点 = 横穿 ${EP} 墙的一排过热 · 桶↔卡非 1:1`,
        viewLabels: { 1: '顶 桶×域', 2: '前 桶×PP', 3: '侧 域×PP' },
        depth: { 1: ['pp'], 2: ['dom'], 3: ['ep', 'tp'] },   // 侧视同时折叠墙序与墙内 TP（域数多，仍成阵）
        views: [0, 1, 2, 3],
      },
      {
        key: 'tps', name: 'TP切片',
        sub: `TP 切片：${TP} 片权重墙 · 一面墙=全集群同槽位切片（查同槽位系统性故障）`,
        why: `同槽位系统性故障（整批同号卡坏件）= 一面墙集体异常`,
        viewLabels: { 1: '顶 DP×TP', 2: '前 TP×PP', 3: '侧 DP×PP' }, depth: D_STD,
        views: [0], note2d: NOTE_2D,
      },
      {
        key: 'ppf', name: 'PP流水',
        sub: `PP 流水：${PP} 段横向展开 · 左=Stage0 右=Stage${PP - 1}（找慢段/气泡）`,
        why: `只有 PP 适合说「哪段层在哪」· ${PP} 段各 ${LPS} 层 · 慢段拖住下游 = 右侧板变暗 · 空档=bubble`,
        viewLabels: { 1: '顶 DP×PP', 2: '前 PP×TP', 3: '侧 DP×TP' },
        depth: { 1: ['tp'], 2: ['rep'], 3: ['pp'] },
        views: [0], note2d: NOTE_2D,
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
      colorBy: 'load',               // load | tp | pp | dp | ep
      anom: 'none',                  // none | tp | pp | dp | ep（异常注入 → 「异常的形状」）
      playing: true,
      theme: opts.theme === 'light' ? 'light' : 'dark',
      sel: null, hover: null,        // 选中/悬停 rank
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
    const groupColor = (i) => tokHex(GROUP_TOKENS[i % GROUP_TOKENS.length]);

    /* ── DOM 骨架 ── */
    const root = document.createElement('div');
    root.className = 'prc-root';
    root.setAttribute('data-theme', S.theme);
    root.innerHTML = [
      '<div class="prc-stage"></div>',
      opts.chrome === false ? '' : [
        '<div class="prc-topbar panel-shell">',
        '  <div class="prc-row prc-row-modes"><span class="prc-lab">形态</span></div>',
        '  <div class="prc-row prc-row-views"><span class="prc-lab">视角</span></div>',
        '  <div class="prc-row prc-row-lens"><span class="prc-lab">着色</span></div>',
        '  <div class="prc-row prc-row-anom"><span class="prc-lab">注入</span></div>',
        '  <div class="prc-row prc-row-time"><span class="prc-lab">时间</span></div>',
        '  <div class="prc-row prc-row-cfg"><span class="prc-lab">并行</span></div>',
        '</div>',
        '<div class="prc-hud panel-shell"></div>',
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
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dl = new THREE.DirectionalLight(0xffffff, 0.55); dl.position.set(18, 30, 12); scene.add(dl);

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
      const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.15, 0.85, 0.55));
      return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false }));
    }
    const selBox = edgeBox(0xffffff), hovBox = edgeBox(0x9ecbff);
    selBox.visible = hovBox.visible = false; selBox.renderOrder = hovBox.renderOrder = 7;
    scene.add(selBox, hovBox);

    // 四维通信组高亮：每维一个半透明盒 InstancedMesh（维度签名色）
    const PEER_MAX = 64;
    const peerDims = ['TP', 'PP', 'DP', 'EP'];
    const peerMeshes = peerDims.map((d) => {
      const m = new THREE.InstancedMesh(new THREE.BoxGeometry(1.25, 0.95, 0.62),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(dimc(d)), transparent: true, opacity: 0.34, depthWrite: false, depthTest: false }), PEER_MAX);
      m.renderOrder = 5; m.count = 0; m.visible = false; scene.add(m);
      return m;
    });
    // 通信线（TubeGeometry 曲线 + 标签）——穿透方块可见
    const commGroupG = new THREE.Group(); scene.add(commGroupG);
    function clearComm() {
      while (commGroupG.children.length) {
        const o = commGroupG.children.pop();
        if (o.geometry) o.geometry.dispose();
        if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
      }
    }
    function commLine(points, color, opacity, r) {
      if (points.length < 2) return;
      const curve = new THREE.CatmullRomCurve3(points);
      const g = new THREE.TubeGeometry(curve, Math.max(6, points.length * 3), r || 0.08, 6, false);
      const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: false });
      const mesh = new THREE.Mesh(g, m); mesh.renderOrder = 6;
      commGroupG.add(mesh);
    }

    /* ── 字牌（高分辨率圆角 label，随主题）── */
    function makeLabel(text, color, w) {
      const SS = 4, fontPx = 44, padX = 22, padY = 11;
      // 字体取自设计系统的 --font-sans（3D 字牌是 canvas 绘制，需具体字体栈）
      const FONT = `700 ${fontPx}px ${TOK['--font-sans'] || "'Inter','Source Han Sans SC','PingFang SC',sans-serif"}`;
      const meas = document.createElement('canvas').getContext('2d');
      meas.font = FONT;
      const tw = Math.ceil(meas.measureText(text).width) + padX * 2, th = fontPx + padY * 2;
      const cv = document.createElement('canvas'); cv.width = tw * SS; cv.height = th * SS;
      const c = cv.getContext('2d'); c.scale(SS, SS);
      const light = !isDark();
      // 字牌底 = --surface-1（略透以透出场景）· 描边 = --border-strong（均来自设计系统）
      const plate = tokRGB('--surface-1', light ? '#FFFFFF' : '#161616');
      c.fillStyle = `rgba(${Math.round(plate.r * 255)},${Math.round(plate.g * 255)},${Math.round(plate.b * 255)},0.94)`;
      const rr = th * 0.38;
      c.beginPath(); c.roundRect(1, 1, tw - 2, th - 2, rr); c.fill();
      c.lineWidth = 2; c.strokeStyle = tokHex('--border-strong');
      c.beginPath(); c.roundRect(1, 1, tw - 2, th - 2, rr); c.stroke();
      let fill = color;
      if (light) {
        const tc = new THREE.Color(color), hsl = {}; tc.getHSL(hsl);
        tc.setHSL(hsl.h, Math.min(1, hsl.s * 1.1), Math.min(hsl.l, 0.28)); fill = '#' + tc.getHexString();
      }
      c.font = FONT; c.fillStyle = fill; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(text, tw / 2, th / 2);
      const tex = new THREE.CanvasTexture(cv);
      tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = true;
      try { tex.anisotropy = renderer.capabilities.getMaxAnisotropy(); } catch (e) { /* noop */ }
      tex.needsUpdate = true;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
      const worldW = w * tw / 512;
      sp.scale.set(worldW, worldW * th / tw, 1);
      return sp;
    }

    /* ── 轴标注（每形态一套：网格框 + 刻度 + 语义标注 + 关键结构线）── */
    const axGroup = new THREE.Group(); scene.add(axGroup);
    function clearAxes() {
      while (axGroup.children.length) {
        const o = axGroup.children.pop();
        if (o.geometry) o.geometry.dispose();
        if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
      }
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
    const D = (v) => v * Math.max(0.5, LS);
    // 长文案「读图横幅」（w≥5）只在轴测视图显示：正交 2D 取景很紧，横幅字牌（世界尺寸随文本
    // 长度膨胀）会盖满画面——2D 里只留短刻度标（TP0/DP127/层段标尺…），语义讲解交给 HUD。
    function axText(text, color, w, pos) {
      const l = makeLabel(text, color, w * 1.25 * LS);
      l.position.copy(pos);
      l.userData.banner = w >= 5;
      axGroup.add(l);
    }
    function applyAxVisibility() {
      axGroup.traverse((o) => { if (o.isSprite && o.userData.banner) o.visible = S.view === 0; });
    }
    function axSeg(pairs, color, opacity) {
      const g = new THREE.BufferGeometry().setFromPoints(pairs);
      axGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity })));
    }
    function axLine(a, b, colorHex, r) {
      const dir = b.clone().sub(a), len = dir.length();
      const geo = new THREE.CylinderGeometry(r || 0.07, r || 0.07, len, 8, 1);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.92 }));
      mesh.position.copy(a.clone().add(b).multiplyScalar(0.5));
      mesh.quaternion.setFromUnitVectors(V3(0, 1, 0), dir.normalize());
      axGroup.add(mesh);
    }
    function axArrow(a, b, colorHex) {
      axLine(a, b, colorHex, 0.07);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.8, 10),
        new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.92 }));
      cone.position.copy(b);
      cone.quaternion.setFromUnitVectors(V3(0, 1, 0), b.clone().sub(a).normalize());
      axGroup.add(cone);
    }
    // 大 3D 坐标网格框（底 XZ + 背 XY + 左 YZ 三张淡网格 + 描边棱线；floorOnly 只铺地面）
    function axGridBox(b, xt, yt, zt, floorOnly) {
      const hx = (c) => new THREE.Color(c).getHex();
      const grid = hx(tokHex('--border-default')), frame = hx(tokHex('--border-strong'));
      const gridOp = isDark() ? 0.42 : 0.6, frameOp = isDark() ? 0.85 : 0.95;
      const seg = [];
      xt.forEach((x) => { seg.push(V3(x, b.y0, b.z0), V3(x, b.y0, b.z1)); if (!floorOnly) seg.push(V3(x, b.y0, b.z0), V3(x, b.y1, b.z0)); });
      if (!floorOnly) yt.forEach((y) => { seg.push(V3(b.x0, y, b.z0), V3(b.x1, y, b.z0), V3(b.x0, y, b.z0), V3(b.x0, y, b.z1)); });
      zt.forEach((z) => { seg.push(V3(b.x0, b.y0, z), V3(b.x1, b.y0, z)); if (!floorOnly) seg.push(V3(b.x0, b.y0, z), V3(b.x0, b.y1, z)); });
      axSeg(seg, grid, gridOp);
      const E = floorOnly
        ? [[b.x0, b.y0, b.z0, b.x1, b.y0, b.z0], [b.x0, b.y0, b.z1, b.x1, b.y0, b.z1], [b.x0, b.y0, b.z0, b.x0, b.y0, b.z1], [b.x1, b.y0, b.z0, b.x1, b.y0, b.z1]]
        : [[b.x0, b.y0, b.z0, b.x1, b.y0, b.z0], [b.x0, b.y0, b.z1, b.x1, b.y0, b.z1], [b.x0, b.y0, b.z0, b.x0, b.y0, b.z1], [b.x1, b.y0, b.z0, b.x1, b.y0, b.z1],
        [b.x0, b.y0, b.z0, b.x0, b.y1, b.z0], [b.x1, b.y0, b.z0, b.x1, b.y1, b.z0], [b.x0, b.y0, b.z1, b.x0, b.y1, b.z1],
        [b.x0, b.y1, b.z0, b.x1, b.y1, b.z0], [b.x0, b.y1, b.z0, b.x0, b.y1, b.z1]];
      const fr = []; E.forEach((e) => fr.push(V3(e[0], e[1], e[2]), V3(e[3], e[4], e[5])));
      axSeg(fr, frame, frameOp);
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
        axGridBox(b, xL, yL, zL);
        axText('TP0', TPc, 1.6, V3(xT(0), b.y0 - D(1), b.z1 + D(1.4))); axText('TP' + (TP - 1), TPc, 1.6, V3(xT(TP - 1), b.y0 - D(1), b.z1 + D(1.4)));
        axText(`TP×${TP} 同一层切 ${TP} 片 · 层内 AllReduce`, TPc, 7, V3(0, b.y0 - D(2.6), b.z1 + D(3.2)));
        axText('DP0', DPc, 1.6, V3(b.x1 + D(1.6), b.y0 - D(1), zD(0))); axText('DP' + (REP - 1), DPc, 2, V3(b.x1 + D(1.8), b.y0 - D(1), zD(REP - 1)));
        axText(`DP×${REP} 完整副本 · 数据不同 · 梯度 AllReduce`, DPc, 8, V3(b.x1 + D(5), b.y0 - D(2.6), 0));
        axArrow(V3(b.x0 - D(1.5), b.y1, b.z0), V3(b.x0 - D(1.5), b.y0, b.z0), PPw);
        axText(`PP×${PP} 模型深度 L1→L${model.config.layers} · 段间 P2P`, PPc, 7, V3(b.x0 - D(1.5), b.y1 + D(1.6), b.z0));
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
        axGridBox(b, xL, [], zL, true);
        R(COLS, (i) => axText('列' + i, DPc, 1.7, V3(b.x0 + (i + 0.5) * s.gapX, b.y0, b.z1 + D(1.8))));
        R(ROWS, (i) => axText('行' + i, DPc, 1.7, V3(b.x1 + D(2.2), b.y0, b.z0 + (i + 0.5) * s.gapZ)));
        axText('DP0', DPc, 1.8, pos(0, 0, 0).add(V3(0, 1.6, 0)));
        axText('DP' + (REP - 1), DPc, 2.1, pos(0, 0, REP - 1).add(V3(0, 1.6, 0)));
        axText(`DP 平铺 · ${REP} 块板 = ${REP} 份完整副本（副本号=行×${COLS}+列 · 参数相同 · 各吃不同数据）`, DPc, 11, V3(0, b.y1 + D(3.4), 0));
        const p00 = pos(0, PP - 1, 0), p10 = pos(TP - 1, PP - 1, 0), pTop = pos(0, 0, 0);
        axArrow(p00.clone().add(V3(-0.9, -0.8, 0)), p10.clone().add(V3(0.9, -0.8, 0)), TPw);
        axText(model.TPD > 1 ? `板内 TP×${TP} = ${model.TPC}列×${model.TPD}排` : `板内横=TP×${TP}`,
          TPc, model.TPD > 1 ? 4.6 : 3.4, p00.clone().add(V3(0.6, -1.9, 0)));
        axArrow(pTop.clone().add(V3(-1.7, 0.4, 0)), p00.clone().add(V3(-1.7, -0.4, 0)), PPw);
        axText(`板内竖=PP×${PP} L1→L${model.config.layers}`, PPc, 4.6, pTop.clone().add(V3(0.4, 1.7, 0)));
      } else if (S.mode === 2) {
        const s = sp.ep;
        const bb = model.boundsOf(2);
        // X 网格 = 墙的格边界（同上，避免整体偏掉半个墙宽）；Z 网格线落在真实的域位置上
        // （域少则逐域画，域多则等间隔抽 5 条），不再是与内容无关的等分线。
        const xL = cellLines(EP, s.gapE, 0), yL = cellLines(PP, s.pp, s.cy), zL = cellLines(DOM, s.dom, 0, 9);
        const b = { x0: span1(xL).lo, x1: span1(xL).hi, y0: span1(yL).lo, y1: span1(yL).hi, z0: span1(zL).lo, z1: span1(zL).hi };
        axGridBox(b, xL, yL, zL);
        for (let e = 0; e < EP; e++) {
          const hot = model.hotBuckets.has(e);
          axText(`桶${e} ${model.expRange(e)}${hot ? '★' : ''}`, hot ? tokHex('--warning') : EPc, 3,
            V3((e - (EP - 1) / 2) * s.gapE, b.y1 + D(1.2) + (e % 2) * 1.1, 0));
        }
        axText(`${EP} 面墙 = ${EP} 个专家分桶（桶=MoE 组 · 同墙=同专家 · ★=热点）`, EPc, 10, V3(0, b.y1 + D(4.2), 0));
        const rowY = s.cy, rowZ = bb.z0;
        axLine(V3(b.x0, rowY, rowZ), V3(b.x1, rowY, rowZ), EPw, 0.07);
        axText(`1 个 A2A 域 = 横穿 ${EP} 面墙的同一排 · 每桶各出 1 员互发`, EPc, 9, V3(0, b.y0 - D(1.7), rowZ));
        axArrow(V3(b.x1 + D(1.4), b.y0 - D(0.5), bb.z0), V3(b.x1 + D(1.4), b.y0 - D(0.5), bb.z1), NTw);
        axText(`域0→域${DOM - 1}`, NTc, 2.8, V3(b.x1 + D(3.2), b.y0 - D(1.5), 0));
        axArrow(V3(b.x0 - D(1.4), b.y1, 0), V3(b.x0 - D(1.4), b.y0, 0), PPw);
        axText(`墙内竖=PP×${PP}`, PPc, 3.6, V3(b.x0 - D(1.4), b.y1 + D(1.3), 0));
      } else if (S.mode === 3) {
        const s = sp.tps, zD = (d) => (d - (REP - 1) / 2) * s.rep;
        const bb = model.boundsOf(3);
        const xL = cellLines(TP, s.gapT, 0), yL = cellLines(PP, s.pp, s.cy), zL = cellLines(REP, s.rep, 0, 9);
        const b = { x0: span1(xL).lo, x1: span1(xL).hi, y0: span1(yL).lo, y1: span1(yL).hi, z0: span1(zL).lo, z1: span1(zL).hi };
        axGridBox(b, xL, yL, zL);
        for (let t = 0; t < TP; t++) axText(`TP${t} 第${t + 1}/${TP}片`, TPc, 3, V3(bb.x0 + t * s.gapT, b.y1 + D(1.2) + (t % 2) * 1.1, 0));
        axText(`${TP} 面墙 = 每层权重的 ${TP} 个切片 · 一面墙 = 全网同槽位卡`, TPc, 9.5, V3(0, b.y1 + D(4.2), 0));
        const dots = R(TP, (t) => V3(bb.x0 + t * s.gapT, b.y1 + D(0.4), b.z0));
        for (let k = 0; k < TP - 1; k++) axLine(dots[k], dots[k + 1], TPw, 0.07);
        dots.forEach((p) => { const d = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshBasicMaterial({ color: TPw })); d.position.copy(p); axGroup.add(d); });
        axText(`同一 TP 组的 ${TP} 卡 → 分属 ${TP} 面墙 · 层内 AllReduce 拼回完整权重`, TPc, 9.5, V3(0, b.y1 + D(0.4), b.z0 - D(2.4)));
        axText('DP0', DPc, 1.6, V3(b.x1 + D(1.5), b.y0 - D(0.7), zD(0))); axText('DP' + (REP - 1), DPc, 2, V3(b.x1 + D(1.7), b.y0 - D(0.7), zD(REP - 1)));
        axArrow(V3(b.x0 - D(1.4), b.y1, 0), V3(b.x0 - D(1.4), b.y0, 0), PPw);
        axText(`墙内竖=PP×${PP}`, PPc, 3.6, V3(b.x0 - D(1.4), b.y1 + D(1.3), 0));
      } else {
        const s = sp.ppf, zD = (d) => (d - (REP - 1) / 2) * s.rep;
        const bb = model.boundsOf(4);
        const xL = cellLines(PP, s.gapP, 0), zL = cellLines(REP, s.rep, 0, 9);
        const b = { x0: span1(xL).lo, x1: span1(xL).hi, y0: bb.y0 - 0.8, y1: bb.y1 + 0.8, z0: span1(zL).lo, z1: span1(zL).hi };
        axGridBox(b, xL, [], zL, true);
        for (let st = 0; st < PP; st++) {
          const lr = model.stageLayerRange(st);
          axText(`S${st} L${lr.lo}-${lr.hi}`, PPc, 3.2, V3(bb.x0 + st * s.gapP, b.y1 + D(1.6), 0));
        }
        axArrow(V3(b.x0, b.y1 + D(3.4), 0), V3(b.x1, b.y1 + D(3.4), 0), PPw);
        axText(`前向激活 →（反向梯度 ←）· 段间 P2P · 每段=连续 ${LPS} 层`, PPc, 9, V3(0, b.y1 + D(4.9), 0));
        axText('DP0', DPc, 1.6, V3(b.x1 + D(1.6), b.y0 - D(0.5), zD(0))); axText('DP' + (REP - 1), DPc, 2, V3(b.x1 + D(1.8), b.y0 - D(0.5), zD(REP - 1)));
        axArrow(V3(b.x0 - D(1.6), b.y1, b.z0), V3(b.x0 - D(1.6), b.y0, b.z0), hx(TPc));
        axText(`段内竖=TP×${TP}`, TPc, 3.4, V3(b.x0 - D(1.6), b.y1 + D(1.3), b.z0));
      }
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
    function colorOfRank(r) {
      if (S.anom !== 'none') {
        if (inAnomGroup(r)) return cTmp.set(tokHex('--danger'));
        return loadColor(0.16 + rng(r * 3.1) * 0.1);
      }
      if (S.colorBy !== 'load') {
        const g = S.colorBy === 'tp' ? model.tpOf(r) : S.colorBy === 'pp' ? model.ppOf(r)
          : S.colorBy === 'dp' ? model.repOf(r) : model.epOf(r);
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
    function recolor() {
      for (let r = 0; r < N; r++) {
        colorOfRank(r);
        if (ghosted(r)) cTmp.multiplyScalar(isDark() ? 0.22 : 0.55).lerp(new THREE.Color(isDark() ? 0x0d1117 : 0xf6f8fa), 0.35);
        chips.setColorAt(r, cTmp);
      }
      if (chips.instanceColor) chips.instanceColor.needsUpdate = true;
    }
    function reScale() { let dirty = false; for (let r = 0; r < N; r++) { const want = ghosted(r) ? 0.3 : 1; if (scl[r] !== want) { scl[r] = want; dirty = true; } } if (dirty) settling = true; }

    /* ── 相机：轴测（等距可旋转）+ 顶/前/侧 正交锁轴（拖动即转回 3D），取景随形态包围盒 ── */
    // 等距轴测（isometric）的标准机位：方位 45°、仰角 asin(tan30°) ≈ 35.26°
    // —— 三根世界轴等比缩短、互成 120°，这才是「轴测」该有的样子。
    const ISO = { theta: Math.PI / 4, phi: Math.asin(Math.tan(Math.PI / 6)) };
    const cam = { theta: ISO.theta, phi: ISO.phi, half: 30, cx: 0, cy: 8, cz: 0, panX: 0, panY: 0 };
    function fitView() {
      const b = model.boundsOf(S.mode);
      // 轴标注留白随模型尺度自适应（固定留白会让小规格模型只占画面一小块）
      const span = Math.max(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0);
      const mx = Math.min(8, Math.max(1.6, span * 0.1));
      // 半尺寸 = rank 中心包围盒 + 卡块自身半尺寸（包围盒只含中心点）+ 标注留白
      const ex = (b.x1 - b.x0) / 2 + CARD.x / 2 + mx;
      const ey = (b.y1 - b.y0) / 2 + CARD.y / 2 + mx * 0.6;
      const ez = (b.z1 - b.z0) / 2 + CARD.z / 2 + mx;
      cam.cx = (b.x0 + b.x1) / 2; cam.cy = (b.y0 + b.y1) / 2; cam.cz = (b.z0 + b.z1) / 2;
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
      const bx = br ? Math.min(0.18, (br.width / w) * 0.3) : 0;
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
    function rebuildComm() {
      clearComm();
      peerMeshes.forEach((m) => { m.count = 0; m.visible = false; });
      if (S.sel == null) return;
      const gp = (r) => V3(cur[r * 3], cur[r * 3 + 1], cur[r * 3 + 2]);
      peerDims.forEach((d, di) => {
        const members = model.commGroup(S.sel, d);
        const mesh = peerMeshes[di];
        let n = 0;
        members.forEach((r) => { if (r !== S.sel && n < PEER_MAX) { dummy.position.copy(gp(r)); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); mesh.setMatrixAt(n++, dummy.matrix); } });
        mesh.count = n; mesh.visible = n > 0; mesh.instanceMatrix.needsUpdate = true;
        const colorHex = new THREE.Color(dimc(d)).getHex();
        const pts = members.map(gp);
        // 当前阶段主导的维加亮加粗，其余淡显——四维通信组始终同屏，谁在此刻真正忙一眼可见
        // 四维一律清晰可见（都是这张卡真实的通信组），当前阶段主导的那一维再加一档
        // 亮度与粗细作为「此刻」的强调。对比不能拉太大——否则非主导维看着像没画出来。
        const on = PHASES[phaseIdx()].dim === d;
        const op = on ? 0.95 : 0.55, rad = (on ? 1.15 : 0.85) * (d === 'TP' ? 0.1 : 0.07);
        mesh.material.opacity = on ? 0.5 : 0.32;
        if (d === 'EP') { pts.forEach((p) => { if (!p.equals(gp(S.sel))) commLine([gp(S.sel), p], colorHex, op, rad * 0.9); }); }   // A2A 互发（星形）
        else commLine(pts, colorHex, op, rad);   // TP 环 / PP 链 / DP 采样折线
      });
      const selP = gp(S.sel);
      const lab = makeLabel(`TP×${TP} · PP链×${PP} · DP采样${Math.min(16, REP)}/${REP} · A2A×${EP} · 加亮=此刻 ${PHASES[phaseIdx()].dim}`, tokHex('--foreground-secondary'), 7.6 * LS);
      lab.position.copy(selP.clone().add(V3(0, 2 + 1.2 * LS, 0))); lab.renderOrder = 7; commGroupG.add(lab);
    }

    /* ── HUD / 图例 / 粒度贴士 / 信息卡 ── */
    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
    function renderHud() {
      const hud = $('.prc-hud'); if (!hud) return;
      const m = model.modes[S.mode];
      const anomNote = {
        none: '',
        tp: `注入 TP 槽 0：全网同槽位卡集体标红 → 切「TP切片」= 一面墙集体异常（同槽位系统性坏件的形状）`,
        pp: `注入 PP 级 0：物理上散成条纹 → 切「PP流水」= 最左一整段全红（慢段/坏段的形状）`,
        dp: `注入 DP 副本 0：切「DP平铺」= 宫格里干净的一块板全红（慢副本的形状）`,
        ep: `注入 EP 桶 ${anomBucket()}：标准形态下是周期条带 → 切「EP聚簇」= 一整面墙同红（热点/坏桶的形状 · 桶↔卡非 1:1）`,
      }[S.anom];
      const ph = PHASES[phaseIdx()];
      hud.innerHTML = `<b>逻辑魔方 · ${esc(m.sub)}</b>${S.selLayer != null && S.mode === 0 ? ` · 高亮 L${S.selLayer + 1} 切片` : ''}` +
        `<br><span class="prc-dim">${ICON.key} 为什么这样摆：${esc(m.why)}</span>` +
        `<br><span class="prc-dim">${ICON.clock} 此刻（step 内 ${Math.round(S.t * 100)}%）：<b style="color:${dimc(ph.dim)}">${esc(ph.name)}</b> · ${esc(ph.bus)}</span>` +
        (anomNote ? `<br><span class="prc-warn">${ICON.alert} ${esc(anomNote)}</span>` : '');
    }
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
    function renderLegend() {
      const lg = $('.prc-legend'); if (!lg) return;
      const chip = (c, t) => `<span><i style="background:${c}"></i>${esc(t)}</span>`;
      const parts = [];
      if (S.anom !== 'none') {
        const what = { tp: `TP 槽 0（全网同槽位卡）`, pp: `PP 级 0（一整个流水段）`,
          dp: `DP 副本 0（一份完整拷贝）`, ep: `EP 桶 ${anomBucket()}（持有该桶的所有 rank）` }[S.anom];
        parts.push(`<b>卡块着色</b>`, chip('var(--danger)', `异常组 = ${what}`), chip(rgbCss(loadColor(0.2)), '其余（平静）'));
      } else if (S.colorBy === 'load') {
        parts.push(`<b>卡块着色</b>`, `<span class="prc-ramp"><i></i>负载 低→高 · 当前阶段 ${esc(PHASES[phaseIdx()].id)}</span>`);
      } else {
        const key = S.colorBy;
        const n = key === 'tp' ? TP : key === 'pp' ? PP : key === 'dp' ? REP : EP;
        const lab = { tp: 'TP', pp: 'PP', dp: 'DP副本', ep: 'EP桶' }[key];
        const MAXC = 8, shown = Math.min(n, MAXC);
        parts.push(`<b>卡块着色 · 按 ${esc(lab)} 分组</b>`);
        for (let i = 0; i < shown; i++) parts.push(chip(groupColor(i), `${lab}${i}`));
        if (n > shown) parts.push(`<span class="prc-dim">… 共 ${n} 组${n > GROUP_TOKENS.length ? `（${GROUP_TOKENS.length} 色循环，同色非同组）` : ''}</span>`);
      }
      // 图例只解释「卡块的颜色」。维度签名色（轴标注、通信组线框）不画在卡上，
      // 因此不进图例——否则同一个维度会以两套颜色出现，读者对不上。
      lg.innerHTML = parts.join('');
    }
    function renderInfo() {
      const info = $('.prc-info'); if (!info) return;
      if (S.sel == null) { info.classList.remove('show'); info.innerHTML = ''; return; }
      const r = S.sel, st = model.ppOf(r), lr = model.stageLayerRange(st), e = model.epOf(r);
      info.classList.add('show');
      info.innerHTML = `<b>rank ${r}</b> / ${N}` +
        `<br><span style="color:${dimc('TP')}">TP${model.tpOf(r)}</span> · ` +
        `<span style="color:${dimc('PP')}">PP${st}（S${st}·L${lr.lo}-${lr.hi}）</span> · ` +
        `<span style="color:${dimc('DP')}">DP副本${model.repOf(r)}</span>` +
        `<br><span style="color:${dimc('EP')}">EP桶${e}（${model.expRange(e)}）· A2A域${model.domOf(r)}</span>` +
        `<br><span class="prc-dim">四维通信组同屏高亮 · <b style="color:${dimc(PHASES[phaseIdx()].dim)}">${PHASES[phaseIdx()].dim}</b> 加亮=此刻主导 · 再点空白处取消</span>`;
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
    };
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
    let timeTrack = null, timeHead = null, timeLab = null, viewNote = null;
    function syncTimeUI() {
      if (!timeTrack) return;
      const pi = phaseIdx();
      timeTrack.querySelectorAll('.prc-pseg').forEach((el, i) => el.classList.toggle('on', i === pi));
      timeHead.style.left = (S.t * 100) + '%';
      timeLab.innerHTML = `<b>${esc(PHASES[pi].name)}</b> <span class="prc-dim">${esc(PHASES[pi].bus)}</span>`;
    }
    // 「并行」输入排：TP/PP/DP/EP 任意填数 → setConfig 整体重建魔方（回车或「应用」提交）
    function applyCfg() {
      if (!cfgInputs) return;
      const res = api.setConfig({ tp: +cfgInputs.tp.value, pp: +cfgInputs.pp.value, dp: +cfgInputs.dp.value, ep: +cfgInputs.ep.value });
      if (!res.ok && cfgErr) cfgErr.textContent = '✗ ' + res.error;
    }
    function syncCfgUI() {
      if (!cfgInputs) return;
      cfgInputs.tp.value = TP; cfgInputs.pp.value = PP; cfgInputs.dp.value = REP; cfgInputs.ep.value = EP;
      cfgRead.textContent = `rank = ${TP}×${PP}×${REP} = ${N} · EP${EP} 折入 DP → ${DOM} 域`;
      cfgErr.textContent = '';
    }
    function syncChrome() {
      if (anomBtns[4]) anomBtns[4].textContent = `EP桶${anomBucket()}`;   // 示意桶号随 EP 收缩
      modeBtns.forEach((b, i) => b.classList.toggle('is-selected', i === S.mode));
      const md = model.modes[S.mode];
      viewBtns.forEach((b, i) => {
        b.style.display = (md.views || [0, 1, 2, 3]).includes(i) ? '' : 'none';   // 视角收编：重合平面不出按钮
        b.classList.toggle('is-selected', i === S.view);
        if (i > 0) b.textContent = md.viewLabels[i];
      });
      if (viewNote) { viewNote.textContent = md.note2d || ''; viewNote.style.display = md.note2d ? '' : 'none'; }
      const lensKeys = ['load', 'tp', 'pp', 'dp', 'ep'];
      lensBtns.forEach((b, i) => b.classList.toggle('is-selected', lensKeys[i] === S.colorBy));
      const anomKeys = ['none', 'tp', 'pp', 'dp', 'ep'];
      anomBtns.forEach((b, i) => b.classList.toggle('is-selected', anomKeys[i] === S.anom));
      if (playBtn) {
        playBtn.innerHTML = (S.playing ? ICON.pause : ICON.play) + `<span>${S.playing ? 'Pause' : 'Play'}</span>`;
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
      const rowModes = $('.prc-row-modes'), rowViews = $('.prc-row-views'), rowLens = $('.prc-row-lens'), rowAnom = $('.prc-row-anom');
      modeBtns = model.modes.map((m, i) => rowModes.appendChild(chipBtn(m.name, () => api.setMode(i))));
      viewBtns = ['轴测', '顶', '前', '侧'].map((t, i) => rowViews.appendChild(chipBtn(t, () => api.setView(i))));
      viewNote = document.createElement('span'); viewNote.className = 'prc-note'; rowViews.appendChild(viewNote);
      sliceBox = document.createElement('span'); sliceBox.className = 'prc-slice';
      sliceBox.appendChild(chipBtn('剖面', () => { S.sliceOn = !S.sliceOn; refresh2D(); }));
      sliceRange = document.createElement('input'); sliceRange.type = 'range'; sliceRange.min = '0'; sliceRange.max = '1'; sliceRange.value = '0';
      sliceRange.addEventListener('input', () => { S.sliceVal = sliceRange.value | 0; refresh2D(); });
      sliceLab = document.createElement('span'); sliceLab.className = 'prc-mono';
      sliceBox.appendChild(sliceRange); sliceBox.appendChild(sliceLab);
      rowViews.appendChild(sliceBox);
      lensBtns = [['状态热力', 'load'], ['TP', 'tp'], ['PP', 'pp'], ['DP', 'dp'], ['EP', 'ep']]
        .map(([t, k]) => rowLens.appendChild(chipBtn(t, () => { S.colorBy = k; recolor(); renderLegend(); syncChrome(); })));
      // 时间轴 = 一个 step 的 4 个通信阶段（对齐集群驾驶舱）：播放/暂停 + 阶段轨道拖拽定位
      const rowTime = $('.prc-row-time');
      playBtn = rowTime.appendChild(chipBtn('', () => { S.playing = !S.playing; syncChrome(); }));
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
      timeTrack.addEventListener('pointerdown', (ev) => { timeTrack.setPointerCapture(ev.pointerId); scrub(ev); });
      timeTrack.addEventListener('pointermove', (ev) => { if (ev.buttons & 1) scrub(ev); });
      rowTime.appendChild(timeTrack);
      timeLab = document.createElement('span'); timeLab.className = 'prc-note';
      rowTime.appendChild(timeLab);
      anomBtns = [['无', 'none'], ['TP槽0', 'tp'], ['PP级0', 'pp'], ['DP副本0', 'dp'], ['EP桶3', 'ep']]
        .map(([t, k]) => rowAnom.appendChild(chipBtn(t, () => { S.anom = k; recolor(); renderHud(); renderLegend(); syncChrome(); })));
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
      cfgRead = document.createElement('span'); cfgRead.className = 'prc-mono'; rowCfg.appendChild(cfgRead);
      cfgErr = document.createElement('span'); cfgErr.className = 'prc-cfgerr'; rowCfg.appendChild(cfgErr);
      // 快捷预设（标签按 TP·PP·DP·EP 顺序）：
      //  · 盘古 Pro MoE 真实训练策略（data/ascend-workload-pangu-moe.json，
      //    TP8·EP2·PP5·4K NPU → dp = 4000/(8×5) = 100，EP2 折入其中）；
      //  · 128 卡小规格（单超节点量级）：tp2×pp4×dp16 = 128，EP8 折入 DP → 2 个 A2A 域。
      rowCfg.appendChild(chipBtn('盘古ProMoE 8·5·100·2', () => api.setConfig({ tp: 8, pp: 5, dp: 100, ep: 2 })));
      rowCfg.appendChild(chipBtn('128卡 2·4·16·8', () => api.setConfig({ tp: 2, pp: 4, dp: 16, ep: 8 })));
    }
    function refresh2D() { reScale(); recolor(); renderPill(); syncChrome(); }

    /* ── 交互：悬停 tooltip / 点选 / 拖拽旋转（任何视角，正交下转回 3D）/ 滚轮缩放 ── */
    const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
    function pick(ev) {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(mouse, camera);
      const hit = ray.intersectObject(chips)[0];
      return hit && hit.instanceId != null ? hit.instanceId : null;
    }
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
      S.hover = r;
      if (r != null) {
        const st = model.ppOf(r), lr = model.stageLayerRange(st);
        tipEl.style.display = 'block';
        tipEl.style.left = (ev.clientX - root.getBoundingClientRect().left + 14) + 'px';
        tipEl.style.top = (ev.clientY - root.getBoundingClientRect().top + 12) + 'px';
        tipEl.innerHTML = `rank ${r} · TP${model.tpOf(r)} PP${st}(L${lr.lo}-${lr.hi}) DP${model.repOf(r)} · 桶${model.epOf(r)} 域${model.domOf(r)}`;
      } else tipEl.style.display = 'none';
    });
    renderer.domElement.addEventListener('pointerleave', () => { S.hover = null; tipEl.style.display = 'none'; });
    renderer.domElement.addEventListener('click', (ev) => {
      if (drag && drag.moved) return;
      const r = pick(ev);
      api.select(r == null ? null : r);
    });
    renderer.domElement.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      cam.half = Math.max(4, Math.min(220, cam.half * (ev.deltaY > 0 ? 1.1 : 0.9)));
    }, { passive: false });

    /* ── 主循环 ── */
    let raf = 0, lastRecolor = -1, lastMs = null, lastTimeUi = -1, lastPhase = -1;
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
      // 位置飞行 lerp（切形态重排动画；稳定后停写省 CPU）
      if (settling) {
        let moving = false;
        for (let r = 0; r < N; r++) {
          const i = r * 3;
          for (let k = 0; k < 3; k++) {
            const nv = cur[i + k] + (target[i + k] - cur[i + k]) * 0.14;
            if (Math.abs(target[i + k] - nv) > 0.004) moving = true;
            cur[i + k] = nv;
          }
          dummy.position.set(cur[i], cur[i + 1], cur[i + 2]);
          dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(scl[r]); dummy.updateMatrix();
          chips.setMatrixAt(r, dummy.matrix);
        }
        chips.instanceMatrix.needsUpdate = true;
        if (S.sel != null) rebuildComm();            // 通信线/对端随重排飞行
        if (!moving) settling = false;
      }
      // 焦点/悬停框跟随实时位置
      const place = (box, r) => {
        if (r == null || r < 0 || r >= N) { box.visible = false; return; }
        box.visible = true; box.position.set(cur[r * 3], cur[r * 3 + 1], cur[r * 3 + 2]);
      };
      place(selBox, S.sel); place(hovBox, S.hover === S.sel ? null : S.hover);
      applyCamera();
      renderer.render(scene, camera);
    }

    /* ── 尺寸 ── */
    function resize() {
      const w = stageEl.clientWidth || 800, h = stageEl.clientHeight || 600;
      renderer.setSize(w, h);
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
        clearComm(); peerMeshes.forEach((m2) => { m2.count = 0; m2.visible = false; });
        renderAxes(); applyAxVisibility(); updateSlab(); fitView();
        refresh2D(); renderPill();
        renderHud(); renderLegend(); renderInfo(); syncCfgUI();
        return { ok: true, ranks: model.N };
      },
      setMode(m) {
        S.mode = Math.max(0, Math.min(model.modes.length - 1, m | 0));
        // 收编后的形态只允许自己声明的视角；正交下切过去自动落回轴测
        if (!(model.modes[S.mode].views || [0, 1, 2, 3]).includes(S.view)) S.view = 0;
        retarget(); renderAxes(); applyAxVisibility(); updateSlab(); fitView();
        renderHud(); renderPill(); syncChrome(); refresh2D();
      },
      setView(v) {
        if (!(model.modes[S.mode].views || [0, 1, 2, 3]).includes(v | 0)) return;
        // 点「轴测」= 回到标准等距机位（拖歪之后也能一键复位，按钮在任何时候都有反馈）
        if ((v | 0) === 0) { cam.theta = ISO.theta; cam.phi = ISO.phi; }
        S.view = v | 0; fitView(); applyAxVisibility(); refresh2D(); renderPill();
      },
      setSlice(on, val) { S.sliceOn = !!on; if (val != null) S.sliceVal = val | 0; refresh2D(); },
      setColorBy(k) { S.colorBy = k; recolor(); renderLegend(); syncChrome(); },
      setAnomaly(k) { S.anom = k; recolor(); renderHud(); renderLegend(); syncChrome(); },
      select(r) {
        S.sel = r;
        rebuildComm(); renderInfo();
        if (opts.onSelect) {
          opts.onSelect(r == null ? null : {
            rank: r, tp: model.tpOf(r), pp: model.ppOf(r), rep: model.repOf(r),
            bucket: model.epOf(r), domain: model.domOf(r), stage: model.stageLayerRange(model.ppOf(r)),
          });
        }
      },
      selectLayer(l) { S.selLayer = l; updateSlab(); renderHud(); },            // 整网图 → 魔方水平切片
      selectBucket(e) {                                                        // 专家图 → 整面墙（切 EP 聚簇并选中桶内代表卡）
        if (e == null) { api.select(null); return; }
        api.setMode(2); api.select(model.rankOf(0, 0, (e | 0) % EP));
      },
      setTheme(theme) {
        S.theme = theme === 'light' ? 'light' : 'dark';
        root.setAttribute('data-theme', S.theme);
        readTokens();                     // 色卡随主题重解析
        applySceneBg();
        renderAxes(); applyAxVisibility(); recolor(); rebuildComm(); renderLegend(); renderHud();
      },
      setPlaying(p) { S.playing = !!p; syncChrome(); },
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
    resize(); renderAxes(); applyAxVisibility(); updateSlab(); fitView();
    recolor(); renderHud(); renderPill(); renderLegend(); renderInfo(); syncChrome(); syncCfgUI(); syncTimeUI();
    raf = global.requestAnimationFrame(frame);
    return api;
  }

  global.PtoRubikCubePattern = { version: '0.2.0', DEFAULTS, DIM_TOKEN, GROUP_TOKENS, createModel, mount };
})(typeof window !== 'undefined' ? window : this);

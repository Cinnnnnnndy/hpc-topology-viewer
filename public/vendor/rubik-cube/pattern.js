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
  const DEFAULTS = {
    tp: 2, pp: 4, dp: 128, ep: 8,
    layers: 48,            // 整网层数 → 每 PP 段 layers/pp 层
    experts: 64,           // 路由专家总数 → 每桶 experts/ep 个
    hotBuckets: [0, 2],    // 示意热点专家桶（★）
  };

  // 维度签名色（深色主题 / 浅色主题），与 cockpit DIMHEX 一致
  const DIMC = {
    TP: { dark: '#39c5cf', light: '#0d6b75' },
    PP: { dark: '#FFAA3B', light: '#8a5f00' },
    DP: { dark: '#4369EF', light: '#2b4bc0' },
    EP: { dark: '#9B3CF6', light: '#6b2cba' },
    NT: { dark: '#c8d2dc', light: '#3f4c63' },   // 中性注释
  };
  // 分组着色透镜的循环调色板（组数可能 > 色数 → 取模循环）
  const GROUP_PALETTE = ['#39c5cf', '#FFAA3B', '#4369EF', '#9B3CF6', '#04D793', '#FF4B7B',
    '#f0883e', '#a5d6ff', '#d2a8ff', '#7ee787', '#ffa198', '#79c0ff', '#e3b341', '#56d364', '#ff7b72', '#8b949e'];

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
    // DP 平铺宫格：找到能整除副本数、最接近方形的列数
    let COLS = Math.ceil(Math.sqrt(REP)); while (REP % COLS) COLS++;
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

    /* 轴间距：遵守 cockpit「轴间距失衡修正」的教训——同屏两轴的步距比控制在 ~4× 以内，
       避免正交 2D 强制方形格子时一根轴被拖成一堆小块。 */
    const SP = {
      std: { sx: 1.6, sy: 1.6, sz: 0.42, cy: 9 },
      // DP 平铺的列间距随 TP 自适应：板宽 = TP×1.15，间距 = 板宽 + 缝，避免 TP 大时同行板粘连
      dpt: { gapX: TP * 1.15 + 2.4, gapZ: 4.2, tp: 1.15, pp: 1.4, y0: 1.0 },
      // EP 墙内 TP 沿 Z 的微偏移：总散布压在域步距(1.35)的 ~2/3 内，TP 大时自动收窄
      ep: { gapE: 3.0, pp: 1.5, dom: 1.35, tp: TP > 1 ? Math.min(0.4, 0.9 / (TP - 1)) : 0, cy: 9 },
      tps: { gapT: 1.8, pp: 1.5, rep: 0.42, cy: 9 },
      ppf: { gapP: 1.7, tp: 1.3, rep: 0.42, cy: 6 },
    };

    // 5 种形态的 rank → 世界坐标（out 为 {x,y,z} 或 THREE.Vector3 均可）
    function posOf(r, mode, out) {
      out = out || { x: 0, y: 0, z: 0 };
      const tp = tpOf(r), pp = ppOf(r), rep = repOf(r);
      if (mode === 1) {          // DP 平铺：副本宫格，每副本一块直立 TP×PP 板（找慢副本）
        const s = SP.dpt;
        out.x = (gxOf(r) - cG) * s.gapX + (tp - cT) * s.tp;
        out.y = s.y0 + (PP - 1 - pp) * s.pp;
        out.z = (gzOf(r) - cZ) * s.gapZ;
        return out;
      }
      if (mode === 2) {          // EP 专家桶墙：桶成墙（同墙=持有相同专家）· 墙内 Y=PP · Z=A2A 域×TP
        const s = SP.ep;
        out.x = (epOf(r) - cE) * s.gapE;
        out.y = s.cy + (cP - pp) * s.pp;
        out.z = (domOf(r) - cD) * s.dom + (tp - cT) * s.tp;
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
    };
    const depthIdxOf = (r, dim) => dim === 'tp' ? tpOf(r) : dim === 'pp' ? ppOf(r)
      : dim === 'rep' ? repOf(r) : dim === 'ep' ? epOf(r) : dim === 'dom' ? domOf(r)
        : dim === 'gx' ? gxOf(r) : dim === 'gz' ? gzOf(r) : 0;

    const D_STD = { 1: 'pp', 2: 'rep', 3: 'tp' };
    const modes = [
      {
        key: 'std', name: '标准',
        sub: `标准 X=TP Y=PP(模型深度) Z=DP`,
        why: `位置即多维坐标：X=TP·Y=PP·Z=DP 同屏三维 · 着色透镜再叠第 4 维（换形态只换投影轴）`,
        viewLabels: { 1: '顶 DP×TP', 2: '前 TP×PP', 3: '侧 DP×PP' }, depth: D_STD,
      },
      {
        key: 'dpt', name: 'DP平铺',
        sub: `DP 平铺：${REP} 副本各自成板（找慢副本）`,
        why: `副本间只在步末做梯度 AllReduce · 发暗/掉队的那块板 = 慢副本`,
        viewLabels: { 1: '顶 副本网格', 2: '前 列×PP', 3: '侧 行×PP' },
        depth: { 1: 'pp', 2: 'gz', 3: 'gx' },
      },
      {
        key: 'ep', name: 'EP聚簇',
        sub: `EP 聚簇：${EP} 专家桶成墙（桶=MoE 组 · 每桶复现于 ${DOM} 个 A2A 域 · 桶↔卡非 1:1）`,
        why: `桶故障 = 整面墙同红 · 域热点 = 横穿 ${EP} 墙的一排过热 · 桶↔卡非 1:1`,
        viewLabels: { 1: '顶 桶×域', 2: '前 桶×PP', 3: '侧 域×PP' },
        depth: { 1: 'pp', 2: 'dom', 3: 'ep' },
      },
      {
        key: 'tps', name: 'TP切片',
        sub: `TP 切片：${TP} 片权重墙 · 一面墙=全集群同槽位切片（查同槽位系统性故障）`,
        why: `同槽位系统性故障（整批同号卡坏件）= 一面墙集体异常`,
        viewLabels: { 1: '顶 DP×TP', 2: '前 TP×PP', 3: '侧 DP×PP' }, depth: D_STD,
      },
      {
        key: 'ppf', name: 'PP流水',
        sub: `PP 流水：${PP} 段横向展开 · 左=Stage0 右=Stage${PP - 1}（找慢段/气泡）`,
        why: `只有 PP 适合说「哪段层在哪」· ${PP} 段各 ${LPS} 层 · 慢段拖住下游 = 右侧板变暗 · 空档=bubble`,
        viewLabels: { 1: '顶 DP×PP', 2: '前 PP×TP', 3: '侧 DP×TP' },
        depth: { 1: 'tp', 2: 'rep', 3: 'pp' },
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
      config: C, TP, PP, EP, DOM, REP, N, LPS, EXP_PER, COLS, ROWS, SP,
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
      view: 0,                       // 0=斜视 · 1=顶 · 2=前 · 3=侧
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
    const dimc = (d) => DIMC[d][isDark() ? 'dark' : 'light'];

    /* ── DOM 骨架 ── */
    const root = document.createElement('div');
    root.className = 'prc-root';
    root.setAttribute('data-theme', S.theme);
    root.innerHTML = [
      '<div class="prc-stage"></div>',
      opts.chrome === false ? '' : [
        '<div class="prc-topbar">',
        '  <div class="prc-row prc-row-modes"><span class="prc-lab">形态</span></div>',
        '  <div class="prc-row prc-row-views"><span class="prc-lab">视角</span></div>',
        '  <div class="prc-row prc-row-lens"><span class="prc-lab">着色</span></div>',
        '  <div class="prc-row prc-row-anom"><span class="prc-lab">注入</span></div>',
        '  <div class="prc-row prc-row-cfg"><span class="prc-lab">并行</span></div>',
        '</div>',
        '<div class="prc-hud"></div>',
        '<div class="prc-pill"></div>',
        '<div class="prc-legend"></div>',
        '<div class="prc-info"></div>',
      ].join(''),
      '<div class="prc-tip"></div>',
    ].join('');
    container.appendChild(root);
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
    const BOXG = new THREE.BoxGeometry(0.9, 0.6, 0.3);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.02 });
    let chips = null;
    let cur, target, scl;
    let settling = true;
    // 卡块逐轴缩放：按当前形态各轴的最小格步距自动收缩，保证任何并行配置下卡块
    // 都不越过邻格（例：EP 聚簇 TP=8 时墙内 Z 步距收到 ~0.13，固定 0.3 深的块会大量重叠）。
    // 切形态时与位置一起 lerp 过渡。
    const bsC = { x: 1, y: 1, z: 1 };            // 当前缩放（动画中）
    let bsT = { x: 1, y: 1, z: 1 };              // 目标缩放
    function boxScaleOf(mode) {
      const sp = model.SP;
      const f = (step, dim) => Math.min(1, Math.max(0.12, (step * 0.8) / dim));
      if (mode === 1) return { x: f(sp.dpt.tp, 0.9), y: f(sp.dpt.pp, 0.6), z: f(sp.dpt.gapZ, 0.3) };
      if (mode === 2) return { x: f(sp.ep.gapE, 0.9), y: f(sp.ep.pp, 0.6), z: f(TP > 1 ? sp.ep.tp : sp.ep.dom, 0.3) };
      if (mode === 3) return { x: f(sp.tps.gapT, 0.9), y: f(sp.tps.pp, 0.6), z: f(sp.tps.rep, 0.3) };
      if (mode === 4) return { x: f(sp.ppf.gapP, 0.9), y: f(sp.ppf.tp, 0.6), z: f(sp.ppf.rep, 0.3) };
      return { x: f(sp.std.sx, 0.9), y: f(sp.std.sy, 0.6), z: f(sp.std.sz, 0.3) };
    }
    function updateBoxScale() { bsT = boxScaleOf(S.mode); settling = true; }
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
        new THREE.MeshBasicMaterial({ color: new THREE.Color(DIMC[d].dark), transparent: true, opacity: 0.34, depthWrite: false, depthTest: false }), PEER_MAX);
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
      const FONT = `700 ${fontPx}px 'Inter','Source Han Sans SC','PingFang SC','Microsoft YaHei',sans-serif`;
      const meas = document.createElement('canvas').getContext('2d');
      meas.font = FONT;
      const tw = Math.ceil(meas.measureText(text).width) + padX * 2, th = fontPx + padY * 2;
      const cv = document.createElement('canvas'); cv.width = tw * SS; cv.height = th * SS;
      const c = cv.getContext('2d'); c.scale(SS, SS);
      const light = !isDark();
      c.fillStyle = light ? 'rgba(255,255,255,0.96)' : 'rgba(10,14,24,0.78)';
      const rr = th * 0.38;
      c.beginPath(); c.roundRect(1, 1, tw - 2, th - 2, rr); c.fill();
      c.lineWidth = 2; c.strokeStyle = light ? 'rgba(45,58,80,0.48)' : 'rgba(139,148,158,0.4)';
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
    // 长文案「读图横幅」（w≥5）只在斜视显示：正交 2D 取景很紧，横幅字牌（世界尺寸随文本长度
    // 膨胀）会盖满画面——2D 里只留短刻度标（TP0/DP127/层段标尺…），语义讲解交给 HUD。
    function axText(text, color, w, pos) {
      const l = makeLabel(text, color, w * 1.25);
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
      const grid = hx(themeC('#33415c', '#93a5bd')), frame = hx(themeC('#54678a', '#54678a'));
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

    // 每种形态 = 换一根投影轴：讲清「为什么这样重排 · 这个形状帮你看什么」——一个小方块 = 1 颗卡（rank）
    function renderAxes() {
      clearAxes();
      const TPc = dimc('TP'), PPc = dimc('PP'), DPc = dimc('DP'), EPc = dimc('EP'), NTc = dimc('NT');
      const hx = (c) => new THREE.Color(c).getHex();
      const TPw = hx(TPc), PPw = hx(PPc), EPw = hx(EPc), NTw = hx(NTc);
      const sp = model.SP;
      const v = { x: 0, y: 0, z: 0 };
      const pos = (tp, pp, rep) => { model.posOf(model.rankOf(tp, pp, rep), S.mode, v); return V3(v.x, v.y, v.z); };
      if (S.mode === 0) {
        const s = sp.std, xT = (t) => (t - (TP - 1) / 2) * s.sx, yS = (p) => s.cy + ((PP - 1) / 2 - p) * s.sy, zD = (d) => (d - (REP - 1) / 2) * s.sz;
        const b = { x0: xT(0) - 1.2, x1: xT(TP - 1) + 1.2, y0: yS(PP - 1) - 1, y1: yS(0) + 1, z0: zD(0) - 1.2, z1: zD(REP - 1) + 1.2 };
        axGridBox(b, R(TP, xT), R(PP, yS), R(9, (i) => zD(Math.round(i * (REP - 1) / 8))));
        axText('TP0', TPc, 1.6, V3(xT(0), b.y0 - 1, b.z1 + 1.4)); axText('TP' + (TP - 1), TPc, 1.6, V3(xT(TP - 1), b.y0 - 1, b.z1 + 1.4));
        axText(`TP×${TP} 同一层切 ${TP} 片 · 层内 AllReduce`, TPc, 7, V3(0, b.y0 - 2.6, b.z1 + 3.2));
        axText('DP0', DPc, 1.6, V3(b.x1 + 1.6, b.y0 - 1, zD(0))); axText('DP' + (REP - 1), DPc, 2, V3(b.x1 + 1.8, b.y0 - 1, zD(REP - 1)));
        axText(`DP×${REP} 完整副本 · 数据不同 · 梯度 AllReduce`, DPc, 8, V3(b.x1 + 5, b.y0 - 2.6, 0));
        axArrow(V3(b.x0 - 1.5, b.y1, b.z0), V3(b.x0 - 1.5, b.y0, b.z0), PPw);
        axText(`PP×${PP} 模型深度 L1→L${model.config.layers} · 段间 P2P`, PPc, 7, V3(b.x0 - 1.5, b.y1 + 1.6, b.z0));
        axText('1 小块 = 1 卡（rank）= (TP,PP,DP) 坐标交点 · 另叠 EP 桶', NTc, 9, V3(0, b.y1 + 3.6, 0));
        // 层段标尺：每个 PP 段 "S0·L1-12"（左后棱一列）
        for (let s2 = 0; s2 < PP; s2++) {
          const lr = model.stageLayerRange(s2);
          const l = makeLabel(`S${s2}·L${lr.lo}-${lr.hi}`, '#ffe0a0', 2.6);
          l.position.set(b.x0 - 3.4, yS(s2), b.z0 - 1); axGroup.add(l);
        }
      } else if (S.mode === 1) {
        const s = sp.dpt, COLS = model.COLS, ROWS = model.ROWS;
        const bb = model.boundsOf(1);
        const b = { x0: bb.x0 - s.gapX / 2, x1: bb.x1 + s.gapX / 2, y0: 0, y1: bb.y1 + 0.6, z0: bb.z0 - s.gapZ / 2, z1: bb.z1 + s.gapZ / 2 };
        axGridBox(b, R(COLS + 1, (i) => b.x0 + i * s.gapX), [], R(ROWS + 1, (i) => b.z0 + i * s.gapZ), true);
        R(COLS, (i) => axText('列' + i, DPc, 1.7, V3(b.x0 + (i + 0.5) * s.gapX, b.y0, b.z1 + 1.8)));
        R(ROWS, (i) => axText('行' + i, DPc, 1.7, V3(b.x1 + 2.2, b.y0, b.z0 + (i + 0.5) * s.gapZ)));
        axText('DP0', DPc, 1.8, pos(0, 0, 0).add(V3(0, 1.6, 0)));
        axText('DP' + (REP - 1), DPc, 2.1, pos(0, 0, REP - 1).add(V3(0, 1.6, 0)));
        axText(`DP 平铺 · ${REP} 块板 = ${REP} 份完整副本（副本号=行×${COLS}+列 · 参数相同 · 各吃不同数据）`, DPc, 11, V3(0, b.y1 + 3.4, 0));
        const p00 = pos(0, PP - 1, 0), p10 = pos(TP - 1, PP - 1, 0), pTop = pos(0, 0, 0);
        axArrow(p00.clone().add(V3(-0.9, -0.8, 0)), p10.clone().add(V3(0.9, -0.8, 0)), TPw);
        axText(`板内横=TP×${TP}`, TPc, 3.4, p00.clone().add(V3(0.6, -1.9, 0)));
        axArrow(pTop.clone().add(V3(-1.7, 0.4, 0)), p00.clone().add(V3(-1.7, -0.4, 0)), PPw);
        axText(`板内竖=PP×${PP} L1→L${model.config.layers}`, PPc, 4.6, pTop.clone().add(V3(0.4, 1.7, 0)));
      } else if (S.mode === 2) {
        const s = sp.ep;
        const bb = model.boundsOf(2);
        const b = { x0: bb.x0 - s.gapE / 2, x1: bb.x1 + s.gapE / 2, y0: bb.y0 - 0.8, y1: bb.y1 + 0.8, z0: bb.z0 - 0.9, z1: bb.z1 + 0.9 };
        axGridBox(b, R(EP + 1, (i) => b.x0 + i * s.gapE), R(PP, (p) => s.cy + ((PP - 1) / 2 - p) * s.pp), R(5, (i) => b.z0 + i * (b.z1 - b.z0) / 4));
        for (let e = 0; e < EP; e++) {
          const hot = model.hotBuckets.has(e);
          axText(`桶${e} ${model.expRange(e)}${hot ? '★' : ''}`, hot ? themeC('#FFAA3B', '#b45f06') : EPc, 3,
            V3(bb.x0 + e * s.gapE, b.y1 + 1.2 + (e % 2) * 1.1, 0));
        }
        axText(`${EP} 面墙 = ${EP} 个专家分桶（桶=MoE 组 · 同墙=同专家 · ★=热点）`, EPc, 10, V3(0, b.y1 + 4.2, 0));
        const rowY = s.cy, rowZ = bb.z0;
        axLine(V3(b.x0, rowY, rowZ), V3(b.x1, rowY, rowZ), EPw, 0.07);
        axText(`1 个 A2A 域 = 横穿 ${EP} 面墙的同一排 · 每桶各出 1 员互发`, EPc, 9, V3(0, b.y0 - 1.7, rowZ));
        axArrow(V3(b.x1 + 1.4, b.y0 - 0.5, bb.z0), V3(b.x1 + 1.4, b.y0 - 0.5, bb.z1), NTw);
        axText(`域0→域${DOM - 1}`, NTc, 2.8, V3(b.x1 + 3.2, b.y0 - 1.5, 0));
        axArrow(V3(b.x0 - 1.4, b.y1, 0), V3(b.x0 - 1.4, b.y0, 0), PPw);
        axText(`墙内竖=PP×${PP}`, PPc, 3.6, V3(b.x0 - 1.4, b.y1 + 1.3, 0));
      } else if (S.mode === 3) {
        const s = sp.tps, zD = (d) => (d - (REP - 1) / 2) * s.rep;
        const bb = model.boundsOf(3);
        const b = { x0: bb.x0 - s.gapT / 2, x1: bb.x1 + s.gapT / 2, y0: bb.y0 - 0.8, y1: bb.y1 + 0.8, z0: bb.z0 - 1.2, z1: bb.z1 + 1.2 };
        axGridBox(b, R(TP + 1, (i) => b.x0 + i * s.gapT), R(PP, (p) => s.cy + ((PP - 1) / 2 - p) * s.pp), R(5, (i) => zD(Math.round(i * (REP - 1) / 4))));
        for (let t = 0; t < TP; t++) axText(`TP${t} 第${t + 1}/${TP}片`, TPc, 3, V3(bb.x0 + t * s.gapT, b.y1 + 1.2 + (t % 2) * 1.1, 0));
        axText(`${TP} 面墙 = 每层权重的 ${TP} 个切片 · 一面墙 = 全网同槽位卡`, TPc, 9.5, V3(0, b.y1 + 4.2, 0));
        const dots = R(TP, (t) => V3(bb.x0 + t * s.gapT, b.y1 + 0.4, b.z0));
        for (let k = 0; k < TP - 1; k++) axLine(dots[k], dots[k + 1], TPw, 0.07);
        dots.forEach((p) => { const d = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshBasicMaterial({ color: TPw })); d.position.copy(p); axGroup.add(d); });
        axText(`同一 TP 组的 ${TP} 卡 → 分属 ${TP} 面墙 · 层内 AllReduce 拼回完整权重`, TPc, 9.5, V3(0, b.y1 + 0.4, b.z0 - 2.4));
        axText('DP0', DPc, 1.6, V3(b.x1 + 1.5, b.y0 - 0.7, zD(0))); axText('DP' + (REP - 1), DPc, 2, V3(b.x1 + 1.7, b.y0 - 0.7, zD(REP - 1)));
        axArrow(V3(b.x0 - 1.4, b.y1, 0), V3(b.x0 - 1.4, b.y0, 0), PPw);
        axText(`墙内竖=PP×${PP}`, PPc, 3.6, V3(b.x0 - 1.4, b.y1 + 1.3, 0));
      } else {
        const s = sp.ppf, zD = (d) => (d - (REP - 1) / 2) * s.rep;
        const bb = model.boundsOf(4);
        const b = { x0: bb.x0 - s.gapP / 2, x1: bb.x1 + s.gapP / 2, y0: bb.y0 - 0.8, y1: bb.y1 + 0.8, z0: bb.z0 - 1.2, z1: bb.z1 + 1.2 };
        axGridBox(b, R(PP + 1, (i) => b.x0 + i * s.gapP), [], R(5, (i) => zD(Math.round(i * (REP - 1) / 4))), true);
        for (let st = 0; st < PP; st++) {
          const lr = model.stageLayerRange(st);
          axText(`S${st} L${lr.lo}-${lr.hi}`, PPc, 3.2, V3(bb.x0 + st * s.gapP, b.y1 + 1.6, 0));
        }
        axArrow(V3(b.x0, b.y1 + 3.4, 0), V3(b.x1, b.y1 + 3.4, 0), PPw);
        axText(`前向激活 →（反向梯度 ←）· 段间 P2P · 每段=连续 ${LPS} 层`, PPc, 9, V3(0, b.y1 + 4.9, 0));
        axText('DP0', DPc, 1.6, V3(b.x1 + 1.6, b.y0 - 0.5, zD(0))); axText('DP' + (REP - 1), DPc, 2, V3(b.x1 + 1.8, b.y0 - 0.5, zD(REP - 1)));
        axArrow(V3(b.x0 - 1.6, b.y1, b.z0), V3(b.x0 - 1.6, b.y0, b.z0), hx(TPc));
        axText(`段内竖=TP×${TP}`, TPc, 3.4, V3(b.x0 - 1.6, b.y1 + 1.3, b.z0));
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
    function load01(r) {                             // 合成负载场（时间平滑波动 + 热点桶微抬）
      const h1 = rng(r), h2 = rng(r * 7.3);
      let v = 0.34 + 0.2 * Math.sin(S.t * 0.9 + h1 * 6.283) + 0.16 * Math.sin(S.t * 0.37 + h2 * 6.283) + 0.12 * (h2 - 0.5);
      if (model.hotBuckets.has(model.epOf(r))) v += 0.1;
      return Math.max(0.04, Math.min(1, v));
    }
    const anomBucket = () => Math.min(3, EP - 1);            // 注入的示意桶号（EP 小时自动收到合法桶）
    function inAnomGroup(r) {
      if (S.anom === 'tp') return model.tpOf(r) === 0;       // TP 槽 0：全网同槽位卡
      if (S.anom === 'pp') return model.ppOf(r) === 0;       // PP 级 0：一整个流水段
      if (S.anom === 'dp') return model.repOf(r) === 0;      // DP 副本 0：一份完整拷贝
      if (S.anom === 'ep') return model.epOf(r) === anomBucket();   // EP 桶：持有该桶的所有 rank（越区示意）
      return false;
    }
    const loadColor = (v) => cTmp.setHSL(Math.max(0, 0.33 - v * 0.33), 0.72, isDark() ? 0.42 + v * 0.12 : 0.38 + v * 0.1);
    function colorOfRank(r) {
      if (S.anom !== 'none') {
        if (inAnomGroup(r)) return cTmp.set(0xff4b6e);
        return loadColor(0.16 + rng(r * 3.1) * 0.1);
      }
      if (S.colorBy !== 'load') {
        const g = S.colorBy === 'tp' ? model.tpOf(r) : S.colorBy === 'pp' ? model.ppOf(r)
          : S.colorBy === 'dp' ? model.repOf(r) : model.epOf(r);
        return cTmp.set(GROUP_PALETTE[g % GROUP_PALETTE.length]);
      }
      return loadColor(load01(r));
    }
    // 正交剖面：非当前层 → 压暗（并在写矩阵时缩小），保持空间参照又不喧宾
    function curDepth() {
      if (S.view === 0) return null;
      const dim = model.modes[S.mode].depth[S.view];
      return dim ? { dim, info: model.depthDims[dim] } : null;
    }
    const ghosted = (r) => {
      const d = curDepth();
      return !!(d && S.sliceOn && model.depthIdxOf(r, d.dim) !== S.sliceVal);
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

    /* ── 相机：斜视（等距可旋转）+ 顶/前/侧 正交锁轴，取景随形态包围盒 ── */
    const cam = { theta: Math.PI / 4, phi: 0.66, half: 30, cx: 0, cy: 8, cz: 0, panX: 0, panY: 0 };
    function fitView() {
      const b = model.boundsOf(S.mode);
      const mx = 6;                                   // 轴标注留白
      const ex = (b.x1 - b.x0) / 2 + mx, ey = (b.y1 - b.y0) / 2 + mx * 0.7, ez = (b.z1 - b.z0) / 2 + mx;
      cam.cx = (b.x0 + b.x1) / 2; cam.cy = (b.y0 + b.y1) / 2; cam.cz = (b.z0 + b.z1) / 2;
      cam.panX = 0; cam.panY = 0;
      const w = stageEl.clientWidth || 800, h = stageEl.clientHeight || 600, asp = w / h;
      const need = (hw, hh) => Math.max(hh, hw / asp);
      if (S.view === 1) cam.half = need(ex, ez) * 1.06;
      else if (S.view === 2) cam.half = need(ex, ey) * 1.06;
      else if (S.view === 3) cam.half = need(ez, ey) * 1.06;
      else cam.half = need(Math.max(ex, ez) * 1.1, Math.max(ey, (ex + ez) / 2)) * 1.02;
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
      // 正交视角的拖拽平移（沿相机右/上向量）
      camera.updateMatrixWorld();
      const right = V3(1, 0, 0).applyQuaternion(camera.quaternion), up = V3(0, 1, 0).applyQuaternion(camera.quaternion);
      camera.position.add(right.multiplyScalar(cam.panX)).add(up.multiplyScalar(cam.panY));
      camera.lookAt(c.clone().add(right.normalize().multiplyScalar(cam.panX)).add(up.normalize().multiplyScalar(cam.panY)));
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
        const colorHex = new THREE.Color(DIMC[d].dark).getHex();
        const pts = members.map(gp);
        if (d === 'EP') { pts.forEach((p) => { if (!p.equals(gp(S.sel))) commLine([gp(S.sel), p], colorHex, 0.8, 0.06); }); }   // A2A 互发（星形）
        else commLine(pts, colorHex, 0.85, d === 'TP' ? 0.1 : 0.07);   // TP 环 / PP 链 / DP 采样折线
      });
      const selP = gp(S.sel);
      const lab = makeLabel(`TP×${TP} · PP链×${PP} · DP采样${Math.min(16, REP)}/${REP} · A2A×${EP}`, themeC('#c8d2dc', '#3f4c63'), 6.5);
      lab.position.copy(selP.clone().add(V3(0, 3.2, 0))); lab.renderOrder = 7; commGroupG.add(lab);
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
      hud.innerHTML = `<b>逻辑魔方 · ${esc(m.sub)}</b>${S.selLayer != null && S.mode === 0 ? ` · 高亮 L${S.selLayer + 1} 切片` : ''}` +
        `<br><span class="prc-dim">◇ 为什么这样摆：${esc(m.why)}</span>` +
        (anomNote ? `<br><span class="prc-warn">⚠ ${esc(anomNote)}</span>` : '');
    }
    function renderPill() {
      const pill = $('.prc-pill'); if (!pill) return;
      const d = curDepth();
      if (!d) { pill.classList.remove('show'); pill.innerHTML = ''; return; }
      pill.classList.add('show');
      // 「每格=几张卡」：正交 2D 里同一格可能是 1 张卡，也可能是被折叠维的 n 张卡重叠——必须写清楚，别让人猜
      pill.innerHTML = S.sliceOn
        ? `▦ 每格 = <b class="prc-ok">1 张卡</b>（剖面 ${esc(d.info.lab)}=${S.sliceVal}）`
        : `▦ 每格 = <b class="prc-hot">${d.info.n} 张卡重叠</b>（${esc(d.info.lab)}×${d.info.n} 折入视线 · 开剖面逐层翻）`;
    }
    function renderLegend() {
      const lg = $('.prc-legend'); if (!lg) return;
      const chip = (c, t) => `<span><i style="background:${c}"></i>${esc(t)}</span>`;
      let rows = [chip(dimc('TP'), `TP×${TP}`), chip(dimc('PP'), `PP×${PP}`), chip(dimc('DP'), `DP×${REP}（=EP${EP}×域${DOM}）`), chip(dimc('EP'), `EP桶×${EP} ★=热点`)].join('');
      if (S.colorBy === 'load' && S.anom === 'none') rows += `<span class="prc-ramp"><i></i>负载 低→高</span>`;
      if (S.anom !== 'none') rows += chip('#ff4b6e', '异常组');
      lg.innerHTML = rows;
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
        `<br><span class="prc-dim">四维通信组已同屏高亮 · 再点空白处取消</span>`;
    }

    /* ── 工具栏 ── */
    function chipBtn(label, onClick) {
      const b = document.createElement('button');
      b.className = 'prc-btn'; b.textContent = label; b.addEventListener('click', onClick);
      return b;
    }
    let modeBtns = [], viewBtns = [], lensBtns = [], anomBtns = [], playBtn = null, sliceBox = null, sliceRange = null, sliceLab = null;
    let cfgInputs = null, cfgRead = null, cfgErr = null;
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
      modeBtns.forEach((b, i) => b.classList.toggle('on', i === S.mode));
      viewBtns.forEach((b, i) => { b.classList.toggle('on', i === S.view); if (i > 0) b.textContent = model.modes[S.mode].viewLabels[i]; });
      const lensKeys = ['load', 'tp', 'pp', 'dp', 'ep'];
      lensBtns.forEach((b, i) => b.classList.toggle('on', lensKeys[i] === S.colorBy));
      const anomKeys = ['none', 'tp', 'pp', 'dp', 'ep'];
      anomBtns.forEach((b, i) => { b.classList.toggle('on', anomKeys[i] === S.anom); b.classList.toggle('hot', anomKeys[i] === S.anom && S.anom !== 'none'); });
      if (playBtn) { playBtn.textContent = S.playing ? '⏸ 暂停' : '▶ 播放'; playBtn.classList.toggle('on', S.playing); }
      if (sliceBox) {
        const d = curDepth();
        sliceBox.style.display = d ? '' : 'none';
        if (d) {
          sliceRange.max = String(d.info.n - 1);
          if (S.sliceVal > d.info.n - 1) S.sliceVal = 0;
          sliceRange.value = String(S.sliceVal);
          sliceRange.disabled = !S.sliceOn;
          sliceLab.textContent = S.sliceOn ? `${d.info.lab}=${S.sliceVal}` : `剖面关（${d.info.lab}×${d.info.n} 折叠）`;
          sliceBox.querySelector('.prc-btn').classList.toggle('on', S.sliceOn);
        }
      }
    }
    if (opts.chrome !== false) {
      const rowModes = $('.prc-row-modes'), rowViews = $('.prc-row-views'), rowLens = $('.prc-row-lens'), rowAnom = $('.prc-row-anom');
      modeBtns = model.modes.map((m, i) => rowModes.appendChild(chipBtn(m.name, () => api.setMode(i))));
      viewBtns = ['斜视', '顶', '前', '侧'].map((t, i) => rowViews.appendChild(chipBtn(t, () => api.setView(i))));
      sliceBox = document.createElement('span'); sliceBox.className = 'prc-slice';
      sliceBox.appendChild(chipBtn('剖面', () => { S.sliceOn = !S.sliceOn; refresh2D(); }));
      sliceRange = document.createElement('input'); sliceRange.type = 'range'; sliceRange.min = '0'; sliceRange.max = '1'; sliceRange.value = '0';
      sliceRange.addEventListener('input', () => { S.sliceVal = sliceRange.value | 0; refresh2D(); });
      sliceLab = document.createElement('span'); sliceLab.className = 'prc-slicelab';
      sliceBox.appendChild(sliceRange); sliceBox.appendChild(sliceLab);
      rowViews.appendChild(sliceBox);
      lensBtns = [['状态热力', 'load'], ['TP', 'tp'], ['PP', 'pp'], ['DP', 'dp'], ['EP', 'ep']]
        .map(([t, k]) => rowLens.appendChild(chipBtn(t, () => { S.colorBy = k; recolor(); renderLegend(); syncChrome(); })));
      playBtn = rowLens.appendChild(chipBtn('⏸ 暂停', () => { S.playing = !S.playing; syncChrome(); }));
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
      rowCfg.appendChild(chipBtn('应用', applyCfg));
      cfgRead = document.createElement('span'); cfgRead.className = 'prc-cfgread'; rowCfg.appendChild(cfgRead);
      cfgErr = document.createElement('span'); cfgErr.className = 'prc-cfgerr'; rowCfg.appendChild(cfgErr);
      // 快捷预设：盘古 Pro MoE 真实训练策略（data/ascend-workload-pangu-moe.json，
      // TP8·EP2·PP5·4K NPU → dp = 4000/(8×5) = 100，EP2 折入其中）
      rowCfg.appendChild(chipBtn('盘古ProMoE 8·5·100·2', () => api.setConfig({ tp: 8, pp: 5, dp: 100, ep: 2 })));
    }
    function refresh2D() { reScale(); recolor(); renderPill(); syncChrome(); }

    /* ── 交互：悬停 tooltip / 点选 / 拖拽旋转（斜视）或平移（正交）/ 滚轮缩放 ── */
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
        if (S.view === 0) { cam.theta += dx * 0.006; cam.phi = Math.max(0.08, Math.min(1.45, cam.phi + dy * 0.005)); }
        else { const k = cam.half / (stageEl.clientHeight || 600) * 2; cam.panX -= dx * k; cam.panY += dy * k; }
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
    let raf = 0, lastRecolor = -1;
    function frame(nowMs) {
      raf = global.requestAnimationFrame(frame);
      if (S.playing) S.t = nowMs / 1000;
      // 状态热力随时间流动（350ms 重染一次；透镜/异常静态无需重染）
      if (S.playing && S.colorBy === 'load' && S.anom === 'none' && nowMs - lastRecolor > 350) { lastRecolor = nowMs; recolor(); }
      // 位置飞行 lerp（切形态重排动画；稳定后停写省 CPU）
      if (settling) {
        let moving = false;
        // 卡块尺寸随形态过渡（与位置同节奏 lerp）
        for (const k of ['x', 'y', 'z']) {
          bsC[k] += (bsT[k] - bsC[k]) * 0.14;
          if (Math.abs(bsT[k] - bsC[k]) > 0.004) moving = true;
        }
        for (let r = 0; r < N; r++) {
          const i = r * 3;
          for (let k = 0; k < 3; k++) {
            const nv = cur[i + k] + (target[i + k] - cur[i + k]) * 0.14;
            if (Math.abs(target[i + k] - nv) > 0.004) moving = true;
            cur[i + k] = nv;
          }
          dummy.position.set(cur[i], cur[i + 1], cur[i + 2]);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(bsC.x * scl[r], bsC.y * scl[r], bsC.z * scl[r]);
          dummy.updateMatrix();
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
        buildField(); updateBoxScale();
        clearComm(); peerMeshes.forEach((m2) => { m2.count = 0; m2.visible = false; });
        renderAxes(); applyAxVisibility(); updateSlab(); fitView();
        refresh2D(); renderPill();
        renderHud(); renderLegend(); renderInfo(); syncCfgUI();
        return { ok: true, ranks: model.N };
      },
      setMode(m) {
        S.mode = Math.max(0, Math.min(model.modes.length - 1, m | 0));
        retarget(); updateBoxScale(); renderAxes(); applyAxVisibility(); updateSlab(); fitView();
        renderHud(); renderPill(); syncChrome(); refresh2D();
      },
      setView(v) { S.view = v | 0; fitView(); applyAxVisibility(); refresh2D(); renderPill(); },
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
        scene.background = new THREE.Color(isDark() ? 0x0d1117 : 0xf4f6fa);
        renderAxes(); applyAxVisibility(); recolor(); rebuildComm(); renderLegend(); renderHud();
      },
      setPlaying(p) { S.playing = !!p; syncChrome(); },
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
    scene.background = new THREE.Color(isDark() ? 0x0d1117 : 0xf4f6fa);
    resize(); updateBoxScale(); bsC.x = bsT.x; bsC.y = bsT.y; bsC.z = bsT.z;
    renderAxes(); applyAxVisibility(); updateSlab(); fitView();
    recolor(); renderHud(); renderPill(); renderLegend(); renderInfo(); syncChrome(); syncCfgUI();
    raf = global.requestAnimationFrame(frame);
    return api;
  }

  global.PtoRubikCubePattern = { version: '0.1.0', DEFAULTS, DIMC, createModel, mount };
})(typeof window !== 'undefined' ? window : this);

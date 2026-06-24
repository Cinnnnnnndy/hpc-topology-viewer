/**
 * StatusView — 运行状态总览 (runtime-state / observability dashboard).
 *
 * A status-FIRST lens on the same super-node the rest of the app models: it answers
 * the operations journey "现在好不好 → 慢在哪一层 → 哪张卡/哪段通信 → 哪个时刻", per the
 * design analysis. The layout enlarges the MAIN lens canvas as the dominant body, with
 * a compact KPI strip + a clickable hierarchy status-axis above it (the shared selection),
 * and a detail rail to the right.
 *
 * Four lenses share ONE selection (breadcrumb + hierarchy axis): 状态热力 / 机柜流量 /
 * 通信域 / 物理链路. Pick a level → every lens re-scopes its granularity AND its colouring.
 *
 * NOTHING is hard-coded: counts come from the generation spec (cabinets = NPU/64, nodes = …),
 * per-card load reuses the SAME `nodeLoad` field the 阵列全景 / 平面视图 playback uses (so the
 * heatmap is consistent across views), and the comm lenses are derived from the real parallel
 * decomposition (PARTITION_META) + planes (PLANES) + run schedule (RUN_SCHED). Replay (step)
 * perturbs the field live and injects a localized cabinet event, so it actually "runs".
 *
 * Display text with brand terms is sourced from ../content (decoded at runtime).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GENERATIONS, NODES_PER_CAB, NPUS_PER_NODE, PLANES, PARTITION_META,
  loadColor, loadState, stateColor, STATE_LABELS, nodeLoad,
  type Gen,
} from '../scene/data';
import { TOK } from '../content';

// ── shared button language (matches ClusterView / PlaneView) ──
const ACCENT = '#4369ef';
const SECONDARY: React.CSSProperties = { border: '1px solid var(--btn-bd)', background: 'var(--btn)', color: 'var(--tx2)' };
function inkOf(hex: string): string {
  const h = hex.replace('#', ''); if (h.length < 6) return '#fff';
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#10131a' : '#fff';
}
function navBtn(active: boolean): React.CSSProperties {
  return active ? { border: `1px solid ${ACCENT}`, background: ACCENT, color: '#fff', fontWeight: 600 } : { ...SECONDARY };
}
function toggleBtn(active: boolean, c: string): React.CSSProperties {
  return active ? { border: `1px solid ${c}`, background: c, color: inkOf(c), fontWeight: 600 } : { ...SECONDARY };
}
const LBL: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4, color: 'var(--tx3)' };
const TNUM: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };
const MONO = "'JetBrains Mono','Consolas',ui-monospace,monospace";

type Phase = 'pretrain' | 'prefill' | 'decode';
type Metric = 'util' | 'strag' | 'fault';
type Lens = 'heat' | 'flow' | 'domain' | 'phys';
type Level = 'cluster' | 'super' | 'cab' | 'node' | 'rank';

// 工况 → 基准负载 + 驱动的 phaseKind(复用 nodeLoad 的相位语义) + 平面/通信侧重
const PH: Record<Phase, { label: string; base: number; kind: string; hot: 'ub' | 'rdma' }> = {
  pretrain: { label: '预训练', base: 0.55, kind: 'compute', hot: 'ub' },
  prefill: { label: 'Prefill', base: 0.50, kind: 'compute', hot: 'ub' },
  decode: { label: 'Decode', base: 0.62, kind: 'comm', hot: 'ub' },
};
const NIC_LBL = TOK.qingtian.split(' ')[0];   // 擎天 — brand via TOK (no plaintext brand in source)
const STEP_MAX = 60;
const EVT_LO = 34, EVT_HI = 46;   // 回放事件窗口：某机柜过热（演示局部故障/拥塞的时间定位）

// deterministic noise (same shape as the reference low-fi, but only used to ANIMATE/spread —
// the field itself is anchored to the project-wide nodeLoad)
const rnd = (x: number) => { const v = Math.sin(x * 99.13) * 43758.5453; return v - Math.floor(v); };
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function StatusView({ gen, dark }: { gen: Gen; dark: boolean }) {
  const spec = GENERATIONS[gen];

  // ── real counts from the spec (NOTHING hard-coded) ──
  const NPC = NODES_PER_CAB * NPUS_PER_NODE;            // 64 NPU / cabinet
  const NPU_TOT = spec.totalNpus;                        // 8192 (A5) / 15488 (A6)
  const CAB = Math.max(1, Math.round(NPU_TOT / NPC));    // cabinets / super-node
  const NODES = CAB * NODES_PER_CAB;                     // nodes / super-node
  const NPN = NPUS_PER_NODE;                             // 8 NPU / node
  const EVT_CAB = Math.min(CAB - 1, Math.round(CAB * 0.56));   // the cabinet that overheats during the event

  // ── shared selection (drives ALL lenses) ──
  const [phase, setPhase] = useState<Phase>('decode');
  const [metric, setMetric] = useState<Metric>('util');
  const [lens, setLens] = useState<Lens>('heat');
  const [pods, setPods] = useState(4);                   // 集群 = N 超节点（示意，跨超节点 DP）
  const [selLevel, setSelLevel] = useState<Level>('super');
  const [selSpod, setSelSpod] = useState(0);
  const [selCab, setSelCab] = useState(0);
  const [selNode, setSelNode] = useState(0);             // global node index within the super-node [0,NODES)
  const [selNpu, setSelNpu] = useState(-1);              // NPU within the selected node [0,8)
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tip, setTip] = useState<{ x: number; y: number; t: string } | null>(null);

  // clamp selections when the generation (→ counts) changes
  useEffect(() => { setSelSpod(0); setSelCab(0); setSelNode(0); setSelNpu(-1); }, [gen]);

  // replay loop
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setStep((s) => (s + 1) % (STEP_MAX + 1)), 650);
    return () => clearInterval(id);
  }, [playing]);

  const ev = step >= EVT_LO && step <= EVT_HI;
  const kind = PH[phase].kind;

  // ── the live per-NPU field (anchored to nodeLoad, perturbed by phase/step/event) ──
  const isStrag = useCallback((sp: number, gnode: number) => rnd(sp * 131 + gnode * 1.7 + step * 0.05) > 0.985, [step]);
  const faultAt = useCallback((sp: number, gnode: number, j: number) => {
    const k = sp * NPU_TOT + gnode * NPN + j, cab = (gnode / NODES_PER_CAB) | 0;
    return rnd(sp * 5 + k * 2.3 + step) > 0.9994 || (ev && sp === 0 && cab === EVT_CAB && j === 0 && rnd(gnode + step) > 0.7);
  }, [step, ev, EVT_CAB, NPU_TOT, NPN]);
  const util01 = useCallback((sp: number, gnode: number, j: number) => {
    const k = sp * NPU_TOT + gnode * NPN + j, cab = (gnode / NODES_PER_CAB) | 0;
    let u = nodeLoad(k, kind) + (PH[phase].base - 0.55);          // project field + 工况偏置
    u += (rnd(k * 0.91 + step * 0.07) - 0.5) * 0.10;              // live step ripple
    if (isStrag(sp, gnode)) u += 0.4;                            // straggler 拖后腿
    if (ev && sp === 0 && cab === EVT_CAB) u += 0.4;             // event-window overheat
    return clamp01(u);
  }, [kind, phase, step, ev, EVT_CAB, isStrag, NPU_TOT, NPN]);
  // metric the heatmap/axis colour BY (util / straggler 落后度 / 故障)
  const metricVal = useCallback((sp: number, gnode: number, j: number) => {
    if (metric === 'fault') return faultAt(sp, gnode, j) ? 0.95 : 0.12;
    const u = util01(sp, gnode, j);
    if (metric === 'strag') return isStrag(sp, gnode) ? 0.85 + rnd(sp * NPU_TOT + gnode * NPN + j) * 0.15 : Math.max(0, (u - 0.5)) * 0.4;
    return u;
  }, [metric, faultAt, util01, isStrag, NPU_TOT, NPN]);

  const nodeMean = useCallback((sp: number, gnode: number) => { let s = 0; for (let j = 0; j < NPN; j++) s += metricVal(sp, gnode, j); return s / NPN; }, [metricVal, NPN]);
  const cabMean = useCallback((sp: number, cab: number) => { let s = 0; for (let n = 0; n < NODES_PER_CAB; n++) s += nodeMean(sp, cab * NODES_PER_CAB + n); return s / NODES_PER_CAB; }, [nodeMean]);
  const spodMean = useCallback((sp: number) => { let s = 0; for (let c = 0; c < CAB; c++) s += cabMean(sp, c); return s / CAB; }, [cabMean, CAB]);

  const scopeMean = useCallback(() => {
    if (selLevel === 'cluster') { let s = 0; for (let i = 0; i < pods; i++) s += spodMean(i); return s / pods; }
    if (selLevel === 'super' || selLevel === 'rank') return spodMean(selSpod);
    if (selLevel === 'cab') return cabMean(selSpod, selCab);
    return nodeMean(selSpod, selNode);
  }, [selLevel, pods, selSpod, selCab, selNode, spodMean, cabMean, nodeMean]);

  const scopeName = useCallback(() => {
    if (selLevel === 'cluster') return `集群 · ${pods} 超节点`;
    if (selLevel === 'super' || selLevel === 'rank') return `超节点#${selSpod + 1}`;
    if (selLevel === 'cab') return `超节点#${selSpod + 1} · 机柜${selCab + 1}`;
    return `机柜${((selNode / NODES_PER_CAB) | 0) + 1} · 节点${(selNode % NODES_PER_CAB) + 1}`;
  }, [selLevel, pods, selSpod, selCab, selNode]);

  // ── KPI (always utilisation/fault-based, independent of the colour metric) ──
  const kpi = useMemo(() => {
    let sum = 0, red = 0, fa = 0;
    for (let gn = 0; gn < NODES; gn++) for (let j = 0; j < NPN; j++) {
      const u = util01(selSpod, gn, j); sum += u; if (loadState(u) >= 2) red++; if (faultAt(selSpod, gn, j)) fa++;
    }
    const n = NODES * NPN, redR = red / n, mfu = Math.round((sum / n) * 100 * (1 - redR * 0.4));
    return { redR, mfu, fa, stepMs: Math.round(92 + redR * 420 + (fa ? 40 : 0)) };
  }, [util01, faultAt, selSpod, NODES, NPN]);

  // ── hierarchy status-axis data (typical p50 · red% · peak p95 — exposes outliers) ──
  const axis = useMemo(() => {
    const cards: number[] = []; for (let gn = 0; gn < NODES; gn++) for (let j = 0; j < NPN; j++) cards.push(metricVal(selSpod, gn, j));
    const nodes: number[] = []; for (let gn = 0; gn < NODES; gn++) nodes.push(nodeMean(selSpod, gn));
    const cabs: number[] = []; for (let c = 0; c < CAB; c++) cabs.push(cabMean(selSpod, c));
    const spods: number[] = []; for (let i = 0; i < pods; i++) spods.push(spodMean(i));
    const pctl = (a: number[], p: number) => { const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
    const redF = (a: number[]) => { let c = 0; for (const v of a) if (loadState(v) >= 2) c++; return c / a.length; };
    const mk = (id: Level, nm: string, su: string, a: number[]) => ({ id, nm, su, p50: pctl(a, 0.5), p95: pctl(a, 0.95), red: redF(a) });
    return [
      mk('cluster', '集群', `${pods} 超节点`, spods),
      mk('super', `超节点#${selSpod + 1}`, `${NPU_TOT.toLocaleString()} NPU`, cards),
      mk('cab', '机柜', `${CAB} 柜`, cabs),
      mk('node', '节点', `${NODES.toLocaleString()} 节点`, nodes),
      mk('rank', 'rank/卡', `${NPU_TOT.toLocaleString()} 卡`, cards),
    ];
  }, [metricVal, nodeMean, cabMean, spodMean, selSpod, pods, CAB, NODES, NPU_TOT, NPN]);

  // ── flow-matrix cell intensity (real parallel relationships) ──
  // 对角=内部通信；Decode→EP All-to-All 全密；Prefill/预训练→近邻块(TP/PP)；事件机柜整行/列变红
  const flowCfg = (): [number, string] => ({
    cluster: [pods, '超节点 × 超节点 · DP 副本间'] as [number, string],
    super: [CAB, '机柜 × 机柜 · EP/TP 域'] as [number, string],
    rank: [CAB, '机柜 × 机柜 · EP/TP 域'] as [number, string],
    cab: [NODES_PER_CAB, '节点 × 节点'] as [number, string],
    node: [NPN, 'NPU × NPU · TP AllReduce'] as [number, string],
  }[selLevel]);
  const tcell = useCallback((i: number, j: number, N: number) => {
    let v = 0.16 + (i === j ? 0.5 : 0);
    if (phase === 'decode') v += 0.32;                                            // EP all-to-all 全密
    else if (phase === 'prefill') v += 0.08 + (Math.abs(i - j) <= Math.max(1, N / 8) ? 0.26 : 0);
    else v += 0.10 + (Math.abs(i - j) <= Math.max(1, N / 6) ? 0.20 : 0);
    v += (rnd(selSpod * 13 + (selCab + 2) * 7 + (selNode + 3) * 1.3 + i * 0.7 + j * 0.9 + step * 0.03) - 0.5) * 0.18;
    if (ev && selSpod === 0 && N === CAB && (i === EVT_CAB || j === EVT_CAB)) v += 0.35;
    return clamp01(v);
  }, [phase, selSpod, selCab, selNode, step, ev, CAB, EVT_CAB]);

  // ── plane utilisation (UB scale-up / RDMA scale-out / DP / VPC) by scope ──
  const planeUtil = useCallback(() => {
    const sm = scopeMean();
    return [
      { n: `${PLANES[0].short} · ${selLevel === 'node' ? '本节点' : '域内'}(TP/EP)`, u: Math.min(1, (phase === 'decode' ? 0.46 : 0.30) + sm * 0.6), c: PLANES[0].color },
      { n: `${PLANES[1].short}(DP/PP)`, u: Math.min(1, 0.24 + sm * 0.4 + (ev ? 0.10 : 0)), c: PLANES[1].color },
      { n: '集群 DP AllReduce', u: Math.min(1, 0.18 + sm * 0.32), c: PLANES[1].color },
      { n: `${PLANES[2].short} · 南北向`, u: 0.14, c: PLANES[2].color },
    ];
  }, [scopeMean, selLevel, phase, ev]);

  // ── communication domains (process↔process), active set depends on the scope ──
  const domains = useCallback(() => {
    const sm = scopeMean(), adj = (u: number) => Math.max(0.05, Math.min(1, u + (sm - 0.55) * 0.5));
    return [
      { key: 'tp', nm: PARTITION_META.tp.label, sc: '超节点内 SU', co: 'AllReduce ×4/层', me: `${NPN} rank/组`, u: adj(phase === 'decode' ? 0.5 : 0.72) },
      { key: 'sp', nm: 'SP 序列并行', sc: '与 TP 同域', co: 'AllGather + ReduceScatter', me: '与 TP', u: adj(phase === 'decode' ? 0.45 : 0.6) },
      { key: 'ep', nm: PARTITION_META.ep.label, sc: '超节点内 SU', co: 'AllToAll ×2/MoE层', me: `${NPC} rank/柜`, u: adj(phase === 'decode' ? 0.92 : 0.5) },
      { key: 'pp', nm: PARTITION_META.pp.label, sc: '跨节点', co: 'P2P send/recv', me: 'stage 间', u: adj(0.35) },
      { key: 'dp', nm: PARTITION_META.dp.label, sc: '跨超节点 SO', co: 'AllReduce ×1/step', me: '最外层', u: adj(0.4 + (ev ? 0.08 : 0)) },
    ];
  }, [scopeMean, phase, ev, NPN, NPC]);
  const domActive = useCallback((): Record<string, boolean> => {
    if (selLevel === 'cluster') return { tp: false, sp: false, ep: false, pp: true, dp: true };
    if (selLevel === 'rank') return { tp: true, sp: true, ep: true, pp: true, dp: true };
    return { tp: true, sp: true, ep: true, pp: false, dp: false };
  }, [selLevel]);

  // ───────────────────────── canvas ─────────────────────────
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const cells = useRef<{ x: number; y: number; w: number; h: number; kind: string; idx: number }[]>([]);
  const P = dark
    ? { bg: '#121418', grid: 'rgba(255,255,255,0.05)', track: '#262E3C', ink: 'rgba(255,255,255,0.88)', ink2: 'rgba(255,255,255,0.55)', mut: '#5A6172', frame: 'rgba(255,255,255,0.10)', neutral: '#39404e' }
    : { bg: '#fbfbfd', grid: 'rgba(67,105,239,0.08)', track: '#e4e7ef', ink: 'rgba(0,0,0,0.78)', ink2: 'rgba(0,0,0,0.52)', mut: '#9aa3b2', frame: 'rgba(0,0,0,0.10)', neutral: '#b9c2d4' };

  const draw = useCallback(() => {
    const cv = cvRef.current, wrap = wrapRef.current; if (!cv || !wrap) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
    const ctx = cv.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H);
    // drafting dot-grid backdrop (工程感)
    ctx.fillStyle = P.grid; for (let gx = 14; gx < W; gx += 22) for (let gy = 14; gy < H; gy += 22) { ctx.beginPath(); ctx.arc(gx, gy, 0.9, 0, 7); ctx.fill(); }
    cells.current = [];
    const tx = (s: string, x: number, y: number, c: string, f = '11px Inter', a: CanvasTextAlign = 'left') => { ctx.fillStyle = c; ctx.font = f; ctx.textAlign = a; ctx.fillText(s, x, y); ctx.textAlign = 'left'; };
    const bar = (x: number, y: number, w: number, h: number, u: number, c?: string) => { ctx.fillStyle = P.track; ctx.fillRect(x, y, w, h); ctx.fillStyle = c ?? loadColor(u); ctx.fillRect(x, y, w * u, h); };
    const PAD = 16;

    if (lens === 'heat') drawHeat(); else if (lens === 'flow') drawFlow(); else if (lens === 'domain') drawDomain(); else drawPhys();

    // ── 状态热力 ──
    function drawHeat() {
      type Item = { val: number; kind: string; idx: number; label: string };
      let items: Item[] | null = null;
      if (selLevel === 'cluster') items = Array.from({ length: pods }, (_, i) => ({ val: spodMean(i), kind: 'spod', idx: i, label: `超节点#${i + 1}` }));
      else if (selLevel === 'super') items = Array.from({ length: CAB }, (_, c) => ({ val: cabMean(selSpod, c), kind: 'cabc', idx: c, label: `机柜${c + 1}` }));
      else if (selLevel === 'cab') items = Array.from({ length: NODES_PER_CAB }, (_, n) => ({ val: nodeMean(selSpod, selCab * NODES_PER_CAB + n), kind: 'nodec', idx: selCab * NODES_PER_CAB + n, label: `节点${n + 1}` }));
      else if (selLevel === 'node') items = Array.from({ length: NPN }, (_, j) => ({ val: metricVal(selSpod, selNode, j), kind: 'npuc', idx: j, label: `NPU${j}` }));
      if (items) { drawUniform(items); return; }
      drawFull();   // rank → 全量铺开
    }
    function drawUniform(items: { val: number; kind: string; idx: number; label: string }[]) {
      const n = items.length, cols = n <= 4 ? 2 : n <= 16 ? 4 : n <= 64 ? 8 : Math.ceil(Math.sqrt(n * 1.6));
      const rows = Math.ceil(n / cols);
      const cw = (W - 2 * PAD - (cols - 1) * 4) / cols, ch = (H - 2 * PAD - (rows - 1) * 4) / rows;
      items.forEach((it, i) => {
        const c = i % cols, r = (i / cols) | 0, x = PAD + c * (cw + 4), y = PAD + r * (ch + 4);
        ctx.fillStyle = loadColor(it.val); ctx.fillRect(x, y, cw, ch);
        if (cw >= 64 && ch >= 30) { const ink = inkOf(loadColor(it.val)); tx(it.label, x + 9, y + 20, ink, '600 12px Inter'); tx(Math.round(it.val * 100) + '%', x + 9, y + 38, ink, `13px ${MONO}`); }
        cells.current.push({ x, y, w: cw, h: ch, kind: it.kind, idx: it.idx });
      });
    }
    function drawFull() {
      // 全量：NODES 个节点，每节点 = 4×2 NPU 小块；机柜用分隔线
      const PERROW = Math.min(NODES, Math.max(8, Math.round(Math.sqrt(NODES * 2.2))));
      const gridRows = Math.ceil(NODES / PERROW);
      const cs = Math.max(2, Math.min(8, Math.floor(Math.min((W - 2 * PAD) / (PERROW * 5), (H - 2 * PAD) / (gridRows * 3)))));
      const nbw = 4 * cs, nbh = 2 * cs, sx = nbw + cs, sy = nbh + cs;
      const x0 = PAD + (W - 2 * PAD - PERROW * sx) / 2, y0 = PAD;
      for (let gn = 0; gn < NODES; gn++) {
        const nx = x0 + (gn % PERROW) * sx, ny = y0 + ((gn / PERROW) | 0) * sy;
        for (let j = 0; j < NPN; j++) { ctx.fillStyle = loadColor(metricVal(selSpod, gn, j)); ctx.fillRect(nx + (j % 4) * cs, ny + ((j / 4) | 0) * cs, cs - 0.6, cs - 0.6); }
        if (gn === selNode) { ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.6; ctx.strokeRect(nx - 1.5, ny - 1.5, nbw + 1, nbh + 1); }
        cells.current.push({ x: nx, y: ny, w: nbw, h: nbh, kind: 'rankfull', idx: gn });
      }
      // cabinet separators (every NODES_PER_CAB nodes)
      tx(`全量 ${NPU_TOT.toLocaleString()} 张卡（每小块=1 节点=8 NPU · 每格=1 卡）· 点击下钻节点`, PAD, H - 10, P.mut, '11px Inter');
    }

    // ── 机柜流量：N×N 矩阵 + 平面带宽条 ──
    function drawFlow() {
      const [N, label] = flowCfg();
      const left = PAD + 26, top = PAD + 22;
      const matMax = Math.min(H - top - 30, W * 0.52);
      const cs = Math.max(2, Math.min(26, Math.floor(matMax / N)));
      tx(`${scopeName()} · ${label}`, left, top - 8, P.ink2, '12px Inter');
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { ctx.fillStyle = loadColor(tcell(i, j, N)); ctx.fillRect(left + j * cs, top + i * cs, cs - (cs > 5 ? 1 : 0.4), cs - (cs > 5 ? 1 : 0.4)); }
      // axis ticks
      const lab = N <= 8 ? 1 : N <= 32 ? 4 : 16;
      ctx.fillStyle = P.mut; ctx.font = `9px ${MONO}`;
      for (let i = 0; i < N; i += lab) { tx('' + (i + 1), left + i * cs, top - 1, P.mut, `9px ${MONO}`); tx('' + (i + 1), left - 22, top + i * cs + cs - 1, P.mut, `9px ${MONO}`); }
      tx('行/列 = 通信单元 · 对角=内部 · 颜色=通信强度(状态色)', left, top + N * cs + 18, P.mut, '10.5px Inter');
      // plane bars (right)
      const bx = left + N * cs + 54, bw = Math.max(120, W - bx - PAD - 10);
      tx('平面带宽利用（随选区）', bx, top - 8, P.ink2, '12px Inter');
      planeUtil().forEach((p, i) => { const y = top + 14 + i * 58; tx(p.n, bx, y - 6, P.ink2, '11px Inter'); bar(bx, y, bw, 16, p.u); tx(Math.round(p.u * 100) + '%', bx + bw - 30, y + 12, inkOf(loadColor(p.u)), `10px ${MONO}`); });
    }

    // ── 通信域：分组带 + 5 行并行(TP/SP/EP/PP/DP) ──
    function drawDomain() {
      tx(`通信域(进程↔进程) · ${scopeName()} · 进程=rank=1 NPU（硬件↔进程 1:1）`, PAD, PAD + 14, P.ink2, '12px Inter');
      const su = selLevel === 'node' ? { n: NPN, unit: 'rank', gs: NPN, gl: `本节点 ${NPN} rank = 1 TP 组` }
        : selLevel === 'cab' ? { n: NODES_PER_CAB, unit: '节点', gs: 4, gl: `每 4 节点(${4 * NPN} rank)= 1 EP 子组` }
        : selLevel === 'super' ? { n: CAB, unit: '机柜', gs: 2, gl: '机柜聚成 TP/EP 域(SU 域内)' }
        : selLevel === 'cluster' ? { n: pods, unit: '超节点', gs: 1, gl: '每超节点 = 1 个 DP 副本' }
        : { n: NPN, unit: 'rank', gs: NPN, gl: 'TP 组' };
      tx(`本层单元 ${su.n} 个 ${su.unit} · ${su.gl} · 高亮组=本层活跃并行`, PAD, PAD + 30, P.mut, '10.5px Inter');
      // group band
      const gx = PAD, gy = PAD + 40, gw = W - 2 * PAD;
      const cs = Math.max(5, Math.min(16, Math.floor(gw / Math.min(su.n, 64)))), cols = Math.max(1, Math.min(su.n, Math.floor(gw / cs)));
      for (let i = 0; i < su.n; i++) {
        const c = i % cols, r = (i / cols) | 0, x = gx + c * cs, y = gy + r * cs;
        ctx.fillStyle = P.neutral; ctx.fillRect(x, y, cs - 1, cs - 1);
        if (su.gs > 1 && i % su.gs === 0) { ctx.strokeStyle = ACCENT; ctx.lineWidth = 1; ctx.strokeRect(x - 0.5, y - 0.5, cs * Math.min(su.gs, cols - c), cs); }
      }
      const dy = gy + Math.ceil(su.n / cols) * cs + 18, rh = (H - dy - 14) / 5;
      const D = domains(), act = domActive();
      D.forEach((d, i) => {
        const a = act[d.key], y = dy + i * rh;
        ctx.globalAlpha = a ? 1 : 0.4;
        ctx.fillStyle = a ? loadColor(d.u) : P.neutral; ctx.fillRect(PAD, y, 168, Math.min(38, rh - 7));
        tx(d.nm, PAD + 9, y + 16, a ? inkOf(loadColor(d.u)) : P.ink2, '600 12px Inter');
        tx(a ? d.sc : d.sc + ' · 跨出本层', PAD + 9, y + 30, a ? inkOf(loadColor(d.u)) : P.mut, '9px Inter');
        tx(d.co, PAD + 184, y + 15, P.ink, '11px Inter'); tx(d.me, PAD + 184, y + 30, P.ink2, '9.5px Inter');
        const bx = PAD + 360, bw = W - bx - PAD;
        tx(a ? '集合通信量' : '(本层不直接发生)', bx, y + 9, P.mut, '9.5px Inter'); bar(bx, y + 14, bw, 15, a ? d.u : 0.03, a ? undefined : P.neutral);
        if (a) tx(Math.round(d.u * 100) + '%', bx + bw - 30, y + 26, inkOf(loadColor(d.u)), `10px ${MONO}`);
        ctx.globalAlpha = 1;
      });
    }

    // ── 物理链路：结构随层级、颜色=平面负载 ──
    function drawPhys() {
      const Pl = planeUtil();
      tx(`物理链路 · ${scopeName()} · 结构随层级、颜色=平面负载`, PAD, PAD + 14, P.ink2, '12px Inter');
      // plane bars (top-right mini)
      const bx = W - 200, bw = 168;
      tx('平面利用', bx, PAD + 14, P.ink2, '11px Inter');
      Pl.forEach((p, i) => { const y = PAD + 28 + i * 30; tx(p.n.split('·')[0].split('(')[0], bx, y - 3, P.ink2, '9px Inter'); bar(bx, y, bw, 11, p.u); tx(Math.round(p.u * 100) + '%', bx + bw - 26, y + 9, inkOf(loadColor(p.u)), `9px ${MONO}`); });
      const cx = (W - 200) / 2 + 10, cy = H / 2 + 10;
      const dot = (x: number, y: number, s: number, c: string, lab?: string) => { ctx.fillStyle = P.neutral; ctx.fillRect(x - s / 2, y - s / 2, s, s); ctx.strokeStyle = c; ctx.lineWidth = 1.4; ctx.strokeRect(x - s / 2, y - s / 2, s, s); if (lab) tx(lab, x, y + 3, P.ink, '9px Inter', 'center'); };
      const dia = (x: number, y: number, r: number, c: string, lab?: string) => { ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fillStyle = P.neutral; ctx.fill(); ctx.strokeStyle = c; ctx.lineWidth = 1.8; ctx.stroke(); if (lab) tx(lab, x, y + 3, P.ink, '9px Inter', 'center'); };
      const line = (x1: number, y1: number, x2: number, y2: number, c: string, w: number) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
      const ring = (n: number, r: number) => Array.from({ length: n }, (_, i) => { const t = -Math.PI / 2 + i * 2 * Math.PI / n; return [cx + r * Math.cos(t), cy + r * Math.sin(t)] as [number, number]; });
      const cUB = loadColor(Pl[0].u), cSO = loadColor(Pl[1].u), cVPC = loadColor(Pl[3].u);
      if (selLevel === 'cluster') {
        const pts = ring(pods, 130); for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) line(pts[i][0], pts[i][1], pts[j][0], pts[j][1], cSO, 3);
        pts.forEach((p, i) => dot(p[0], p[1], 54, PLANES[1].color, '超节点' + (i + 1)));
        tx(`${pods} 超节点经 NPU 自带 RoCE(400G) 全互联 · ${PLANES[1].short} · scale-out`, PAD, H - 12, P.ink2, '10px Inter');
      } else if (selLevel === 'super') {
        const pts = ring(Math.min(CAB, 24), 150); for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) line(pts[i][0], pts[i][1], pts[j][0], pts[j][1], cUB, 0.5);
        dia(cx, cy, 18, cUB, 'UB'); pts.forEach((p) => dot(p[0], p[1], 13, PLANES[0].color));
        tx(`${CAB} 机柜经两层 UB 交换 → UB-Mesh 全互联(any-to-any) · ${PLANES[0].short}`, PAD, H - 12, P.ink2, '10px Inter');
      } else if (selLevel === 'cab') {
        dia(cx, cy - 130, 17, cUB, 'L2'); const cols = Math.min(NODES_PER_CAB, 8);
        for (let i = 0; i < NODES_PER_CAB; i++) { const c = i % cols, r = (i / cols) | 0, x = cx - (cols - 1) * 22 / 2 + c * 22, y = cy + 20 + r * 34; line(x, y, cx, cy - 118, cUB, 0.6); dot(x, y, 13, PLANES[0].color, 'N' + (i + 1)); }
        tx(`${NODES_PER_CAB} 节点各 1 条 UB 上行 → 机柜 L2 交换 → 超节点 UB-Mesh`, PAD, H - 12, P.ink2, '10px Inter');
      } else if (selLevel === 'node' || selLevel === 'rank') {
        dia(cx, cy - 130, 20, cUB, 'L1');
        for (let j = 0; j < NPN; j++) { const x = cx - (NPN - 1) * 64 / 2 + j * 64, y = cy + 30; dot(x, y, 44, PLANES[0].color, 'NPU' + j); line(x, y - 22, cx, cy - 112, cUB, 3); line(x + 14, y + 22, x + 14, y + 40, cSO, 2); tx('口', x + 14, y + 52, P.mut, '8px Inter', 'center'); }
        ctx.fillStyle = P.neutral; ctx.fillRect(cx + 150, cy - 60, 86, 28); tx(`${TOK.kunpeng}CPU`, cx + 193, cy - 42, P.ink, '10px Inter', 'center'); line(cx + 150, cy - 46, cx + 6, cy - 120, cVPC, 2);
        ctx.fillStyle = P.neutral; ctx.fillRect(cx + 150, cy - 18, 86, 26); tx(`${NIC_LBL}NIC`, cx + 193, cy - 1, P.ink, '10px Inter', 'center'); line(cx + 193, cy - 32, cx + 193, cy - 18, cVPC, 2);
        tx(`${NPN} NPU 各 UB口+RDMA口 → L1；CPU→${NIC_LBL}NIC→VPC（器件级）`, PAD, H - 12, P.ink2, '10px Inter');
      }
    }
  }, [lens, selLevel, selSpod, selCab, selNode, pods, CAB, NODES, NPN, NPC, NPU_TOT, P, metricVal, nodeMean, cabMean, spodMean, scopeName, scopeMean, tcell, planeUtil, domains, domActive, flowCfg]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const onR = () => draw(); window.addEventListener('resize', onR); return () => window.removeEventListener('resize', onR);
  }, [draw]);

  // hover + click on the canvas
  const hitTest = (mx: number, my: number) => { for (const c of cells.current) if (mx >= c.x && mx <= c.x + c.w && my >= c.y && my <= c.y + c.h) return c; return null; };
  const onMove = (e: React.MouseEvent) => {
    if (lens !== 'heat') { if (tip) setTip(null); return; }
    const r = cvRef.current!.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, h = hitTest(mx, my);
    if (!h) { if (tip) setTip(null); return; }
    let t = '';
    if (h.kind === 'spod') t = `超节点#${h.idx + 1} · 平均 ${Math.round(spodMean(h.idx) * 100)}%`;
    else if (h.kind === 'cabc') t = `超节点#${selSpod + 1}·机柜${h.idx + 1} · 均值 ${Math.round(cabMean(selSpod, h.idx) * 100)}%`;
    else if (h.kind === 'nodec') t = `机柜${((h.idx / NODES_PER_CAB) | 0) + 1}·节点${(h.idx % NODES_PER_CAB) + 1} · 均值 ${Math.round(nodeMean(selSpod, h.idx) * 100)}%`;
    else if (h.kind === 'npuc') { const v = metricVal(selSpod, selNode, h.idx); t = `NPU${h.idx} (rank) · ${Math.round(v * 100)}% ${STATE_LABELS[loadState(v)]}`; }
    else if (h.kind === 'rankfull') { const cab = ((h.idx / NODES_PER_CAB) | 0) + 1, nl = (h.idx % NODES_PER_CAB) + 1, v = nodeMean(selSpod, h.idx); t = `机柜${cab}·节点${nl} · 均值 ${Math.round(v * 100)}%${isStrag(selSpod, h.idx) ? ' · ⚠ straggler' : ''}`; }
    setTip({ x: e.clientX, y: e.clientY, t });
  };
  const onClick = (e: React.MouseEvent) => {
    if (lens !== 'heat') return;
    const r = cvRef.current!.getBoundingClientRect(), h = hitTest(e.clientX - r.left, e.clientY - r.top); if (!h) return;
    if (h.kind === 'spod') { setSelSpod(h.idx); setSelCab(0); setSelNode(0); setSelNpu(-1); setSelLevel('super'); }
    else if (h.kind === 'cabc') { setSelCab(h.idx); setSelNode(h.idx * NODES_PER_CAB); setSelNpu(-1); setSelLevel('cab'); }
    else if (h.kind === 'nodec' || h.kind === 'rankfull') { setSelNode(h.idx); setSelCab((h.idx / NODES_PER_CAB) | 0); setSelNpu(-1); setSelLevel('node'); }
    else if (h.kind === 'npuc') { setSelNpu(h.idx); }
  };

  // ── level navigation (axis + breadcrumb) ──
  const setLevel = (id: Level) => {
    if (id === 'cab' && selLevel !== 'cab') setSelCab((c) => (c < 0 ? 0 : c));
    if (id === 'node') setSelNode((n) => (n < 0 ? selCab * NODES_PER_CAB : n));
    setSelLevel(id);
  };

  // breadcrumb segments
  const crumbs: { lvl: Level; label: string }[] = [{ lvl: 'cluster', label: `集群` }];
  if (selLevel !== 'cluster') crumbs.push({ lvl: 'super', label: `超节点#${selSpod + 1}` });
  if (selLevel === 'cab' || selLevel === 'node') crumbs.push({ lvl: 'cab', label: `机柜${selCab + 1}` });
  if (selLevel === 'node') crumbs.push({ lvl: 'node', label: `节点${(selNode % NODES_PER_CAB) + 1}` });

  // ── selection detail (right rail), all data-driven ──
  const sm = scopeMean();
  // step-time decomposition by 工况 (示意：compute/comm/mem share)
  const decomp = phase === 'decode' ? [['计算', 0.34, '#22d3ee'], ['通信(EP)', 0.46, '#ff4b7b'], ['访存(KV)', 0.20, '#a78bfa']]
    : phase === 'prefill' ? [['计算', 0.70, '#22d3ee'], ['通信', 0.18, '#ff4b7b'], ['访存', 0.12, '#a78bfa']]
    : [['计算', 0.58, '#22d3ee'], ['通信(AllReduce)', 0.30, '#ff4b7b'], ['访存', 0.12, '#a78bfa']];

  // detail: node/rank → per-NPU mini bars
  const nodeNpus = (selLevel === 'node' || selLevel === 'rank') ? Array.from({ length: NPN }, (_, j) => ({ j, u: util01(selSpod, selNode, j), fault: faultAt(selSpod, selNode, j) })) : null;
  const nodeIsStrag = nodeNpus ? isStrag(selSpod, selNode) : false;

  return (
    <div data-theme={dark ? 'dark' : 'light'} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' }}>
      {/* ── control header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '8px 14px', borderBottom: '1px solid var(--bd)' }}>
        {/* breadcrumb (shared selection) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
          <span style={{ color: 'var(--tx3)' }}>选区</span>
          {crumbs.map((c, i) => (
            <span key={c.lvl} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {i > 0 && <span style={{ color: 'var(--tx3)' }}>›</span>}
              <span onClick={() => setLevel(c.lvl)} style={{ cursor: 'pointer', color: c.lvl === selLevel ? 'var(--tx)' : '#5b86ff', fontWeight: c.lvl === selLevel ? 700 : 400 }}>{c.label}</span>
            </span>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={LBL}>工况</span>
          {(Object.keys(PH) as Phase[]).map((p) => (<button key={p} onClick={() => setPhase(p)} style={{ padding: '4px 11px', fontSize: 11.5, borderRadius: 7, cursor: 'pointer', ...navBtn(phase === p) }}>{PH[p].label}</button>))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={LBL}>着色</span>
          {([['util', '利用率'], ['strag', 'straggler'], ['fault', '故障']] as [Metric, string][]).map(([m, l]) => (<button key={m} onClick={() => setMetric(m)} style={{ padding: '4px 11px', fontSize: 11.5, borderRadius: 7, cursor: 'pointer', ...navBtn(metric === m) }}>{l}</button>))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={LBL}>镜头</span>
          {([['heat', '状态热力'], ['flow', '机柜流量'], ['domain', '通信域'], ['phys', '物理链路']] as [Lens, string][]).map(([v, l]) => (<button key={v} onClick={() => setLens(v)} style={{ padding: '4px 11px', fontSize: 11.5, borderRadius: 7, cursor: 'pointer', ...navBtn(lens === v) }}>{l}</button>))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={LBL}>回放</span>
          <button onClick={() => setPlaying((v) => !v)} style={{ width: 28, height: 28, borderRadius: '50%', cursor: 'pointer', ...navBtn(playing) }}>{playing ? '⏸' : '▶'}</button>
          <input type="range" min={0} max={STEP_MAX} value={step} onChange={(e) => setStep(+e.target.value)} style={{ width: 120, accentColor: ACCENT }} />
          <span style={{ fontSize: 11, color: ev ? '#e5484d' : 'var(--tx2)', fontFamily: MONO, minWidth: 92 }}>{`step ${step}${ev ? ' · 机柜事件' : ''}`}</span>
        </div>
      </div>

      {/* ── KPI strip ── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '10px 14px 4px' }}>
        {([
          [`${NPU_TOT.toLocaleString()}`, 'NPU / 超节点', 'var(--tx)'],
          [`${kpi.stepMs}ms`, 'step time(示意)', 'var(--tx)'],
          [`${kpi.mfu}%`, 'MFU(示意)', 'var(--tx)'],
          [`${(kpi.redR * 100).toFixed(1)}%`, '红区占比', stateColor(kpi.redR >= 0.1 ? 2 : kpi.redR >= 0.04 ? 1 : 0)],
          [`${kpi.fa}`, '故障 NPU', kpi.fa ? '#e5484d' : 'var(--tx2)'],
          [`${PH[phase].label} · #${step}`, '当前工况 / step', 'var(--tx)'],
        ] as [string, string, string][]).map(([v, l, c]) => (
          <div key={l} style={{ background: 'var(--panel-solid)', border: '1px solid var(--bd)', borderRadius: 10, padding: '7px 14px', minWidth: 96 }}>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: MONO, color: c, ...TNUM }}>{v}</div>
            <div style={{ fontSize: 10.5, color: 'var(--tx3)' }}>{l}</div>
          </div>
        ))}
      </div>

      {/* ── hierarchy status-axis (the shared selection nav) ── */}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, flexWrap: 'wrap', padding: '6px 14px 2px' }}>
        {axis.map((l, i) => (
          <div key={l.id} style={{ display: 'contents' }}>
            <div onClick={() => setLevel(l.id)} style={{
              flex: '1 1 0', minWidth: 132, cursor: 'pointer', padding: '7px 11px', borderRadius: 10,
              border: `1px solid ${selLevel === l.id ? ACCENT : 'var(--bd)'}`, background: selLevel === l.id ? 'var(--state-sel)' : 'var(--panel-solid)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--tx)' }}>{l.nm}</span>
                <span style={{ fontSize: 9.5, color: 'var(--tx3)' }}>{l.su}</span>
              </div>
              <div style={{ height: 8, background: 'var(--btn)', borderRadius: 5, overflow: 'hidden', margin: '5px 0 3px' }}>
                <div style={{ height: '100%', width: `${Math.round(l.p50 * 100)}%`, background: loadColor(l.p50), borderRadius: 5 }} />
              </div>
              <div style={{ fontSize: 9.5, color: 'var(--tx2)', fontFamily: MONO }}>{`典型 ${Math.round(l.p50 * 100)}% · 红区 ${(l.red * 100).toFixed(1)}% · 峰 ${Math.round(l.p95 * 100)}%`}</div>
            </div>
            {i < axis.length - 1 && <div style={{ alignSelf: 'center', color: 'var(--tx3)', padding: '0 4px', fontSize: 11 }}>▸</div>}
          </div>
        ))}
      </div>

      {/* ── main stage: enlarged lens canvas + detail rail ── */}
      <div style={{ flex: 1, display: 'flex', gap: 12, padding: '8px 14px 12px', minHeight: 0 }}>
        <div ref={wrapRef} style={{ flex: 1, minWidth: 0, position: 'relative', borderRadius: 12, border: '1px solid var(--bd)', overflow: 'hidden', background: 'var(--panel-solid)' }}>
          <canvas ref={cvRef} onMouseMove={onMove} onMouseLeave={() => setTip(null)} onClick={onClick} style={{ display: 'block', width: '100%', height: '100%', cursor: lens === 'heat' ? 'pointer' : 'default' }} />
        </div>

        {/* detail rail */}
        <div style={{ width: 268, flexShrink: 0, overflowY: 'auto', borderRadius: 12, border: '1px solid var(--bd)', background: 'var(--panel-solid)', padding: '12px 14px' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#5b86ff', marginBottom: 2 }}>{scopeName()}</div>
          <div style={{ fontSize: 11, color: 'var(--tx3)', marginBottom: 10 }}>{({ heat: '状态热力', flow: '机柜流量', domain: '通信域', phys: '物理链路' })[lens]} · {({ util: '利用率', strag: 'straggler 落后度', fault: '故障' })[metric]}</div>

          {/* scope summary */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 1, padding: '7px 9px', borderRadius: 8, background: 'var(--btn)' }}>
              <div style={{ fontSize: 15, fontWeight: 700, fontFamily: MONO, color: loadColor(sm) }}>{Math.round(sm * 100)}%</div>
              <div style={{ fontSize: 10, color: 'var(--tx3)' }}>选区平均负载</div>
            </div>
            <div style={{ flex: 1, padding: '7px 9px', borderRadius: 8, background: 'var(--btn)' }}>
              <div style={{ fontSize: 15, fontWeight: 700, fontFamily: MONO, color: 'var(--tx)' }}>{({ cluster: pods, super: CAB, cab: NODES_PER_CAB, node: NPN, rank: NPU_TOT } as Record<Level, number>)[selLevel].toLocaleString()}</div>
              <div style={{ fontSize: 10, color: 'var(--tx3)' }}>{({ cluster: '超节点', super: '机柜', cab: '节点', node: 'NPU', rank: '卡(rank)' } as Record<Level, string>)[selLevel]}</div>
            </div>
          </div>

          {/* step decomposition */}
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx2)', margin: '6px 0 5px' }}>step 时间分解（{PH[phase].label}）</div>
          {decomp.map(([nm, frac, c]) => (
            <div key={nm as string} style={{ marginBottom: 5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, marginBottom: 2 }}><span style={{ color: 'var(--tx)' }}>{nm}</span><span style={{ color: 'var(--tx3)', fontFamily: MONO }}>{Math.round((frac as number) * 100)}%</span></div>
              <div style={{ height: 7, borderRadius: 4, background: 'var(--btn)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${(frac as number) * 100}%`, background: c as string }} /></div>
            </div>
          ))}

          {/* node/rank → per-NPU mini bars + node↔L1↔CPU sketch */}
          {nodeNpus && (
            <>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx2)', margin: '12px 0 5px', display: 'flex', justifyContent: 'space-between' }}>
                <span>本节点 8 NPU(rank)</span>{nodeIsStrag && <span style={{ color: '#e5484d' }}>⚠ straggler</span>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 4 }}>
                {nodeNpus.map((p) => (
                  <div key={p.j} onClick={() => setSelNpu(p.j)} title={`NPU${p.j} · ${Math.round(p.u * 100)}%${p.fault ? ' · 故障' : ''}`} style={{ cursor: 'pointer', padding: '5px 4px', borderRadius: 6, background: loadColor(p.u), border: selNpu === p.j ? `2px solid ${ACCENT}` : `1px solid ${p.fault ? '#e5484d' : 'transparent'}`, textAlign: 'center' }}>
                    <div style={{ fontSize: 9.5, fontWeight: 700, color: inkOf(loadColor(p.u)) }}>{p.fault ? '✕' : `r${p.j}`}</div>
                    <div style={{ fontSize: 9, fontFamily: MONO, color: inkOf(loadColor(p.u)) }}>{Math.round(p.u * 100)}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10, color: 'var(--tx3)', marginTop: 6 }}>节点内 8 NPU 经 56G UB↔L1 · CPU 30G 接入 · 上联 L2（层间）</div>
            </>
          )}

          {/* legend */}
          <div style={{ borderTop: '1px solid var(--bd)', marginTop: 12, paddingTop: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx2)', marginBottom: 5 }}>状态色（红黄绿=状态，唯一一套）</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
              {STATE_LABELS.map((lb, i) => (<span key={lb} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--tx2)' }}><span style={{ width: 11, height: 11, borderRadius: 3, background: stateColor(i) }} />{lb}</span>))}
            </div>
            {(lens === 'flow' || lens === 'phys') && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx2)', marginBottom: 5 }}>三平面</div>
                {PLANES.map((p) => (<span key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--tx2)', marginBottom: 2 }}><span style={{ width: 12, height: 3, background: p.color, borderRadius: 1 }} />{p.short} · {p.parallel}</span>))}
              </div>
            )}
          </div>

          {/* cluster scale control (only meaningful at cluster level) */}
          <div style={{ borderTop: '1px solid var(--bd)', marginTop: 12, paddingTop: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx2)', marginBottom: 5 }}>集群规模（示意 · 超节点数）</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {[1, 2, 4, 8].map((c) => (<button key={c} onClick={() => { setPods(c); if (selSpod >= c) setSelSpod(0); }} style={{ padding: '4px 10px', fontSize: 11.5, borderRadius: 7, cursor: 'pointer', ...toggleBtn(pods === c, ACCENT) }}>×{c}</button>))}
            </div>
            <div style={{ fontSize: 10, color: 'var(--tx3)', marginTop: 6 }}>状态为示意（含 straggler / 故障注入 + 回放事件）。接 profiler 后替换 nodeLoad / 通信强度即可，结构与阈值不变。</div>
          </div>
        </div>
      </div>

      {tip && (
        <div style={{ position: 'fixed', left: tip.x + 12, top: tip.y + 12, pointerEvents: 'none', zIndex: 30, background: 'var(--panel-solid)', border: '1px solid var(--bd2)', borderRadius: 7, padding: '5px 9px', fontSize: 11.5, color: 'var(--tx)', boxShadow: 'var(--shadow-sm)', whiteSpace: 'nowrap' }}>{tip.t}</div>
      )}
    </div>
  );
}

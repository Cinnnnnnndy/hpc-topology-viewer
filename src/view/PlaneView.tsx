/**
 * PlaneView — a flat 2-D "tiled" diagram of the full super-node, complementary to
 * the 3-D full-pod view (which it does not touch). Drawn on a 2-D <canvas> so it
 * scales to the full ~8 K-card super-node. Nesting shows the physical containment
 * (super-node → cabinet → blade → card); colour shows parallel-group relationships
 * (TP/PP/DP/EP). Pan = drag, zoom = wheel, hover a card for its identity.
 *
 * Display text with brand terms is sourced from ../content (decoded at runtime).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GENERATIONS, PARTITION_PALETTE, PARALLEL_COLORS, PARTITION_META, UB_LEVELS, COMM_PATTERNS, LAYER_INFO, CORES_PER_CARD, ENTITY_COLORS, UB_COORD, RUN_SCHED, PLANES, LEVEL_PHYS, loadColor, nodeLoad, isHot, stateColor, type Gen, type PartitionDim, type RunMode, type RunPhase } from '../scene/data';
import { TOK } from '../content';
import { PlanesPanel } from './PlanesPanel';

// short plane tag per level (drawn in the narrow 层级图 axis gutter)
const PLANE_TAG: Record<string, string> = { ub: 'UB·SU', rdma: 'RDMA·SO', multi: '多平面', none: '片上' };
// physical-device accent colours (drawn as objects inside node glyphs / blade frames)
const DEV_CPU = '#4a8cff';   // 鲲鹏 CPU
const DEV_LPO = '#36e0c4';   // LPO 光模块

const CPB = 8, BPC = 8;   // cards / blade, blades / cabinet (= 64 NPU / cabinet)
const AXIS_GUTTER = 100, RIGHT_PAD = 10;   // layered view: fixed px gutter for constant-size axis labels + right pad (matrix fills the rest)
const SEL = '#4369ef';   // selection / hover highlight = PTO primary (was gold)
// plane views keep the ORIGINAL hierarchy/type colours (looks better here); state heatmap still
// overlays during playback. (the 3-D array view stays de-RYG neutral.)
const M_DIE = ENTITY_COLORS.computeDie, M_CUBE = ENTITY_COLORS.cube, M_VEC = ENTITY_COLORS.vector, M_IO = ENTITY_COLORS.ioDie;
// rounded-rect path (shared glyph language with the layered view)
function rrPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad); ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad); ctx.arcTo(x, y, x + w, y, rad); ctx.closePath();
}
// ── simplified abstract glyphs for the physical devices — same flat solid-block +
// inset-detail language as cabinet/blade/card/die, so they read as objects (not text):
//   cpu = chip (inset die + edge pins) · switch = fabric (top ports + crossing) ·
//   lpo = optical module (lanes + lens) · nic = network card (port slot + connector tab) ·
//   port = a small connector tab (UB 绿 / RDMA 橙). cx,cy = centre · w,h = footprint. ──
type DevType = 'cpu' | 'switch' | 'lpo' | 'nic' | 'port';
function devGlyph(ctx: CanvasRenderingContext2D, type: DevType, cx: number, cy: number, w: number, h: number, color: string) {
  const x = cx - w / 2, y = cy - h / 2, DK = 'rgba(0,0,0,0.34)', LT = 'rgba(255,255,255,0.82)', mn = Math.min(w, h);
  ctx.fillStyle = color;
  if (type === 'port') {   // connector tab with a notch
    rrPath(ctx, x, y, w, h, mn * 0.3); ctx.fill();
    ctx.fillStyle = DK; ctx.fillRect(x + w * 0.42, y + h * 0.18, w * 0.16, h * 0.64); return;
  }
  rrPath(ctx, x, y, w, h, mn * 0.2); ctx.fill();
  if (type === 'cpu') {            // chip: inset die + edge pins
    ctx.fillStyle = DK; rrPath(ctx, x + w * 0.27, y + h * 0.24, w * 0.46, h * 0.52, mn * 0.08); ctx.fill();
    ctx.fillStyle = color; for (let i = 0; i < 3; i++) { const py = y + h * (0.26 + i * 0.24); ctx.fillRect(x - w * 0.08, py, w * 0.08, h * 0.12); ctx.fillRect(x + w, py, w * 0.08, h * 0.12); }
  } else if (type === 'switch') {  // fabric: top ports + crossing lines
    ctx.fillStyle = color; for (let i = 0; i < 4; i++) ctx.fillRect(x + w * (0.1 + i * 0.24), y - h * 0.16, w * 0.1, h * 0.18);
    ctx.strokeStyle = LT; ctx.lineWidth = mn * 0.07; ctx.beginPath();
    ctx.moveTo(x + w * 0.26, y + h * 0.38); ctx.lineTo(x + w * 0.74, y + h * 0.72); ctx.moveTo(x + w * 0.74, y + h * 0.38); ctx.lineTo(x + w * 0.26, y + h * 0.72); ctx.stroke();
  } else if (type === 'lpo') {     // optical module: 2 lanes + a lens
    ctx.strokeStyle = LT; ctx.lineWidth = h * 0.1; ctx.beginPath();
    ctx.moveTo(x + w * 0.12, y + h * 0.36); ctx.lineTo(x + w * 0.52, y + h * 0.36); ctx.moveTo(x + w * 0.12, y + h * 0.64); ctx.lineTo(x + w * 0.52, y + h * 0.64); ctx.stroke();
    ctx.fillStyle = LT; ctx.beginPath(); ctx.arc(x + w * 0.74, y + h * 0.5, mn * 0.16, 0, 7); ctx.fill();
  } else if (type === 'nic') {     // network card: port slot + bottom connector tab
    ctx.fillStyle = DK; ctx.fillRect(x + w * 0.2, y + h * 0.28, w * 0.42, h * 0.18);
    ctx.fillStyle = color; ctx.fillRect(x + w * 0.4, y + h, w * 0.2, h * 0.2);
  }
}
// ── L0 执行时序 swimlane (核 × 时间) — segmented by the SAME train/infer phases as the
// 3-D full-pod view (load→Forward→Backward→AllReduce→optimizer). Each phase colours the
// cores by what they do: 计算(绿) / 访存(橙) / 通信等待(粉) / 加载(蓝) / 流水气泡(空).
// Deterministic per card so it's stable; a playhead sweeps the phases like the 3-D 时序. ──
function mulberry(seed: number) { return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const SW_T = 60;
const SW_LANES = ['AIC·Cube 0', 'AIC·Cube 1', 'AIV·Vector 0', 'AIV·Vector 1', 'AIV·Vector 2', 'MTE·DMA 搬运'];
const SW_COLOR: Record<string, string> = { compute: '#04d793', mem: '#ffaa3b', comm: '#ff4b7b', load: '#60a5fa', bubble: '' };
interface SwSeg { p: RunPhase; t0: number; t1: number; }
// phase timeline (normalised 0..1 segments) shared by the swimlane AND the top-view
// playback wash — compute phases run longer, so the cards dwell on the compute colour.
function phaseSegments(mode: RunMode): SwSeg[] {
  const phases = RUN_SCHED[mode];
  const wOf = (p: RunPhase) => (p.kind === 'compute' ? 3 : p.kind === 'comm' ? 1.4 : 1);
  const tw = phases.reduce((s, p) => s + wOf(p), 0);
  const seg: SwSeg[] = []; let acc = 0;
  for (const p of phases) { const t0 = acc / tw; acc += wOf(p); seg.push({ p, t0, t1: acc / tw }); }
  return seg;
}
function runSwimlane(k: number, mode: RunMode) {
  const seg = phaseSegments(mode);
  const phaseAt = (t: number) => seg.find((s) => t < s.t1)?.p ?? seg[seg.length - 1].p;
  const rng = mulberry((k * 2654435761 + 7) >>> 0);
  let comp = 0, mem = 0, bub = 0, tot = 0;
  const rows = SW_LANES.map((name, li) => {
    const isMte = li === SW_LANES.length - 1;   // last lane = the DMA / 搬运 engine (busy on load/store/comm)
    const slots = Array.from({ length: SW_T }, (_, t) => {
      const ph = phaseAt((t + 0.5) / SW_T), r = rng();
      let st: string;
      if (ph.kind === 'comm') st = isMte ? (r < 0.75 ? 'comm' : 'mem') : r < 0.5 ? 'comm' : r < 0.82 ? 'bubble' : 'mem';   // cores block on the collective → 气泡
      else if (ph.kind === 'load') st = isMte ? 'load' : r < 0.35 ? 'load' : 'bubble';
      else if (ph.kind === 'store' || ph.kind === 'mem') st = isMte ? 'mem' : r < 0.5 ? 'compute' : r < 0.82 ? 'mem' : 'bubble';
      else st = isMte ? (r < 0.45 ? 'mem' : 'bubble') : r < 0.82 ? 'compute' : r < 0.92 ? 'mem' : 'bubble';   // compute phase
      tot++; if (st === 'compute') comp++; else if (st === 'mem' || st === 'load') mem++; else if (st === 'bubble') bub++;
      return st;
    });
    return { name, slots };
  });
  return { rows, seg, util: Math.round((comp / tot) * 100), mem: Math.round((mem / tot) * 100), bub: Math.round((bub / tot) * 100) };
}
const COLOR_BTNS: { id: PartitionDim; label: string }[] = [
  { id: 'none', label: '无' }, { id: 'tp', label: 'TP' }, { id: 'pp', label: 'PP' }, { id: 'dp', label: 'DP' }, { id: 'ep', label: 'EP' },
];
// ── shared button language (solid colour blocks for emphasis, filled-secondary otherwise) ──
const ACCENT = '#4369ef';
const SECONDARY: React.CSSProperties = { border: '1px solid var(--btn-bd)', background: 'var(--btn)', color: 'var(--tx2)' };
function inkOf(hex: string): string {
  const h = hex.replace('#', ''); if (h.length < 6) return '#fff';
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#10131a' : '#fff';
}
function navBtn(active: boolean): React.CSSProperties {
  return active ? { border: `1px solid ${ACCENT}`, background: ACCENT, color: '#fff', fontWeight: 600, boxShadow: '0 1px 3px rgba(67,105,239,0.40)' } : { ...SECONDARY };
}
function toggleBtn(active: boolean, c: string): React.CSSProperties {
  return active ? { border: `1px solid ${c}`, background: c, color: inkOf(c), fontWeight: 600 } : { ...SECONDARY };
}
const LBL: React.CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: 0.4, color: 'var(--tx3)' };
const TNUM: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };
const MONO = "'JetBrains Mono', 'Consolas', ui-monospace, monospace";   // canvas numeric labels

export function PlaneView({ gen, dark }: { gen: Gen; dark: boolean }) {
  const spec = GENERATIONS[gen];
  // canvas-2D palette (cannot use CSS var() in fillStyle/strokeStyle)
  const P = dark
    ? { bg: '#101010', cardBd: 'rgba(255,255,255,0.10)', cardN: '#39404e', ink: 'rgba(255,255,255,0.82)', ink2: 'rgba(255,255,255,0.55)', grid: 'rgba(255,255,255,0.05)', frameFill: 'rgba(167,139,250,0.20)', frameBd: 'rgba(167,139,250,0.30)', bladeFill: 'rgba(96,165,250,0.12)' }
    : { bg: '#f3f4f7', cardBd: 'rgba(0,0,0,0.10)', cardN: '#b9c2d4', ink: 'rgba(0,0,0,0.66)', ink2: 'rgba(0,0,0,0.55)', grid: 'rgba(67,105,239,0.10)', frameFill: 'rgba(167,139,250,0.18)', frameBd: 'rgba(167,139,250,0.34)', bladeFill: 'rgba(96,165,250,0.13)' };
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tf = useRef<{ s: number; tx: number; ty: number } | null>(null);   // world→screen transform
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const hoverRef = useRef<number | null>(null);
  const [colorBy, setColorBy] = useState<PartitionDim>('none');
  const [links, setLinks] = useState(true);   // draw card↔card (L1) + node↔node (L2) connections
  const [tip, setTip] = useState<{ k: number; x: number; y: number } | null>(null);
  const [playing, setPlaying] = useState(false);    // 执行时序 playback (drives card phase-wash + flow + swimlane) — paused by default
  const [runMode, setRunMode] = useState<RunMode>('train');   // 执行时序 mode: train / infer
  const [scenario, setScenario] = useState<'ring' | 'a2a'>('ring');
  const [layout, setLayout] = useState<'top' | 'layers'>('top');   // top-down map vs. layered hierarchy
  const [legendOpen, setLegendOpen] = useState(true);   // collapsible legend (avoids occluding the diagram on small screens)
  const [swOpen, setSwOpen] = useState(true);   // 执行时序 swimlane shown by default
  const [selL, setSelL] = useState<{ lvl: number; idx: number } | null>(null);   // layered-view selection
  const [selTop, setSelTop] = useState<{ k: number; die?: number; core?: number } | null>(null);   // top-view selection (card, or a Die / AI Core when zoomed in)
  const downXY = useRef<{ x: number; y: number } | null>(null);   // pointer-down (click vs drag)
  const phaseRef = useRef(0);                       // flow (marching-ants) animation phase
  const headRef = useRef(0);                        // 执行时序 play head (0..1), shared by the card-wash + swimlane
  const lastPhaseRef = useRef('');                  // last-drawn phase id (skip redundant overview redraws)
  const rafRef = useRef<number | null>(null);

  // ── layout in world units ──
  const L = (() => {
    const N1 = spec.totalNpus;
    const nB = Math.ceil(N1 / CPB), nC = Math.ceil(nB / BPC);
    const cCols = Math.ceil(Math.sqrt(nC)), cRows = Math.ceil(nC / cCols);
    const cs = 1, gap = 0.3, bpad = 0.5, bgap = 0.5;
    const bw = 4 * (cs + gap) - gap + bpad * 2;        // blade: 4 cols × 2 rows
    const bh = 2 * (cs + gap) - gap + bpad * 2;
    const cpad = 0.9, cgap = 1.6;
    const cw = 2 * bw + bgap + cpad * 2;               // cabinet: 2 blade cols × 4 rows
    const ch = 4 * bh + 3 * bgap + cpad * 2;
    const tw = cCols * cw + (cCols - 1) * cgap;
    const th = cRows * ch + (cRows - 1) * cgap;
    return { N1, nB, nC, cCols, cRows, cs, gap, bpad, bgap, bw, bh, cpad, cgap, cw, ch, tw, th, PP: Math.min(16, nB) };
  })();

  const cabXY = (cab: number): [number, number] => [(cab % L.cCols) * (L.cw + L.cgap), Math.floor(cab / L.cCols) * (L.ch + L.cgap)];
  const bladeXY = (cab: number, bl: number): [number, number] => { const [cx, cy] = cabXY(cab); return [cx + L.cpad + (bl % 2) * (L.bw + L.bgap), cy + L.cpad + Math.floor(bl / 2) * (L.bh + L.bgap)]; };
  const cardXY = (k: number): [number, number] => {
    const b = Math.floor(k / CPB), l = k % CPB, cab = Math.floor(b / BPC), bl = b % BPC;
    const [bx, by] = bladeXY(cab, bl);
    return [bx + L.bpad + (l % 4) * (L.cs + L.gap), by + L.bpad + Math.floor(l / 4) * (L.cs + L.gap)];
  };
  const groupOf = (k: number): number => {
    const b = Math.floor(k / CPB);
    if (colorBy === 'tp') return k % CPB;
    if (colorBy === 'pp') return b % L.PP;
    if (colorBy === 'dp') return Math.floor(b / L.PP);
    if (colorBy === 'ep') return Math.floor(b / BPC);
    return -1;
  };
  const cfg = `TP${CPB}×PP${L.PP}×DP${Math.max(1, Math.round(L.nB / L.PP))}`;

  // ── layered-hierarchy layout: each level is MATRIX-PACKED into a square-ish grid
  // (like the top view), the grids stacked top→bottom by level. Formula-based (no
  // per-unit arrays) so the full pod — incl. 16K Die / ~300K AI Core — costs nothing.
  // Levels: 超节点 → 机柜 → 节点 → 卡/NPU(1 device · 内含 4 Die) → AI Core.
  // HARDWARE containment only; rank is software, bound 1:1 to the card-device. ──
  const LAY = useMemo(() => {
    const N = spec.totalNpus, nCab = Math.max(1, Math.round(N / 64));
    const margin = 11, Wc = 100, gap = 2.4;   // wider canvas
    // FULL chain numbered by the UB L0–L7 coordinate (rank is software, shown separately):
    // L5 超节点 → [机柜] → L4 节点 → L3 卡/device → L2 计算 Die(×2/卡) → L1 AI Core(×16/Die)
    // → L0 Tile. 机柜 has no own L (并入机器域). L6/L7 集群·作业 are NOT shown — this view is
    // exactly ONE super-node. The super level is a full-width banner; the rest are matrices. `ar`: smaller → bigger cells.
    // `ar` = grid width:height → cols = √(count·ar); a level's WORLD height = Wc/ar, so
    // higher ar ⇒ more per row AND shorter. The huge fine levels (L2/L1/L0) get high ar so
    // they're COMPACT at overview (you can't scan 1M tiles) and aggregate; L0 in particular
    // is an aggregate observation strip (流水气泡/访存), with per-cell detail only on drill.
    const defs = [
      { kind: 'super',   count: 1,                 color: ENTITY_COLORS.super,      label: 'L5 超节点',     banner: true,  ar: 5.4 },
      { kind: 'cab',     count: nCab,               color: ENTITY_COLORS.cab,       label: '机柜',          banner: false, ar: 32 },
      { kind: 'node',    count: nCab * 8,           color: ENTITY_COLORS.node,      label: 'L4 节点/刀片',  banner: false, ar: 14 },
      { kind: 'card',    count: N,                  color: ENTITY_COLORS.card,      label: 'L3 卡/device',  banner: false, ar: 5.0 },
      { kind: 'die',     count: N * 2,              color: ENTITY_COLORS.computeDie, label: 'L2 计算 Die',  banner: false, ar: 6.0 },
      { kind: 'core',    count: N * CORES_PER_CARD, color: ENTITY_COLORS.cube,      label: 'L1 AI Core',    banner: false, ar: 8.0 },
      { kind: 'tile',    count: N * CORES_PER_CARD * 4, color: ENTITY_COLORS.vector, label: 'L0 Tile/lane',  banner: false, ar: 20 },
    ];
    let y = margin;
    const levels = defs.map((d, li) => {
      if (d.banner) { const h = 3.6, y0 = y; y += h + gap * 1.1; return { ...d, cols: 1, cell: Wc, rows: 1, y0, h, grp: 1 }; }
      const cols = Math.max(1, Math.round(Math.sqrt(d.count * d.ar)));
      const cell = Wc / cols, rows = Math.ceil(d.count / cols), h = rows * cell, y0 = y;
      y += h + gap;
      return { ...d, cols, cell, rows, y0, h, grp: d.count / defs[li - 1].count };   // grp = children per parent
    });
    // ── 器件互联平面 (device-interconnect plane): a SEPARATE band below the containment
    //    tree — the super-node's FULL complement of NPU / CPU / LPO / NIC as four matrices
    //    (全量), plus a representative 刀片 wiring schematic naming the 5 link types
    //    (板内 NPU mesh · 板间 NPU · NPU-CPU · NPU-LPO · NIC-CPU). It is NOT part of the
    //    containment selection tree (these are SIBLING devices, not parent/child), so it
    //    lives in `dev`, leaving `levels`/grp/层级选择 untouched. ──
    const nNode = nCab * 8;                                   // 刀片(节点) total
    const PER = { npu: 8, cpu: 4, lpo: 4, nic: 4 };           // schematic per-node device count (real config not public)
    const devDefs = [
      { kind: 'npu_d', count: N,               color: ENTITY_COLORS.card, label: 'NPU',  per: PER.npu, ar: 5.0 },
      { kind: 'cpu_d', count: nNode * PER.cpu, color: DEV_CPU,            label: 'CPU',  per: PER.cpu, ar: 7.0 },
      { kind: 'lpo_d', count: nNode * PER.lpo, color: DEV_LPO,            label: 'LPO',  per: PER.lpo, ar: 7.0 },
      { kind: 'nic_d', count: nNode * PER.nic, color: PLANES[2].color,    label: 'NIC',  per: PER.nic, ar: 7.0 },
    ];
    y += gap * 1.6;
    const devHeaderH = 3.2, devHeaderY = y; y += devHeaderH + gap * 1.1;
    const wiringH = 27, wiringY = y; y += wiringH + gap * 1.5;
    const mats = devDefs.map((d) => {
      const cols = Math.max(1, Math.round(Math.sqrt(d.count * d.ar)));
      const cell = Wc / cols, rows = Math.ceil(d.count / cols), h = rows * cell, y0 = y;
      y += h + gap;
      return { ...d, cols, cell, rows, y0, h };
    });
    const dev = { headerY: devHeaderY, headerH: devHeaderH, wiringY, wiringH, mats, nNode, per: PER };
    return { levels, dev, margin, Wc, w: margin * 2 + Wc, h: y - gap + margin, cabN: nCab, cardN: N, coreN: N * CORES_PER_CARD };
  }, [spec]);

  // formula cell centre (level li, unit index i) — no stored arrays
  const cellXY = (li: number, i: number): [number, number] => {
    const Lv = LAY.levels[li];
    if (Lv.banner) return [LAY.margin + LAY.Wc / 2, Lv.y0 + Lv.h / 2];
    const c = i % Lv.cols, r = Math.floor(i / Lv.cols);
    return [LAY.margin + (c + 0.5) * Lv.cell, Lv.y0 + (r + 0.5) * Lv.cell];
  };

  const ext = layout === 'layers' ? { tw: LAY.w, th: LAY.h } : { tw: L.tw, th: L.th };
  // layered matrix is tall → fit the matrix WIDTH to the screen minus a fixed label gutter
  // (axis labels are constant px, drawn in the gutter), so it maximises screen width.
  const fit = useCallback((W: number, H: number) => layout === 'layers' ? (W - AXIS_GUTTER - RIGHT_PAD) / LAY.Wc : Math.min(W / ext.tw, H / ext.th) * 0.92, [ext.tw, ext.th, layout, LAY.Wc]);

  // hit-test a world point → card index (O(1) via the grid math)
  const pick = (wx: number, wy: number): number | null => {
    const cc = Math.floor(wx / (L.cw + L.cgap)), cr = Math.floor(wy / (L.ch + L.cgap));
    if (cc < 0 || cc >= L.cCols || cr < 0) return null;
    const cab = cr * L.cCols + cc; if (cab >= L.nC) return null;
    let lx = wx - cc * (L.cw + L.cgap) - L.cpad, ly = wy - cr * (L.ch + L.cgap) - L.cpad;
    const blc = Math.floor(lx / (L.bw + L.bgap)), blr = Math.floor(ly / (L.bh + L.bgap));
    if (blc < 0 || blc >= 2 || blr < 0 || blr >= 4) return null;
    const bl = blr * 2 + blc, blade = cab * BPC + bl; if (blade >= L.nB) return null;
    lx -= blc * (L.bw + L.bgap) + L.bpad; ly -= blr * (L.bh + L.bgap) + L.bpad;
    const lc = Math.floor(lx / (L.cs + L.gap)), lr = Math.floor(ly / (L.cs + L.gap));
    if (lc < 0 || lc >= 4 || lr < 0 || lr >= 2) return null;
    if (lx - lc * (L.cs + L.gap) > L.cs || ly - lr * (L.cs + L.gap) > L.cs) return null;   // in the gap
    const k = blade * CPB + (lr * 4 + lc);
    return k < L.N1 ? k : null;
  };

  // finer top-view pick: inside a card, resolve which compute Die / AI Core was clicked
  // (only when zoomed in enough that the drill is actually drawn — mirrors the draw geometry).
  // IO Die / card body → {} (card-level). Returns { die?, core? }.
  const subPick = (wx: number, wy: number, k: number): { die?: number; core?: number } => {
    const s = tf.current?.s ?? 0; if (s <= 26) return {};
    const [x, y] = cardXY(k);
    const ins = L.cs * 0.14, gp = L.cs * 0.07;
    const dw = (L.cs - ins * 2 - gp) / 2, dh = (L.cs * 0.7 - gp) / 2;
    const x0 = x + ins, x1 = x + ins + dw + gp, y0 = y + L.cs * 0.28;
    const inR = (rx: number, ry: number) => wx >= rx && wx <= rx + dw && wy >= ry && wy <= ry + dh;
    let die: number, dx: number;
    if (inR(x0, y0)) { die = 0; dx = x0; } else if (inR(x1, y0)) { die = 1; dx = x1; } else return {};   // only the 2 compute Die are selectable
    if (s <= 74) return { die };
    const pad = dw * 0.1, gxx = dw * 0.06, gyy = dh * 0.08;
    const cw = (dw - pad * 2 - gxx) / 2, ch = (dh - pad * 2 - gyy) / 2;
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
      const cx = dx + pad + c * (cw + gxx), cy = y0 + pad + r * (ch + gyy);
      if (wx >= cx && wx <= cx + cw && wy >= cy && wy <= cy + ch) return { die, core: r * 2 + c };
    }
    return { die };
  };

  // layered view: hit-test world point → { level, grid cell index }
  const pickLayer = (wx: number, wy: number): { lvl: number; idx: number } | null => {
    for (let li = 0; li < LAY.levels.length; li++) {
      const Lv = LAY.levels[li]; if (wy < Lv.y0 || wy > Lv.y0 + Lv.h) continue;
      const c = Math.floor((wx - LAY.margin) / Lv.cell), r = Math.floor((wy - Lv.y0) / Lv.cell);
      if (c < 0 || c >= Lv.cols) return null;
      const idx = r * Lv.cols + c;
      if (idx >= 0 && idx < Lv.count) return { lvl: li, idx };
    }
    return null;
  };
  // Selected up/down-stream chain as a CONTIGUOUS [lo,hi) index range per level
  // (hierarchy is index-ordered, so ancestors/descendants are contiguous) → O(levels).
  const layRange = (): { lo: number[]; hi: number[] } | null => {
    if (!selL) return null;
    const n = LAY.levels.length, lo = Array(n).fill(0), hi = Array(n).fill(1);
    lo[selL.lvl] = selL.idx; hi[selL.lvl] = selL.idx + 1;
    for (let l = selL.lvl; l > 0; l--) { lo[l - 1] = Math.floor(lo[l] / LAY.levels[l].grp); hi[l - 1] = lo[l - 1] + 1; }
    for (let l = selL.lvl; l < n - 1; l++) { lo[l + 1] = lo[l] * LAY.levels[l + 1].grp; hi[l + 1] = hi[l] * LAY.levels[l + 1].grp; }
    return { lo, hi };
  };

  const draw = useCallback(() => {
    const cv = canvasRef.current, wrap = wrapRef.current; if (!cv || !wrap) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
    if (!tf.current) { const f = fit(W, H); tf.current = layout === 'layers' ? { s: f, tx: AXIS_GUTTER - LAY.margin * f, ty: H * 0.04 } : { s: f, tx: (W - ext.tw * f) / 2, ty: (H - ext.th * f) / 2 }; }
    const { s, tx, ty } = tf.current;
    const ctx = cv.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;   // context state persists across frames; force a fully-opaque clear (no ghosting)
    ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H);
    // engineering dot-grid backdrop (screen-space, fixed pitch; offset by the pan so it
    // reads like a drafting board / blueprint and gives the flat diagram 工程感)
    { const gpitch = 24, ox = ((tx % gpitch) + gpitch) % gpitch, oy = ((ty % gpitch) + gpitch) % gpitch;
      ctx.fillStyle = P.grid;
      for (let gx = ox; gx < W; gx += gpitch) for (let gy = oy; gy < H; gy += gpitch) { ctx.beginPath(); ctx.arc(gx, gy, 0.9, 0, 7); ctx.fill(); } }
    ctx.save(); ctx.translate(tx, ty); ctx.scale(s, s);

    // OBSERVATION over COGNITION: while the 执行时序 plays, nodes/cells show a LOAD heatmap
    // (绿空闲→黄→红繁忙); when idle, hierarchy is a FAINT muted hue (shapes carry the level).
    // High-saturation colour is reserved for state. Same headRef clock as the swimlane.
    const runSeg = phaseSegments(runMode);
    const curPhase = playing ? (runSeg.find((sg) => headRef.current < sg.t1)?.p ?? runSeg[runSeg.length - 1].p) : null;
    const heatOf = (id: number) => loadColor(nodeLoad(id, curPhase?.kind));   // per-node load colour
    // per-LINK load 0..1 = avg of its two endpoints' load + a band tendency (so individual links
    // within a level differ in colour AND thickness, not just level-by-level).
    const linkLoad = (a: number, b: number, boost: number) => { if ((((a * 73856093) ^ (b * 19349663)) >>> 0) % 11 === 0) return -1; return Math.max(0, Math.min(1, (nodeLoad(a, curPhase?.kind) + nodeLoad(b, curPhase?.kind)) / 2 + boost)); };   // ~9% offline (灰)
    // live phase banner (screen-space, top-centre) — names the phase driving the colour; call AFTER ctx.restore()
    const phaseBanner = () => {
      if (!curPhase) return;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '600 13px sans-serif';
      const label = `▶ 执行时序 · ${curPhase.name}${curPhase.parallel && curPhase.parallel !== '—' ? ' · ' + curPhase.parallel : ''}`;
      const twb = ctx.measureText(label).width, bx = W / 2 - twb / 2 - 11, bw = twb + 22;
      ctx.fillStyle = P.bg; ctx.globalAlpha = 0.82; rrPath(ctx, bx, 12, bw, 26, 8); ctx.fill();
      ctx.globalAlpha = 1; ctx.strokeStyle = curPhase.color; ctx.lineWidth = 1.4; rrPath(ctx, bx, 12, bw, 26, 8); ctx.stroke();
      ctx.fillStyle = curPhase.color; ctx.fillText(label, W / 2, 25);
    };

    // ── layered-hierarchy view: each level matrix-packed into a grid (like the top
    //    view), grids stacked by level. Full pod via LOD: cells when zoomed in, an
    //    aggregate fill when too small. Click → highlight the up/down-stream chain. ──
    if (layout === 'layers') {
      const { levels, margin, Wc } = LAY;
      const rr = (x: number, y: number, w: number, h: number, r: number) => {
        const rad = Math.min(r, w / 2, h / 2);
        ctx.beginPath(); ctx.moveTo(x + rad, y);
        ctx.arcTo(x + w, y, x + w, y + h, rad); ctx.arcTo(x + w, y + h, x, y + h, rad);
        ctx.arcTo(x, y + h, x, y, rad); ctx.arcTo(x, y, x + w, y, rad); ctx.closePath();
      };
      const hi = layRange();
      const vx0 = -tx / s, vx1 = (W - tx) / s, vy0 = -ty / s, vy1 = (H - ty) / s;

      // per-level simplified glyph (distinct shape, with internal detail when the cell
      // is big enough): cabinet slats · blade+dots · card = 4 Die (2 compute UMA + 2 IO) ·
      // 计算 Die = teal die + AI-core dots · AI Core = 独立 Cube/Vector 核 (Cube∶Vector ≈ 8∶1).
      // per-level glyph — SOLID colour blocks (not wireframe outlines): each unit is a
      // filled block; internal structure is shown as darker / lighter sub-blocks rather
      // than strokes (depth via stacked tints, like Figma). Distinct shape per level.
      const DK = (a: number) => `rgba(0,0,0,${a})`;       // darken overlay (inset detail)
      const LT = (a: number) => `rgba(255,255,255,${a})`; // lighten overlay (dots)
      const glyph = (kind: string, x: number, y: number, ws: number, base: string, A: number) => {
        const px = ws * s;
        ctx.fillStyle = base;
        if (kind === 'super') { ctx.globalAlpha = 0.85 * A; rr(x, y, ws, ws, ws * 0.16); ctx.fill(); }
        else if (kind === 'cab') {   // upright cabinet = solid block + inset slat bands
          const cw = ws * 0.62, cx = x + (ws - cw) / 2;
          ctx.globalAlpha = 0.92 * A; rr(cx, y, cw, ws, ws * 0.08); ctx.fill();
          if (px > 5) { ctx.fillStyle = DK(0.2 * A); for (let k = 0; k < 4; k++) { rr(cx + cw * 0.16, y + ws * (k + 0.5) / 4 - ws * 0.03, cw * 0.68, ws * 0.06, ws * 0.02); ctx.fill(); } }
        } else if (kind === 'node') {   // 节点 = 板 + 物理器件对象：8×NPU(各含 UB/RDMA 口) + CPU + L1 交换 + LPO + 擎天 NIC
          const bh = ws * 0.5, by = y + (ws - bh) / 2;
          ctx.globalAlpha = 0.9 * A; rr(x, by, ws, bh, bh * 0.28); ctx.fill();
          if (px > 12) {
            const ny = y + ws * 0.3;                                   // NPU row
            const dy = y + ws * 0.72, dxs = [0.16, 0.4, 0.62, 0.84];   // device row: CPU / L1交换 / LPO / NIC
            const dcol = [DEV_CPU, PLANES[0].color, DEV_LPO, PLANES[2].color];
            // plane connectors (drawn first, under the objects): NPU→L1交换(绿) · NPU→LPO(橙) · CPU→NIC(紫)
            ctx.globalAlpha = 0.6 * A; ctx.lineWidth = ws * 0.012;
            ctx.strokeStyle = PLANES[0].color; ctx.beginPath(); ctx.moveTo(x + ws * 0.4, ny); ctx.lineTo(x + ws * 0.4, dy); ctx.stroke();   // UB → 交换
            ctx.strokeStyle = PLANES[1].color; ctx.beginPath(); ctx.moveTo(x + ws * 0.62, ny); ctx.lineTo(x + ws * 0.62, dy); ctx.stroke();  // RDMA → LPO
            ctx.strokeStyle = PLANES[2].color; ctx.beginPath(); ctx.moveTo(x + ws * 0.16, dy); ctx.lineTo(x + ws * 0.84, dy); ctx.stroke();  // CPU → NIC
            // 8 NPU, each carrying a UB 口(绿) + RDMA 口(橙)
            for (let d = 0; d < 8; d++) {
              const dx = x + ws * (0.1 + 0.8 * d / 7);
              ctx.fillStyle = LT(0.72 * A); ctx.beginPath(); ctx.arc(dx, ny, ws * 0.033, 0, 7); ctx.fill();
              ctx.fillStyle = PLANES[0].color; ctx.beginPath(); ctx.arc(dx, ny - ws * 0.052, ws * 0.016, 0, 7); ctx.fill();
              ctx.fillStyle = PLANES[1].color; ctx.beginPath(); ctx.arc(dx, ny + ws * 0.052, ws * 0.016, 0, 7); ctx.fill();
            }
            // device objects (simplified abstract glyphs, unified with cabinet/card/die)
            ctx.globalAlpha = A;
            const ndtype: DevType[] = ['cpu', 'switch', 'lpo', 'nic'];
            for (let i = 0; i < 4; i++) devGlyph(ctx, ndtype[i], x + ws * dxs[i], dy, ws * 0.12, ws * 0.1, dcol[i]);
          } else if (px > 7) { ctx.fillStyle = LT(0.55 * A); for (let d = 0; d < 8; d++) { const dx = x + ws * (0.1 + 0.8 * d / 7); ctx.beginPath(); ctx.arc(dx, y + ws / 2, ws * 0.045, 0, 7); ctx.fill(); } }
        } else if (kind === 'card') {   // 950 package = solid card block carrying 4 Die sub-blocks
          ctx.globalAlpha = 0.32 * A; rr(x, y, ws, ws, ws * 0.12); ctx.fill();
          if (px > 7) {
            const ins = ws * 0.13, g = ws * 0.08, dw = (ws - ins * 2 - g) / 2, dh = (ws - ins * 2 - g) / 2;
            const x0 = x + ins, x1 = x + ins + dw + g, y0 = y + ins, y1 = y + ins + dh + g;
            ctx.fillStyle = M_DIE; ctx.globalAlpha = 0.92 * A;   // 2 compute Die (solid teal, UMA)
            rr(x0, y0, dw, dh, ws * 0.04); ctx.fill(); rr(x1, y0, dw, dh, ws * 0.04); ctx.fill();
            ctx.globalAlpha = 0.9 * A; rr(x0 + dw, y0 + dh * 0.32, g, dh * 0.36, dh * 0.12); ctx.fill();   // UMA bridge = solid block
            ctx.fillStyle = M_IO; ctx.globalAlpha = 0.62 * A;   // 2 IO Die (solid grey)
            rr(x0, y1, dw, dh, ws * 0.04); ctx.fill(); rr(x1, y1, dw, dh, ws * 0.04); ctx.fill();
            // NPU 物理端口：UB 口(绿·scale-up) + RDMA 口(橙·scale-out) — 连接器 tab 图元
            ctx.globalAlpha = A;
            devGlyph(ctx, 'port', x + ws - ws * 0.1, y + ws * 0.1, ws * 0.15, ws * 0.09, PLANES[0].color);
            devGlyph(ctx, 'port', x + ws - ws * 0.1, y + ws * 0.26, ws * 0.15, ws * 0.09, PLANES[1].color);
          } else {   // too small → a single solid compute-die hint band
            ctx.fillStyle = M_DIE; ctx.globalAlpha = 0.7 * A;
            rr(x + ws * 0.16, y + ws * 0.22, ws * 0.68, ws * 0.3, ws * 0.05); ctx.fill();
          }
        } else if (kind === 'die') {   // compute Die = solid teal block + AI-core dot blocks
          ctx.globalAlpha = 0.88 * A; rr(x, y, ws, ws, ws * 0.12); ctx.fill();
          if (px > 8) { ctx.fillStyle = LT(0.5 * A); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { const dx = x + ws * (0.18 + 0.21 * c), dy = y + ws * (0.18 + 0.21 * r); ctx.beginPath(); ctx.arc(dx, dy, ws * 0.045, 0, 7); ctx.fill(); } }
        } else if (kind === 'tile') {   // L0 Tile = solid block / filled lane bars
          if (px > 4) { ctx.globalAlpha = 0.92 * A; const n = 3, bw2 = ws * 0.22, gp2 = (ws - n * bw2) / (n + 1); for (let i = 0; i < n; i++) { rr(x + gp2 + i * (bw2 + gp2), y + ws * 0.14, bw2, ws * 0.72, bw2 * 0.35); ctx.fill(); } }
          else { ctx.globalAlpha = 0.85 * A; rr(x, y, ws, ws, ws * 0.2); ctx.fill(); }
        } else {   // L1 AI Core = ONE independent core — Cube(cyan) or Vector(light cyan) via `base`; solid block
          ctx.globalAlpha = 0.9 * A; rr(x + ws * 0.12, y + ws * 0.12, ws * 0.76, ws * 0.76, ws * 0.22); ctx.fill();
        }
        ctx.globalAlpha = 1;
      };

      levels.forEach((Lv, li) => {
        const lc = curPhase ? heatOf(li * 1009 + 1) : Lv.color;   // playing → level load heatmap; idle → original level colour
        // L5 超节点 = the top context banner — a clean SOLID colour-block pill (no faint
        // outline): filled bar, bold title left, stats right, with a darker inset chip for "L5".
        if (Lv.banner) {
          const on = !hi || (hi.lo[li] <= 0 && hi.hi[li] > 0);
          const sel = !!(hi && on), dim = hi && !on;
          const txt = sel ? '#fff' : inkOf(Lv.color);
          ctx.globalAlpha = dim ? 0.32 : 1;
          ctx.fillStyle = sel ? SEL : lc; rr(margin, Lv.y0, Wc, Lv.h, Lv.h * 0.3); ctx.fill();
          // "L5" chip (darker inset block on the left)
          const chW = Lv.h * 1.5, chPad = Lv.h * 0.2;
          ctx.fillStyle = 'rgba(0,0,0,0.20)'; rr(margin + chPad, Lv.y0 + chPad, chW, Lv.h - chPad * 2, Lv.h * 0.22); ctx.fill();
          ctx.globalAlpha = 1;
          ctx.fillStyle = txt; ctx.textBaseline = 'middle';
          ctx.textAlign = 'center'; ctx.font = `700 ${Math.min(1.7, Lv.h * 0.4)}px sans-serif`;
          ctx.fillText('L5', margin + chPad + chW / 2, Lv.y0 + Lv.h / 2);
          ctx.textAlign = 'left'; ctx.font = `700 ${Math.min(1.9, Lv.h * 0.42)}px sans-serif`;
          ctx.fillText(TOK.supernode, margin + chPad * 2 + chW, Lv.y0 + Lv.h / 2);
          ctx.textAlign = 'right'; ctx.globalAlpha = 0.85; ctx.font = `${Math.min(1.55, Lv.h * 0.34)}px ${MONO}`;
          ctx.fillText(`${LAY.cabN.toLocaleString()} 机柜 · ${LAY.cardN.toLocaleString()} NPU`, margin + Wc - Lv.h * 0.45, Lv.y0 + Lv.h / 2);
          ctx.globalAlpha = 1;
          return;
        }
        const cellPx = Lv.cell * s, pad = Lv.cell * 0.14;
        // visible cell window (cull to viewport)
        const c0 = Math.max(0, Math.floor((vx0 - margin) / Lv.cell)), c1 = Math.min(Lv.cols, Math.ceil((vx1 - margin) / Lv.cell));
        const r0 = Math.max(0, Math.floor((vy0 - Lv.y0) / Lv.cell)), r1 = Math.min(Lv.rows, Math.ceil((vy1 - Lv.y0) / Lv.cell));
        if (cellPx >= 3 && Lv.y0 < vy1 && Lv.y0 + Lv.h > vy0) {
          // individual glyphs (culled)
          for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) {
            const i = r * Lv.cols + c; if (i >= Lv.count) break;
            const on = !hi || (i >= hi.lo[li] && i < hi.hi[li]);
            const x = margin + c * Lv.cell + pad, y = Lv.y0 + r * Lv.cell + pad, ws = Lv.cell - pad * 2;
            const cellBase = curPhase ? heatOf(i) : (Lv.kind === 'core' && i % 8 === 7 ? ENTITY_COLORS.vector : lc);   // playing → per-cell load; idle → original (L1 Cube∶Vector ≈ 8∶1)
            glyph(Lv.kind, x, y, ws, hi ? (on ? SEL : cellBase) : cellBase, hi ? (on ? 1 : 0.14) : 1);
          }
          ctx.globalAlpha = 1;
        } else if (Lv.y0 < vy1 && Lv.y0 + Lv.h > vy0) {
          // aggregate: one solid fill over the whole grid panel (represents all units)
          ctx.fillStyle = lc; ctx.globalAlpha = hi ? 0.1 : 0.62; rr(margin, Lv.y0, Wc, Lv.h, 0.2); ctx.fill(); ctx.globalAlpha = 1;
          if (hi) {   // selected range = a contiguous bright block (rows lo..hi)
            const ra = Math.floor(hi.lo[li] / Lv.cols), rb = Math.floor((hi.hi[li] - 1) / Lv.cols);
            ctx.fillStyle = SEL; ctx.globalAlpha = 0.85;
            if (ra === rb) { const x = margin + (hi.lo[li] % Lv.cols) * Lv.cell; rr(x, Lv.y0 + ra * Lv.cell, (hi.hi[li] - hi.lo[li]) * Lv.cell, Lv.cell, 0.06); ctx.fill(); }
            else { rr(margin, Lv.y0 + ra * Lv.cell, Wc, (rb - ra + 1) * Lv.cell, 0.06); ctx.fill(); }
            ctx.globalAlpha = 1;
          }
          // L0 is an aggregate observation level (too fine to enumerate) — label its role
          if (Lv.kind === 'tile') {
            ctx.fillStyle = P.ink2; ctx.globalAlpha = 0.92; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = `${Math.min(1.5, Lv.h * 0.42)}px sans-serif`;
            ctx.fillText('L0 聚合观测 · 流水气泡 / 访存等待 ·（下钻执行时序 swimlane 展开）', margin + Wc / 2, Lv.y0 + Lv.h / 2);
            ctx.globalAlpha = 1;
          }
        }
      });

      // ── containment links for the selected chain (parent cell → child block centre) ──
      if (hi) {
        ctx.strokeStyle = SEL; ctx.globalAlpha = 0.9; ctx.lineWidth = 0.12; ctx.lineCap = 'round';
        for (let li = 1; li < levels.length; li++) {
          const pa = cellXY(li - 1, hi.lo[li - 1]);                                  // parent cell
          const ca = cellXY(li, hi.lo[li]), cb = cellXY(li, Math.min(levels[li].count - 1, hi.hi[li] - 1));
          ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo((ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // ── 器件互联平面：全量 NPU/CPU/LPO/NIC 矩阵 + 代表性刀片连线（板内/板间 NPU · NPU-CPU · NPU-LPO · NIC-CPU） ──
      const dev = LAY.dev;
      const devKind: Record<string, DevType> = { cpu_d: 'cpu', lpo_d: 'lpo', nic_d: 'nic' };
      // section header bar
      if (dev.headerY < vy1 && dev.headerY + dev.headerH > vy0) {
        ctx.fillStyle = 'rgba(124,141,184,0.16)'; rr(margin, dev.headerY, Wc, dev.headerH, dev.headerH * 0.3); ctx.fill();
        ctx.fillStyle = P.ink; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.font = `700 ${Math.min(1.8, dev.headerH * 0.5)}px sans-serif`;
        ctx.fillText('器件互联平面 · 全量 NPU / CPU / LPO / NIC + 连接关系', margin + dev.headerH * 0.55, dev.headerY + dev.headerH / 2);
        ctx.textAlign = 'right'; ctx.globalAlpha = 0.82; ctx.font = `${Math.min(1.45, dev.headerH * 0.38)}px ${MONO}`;
        const cN = dev.mats.map((m) => m.count);
        ctx.fillText(`${cN[0].toLocaleString()} NPU · ${cN[1].toLocaleString()} CPU · ${cN[2].toLocaleString()} LPO · ${cN[3].toLocaleString()} NIC`, margin + Wc - dev.headerH * 0.4, dev.headerY + dev.headerH / 2);
        ctx.globalAlpha = 1;
      }

      // representative 刀片 wiring schematic (fixed size — readable at any matrix zoom)
      if (dev.wiringY < vy1 && dev.wiringY + dev.wiringH > vy0) {
        const wx = margin, wy = dev.wiringY, wW = Wc, wH = dev.wiringH;
        ctx.fillStyle = 'rgba(124,141,184,0.07)'; rr(wx, wy, wW, wH, 1.3); ctx.fill();
        ctx.strokeStyle = 'rgba(124,141,184,0.28)'; ctx.lineWidth = 0.08; ctx.setLineDash([]); rr(wx, wy, wW, wH, 1.3); ctx.stroke();
        ctx.fillStyle = P.ink2; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = '600 1.45px sans-serif';
        ctx.fillText('代表性刀片（节点）器件互联 · 8 NPU + 4 CPU + 4 LPO + 4 NIC · 线型=平面：实线 UB · 长虚 scale-out(光) · 点线 VPC', wx + 1.5, wy + 1);
        const yN0 = wy + wH * 0.34, yN1 = wy + wH * 0.55, yDev = wy + wH * 0.82;
        const npuC: [number, number][] = [];
        for (let i = 0; i < 8; i++) { const c = i % 4, r = Math.floor(i / 4); npuC.push([wx + wW * (0.085 + 0.072 * c), r === 0 ? yN0 : yN1]); }
        const lpoC: [number, number][] = [], cpuC: [number, number][] = [], nicC: [number, number][] = [];
        for (let i = 0; i < 4; i++) { lpoC.push([wx + wW * (0.09 + 0.05 * i), yDev]); cpuC.push([wx + wW * (0.40 + 0.05 * i), yDev]); nicC.push([wx + wW * (0.63 + 0.05 * i), yDev]); }
        const exit: [number, number] = [wx + wW * 0.92, yN0 - wH * 0.06];
        // link stroke: line-STYLE encodes plane (type); COLOUR encodes utilisation when playing, else neutral
        const wire = (style: 'ub' | 'so' | 'vpc', w: number, a: number, b: number, boost: number, alpha = 0.7) => {
          const ld = curPhase ? linkLoad(a, b, boost) : -2;
          ctx.setLineDash(style === 'ub' ? [] : style === 'so' ? [wW * 0.014, wW * 0.009] : [wW * 0.0035, wW * 0.0085]);
          ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.globalAlpha = alpha;
          ctx.strokeStyle = ld <= -2 ? 'rgba(150,168,205,0.85)' : loadColor(ld);
        };
        const seg = (p: [number, number], q: [number, number]) => { ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); };
        // 1) 板内 NPU full-mesh (UB·scale-up · 实线 · 大带宽=粗)
        for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) { wire('ub', 0.07, 700 + i, 700 + j, curPhase?.kind === 'comm' ? 0.3 : -0.05, 0.4); seg(npuC[i], npuC[j]); }
        // 2) NPU→CPU (UB · 实线)  3) NPU→LPO (scale-out 光 · 长虚)
        for (let i = 0; i < 8; i++) { wire('ub', 0.09, 810 + i, 300 + (i % 4), -0.08); seg(npuC[i], cpuC[i % 4]); wire('so', 0.085, 820 + i, 400 + (i % 4), curPhase?.kind === 'comm' ? 0.25 : -0.1); seg(npuC[i], lpoC[i % 4]); }
        // 4) NIC→CPU (VPC · 点线 · 南北向小带宽=细)
        for (let i = 0; i < 4; i++) { wire('vpc', 0.06, 500 + i, 300 + i, -0.2); seg(nicC[i], cpuC[i]); }
        // 5) 板间 NPU (scale-out · 长虚 · 离开刀片 → 其它超节点)
        wire('so', 0.10, 700 + 3, 999, curPhase?.kind === 'comm' ? 0.3 : 0); seg(npuC[3], exit);
        ctx.setLineDash([]); ctx.globalAlpha = 1;
        // arrowhead on the inter-board exit
        ctx.fillStyle = curPhase ? loadColor(linkLoad(703, 999, 0)) : 'rgba(150,168,205,0.95)';
        ctx.beginPath(); ctx.moveTo(exit[0], exit[1]); ctx.lineTo(exit[0] - wW * 0.013, exit[1] - wW * 0.008); ctx.lineTo(exit[0] - wW * 0.013, exit[1] + wW * 0.008); ctx.closePath(); ctx.fill();
        // device glyphs ON TOP of the wires
        const gw = wW * 0.03, gh = wH * 0.16;
        npuC.forEach((c, i) => {
          ctx.fillStyle = curPhase ? heatOf(880 + i) : ENTITY_COLORS.card; rr(c[0] - gw / 2, c[1] - gh / 2, gw, gh, gh * 0.3); ctx.fill();
          ctx.fillStyle = PLANES[0].color; ctx.beginPath(); ctx.arc(c[0] - gw * 0.22, c[1] - gh * 0.5, gw * 0.16, 0, 7); ctx.fill();
          ctx.fillStyle = PLANES[1].color; ctx.beginPath(); ctx.arc(c[0] + gw * 0.22, c[1] - gh * 0.5, gw * 0.16, 0, 7); ctx.fill();
        });
        lpoC.forEach((c, i) => devGlyph(ctx, 'lpo', c[0], c[1], gw * 1.15, gh, curPhase ? heatOf(400 + i) : DEV_LPO));
        cpuC.forEach((c, i) => devGlyph(ctx, 'cpu', c[0], c[1], gw * 1.15, gh, curPhase ? heatOf(300 + i) : DEV_CPU));
        nicC.forEach((c, i) => devGlyph(ctx, 'nic', c[0], c[1], gw * 1.15, gh, curPhase ? heatOf(500 + i) : PLANES[2].color));
        // cluster labels + link-type callouts
        ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = '0.95px sans-serif'; ctx.fillStyle = P.ink2;
        ctx.fillText('NPU ×8 · 板内 UB full-mesh', wx + wW * 0.20, yN1 + gh * 0.7);
        ctx.fillText('LPO ×4', lpoC[1][0] + wW * 0.025, yDev + gh * 0.62);
        ctx.fillText('CPU ×4', cpuC[1][0] + wW * 0.025, yDev + gh * 0.62);
        ctx.fillText('NIC ×4', nicC[1][0] + wW * 0.025, yDev + gh * 0.62);
        ctx.fillStyle = '#9fb6ff'; ctx.textAlign = 'left';
        ctx.fillText('板间 NPU (scale-out) → 其它刀片/超节点', exit[0] - wW * 0.20, exit[1] - wH * 0.10);
      }

      // four full-count device matrices (全量)
      dev.mats.forEach((M, mi) => {
        if (M.y0 > vy1 || M.y0 + M.h < vy0) return;
        const cellPx = M.cell * s, pad = M.cell * 0.16;
        const c0 = Math.max(0, Math.floor((vx0 - margin) / M.cell)), c1 = Math.min(M.cols, Math.ceil((vx1 - margin) / M.cell));
        const r0 = Math.max(0, Math.floor((vy0 - M.y0) / M.cell)), r1 = Math.min(M.rows, Math.ceil((vy1 - M.y0) / M.cell));
        if (cellPx >= 3) {
          for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) {
            const i = r * M.cols + c; if (i >= M.count) break;
            const x = margin + c * M.cell + pad, y = M.y0 + r * M.cell + pad, ws = M.cell - pad * 2;
            const base = curPhase ? heatOf(7000 + mi * 131 + i) : M.color;
            if (mi > 0 && cellPx > 9) { devGlyph(ctx, devKind[M.kind], x + ws / 2, y + ws / 2, ws * 0.8, ws * 0.68, base); }
            else {
              ctx.fillStyle = base; ctx.globalAlpha = 0.92; rr(x, y, ws, ws, ws * 0.24); ctx.fill(); ctx.globalAlpha = 1;
              if (mi === 0 && cellPx > 12) { devGlyph(ctx, 'port', x + ws * 0.74, y + ws * 0.3, ws * 0.36, ws * 0.2, PLANES[0].color); devGlyph(ctx, 'port', x + ws * 0.74, y + ws * 0.64, ws * 0.36, ws * 0.2, PLANES[1].color); }
            }
          }
        } else {
          ctx.fillStyle = curPhase ? heatOf(7000 + mi * 131) : M.color; ctx.globalAlpha = 0.5; rr(margin, M.y0, Wc, M.h, 0.25); ctx.fill(); ctx.globalAlpha = 1;
        }
      });

      ctx.restore();
      // ── per-level axis labels — CONSTANT screen-pixel size (don't scale with fit/zoom),
      //    drawn in the fixed left gutter so the matrices use the full width ──
      ctx.textAlign = 'right'; const lx = AXIS_GUTTER - 8;
      levels.forEach((Lv, li) => {
        const sy = ty + (Lv.y0 + Math.min(Lv.h / 2, 3)) * s;
        if (sy < 6 || sy > H - 2) return;   // off-screen cull
        ctx.fillStyle = Lv.color; ctx.textBaseline = 'middle'; ctx.font = '600 12.5px sans-serif';
        ctx.fillText(Lv.label, lx, sy);
        let yy = sy + 14;
        if (!Lv.banner) { ctx.fillStyle = P.ink2; ctx.font = `10px ${MONO}`; ctx.fillText(`×${Lv.count.toLocaleString()}`, lx, yy); yy += 13; }
        if (LAYER_INFO[li]?.tag) { ctx.fillStyle = LAYER_INFO[li].tag!.includes('1:1') ? '#04d793' : '#7c8db8'; ctx.font = '9.5px sans-serif'; ctx.fillText(LAYER_INFO[li].tag!.split('（')[0], lx, yy); yy += 12; }
        const lq = UB_COORD[LAYER_INFO[li]?.key];   // UB L0–L7 同一坐标（L 号在层名里，这里标作用域）
        if (lq) { ctx.fillStyle = '#9fb6ff'; ctx.font = '9.5px sans-serif'; ctx.fillText(`${TOK.ub} ${lq.scope}`, lx, yy); yy += 12; }
        // per-level physical plane tag (NPU 端口 / CPU / LPO / NIC 落在哪一层 · 见右侧详情)
        const phys = LEVEL_PHYS[Lv.kind];
        if (phys) { ctx.fillStyle = phys.color; ctx.font = '600 9.5px sans-serif'; ctx.fillText(`◆ ${PLANE_TAG[phys.plane]}`, lx, yy); }
      });
      // device-plane band labels (header + the four full-count matrices)
      { const hy = ty + (LAY.dev.headerY + LAY.dev.headerH / 2) * s;
        if (hy > 6 && hy < H - 2) { ctx.fillStyle = P.ink; ctx.textBaseline = 'middle'; ctx.font = '700 12px sans-serif'; ctx.fillText('器件互联', lx, hy); } }
      LAY.dev.mats.forEach((M) => {
        const sy = ty + (M.y0 + Math.min(M.h / 2, 3)) * s;
        if (sy < 6 || sy > H - 2) return;
        ctx.fillStyle = M.color; ctx.textBaseline = 'middle'; ctx.font = '600 12.5px sans-serif';
        ctx.fillText(M.label, lx, sy);
        ctx.fillStyle = P.ink2; ctx.font = `10px ${MONO}`; ctx.fillText(`×${M.count.toLocaleString()}`, lx, sy + 14);
        ctx.fillStyle = '#7c8db8'; ctx.font = '9.5px sans-serif'; ctx.fillText(`${M.per}/刀片`, lx, sy + 27);
      });
      phaseBanner();
      return;
    }

    const vx0 = -tx / s, vy0 = -ty / s, vx1 = (W - tx) / s, vy1 = (H - ty) / s;   // visible world rect (cull per-card detail)

    // cabinets (L2) + blades (L1) containment = solid NESTED colour BLOCKS, no outline:
    // cabinet = purple block, blade = sky-blue block inside it, cards sit on top. Stacked
    // tints carry the containment (depth via fills, like Figma) — no strokes.
    const fr = Math.min(L.cw, L.ch) * 0.035;
    ctx.fillStyle = P.frameFill;
    for (let cab = 0; cab < L.nC; cab++) { const [x, y] = cabXY(cab); rrPath(ctx, x, y, L.cw, L.ch, fr); ctx.fill(); }
    ctx.fillStyle = P.bladeFill;
    for (let b = 0; b < L.nB; b++) { const [x, y] = bladeXY(Math.floor(b / BPC), b % BPC); rrPath(ctx, x, y, L.bw, L.bh, fr * 0.7); ctx.fill(); }

    // playback: the whole pod runs the RUN_SCHED 执行时序 — every card tints to the CURRENT
    // phase colour (加载→前向→反向→AllReduce→优化器). Same head as the 执行时序 swimlane (headRef).
    // cards — full L3→L2→L1·L0 drill on zoom: card(4 Die) → 计算 Die → AI Core(Cube/Vector)
    const showBorder = s > 4, showId = s > 14, showDie = s > 26, showCore = s > 74;
    const round = s > 8, rad = L.cs * 0.16;   // rounded corners (same glyph language as 层级图) once cards are big; cull off-screen
    const dieR = L.cs * 0.05;
    ctx.lineWidth = 0.6 / s; ctx.strokeStyle = P.cardBd;
    for (let k = 0; k < L.N1; k++) {
      const [x, y] = cardXY(k);
      if (round && (x + L.cs < vx0 || x > vx1 || y + L.cs < vy0 || y > vy1)) continue;   // cull off-screen when zoomed in
      const g = groupOf(k);
      // observation: colour ONLY 高/满 cards (isHot) so most stay as neutral/partition blocks — few hotspots pop
      const ld = curPhase ? nodeLoad(k, curPhase.kind) : -1;
      ctx.fillStyle = ld >= 0 && isHot(ld) ? loadColor(ld) : (g < 0 ? P.cardN : PARTITION_PALETTE[g % PARTITION_PALETTE.length]);
      if (round) { rrPath(ctx, x, y, L.cs, L.cs, rad); ctx.fill(); if (showBorder) { ctx.strokeStyle = P.cardBd; ctx.stroke(); } }
      else { ctx.fillRect(x, y, L.cs, L.cs); if (showBorder) ctx.strokeRect(x, y, L.cs, L.cs); }
      // card = 1 device (HW); r-label = SOFTWARE rank bound 1:1. On deep zoom the interior
      // shows the 950 package = 4 Die (2 compute UMA + 2 IO); zoom further → each compute
      // Die reveals its AI Core array (Cube/Vector) — SAME glyph/colour as the 层级图.
      if (showId && x + L.cs >= vx0 && x <= vx1 && y + L.cs >= vy0 && y <= vy1) {
        // NPU 物理端口：UB 口(绿·scale-up) + RDMA/RoCE 口(橙·scale-out) — 连接器 tab 图元
        devGlyph(ctx, 'port', x + L.cs * 0.85, y + L.cs * 0.13, L.cs * 0.16, L.cs * 0.1, PLANES[0].color);
        devGlyph(ctx, 'port', x + L.cs * 0.85, y + L.cs * 0.27, L.cs * 0.16, L.cs * 0.1, PLANES[1].color);
        ctx.fillStyle = P.ink; ctx.textAlign = 'center'; ctx.font = '0.26px sans-serif';
        ctx.textBaseline = showDie ? 'top' : 'middle';
        ctx.fillText(`r${k}`, x + L.cs / 2, y + (showDie ? 0.05 : L.cs / 2));
        if (showDie) {
          const ins = L.cs * 0.14, gp = L.cs * 0.07;
          const dw = (L.cs - ins * 2 - gp) / 2, dh = (L.cs * 0.7 - gp) / 2;
          const x0 = x + ins, x1 = x + ins + dw + gp, y0 = y + L.cs * 0.28, y1 = y + L.cs * 0.28 + dh + gp;
          // one compute Die: solid teal, or (deeper zoom) a teal container of its ~16 AI Core
          const computeDie = (dx: number, dy: number) => {
            if (!showCore) { ctx.fillStyle = M_DIE; rrPath(ctx, dx, dy, dw, dh, dieR); ctx.fill(); return; }
            // solid teal die block carrying its ~16 independent Cube/Vector cores (no wireframe outline)
            ctx.fillStyle = M_DIE; ctx.globalAlpha = 0.5; rrPath(ctx, dx, dy, dw, dh, dieR); ctx.fill(); ctx.globalAlpha = 1;
            // ≈16 AI Core (4×4) — SEPARATE Cube(cyan)/Vector(light cyan) 独立核, Cube∶Vector ≈ 8∶1 (same glyph as 3D / DieDetail)
            const cols = 4, rows = 4, pad = dw * 0.08, gxx = dw * 0.05, gyy = dh * 0.05;
            const cw = (dw - pad * 2 - gxx * (cols - 1)) / cols, ch = (dh - pad * 2 - gyy * (rows - 1)) / rows;
            for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
              const idx = r * cols + c, vec = idx % 8 === 7;
              const cx = dx + pad + c * (cw + gxx), cy = dy + pad + r * (ch + gyy);
              ctx.fillStyle = vec ? M_VEC : M_CUBE;
              rrPath(ctx, cx, cy, cw, ch, Math.min(cw, ch) * 0.3); ctx.fill();
            }
          };
          computeDie(x0, y0); computeDie(x1, y0);
          ctx.fillStyle = M_DIE;   // UMA bridge → 1 device (solid block, not a line)
          rrPath(ctx, x0 + dw, y0 + dh * 0.34, gp, dh * 0.32, dh * 0.12); ctx.fill();
          ctx.fillStyle = M_IO;   // 2 IO Die (grey, no compute)
          rrPath(ctx, x0, y1, dw, dh, dieR); ctx.fill(); rrPath(ctx, x1, y1, dw, dh, dieR); ctx.fill();
        }
      }
    }
    // node host-side device relationships — drawn AS CONNECTOR LINES BY DEFAULT (together with
    // the NPU mesh, whenever 连线 is on), so the 3 latter relationships show without deep zoom:
    //   NPU-CPU (UB·实线) · NPU-LPO (scale-out 光·长虚) · NIC-CPU (VPC·点线).
    // Line-style = plane; colour=利用率 · 粗细=带宽 while playing, else neutral. The device
    // OBJECTS (鲲鹏 CPU · L1 交换 · LPO · 擎天 NIC) + labels still appear on zoom (below).
    const devDxs = (bx: number) => [0.16, 0.4, 0.62, 0.84].map((f) => bx + L.bw * f);
    if (links && s * L.bw > 14) {
      const boost = curPhase?.kind === 'comm' ? 0.2 : -0.15;
      const hostWire = (style: 'ub' | 'so' | 'vpc', w: number, sa: number, sb: number, p: [number, number], q: [number, number]) => {
        ctx.setLineDash(style === 'ub' ? [] : style === 'so' ? [L.bw * 0.05, L.bw * 0.035] : [L.bw * 0.012, L.bw * 0.03]);
        ctx.lineWidth = w / s; ctx.lineCap = 'round';
        ctx.strokeStyle = curPhase ? loadColor(linkLoad(sa, sb, boost)) : 'rgba(150,168,205,0.72)';
        ctx.globalAlpha = curPhase ? 0.9 : 0.62;
        ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
      };
      const dotR = Math.max(L.cs * 0.1, 2.4 / s), ddot = [DEV_CPU, DEV_LPO, PLANES[2].color];   // screen-constant min so dots read at overview
      for (let b = 0; b < L.nB; b++) {
        const [bx, by] = bladeXY(Math.floor(b / BPC), b % BPC);
        if (bx + L.bw < vx0 || bx > vx1 || by + L.bh < vy0 || by > vy1) continue;
        const dy = by + L.bh - L.bpad * 0.5;                         // device row (blade bottom margin)
        const npuY = by + L.bpad + L.cs * 0.5;                        // start from the card area so the vertical legs are tall enough to read
        const dxs = devDxs(bx);
        hostWire('ub',  2.0, b * 131 + 11, b * 131 + 21, [dxs[0], npuY], [dxs[0], dy]);   // NPU → 鲲鹏 CPU (UB·SU · 实线)
        hostWire('so',  1.8, b * 131 + 12, b * 131 + 22, [dxs[2], npuY], [dxs[2], dy]);   // NPU → LPO (scale-out 光 · 长虚)
        hostWire('vpc', 1.4, b * 131 + 13, b * 131 + 23, [dxs[3], dy],   [dxs[0], dy]);   // 擎天 NIC → CPU (VPC · 点线)
        ctx.setLineDash([]); ctx.globalAlpha = 1;
        // endpoint device dots (so the connectors read as device→device even before the glyphs)
        const dpos = [dxs[0], dxs[2], dxs[3]];
        for (let i = 0; i < 3; i++) { ctx.fillStyle = ddot[i]; ctx.beginPath(); ctx.arc(dpos[i], dy, dotR, 0, 7); ctx.fill(); }
      }
    }
    // node physical devices drawn AS OBJECTS (鲲鹏 CPU · L1 交换 · LPO · 擎天 NIC) — need zoom to be legible
    if (showId && s * L.bpad > 4) {
      const dw2 = L.cs * 0.5, dh2 = L.cs * 0.3;
      const dcol = [DEV_CPU, PLANES[0].color, DEV_LPO, PLANES[2].color];
      const dlbl = ['CPU', '交换', 'LPO', 'NIC'];
      const dtype: DevType[] = ['cpu', 'switch', 'lpo', 'nic'];
      for (let b = 0; b < L.nB; b++) {
        const [bx, by] = bladeXY(Math.floor(b / BPC), b % BPC);
        if (bx + L.bw < vx0 || bx > vx1 || by + L.bh < vy0 || by > vy1) continue;
        const dy = by + L.bh - L.bpad * 0.5;
        const dxs = devDxs(bx);
        for (let i = 0; i < 4; i++) devGlyph(ctx, dtype[i], dxs[i], dy, dw2, dh2, dcol[i]);
        if (s > 34) {   // labels under the glyphs once big enough (graphic + text)
          ctx.fillStyle = P.ink2; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = `${L.cs * 0.1}px sans-serif`;
          for (let i = 0; i < 4; i++) ctx.fillText(dlbl[i], dxs[i], dy + dh2 * 0.62);
        }
      }
    }
    // same-level connections (LOD): L2 node mesh (blade↔blade full-mesh per cabinet) +
    // L1 board 2-D mesh (card↔card neighbours per blade)
    if (links && s * L.bw > 14) {
      const boost = curPhase?.kind === 'comm' ? 0.34 : -0.12;   // L2 cabinet mesh carries collective traffic
      ctx.lineCap = 'round';
      for (let cab = 0; cab < L.nC; cab++) {
        const c: [number, number][] = [], bid: number[] = [];
        for (let bl = 0; bl < BPC; bl++) { const blade = cab * BPC + bl; if (blade >= L.nB) break; const [bx, by] = bladeXY(cab, bl); c.push([bx + L.bw / 2, by + L.bh / 2]); bid.push(blade); }
        for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) {
          const mx = (c[i][0] + c[j][0]) / 2, my = (c[i][1] + c[j][1]) / 2;
          if (mx < vx0 || mx > vx1 || my < vy0 || my > vy1) continue;   // cull off-screen links
          if (curPhase) { const ld = linkLoad(bid[i] * 131 + 5, bid[j] * 131 + 5, boost); ctx.strokeStyle = loadColor(ld); ctx.globalAlpha = 0.9; ctx.lineWidth = 0.95 / s; }   // 颜色=利用率 · 粗细=带宽（L2 机柜内，低于板载）
          else { ctx.strokeStyle = UB_LEVELS[2].color; ctx.globalAlpha = 0.3; ctx.lineWidth = 1.0 / s; }
          ctx.beginPath(); ctx.moveTo(c[i][0], c[i][1]); ctx.lineTo(c[j][0], c[j][1]); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
    if (links && s * L.cs > 4) {
      const boost = curPhase?.kind === 'compute' ? 0.12 : -0.1;   // L1 board mesh busiest during compute
      ctx.lineCap = 'round';
      const seg = (ka: number, kb: number, pa: [number, number], pb: [number, number]) => {
        const mx = (pa[0] + pb[0]) / 2, my = (pa[1] + pb[1]) / 2;
        if (mx < vx0 || mx > vx1 || my < vy0 || my > vy1) return;   // cull
        if (curPhase) { const ld = linkLoad(ka, kb, boost); ctx.strokeStyle = loadColor(ld); ctx.globalAlpha = 0.9; ctx.lineWidth = 1.5 / s; }   // 颜色=利用率 · 粗细=带宽（L1 板载，最高 BW → 最粗）
        else { ctx.strokeStyle = UB_LEVELS[1].color; ctx.globalAlpha = 0.42; ctx.lineWidth = 0.7 / s; }
        ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
      };
      for (let b = 0; b < L.nB; b++) {
        const cen: [number, number][] = [], kid: number[] = [];
        for (let l = 0; l < CPB; l++) { const k = b * CPB + l; if (k >= L.N1) break; const [x, y] = cardXY(k); cen.push([x + L.cs / 2, y + L.cs / 2]); kid.push(k); }
        for (let l = 0; l < cen.length; l++) {
          const colx = l % 4, row = Math.floor(l / 4);
          if (colx < 3 && l + 1 < cen.length) seg(kid[l], kid[l + 1], cen[l], cen[l + 1]);   // right neighbour
          if (row === 0 && l + 4 < cen.length) seg(kid[l], kid[l + 4], cen[l], cen[l + 4]);  // down neighbour
        }
      }
      ctx.globalAlpha = 1;
    }

    // ── scenario playback: animated hop-by-hop flow (marching ants) ──
    // Ring-AllReduce → staged L1 (intra-blade) then L2 (intra-cabinet); All-to-All
    // → L2 cross-blade full-mesh emphasised. Reads as "卡→刀片→机柜逐跳流动".
    if (playing) {
      const ph = phaseRef.current, cyc = ph % 1;
      const col = loadColor(0.95);   // active flow = busy traffic (hot/red)
      const l1A = scenario === 'ring' ? (cyc < 0.5 ? 1 : 0.3) : 0.45;
      const l2A = scenario === 'ring' ? (cyc >= 0.5 ? 1 : 0.3) : 1;
      ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 8;
      ctx.setLineDash([0.16, 0.46]); ctx.lineDashOffset = -ph * 1.4;
      // L1 board flow
      if (links && s * L.cs > 4) {
        ctx.globalAlpha = 0.95 * l1A; ctx.lineWidth = 1.5 / s; ctx.beginPath();
        for (let b = 0; b < L.nB; b++) {
          const cen: [number, number][] = [];
          for (let l = 0; l < CPB; l++) { const k = b * CPB + l; if (k >= L.N1) break; const [x, y] = cardXY(k); cen.push([x + L.cs / 2, y + L.cs / 2]); }
          for (let l = 0; l < cen.length; l++) {
            const col2 = l % 4, row = Math.floor(l / 4);
            if (col2 < 3 && l + 1 < cen.length) { ctx.moveTo(cen[l][0], cen[l][1]); ctx.lineTo(cen[l + 1][0], cen[l + 1][1]); }
            if (row === 0 && l + 4 < cen.length) { ctx.moveTo(cen[l][0], cen[l][1]); ctx.lineTo(cen[l + 4][0], cen[l + 4][1]); }
          }
        }
        ctx.stroke();
      }
      // L2 cabinet blade-mesh flow
      if (links && s * L.bw > 14) {
        ctx.globalAlpha = 0.95 * l2A; ctx.lineWidth = 1.8 / s; ctx.beginPath();
        for (let cab = 0; cab < L.nC; cab++) {
          const c: [number, number][] = [];
          for (let bl = 0; bl < BPC; bl++) { const blade = cab * BPC + bl; if (blade >= L.nB) break; const [bx, by] = bladeXY(cab, bl); c.push([bx + L.bw / 2, by + L.bh / 2]); }
          for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) { ctx.moveTo(c[i][0], c[i][1]); ctx.lineTo(c[j][0], c[j][1]); }
        }
        ctx.stroke();
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.restore();
    }

    // selected (persistent) or hovered card: "active" glow on its links — its cabinet's
    // cross-cabinet fabric (L3, on select) + blade↔cabinet blades (L2) + board mates (L1).
    const hk = selTop?.k ?? hoverRef.current; const isSel = selTop != null;
    if (hk != null) {
      const b = Math.floor(hk / CPB), cab = Math.floor(b / BPC);
      const [hx, hy] = cardXY(hk); const hc: [number, number] = [hx + L.cs / 2, hy + L.cs / 2];
      ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // L3 (on select): selected card's CABINET → all other cabinets (super-node Clos fabric)
      const [ccx, ccy] = cabXY(cab); const cc: [number, number] = [ccx + L.cw / 2, ccy + L.ch / 2];
      if (isSel && L.nC > 1) {
        ctx.strokeStyle = SEL; ctx.shadowColor = SEL; ctx.shadowBlur = 5; ctx.lineWidth = 1.1 / s; ctx.globalAlpha = 0.4; ctx.beginPath();
        for (let oc = 0; oc < L.nC; oc++) { if (oc === cab) continue; const [ox, oy] = cabXY(oc); ctx.moveTo(cc[0], cc[1]); ctx.lineTo(ox + L.cw / 2, oy + L.ch / 2); }
        ctx.stroke();
        // highlight the selected cabinet + blade frames (selection = ONE accent, not per-level colour)
        ctx.shadowBlur = 0; ctx.globalAlpha = 0.95; ctx.strokeStyle = SEL; ctx.lineWidth = 1.6 / s; ctx.strokeRect(ccx, ccy, L.cw, L.ch);
      }
      // L2: hovered blade centre → other blade centres in the cabinet
      const [bx, by] = bladeXY(cab, b % BPC); const bc: [number, number] = [bx + L.bw / 2, by + L.bh / 2];
      ctx.strokeStyle = SEL; ctx.shadowColor = SEL; ctx.shadowBlur = 10; ctx.lineWidth = 1.6 / s; ctx.globalAlpha = 0.9; ctx.beginPath();
      for (let bl = 0; bl < BPC; bl++) { const blade = cab * BPC + bl; if (blade >= L.nB || blade === b) continue; const [ox, oy] = bladeXY(cab, bl); ctx.moveTo(bc[0], bc[1]); ctx.lineTo(ox + L.bw / 2, oy + L.bh / 2); }
      ctx.stroke();
      // L1: hovered card → its 7 board siblings
      ctx.strokeStyle = SEL; ctx.shadowColor = SEL; ctx.shadowBlur = 12; ctx.lineWidth = 2 / s; ctx.globalAlpha = 1; ctx.beginPath();
      for (let l = 0; l < CPB; l++) { const k2 = b * CPB + l; if (k2 >= L.N1 || k2 === hk) continue; const [sx, sy] = cardXY(k2); ctx.moveTo(hc[0], hc[1]); ctx.lineTo(sx + L.cs / 2, sy + L.cs / 2); }
      ctx.stroke();
      ctx.restore();
      // selected / hovered card outline (on top, no blur) — rounded, PTO-blue, bolder when selected
      ctx.lineWidth = (isSel ? 3.4 : 2.5) / s; ctx.strokeStyle = SEL;
      rrPath(ctx, hx - 0.07, hy - 0.07, L.cs + 0.14, L.cs + 0.14, L.cs * 0.18); ctx.stroke();
      // finer selection: outline the chosen compute Die / AI Core inside the package
      if (isSel && selTop && selTop.die != null) {
        const ins = L.cs * 0.14, gp = L.cs * 0.07;
        const dw = (L.cs - ins * 2 - gp) / 2, dh = (L.cs * 0.7 - gp) / 2;
        const dx = hx + ins + selTop.die * (dw + gp), dy = hy + L.cs * 0.28;
        ctx.lineWidth = 1.6 / s; ctx.strokeStyle = SEL; ctx.shadowColor = SEL; ctx.shadowBlur = 6;
        rrPath(ctx, dx - 0.02, dy - 0.02, dw + 0.04, dh + 0.04, dieR); ctx.stroke();
        if (selTop.core != null) {
          const pad = dw * 0.1, gxx = dw * 0.06, gyy = dh * 0.08;
          const cw = (dw - pad * 2 - gxx) / 2, ch = (dh - pad * 2 - gyy) / 2;
          const cc = selTop.core % 2, cr = Math.floor(selTop.core / 2);
          const cx = dx + pad + cc * (cw + gxx), cy = dy + pad + cr * (ch + gyy);
          ctx.lineWidth = 1.1 / s; rrPath(ctx, cx - 0.01, cy - 0.01, cw + 0.02, ch + 0.02, ch * 0.18); ctx.stroke();
        }
        ctx.shadowBlur = 0;
      }
    }
    ctx.restore();
    phaseBanner();   // live phase banner (screen-space) — names the current run phase driving the card colour
  }, [L, colorBy, links, fit, cabXY, bladeXY, cardXY, groupOf, dark, playing, runMode, scenario, layout, selL, selTop, swOpen, P.bg]);

  // re-fit when the layout (top ↔ layers) changes, then redraw
  useEffect(() => { tf.current = null; setSelL(null); setSelTop(null); }, [layout]);
  // redraw on colour / size changes
  useEffect(() => { draw(); }, [draw]);

  // 执行时序 master clock: advances the play head (card-wash + flow), shared with the swimlane
  // via headRef. Runs in both layouts (so the swimlane head keeps moving); only the top view
  // needs a per-frame canvas redraw for the wash/flow.
  useEffect(() => {
    if (!playing) { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = null; return; }
    let last = performance.now();
    const seg = phaseSegments(runMode);
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      headRef.current = (headRef.current + dt / 7) % 1;   // ≈7s per training iteration
      phaseRef.current += dt * 1.4;                       // marching-ants dash offset
      // colour is constant within a phase → only the top view's marching-ants need a per-frame
      // redraw; otherwise redraw both views on a phase change so the wash steps forward.
      const id = (seg.find((s) => headRef.current < s.t1)?.p ?? seg[seg.length - 1].p).id;
      const flowVisible = layout === 'top' && !!tf.current && tf.current.s * L.cs > 4;
      if (flowVisible || id !== lastPhaseRef.current) { lastPhaseRef.current = id; draw(); }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = null; };
  }, [playing, draw, layout]);
  useEffect(() => {
    const onR = () => { tf.current = null; draw(); };   // re-fit on resize
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, [draw]);

  // ── interaction ──
  const toWorld = (clientX: number, clientY: number): [number, number] => {
    const cv = canvasRef.current!; const r = cv.getBoundingClientRect(); const t = tf.current!;
    return [(clientX - r.left - t.tx) / t.s, (clientY - r.top - t.ty) / t.s];
  };
  const onWheel = (e: React.WheelEvent) => {
    if (!tf.current) return; const t = tf.current; const r = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const wx = (mx - t.tx) / t.s, wy = (my - t.ty) / t.s;
    const fb = fit(r.width, r.height), maxZ = layout === 'layers' ? fb * 400 : fb * 110;   // deep zoom resolves 4 Die → AI Core (Cube/Vector)
    const f = Math.exp(-e.deltaY * 0.0015); const ns = Math.max(fb * 0.5, Math.min(t.s * f, maxZ));
    tf.current = { s: ns, tx: mx - wx * ns, ty: my - wy * ns }; draw();
  };
  const onDown = (e: React.PointerEvent) => { if (!tf.current) return; downXY.current = { x: e.clientX, y: e.clientY }; drag.current = { x: e.clientX, y: e.clientY, tx: tf.current.tx, ty: tf.current.ty }; (e.target as Element).setPointerCapture(e.pointerId); };
  const onUp = (e: React.PointerEvent) => {
    // a click (no drag) selects: layered → up/down-stream chain · top → a card (persistent highlight)
    if (downXY.current && Math.abs(e.clientX - downXY.current.x) + Math.abs(e.clientY - downXY.current.y) < 5) {
      const [wx, wy] = toWorld(e.clientX, e.clientY);
      if (layout === 'layers') { const hit = pickLayer(wx, wy); setSelL((prev) => (hit && prev && prev.lvl === hit.lvl && prev.idx === hit.idx ? null : hit)); if (hit) setSwOpen(true); }
      else {
        const k = pick(wx, wy);
        if (k == null) setSelTop(null);
        else { const sub = subPick(wx, wy, k); setSelTop((prev) => (prev && prev.k === k && prev.die === sub.die && prev.core === sub.core ? null : { k, ...sub })); setSwOpen(true); }
      }
    }
    downXY.current = null; drag.current = null; try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };
  const onMove = (e: React.PointerEvent) => {
    if (drag.current && tf.current) { tf.current = { ...tf.current, tx: drag.current.tx + (e.clientX - drag.current.x), ty: drag.current.ty + (e.clientY - drag.current.y) }; draw(); return; }
    if (layout === 'layers') return;   // layered view: pan/zoom only (no per-card hover)
    const [wx, wy] = toWorld(e.clientX, e.clientY); const k = pick(wx, wy);
    if (k !== hoverRef.current) { hoverRef.current = k; draw(); }
    const r = canvasRef.current!.getBoundingClientRect();
    setTip(k == null ? null : { k, x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const onLeave = () => { if (hoverRef.current != null) { hoverRef.current = null; draw(); } setTip(null); };

  const tipInfo = tip && (() => {
    const k = tip.k, b = Math.floor(k / CPB), cab = Math.floor(b / BPC);
    const parts = [`硬件：${TOK.n950} 卡 ${k}（1 device · 4 Die）`, `软件：rank ${k}（${TOK.hccl} 逻辑号 · 与 device 1:1）· tp${k % CPB}`, `约 ${CORES_PER_CARD} AI Core/卡 · 刀片 B${b} · 机柜 C${cab}`];
    if (colorBy !== 'none') parts.push(`${PARTITION_META[colorBy as Exclude<PartitionDim, 'none'>].label}：组 ${groupOf(k)}`);
    return parts;
  })();

  // which card is selected → drives the L0 swimlane drill-down (top: the card; layered:
  // the card that owns the selected card/die/core/tile cell)
  // swimlane is shown by DEFAULT (card 0 as a representative); selecting a card/Die/AI Core
  // just switches which device it profiles.
  const swCard = (() => {
    if (layout === 'top') return selTop?.k ?? 0;
    if (selL) { const Lv = LAY.levels[selL.lvl]; if (['card', 'die', 'core', 'tile'].includes(Lv.kind)) return Math.floor(selL.idx / (Lv.count / LAY.cardN)); }
    return 0;
  })();
  const swDefault = (layout === 'top' ? selTop == null : !selL);   // showing the default representative device (no explicit selection)
  // sub-context label for the swimlane header (which Die / AI Core, when finer-selected)
  const swSub = (() => {
    if (layout === 'top' && selTop) {
      if (selTop.core != null) return `计算 Die ${selTop.die} · AI Core ${selTop.die! * 16 + selTop.core}`;
      if (selTop.die != null) return `计算 Die ${selTop.die}`;
    }
    if (layout === 'layers' && selL) { const Lv = LAY.levels[selL.lvl]; if (Lv.kind === 'die') return '计算 Die'; if (Lv.kind === 'core') return 'AI Core'; if (Lv.kind === 'tile') return 'Tile / lane'; }
    return null;
  })();

  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0, zIndex: 11, background: 'var(--bg2)', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor: drag.current ? 'grabbing' : layout === 'layers' ? 'pointer' : 'crosshair', touchAction: 'none' }}
        onWheel={onWheel} onPointerDown={onDown} onPointerUp={onUp} onPointerMove={onMove} onPointerLeave={onLeave}
      />
      {/* physical-device layer & three planes (UB scale-up / RDMA scale-out / VPC) — shown in both layouts */}
      <PlanesPanel />
      {/* controls */}
      <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'var(--panel)', border: '1px solid var(--bd)', borderRadius: 12, boxShadow: 'var(--shadow)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}>
        {/* layout: top-down map vs. layered hierarchy */}
        <span style={{ ...LBL }}>布局</span>
        {([['top', '顶视图'], ['layers', '层级图']] as [typeof layout, string][]).map(([id, lb]) => {
          const on = layout === id;
          return <button key={id} onClick={() => setLayout(id)} title={id === 'top' ? '超节点顶视图（嵌套平铺）' : '层级矩阵图（L5 超节点→机柜→L4 节点→L3 卡/device→L2 计算 Die→L1 AI Core→L0 Tile，按 UB L0–L7 坐标）'}
            style={{ padding: '4px 11px', fontSize: 11.5, borderRadius: 7, cursor: 'pointer', ...navBtn(on) }}>{lb}</button>;
        })}
        <span style={{ borderLeft: '1px solid var(--bd)', height: 16, margin: '0 2px' }} />
        {layout === 'top' ? (
          <>
            <span style={{ ...LBL }}>上色</span>
            {COLOR_BTNS.map((c) => {
              const on = colorBy === c.id; const sig = PARALLEL_COLORS[c.id];
              return <button key={c.id} onClick={() => setColorBy(c.id)} title={`按 ${c.label} 上色`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', fontSize: 11.5, borderRadius: 7, cursor: 'pointer', ...(c.id === 'none' ? navBtn(on) : toggleBtn(on, sig)) }}>
                {c.id !== 'none' && <span style={{ width: 8, height: 8, borderRadius: 2, background: on ? inkOf(sig) : sig, display: 'inline-block', opacity: on ? 0.9 : 0.6 }} />}{c.label}
              </button>;
            })}
            <button onClick={() => setLinks((v) => !v)} title="连线：板内/板间 NPU（UB mesh）+ NPU-CPU · NPU-LPO · NIC-CPU（线型=平面），默认显示"
              style={{ padding: '4px 9px', fontSize: 11.5, borderRadius: 7, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 4, ...toggleBtn(links, UB_LEVELS[1].color) }}>
              <span style={{ width: 9, height: 3, background: links ? inkOf(UB_LEVELS[1].color) : UB_LEVELS[1].color, display: 'inline-block', borderRadius: 1, opacity: links ? 0.9 : 0.5 }} />连线
            </button>
            <span style={{ borderLeft: '1px solid var(--bd)', height: 16, margin: '0 2px' }} />
            {(['ring', 'a2a'] as const).map((sc) => {
              const on = scenario === sc, c = sc === 'ring' ? COMM_PATTERNS[0].color : COMM_PATTERNS[1].color;
              return <button key={sc} onClick={() => { setScenario(sc); setPlaying(true); }} title={sc === 'ring' ? 'Ring-AllReduce（数据并行梯度规约）' : 'All-to-All（MoE 专家并行）'}
                style={{ padding: '4px 9px', fontSize: 11.5, borderRadius: 7, cursor: 'pointer', ...toggleBtn(on, c) }}>{sc === 'ring' ? 'AllReduce' : 'All-to-All'}</button>;
            })}
            <button onClick={() => setPlaying((v) => !v)} title="播放 / 暂停 执行时序（卡随相位变色 + 数据流动 + 右下 swimlane）"
              style={{ padding: '4px 11px', fontSize: 11.5, borderRadius: 7, cursor: 'pointer', ...navBtn(playing) }}>{playing ? '⏸ 时序播放中' : '▶ 播放时序'}</button>
            <span style={{ fontSize: 10.5, color: 'var(--tx3)', marginLeft: 2 }}>{`${L.N1.toLocaleString()} 卡 · ${L.nC} 机柜 · 拖动/滚轮 · 放大后点卡可继续选 Die / AI Core · 选中 = 右下 L0 执行时序`}</span>
          </>
        ) : (
          <span style={{ fontSize: 10.5, color: 'var(--tx3)' }}>{`层级矩阵图 · L5 超节点→L0 Tile · 全量 ${LAY.cardN.toLocaleString()} 卡 → ${LAY.coreN.toLocaleString()} AI Core · 底部「器件互联平面」全量 NPU/CPU/LPO/NIC + 连线 · 按 ${TOK.ub} L0–L7 下探`}</span>
        )}
      </div>
      {/* legend (collapsible — avoids occluding the diagram / swimlane on small screens) */}
      <div style={{ position: 'absolute', bottom: 12, left: 12, maxWidth: 'min(420px, calc(100vw - 24px))', padding: '7px 11px', fontSize: 11, background: 'var(--panel)', border: '1px solid var(--bd)', borderRadius: 10, boxShadow: 'var(--shadow-sm)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', lineHeight: 1.6, color: 'var(--tx2)' }}>
        <div onClick={() => setLegendOpen((v) => !v)} title={legendOpen ? '收起图例' : '展开图例'} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 600, color: 'var(--tx)', marginBottom: legendOpen ? 3 : 0 }}>
          <span>{layout === 'top' ? `全量${TOK.supernode} · 平面拓扑` : `${TOK.supernode} · 层级矩阵图`}</span>
          <span style={{ marginLeft: 'auto', color: 'var(--tx3)', fontSize: 10 }}>{legendOpen ? '▾ 收起' : '▸ 图例'}</span>
        </div>
        {legendOpen && (layout === 'top' ? (
          <>
            <div style={{ color: 'var(--tx3)', fontSize: 10 }}><span style={{ color: ENTITY_COLORS.super }}>L5 本{TOK.supernode}</span>（{LAY.cabN.toLocaleString()} 机柜 / {LAY.cardN.toLocaleString()} NPU）↓ 以下为本超节点逐级展开</div>
            <div><span style={{ display: 'inline-block', width: 11, height: 11, background: 'rgba(167,139,250,0.18)', border: `1px solid ${UB_LEVELS[2].color}`, borderRadius: 2, verticalAlign: '-2px', marginRight: 5 }} />机柜框（机器域·含 8 刀片）</div>
            <div><span style={{ display: 'inline-block', width: 11, height: 11, border: `1px solid ${UB_LEVELS[1].color}`, borderRadius: 2, verticalAlign: '-2px', marginRight: 5 }} />L4 节点/刀片框（含 8 卡）</div>
            <div><span style={{ color: ENTITY_COLORS.card, fontWeight: 600 }}>卡 = 1 device</span>（硬件）· <span style={{ color: ENTITY_COLORS.rank, fontWeight: 600 }}>r 号 = rank</span>（软件 · 1:1 绑定） · <span style={{ display: 'inline-block', width: 7, height: 7, background: M_DIE, borderRadius: 1, verticalAlign: '-1px', marginLeft: 4, marginRight: 1 }} /><span style={{ display: 'inline-block', width: 7, height: 7, background: M_IO, borderRadius: 1, verticalAlign: '-1px', marginRight: 4 }} />卡内 L3→L2→L1：4 Die(2 计算+2 IO) · 再放大 <span style={{ display: 'inline-block', width: 6, height: 7, background: M_CUBE, borderRadius: 1, verticalAlign: '-1px', margin: '0 1px' }} /><span style={{ display: 'inline-block', width: 3, height: 7, background: M_VEC, borderRadius: 1, verticalAlign: '-1px', marginRight: 3 }} />AI Core(Cube/Vector·靠形状区分)</div>
            <div>{colorBy === 'none' ? '格子 = 1 张 950 卡 / device（嵌套=包含关系）' : `卡按 ${colorBy.toUpperCase()} 组上色（${cfg}）`}</div>
            <div style={{ borderTop: '1px solid var(--bd)', marginTop: 2, paddingTop: 2 }}>主机侧连线默认显示；放大刀片后显示物理器件（对象）：
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: PLANES[0].color, verticalAlign: '-1px', margin: '0 2px 0 4px' }} />NPU UB 口
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: PLANES[1].color, verticalAlign: '-1px', margin: '0 2px 0 4px' }} />RDMA 口 ·
              <span style={{ display: 'inline-block', width: 9, height: 7, borderRadius: 2, background: DEV_CPU, verticalAlign: '-1px', margin: '0 2px 0 4px' }} />CPU
              <span style={{ display: 'inline-block', width: 9, height: 7, borderRadius: 2, background: PLANES[0].color, verticalAlign: '-1px', margin: '0 2px 0 4px' }} />L1 交换
              <span style={{ display: 'inline-block', width: 9, height: 7, borderRadius: 2, background: DEV_LPO, verticalAlign: '-1px', margin: '0 2px 0 4px' }} />LPO
              <span style={{ display: 'inline-block', width: 9, height: 7, borderRadius: 2, background: PLANES[2].color, verticalAlign: '-1px', margin: '0 2px 0 4px' }} />擎天 NIC</div>
            <div style={{ color: '#9fb6ff' }}>{`${TOK.ub} L0–L7：机柜框/刀片框=机器域(L4–L5) · 卡=L3 Chip(rank) · 卡内 Die=L2 · AI Core=L1 · tile/lane=L0`}</div>
            {links && <div><span style={{ display: 'inline-block', width: 11, height: 0, borderTop: `2px solid ${UB_LEVELS[1].color}`, verticalAlign: 'middle', marginRight: 5 }} />板内 NPU(L1) · <span style={{ display: 'inline-block', width: 11, height: 0, borderTop: `2px solid ${UB_LEVELS[2].color}`, verticalAlign: 'middle', margin: '0 5px' }} />板间 NPU(L2)</div>}
            {links && <div style={{ color: 'var(--tx3)', fontSize: 10 }}>主机侧连线（默认显示·线型=平面）：
              <span style={{ display: 'inline-block', width: 14, height: 0, borderTop: '2px solid var(--tx2)', verticalAlign: 'middle', margin: '0 3px 0 5px' }} />实线 NPU-CPU(UB) ·
              <span style={{ display: 'inline-block', width: 14, height: 0, borderTop: '2px dashed var(--tx2)', verticalAlign: 'middle', margin: '0 3px 0 5px' }} />长虚 NPU-LPO(SO·光) ·
              <span style={{ display: 'inline-block', width: 14, height: 0, borderTop: '2px dotted var(--tx2)', verticalAlign: 'middle', margin: '0 3px 0 5px' }} />点线 NIC-CPU(VPC)</div>}
            {playing && <div>{[0, 1, 2, 3].map((i) => <span key={i} style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: stateColor(i), verticalAlign: '-1px', marginRight: 3 }} />)}<span style={{ color: 'var(--tx3)', marginLeft: 3 }}>状态：空闲&lt;40% / 中 / 繁忙&gt;70% / 离线</span></div>}
            {playing && <div style={{ color: 'var(--tx3)' }}>连线<b style={{ color: 'var(--tx2)' }}>颜色=利用率</b>、<b style={{ color: 'var(--tx2)' }}>粗细=带宽</b>（粗绿=大带宽空闲 / 细红=小带宽打满）；卡只在繁忙时上色 · 红黄绿=状态、蓝灰=结构 · 顶部=当前相位</div>}
          </>
        ) : (
          <>
            {/* each level = a matrix grid of its real units, with a distinct glyph */}
            {LAY.levels.map((Lv) => {
              const shape = ({ super: '本超节点·全量展开', cab: '柜+槽位', node: '刀片+8 NPU 点', card: '4 Die = 2 计算(UMA)+2 IO', die: '计算 Die + 16 AI Core 点', core: 'Cube/Vector 独立核(≈8:1)', tile: '聚合观测·下钻 swimlane' } as Record<string, string>)[Lv.kind];
              const lq = UB_COORD[Lv.kind];
              return <div key={Lv.kind}><span style={{ display: 'inline-block', width: 9, height: 9, background: Lv.color, borderRadius: 2, verticalAlign: '-1px', marginRight: 5 }} />{Lv.label} <span style={{ color: 'var(--tx3)' }}>{Lv.banner ? '' : `×${Lv.count.toLocaleString()} · `}{shape}</span>{lq && <span style={{ color: '#9fb6ff' }}> · {TOK.ub} {lq.L}</span>}</div>;
            })}
            <div style={{ borderTop: '1px solid var(--bd)', marginTop: 3, paddingTop: 3, color: 'var(--tx3)', fontSize: 10 }}>每层=该级全部单元的矩阵铺排 · 卡 L3 → 计算 Die L2(×2/卡) → AI Core L1(×16/Die) → Tile L0 逐级下探 · <span style={{ color: ENTITY_COLORS.card }}>硬件 device</span> ↔ <span style={{ color: ENTITY_COLORS.rank }}>软件 rank</span> 严格 1:1</div>
            <div style={{ color: 'var(--tx3)', fontSize: 10 }}>放大 L4 节点格 → 显示物理器件对象：8×NPU(各含
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: PLANES[0].color, verticalAlign: '-1px', margin: '0 1px 0 3px' }} />UB 口
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: PLANES[1].color, verticalAlign: '-1px', margin: '0 1px 0 3px' }} />RDMA 口) +
              <span style={{ display: 'inline-block', width: 8, height: 6, borderRadius: 2, background: DEV_CPU, verticalAlign: '-1px', margin: '0 1px 0 3px' }} />CPU
              <span style={{ display: 'inline-block', width: 8, height: 6, borderRadius: 2, background: PLANES[0].color, verticalAlign: '-1px', margin: '0 1px 0 3px' }} />交换
              <span style={{ display: 'inline-block', width: 8, height: 6, borderRadius: 2, background: DEV_LPO, verticalAlign: '-1px', margin: '0 1px 0 3px' }} />LPO
              <span style={{ display: 'inline-block', width: 8, height: 6, borderRadius: 2, background: PLANES[2].color, verticalAlign: '-1px', margin: '0 1px 0 3px' }} />NIC + 平面连线</div>
            <div style={{ color: '#9fb6ff', fontSize: 10 }}>{`层号 = ${TOK.ub} L0–L7 同一坐标：核内域(L0–L1) · 芯片域(L2–L3) · 机器域(L4–L5,机柜并入·无独立级) · 点格看右上对齐`}</div>
            <div style={{ color: 'var(--tx3)', fontSize: 10 }}>L2/L1/L0 数量巨大 → 概览<b style={{ color: ENTITY_COLORS.vector }}>聚合</b>、缩放才铺到个体；<b style={{ color: ENTITY_COLORS.vector }}>L0</b> 是聚合观测级（流水气泡/访存），逐核展开看执行时序 swimlane</div>
            <div style={{ color: SEL, fontSize: 10.5 }}>{selL ? '已选中：蓝色=上下游链路 · 选中卡/Die/AI Core → 右下 L0 执行时序 swimlane · 再点取消' : '点任一格 → 高亮上下游 + 右上详情；点卡及以下 → 右下 L0 swimlane'}</div>
            <div style={{ borderTop: '1px solid var(--bd)', marginTop: 4, paddingTop: 4, fontWeight: 600, color: 'var(--tx2)' }}>器件互联平面（底部）· 全量器件 + 连接</div>
            <div>
              <span style={{ display: 'inline-block', width: 9, height: 9, background: ENTITY_COLORS.card, borderRadius: 2, verticalAlign: '-1px', marginRight: 4 }} />NPU ×{LAY.dev.mats[0].count.toLocaleString()}
              <span style={{ display: 'inline-block', width: 9, height: 9, background: DEV_CPU, borderRadius: 2, verticalAlign: '-1px', margin: '0 4px 0 8px' }} />CPU ×{LAY.dev.mats[1].count.toLocaleString()}
              <span style={{ display: 'inline-block', width: 9, height: 9, background: DEV_LPO, borderRadius: 2, verticalAlign: '-1px', margin: '0 4px 0 8px' }} />LPO ×{LAY.dev.mats[2].count.toLocaleString()}
              <span style={{ display: 'inline-block', width: 9, height: 9, background: PLANES[2].color, borderRadius: 2, verticalAlign: '-1px', margin: '0 4px 0 8px' }} />NIC ×{LAY.dev.mats[3].count.toLocaleString()}</div>
            <div style={{ color: 'var(--tx3)', fontSize: 10 }}>连线线型=平面：
              <span style={{ display: 'inline-block', width: 14, height: 0, borderTop: '2px solid var(--tx2)', verticalAlign: 'middle', margin: '0 3px 0 5px' }} />实线 板内 NPU mesh / NPU-CPU（UB·SU） ·
              <span style={{ display: 'inline-block', width: 14, height: 0, borderTop: '2px dashed var(--tx2)', verticalAlign: 'middle', margin: '0 3px 0 5px' }} />长虚 板间 NPU / NPU-LPO（scale-out·光） ·
              <span style={{ display: 'inline-block', width: 14, height: 0, borderTop: '2px dotted var(--tx2)', verticalAlign: 'middle', margin: '0 3px 0 5px' }} />点线 NIC-CPU（VPC）</div>
            <div style={{ color: 'var(--tx3)', fontSize: 10 }}>颜色=利用率（播放时·红黄绿+灰离线）/ 粗细=带宽 · 中部为代表性刀片接线图，上方四格为全量矩阵</div>
          </>
        ))}
      </div>
      {/* layered-view selection detail — level semantics (层内 / 层间关系 + 带宽/域) */}
      {layout === 'layers' && selL && (() => {
        const info = LAYER_INFO[selL.lvl]; if (!info) return null;
        const col = LAY.levels[selL.lvl].color;
        return (
          <div style={{ position: 'absolute', top: 12, right: 12, width: 280, padding: '11px 13px', fontSize: 11.5, lineHeight: 1.5, background: 'var(--panel)', border: `1px solid ${col}`, borderRadius: 12, boxShadow: 'var(--shadow)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: col }} />
              <span style={{ fontWeight: 700, color: 'var(--tx)', fontSize: 12.5 }}>{info.name}</span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                {info.tag && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 5, color: info.tag.includes('1:1') ? '#04d793' : '#ffaa3b', border: `1px solid ${info.tag.includes('1:1') ? '#04d793' : '#ffaa3b'}` }}>{info.tag.split('（')[0]}</span>}
                {info.domain !== '—' && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 5, color: info.domain.includes('SU') ? '#04d793' : '#7c8db8', border: `1px solid ${info.domain.includes('SU') ? '#04d793' : '#7c8db8'}` }}>{info.domain}</span>}
              </span>
            </div>
            {/* hardware ↔ software cleanly separated (rank is never the hardware) */}
            {info.hw && <div style={{ marginBottom: 5, padding: '5px 7px', borderRadius: 7, background: 'rgba(45,212,191,0.10)', border: '1px solid rgba(45,212,191,0.38)' }}><span style={{ color: ENTITY_COLORS.hw, fontWeight: 700, fontSize: 10.5, letterSpacing: 0.3 }}>硬件 HW</span> <span style={{ color: 'var(--tx2)' }}>{info.hw.replace(/^硬件：/, '')}</span></div>}
            {info.sw && <div style={{ marginBottom: 6, padding: '5px 7px', borderRadius: 7, background: 'rgba(67,105,239,0.10)', border: '1px solid rgba(67,105,239,0.35)' }}><span style={{ color: ENTITY_COLORS.sw, fontWeight: 700, fontSize: 10.5, letterSpacing: 0.3 }}>软件 SW</span> <span style={{ color: 'var(--tx2)' }}>{info.sw.replace(/^软件：/, '')}</span></div>}
            <div style={{ marginBottom: 6 }}><span style={{ color: COMM_PATTERNS[2].color, fontWeight: 600 }}>层内关系</span> <span style={{ color: 'var(--tx2)' }}>{info.intra}</span></div>
            <div style={{ marginBottom: 6 }}><span style={{ color: '#4369ef', fontWeight: 600 }}>层间关系</span> <span style={{ color: 'var(--tx2)' }}>{info.inter}</span></div>
            <div style={{ color: 'var(--tx3)', fontSize: 10.5 }}>带宽/时延：{info.bw}</div>
            {/* per-level physical devices & plane (mirrors the reference 物理三平面 layer) */}
            {(() => { const phys = LEVEL_PHYS[LAY.levels[selL.lvl]?.kind]; if (!phys) return null; return (
              <div style={{ marginTop: 6, padding: '6px 7px', borderRadius: 7, background: `${phys.color}1c`, border: `1px solid ${phys.color}66` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: phys.color }} />
                  <span style={{ color: 'var(--tx)', fontWeight: 700, fontSize: 10.5 }}>物理 / 平面</span>
                  <span style={{ marginLeft: 'auto', fontSize: 9.5, padding: '0 6px', borderRadius: 5, color: phys.color, border: `1px solid ${phys.color}88` }}>{phys.planeLabel}</span>
                </div>
                <div style={{ color: 'var(--tx2)', fontSize: 10.5 }}>{phys.devices}</div>
              </div>
            ); })()}
            {/* UB L0–L7 软硬件同一坐标（L0–L7 对齐表） */}
            {UB_COORD[info.key] && (() => { const lq = UB_COORD[info.key]; return (
              <div style={{ marginTop: 6, padding: '6px 7px', borderRadius: 7, background: 'rgba(124,141,184,0.10)', border: '1px solid rgba(124,141,184,0.34)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ color: '#9fb6ff', fontWeight: 700, fontSize: 10.5, letterSpacing: 0.3 }}>{`${TOK.ub} ${lq.L}`}</span>
                  <span style={{ fontSize: 10, padding: '0 6px', borderRadius: 5, color: '#9fb6ff', border: '1px solid rgba(159,182,255,0.5)' }}>{lq.scope}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 9.5, color: 'var(--tx3)' }}>L0–L7 坐标</span>
                </div>
                <div style={{ color: 'var(--tx2)', fontSize: 10.5 }}>{lq.sw}</div>
                <div style={{ color: 'var(--tx3)', fontSize: 10 }}>可观测：{lq.obs}</div>
                {lq.note && <div style={{ color: 'var(--tx3)', fontSize: 9.5, marginTop: 2, fontStyle: 'italic' }}>{lq.note}</div>}
              </div>
            ); })()}
          </div>
        );
      })()}
      {/* L0 执行时序 swimlane — shown by default (bottom-right), phase-driven (load→Forward→
          Backward→AllReduce→optimizer). Its play head + the card phase-wash share ONE clock (headRef). */}
      {swOpen && <RunSwimlane card={swCard} sub={swSub} isDefault={swDefault} ink2={P.ink2}
        headRef={headRef} mode={runMode} setMode={setRunMode} playing={playing} setPlaying={setPlaying}
        onClose={() => { setSwOpen(false); setSelTop(null); setSelL(null); }} />}
      {/* hover tooltip */}
      {tip && tipInfo && (
        <div style={{ position: 'absolute', left: Math.min(tip.x + 14, (wrapRef.current?.clientWidth ?? 9999) - 200), top: tip.y + 14, padding: '6px 9px', fontSize: 11.5, background: 'var(--panel)', border: '1px solid var(--bd2)', borderRadius: 10, pointerEvents: 'none', boxShadow: 'var(--shadow-sm)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', color: 'var(--tx)' }}>
          {tipInfo.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
    </div>
  );
}

// ── L0 执行时序 swimlane — a compact, bottom-right drill-down that opens on selection.
// Phase-driven like the 3-D full-pod 时序: a phase band (load→Forward→Backward→AllReduce→
// optimizer) with a play head sweeping it, and a per-core swimlane that lights up by phase.
function RunSwimlane({ card, sub, isDefault, ink2, headRef, mode, setMode, playing, setPlaying, onClose }: {
  card: number; sub: string | null; isDefault: boolean; ink2: string; headRef: React.MutableRefObject<number>;
  mode: RunMode; setMode: (m: RunMode) => void; playing: boolean; setPlaying: (f: (v: boolean) => boolean) => void; onClose: () => void;
}) {
  const [, force] = useState(0);   // re-render each frame to follow the SHARED play head (headRef)
  const raf = useRef<number | null>(null);
  const sw = useMemo(() => runSwimlane(card, mode), [card, mode]);
  useEffect(() => {
    if (!playing) return;
    const loop = () => { force((f) => f + 1); raf.current = requestAnimationFrame(loop); };
    raf.current = requestAnimationFrame(loop);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); raf.current = null; };
  }, [playing]);
  const head = headRef.current;
  const cur = sw.seg.find((s) => head < s.t1) ?? sw.seg[sw.seg.length - 1];

  const W = 372, padL = 80, phH = 18, laneH = 12;
  const svgW = W - 22, span = svgW - padL, slotW = span / SW_T;
  const lanesY = phH + 6, lanesH = sw.rows.length * laneH, svgH = lanesY + lanesH + 12;
  const headX = padL + head * span;
  return (
    <div style={{ position: 'absolute', bottom: 12, right: 12, width: W, maxWidth: 'calc(100vw - 24px)', padding: '9px 11px', fontSize: 11, background: 'var(--panel)', border: `1px solid ${ENTITY_COLORS.cube}`, borderRadius: 12, boxShadow: 'var(--shadow)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', zIndex: 20 }}>
      {/* header: title + device + close */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
        <span style={{ fontWeight: 700, color: 'var(--tx)' }}>L0 执行时序</span>
        <span style={{ color: 'var(--tx3)', fontSize: 10.5 }}>{`device #${card}`}{sub ? ` · ${sub}` : isDefault ? '（默认示例·点卡切换）' : ` · rank ${card}`}</span>
        <button onClick={onClose} title="关闭" style={{ marginLeft: 'auto', ...SECONDARY, borderRadius: 7, cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: '2px 7px' }}>✕</button>
      </div>
      {/* transport: play / pause + train / infer toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <button onClick={() => setPlaying((v) => !v)} title="播放 / 暂停 时序" style={{ padding: '3px 10px', fontSize: 11, borderRadius: 7, cursor: 'pointer', ...toggleBtn(playing, ENTITY_COLORS.cube) }}>{playing ? '⏸ 暂停' : '▶ 播放'}</button>
        {(['train', 'infer'] as RunMode[]).map((m) => {
          const on = mode === m;
          return <button key={m} onClick={() => setMode(m)} title={m === 'train' ? '训练迭代时序' : '推理时序'} style={{ padding: '3px 10px', fontSize: 11, borderRadius: 7, cursor: 'pointer', ...navBtn(on) }}>{m === 'train' ? '训练' : '推理'}</button>;
        })}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 9, fontWeight: 600, fontSize: 10.5, ...TNUM }}>
          <span style={{ color: '#04d793' }}>算力 {sw.util}%</span>
          <span style={{ color: '#ffaa3b' }}>访存 {sw.mem}%</span>
          <span style={{ color: 'var(--tx3)' }}>气泡 {sw.bub}%</span>
        </span>
      </div>
      <svg width={svgW} height={svgH} style={{ display: 'block' }}>
        {/* phase band: segments coloured by run phase, active one brighter */}
        {sw.seg.map((s, i) => {
          const x = padL + s.t0 * span, w = (s.t1 - s.t0) * span, active = s === cur;
          return (
            <g key={i}>
              <rect x={x} y={0} width={Math.max(0, w - 1)} height={phH} rx={3} fill={s.p.color} opacity={active ? 0.55 : 0.2} />
              {w > 26 && <text x={x + w / 2} y={phH / 2 + 3.5} textAnchor="middle" fontSize={9} fill={active ? '#fff' : ink2} style={{ fontWeight: active ? 700 : 400 }}>{s.p.name.split(' ')[0]}</text>}
            </g>
          );
        })}
        {/* lanes — per AI Core / DMA, coloured by what the current phase makes it do */}
        {sw.rows.map((r, ri) => (
          <g key={ri} transform={`translate(0,${lanesY + ri * laneH})`}>
            <text x={padL - 6} y={laneH / 2 + 3} textAnchor="end" fontSize={8.5} fill={ink2}>{r.name}</text>
            {r.slots.map((st, ti) => st === 'bubble' ? null : (
              <rect key={ti} x={padL + ti * slotW} y={1.5} width={Math.max(0.7, slotW - 0.4)} height={laneH - 3} rx={1} fill={SW_COLOR[st]} />
            ))}
          </g>
        ))}
        {/* play head sweeping the phases (spans band + lanes) */}
        <line x1={headX} y1={0} x2={headX} y2={lanesY + lanesH} stroke={ENTITY_COLORS.cube} strokeWidth={1.4} />
        <circle cx={headX} cy={0} r={2.6} fill={ENTITY_COLORS.cube} />
        <text x={padL} y={svgH - 2} fontSize={8.5} fill={ink2}>← 时间 t（一次迭代）→</text>
      </svg>
      {/* current phase note + legend */}
      <div style={{ marginTop: 3, fontSize: 10, color: 'var(--tx2)' }}>
        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: cur.p.color, verticalAlign: '-1px', marginRight: 4 }} />
        <b style={{ color: 'var(--tx)' }}>{cur.p.name}</b>{cur.p.parallel && cur.p.parallel !== '—' ? <span style={{ color: '#9fb6ff' }}> · {cur.p.parallel}</span> : null} <span style={{ color: 'var(--tx3)' }}>{cur.p.note}</span>
      </div>
      <div style={{ marginTop: 2, fontSize: 9.5, color: 'var(--tx3)' }}>
        <span style={{ color: '#04d793' }}>■</span>计算 · <span style={{ color: '#ffaa3b' }}>■</span>访存 · <span style={{ color: '#ff4b7b' }}>■</span>通信等待 · <span style={{ color: '#60a5fa' }}>■</span>加载 · ▢气泡 — 通信/加载相位算力闲置 = 气泡来源
      </div>
    </div>
  );
}

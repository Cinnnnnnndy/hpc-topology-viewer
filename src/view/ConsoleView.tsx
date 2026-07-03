/**
 * ConsoleView — 联动控制台. One linked module fusing the three existing views per the reference
 * Smartscape (Dynatrace-style) interaction:
 *   · LEFT  = 平面视图「层级图」改造成 Smartscape 8 级漏斗 (全球 L7→集群 L6→服务池 L5→Pod L4→Host L3→Chip L2 + 卡内 Die L1/Core-Group L0)，
 *             作为控制：点一个实体只展开/高亮它的「链路」(祖先+后代，按方向过滤)。
 *   · RIGHT = 阵列全景 (FullPodScene, 全量 Pod) 作为主视图：scopeOnly 模式只显示左侧链路的内容
 *             (链路内按状态/负载上色，链路外全部压暗)。
 *   · 运行状态 = 分析仪表 (集群 KPI · 实体辅助指标 · DAVIS 根因)。
 *
 * 所有样式/图元/状态/连接/上下层级与层内关系都用既有方案：FullPodScene 组件 + 同一套 data.ts
 * 色彩/状态/负载函数 (loadColor / loadState / stateColor / nodeLoad / isHot / ENTITY_COLORS / PLANES)。
 */
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  GENERATIONS, ENTITY_COLORS, PARALLEL_COLORS, PARALLEL_COLORS_SP, PARTITION_META, PLANES, LEVEL_PHYS, HW_LEVELS,
  PODS_PER_CLUSTER, POOLS_PER_CLUSTER, PODS_PER_POOL,
  loadColor, loadState, stateColor, STATE_LABELS, nodeLoad, isHot,
  REPLAY, cardLoad01, cardStraggler, cardFault, cardMetric01, parallelMap,
  type Gen, type PartitionDim, type ParDim, type RunPhase, type RunMode, type ViewSync,
} from '../scene/data';
import { FullPodScene, SceneTheme, type CommOverlays } from '../scene/scenes';
import { CoreGroupMiniSvg } from './arch-glyphs';
import { SceneVisualProfileContext, sceneSurface } from '../scene/visual-profile';

// ── hierarchy fan-out (8×8 schematic shared with FullPodScene full=true): 8 卡/刀片 · 8 刀片/柜 →
//    64 卡/柜. A global card index `k` maps the SAME way in the left 层级 and the right 3D array. ──
const CPB = 8, BPC = 8, PER_CAB = CPB * BPC;
const STEP_MAX = REPLAY.stepMax, EVT_LO = REPLAY.evtLo, EVT_HI = REPLAY.evtHi, EVT_CAB = REPLAY.evtCab;   // shared replay/event window (data.ts)

type Workload = 'pretrain' | 'prefill' | 'decode';
type Metric = 'util' | 'strag' | 'fault';
type Lens = 'heat' | 'flow' | 'domain' | 'phys';
type Dir = 'all' | 'up' | 'down';
// hw-native-sys L4→L0 焦点级（L7 全球/L6 集群/L5 服务池 为上层上下文，点击即回到整 Pod，不作 focus）。
// 机柜不是层级（仅物理分组）、Tile 不是层级（L0 Core-Group 内部），均不出现在焦点级里。
type Level = 'super' | 'node' | 'card' | 'die' | 'core';
type Focus = { level: Level; card: number; die?: number; core?: number } | null;

const WL: Record<Workload, { label: string; kind: RunPhase['kind'] }> = {
  pretrain: { label: '预训练', kind: 'compute' },
  prefill: { label: 'Prefill', kind: 'compute' },
  decode: { label: 'Decode', kind: 'comm' },
};
const M_LABEL: Record<Metric, string> = { util: '利用率', strag: '掉队率', fault: '故障度' };
const LENS_LABEL: Record<Lens, string> = { heat: '状态热力', flow: '机柜流量', domain: '通信域', phys: '物理链路' };
const D_LABEL: Record<Dir, string> = { all: '全链', up: '上游', down: '下游' };
const LEVEL_NAME: Record<string, string> = { global: '全球', cluster: '集群', pool: '服务池', super: 'Pod', node: 'Host', card: 'Chip·NPU', die: '计算 Die', core: 'Core-Group' };

// ── metric model — thin aliases over the SHARED model in data.ts (same value as 运行状态) ──
const cardLoad = (k: number, wlKind: string, step: number) => cardLoad01(k, wlKind, step);
const isStrag = (k: number, step: number) => cardStraggler(k, step);
const isFault = (k: number, step: number) => cardFault(k, step);
const cardMetric = (k: number, metric: Metric, wlKind: string, step: number) => cardMetric01(k, metric, wlKind, step);

// ── hierarchy navigation / scope — 阶梯（Le）：L4 Pod=3 · L3 Host=4 · L2 Chip=5（含 die/core）。
//    Pod 直接含 1024 Host、Host 含 8 Chip（无机柜档位；机柜仅为 3D 物理分组）。 ──
const levelIdx = (lv: Level): number => (lv === 'super' ? 3 : lv === 'node' ? 4 : 5);   // card/die/core → 5
function scopeRange(f: Focus, N: number): [number, number] {
  if (!f || f.level === 'super') return [0, N];
  if (f.level === 'node') { const n = Math.floor(f.card / CPB); return [n * CPB, Math.min(N, (n + 1) * CPB)]; }
  return [f.card, f.card + 1];   // card / die / core
}
// which entity indices of tier Le are on the focus's chain (ancestor / self / descendant), dir-filtered.
// returns null = "no focus → overview (show all, capped)". Le: 3 Pod · 4 Host · 5 Chip.
function tierInScope(Le: number, focus: Focus, dir: Dir, N: number, nBlades: number): number[] | null {
  if (!focus || focus.level === 'super') return null;
  const Lf = levelIdx(focus.level);
  const counts = [1, 1, 1, 1, nBlades, N];
  const div = [N, N, N, N, CPB, 1][Le];
  const [flo, fhi] = scopeRange(focus, N);
  const range = (a: number, b: number) => { const o: number[] = []; for (let i = a; i < b; i++) o.push(i); return o; };
  const hostMates = () => { const cab = Math.floor(flo / PER_CAB); return range(cab * BPC, Math.min(nBlades, (cab + 1) * BPC)); };   // 同物理分组 8 Host (UB mesh 特例)
  if (Le < Lf) {                          // ancestor
    if (dir === 'down') return [];
    if (dir === 'all' && Le === 4 && Lf >= 4) return hostMates();
    return [Math.floor(flo / div)];
  }
  if (Le === Lf) {                        // focus tier (Host tier expands to same-group UB mates on 全链)
    if (dir === 'all' && Le === 4) return hostMates();
    return [Math.floor(flo / div)];
  }
  if (dir === 'up') return [];            // descendant
  return range(Math.floor(flo / div), Math.min(counts[Le], Math.floor((fhi - 1) / div) + 1));
}
function entityToFocus(Le: number, idx: number): Focus {
  if (Le === 3) return { level: 'super', card: 0 };   // Pod = whole scope
  if (Le === 4) return { level: 'node', card: idx * CPB };   // Host
  return { level: 'card', card: idx };                 // Chip (Le 5)
}
function focusToSel(f: Focus): { lv: number; i: number } | null {
  // 3D 全景选择级：lv 0=card · lv 1=blade(Host) · lv 2=cabinet(物理分组)。
  if (!f || f.level === 'super') return null;
  if (f.level === 'node') return { lv: 1, i: Math.floor(f.card / CPB) };
  return { lv: 0, i: f.card };   // card / die / core → 高亮该卡
}
function selToFocus(s: { lv: number; i: number } | null): Focus {
  if (!s) return null;
  if (s.lv === 1) return { level: 'node', card: s.i * CPB };
  if (s.lv === 2) return { level: 'super', card: 0 };   // 机柜=物理分组，不是层级 → 回到整 Pod
  return { level: 'card', card: s.i };
}
function focusName(f: Focus): string {
  if (!f || f.level === 'super') return '全量 Pod';
  const k = f.card;
  if (f.level === 'node') return `Host B${Math.floor(k / CPB)}`;
  if (f.level === 'card') return `Chip r${k}（device）`;
  if (f.level === 'die') return `Chip ${k} · Die ${f.die ?? 0}`;
  if (f.level === 'core') return `Chip ${k} · Core-Group 核 #${f.core ?? 0}`;
  return `Chip ${k}`;
}

// ── shared button language ──
const ACCENT = '#4369ef';
const SECONDARY: React.CSSProperties = { border: '1px solid var(--button-secondary-border)', background: 'var(--button-secondary-bg)', color: 'var(--foreground-muted)' };
function ink(hex: string): string { const h = hex.replace('#', ''); if (h.length < 6) return '#fff'; const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#10131a' : '#fff'; }
function navBtn(on: boolean): React.CSSProperties { return on ? { border: '1px solid var(--primary)', background: 'var(--primary)', color: 'var(--primary-foreground)', fontWeight: 600, transform: 'translateY(-1px)', boxShadow: '0 1px 3px rgba(67,105,239,0.40)' } : { ...SECONDARY }; }
function toggleBtn(on: boolean, c: string): React.CSSProperties { return on ? { border: `1px solid ${c}`, background: c, color: ink(c), fontWeight: 600 } : { ...SECONDARY }; }
const GLAB: React.CSSProperties = { fontSize: 11, fontWeight: 500, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--tx3)', alignSelf: 'center' };
const TNUM: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };
const btnBase: React.CSSProperties = { padding: '4px 10px', fontSize: 11.5, borderRadius: 8, cursor: 'pointer' };
const OVERLAYS: CommOverlays = { ring: false, a2a: false, tile: true, cores: true };

// collective-comm glyph: ring (环状 AllReduce) / a2a (全互联 All-to-All) / p2p (阶段链)
function CollGlyph({ pat, c }: { pat: 'ring' | 'a2a' | 'p2p'; c: string }) {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" style={{ flexShrink: 0 }} aria-hidden>
      {pat === 'ring' && <circle cx={7} cy={7} r={4.6} fill="none" stroke={c} strokeWidth={1.5} />}
      {pat === 'a2a' && <><line x1={2} y1={2} x2={12} y2={12} stroke={c} strokeWidth={1.3} /><line x1={12} y1={2} x2={2} y2={12} stroke={c} strokeWidth={1.3} /><line x1={2} y1={7} x2={12} y2={7} stroke={c} strokeWidth={1.3} /></>}
      {pat === 'p2p' && <><line x1={2} y1={7} x2={11} y2={7} stroke={c} strokeWidth={1.5} /><path d="M8 4 L12 7 L8 10" fill="none" stroke={c} strokeWidth={1.5} strokeLinejoin="round" /></>}
    </svg>
  );
}

// Frame the orthographic camera on the focused scope (pan target + zoom); with no focus it settles
// on the whole-field overview. Animates on focus CHANGE then releases, so the user can still orbit/zoom.
function FrameCamera({ bounds, reach, controls, zoomScale = 1 }: {
  bounds: { cx: number; cy: number; cz: number; r: number } | null;
  reach: number;
  controls: React.MutableRefObject<{ target: THREE.Vector3; update: () => void } | null>;
  zoomScale?: number;
}) {
  const { camera, size } = useThree();
  const init = useRef(false);
  const settling = useRef(true);
  const tgt = useMemo(() => (bounds
    ? { pos: new THREE.Vector3(bounds.cx, bounds.cy, bounds.cz), worldH: bounds.r * 2.4 }
    : { pos: new THREE.Vector3(0, Math.min(6, reach * 0.1), 0), worldH: Math.max(14, reach * 1.5) }), [bounds, reach]);
  useEffect(() => { settling.current = true; }, [tgt]);   // re-animate whenever the scope changes
  useEffect(() => {                                        // set the 2.5-D iso direction + distance once
    if (init.current || size.height < 10) return; init.current = true;
    camera.position.copy(tgt.pos).addScaledVector(new THREE.Vector3(1, 0.82, 1).normalize(), reach * 1.3);
    camera.up.set(0, 1, 0); camera.updateProjectionMatrix();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, reach, size.height]);
  useFrame(() => {
    if (!controls.current || !settling.current || size.height < 10) return;
    controls.current.target.lerp(tgt.pos, 0.14);
    const oc = camera as THREE.OrthographicCamera, want = size.height / tgt.worldH * zoomScale;
    if (oc.isOrthographicCamera) { oc.zoom += (want - oc.zoom) * 0.14; oc.updateProjectionMatrix(); }
    controls.current.update();
    if (controls.current.target.distanceTo(tgt.pos) < 0.08 && Math.abs((oc.zoom ?? want) - want) < 0.06) settling.current = false;
  });
  return null;
}

// ── stats (per-tier distributions + KPI) computed in one pass over all cards ──
interface Stats {
  kpi: { util: number; hot: number; strag: number; faultDom: number };
  clusterMean: number; cabVals: number[]; ndVals: number[]; cardVals: number[];
  agg: Record<'cluster' | 'cab' | 'node' | 'card', { p50: number; p95: number; red: number }>;
}

// ── LEFT: Smartscape 8 级漏斗 (改造自平面视图层级图) — 图元/配色与「层级图」「选中链路·层级图」统一：
//    上三级 L7 全球 / L6 集群 / L5 服务池 = 焦点 pill + 半透明幽灵 sibling（不可点，点焦点回整 Pod）；
//    L4 Pod=玫紫 pill · L3 Host=天蓝 · L2 Chip=teal 卡图元(2×2 Die 点) · L1 Die=网格 · L0 Core-Group=原生 CoreGroupMiniSvg 图元。
//    级间连线挂互联名小 chip（DCN/Scale-Out/Pool 内互联/Scale-Up/PCIe·UB/封装互连/NoC）。 ──
const SVG_W = 600, SVG_H = 724, X0 = 118, X1 = 586, BUDGET = 26;
// ctx-tier centered funnel geometry: current glyph sits ON the center spine, siblings flank symmetrically.
// uniform abstract 2D glyphs per level (like the chip 2×2-die glyph) — small counts render EVERY member.
const CX_SPINE = (X0 + X1) / 2, CTX_GW = 20, CTX_GAP = 5, CTX_SLOT = CTX_GW + CTX_GAP;
// x-center of the k-th sibling glyph on a given side (+1 right / -1 left) of the spine-centered current glyph.
const ctxSibCx = (side: number, k: number) => CX_SPINE + side * k * CTX_SLOT;
// how many sibling glyphs fit per side before hitting the panel edge (so ≤~16 members show in full).
const ctxPerSide = Math.floor(((X1 - CX_SPINE) - CTX_GW / 2 - 4) / CTX_SLOT);
// Le 阶梯：0 全球 · 1 集群 · 2 服务池（ctx 上层上下文）· 3 Pod · 4 Host · 5 Chip。
interface Tier { Le: number; key: string; ctx?: boolean; y: number; h: number; maxW?: number; tag: string; label: string; col: string; ghosts?: string[] }
const TIERS: Tier[] = [
  { Le: 0, key: 'global',  ctx: true, y: 30, h: 16, maxW: 150, tag: 'L7', label: '全球',      col: ENTITY_COLORS.global,  ghosts: ['Global A', 'Global C'] },
  { Le: 1, key: 'cluster', ctx: true, y: 66, h: 16, maxW: 150, tag: 'L6', label: '集群',      col: ENTITY_COLORS.cluster, ghosts: ['Cluster A', 'Cluster C'] },
  { Le: 2, key: 'pool',    ctx: true, y: 102, h: 16, maxW: 150, tag: 'L5', label: '服务池',    col: ENTITY_COLORS.pool,    ghosts: ['Pool 1', 'Pool 3'] },
  { Le: 3, key: 'super',   y: 150, h: 22, maxW: 168, tag: 'L4', label: 'Pod',        col: ENTITY_COLORS.super },
  { Le: 4, key: 'node',    y: 232, h: 15, maxW: 52,  tag: 'L3', label: 'Host',       col: ENTITY_COLORS.node },
  { Le: 5, key: 'card',    y: 314, h: 17, maxW: 20,  tag: 'L2', label: 'Chip·NPU',   col: ENTITY_COLORS.card },
];
interface SubTier { key: string; lvl: Level; y: number; n: number; tag: string; label: string; cols?: number; cell?: number; gap?: number; seed?: number; col?: (i: number) => string }
const SUBTIERS: SubTier[] = [
  { key: 'die',  lvl: 'die',  y: 396, cols: 4, cell: 30, gap: 10, n: 4, seed: 131, tag: 'L1', label: '计算 Die（可选）', col: (i: number) => (i < 2 ? ENTITY_COLORS.computeDie : ENTITY_COLORS.ioDie) },
  { key: 'core', lvl: 'core', y: 470, n: 32, tag: 'L0', label: 'Core-Group' },   // 原生 CoreGroupMiniSvg 图元（非网格）
];
// 级间互联小 chip（y=连线中点，居中）：HW_LEVELS[i].down.label/color。
const CX_MID = (X0 + X1) / 2;
const ICHIPS: { y: number; li: number }[] = [
  { y: 48, li: 0 },   // 全球→集群 DCN
  { y: 84, li: 1 },   // 集群→服务池 Scale-Out
  { y: 126, li: 2 },  // 服务池→Pod Pool 内互联
  { y: 191, li: 3 },  // Pod→Host Scale-Up
  { y: 273, li: 4 },  // Host→Chip PCIe/UB
  { y: 372, li: 5 },  // Chip→Die 封装互连
  { y: 443, li: 6 },  // Die→Core-Group NoC
];

function Smartscape({ N, nBlades, focus, setFocus, metric, wlKind, step, dir, planeOn, playing, stats, dark, flow, pm }: {
  N: number; nBlades: number; focus: Focus; setFocus: (f: Focus) => void;
  metric: Metric; wlKind: string; step: number; dir: Dir; planeOn: { ub: boolean; rdma: boolean; vpc: boolean }; playing: boolean; stats: Stats; dark: boolean; flow: boolean;
  pm: ReturnType<typeof parallelMap>;
}) {
  const P = dark
    ? { ink: '#e6ebf2', ink2: '#9aa6b4', ink3: '#5f6b79', line: '#2a323d', pill: '#1b212b', pillBd: '#2a323d', die: 'rgba(9,13,20,0.55)' }
    : { ink: '#1c2433', ink2: '#5b6573', ink3: '#9099a8', line: '#d6dbe4', pill: '#eef1f6', pillBd: '#d2d8e2', die: 'rgba(255,255,255,0.55)' };
  const total = (Le: number) => [1, 1, 1, 1, nBlades, N][Le];
  const metricOf = (Le: number, idx: number): number =>
    Le <= 3 ? stats.clusterMean : Le === 4 ? (stats.ndVals[idx] ?? 0) : cardMetric(idx, metric, wlKind, step);
  const aggOf = (Le: number) => (Le <= 3 ? stats.agg.cluster : Le === 4 ? stats.agg.node : stats.agg.card);
  const selLe = !focus ? -1 : focus.level === 'super' ? 3 : focus.level === 'node' ? 4 : 5;   // card/die/core → 5 (Chip 卡)
  const selIdx = selLe < 0 ? -1 : selLe === 3 ? 0 : selLe === 4 ? Math.floor(focus!.card / CPB) : focus!.card;
  const focusCard = focus && (focus.level === 'card' || focus.level === 'die' || focus.level === 'core') ? focus.card : null;
  const hasDrillFocus = !!focus && focus.level !== 'super';
  const ringC = dark ? '#fff' : '#10131a';
  // structure = glyph + position; state = 红黄绿 (only when playing) — else hierarchy colour (同层级图)
  const fillOf = (Le: number, idx: number, base: string) => (playing ? loadColor(metricOf(Le, idx)) : base);

  // build per-tier shown lists + positions（仅可下钻漏斗级 super/node/card；上三级 ctx 单独渲染）
  const pos: Record<number, Record<number, { x: number; y: number }>> = {};
  const rows = TIERS.filter((t) => !t.ctx).map((t) => {
    const sc = tierInScope(t.Le, focus, dir, N, nBlades);
    const full = sc === null;
    const baseList = full ? Array.from({ length: Math.min(total(t.Le), BUDGET) }, (_, i) => i) : sc;
    const shownIdx = baseList.slice(0, BUDGET);
    const inCount = full ? total(t.Le) : sc.length;
    const fold = inCount - shownIdx.length;
    const slots = shownIdx.length + (fold > 0 ? 1 : 0);
    const slotW = (X1 - X0) / Math.max(1, slots);
    pos[t.Le] = {};
    const shown = shownIdx.map((idx, i) => { const x = X0 + (X1 - X0) * (i + 0.5) / Math.max(1, slots); pos[t.Le][idx] = { x, y: t.y }; return { idx, x }; });
    const foldX = fold > 0 ? X0 + (X1 - X0) * (slots - 0.5) / Math.max(1, slots) : null;
    return { t, shown, fold, foldX, inCount, slotW };
  });

  const parentOf = (Le: number, idx: number): { Le: number; idx: number } | null =>
    Le === 5 ? { Le: 4, idx: Math.floor(idx / CPB) } : Le === 4 ? { Le: 3, idx: 0 } : null;   // Chip→Host, Host→Pod

  const els: React.ReactNode[] = [];
  // connector language mirrors 平面视图「选中链路·层级图」(SelHierPanel): a solid SEL line +
  // connector dots (色环 + 白芯) at the junctions + 运行时沿线流动的白色彗星 (SMIL marching-ants).
  const tierH = (Le: number) => (TIERS.find((tt) => tt.Le === Le)?.h ?? 16);
  const cdot = (x: number, y: number, c: string, k: string, r = 2.4) => (
    <g key={k}><circle cx={x} cy={y} r={r} fill={c} /><circle cx={x} cy={y} r={r * 0.42} fill="#fff" /></g>
  );
  const cflow = (x1: number, y1: number, x2: number, y2: number, k: string) => (playing ? (
    <line key={k} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeDasharray="3 12" opacity={0.82}>
      <animate attributeName="stroke-dashoffset" from="15" to="0" dur="0.6s" repeatCount="indefinite" />
    </line>
  ) : null);
  // 0) ALWAYS-ON containment funnel — 层级间关系（overview 也画）：
  //    L7→L6→L5→L4 中心竖脊 (ctx 当前 pill 都坐在脊上) + L4 Pod → L3 Host 漏斗楔形（1 Pod ⊃ 1024 Host）。
  {
    const podY = TIERS[3].y, podH = TIERS[3].h;
    els.push(<line key="spine" x1={CX_SPINE} y1={TIERS[0].y} x2={CX_SPINE} y2={podY} stroke={ACCENT} strokeWidth={1.5} strokeOpacity={0.4} />);
    els.push(cflow(CX_SPINE, TIERS[0].y, CX_SPINE, podY, 'spine-flow'));
    [TIERS[0].y, TIERS[1].y, TIERS[2].y].forEach((yy, i) => els.push(cdot(CX_SPINE, yy, ACCENT, `sp-dot-${i}`, 2.4)));
    const hostRow = rows.find((r) => r.t.Le === 4);
    if (hostRow && hostRow.shown.length) {
      const hy = TIERS[4].y, hh = TIERS[4].h, xs = hostRow.shown.map((s) => s.x);
      const left = Math.min(...xs) - 4, right = Math.max(...xs) + 4, apexY = podY + podH / 2, baseY = hy - hh / 2 - 2;
      els.push(<path key="ph-wedge" d={`M${CX_SPINE - 16} ${apexY} L${left} ${baseY} L${right} ${baseY} L${CX_SPINE + 16} ${apexY} Z`} fill={ACCENT} fillOpacity={0.07} />);
      els.push(<line key="ph-spine" x1={CX_SPINE} y1={apexY} x2={CX_SPINE} y2={baseY} stroke={ACCENT} strokeWidth={1.2} strokeOpacity={0.33} />);
      els.push(cdot(CX_SPINE, apexY, ACCENT, 'ph-apex', 2.2));
    }
  }
  // 1) containment connectors (edge-to-edge) + connector dots (focus only) — 上下层级关系
  if (focus) {
    const parentDots = new Map<string, [number, number]>();
    rows.forEach(({ t, shown }) => {
      shown.forEach(({ idx, x }) => {
        const par = parentOf(t.Le, idx); if (!par) return;
        const pp = pos[par.Le]?.[par.idx]; if (!pp) return;
        const cTop = t.y - t.h / 2, pBot = pp.y + tierH(par.Le) / 2;
        els.push(<line key={`c-${t.Le}-${idx}`} x1={x} y1={cTop} x2={pp.x} y2={pBot} stroke={ACCENT} strokeWidth={1.3} strokeOpacity={0.55} />);
        els.push(cflow(pp.x, pBot, x, cTop, `cf-${t.Le}-${idx}`));
        els.push(cdot(x, cTop, ACCENT, `cd-${t.Le}-${idx}`, 2.2));
        parentDots.set(`${par.Le}-${par.idx}`, [pp.x, pBot]);
      });
    });
    parentDots.forEach(([px, py], k) => els.push(cdot(px, py, ACCENT, `pd-${k}`)));
    // 2) UB plane mesh between Host-tier siblings (横向同级关系)
    if (planeOn.ub) {
      const nr = rows.find((r) => r.t.Le === 4);
      if (nr) { const ny = nr.t.y; for (let i = 0; i < nr.shown.length - 1; i++) { const a = nr.shown[i], b = nr.shown[i + 1], mx = (a.x + b.x) / 2; els.push(<path key={`ub-${i}`} d={`M${a.x} ${ny} Q ${mx} ${ny - 15} ${b.x} ${ny}`} fill="none" stroke={PLANES[0].color} strokeWidth={1} strokeOpacity={0.55} />); } }
    }
  }
  // 3) tier glyphs — pill (Pod) / block (Host) / card-glyph(2×2 Die) (Chip)
  rows.forEach(({ t, shown, fold, foldX, slotW }) => {
    const maxW = t.maxW ?? 40;
    shown.forEach(({ idx, x }) => {
      const isSel = t.Le === selLe && idx === selIdx, fill = fillOf(t.Le, idx, t.col);
      const strag = playing && t.Le === 5 && isStrag(idx, step);
      const cy = t.y, click = (e: React.MouseEvent) => { e.stopPropagation(); setFocus(isSel ? null : entityToFocus(t.Le, idx)); };
      if (t.Le === 5) {           // Chip glyph: rounded square + 2×2 Die dots
        const s = Math.max(9, Math.min(maxW, slotW * 0.82)), gx = x - s / 2, gy = cy - s / 2, ins = s * 0.17, gp = s * 0.08, dw = (s - ins * 2 - gp) / 2;
        els.push(
          <g key={`g-5-${idx}`} style={{ cursor: 'pointer' }} onClick={click}>
            {(isSel || strag) && <rect x={gx - 3} y={gy - 3} width={s + 6} height={s + 6} rx={s * 0.34} fill="none" stroke={isSel ? ringC : '#b07bff'} strokeWidth={1.8} />}
            <rect x={gx} y={gy} width={s} height={s} rx={s * 0.24} fill={fill} />
            {s >= 12 && [0, 1, 2, 3].map((q) => <rect key={q} x={gx + ins + (q % 2) * (dw + gp)} y={gy + ins + Math.floor(q / 2) * (dw + gp)} width={dw} height={dw} rx={dw * 0.3} fill={P.die} />)}
          </g>,
        );
      } else {                    // Pod / Host : rounded pill (+ id label when wide)
        const w = Math.max(11, Math.min(maxW, slotW * 0.82)), h = t.h, gx = x - w / 2, gy = cy - h / 2;
        const isPod = t.Le === 3;
        const lbl = isPod ? '本 Pod' : w >= 30 ? `B${idx}` : '';
        const ic = ink(t.col);
        els.push(
          <g key={`g-${t.Le}-${idx}`} style={{ cursor: 'pointer' }} onClick={click}>
            {isSel && <rect x={gx - 3} y={gy - 3} width={w + 6} height={h + 6} rx={(h + 6) * 0.36} fill="none" stroke={ringC} strokeWidth={1.8} />}
            <rect x={gx} y={gy} width={w} height={h} rx={h * 0.34} fill={fill} />
            {isPod && (   // 本 Pod = 展开的当前 Pod：左侧点阵示意 Host 阵列（对应下方 L3 Host 行）+ 文字
              <g style={{ pointerEvents: 'none' }}>
                {[0, 1, 2, 3, 4, 5].flatMap((cxi) => [0, 1].map((cyi) => (
                  <circle key={`pdot-${cxi}-${cyi}`} cx={x - 54 + cxi * 5.2} cy={cy - 2.6 + cyi * 5.2} r={1.15} fill={ic} fillOpacity={0.9} />
                )))}
              </g>
            )}
            {lbl && <text x={isPod ? x + 18 : x} y={cy + 0.5} fill={ic} fontSize={Math.min(11, h * 0.56)} fontWeight={700} textAnchor="middle" dominantBaseline="central" style={{ pointerEvents: 'none' }}>{lbl}</text>}
          </g>,
        );
      }
    });
    if (fold > 0 && foldX != null) {
      const w = Math.max(28, String(fold).length * 7 + 22);
      els.push(
        <g key={`f-${t.Le}`}>
          <rect x={foldX - w / 2} y={t.y - 9} width={w} height={18} rx={9} fill={P.pill} stroke={P.pillBd} />
          <text x={foldX} y={t.y + 4} fill={P.ink2} fontSize={10} textAnchor="middle">{`+${fold}`}</text>
        </g>,
      );
    }
  });
  // 4) tier labels (gutter): Lx · name · shown/total · p50/红
  rows.forEach(({ t, inCount }) => {
    const a = aggOf(t.Le);
    els.push(
      <g key={`l-${t.Le}`}>
        {t.tag && <text x={12} y={t.y - 6} fill={t.col} fontSize={9} fontWeight={700}>{t.tag}</text>}
        <text x={12} y={t.y + (t.tag ? 6 : 4)} fill={P.ink} fontSize={12} fontWeight={600}>{t.label}</text>
        <text x={12} y={t.y + (t.tag ? 18 : 16)} fill={P.ink3} fontSize={9}>{`${focus ? inCount + '/' : ''}${total(t.Le).toLocaleString()} · p50 ${Math.round(a.p50 * 100)}% · ${Math.round(a.red * 100)}%红`}</text>
      </g>,
    );
  });
  // 5) divider + card-internal sub-tiers — 层内关系. 只有钻取到 Host/Chip/卡内时才画蓝色链路；
  //    默认 overview 只保留结构，避免看起来像已经选中某个 rank。
  const repCard = focusCard != null ? focusCard : focus ? scopeRange(focus, N)[0] : 0;
  const repReal = focusCard != null;   // true = 真的选到某张卡（否则是代表卡）
  const DIE = SUBTIERS[0], CORE = SUBTIERS[1];
  els.push(<line key="div" x1={8} y1={352} x2={592} y2={352} stroke={P.line} strokeDasharray="2 4" />);
  els.push(<text key="divt" x={300} y={347} fill={P.ink3} fontSize={9} textAnchor="middle">
    {hasDrillFocus ? `—— 卡内结构 · ${repReal ? '卡' : '代表卡'} r${repCard}（${repReal ? '已选中' : '该范围首卡'}）——` : '—— 卡内结构 ——'}
  </text>);
  // containment connectors — 代表卡 → 2 计算 Die → Core-Group 图元，solid SEL line + connector dots + 流动彗星（封装互连 / NoC）.
  const dieTopY = DIE.y - 6, dieBotY = DIE.y - 6 + DIE.cell!;
  const coreGX = 120, coreGW = X1 - coreGX, coreCx = coreGX + coreGW / 2, coreTopY = CORE.y;
  const coreAnchorX = coreGX + 34, dieCxArr = [135, 175];   // 2 计算 Die → L0 存储轨道锚点（GM/L2 rail 区）
  const rpCardX = pos[5]?.[repCard]?.x ?? CX_SPINE, cardBotY = 322;
  // L2 Chip → L1 计算 Die：代表卡连线（overview 淡显 · focus 加重 + 彗星）——「一张卡 ⊃ 2 计算 + 2 IO Die」
  dieCxArr.forEach((dx, di) => {
    els.push(<line key={`cc-die-${di}`} x1={rpCardX} y1={cardBotY} x2={dx} y2={dieTopY} stroke={ACCENT} strokeWidth={1.3} strokeOpacity={hasDrillFocus ? 0.55 : 0.3} />);
    if (hasDrillFocus) els.push(cflow(rpCardX, cardBotY, dx, dieTopY, `ccf-die-${di}`));
    els.push(cdot(dx, dieTopY, ACCENT, `ccd-die-${di}`, 2));
  });
  els.push(cdot(rpCardX, cardBotY, ACCENT, 'ccd-card', hasDrillFocus ? 2.4 : 2));
  // L1 计算 Die → L0 Core-Group：两块计算 Die 汇聚到 L0 存储轨道锚点（1 计算 Die ⊃ ~16 Core-Group）
  dieCxArr.forEach((dx, di) => {
    els.push(<line key={`cd-core-${di}`} x1={dx} y1={dieBotY} x2={coreAnchorX} y2={coreTopY} stroke={ACCENT} strokeWidth={1.3} strokeOpacity={hasDrillFocus ? 0.55 : 0.36} />);
    if (hasDrillFocus) els.push(cflow(dx, dieBotY, coreAnchorX, coreTopY, `cdf-core-${di}`));
    els.push(cdot(dx, dieBotY, ACCENT, `cdd-die-${di}`, 2));
  });
  els.push(cdot(coreAnchorX, coreTopY, ACCENT, 'cd-core-top'));
  els.push(<text key="l1l0-note" x={coreAnchorX + 10} y={(dieBotY + coreTopY) / 2 + 3} fill={P.ink3} fontSize={8}>1 计算 Die ⊃ ~16 Core-Group</text>);
  // 5a) L1 Die 子层（网格）
  {
    const st = DIE;
    els.push(<text key="slt-die" x={12} y={st.y - 6} fill={ENTITY_COLORS.computeDie} fontSize={9} fontWeight={700}>{st.tag}</text>);
    els.push(<text key="sl-die" x={12} y={st.y + 6} fill={P.ink} fontSize={12} fontWeight={600}>{st.label}</text>);
    els.push(<text key="scnt-die" x={12} y={st.y + 18} fill={P.ink3} fontSize={9}>{`×${st.n}`}</text>);
    for (let i = 0; i < st.n; i++) {
      const cx = 120 + (i % st.cols!) * (st.cell! + st.gap!), cy = st.y - 6 + Math.floor(i / st.cols!) * (st.cell! + st.gap!);
      const isSel = repReal && focus?.die === i;
      const fill = i >= 2 || !playing ? st.col!(i) : loadColor(Math.max(0, Math.min(1, nodeLoad(repCard * st.seed! + i, wlKind))));
      els.push(
        <rect key={`s-die-${i}`} x={cx} y={cy} width={st.cell!} height={st.cell!} rx={Math.min(3, st.cell! * 0.18)} fill={fill} style={{ cursor: 'pointer' }}
          stroke={isSel ? ringC : 'none'} strokeWidth={isSel ? 1.8 : 0}
          onClick={(e) => { e.stopPropagation(); setFocus({ level: 'die', card: repCard, die: i }); }} />,
      );
    }
    els.push(<text key="die-cap" x={120 + 4 * (st.cell! + st.gap!) + 6} y={st.y + st.cell! / 2} fill={P.ink3} fontSize={9} dominantBaseline="central">2 计算(UMA) · 2 IO</text>);
  }
  // 5b) L0 Core-Group 子层 —— 原生内嵌 CoreGroupMiniSvg 图元（不再用普通格子）。聚焦 core → 加高 + detail 提升。
  {
    const st = CORE, coreFocused = focus?.level === 'core', coreH = coreFocused ? 230 : 160;
    els.push(<text key="slt-core" x={12} y={st.y - 6} fill={ENTITY_COLORS.cube} fontSize={9} fontWeight={700}>{st.tag}</text>);
    els.push(<text key="sl-core" x={12} y={st.y + 6} fill={P.ink} fontSize={12} fontWeight={600}>{st.label}</text>);
    els.push(<text key="scnt-core" x={12} y={st.y + 18} fill={P.ink3} fontSize={9}>{`×${st.n}/卡 · GM/L2+AIV/AIC`}</text>);
    els.push(
      <g key="core-glyph" style={{ cursor: 'pointer' }} transform={`translate(${coreGX} ${st.y})`}
        onClick={(e) => { e.stopPropagation(); setFocus({ level: 'core', card: repCard, core: 0 }); }}>
        {coreFocused && <rect x={-3} y={-3} width={coreGW + 6} height={coreH + 6} rx={8} fill="none" stroke={ringC} strokeWidth={1.8} />}
        <CoreGroupMiniSvg width={coreGW} height={coreH} detail={2} fs={coreFocused ? 1.15 : 1} phase={flow ? 'comm' : 'compute'}
          load={playing ? Math.max(0, Math.min(1, nodeLoad(repCard * 517, wlKind))) : 0.5} dark={dark} />
      </g>,
    );
    // 数据通路说明（8px 小字）—— 放在 L0 图元正下方，viewBox 已加高避免与下方重叠
    els.push(<text key="core-datapath" x={coreCx} y={st.y + coreH + 13} fill={P.ink3} fontSize={8} textAnchor="middle">
      {'GM/L2 ─MTE2→ UB·L1 ─MTE1→ L0A/B ─CUBE→ L0C ─CV→ UB ─MTE3→ GM'}
    </text>);
  }
  // 6) 级间互联小 chip（HW_LEVELS[i].down）—— 与 hub 小标签一致：竖线 + 淡填圆角 + 描边 + 居中标签
  const ichip = (x: number, y: number, label: string, color: string, key: string) => {
    const w = label.length * 6.2 + 14;
    return (
      <g key={key} style={{ pointerEvents: 'none' }}>
        <line x1={x} y1={y - 9} x2={x} y2={y + 9} stroke={color} strokeWidth={1.1} strokeOpacity={0.7} />
        <rect x={x - w / 2} y={y - 6.5} width={w} height={13} rx={6.5} fill={color} fillOpacity={0.16} stroke={color} strokeOpacity={0.5} />
        <text x={x} y={y + 0.5} fill={color} fontSize={8.5} fontWeight={700} textAnchor="middle" dominantBaseline="central">{label}</text>
      </g>
    );
  };
  // 上 5 级互联 chip 坐在中心竖脊上；卡内 2 级（封装互连 L2→L1 / NoC L1→L0）移到左侧卡内连线区，贴着真实连线。
  ICHIPS.forEach(({ y, li }) => { const d = HW_LEVELS[li].down; if (d) els.push(ichip(li >= 5 ? 210 : CX_MID, y, d.label, d.color, `ic-${li}`)); });
  // 0) 上层上下文 (L7 全球 / L6 集群 / L5 服务池) — 用真实换算数量渲染（真实成员计数，不再是单个假 sibling）：
  //    global = 本集群 + 1–2 虚线幽灵集群；cluster = 16 服务池(前 6 pill + +10 chip)；pool = 4 Pod pill(本 Pod + 3 兄弟半透明)。
  els.push(<text key="ctx-hint" x={12} y={14} fill={P.ink3} fontSize={9} fontWeight={600}>上层（上下文）· 真实数量 · 抽象图元</text>);
  const ctxLabel = (t: Tier, sub: string) => els.push(
    <g key={`ctxl-${t.key}`}>
      <text x={12} y={t.y - 4} fill={t.col} fontSize={9} fontWeight={700}>{t.tag}</text>
      <text x={12} y={t.y + 8} fill={P.ink2} fontSize={10} fontWeight={600}>{t.label}</text>
      <text x={12} y={t.y + 18} fill={P.ink3} fontSize={8}>{sub}</text>
    </g>,
  );
  // abstract 2D level glyph (same vocabulary as 刀片/NPU 图元) — 集群=方块群 · 服务池=2×2(4 Pod) · Pod=点阵(Host 阵列)
  const levelIcon = (kind: string, cx: number, cy: number, c: string, op: number, key: string) => {
    const d = (dx: number, dy: number, r: number) => <circle key={`${key}${dx}_${dy}`} cx={cx + dx} cy={cy + dy} r={r} fill={c} fillOpacity={op} />;
    const s = (dx: number, dy: number, w: number) => <rect key={`${key}${dx}_${dy}`} x={cx + dx - w / 2} y={cy + dy - w / 2} width={w} height={w} rx={0.6} fill={c} fillOpacity={op} />;
    if (kind === 'cluster') return <g key={key} style={{ pointerEvents: 'none' }}>{[-4, 0, 4].flatMap((dx) => [-3, 3].map((dy) => s(dx, dy, 2.4)))}</g>;
    if (kind === 'pool') return <g key={key} style={{ pointerEvents: 'none' }}>{[-2.6, 2.6].flatMap((dx) => [-2.6, 2.6].map((dy) => d(dx, dy, 1.5)))}</g>;
    return <g key={key} style={{ pointerEvents: 'none' }}>{[-3.4, 0, 3.4].flatMap((dx) => [-3.4, 0, 3.4].map((dy) => d(dx, dy, 1.05)))}</g>;   // pod = 3×3 点阵
  };
  // one context row: uniform glyphs centered on the spine, ALL members shown when they fit (else +N fold).
  //   kind = 该行成员实体的抽象图元（L7 行=集群实体、L6 行=服务池实体、L5 行=Pod 实体）；当前成员高亮描环。
  const ctxRow = (t: Tier, kind: string, total: number, sub: string, dashed: boolean) => {
    ctxLabel(t, sub);
    const h = t.h, gw = CTX_GW;
    const glyph = (cx: number, cur: boolean, key: string) => {
      const gx = cx - gw / 2;
      els.push(
        <g key={key} style={cur ? { cursor: 'pointer' } : { pointerEvents: 'none' }} onClick={cur ? (e) => { e.stopPropagation(); setFocus({ level: 'super', card: 0 }); } : undefined}>
          {cur && <rect x={gx - 2.5} y={t.y - h / 2 - 2.5} width={gw + 5} height={h + 5} rx={(h + 5) * 0.4} fill="none" stroke={t.col} strokeWidth={1.6} />}
          <rect x={gx} y={t.y - h / 2} width={gw} height={h} rx={h * 0.4} fill={t.col} fillOpacity={cur ? 1 : dashed ? 0.14 : 0.3} stroke={cur ? 'none' : t.col} strokeOpacity={cur ? 0 : dashed ? 0.4 : 0.5} strokeDasharray={!cur && dashed ? '3 3' : undefined} />
        </g>,
      );
      els.push(levelIcon(kind, cx, t.y, cur ? ink(t.col) : t.col, cur ? 1 : dashed ? 0.32 : 0.6, `${key}-ic`));
    };
    glyph(CX_SPINE, true, `ctx-${t.key}-cur`);
    const sibs = total - 1;
    let placedR = 0, placedL = 0, shown = 0;
    for (let sIdx = 0; sIdx < sibs && shown < ctxPerSide * 2; sIdx++) {
      const right = sIdx % 2 === 0, k = right ? ++placedR : ++placedL; shown++;
      glyph(ctxSibCx(right ? 1 : -1, k), false, `ctx-${t.key}-s${sIdx}`);
    }
    const fold = sibs - shown;
    if (fold > 0) {
      const fx = ctxSibCx(1, placedR) + gw / 2 + CTX_GAP, fw = Math.max(28, String(fold).length * 7 + 18);
      els.push(
        <g key={`ctx-${t.key}-fold`}>
          <rect x={fx} y={t.y - 9} width={fw} height={18} rx={9} fill={P.pill} stroke={P.pillBd} />
          <text x={fx + fw / 2} y={t.y + 4} fill={P.ink2} fontSize={10} textAnchor="middle">{`+${fold}`}</text>
        </g>,
      );
    }
  };
  ctxRow(TIERS[0], 'cluster', 3, `本集群（1 集群 = ${PODS_PER_CLUSTER} Pod）`, true);
  ctxRow(TIERS[1], 'pool', POOLS_PER_CLUSTER, `本池 · ${POOLS_PER_CLUSTER} 服务池/集群`, false);
  ctxRow(TIERS[2], 'pod', PODS_PER_POOL, `本 Pod · ${PODS_PER_POOL} Pod/池（下方=展开）`, false);

  // C) 并行关系落到真实层级对象（仅 card 焦点）：TP/PP 描到真实 Host pill · DP 弧到兄弟 Pod · EP 按 epScope。
  if (focus && focus.level === 'card') {
    const k = focus.card, bk = Math.floor(k / CPB);
    const nodeRow = rows.find((r) => r.t.Le === 4);
    const hostW = nodeRow ? Math.max(11, Math.min(TIERS[4].maxW ?? 52, nodeRow.slotW * 0.82)) : 40;
    const hY = TIERS[4].y, hH = TIERS[4].h;
    const badge = (key: string, x: number, y: number, txt: string, col: string, anchor: 'middle' | 'end' = 'middle') => {
      const w = txt.length * 6.6 + 8, lx = anchor === 'end' ? x - w : x - w / 2;
      return (
        <g key={key} style={{ pointerEvents: 'none' }}>
          <rect x={lx} y={y - 6} width={w} height={12} rx={6} fill={col} />
          <text x={lx + w / 2} y={y + 0.5} fill={ink(col)} fontSize={7.5} fontWeight={700} textAnchor="middle" dominantBaseline="central">{txt}</text>
        </g>
      );
    };
    const hostStroke = (key: string, cx: number, col: string, inset: number) => (
      <rect key={key} x={cx - hostW / 2 - inset} y={hY - hH / 2 - inset} width={hostW + inset * 2} height={hH + inset * 2} rx={(hH + inset * 2) * 0.4} fill="none" stroke={col} strokeWidth={1.8} />
    );
    // 1) TP — 焦点 Chip 所在 Host pill 描 tp 色 + 角标 TP×8（TP 组 = 本 Host 8 卡）
    const hp = pos[4]?.[bk];
    if (hp) {
      els.push(hostStroke('c-tp-str', hp.x, PARALLEL_COLORS.tp, 3));
      els.push(badge('c-tp-b', hp.x, hY - hH / 2 - 9, `TP×${pm.tp}`, PARALLEL_COLORS.tp));
    }
    // 2) PP — peersOf(k,'pp') 换算 host 下标 b=⌊peer/8⌋；段内 Host 加 pp 描边 + PP级{stage}；段外合并成行尾角标
    let ppOff = 0;
    pm.peersOf(k, 'pp').forEach((peer) => {
      const pb = Math.floor(peer / CPB); if (pb === bk) return;   // 焦点 Host 已由 TP 标注
      const php = pos[4]?.[pb];
      if (php) {
        els.push(hostStroke(`c-pp-str-${pb}`, php.x, PARALLEL_COLORS.pp, 5));
        els.push(badge(`c-pp-b-${pb}`, php.x, hY + hH / 2 + 9, `PP级${pm.groupOf(peer, 'pp')}`, PARALLEL_COLORS.pp));
      } else ppOff++;
    });
    if (ppOff > 0) els.push(badge('c-pp-off', X1, hY - hH / 2 - 9, `PP ×${pm.pp} 级（跨 Host）`, PARALLEL_COLORS.pp, 'end'));
    // 3) DP — 从焦点 Chip 画虚线弧到 pool 行兄弟 Pod pill 区（弧向右弓开）+ 副本角标
    const cp = pos[5]?.[k];
    if (cp) {
      const sx = cp.x, sy = TIERS[5].y - 12, tx = ctxSibCx(1, 1), ty = TIERS[2].y + TIERS[2].h / 2;
      const ctlX = Math.max(sx, tx) + 70, ctlY = (sy + ty) / 2;
      els.push(<path key="c-dp-arc" d={`M${sx} ${sy} Q ${ctlX} ${ctlY} ${tx} ${ty}`} fill="none" stroke={PARALLEL_COLORS.dp} strokeWidth={1.5} strokeDasharray="4 4" strokeOpacity={0.9} />);
      els.push(badge('c-dp-b', (sx + tx) / 2 + 24, 180, `DP ×${pm.dp} 副本（本 Pod 内平铺·逻辑上跨 Pod）`, PARALLEL_COLORS.dp));
      // 4) EP — replica 作用域：在 DP 弧旁标相邻副本 A2A
      if (pm.epScope === 'replica') els.push(badge('c-ep-rep', (sx + tx) / 2 + 24, 194, `EP×${pm.ep}（相邻副本 A2A）`, PARALLEL_COLORS.ep));
    }
    // 4) EP — node 作用域：焦点 Host pill 内描边 + 节点内路由角标
    if (pm.epScope === 'node' && hp) {
      els.push(hostStroke('c-ep-str', hp.x, PARALLEL_COLORS.ep, 6));
      els.push(badge('c-ep-node', hp.x, hY + hH / 2 + 9, `EP×${pm.ep}·节点内路由`, PARALLEL_COLORS.ep));
    }
    // 5) 图例：TP■ PP■ DP■ EP■（真实成员来自 parallelMap）
    let lx = 300;
    (['tp', 'pp', 'dp', 'ep'] as const).forEach((d) => {
      const c = PARALLEL_COLORS[d];
      els.push(<rect key={`c-lg-${d}`} x={lx} y={8} width={8} height={8} rx={2} fill={c} />);
      els.push(<text key={`c-lgt-${d}`} x={lx + 11} y={14} fill={P.ink2} fontSize={8.5} fontWeight={700}>{d.toUpperCase()}</text>);
      lx += 40;
    });
    els.push(<text key="c-lg-note" x={lx + 2} y={14} fill={P.ink3} fontSize={8}>（真实成员来自 parallelMap）</text>);
  }

  return (
    <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} preserveAspectRatio="xMidYMid meet" width="100%" height="100%" style={{ display: 'block' }}>
      <rect x={0} y={0} width={SVG_W} height={SVG_H} fill="transparent" onClick={() => setFocus(null)} />
      {els}
    </svg>
  );
}

export function ConsoleView({ gen, dark, sync }: { gen: Gen; dark: boolean; sync?: ViewSync }) {
  const visualProfile = useContext(SceneVisualProfileContext);
  const workbenchProfile = visualProfile === 'opRankTime';
  const surf = sceneSurface(dark, visualProfile);
  const spec = GENERATIONS[gen];
  const N = spec.totalNpus;
  const nBlades = Math.ceil(N / CPB), nCabs = Math.ceil(nBlades / BPC);

  // 工况/时间/播放 come from the cross-view sync when present → 运行状态 ⇄ 工作台 stay linked
  const [workloadL, setWorkloadL] = useState<Workload>('decode');
  const workload = sync?.workload ?? workloadL;
  const setWorkload = sync?.setWorkload ?? setWorkloadL;
  const [metric, setMetric] = useState<Metric>('util');
  const [dir, setDir] = useState<Dir>('all');
  const [lens, setLens] = useState<Lens>('heat');
  const [partDim, setPartDim] = useState<Exclude<PartitionDim, 'none'>>('tp');
  const [planeOn, setPlaneOn] = useState({ ub: true, rdma: true, vpc: false });
  const [focus, setFocus] = useState<Focus>(null);
  const [scopeB, setScopeB] = useState<{ cx: number; cy: number; cz: number; r: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [stepL, setStepL] = useState(0);
  const step = sync?.step ?? stepL;
  const setStep = sync?.setStep ?? setStepL;
  const [playingL, setPlayingL] = useState(false);
  const playing = sync?.playing ?? playingL;
  const setPlaying = sync?.setPlaying ?? setPlayingL;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);
  const splitRef = useRef<HTMLDivElement | null>(null);
  const wlKind = WL[workload].kind;

  useEffect(() => { setFocus(null); setScopeB(null); }, [gen]);
  useEffect(() => {
    if (!workbenchProfile || !splitRef.current) return;

    const helper = window.PtoWorkbenchShell;
    if (!helper?.initResizablePanes) return;

    const root = splitRef.current;
    const leftPane = root.querySelector<HTMLElement>('[data-pane="smartscape"]');
    const rightPane = root.querySelector<HTMLElement>('[data-pane="panorama"]');
    if (!leftPane || !rightPane) return;

    let frame = 0;
    const refreshCanvasLayout = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        window.dispatchEvent(new Event('resize'));
        controlsRef.current?.update?.();
      });
    };

    const split = helper.initResizablePanes({
      root,
      panes: [leftPane, rightPane],
      direction: 'horizontal',
      sizes: [38, 62],
      minSize: [300, 420],
      gutterSize: 10,
      storageKey: 'hpc-topology-console-split-v1',
      gutterLabel: '调整平面视图和阵列全景宽度',
      onResize: refreshCanvasLayout,
    });

    refreshCanvasLayout();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      split.destroy();
    };
  }, [workbenchProfile]);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setStep((s) => (s + 1) % (STEP_MAX + 1)), 650);
    return () => clearInterval(id);
  }, [playing]);

  const stats = useMemo<Stats>(() => {
    const cabSum = new Float64Array(nCabs), cabCnt = new Int32Array(nCabs);
    const ndSum = new Float64Array(nBlades), ndCnt = new Int32Array(nBlades);
    const cardVals: number[] = [], stride = Math.max(1, Math.floor(N / 2048));
    let utilSum = 0, hot = 0, strag = 0; const faultNodes = new Set<number>();
    for (let k = 0; k < N; k++) {
      const u = cardLoad(k, wlKind, step); utilSum += u; if (isHot(u)) hot++;
      if (isStrag(k, step)) strag++; if (isFault(k, step)) faultNodes.add(Math.floor(k / CPB));
      const mv = cardMetric(k, metric, wlKind, step);
      const cb = Math.floor(k / PER_CAB), nd = Math.floor(k / CPB);
      cabSum[cb] += mv; cabCnt[cb]++; ndSum[nd] += mv; ndCnt[nd]++;
      if (k % stride === 0) cardVals.push(mv);
    }
    const cabVals = Array.from({ length: nCabs }, (_, i) => (cabCnt[i] ? cabSum[i] / cabCnt[i] : 0));
    const ndVals = Array.from({ length: nBlades }, (_, i) => (ndCnt[i] ? ndSum[i] / ndCnt[i] : 0));
    const agg = (arr: number[]) => {
      if (!arr.length) return { p50: 0, p95: 0, red: 0 };
      const s = [...arr].sort((a, b) => a - b), q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
      let red = 0; for (const v of arr) if (loadState(v) >= 2) red++;
      return { p50: q(0.5), p95: q(0.95), red: red / arr.length };
    };
    const clusterMean = cabVals.reduce((a, b) => a + b, 0) / Math.max(1, cabVals.length);
    return {
      kpi: { util: utilSum / N, hot, strag, faultDom: faultNodes.size },
      clusterMean, cabVals, ndVals, cardVals,
      agg: { cluster: agg([clusterMean]), cab: agg(cabVals), node: agg(ndVals), card: agg(cardVals) },
    };
  }, [N, nCabs, nBlades, metric, wlKind, step]);

  // focused-entity auxiliary metrics (exact over the scope range; ≤64 cards unless whole)
  const rail = useMemo(() => {
    const [lo, hi] = scopeRange(focus, N), n = hi - lo;
    if (n > PER_CAB) return null;
    const mean = (m: Metric) => { let s = 0; for (let k = lo; k < hi; k++) s += cardMetric(k, m, wlKind, step); return n ? s / n : 0; };
    return { util: mean('util'), strag: mean('strag'), fault: mean('fault'), count: n };
  }, [focus, N, wlKind, step]);

  const problem = useMemo(() => {
    if (step < EVT_LO || step > EVT_HI) return null;
    let strag = 0; for (let k = EVT_CAB * PER_CAB; k < (EVT_CAB + 1) * PER_CAB && k < N; k++) if (isStrag(k, step)) strag++;
    const redR = stats.kpi.hot / N;
    return { root: EVT_CAB, title: `机柜（物理分组）C${EVT_CAB} 过热`, chain: `液冷异常 → ${strag} 卡掉队(straggler) → DP 梯度 AllReduce 阻塞`, impact: `影响 ${Math.min(N, PER_CAB)} 卡 · step 延迟 +${Math.round(redR * 420 + 22)}%` };
  }, [step, N, stats.kpi.hot]);

  // 面包屑：全球 › 集群 › 服务池 › Pod › Host B{n} › Chip r{k} › Die › Core-Group（上三级为上下文，点击回整 Pod）
  const crumbs = useMemo(() => {
    const out: { lvl: string; label: string; card: number }[] = [
      { lvl: 'global', label: '全球', card: 0 }, { lvl: 'cluster', label: '集群', card: 0 },
      { lvl: 'pool', label: '服务池', card: 0 }, { lvl: 'super', label: 'Pod', card: 0 },
    ];
    if (focus && focus.level !== 'super') {
      const b = Math.floor(focus.card / CPB); out.push({ lvl: 'node', label: `Host B${b}`, card: b * CPB });
      if (['card', 'die', 'core'].includes(focus.level)) out.push({ lvl: 'card', label: `Chip r${focus.card}`, card: focus.card });
      if (focus.level === 'die' || focus.level === 'core') out.push({ lvl: 'die', label: 'Die', card: focus.card });
      if (focus.level === 'core') out.push({ lvl: 'core', label: 'Core-Group', card: focus.card });
    }
    return out;
  }, [focus]);

  // panorama config (lens → array presentation); memoised so playback ticks don't churn the 8K recolor
  const panoStatus = playing && (lens === 'heat' || lens === 'flow');
  const panoPeers = playing && lens === 'flow';
  const panoPlanes = lens === 'phys';
  const panoPart: PartitionDim = lens === 'domain' ? partDim : 'none';
  const panoPhase = useMemo<RunPhase | null>(() => (playing && (lens === 'heat' || lens === 'flow')
    ? { id: 'wl', name: WL[workload].label, kind: wlKind, color: wlKind === 'comm' ? '#ff4b7b' : '#22d3ee', collective: lens === 'flow' ? 'ring' : undefined, note: '' }
    : null), [playing, lens, workload, wlKind]);
  const runMode: RunMode = workload === 'pretrain' ? 'train' : 'infer';
  const reach = Math.sqrt(N) * 1.3 + 12;
  const panoSel = useMemo(() => focusToSel(focus), [focus]);

  // parallel groups from the SINGLE SOURCE OF TRUTH — degrees/membership agree with 平面·3D·运行状态
  const pm = useMemo(() => parallelMap(workload, N), [workload, N]);
  // 并行关系（rank↔rank）：每维给出 集合通信形态 + 度数 + 真实对端数（peersOf 真值），把 TP/SP/EP/PP/DP 的「联系」讲清楚
  const COLL: Record<ParDim, string> = { tp: 'AllReduce', sp: 'AllGather+RS', pp: 'P2P send/recv', dp: 'Ring-AllReduce', ep: '层级化 All-to-All' };
  const groups: { d: ParDim; label: string; c: string; coll: string; pat: 'ring' | 'a2a' | 'p2p'; peers: number; deg: number }[] = focus && rail ? (['tp', 'sp', 'pp', 'dp', 'ep'] as ParDim[]).map((d) => {
    const k = focus.card, grp = pm.groupOf(k, d), deg = pm.groupCount(d);
    const label = d === 'sp' && pm.sp <= 1 ? '与 TP 同域' : d === 'tp' ? `切片 ${grp}` : d === 'pp' ? `级 ${grp}/${pm.pp}` : d === 'dp' ? `副本 ${grp}` : `组 ${grp}/${pm.ep}`;
    return { d, label, c: d === 'sp' ? PARALLEL_COLORS_SP : PARALLEL_COLORS[d as Exclude<PartitionDim, 'none'>], coll: COLL[d], pat: pm.collectiveOf(d), peers: pm.peersOf(k, d, 1 << 20).length, deg };
  }) : [];
  const phys = focus && rail ? LEVEL_PHYS[focus.level] : null;
  const card: React.CSSProperties = { background: 'var(--panel)', border: '1px solid var(--bd)', borderRadius: 11, boxShadow: 'var(--shadow-sm)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' };
  const shellStyle: React.CSSProperties = workbenchProfile
    ? { position: 'relative', zIndex: 11, flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', background: 'transparent', color: 'var(--tx)' }
    : { position: 'absolute', inset: 0, zIndex: 11, display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--tx)' };

  return (
    <div className={workbenchProfile ? 'hpc-console-shell hpc-console-shell--workbench' : 'hpc-console-shell'} style={shellStyle}>
      {/* ── toolbar: 工况 / 指标 / 方向 / 镜头 (+切分) / 平面 · breadcrumb · KPI ── */}
      {workbenchProfile ? (
        <div className="hpc-console-toolbar hpc-console-toolbar--compact">
          <div className="hpc-console-primary-controls">
            <span style={GLAB}>工况</span>
            <div className="hpc-console-segment">
              {(Object.keys(WL) as Workload[]).map((w) => (
                <button key={w} onClick={() => setWorkload(w)} style={{ ...btnBase, ...(workload === w ? { border: '1px solid #2a6f5f', background: '#2a6f5f', color: '#fff', fontWeight: 600 } : SECONDARY) }}>{WL[w].label}</button>
              ))}
            </div>
          </div>
          <div className="hpc-wb-menu-wrap hpc-console-settings">
            <button
              className={`hpc-console-summary${settingsOpen ? ' is-active' : ''}`}
              onClick={() => setSettingsOpen((v) => !v)}
              aria-expanded={settingsOpen}
              title="视图设置"
            >
              <span>{M_LABEL[metric]}</span>
              <span>{D_LABEL[dir]}</span>
              <span>{LENS_LABEL[lens]}</span>
              {lens === 'domain' && <span>{partDim.toUpperCase()}</span>}
            </button>
            {settingsOpen && (
              <div className="hpc-wb-menu hpc-console-settings-menu">
                <div className="hpc-wb-menu-section">
                  <div className="hpc-wb-menu-title">指标</div>
                  <div className="hpc-wb-menu-grid compact">
                    {(Object.keys(M_LABEL) as Metric[]).map((m) => (
                      <button key={m} className={`hpc-wb-menu-item${metric === m ? ' is-active' : ''}`} onClick={() => setMetric(m)}>{M_LABEL[m]}</button>
                    ))}
                  </div>
                </div>
                <div className="hpc-wb-menu-section">
                  <div className="hpc-wb-menu-title">方向</div>
                  <div className="hpc-wb-menu-grid compact">
                    {([['all', '全链'], ['up', '上游'], ['down', '下游']] as [Dir, string][]).map(([d, l]) => (
                      <button key={d} className={`hpc-wb-menu-item${dir === d ? ' is-active' : ''}`} onClick={() => setDir(d)}>{l}</button>
                    ))}
                  </div>
                </div>
                <div className="hpc-wb-menu-section">
                  <div className="hpc-wb-menu-title">镜头</div>
                  <div className="hpc-wb-menu-grid">
                    {(Object.keys(LENS_LABEL) as Lens[]).map((l) => (
                      <button key={l} className={`hpc-wb-menu-item${lens === l ? ' is-active' : ''}`} onClick={() => setLens(l)}>{LENS_LABEL[l]}</button>
                    ))}
                  </div>
                </div>
                {lens === 'domain' && (
                  <div className="hpc-wb-menu-section">
                    <div className="hpc-wb-menu-title">并行切分</div>
                    <div className="hpc-wb-menu-grid compact">
                      {(['tp', 'pp', 'dp', 'ep'] as Exclude<PartitionDim, 'none'>[]).map((d) => (
                        <button key={d} className={`hpc-wb-menu-item${partDim === d ? ' is-active' : ''}`} onClick={() => setPartDim(d)} title={PARTITION_META[d].label}>{d.toUpperCase()}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="hpc-console-plane-group" aria-label="通信平面">
            {PLANES.map((p) => { const on = planeOn[p.id]; return (
              <button key={p.id} onClick={() => setPlaneOn((s) => ({ ...s, [p.id]: !s[p.id] }))} title={p.role} style={{ ...btnBase, display: 'inline-flex', alignItems: 'center', gap: 5, ...toggleBtn(on, p.color) }}>
                <span style={{ width: 9, height: 3, borderRadius: 1, background: on ? ink(p.color) : p.color }} />{p.short.split('·')[0]}
              </button>
            ); })}
          </div>
          <div className="hpc-console-crumbs">
            {crumbs.map((c, i) => (
              <span key={i} className="hpc-console-crumb">
                {i > 0 && <span className="hpc-console-crumb-sep">/</span>}
                <span onClick={() => setFocus(['global', 'cluster', 'pool', 'super'].includes(c.lvl) ? null : { level: c.lvl as Level, card: c.card })}>{c.label}</span>
              </span>
            ))}
          </div>
          <div className="hpc-console-kpis">
            {([
              [`${Math.round(stats.kpi.util * 100)}%`, `集群${M_LABEL.util}`, 'var(--tx)'],
              [`${metric === 'fault' ? stats.kpi.faultDom : stats.kpi.hot}`, metric === 'fault' ? '故障域' : '热点卡', loadColor(0.9)],
              [`${stats.kpi.strag}`, '掉队卡', PARALLEL_COLORS.ep],
            ] as [string, string, string][]).map(([v, l, c], i) => (
              <div key={i} className="hpc-console-kpi">
                <div style={{ color: c, ...TNUM }}>{v}</div>
                <span>{l}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 12px', borderBottom: '1px solid var(--bd)', flexWrap: 'wrap', background: 'var(--panel-solid)' }}>
        <span style={GLAB}>工况</span>
        <div style={{ display: 'flex', gap: 3 }}>
          {(Object.keys(WL) as Workload[]).map((w) => (
            <button key={w} onClick={() => setWorkload(w)} style={{ ...btnBase, ...(workload === w ? { border: '1px solid #2a6f5f', background: '#2a6f5f', color: '#fff', fontWeight: 600 } : SECONDARY) }}>{WL[w].label}</button>
          ))}
        </div>
        <span style={GLAB}>指标</span>
        <div style={{ display: 'flex', gap: 3 }}>
          {(Object.keys(M_LABEL) as Metric[]).map((m) => (<button key={m} onClick={() => setMetric(m)} style={{ ...btnBase, ...navBtn(metric === m) }}>{M_LABEL[m]}</button>))}
        </div>
        <span style={GLAB}>方向</span>
        <div style={{ display: 'flex', gap: 3 }}>
          {([['all', '全链'], ['up', '上游'], ['down', '下游']] as [Dir, string][]).map(([d, l]) => (<button key={d} onClick={() => setDir(d)} style={{ ...btnBase, ...navBtn(dir === d) }}>{l}</button>))}
        </div>
        <span style={GLAB}>镜头</span>
        <div style={{ display: 'flex', gap: 3 }}>
          {(Object.keys(LENS_LABEL) as Lens[]).map((l) => (<button key={l} onClick={() => setLens(l)} style={{ ...btnBase, ...(lens === l ? { border: '1px solid #5a3a86', background: '#5a3a86', color: '#fff', fontWeight: 600 } : SECONDARY) }}>{LENS_LABEL[l]}</button>))}
        </div>
        {lens === 'domain' && (
          <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
            <span style={GLAB}>切分</span>
            {(['tp', 'pp', 'dp', 'ep'] as Exclude<PartitionDim, 'none'>[]).map((d) => (
              <button key={d} onClick={() => setPartDim(d)} title={PARTITION_META[d].label} style={{ ...btnBase, display: 'inline-flex', alignItems: 'center', gap: 5, ...toggleBtn(partDim === d, PARALLEL_COLORS[d]) }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: partDim === d ? ink(PARALLEL_COLORS[d]) : PARALLEL_COLORS[d] }} />{d.toUpperCase()}
              </button>
            ))}
          </div>
        )}
        <span style={GLAB}>平面</span>
        <div style={{ display: 'flex', gap: 3 }}>
          {PLANES.map((p) => { const on = planeOn[p.id]; return (
            <button key={p.id} onClick={() => setPlaneOn((s) => ({ ...s, [p.id]: !s[p.id] }))} title={p.role} style={{ ...btnBase, display: 'inline-flex', alignItems: 'center', gap: 5, ...toggleBtn(on, p.color) }}>
              <span style={{ width: 9, height: 3, borderRadius: 1, background: on ? ink(p.color) : p.color }} />{p.short.split('·')[0]}
            </button>
          ); })}
        </div>
        {/* breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--tx2)', flex: 1, minWidth: 60, overflow: 'hidden' }}>
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {i > 0 && <span style={{ color: 'var(--tx3)' }}>›</span>}
              <span onClick={() => setFocus(['global', 'cluster', 'pool', 'super'].includes(c.lvl) ? null : { level: c.lvl as Level, card: c.card })} style={{ cursor: 'pointer', padding: '2px 5px', borderRadius: 5, color: i === crumbs.length - 1 ? 'var(--tx)' : ACCENT }}>{c.label}</span>
            </span>
          ))}
        </div>
        {/* KPI */}
        <div style={{ display: 'flex', gap: 14 }}>
          {([
            [`${Math.round(stats.kpi.util * 100)}%`, `集群${M_LABEL.util}`, 'var(--tx)'],
            [`${metric === 'fault' ? stats.kpi.faultDom : stats.kpi.hot}`, metric === 'fault' ? '故障域' : '热点卡', loadColor(0.9)],
            [`${stats.kpi.strag}`, '掉队卡', PARALLEL_COLORS.ep],
          ] as [string, string, string][]).map(([v, l, c], i) => (
            <div key={i} style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.1, color: c, ...TNUM }}>{v}</div>
              <div style={{ fontSize: 10, color: 'var(--tx3)' }}>{l}</div>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* ── body: left Smartscape 控制 · right panorama (scopeOnly) + 仪表 ── */}
      <div
        ref={splitRef}
        className={workbenchProfile ? 'hpc-console-body hpc-console-body--split workbench-frame-split pto-workbench-shell__panes' : 'hpc-console-body'}
        style={{ flex: 1, display: 'flex', minHeight: 0 }}
      >
        <div
          className={workbenchProfile ? 'hpc-console-left-pane workbench-pane pto-workbench-shell__pane' : 'hpc-console-left-pane'}
          data-pane="smartscape"
          style={{
            flex: workbenchProfile ? '0 0 38%' : '0 0 40%',
            maxWidth: workbenchProfile ? undefined : '46%',
            minWidth: workbenchProfile ? 0 : 340,
            ...(workbenchProfile ? { borderRadius: 'var(--pto-radius-lg)', background: 'var(--background-elevated)', overflow: 'hidden' } : { borderRight: '1px solid var(--bd)', background: 'var(--panel-solid)' }),
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <div className="hpc-console-pane-note" style={{ padding: '5px 12px', fontSize: 11, color: 'var(--tx3)', ...(workbenchProfile ? {} : { borderBottom: '1px solid var(--bd)' }), flexShrink: 0 }}>
            平面视图 · 层级图（控制 · 图元/配色同层级图）— 点任一实体 → 只展开其链路(祖先+后代) 并联动右侧阵列全景；每层显示 选中/总数 · p50 · 红卡率
          </div>
          <div style={{ flex: 1, position: 'relative', minHeight: 0, padding: '4px 6px' }}>
            <Smartscape N={N} nBlades={nBlades} focus={focus} setFocus={setFocus} metric={metric} wlKind={wlKind} step={step} dir={dir} planeOn={planeOn} playing={playing} stats={stats} dark={dark} flow={lens === 'flow'} pm={pm} />
          </div>
        </div>

        <div
          className={workbenchProfile ? 'hpc-console-pano-pane workbench-pane pto-workbench-shell__pane' : 'hpc-console-pano-pane'}
          data-pane="panorama"
          style={{ flex: 1, position: 'relative', minWidth: 0, ...(workbenchProfile ? { borderRadius: 'var(--pto-radius-lg)', overflow: 'hidden', background: '#ffffff' } : {}) }}
        >
          <Canvas
            orthographic dpr={[1, 2]}
            camera={{ position: [reach, reach * 0.7, reach], zoom: 16, near: 0.1, far: 4000 }}
            gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1, powerPreference: 'high-performance' }}
            onCreated={({ gl }) => { gl.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault(), false); }}
          >
            <color attach="background" args={[surf.background]} />
            <fog attach="fog" args={[surf.fog, 90, 420]} />
            {visualProfile === 'opRankTime'
              ? <hemisphereLight intensity={surf.ambient} groundColor={dark ? '#10131a' : '#e8edf4'} />
              : <ambientLight intensity={surf.ambient} />}
            <directionalLight position={[8, 14, 6]} intensity={surf.key} />
            {visualProfile === 'opRankTime' && <directionalLight position={[-8, 8, -10]} intensity={surf.fill} />}
            <pointLight position={[0, 10, 0]} intensity={surf.point} color={surf.pointColor} />
            <FrameCamera bounds={scopeB} reach={reach} controls={controlsRef} zoomScale={2} />
            <SceneTheme.Provider value={dark}>
              <FullPodScene
                scale="64P" podCount={1} full gen={spec} overlays={OVERLAYS}
                runMode={runMode} phase={panoPhase} partition={panoPart} peers={panoPeers}
                status={panoStatus} planes={panoPlanes} onHoverInfo={setHover} onPick={() => { /* dbl-click via focus */ }}
                focusSel={panoSel} onSel={(s) => setFocus(selToFocus(s))} dir={dir} scopeOnly onScope={setScopeB}
              />
            </SceneTheme.Provider>
            <OrbitControls
              ref={controlsRef} makeDefault enableDamping dampingFactor={0.08}
              minPolarAngle={0} maxPolarAngle={Math.PI / 2} minDistance={2} maxDistance={600}
              mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }}
            />
          </Canvas>

          {/* L0 细节由左侧原生 CoreGroupMiniSvg 图元 + 运行状态视图承担，右侧全景不再覆盖 L0 面板。 */}

          <button
            className={`hpc-console-info-toggle${infoOpen ? ' is-active' : ''}`}
            type="button"
            aria-label="信息面板"
            aria-expanded={infoOpen}
            title="信息面板"
            onClick={() => setInfoOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 10.8v5" />
              <path d="M12 7.6h.01" />
            </svg>
          </button>

          {infoOpen && (
            <div className="hpc-console-info-tray">
              <div style={{ ...card, padding: '10px 12px', borderColor: problem ? 'var(--danger, #ef4d4d)' : 'var(--bd)', background: problem ? 'rgba(60,24,24,0.92)' : 'var(--panel)' }}>
                <div style={{ fontSize: 10, letterSpacing: 0.4, color: 'var(--tx3)', display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: problem ? '#ef4d4d' : '#2bd47d' }} />DAVIS · 根因分析
                </div>
                {problem ? (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 600, margin: '0 0 6px' }}>{problem.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--tx2)', lineHeight: 1.55, marginBottom: 7 }}>{problem.chain}</div>
                    <div style={{ fontSize: 11, color: '#ef6d6d', marginBottom: 8 }}>{problem.impact}</div>
                    <button onClick={() => { setFocus({ level: 'node', card: problem.root * PER_CAB }); setDir('down'); }} style={{ width: '100%', border: `1px solid ${ACCENT}`, background: ACCENT, color: '#fff', fontSize: 12, padding: 6, borderRadius: 8, cursor: 'pointer' }}>定位根因 →</button>
                  </>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--tx3)', lineHeight: 1.55 }}>当前无活动问题。拖动下方时间轴到 t=34–46 触发过热事件，看根因链自动聚合与定位。</div>
                )}
              </div>

              <div style={{ ...card, padding: '10px 12px' }}>
                <div style={{ fontSize: 13, fontWeight: 600, margin: '0 0 2px' }}>{focusName(focus)}</div>
                <div style={{ fontSize: 11, color: 'var(--tx2)', marginBottom: 8 }}>{focus && rail ? `${LEVEL_NAME[focus.level]}${rail.count > 1 ? ' · ' + rail.count + ' 卡' : ''}` : `${N.toLocaleString()} 卡 · ${nBlades.toLocaleString()} Host · ${nCabs} 机柜（物理分组）`}</div>
                {focus && rail ? (
                  <>
                    {(['util', 'strag', 'fault'] as Metric[]).map((mm) => {
                      const v = rail[mm];
                      return (
                        <div key={mm}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, margin: '4px 0 2px' }}>
                            <span style={{ color: 'var(--tx2)' }}>{M_LABEL[mm]}</span><span style={{ fontWeight: 600, ...TNUM }}>{Math.round(v * 100)}%</span>
                          </div>
                          <div style={{ height: 5, borderRadius: 3, background: 'var(--btn)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.round(v * 100)}%`, background: loadColor(v), borderRadius: 3 }} /></div>
                        </div>
                      );
                    })}
                    {groups.length > 0 && (
                      <div style={{ marginTop: 9, borderTop: '1px solid var(--bd)', paddingTop: 7 }}>
                        <div style={{ fontSize: 10, color: 'var(--tx3)', marginBottom: 5 }}>并行关系 · rank↔rank（{pm.cfg}）</div>
                        {groups.map((g) => (
                          <div key={g.d} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, margin: '3px 0' }}>
                            <CollGlyph pat={g.pat} c={g.c} />
                            <span style={{ color: g.c, fontWeight: 700, width: 20, flexShrink: 0 }}>{g.d.toUpperCase()}</span>
                            <span style={{ color: 'var(--tx2)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.label} · {g.coll}</span>
                            <span style={{ color: 'var(--tx3)', flexShrink: 0, ...TNUM }}>{g.peers}对端/{g.deg}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {phys && (
                      <div style={{ marginTop: 4, borderTop: '1px solid var(--bd)', paddingTop: 7 }}>
                        <div style={{ fontSize: 10, color: 'var(--tx3)', marginBottom: 5 }}>通信平面 · {phys.planeLabel}</div>
                        {PLANES.map((p) => <span key={p.id} style={{ display: 'inline-block', fontSize: 10.5, padding: '2px 8px', borderRadius: 10, background: `${p.color}1f`, color: p.color, margin: '0 4px 4px 0', opacity: phys.plane === p.id || phys.plane === 'multi' ? 1 : 0.4 }}>{p.short}</span>)}
                        <div style={{ fontSize: 9.5, color: 'var(--tx3)', lineHeight: 1.5, marginTop: 2 }}>{phys.devices}</div>
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--tx3)', lineHeight: 1.55 }}>左侧层级图驱动右侧阵列全景。点实体只展开其链路；方向(全链/上游/下游)过滤；镜头切阵列呈现；时间轴回放看问题定位。</div>
                )}
              </div>

              <div style={{ ...card, padding: '8px 11px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--tx2)' }}>状态（红黄绿+灰 = 状态唯一一套色）</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {STATE_LABELS.map((lb, i) => <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--tx2)' }}><span style={{ width: 9, height: 9, borderRadius: 2, background: stateColor(i) }} />{lb}</span>)}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, borderTop: '1px solid var(--bd)', paddingTop: 4 }}>
                  {([['Chip', ENTITY_COLORS.card], ['Host', ENTITY_COLORS.node], ['机柜（物理分组）', ENTITY_COLORS.cab], ['Pod', ENTITY_COLORS.super]] as [string, string][]).map(([t, c]) => (
                    <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--tx2)' }}><span style={{ width: 9, height: 9, borderRadius: 2, background: c }} />{t}</span>
                  ))}
                </div>
                <div style={{ fontSize: 9.5, color: 'var(--tx3)' }}>蓝=选中焦点 · 紫环=掉队卡 · 链路外压暗 · 单击实体联动</div>
              </div>
            </div>
          )}

          {hover && (
            <div style={{ position: 'absolute', right: 248, bottom: 12, maxWidth: 320, ...card, padding: '7px 11px', fontSize: 12, lineHeight: 1.5, color: 'var(--tx)', pointerEvents: 'none' }}>{hover}</div>
          )}
        </div>
      </div>

      {/* playbar */}
      <div className={workbenchProfile ? 'hpc-console-playbar hpc-console-playbar--floating' : 'hpc-console-playbar'} style={{ display: 'flex', alignItems: 'center', gap: 12, ...(workbenchProfile ? { padding: '8px 12px', background: 'var(--panel-shell-bg)', borderRadius: 'var(--panel-shell-radius)', boxShadow: 'var(--panel-shell-shadow)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' } : { padding: '7px 16px', borderTop: '1px solid var(--bd)', background: 'var(--panel-solid)' }) }}>
        <button onClick={() => setPlaying((v) => !v)} style={{ width: 30, height: 26, border: `1px solid ${ACCENT}`, background: ACCENT, color: '#fff', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>{playing ? '❚❚' : '▶'}</button>
        <span style={{ fontSize: 11, color: 'var(--tx2)', whiteSpace: 'nowrap', ...TNUM }}>{`t = ${step}`}</span>
        <input type="range" min={0} max={STEP_MAX} value={step} onChange={(e) => setStep(+e.target.value)} style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: problem ? '#ef6d6d' : 'var(--tx3)', whiteSpace: 'nowrap' }}>{problem ? `⚠ 过热事件窗口 t=${EVT_LO}–${EVT_HI}` : `工况 ${WL[workload].label} · 指标 ${M_LABEL[metric]}`}</span>
      </div>
    </div>
  );
}

/**
 * ConsoleView — 联动控制台. A single linked module that fuses the three existing views:
 *   · 平面视图 (PlaneView)      → LEFT, used as the CONTROL surface
 *   · 阵列全景 (FullPodScene)   → RIGHT, the MAIN 3-D panorama (full super-node)
 *   · 运行状态 (status charts)  → the analysis DASHBOARD (KPI · 层级状态轴 · 实体仪表 · 根因)
 *
 * Linkage (the low-fi reference is ONLY for this left↔right relationship): selecting any
 * level / card in the left plane drives the panorama's highlighted chain AND the dashboard's
 * auxiliary metrics; clicking the panorama or the status-axis updates the same shared focus.
 *
 * Everything visual — glyphs, colours, state system, connections, up/down hierarchy and
 * intra-level relations — is OUR existing solution: the real PlaneView + FullPodScene are
 * reused as-is, and the dashboard is drawn from the same data.ts primitives the 运行状态
 * view uses (loadColor / loadState / stateColor / nodeLoad / isHot / ENTITY_COLORS / PLANES …).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  GENERATIONS, ENTITY_COLORS, PARALLEL_COLORS, PARTITION_META, PLANES, LEVEL_PHYS,
  loadColor, loadState, stateColor, STATE_LABELS, nodeLoad, isHot,
  type Gen, type PartitionDim, type RunPhase, type RunMode,
} from '../scene/data';
import { TOK } from '../content';
import { FullPodScene, SceneTheme, type CommOverlays } from '../scene/scenes';
import { PlaneView, type PlaneSel } from './PlaneView';

// ── hierarchy fan-out (the 8×8 schematic shared with PlaneView full super-node + FullPodScene
//    full=true): 8 卡/刀片 · 8 刀片/柜 → 64 卡/柜. A global card index `k` therefore maps the
//    SAME way in all three views, so a selection on one lights up the matching entity elsewhere.
const CPB = 8, BPC = 8, PER_CAB = CPB * BPC;
const STEP_MAX = 60, EVT_LO = 34, EVT_HI = 46, EVT_CAB = 1;   // injected 过热 window on cabinet C1

type Workload = 'pretrain' | 'prefill' | 'decode';
type Metric = 'util' | 'strag' | 'fault';
type Lens = 'heat' | 'flow' | 'domain' | 'phys';
type Dir = 'all' | 'up' | 'down';
type Focus = PlaneSel;   // { level, card, die?, core? } | null — shared single source of truth

const WL: Record<Workload, { label: string; kind: RunPhase['kind'] }> = {
  pretrain: { label: '预训练', kind: 'compute' },
  prefill: { label: 'Prefill', kind: 'compute' },
  decode: { label: 'Decode', kind: 'comm' },
};
const M_LABEL: Record<Metric, string> = { util: '利用率', strag: '掉队率', fault: '故障度' };
const LENS_LABEL: Record<Lens, string> = { heat: '状态热力', flow: '机柜流量', domain: '通信域', phys: '物理链路' };
const LEVEL_NAME: Record<string, string> = { cluster: '集群', super: '超节点', cab: '机柜', node: '节点', card: '卡 rank', die: '计算 Die', core: 'AI Core', tile: 'Tile' };
const OVERLAYS: CommOverlays = { ring: false, a2a: false, tile: true, cores: true };   // panorama die-inset overlays (stable identity)

// ── metric model (deterministic, mirrors 运行状态): util = phase-load + live ripple + 机柜事件;
//    strag/fault are sparse states that bloom inside the event window on the affected cabinet. ──
const rnd = (s: number) => { const x = Math.sin(s * 99.13) * 43758.5453; return x - Math.floor(x); };
function cardLoad(k: number, wlKind: string, step: number): number {
  let v = nodeLoad(k, wlKind) + (rnd(k * 0.91 + step * 0.07) - 0.5) * 0.06;
  if (step >= EVT_LO && step <= EVT_HI && Math.floor(k / PER_CAB) === EVT_CAB) v += 0.22 * Math.sin((step - EVT_LO) / (EVT_HI - EVT_LO) * Math.PI);
  return Math.max(0, Math.min(1, v));
}
function isStrag(k: number, step: number): boolean {
  let thr = 0.93;
  if (step >= EVT_LO && step <= EVT_HI && Math.floor(k / PER_CAB) === EVT_CAB) thr = 0.55;
  return rnd(k * 1.7 + step * 0.05) > thr;
}
function isFault(k: number, step: number): boolean {
  const inEvt = step >= EVT_LO && step <= EVT_HI && Math.floor(k / PER_CAB) === EVT_CAB && Math.floor(k / CPB) % BPC === 1;
  return inEvt ? rnd(k * 0.7) > 0.25 : rnd(k * 0.7 + 13) > 0.985;
}
function cardMetric(k: number, metric: Metric, wlKind: string, step: number): number {
  if (metric === 'fault') return isFault(k, step) ? 0.95 : 0.1;
  if (metric === 'strag') return isStrag(k, step) ? 0.88 : Math.max(0, cardLoad(k, wlKind, step) - 0.5) * 0.4;
  return cardLoad(k, wlKind, step);
}

// focus ↔ panorama selection (FullPodScene sel: lv 0 card / 1 blade(node) / 2 cabinet, i = global index)
function focusToSel(f: Focus): { lv: number; i: number } | null {
  if (!f || f.level === 'cluster' || f.level === 'super') return null;   // whole field → no chain highlight
  if (f.level === 'cab') return { lv: 2, i: Math.floor(f.card / PER_CAB) };
  if (f.level === 'node') return { lv: 1, i: Math.floor(f.card / CPB) };
  return { lv: 0, i: f.card };   // card / die / core / tile → highlight the owning card chain
}
function selToFocus(s: { lv: number; i: number } | null): Focus {
  if (!s) return null;
  if (s.lv === 2) return { level: 'cab', card: s.i * PER_CAB };
  if (s.lv === 1) return { level: 'node', card: s.i * CPB };
  return { level: 'card', card: s.i };
}
function scopeRange(f: Focus, N: number): [number, number] {
  if (!f || f.level === 'cluster' || f.level === 'super') return [0, N];
  if (f.level === 'cab') { const c = Math.floor(f.card / PER_CAB); return [c * PER_CAB, Math.min(N, (c + 1) * PER_CAB)]; }
  if (f.level === 'node') { const n = Math.floor(f.card / CPB); return [n * CPB, Math.min(N, (n + 1) * CPB)]; }
  return [f.card, f.card + 1];
}
function focusName(f: Focus): string {
  if (!f || f.level === 'cluster' || f.level === 'super') return '全量超节点';
  const k = f.card;
  if (f.level === 'cab') return `机柜 C${Math.floor(k / PER_CAB)}`;
  if (f.level === 'node') return `节点 B${Math.floor(k / CPB)}`;
  if (f.level === 'card') return `卡 r${k}（device）`;
  if (f.level === 'die') return `卡 ${k} · 计算 Die ${f.die ?? 0}`;
  if (f.level === 'core') return `卡 ${k} · AI Core #${f.core ?? 0}`;
  return `卡 ${k} · Tile`;
}

// ── shared button language (mirrors ClusterView / PlaneView: solid blocks for emphasis) ──
const ACCENT = '#4369ef';
const SECONDARY: React.CSSProperties = { border: '1px solid var(--btn-bd)', background: 'var(--btn)', color: 'var(--tx2)' };
function ink(hex: string): string { const h = hex.replace('#', ''); if (h.length < 6) return '#fff'; const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#10131a' : '#fff'; }
function navBtn(on: boolean): React.CSSProperties { return on ? { border: `1px solid ${ACCENT}`, background: ACCENT, color: '#fff', fontWeight: 600, boxShadow: '0 1px 3px rgba(67,105,239,0.40)' } : { ...SECONDARY }; }
function toggleBtn(on: boolean, c: string): React.CSSProperties { return on ? { border: `1px solid ${c}`, background: c, color: ink(c), fontWeight: 600 } : { ...SECONDARY }; }
const GLAB: React.CSSProperties = { fontSize: 10, fontWeight: 600, letterSpacing: 0.3, color: 'var(--tx3)', alignSelf: 'center' };
const TNUM: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };
const btnBase: React.CSSProperties = { padding: '4px 10px', fontSize: 11.5, borderRadius: 7, cursor: 'pointer' };

// imperatively frame the orthographic camera on the (large) full-pod field, once per gen
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FitCamera({ reach, controls }: { reach: number; controls: React.MutableRefObject<any> }) {
  const { camera, size } = useThree();
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (size.height < 10) return;                       // wait for a real canvas size
    if (last.current === reach) return;                 // re-fit only on gen (reach) change, not resize
    last.current = reach;
    const worldH = Math.max(14, reach * 1.5), ty = Math.min(6, reach * 0.1);
    const tgt = new THREE.Vector3(0, ty, 0), dir = new THREE.Vector3(1, 0.82, 1).normalize();
    camera.position.copy(tgt).addScaledVector(dir, reach * 1.3);
    camera.up.set(0, 1, 0);
    const oc = camera as THREE.OrthographicCamera;
    if (oc.isOrthographicCamera) oc.zoom = size.height / worldH;
    camera.updateProjectionMatrix();
    if (controls.current) { controls.current.target.copy(tgt); controls.current.update(); }
  }, [reach, size.height, camera, controls]);
  return null;
}

export function ConsoleView({ gen, dark }: { gen: Gen; dark: boolean }) {
  const spec = GENERATIONS[gen];
  const N = spec.totalNpus;
  const nBlades = Math.ceil(N / CPB), nCabs = Math.ceil(nBlades / BPC), PP = Math.min(16, nBlades);

  const [workload, setWorkload] = useState<Workload>('pretrain');
  const [metric, setMetric] = useState<Metric>('util');
  const [dir, setDir] = useState<Dir>('all');
  const [lens, setLens] = useState<Lens>('heat');
  const [partDim, setPartDim] = useState<Exclude<PartitionDim, 'none'>>('tp');   // 通信域 lens: which parallel切分
  const [focus, setFocus] = useState<Focus>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);
  const wlKind = WL[workload].kind;

  useEffect(() => { setFocus(null); }, [gen]);   // drop stale selection on generation switch
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setStep((s) => (s + 1) % (STEP_MAX + 1)), 650);
    return () => clearInterval(id);
  }, [playing]);

  // ── one pass over every card → cluster KPI + per-cab / per-node / per-card distributions ──
  const stats = useMemo(() => {
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
      axis: [
        { lvl: 'super' as const, name: '超节点', sub: `${N.toLocaleString()} 卡`, ...agg([clusterMean]) },
        { lvl: 'cab' as const, name: '机柜', sub: `${nCabs} 柜`, ...agg(cabVals) },
        { lvl: 'node' as const, name: '节点', sub: `${nBlades.toLocaleString()} 节点`, ...agg(ndVals) },
        { lvl: 'card' as const, name: '卡 rank', sub: `${N.toLocaleString()} 卡`, ...agg(cardVals) },
      ],
    };
  }, [N, nCabs, nBlades, metric, wlKind, step]);

  // focused-entity auxiliary metrics (exact over the scope range; ≤64 cards unless whole)
  const rail = useMemo(() => {
    const [lo, hi] = scopeRange(focus, N), n = hi - lo;
    if (n > PER_CAB) return null;   // whole / super → handled by the cluster summary block
    const mean = (m: Metric) => { let s = 0; for (let k = lo; k < hi; k++) s += cardMetric(k, m, wlKind, step); return n ? s / n : 0; };
    return { util: mean('util'), strag: mean('strag'), fault: mean('fault'), count: n };
  }, [focus, N, wlKind, step]);

  // 根因 (DAVIS-style) — the injected 机柜 over-heat is the demo problem during the event window
  const problem = useMemo(() => {
    if (step < EVT_LO || step > EVT_HI) return null;
    let strag = 0; for (let k = EVT_CAB * PER_CAB; k < (EVT_CAB + 1) * PER_CAB && k < N; k++) if (isStrag(k, step)) strag++;
    const redR = stats.kpi.hot / N;
    return { root: EVT_CAB, title: `机柜 C${EVT_CAB} 过热`, chain: `液冷异常 → ${strag} 卡掉队(straggler) → DP 梯度 AllReduce 阻塞`, impact: `影响 ${Math.min(N, PER_CAB)} 卡 · step 延迟 +${Math.round(redR * 420 + 22)}%` };
  }, [step, N, stats.kpi.hot]);

  // breadcrumb (ancestors of the focus, each clickable to re-focus that level)
  const crumbs = useMemo(() => {
    const out: { lvl: NonNullable<Focus>['level']; label: string; card: number }[] = [{ lvl: 'super', label: '超节点', card: 0 }];
    if (focus && focus.level !== 'super' && focus.level !== 'cluster') {
      const cab = Math.floor(focus.card / PER_CAB); out.push({ lvl: 'cab', label: `机柜 C${cab}`, card: cab * PER_CAB });
      if (['node', 'card', 'die', 'core', 'tile'].includes(focus.level)) { const b = Math.floor(focus.card / CPB); out.push({ lvl: 'node', label: `节点 B${b}`, card: b * CPB }); }
      if (['card', 'die', 'core', 'tile'].includes(focus.level)) out.push({ lvl: 'card', label: `卡 r${focus.card}`, card: focus.card });
      if (['die', 'core', 'tile'].includes(focus.level)) out.push({ lvl: focus.level, label: LEVEL_NAME[focus.level], card: focus.card });
    }
    return out;
  }, [focus]);

  // ── panorama config derived from the lens (the 运行状态 镜头 mapped onto the 阵列全景) ──
  // panoPhase / panoSel are MEMOISED so their object identity is stable across playback
  // step-ticks: FullPodScene's 8K-instance recolor effect keys on `phase` + `sel`, so a fresh
  // object every render would needlessly re-run it ~1.5×/s. They change only on real input.
  const panoStatus = lens === 'heat' || lens === 'flow';
  const panoPeers = lens === 'flow';
  const panoPlanes = lens === 'phys';
  const panoPart: PartitionDim = lens === 'domain' ? partDim : 'none';
  const panoPhase = useMemo<RunPhase | null>(() => (playing && (lens === 'heat' || lens === 'flow')
    ? { id: 'wl', name: WL[workload].label, kind: wlKind, color: wlKind === 'comm' ? '#ff4b7b' : '#22d3ee', collective: lens === 'flow' ? 'ring' : undefined, note: '' }
    : null), [playing, lens, workload, wlKind]);
  const runMode: RunMode = workload === 'pretrain' ? 'train' : 'infer';
  const reach = Math.sqrt(N) * 1.3 + 12;
  const panoSel = useMemo(() => focusToSel(focus), [focus]);

  // group rows for the focused card (TP/PP/DP/EP)
  const groups = focus && rail ? (() => {
    const k = focus.card, b = Math.floor(k / CPB);
    return [
      { d: 'tp', label: `TP·${k % CPB}`, c: PARALLEL_COLORS.tp },
      { d: 'pp', label: `PP·${b % PP}`, c: PARALLEL_COLORS.pp },
      { d: 'dp', label: `DP·复本${Math.floor(b / PP)}`, c: PARALLEL_COLORS.dp },
      { d: 'ep', label: `EP·C${Math.floor(k / PER_CAB)}`, c: PARALLEL_COLORS.ep },
    ];
  })() : [];
  const phys = focus && rail ? LEVEL_PHYS[focus.level] : null;

  const card: React.CSSProperties = { background: 'var(--panel)', border: '1px solid var(--bd)', borderRadius: 11, boxShadow: 'var(--shadow-sm)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 11, display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--tx)' }}>
      {/* ── shared toolbar: 工况 / 指标 / 方向 / 镜头 (+切分) · breadcrumb · KPI ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderBottom: '1px solid var(--bd)', flexWrap: 'wrap', background: 'var(--panel-solid)' }}>
        <span style={GLAB}>工况</span>
        <div style={{ display: 'flex', gap: 3 }}>
          {(Object.keys(WL) as Workload[]).map((w) => (
            <button key={w} onClick={() => setWorkload(w)} style={{ ...btnBase, ...(workload === w ? { border: '1px solid #2a6f5f', background: '#2a6f5f', color: '#fff', fontWeight: 600 } : SECONDARY) }}>{WL[w].label}</button>
          ))}
        </div>
        <span style={GLAB}>指标</span>
        <div style={{ display: 'flex', gap: 3 }}>
          {(Object.keys(M_LABEL) as Metric[]).map((m) => (
            <button key={m} onClick={() => setMetric(m)} style={{ ...btnBase, ...navBtn(metric === m) }}>{M_LABEL[m]}</button>
          ))}
        </div>
        <span style={GLAB}>方向</span>
        <div style={{ display: 'flex', gap: 3 }}>
          {([['all', '全链'], ['up', '上游'], ['down', '下游']] as [Dir, string][]).map(([d, l]) => (
            <button key={d} onClick={() => setDir(d)} style={{ ...btnBase, ...navBtn(dir === d) }}>{l}</button>
          ))}
        </div>
        <span style={GLAB}>镜头</span>
        <div style={{ display: 'flex', gap: 3 }}>
          {(Object.keys(LENS_LABEL) as Lens[]).map((l) => (
            <button key={l} onClick={() => setLens(l)} style={{ ...btnBase, ...(lens === l ? { border: '1px solid #5a3a86', background: '#5a3a86', color: '#fff', fontWeight: 600 } : SECONDARY) }}>{LENS_LABEL[l]}</button>
          ))}
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
        {/* breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--tx2)', flex: 1, minWidth: 60, overflow: 'hidden' }}>
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {i > 0 && <span style={{ color: 'var(--tx3)' }}>›</span>}
              <span onClick={() => setFocus(c.lvl === 'super' ? null : { level: c.lvl, card: c.card })} style={{ cursor: 'pointer', padding: '2px 5px', borderRadius: 5, color: i === crumbs.length - 1 ? 'var(--tx)' : ACCENT }}>{c.label}</span>
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

      {/* ── body: left plane control · right panorama + dashboard ── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* LEFT — 平面视图 as the control surface */}
        <div style={{ flex: '0 0 40%', maxWidth: '46%', minWidth: 360, borderRight: '1px solid var(--bd)', display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--panel-solid)' }}>
          <div style={{ padding: '5px 12px', fontSize: 11, color: 'var(--tx3)', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
            平面视图 · 控制 — 切换 器件互联/层级图/顶视图，点击任意层级或卡 → 联动右侧阵列全景 + 运行仪表
          </div>
          <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
            <PlaneView gen={gen} dark={dark} onSelect={setFocus} />
          </div>
        </div>

        {/* RIGHT — 阵列全景 (main) + 运行状态 dashboard overlays */}
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <Canvas
            orthographic
            dpr={[1, 2]}
            camera={{ position: [reach, reach * 0.7, reach], zoom: 8, near: 0.1, far: 4000 }}
            gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1, powerPreference: 'high-performance' }}
            onCreated={({ gl }) => { gl.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault(), false); }}
          >
            <color attach="background" args={[dark ? '#101010' : '#f5f5f5']} />
            <fog attach="fog" args={[dark ? '#101010' : '#f5f5f5', 90, 420]} />
            <ambientLight intensity={dark ? 1.35 : 1.05} />
            <directionalLight position={[8, 14, 6]} intensity={dark ? 0.95 : 1.2} />
            <pointLight position={[0, 10, 0]} intensity={dark ? 0.7 : 1.0} color={dark ? '#7e93cf' : '#e8f0ff'} />
            <FitCamera reach={reach} controls={controlsRef} />
            <SceneTheme.Provider value={dark}>
              <FullPodScene
                scale="64P" podCount={1} full gen={spec} overlays={OVERLAYS}
                runMode={runMode} phase={panoPhase} partition={panoPart} peers={panoPeers}
                status={panoStatus} planes={panoPlanes} onHoverInfo={setHover} onPick={() => { /* double-click handled via focus */ }}
                focusSel={panoSel} onSel={(s) => setFocus(selToFocus(s))} dir={dir}
              />
            </SceneTheme.Provider>
            <OrbitControls
              ref={controlsRef} makeDefault enableDamping dampingFactor={0.08}
              minPolarAngle={0} maxPolarAngle={Math.PI / 2} minDistance={2} maxDistance={600}
              mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }}
            />
          </Canvas>

          <div style={{ position: 'absolute', top: 8, left: 12, fontSize: 11, color: 'var(--tx3)', pointerEvents: 'none' }}>
            3D 阵列全景 · 主视图 · 镜头：{LENS_LABEL[lens]}{dir !== 'all' ? ` · ${dir === 'up' ? '上游' : '下游'}` : ''} · 全量 {N.toLocaleString()} 卡
          </div>

          {/* 运行状态 instrument 1 — 层级状态轴 (per-level p50 · 红% · 峰p95, clickable) */}
          <div style={{ position: 'absolute', top: 30, left: 12, right: 248, display: 'flex', alignItems: 'stretch', gap: 4, pointerEvents: 'auto' }}>
            {stats.axis.map((a, i) => {
              const on = (focus ? (focus.level === a.lvl || (a.lvl === 'super' && (focus.level === 'super' || focus.level === 'cluster'))) : a.lvl === 'super');
              return (
                <div key={a.lvl} style={{ display: 'flex', alignItems: 'stretch', gap: 4, flex: '1 1 0', minWidth: 0 }}>
                  <div onClick={() => setFocus(a.lvl === 'super' ? null : { level: a.lvl, card: focus?.card ?? 0 })}
                    style={{ ...card, flex: 1, minWidth: 0, padding: '5px 7px', cursor: 'pointer', borderColor: on ? ACCENT : 'var(--bd)', background: on ? 'var(--state-sel)' : 'var(--panel)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 4 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--tx)', whiteSpace: 'nowrap' }}>{a.name}</span>
                      <span style={{ fontSize: 9, color: 'var(--tx3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.sub}</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: 'var(--btn)', overflow: 'hidden', margin: '4px 0 3px' }}>
                      <div style={{ height: '100%', width: `${Math.round(a.p50 * 100)}%`, background: loadColor(a.p50), borderRadius: 3 }} />
                    </div>
                    <div style={{ fontSize: 9.5, color: 'var(--tx3)', ...TNUM }}>{`p50 ${Math.round(a.p50 * 100)}% · 红 ${(a.red * 100).toFixed(0)}% · 峰 ${Math.round(a.p95 * 100)}%`}</div>
                  </div>
                  {i < stats.axis.length - 1 && <span style={{ alignSelf: 'center', color: 'var(--tx3)', fontSize: 12 }}>›</span>}
                </div>
              );
            })}
          </div>

          {/* 运行状态 instrument 2 — 根因 (DAVIS) */}
          <div style={{ position: 'absolute', top: 96, right: 12, width: 224, ...card, padding: '10px 12px', borderColor: problem ? 'var(--danger, #ef4d4d)' : 'var(--bd)', background: problem ? 'rgba(60,24,24,0.92)' : 'var(--panel)' }}>
            <div style={{ fontSize: 10, letterSpacing: 0.4, color: 'var(--tx3)', display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: problem ? '#ef4d4d' : '#2bd47d' }} />DAVIS · 根因分析
            </div>
            {problem ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, margin: '0 0 6px' }}>{problem.title}</div>
                <div style={{ fontSize: 11, color: 'var(--tx2)', lineHeight: 1.55, marginBottom: 7 }}>{problem.chain}</div>
                <div style={{ fontSize: 11, color: '#ef6d6d', marginBottom: 8 }}>{problem.impact}</div>
                <button onClick={() => { setFocus({ level: 'cab', card: problem.root * PER_CAB }); setDir('down'); }} style={{ width: '100%', border: `1px solid ${ACCENT}`, background: ACCENT, color: '#fff', fontSize: 12, padding: 6, borderRadius: 7, cursor: 'pointer' }}>定位根因 →</button>
              </>
            ) : (
              <div style={{ fontSize: 11, color: 'var(--tx3)', lineHeight: 1.55 }}>当前无活动问题。拖动下方时间轴到 t=34–46 触发过热事件，看根因链自动聚合与定位。</div>
            )}
          </div>

          {/* 运行状态 instrument 3 — 实体仪表 (auxiliary metrics for the focus) */}
          <div style={{ position: 'absolute', top: problem ? 252 : 232, right: 12, width: 224, ...card, padding: '10px 12px' }}>
            <div style={{ fontSize: 13, fontWeight: 600, margin: '0 0 2px' }}>{focusName(focus)}</div>
            <div style={{ fontSize: 11, color: 'var(--tx2)', marginBottom: 8 }}>{focus && rail ? `${LEVEL_NAME[focus.level]}${rail.count > 1 ? ' · ' + rail.count + ' 卡' : ''}` : `${N.toLocaleString()} 卡 · ${nCabs} 机柜 · ${nBlades.toLocaleString()} 节点`}</div>
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
                    <div style={{ fontSize: 10, color: 'var(--tx3)', marginBottom: 5 }}>并行组（rank 关系）</div>
                    {groups.map((g) => <span key={g.d} style={{ display: 'inline-block', fontSize: 10.5, padding: '2px 8px', borderRadius: 10, background: `${g.c}22`, color: g.c, margin: '0 4px 4px 0' }}>{g.label}</span>)}
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
              <div style={{ fontSize: 11, color: 'var(--tx3)', lineHeight: 1.55 }}>左侧平面视图驱动右侧阵列全景。方向开关切上下游链路；镜头切阵列呈现（状态热力/机柜流量/通信域/物理链路）；时间轴回放看问题定位。</div>
            )}
          </div>

          {/* legend — state (iron-rule RYG) + hierarchy + planes */}
          <div style={{ position: 'absolute', left: 12, bottom: 12, ...card, padding: '8px 11px', display: 'flex', flexDirection: 'column', gap: 5, maxWidth: 260 }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--tx2)' }}>状态（红黄绿+灰 = 状态唯一一套色）</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {STATE_LABELS.map((lb, i) => <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--tx2)' }}><span style={{ width: 9, height: 9, borderRadius: 2, background: stateColor(i) }} />{lb}</span>)}
            </div>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--tx2)', borderTop: '1px solid var(--bd)', paddingTop: 4 }}>层级（图元/位置区分，不抢状态色）</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {([['卡', ENTITY_COLORS.card], ['节点', ENTITY_COLORS.node], ['机柜', ENTITY_COLORS.cab], [TOK.supernode, ENTITY_COLORS.super]] as [string, string][]).map(([t, c]) => (
                <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--tx2)' }}><span style={{ width: 9, height: 9, borderRadius: 2, background: c }} />{t}</span>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {PLANES.map((p) => <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--tx2)' }}><span style={{ width: 12, height: 3, borderRadius: 1, background: p.color }} />{p.short}</span>)}
            </div>
            <div style={{ fontSize: 9.5, color: 'var(--tx3)' }}>蓝链 = 选中上下游 · 青网 = 同级 peer mesh · 单击卡/节点/机柜联动</div>
          </div>

          {/* hover info */}
          {hover && (
            <div style={{ position: 'absolute', right: 248, bottom: 12, maxWidth: 320, ...card, padding: '7px 11px', fontSize: 12, lineHeight: 1.5, color: 'var(--tx)', pointerEvents: 'none' }}>{hover}</div>
          )}
        </div>
      </div>

      {/* ── playbar: 回放 step（驱动工况负载 + 注入机柜事件） ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 16px', borderTop: '1px solid var(--bd)', background: 'var(--panel-solid)' }}>
        <button onClick={() => setPlaying((v) => !v)} style={{ width: 30, height: 26, border: `1px solid ${ACCENT}`, background: ACCENT, color: '#fff', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>{playing ? '❚❚' : '▶'}</button>
        <span style={{ fontSize: 11, color: 'var(--tx2)', whiteSpace: 'nowrap', ...TNUM }}>{`t = ${step}`}</span>
        <input type="range" min={0} max={STEP_MAX} value={step} onChange={(e) => setStep(+e.target.value)} style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: problem ? '#ef6d6d' : 'var(--tx3)', whiteSpace: 'nowrap' }}>{problem ? `⚠ 过热事件窗口 t=${EVT_LO}–${EVT_HI}` : `工况 ${WL[workload].label} · 指标 ${M_LABEL[metric]}`}</span>
      </div>
    </div>
  );
}

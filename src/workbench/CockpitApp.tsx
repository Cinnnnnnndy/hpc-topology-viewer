/**
 * CockpitApp — 统一驾驶舱（取代工作台内容）。
 *
 * 沿用工作台的页面框架与设计风格（pto-workbench-shell + 主题 token），保留左右结构与 L0–L7 层级：
 *   · 左栏 = L0–L7 层级图（对右侧 3D 做层级控制/筛选，显示归属链）+ 两块诊断面板：
 *       ① 动态监控双模式（实时热力大盘 vs 时间轴回放，原型第四组件）
 *       ② 集合通信深潜诊断（环构建散射 / PXN / busbw，原型第八组件）
 *   · 右栏 = 物理机柜层级场景（FullPodScene）⇄ 时空折叠魔方（CubeView 立方重排），一键切换。
 *   · 顶栏 = 工况 · 时间轴 Scrubber/播放 · 策略着色 · 右场景切换。
 *
 * 四维同屏：位置(物理/魔方) + 着色(策略互斥) + 连线/热点(通信·时间的函数) + 下钻(算子/层级)。
 * 左右联动：左点卡/层级 → 右 3D 高亮/取粒度；右点卡 → 左监控窗口滚动 + 层级轴归属链。
 * 所有面板共用同一 工况/step/播放/选区（单一真值源），左右同屏同一个世界。
 */
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewcube } from '@react-three/drei';
import * as THREE from 'three';
import {
  DEFAULT_GEN, GENERATIONS, PARALLEL_COLORS, PARTITION_META, levelName, NPUS_PER_NODE,
  type Gen, type ViewSync, type ParallelWorkload, type PartitionDim, type LevelKey, type RunPhase, type RunMode,
} from '../scene/data';
import { FullPodScene, SceneTheme } from '../scene/scenes';
import { type LayoutView } from '../scene/layout';
import { deploymentOf } from '../scene/deployment';
import { SceneVisualProfileContext, sceneSurface } from '../scene/visual-profile';
import { CubeView } from '../view/CubeView';
import { HierarchyAxis } from '../view/HierarchyAxis';
import { DualModeMonitor } from '../view/DualModeMonitor';
import { CommDeepDive } from '../view/CommDeepDive';

const CPB = NPUS_PER_NODE;
const MONO = "'JetBrains Mono','Consolas',ui-monospace,monospace";
const WL_LABEL: Record<ParallelWorkload, string> = { pretrain: '预训练', prefill: 'Prefill', decode: 'Decode' };
const STRAT_DIMS: PartitionDim[] = ['none', 'tp', 'pp', 'dp', 'ep'];
const STRAT_LABEL: Record<PartitionDim, string> = { none: '无', tp: 'TP', pp: 'PP', dp: 'DP', ep: 'EP' };
const STEP_MAX = 60;
// LevelKey → CubeView 聚合粒度直接透传；FullPodScene 用选中 rank 做焦点。层级轴主要驱动魔方粒度 + 监控窗口。

const THEME_VARS: React.CSSProperties = {
  '--bg': 'var(--background)', '--bg2': 'var(--background-subtle)',
  '--panel': 'var(--panel-shell-bg)', '--panel-solid': 'var(--background-elevated)',
  '--tx': 'var(--foreground)', '--tx2': 'var(--foreground-muted)', '--tx3': 'var(--foreground-subtle)',
  '--bd': 'var(--border)', '--bd2': 'var(--border-strong)',
  '--shadow': 'var(--shadow-md)', '--shadow-sm': 'var(--shadow-sm)',
  '--btn': 'var(--button-secondary-bg)', '--btn-bd': 'var(--button-secondary-border)',
  '--primary': 'var(--primary)', '--primary-foreground': 'var(--primary-foreground)',
} as React.CSSProperties;

const SECONDARY: React.CSSProperties = { border: '1px solid var(--button-secondary-border)', background: 'var(--button-secondary-bg)', color: 'var(--foreground-muted)' };
function navBtn(on: boolean): React.CSSProperties { return on ? { border: '1px solid var(--primary)', background: 'var(--primary)', color: 'var(--primary-foreground)', fontWeight: 600 } : { ...SECONDARY }; }
function chipBtn(on: boolean, c: string): React.CSSProperties { return on ? { border: `1px solid ${c}`, background: c, color: '#0b0f16', fontWeight: 700 } : { ...SECONDARY }; }
const btn: React.CSSProperties = { padding: '4px 11px', fontSize: 11.5, borderRadius: 8, cursor: 'pointer' };
const LBL: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--tx3)', alignSelf: 'center' };
const card: React.CSSProperties = { background: 'var(--panel-solid)', border: '1px solid var(--bd)', borderRadius: 10, padding: '11px 12px' };

// 一次性把正交相机缩放到能容纳整座 Pod（无需外部 FrameCamera）。
function FitPod({ reach }: { reach: number }) {
  const { camera, size } = useThree();
  const done = useRef(false);
  useEffect(() => { done.current = false; }, [reach]);
  useFrame(() => {
    if (done.current || size.height < 10) return;
    const oc = camera as THREE.OrthographicCamera;
    if (oc.isOrthographicCamera) {
      const want = size.height / Math.max(14, reach * 1.5) * 2;
      oc.zoom += (want - oc.zoom) * 0.2; oc.updateProjectionMatrix();
      if (Math.abs(oc.zoom - want) < 0.05) done.current = true;
    }
  });
  return null;
}

export function CockpitApp() {
  const visualProfile = useContext(SceneVisualProfileContext);
  const [gen] = useState<Gen>(DEFAULT_GEN);
  const [dark, setDark] = useState(true);
  const spec = GENERATIONS[gen];
  const N = spec.totalNpus;
  const surf = sceneSurface(dark, visualProfile);

  const [workload, setWorkload] = useState<ParallelWorkload>('pretrain');
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [metric, setMetric] = useState<'util' | 'strag' | 'fault'>('util');
  const [planeOn, setPlaneOn] = useState({ ub: true, rdma: true, vpc: false });
  const [layout, setLayout] = useState<LayoutView>('physical');
  const [stratColor, setStratColor] = useState<PartitionDim>('none');
  const [aggLevel, setAggLevel] = useState<LevelKey>('card');
  const [sel, setSel] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [rightScene, setRightScene] = useState<'phys' | 'cube'>('phys');
  const [leftTab, setLeftTab] = useState<'monitor' | 'comm'>('monitor');
  const [monMode, setMonMode] = useState<'heat' | 'replay'>('heat');

  // 单一时钟：仅此处推进 step（CubeView 收到 playing=false 以避免二次推进）。
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setStep((s) => (s + 1) % (STEP_MAX + 1)), 650);
    return () => clearInterval(id);
  }, [playing]);

  const sync: ViewSync = {
    workload, step, playing, metric, planeOn,
    setWorkload, setStep, setPlaying, setMetric, setPlaneOn,
    stratColor, commLayer: true, alertLayer: true, aggLevel, selRank: sel,
  };
  const cubeSync: ViewSync = { ...sync, playing: false };   // CubeView 不自转时钟

  const dep = useMemo(() => deploymentOf(workload, N), [workload, N]);
  const reach = useMemo(() => Math.sqrt(N) * 1.3 + 12, [N]);
  const runMode: RunMode = workload === 'pretrain' ? 'train' : 'infer';
  const wlKind = workload === 'decode' ? 'comm' : 'compute';
  const panoPhase = useMemo<RunPhase | null>(() => (playing
    ? { id: 'wl', name: WL_LABEL[workload], kind: wlKind, color: wlKind === 'comm' ? '#ff4b7b' : '#22d3ee', collective: wlKind === 'comm' ? 'a2a' : undefined, note: '' }
    : null), [playing, workload, wlKind]);
  const panoSel = useMemo(() => (sel != null ? { lv: 0, i: sel } : null), [sel]);

  const baseHost = sel != null ? Math.floor(Math.floor(sel / CPB) / 8) * 8 : 0;

  const stratTxt = stratColor === 'none' ? '未开策略着色（颜色=状态红黄绿）' : `${STRAT_LABEL[stratColor]} 着色：同色=${PARTITION_META[stratColor as Exclude<PartitionDim, 'none'>].same}`;
  const desc = `${stratTxt} ｜ 右场景：${rightScene === 'phys' ? '物理机柜层级（FullPodScene）' : `时空折叠魔方（${layout === 'physical' ? '物理基准' : layout.toUpperCase() + ' 重排'}）`} ｜ 层级：${levelName(aggLevel)} ｜ 时间：t=${step}·${WL_LABEL[workload]}。四维同屏：位置＋着色＋连线/热点＋下钻。`;

  return (
    <div data-theme={dark ? 'dark' : 'light'} className="hpc-workbench-view pto-workbench-shell" style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--bg)', color: 'var(--tx)', fontFamily: 'var(--font-sans)', ...THEME_VARS,
    }}>
      {/* ══ 顶栏 ══ */}
      <div style={{ flexShrink: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--bd)', background: 'var(--panel-solid)' }}>
        <span style={{ fontSize: 12.5, fontWeight: 800 }}>统一驾驶舱</span>
        <span style={{ fontSize: 9.5, color: 'var(--tx3)' }}>左诊断 · 右 3D · 一张画布四维</span>

        <span style={{ ...LBL, marginLeft: 6 }}>工况</span>
        {(Object.keys(WL_LABEL) as ParallelWorkload[]).map((w) => (
          <button key={w} onClick={() => setWorkload(w)} style={{ ...btn, ...navBtn(workload === w) }}>{WL_LABEL[w]}</button>
        ))}

        <span style={{ ...LBL, marginLeft: 6 }}>策略着色</span>
        {STRAT_DIMS.map((d) => {
          const on = stratColor === d, sig = d === 'none' ? undefined : PARALLEL_COLORS[d];
          return <button key={d} onClick={() => setStratColor(d)} title={d === 'none' ? '关闭策略着色' : `${PARTITION_META[d as Exclude<PartitionDim, 'none'>].label} · 互斥`}
            style={{ ...btn, ...(sig ? chipBtn(on, sig) : navBtn(on)) }}>{STRAT_LABEL[d]}</button>;
        })}

        <span style={{ ...LBL, marginLeft: 6 }}>右场景</span>
        {([['phys', '物理机柜'], ['cube', '时空折叠魔方']] as ['phys' | 'cube', string][]).map(([s, l]) => (
          <button key={s} onClick={() => setRightScene(s)} style={{ ...btn, ...navBtn(rightScene === s) }}>{l}</button>
        ))}
        {rightScene === 'cube' && ([['physical', '物理'], ['tp', 'TP'], ['pp', 'PP'], ['dp', 'DP'], ['ep', 'EP']] as [LayoutView, string][]).map(([v, l]) => (
          <button key={v} onClick={() => setLayout(v)} title={`按 ${l} 重排（飞行动画）`} style={{ ...btn, padding: '3px 8px', ...navBtn(layout === v) }}>{l}</button>
        ))}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <button onClick={() => setPlaying((p) => !p)} style={{ ...btn, ...navBtn(playing) }}>{playing ? '⏸ 暂停' : '▶ 播放'}</button>
          <input type="range" min={0} max={STEP_MAX} value={step % (STEP_MAX + 1)} onChange={(e) => setStep(+e.target.value)} style={{ width: 150 }} />
          <span style={{ fontSize: 10.5, fontFamily: MONO, color: 'var(--tx2)', minWidth: 42 }}>t={step % (STEP_MAX + 1)}</span>
          <button onClick={() => setDark((d) => !d)} title="切换深/浅色" style={{ ...btn, ...SECONDARY }}>{dark ? '☾' : '☀'}</button>
        </div>
      </div>

      {/* ══ 主体：左诊断 / 右 3D ══ */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 左栏 */}
        <div style={{ width: 'clamp(360px, 42%, 560px)', flexShrink: 0, borderRight: '1px solid var(--bd)', background: 'var(--bg)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: 10 }}>
          {/* ① L0-L7 层级图（控制/筛选右 3D + 归属链） */}
          <div style={card}>
            <HierarchyAxis selLevel={aggLevel} onSelectLevel={setAggLevel} selRank={sel} deployment={dep} />
            <div style={{ fontSize: 9.5, color: 'var(--tx3)', marginTop: 6, lineHeight: 1.5 }}>
              点层级 → {rightScene === 'cube' ? '右魔方按该粒度重排/染色' : '右物理场景聚焦该层'}；点右侧卡 → 此处高亮 L7→L0 归属链。
            </div>
          </div>

          {/* ②/③ 诊断面板 tab */}
          <div style={card}>
            <div style={{ display: 'flex', gap: 5, marginBottom: 10 }}>
              <button onClick={() => setLeftTab('monitor')} style={{ ...btn, ...navBtn(leftTab === 'monitor') }}>动态监控双模式</button>
              <button onClick={() => setLeftTab('comm')} style={{ ...btn, ...navBtn(leftTab === 'comm') }}>集合通信深潜</button>
            </div>
            {leftTab === 'monitor' ? (
              <DualModeMonitor mode={monMode} setMode={setMonMode} workload={workload} step={step} setStep={setStep}
                playing={playing} setPlaying={setPlaying} sel={sel} onSelectRank={setSel} baseHost={baseHost} dark={dark} />
            ) : (
              <CommDeepDive dark={dark} />
            )}
          </div>
        </div>

        {/* 右栏：物理机柜层级场景 ⇄ 时空折叠魔方 */}
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          {rightScene === 'cube' ? (
            <CubeView gen={gen} dark={dark} sync={cubeSync} embedded
              layout={layout} stratColor={stratColor} showComm showAlert
              aggLevel={aggLevel} sel={sel} onSelectRank={setSel} onHoverRank={setHover} />
          ) : (
            <Canvas
              orthographic dpr={[1, 2]}
              camera={{ position: [reach, reach * 0.7, reach], zoom: 12, near: 0.1, far: 4000 }}
              gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1, powerPreference: 'high-performance' }}
              onCreated={({ gl }) => { gl.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault(), false); }}
            >
              <color attach="background" args={[surf.background]} />
              <fog attach="fog" args={[surf.fog, 90, 420]} />
              <hemisphereLight intensity={surf.ambient} groundColor={dark ? '#10131a' : '#e8edf4'} />
              <directionalLight position={[8, 14, 6]} intensity={surf.key} />
              <directionalLight position={[-8, 8, -10]} intensity={surf.fill} />
              <pointLight position={[0, 10, 0]} intensity={surf.point} color={surf.pointColor} />
              <FitPod reach={reach} />
              <SceneTheme.Provider value={dark}>
                <FullPodScene
                  scale="64P" podCount={1} full gen={spec} overlays={{ ring: false, a2a: false, tile: true, cores: true }}
                  runMode={runMode} phase={panoPhase} partition={stratColor} peers={false}
                  status={playing} planes={false} onHoverInfo={() => { /* tooltip handled via selection */ }}
                  focusSel={panoSel} onSel={(s) => setSel(s && s.lv === 0 ? s.i : null)} dir="all" scopeOnly={false}
                />
              </SceneTheme.Provider>
              <OrbitControls makeDefault enableDamping dampingFactor={0.08}
                minPolarAngle={0} maxPolarAngle={Math.PI / 2} minDistance={2} maxDistance={600}
                mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }} />
              <GizmoHelper alignment="bottom-left" margin={[64, 88]}>
                <GizmoViewcube faces={['Right', 'Left', 'Top', 'Bottom', 'Front', 'Back']}
                  color={dark ? '#2a2e36' : '#eef1f6'} hoverColor="#4369ef"
                  textColor={dark ? '#e6e6e6' : '#1c2433'} strokeColor={dark ? '#4a5160' : '#aab4c4'} opacity={0.95} />
              </GizmoHelper>
            </Canvas>
          )}

          {/* 右场景内选中/悬停浮条 */}
          <div style={{ position: 'absolute', left: 12, top: 12, ...card, padding: '7px 11px', pointerEvents: 'none', maxWidth: 320 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600 }}>{rightScene === 'phys' ? '物理机柜层级场景' : '时空折叠魔方'}</div>
            <div style={{ fontSize: 9.5, color: 'var(--tx2)', marginTop: 2, lineHeight: 1.5 }}>
              {rightScene === 'phys' ? '按 L0–L7 层级铺陈的真实机柜/Host/卡；点卡下钻、随工况呼吸热力。' : '物理平铺 ⇄ 按 P 重排飞行动画；策略着色 + 层级粒度。'}
              {sel != null && <span style={{ color: '#4369ef', fontFamily: MONO }}> · 选中 rank {sel}</span>}
              {hover != null && <span style={{ color: 'var(--tx3)', fontFamily: MONO }}> · hover r{hover}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* ══ 底栏 desc ══ */}
      <div style={{ flexShrink: 0, borderTop: '1px solid var(--bd)', background: 'var(--panel-solid)', padding: '7px 12px', fontSize: 11, color: 'var(--tx2)', lineHeight: 1.5 }}>{desc}</div>
    </div>
  );
}

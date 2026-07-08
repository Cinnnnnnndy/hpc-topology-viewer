/**
 * CubeView — P1「立方体重排」新视图（加法·独立·不碰 FullPodScene）。
 *
 * 这是承载完整监控愿景的新工作区的起点：同一批卡（rank），按不同并行轴「换一种堆法」，
 * 靠飞行动画在 物理 / TP / PP / DP / EP 视图间重排，状态热力叠在上面。核心价值当场可见——
 * 「注入异常」把某个并行组标红：物理视图里它散成一片，切到对应并行视图它 snap 成一整块，
 * 「异常的形状」直接对应根因类别（方案 §9.1）。
 *
 * 铁律：切视图（结构）改的是「位置」；时间/状态改的是「颜色」——两者不串台。
 * 几何全部来自已验证的 layout.ts（双射不变量），配色来自 data.ts 的 loadRGB（红黄绿=状态唯一色）。
 * 逻辑视图里不画物理刀片/机柜脚手架（那在逻辑重排里没有意义）——只画卡本身。
 */
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewcube } from '@react-three/drei';
import * as THREE from 'three';
import {
  GENERATIONS, NODES_PER_CAB, loadRGB, loadState, stateColor, STATE_LABELS, cardLoad01, parallelMap, PARALLEL_COLORS,
  type Gen, type ViewSync, type ParallelWorkload, type ParDim,
} from '../scene/data';
import { layoutOf, LAYOUT_VIEWS, LAYOUT_LABEL, type LayoutView } from '../scene/layout';
import { deploymentOf } from '../scene/deployment';
import { SceneVisualProfileContext, sceneSurface } from '../scene/visual-profile';

const PITCH = 0.42;                    // 每格世界尺寸
const BOX = 0.72 * PITCH;              // 卡块边长（略小于格，留缝）
const MONO = "'JetBrains Mono','Consolas',ui-monospace,monospace";

type AnomalyDim = 'none' | 'tp' | 'pp' | 'dp' | 'ep';
const ANOM_LABEL: Record<AnomalyDim, string> = { none: '无', tp: 'TP 组', pp: 'PP 级', dp: 'DP 副本', ep: 'EP 组' };

// ── 卡阵列（唯一被重排的对象）：位置来自 layout（飞行动画 lerp），颜色来自负载场（逐 step 重染） ──
//    拾取：instanceId == rank；选中/悬停高亮跟随卡的实时(动画中)位置。
function CubeField({ cells, loadOf, recolorKey, onSettleChange, selected, hover, onPick, onHover }: {
  cells: { x: number; z: number }[]; loadOf: (k: number) => number; recolorKey: number;
  onSettleChange?: (settling: boolean) => void;
  selected: number | null; hover: number | null;
  onPick: (rank: number | null) => void; onHover: (rank: number | null) => void;
}) {
  const N = cells.length;
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const selRef = useRef<THREE.Mesh>(null);
  const hovRef = useRef<THREE.Mesh>(null);
  const cur = useRef<{ x: Float32Array; z: Float32Array } | null>(null);
  const target = useRef(cells);
  const settling = useRef(true);
  if (!cur.current || cur.current.x.length !== N) {
    const x = new Float32Array(N), z = new Float32Array(N);
    for (let k = 0; k < N; k++) { x[k] = cells[k].x * PITCH; z[k] = cells[k].z * PITCH; }
    cur.current = { x, z };
  }
  // 视图切换 → 新目标位置，开始飞行
  useEffect(() => { target.current = cells; settling.current = true; onSettleChange?.(true); }, [cells, onSettleChange]);

  // 每帧：高亮跟随实时位置（始终）+ 位置 lerp 向目标（稳定后停写省 CPU）
  const m = useMemo(() => new THREE.Matrix4(), []);
  useFrame(() => {
    const mesh = meshRef.current, c = cur.current; if (!mesh || !c) return;
    const place = (ref: React.RefObject<THREE.Mesh>, idx: number | null) => {
      if (!ref.current) return;
      if (idx == null || idx < 0 || idx >= N) { ref.current.visible = false; return; }
      ref.current.visible = true; ref.current.position.set(c.x[idx], 0, c.z[idx]);
    };
    place(selRef, selected); place(hovRef, hover === selected ? null : hover);
    if (!settling.current) return;
    let moving = false;
    for (let k = 0; k < N; k++) {
      const tx = target.current[k].x * PITCH, tz = target.current[k].z * PITCH;
      const nx = c.x[k] + (tx - c.x[k]) * 0.16, nz = c.z[k] + (tz - c.z[k]) * 0.16;
      if (Math.abs(tx - nx) > 0.004 || Math.abs(tz - nz) > 0.004) moving = true;
      c.x[k] = nx; c.z[k] = nz;
      m.makeScale(BOX, 0.16, BOX); m.setPosition(nx, 0, nz); mesh.setMatrixAt(k, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (!moving) { settling.current = false; onSettleChange?.(false); }
  });

  // 颜色：负载 → 红黄绿（loadRGB）。step / 异常 / 视图变化时重染一次。
  useEffect(() => {
    const mesh = meshRef.current; if (!mesh) return;
    const col = new THREE.Color();
    for (let k = 0; k < N; k++) { const [r, g, b] = loadRGB(loadOf(k)); mesh.setColorAt(k, col.setRGB(r / 255, g / 255, b / 255)); }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recolorKey, N]);

  return (
    <>
      <instancedMesh
        ref={meshRef} args={[undefined, undefined, N]} frustumCulled={false}
        onClick={(e) => { e.stopPropagation(); onPick(e.instanceId ?? null); }}
        onPointerMove={(e) => { e.stopPropagation(); if (e.instanceId !== undefined && e.instanceId !== hover) onHover(e.instanceId); }}
        onPointerOut={() => onHover(null)}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial metalness={0.02} roughness={0.78} />
      </instancedMesh>
      {/* 选中高亮：软件靛色线框（选中的是一个 rank = 软件对象），比卡略大以包住 */}
      <mesh ref={selRef} visible={false} raycast={() => null}>
        <boxGeometry args={[BOX * 1.5, 0.28, BOX * 1.5]} />
        <meshBasicMaterial color="#4369ef" wireframe transparent opacity={0.95} />
      </mesh>
      {/* 悬停高亮：更淡 */}
      <mesh ref={hovRef} visible={false} raycast={() => null}>
        <boxGeometry args={[BOX * 1.35, 0.24, BOX * 1.35]} />
        <meshBasicMaterial color="#8ba3f2" wireframe transparent opacity={0.6} />
      </mesh>
    </>
  );
}

// 相机随当前视图的网格尺寸自适应取景（PP 视图很高/很窄也能装下）
function FrameField({ cols, rows, controls }: {
  cols: number; rows: number; controls: React.MutableRefObject<{ target: THREE.Vector3; update: () => void } | null>;
}) {
  const { camera, size } = useThree();
  const init = useRef(false);
  const settling = useRef(true);
  const worldH = useMemo(() => Math.max(cols, rows) * PITCH * 1.18 + 2.4, [cols, rows]);
  useEffect(() => { settling.current = true; }, [cols, rows]);
  useEffect(() => {
    if (init.current || size.height < 10) return; init.current = true;
    camera.position.set(1, 0.9, 1).normalize().multiplyScalar(Math.max(cols, rows) * PITCH * 1.4 + 8);
    camera.up.set(0, 1, 0); camera.updateProjectionMatrix();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.height]);
  useFrame(() => {
    if (!settling.current || size.height < 10) return;
    const oc = camera as THREE.OrthographicCamera;
    if (controls.current) { controls.current.target.lerp(new THREE.Vector3(0, 0, 0), 0.15); controls.current.update(); }
    const want = size.height / worldH;
    if (oc.isOrthographicCamera) { oc.zoom += (want - oc.zoom) * 0.15; oc.updateProjectionMatrix(); if (Math.abs(oc.zoom - want) < 0.04) settling.current = false; }
  });
  return null;
}

// ── shared button language (matches ClusterView/StatusView) ──
const SECONDARY: React.CSSProperties = { border: '1px solid var(--button-secondary-border)', background: 'var(--button-secondary-bg)', color: 'var(--foreground-muted)' };
function navBtn(on: boolean): React.CSSProperties {
  return on ? { border: '1px solid var(--primary)', background: 'var(--primary)', color: 'var(--primary-foreground)', fontWeight: 600 } : { ...SECONDARY };
}
const btnBase: React.CSSProperties = { padding: '5px 12px', fontSize: 12, borderRadius: 8, cursor: 'pointer' };
const LBL: React.CSSProperties = { fontSize: 11, fontWeight: 500, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--tx3)', alignSelf: 'center' };

export function CubeView({ gen, dark, sync }: { gen: Gen; dark: boolean; sync?: ViewSync }) {
  const visualProfile = useContext(SceneVisualProfileContext);
  const surf = sceneSurface(dark, visualProfile);
  const N = GENERATIONS[gen].totalNpus;

  const [view, setView] = useState<LayoutView>('physical');
  // 工况：立方体重排的价值在训练(PP4·DP256·EP2 结构丰富)下最明显 → 默认 pretrain，独立于 sync。
  const [workload, setWorkload] = useState<ParallelWorkload>('pretrain');
  const [anom, setAnom] = useState<AnomalyDim>('none');
  const [stepL, setStepL] = useState(0);
  const step = sync?.step ?? stepL;
  const setStep = sync?.setStep ?? setStepL;
  const [playingL, setPlayingL] = useState(false);
  const playing = sync?.playing ?? playingL;
  const setPlaying = sync?.setPlaying ?? setPlayingL;
  const [settling, setSettling] = useState(false);
  const [sel, setSel] = useState<number | null>(null);      // 选中的 rank（点选）
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => { setSel(null); setHover(null); }, [gen]);  // 代际换 → N 变，清选区

  const controlsRef = useRef<{ target: THREE.Vector3; update: () => void } | null>(null);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setStep((s) => (s + 1) % 61), 650);
    return () => clearInterval(id);
  }, [playing, setStep]);

  const lay = useMemo(() => layoutOf(view, workload, N), [view, workload, N]);
  const pm = useMemo(() => parallelMap(workload, N), [workload, N]);
  const dep = useMemo(() => deploymentOf(workload, N), [workload, N]);   // 部署查询（正查：这张卡担任什么）
  const kind = workload === 'decode' ? 'comm' : 'compute';

  // 负载场：
  //  · 无异常 → 真实负载场（cardLoad01，真实热力）。
  //  · 注入异常（显式合成教学开关）→ 非异常卡给平静绿底、异常组给红热点，让「形状」在
  //    物理(散点)与对应维度视图(成块)里都清晰爆出——不受工况 base 负载高低影响。
  const loadOf = useMemo(() => {
    return (k: number): number => {
      if (anom !== 'none') return pm.groupOf(k, anom as ParDim) === 0 ? 0.93 : 0.2 + ((k % 7) / 7) * 0.12;
      return cardLoad01(k, kind, step, 0, N);
    };
  }, [kind, step, N, anom, pm]);
  const recolorKey = useMemo(() => step * 100 + LAYOUT_VIEWS.indexOf(view) * 7 + ({ none: 0, tp: 1, pp: 2, dp: 3, ep: 4 } as Record<AnomalyDim, number>)[anom], [step, view, anom]);

  const shell: React.CSSProperties = { position: 'absolute', inset: 0, zIndex: 11, display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--tx)' };
  const card: React.CSSProperties = { background: 'var(--panel)', border: '1px solid var(--bd)', borderRadius: 11, boxShadow: 'var(--shadow-sm)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' };

  return (
    <div style={shell}>
      {/* ── toolbar: 堆叠方式 / 工况 / 注入异常 / 回放 ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 12px', borderBottom: '1px solid var(--bd)', flexWrap: 'wrap', background: 'var(--panel-solid)' }}>
        <span style={LBL}>堆叠方式</span>
        <div style={{ display: 'flex', gap: 3 }}>
          {LAYOUT_VIEWS.map((v) => (
            <button key={v} onClick={() => setView(v)} style={{ ...btnBase, ...navBtn(view === v) }}>{LAYOUT_LABEL[v]}</button>
          ))}
        </div>
        <span style={{ ...LBL, marginLeft: 6 }}>工况</span>
        <div style={{ display: 'flex', gap: 3 }}>
          {([['pretrain', '预训练'], ['decode', 'Decode']] as [ParallelWorkload, string][]).map(([w, l]) => (
            <button key={w} onClick={() => setWorkload(w)} style={{ ...btnBase, ...navBtn(workload === w) }}>{l}</button>
          ))}
        </div>
        <span style={{ ...LBL, marginLeft: 6 }}>注入异常</span>
        <div style={{ display: 'flex', gap: 3 }}>
          {(['none', 'tp', 'pp', 'dp', 'ep'] as AnomalyDim[]).map((d) => {
            const on = anom === d, sig = d === 'none' ? undefined : PARALLEL_COLORS[d as Exclude<ParDim, 'sp'>];
            return (
              <button key={d} onClick={() => setAnom(d)} title={d === 'none' ? '不注入' : `把 ${ANOM_LABEL[d]}0 标红，看它在不同堆法下的形状`}
                style={{ ...btnBase, display: 'inline-flex', alignItems: 'center', gap: 5, ...(on ? { border: `1px solid ${sig ?? 'var(--primary)'}`, background: sig ?? 'var(--primary)', color: '#fff', fontWeight: 600 } : SECONDARY) }}>
                {sig && <span style={{ width: 8, height: 8, borderRadius: 2, background: on ? '#fff' : sig }} />}{ANOM_LABEL[d]}
              </button>
            );
          })}
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => setPlaying((p) => !p)} style={{ ...btnBase, ...navBtn(playing) }}>{playing ? '暂停' : '▶ 回放'}</button>
        <input type="range" min={0} max={60} value={step} onChange={(e) => setStep(Number(e.target.value))} style={{ width: 150 }} aria-label="时间" />
        <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--tx2)', width: 46 }}>t={step}</span>
      </div>

      {/* ── 3D 立方阵 ── */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <Canvas
          orthographic dpr={[1, 2]}
          camera={{ position: [40, 34, 40], zoom: 12, near: 0.1, far: 4000 }}
          gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1, powerPreference: 'high-performance' }}
          onCreated={({ gl }) => { gl.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault(), false); }}
          onPointerMissed={() => setSel(null)}
        >
          <color attach="background" args={[surf.background]} />
          <hemisphereLight intensity={surf.ambient} groundColor={dark ? '#10131a' : '#e8edf4'} />
          <directionalLight position={[8, 14, 6]} intensity={surf.key} />
          <directionalLight position={[-8, 8, -10]} intensity={surf.fill} />
          <FrameField cols={lay.cols} rows={lay.rows} controls={controlsRef} />
          <CubeField cells={lay.pos} loadOf={loadOf} recolorKey={recolorKey} onSettleChange={setSettling}
            selected={sel} hover={hover} onPick={setSel} onHover={setHover} />
          <OrbitControls
            ref={controlsRef as never} makeDefault enableDamping dampingFactor={0.08}
            minPolarAngle={0} maxPolarAngle={Math.PI / 2} minDistance={2} maxDistance={600}
            mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }}
          />
          <GizmoHelper alignment="bottom-left" margin={[64, 80]}>
            <GizmoViewcube faces={['Right', 'Left', 'Top', 'Bottom', 'Front', 'Back']}
              color={dark ? '#2a2e36' : '#eef1f6'} hoverColor="#4369ef"
              textColor={dark ? '#e6e6e6' : '#1c2433'} strokeColor={dark ? '#4a5160' : '#aab4c4'} opacity={0.95} />
          </GizmoHelper>
        </Canvas>

        {/* 视图说明 + 状态图例 */}
        <div style={{ position: 'absolute', left: 12, top: 12, ...card, padding: '9px 12px', maxWidth: 340, pointerEvents: 'none' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 3 }}>{LAYOUT_LABEL[view]}<span style={{ color: 'var(--tx3)', fontWeight: 400, fontFamily: MONO, marginLeft: 8 }}>{lay.cols}×{lay.rows}{settling ? ' · 重排中…' : ''}</span></div>
          <div style={{ fontSize: 10.5, color: 'var(--tx2)', lineHeight: 1.5 }}>{lay.note}</div>
          {anom !== 'none' && (
            <div style={{ fontSize: 10.5, color: 'var(--tx2)', lineHeight: 1.5, marginTop: 5, borderTop: '1px solid var(--bd)', paddingTop: 5 }}>
              已注入 <b style={{ color: 'var(--tx)' }}>{ANOM_LABEL[anom]}0</b> 异常 · 切到 <b style={{ color: 'var(--tx)' }}>{ANOM_LABEL[anom].slice(0, 2)} 视图</b> 看它 snap 成一整块（散点=物理散布 · 成块=沿该维成组）
            </div>
          )}
        </div>
        <div style={{ position: 'absolute', right: sel != null ? 288 : 12, bottom: 12, ...card, padding: '8px 11px', display: 'flex', gap: 10, pointerEvents: 'none' }}>
          {STATE_LABELS.map((lb, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9.5, color: 'var(--tx2)' }}><span style={{ width: 9, height: 9, borderRadius: 2, background: stateColor(i) }} />{lb}</span>
          ))}
        </div>

        {/* 部署查询详情栏（反查：点一张卡 → 它担任什么并行角色 + 物理位置） */}
        {sel != null && (() => {
          const phys = dep.physOf(sel), u = loadOf(sel), st = loadState(u);
          const roleLbl: Record<string, string> = { tp: '张量切片 TP', pp: '流水级 PP', dp: '数据副本 DP', ep: '专家组 EP' };
          const roles = dep.rolesOf(sel).filter((r) => r.dim !== 'sp');
          const row = (label: string, val: string) => (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, margin: '3px 0' }}><span style={{ color: 'var(--tx2)' }}>{label}</span><span style={{ fontFamily: MONO, color: 'var(--tx)' }}>{val}</span></div>
          );
          return (
            <div style={{ position: 'absolute', right: 12, top: 12, bottom: 12, width: 264, ...card, padding: '13px 14px', overflowY: 'auto', pointerEvents: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, fontFamily: MONO, color: '#4369ef' }}>rank {sel}</span>
                <button onClick={() => setSel(null)} style={{ ...btnBase, padding: '2px 8px', ...SECONDARY }}>✕</button>
              </div>
              <div style={{ fontSize: 9.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--tx3)', margin: '2px 0 4px' }}>物理位置（部署在哪台机器）</div>
              {row('Pod', 'α')}
              {row('机柜（物理分组）', `C${phys.cabinet}`)}
              {row('Host · 节点', `${phys.host}（柜内 ${phys.host % NODES_PER_CAB}）`)}
              {row('卡槽 slot', `${phys.slot} / 8`)}
              <div style={{ fontSize: 9.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--tx3)', margin: '11px 0 5px', borderTop: '1px solid var(--bd)', paddingTop: 9 }}>并行角色（担任什么任务）· {pm.cfg}</div>
              {roles.map((r) => {
                const c = PARALLEL_COLORS[r.dim as Exclude<ParDim, 'sp'>];
                return (
                  <div key={r.dim} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, margin: '4px 0' }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: c, flexShrink: 0 }} />
                    <span style={{ color: 'var(--tx2)', flex: 1 }}>{roleLbl[r.dim]}</span>
                    <span style={{ fontFamily: MONO, color: 'var(--tx)' }}>{r.group} / {r.degree}</span>
                  </div>
                );
              })}
              <div style={{ fontSize: 9.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--tx3)', margin: '11px 0 5px', borderTop: '1px solid var(--bd)', paddingTop: 9 }}>当前状态</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: stateColor(st) }} />
                <span style={{ color: 'var(--tx)' }}>{STATE_LABELS[st]}</span>
                <span style={{ marginLeft: 'auto', fontFamily: MONO, color: 'var(--tx2)' }}>{Math.round(u * 100)}%</span>
              </div>
              <div style={{ fontSize: 9.5, color: 'var(--tx3)', lineHeight: 1.5, marginTop: 11, borderTop: '1px solid var(--bd)', paddingTop: 8 }}>
                反查（deployment.rolesOf）：一张卡同时担任多个并行角色。切换堆叠方式看它在不同维度下与谁成组。
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

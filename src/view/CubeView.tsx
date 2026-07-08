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
import { OP_SCHEDULE, phaseMix, flowLayout, opAtCursor, pipeline1F1B, type OpKind } from '../scene/op-schedule';
import { SceneVisualProfileContext, sceneSurface } from '../scene/visual-profile';

const PITCH = 0.42;                    // 每格世界尺寸
const BOX = 0.72 * PITCH;              // 卡块边长（略小于格，留缝）
const MONO = "'JetBrains Mono','Consolas',ui-monospace,monospace";
// 算子 kind → 色（与 STEP_DECOMP 一致：计算青 / 通信红 / 访存紫）
const OP_COL: Record<OpKind, string> = { compute: '#22d3ee', comm: '#ff4b7b', mem: '#a78bfa' };
const OP_KIND_LBL: Record<OpKind, string> = { compute: '计算', comm: '通信', mem: '访存' };

type AnomalyDim = 'none' | 'tp' | 'pp' | 'dp' | 'ep';
const ANOM_LABEL: Record<AnomalyDim, string> = { none: '无', tp: 'TP 组', pp: 'PP 级', dp: 'DP 副本', ep: 'EP 组' };
// 每个维度的异常「真实语义 + 物理形状」——诚实区分「散布维(re-layout 必需)」与「结构维(物理已有结构)」。
const ANOM_TYPE: Record<Exclude<AnomalyDim, 'none'>, { scatter: '散布维' | '结构维'; tag: string }> = {
  pp: { scatter: '散布维', tag: 're-layout 必需' },
  ep: { scatter: '散布维', tag: 're-layout 必需' },
  tp: { scatter: '结构维', tag: '物理已有结构' },
  dp: { scatter: '结构维', tag: '物理已有结构' },
};
const ANOM_NOTE: Record<Exclude<AnomalyDim, 'none'>, string> = {
  pp: 'PP 级 0 = 每 PP 台 Host 的同一流水级 · 物理散成条纹 → 切 PP 视图 snap 成一整条竖板。散布维,不重排几乎看不出成组。',
  ep: 'EP 组 0 = 一个专家 All-to-All 域 · 物理散布 → 切 EP 视图 snap 成一条带。散布维,不重排看不出成组。',
  tp: 'TP 切片 0 = 每台 Host 的第 0 张卡(片内张量分片相同)· 均匀点阵散布 → TP 视图里是规则点阵。结构维:TP 是 Host 内 8 卡并行,故障多为局部,物理视图已能定位。',
  dp: 'DP 副本 0 = 连续几台 Host 的一份模型拷贝 · 物理半聚集 → DP 视图里是干净一块。结构维:物理已有块状结构,重排只是更规整。',
};

// ── 卡阵列（唯一被重排的对象）：位置来自 layout（飞行动画 lerp），颜色来自负载场（逐 step 重染） ──
//    拾取：instanceId == rank；选中/悬停高亮跟随卡的实时(动画中)位置。
const PEER_MAX = 96;   // 对端高亮上限（peersOf 采样）
function CubeField({ cells, loadOf, recolorKey, onSettleChange, selected, hover, onPick, onHover, peers, peerColor }: {
  cells: { x: number; z: number }[]; loadOf: (k: number) => number; recolorKey: number;
  onSettleChange?: (settling: boolean) => void;
  selected: number | null; hover: number | null;
  onPick: (rank: number | null) => void; onHover: (rank: number | null) => void;
  peers: number[]; peerColor: string;   // 当前通信算子下，选中卡的通信对端（流动面 → 结构面）
}) {
  const N = cells.length;
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const selRef = useRef<THREE.Mesh>(null);
  const hovRef = useRef<THREE.Mesh>(null);
  const peerRef = useRef<THREE.InstancedMesh>(null);
  const m2 = useMemo(() => new THREE.Matrix4(), []);
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
    // 对端高亮：跟随各对端卡的实时位置（每帧）
    const pm2 = peerRef.current;
    if (pm2) {
      const n = Math.min(peers.length, PEER_MAX);
      for (let i = 0; i < n; i++) { const k = peers[i]; if (k < 0 || k >= N) continue; m2.makeScale(BOX * 1.7, 0.34, BOX * 1.7); m2.setPosition(c.x[k], 0.02, c.z[k]); pm2.setMatrixAt(i, m2); }
      pm2.count = n; pm2.instanceMatrix.needsUpdate = true;
    }
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
      {/* 通信对端高亮：当前通信算子下，选中卡正在与之通信的卡（并行维签名色线框） */}
      <instancedMesh ref={peerRef} args={[undefined, undefined, PEER_MAX]} frustumCulled={false} raycast={() => null}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color={peerColor} wireframe transparent opacity={0.9} />
      </instancedMesh>
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

// ── 泳道（流动面·P2）：一个 step 内的有序算子（op-schedule 真实序列，锚定 arXiv:2505.21411）。
//    x = 关键路径累计时长；三轨 计算/通信/访存；overlapBg 的算子上方叠「背景搬运」带 = 掩盖；
//    游标随 step 扫过，高亮当前算子。这就是「流动面」：结构面看位置，这里看时间。
function Swimlane({ workload, step }: { workload: ParallelWorkload; step: number }) {
  const sched = OP_SCHEDULE[workload];
  const fl = flowLayout(workload);
  const mix = phaseMix(workload);
  const cursor = (step % 61) / 60;
  const LANES: OpKind[] = ['compute', 'comm', 'mem'];
  const LANE_H = 22, GAP = 4, BG_H = 15, TL_H = LANES.length * (LANE_H + GAP);
  const hasBg = fl.hidden.length > 0 || fl.bgBand;
  const topPad = hasBg ? BG_H + 3 : 0;
  const phLbl = workload === 'decode' ? 'Decode' : workload === 'prefill' ? 'Prefill' : '预训练';

  return (
    <div style={{ padding: '8px 12px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>算子泳道 · {phLbl} <span style={{ fontSize: 10.5, color: 'var(--tx3)', fontWeight: 400 }}>一层内 · {sched.bound === 'memory' ? '访存受限' : '计算受限'}</span></span>
        <span style={{ fontSize: 10.5, fontFamily: MONO, color: 'var(--tx2)' }}>
          计算 {Math.round(mix.compute * 100)}% · 通信 {Math.round(mix.comm * 100)}% · 访存 {Math.round(mix.mem * 100)}%
        </span>
        {/* 监控靶子：暴露通信(浪费墙钟) vs 掩盖(藏在计算下) */}
        <span style={{ fontSize: 10.5, fontFamily: MONO, display: 'inline-flex', gap: 10 }}>
          <span style={{ color: '#ff4b7b' }}>暴露通信 {Math.round(fl.exposedComm * 100)}%</span>
          <span style={{ color: 'var(--tx3)' }}>掩盖 {Math.round(fl.hiddenFrac * 100)}%</span>
        </span>
        <span style={{ fontSize: 9.5, color: 'var(--tx3)', marginLeft: 'auto' }}>{sched.src}</span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {/* 左侧轨道名 */}
        <div style={{ width: 44, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: GAP, paddingTop: topPad }}>
          {LANES.map((k) => (
            <div key={k} style={{ height: LANE_H, display: 'flex', alignItems: 'center', fontSize: 10, color: OP_COL[k], fontWeight: 600 }}>{OP_KIND_LBL[k]}</div>
          ))}
        </div>
        {/* 时间轴（关键路径 = wall-clock；掩盖带叠在计算之上） */}
        <div style={{ position: 'relative', flex: 1, height: TL_H + topPad }}>
          {/* 掩盖带：被计算盖住的通信/访存 + 背景搬运（不占 wall-clock，虚线表示藏在下方计算里） */}
          {fl.bgBand && (
            <div title={fl.bgBand.note} style={{ position: 'absolute', left: `${fl.bgBand.x * 100}%`, width: `${fl.bgBand.w * 100}%`, top: 0, height: BG_H, borderRadius: 3, background: `${OP_COL.mem}44`, border: `1px dashed ${OP_COL.mem}`, fontSize: 8, color: 'var(--tx2)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              {fl.bgBand.name} · 掩盖
            </div>
          )}
          {fl.hidden.map((h) => (
            <div key={h.op.id} title={`${h.op.name} · ${h.op.note}（被计算掩盖，不占墙钟）`} style={{ position: 'absolute', left: `${h.x * 100}%`, width: `${h.w * 100}%`, top: 0, height: BG_H, borderRadius: 3, background: `${OP_COL[h.op.kind]}44`, border: `1px dashed ${OP_COL[h.op.kind]}`, fontSize: 8, color: 'var(--tx2)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              {h.op.name} · 掩盖
            </div>
          ))}
          {/* 轨道底 */}
          {LANES.map((k, li) => (
            <div key={k} style={{ position: 'absolute', left: 0, right: 0, top: topPad + li * (LANE_H + GAP), height: LANE_H, background: 'var(--btn)', borderRadius: 4 }} />
          ))}
          {/* 关键路径算子条；暴露的通信标红边 */}
          {fl.placed.map(({ op, x, w }) => {
            const li = LANES.indexOf(op.kind);
            const active = cursor >= x && cursor < x + w;
            const exposed = op.kind === 'comm';   // 关键路径上的通信 = 暴露开销
            return (
              <div key={op.id} title={`${op.name} · ${op.note}${exposed ? '（暴露：占墙钟）' : ''}`}
                style={{ position: 'absolute', left: `${x * 100}%`, width: `calc(${w * 100}% - 2px)`, top: topPad + li * (LANE_H + GAP), height: LANE_H, background: OP_COL[op.kind], borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', fontSize: 9, fontWeight: 600, color: '#0b0f16', whiteSpace: 'nowrap', border: exposed ? '2px solid #b3003b' : 'none', boxShadow: active ? `0 0 0 2px var(--tx)` : 'none', opacity: active ? 1 : 0.92 }}>
                {w > 0.05 ? op.name : ''}
              </div>
            );
          })}
          {/* 时间游标 */}
          <div style={{ position: 'absolute', left: `${cursor * 100}%`, top: 0, bottom: 0, width: 2, background: 'var(--tx)', opacity: 0.75 }} />
        </div>
      </div>
    </div>
  );
}

// ── 算子图（P3·算子整网）：一层内算子 DAG，Attention/MoE 分块 + 残差，标每个算子用哪种并行；
//   当前算子（游标）高亮 → 回答「这张卡此刻在算哪个算子」。结构面看位置、流动面看时间、这里看结构。 ──
function opDim(id: string, coll?: string): string | null {
  if (coll === 'a2a') return 'EP'; if (coll === 'ring') return 'DP'; if (coll === 'p2p') return 'PP';
  if (/qkv|attn|oproj/i.test(id)) return 'TP'; if (/gmm|expert/i.test(id)) return 'EP·TP';
  if (/^fwd|^bwd/i.test(id)) return '全部'; return null;
}
function OperatorGraph({ workload, step }: { workload: ParallelWorkload; step: number }) {
  const ops = OP_SCHEDULE[workload].ops;
  const cur = opAtCursor(workload, (step % 61) / 60);
  const fine = ops.length > 5;   // 推理层有细算子 → 分 Attention/MoE 块；训练粗算子 → 平铺
  // 分块：Attention = 到 oproj 为止；MoE = router 起
  const moeStart = ops.findIndex((o) => /router/i.test(o.id));
  const attn = fine && moeStart > 0 ? ops.slice(0, moeStart) : ops;
  const moe = fine && moeStart > 0 ? ops.slice(moeStart) : [];
  const node = (o: typeof ops[number]) => {
    const on = o.id === cur.id, dim = opDim(o.id, o.coll);
    return (
      <div key={o.id} title={o.note} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flexShrink: 0 }}>
        <div style={{ padding: '5px 9px', borderRadius: 7, background: on ? OP_COL[o.kind] : `${OP_COL[o.kind]}22`, border: `1.5px solid ${OP_COL[o.kind]}`, color: on ? '#0b0f16' : 'var(--tx)', fontSize: 10.5, fontWeight: on ? 700 : 500, boxShadow: on ? '0 0 0 3px color-mix(in srgb, var(--tx) 30%, transparent)' : 'none', whiteSpace: 'nowrap', position: 'relative' }}>
          {on && <span style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', fontSize: 8, color: 'var(--tx)', fontWeight: 700 }}>▶ 此刻</span>}
          {o.name}
        </div>
        {dim && <span style={{ fontSize: 8, fontFamily: MONO, color: 'var(--tx3)' }}>{dim}</span>}
      </div>
    );
  };
  const arrow = <span style={{ color: 'var(--tx3)', fontSize: 12, flexShrink: 0 }}>→</span>;
  const block = (title: string, list: typeof ops, color: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, border: `1px dashed ${color}66`, borderRadius: 9, padding: '14px 10px 8px', position: 'relative', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: -8, left: 10, fontSize: 9, fontWeight: 700, color, background: 'var(--panel-solid)', padding: '0 5px' }}>{title} <span style={{ color: 'var(--tx3)', fontWeight: 400 }}>+残差</span></span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{list.map((o, i) => <span key={o.id} style={{ display: 'contents' }}>{i > 0 && arrow}{node(o)}</span>)}</div>
    </div>
  );
  return (
    <div style={{ padding: '8px 12px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>算子图 · {workload === 'decode' ? 'Decode' : workload === 'prefill' ? 'Prefill' : '预训练'} <span style={{ fontSize: 10.5, color: 'var(--tx3)', fontWeight: 400 }}>一层内 DAG · {fine ? 'Attention + MoE 块' : 'Forward / Backward'}</span></span>
        <span style={{ fontSize: 10.5, fontFamily: MONO, color: OP_COL[cur.kind] }}>此刻在算: {cur.name}（{OP_KIND_LBL[cur.kind]}）</span>
        <span style={{ fontSize: 9.5, color: 'var(--tx3)', marginLeft: 'auto' }}>节点色=计算/通信/访存 · 下标=用哪种并行</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto', paddingTop: 8, paddingBottom: 2 }}>
        <div style={{ fontSize: 9.5, color: 'var(--tx3)', flexShrink: 0 }}>输入</div>{arrow}
        {fine && moe.length ? <>{block('Attention', attn, '#4369ef')}{arrow}{block('MoE 专家', moe, '#ff4b7b')}</>
          : <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{ops.map((o, i) => <span key={o.id} style={{ display: 'contents' }}>{i > 0 && arrow}{node(o)}</span>)}</div>}
        {arrow}<div style={{ fontSize: 9.5, color: 'var(--tx3)', flexShrink: 0 }}>输出</div>
      </div>
    </div>
  );
}

// ── PP 流水甘特（每级一套泳道语义之 L4）：1F1B 调度，stage 为道、microbatch 的 F/B 为格、空档=bubble。
//   掉队：某 stage 算子耗时×2 → 延迟沿依赖链传播、bubble 变大（真实模拟）。
//   VPP：交错虚拟流水，理论把 bubble 降到 ~1/v（示意；未重跑完美交错调度）。 ──
const PIPE_MB = 8;
function PipelineGantt({ stages, step, straggler, onStraggler, vpp, onVpp }: {
  stages: number; step: number; straggler: number | null; onStraggler: (s: number | null) => void; vpp: number; onVpp: (v: number) => void;
}) {
  const pipe = useMemo(() => pipeline1F1B(stages, PIPE_MB, straggler), [stages, straggler]);
  const baseBubble = useMemo(() => pipeline1F1B(stages, PIPE_MB, null).bubblePct, [stages]);
  const cursor = (step % 61) / 60;
  const curSlot = Math.floor(cursor * pipe.slots);
  const LANE_H = 20, GAP = 4;
  if (stages <= 1) {
    return <div style={{ padding: '12px 12px 14px', fontSize: 11.5, color: 'var(--tx2)', lineHeight: 1.6 }}>PP = 1 · 本工况无流水线（Decode/Prefill 单副本推理，PP 未切分）。切到 <b style={{ color: 'var(--tx)' }}>预训练</b> 工况看 1F1B 流水甘特、掉队与 VPP。</div>;
  }
  const colF = '#22d3ee', colB = '#6b8bff', w = 1 / pipe.slots;
  const vppBubble = baseBubble / vpp;
  const chip: React.CSSProperties = { ...btnBase, padding: '2px 8px', fontSize: 10.5 };
  return (
    <div style={{ padding: '8px 12px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>PP 流水甘特 · 1F1B <span style={{ fontSize: 10.5, color: 'var(--tx3)', fontWeight: 400 }}>{stages} 级 × {PIPE_MB} mb</span></span>
        <span style={{ fontSize: 10.5, fontFamily: MONO }}><span style={{ color: colF }}>F</span>·<span style={{ color: colB }}>B</span>·<span style={{ color: 'var(--tx3)' }}>空档=bubble</span></span>
        <span style={{ fontSize: 10.5, fontFamily: MONO, color: pipe.bubblePct > 0.3 ? '#ff4b7b' : 'var(--tx2)' }}>bubble {Math.round(pipe.bubblePct * 100)}%{straggler != null ? `（掉队前 ${Math.round(baseBubble * 100)}%）` : ''}</span>
        {/* 掉队注入 */}
        <span style={{ ...LBL, marginLeft: 4 }}>掉队</span>
        <button onClick={() => onStraggler(null)} style={{ ...chip, ...navBtn(straggler === null) }}>无</button>
        {pipe.lanes.map((_, s) => <button key={s} onClick={() => onStraggler(s)} style={{ ...chip, ...(straggler === s ? { border: '1px solid #ff4b7b', background: '#ff4b7b', color: '#fff', fontWeight: 600 } : SECONDARY) }}>S{s}</button>)}
        {/* VPP 交错 */}
        <span style={{ ...LBL, marginLeft: 4 }}>VPP</span>
        {[1, 2, 4].map((v) => <button key={v} onClick={() => onVpp(v)} style={{ ...chip, ...navBtn(vpp === v) }}>×{v}</button>)}
        {vpp > 1 && <span style={{ fontSize: 10, fontFamily: MONO, color: '#04d793' }}>交错 → 理论 bubble ~{Math.round(vppBubble * 100)}%</span>}
        <span style={{ fontSize: 9.5, color: 'var(--tx3)', marginLeft: 'auto' }}>schedule-simulated · 对齐 PTO 1F1B</span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ width: 52, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: GAP }}>
          {pipe.lanes.map((_, s) => <div key={s} style={{ height: LANE_H, display: 'flex', alignItems: 'center', fontSize: 10, color: straggler === s ? '#ff4b7b' : 'var(--tx2)', fontWeight: 600 }}>stage {s}{straggler === s ? ' ⚠' : ''}</div>)}
        </div>
        <div style={{ position: 'relative', flex: 1, height: pipe.stages * (LANE_H + GAP) }}>
          {pipe.lanes.map((_, s) => <div key={s} style={{ position: 'absolute', left: 0, right: 0, top: s * (LANE_H + GAP), height: LANE_H, background: straggler === s ? 'rgba(255,75,123,0.12)' : 'var(--btn)', borderRadius: 3 }} />)}
          {pipe.lanes.map((lane, s) => lane.map((c) => {
            const active = curSlot >= c.slot && curSlot < c.end, slow = straggler === s;
            // VPP>1 时按 microbatch 模 vpp 分 chunk（示意交错），色相微移
            const base = c.dir === 'F' ? colF : colB;
            return <div key={`${c.dir}${c.mb}-${c.slot}`} title={`stage ${s} · ${c.dir === 'F' ? '前向' : '后向'} · microbatch ${c.mb}${slow ? ' · 掉队(×2)' : ''}`}
              style={{ position: 'absolute', left: `${c.slot * w * 100}%`, width: `calc(${(c.end - c.slot) * w * 100}% - 1px)`, top: s * (LANE_H + GAP), height: LANE_H, background: base, opacity: vpp > 1 && c.mb % vpp !== 0 ? 0.62 : 1, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: '#0b0f16', boxShadow: active ? '0 0 0 2px var(--tx)' : 'none' }}>
              {(c.end - c.slot) * w > 0.028 ? c.mb : ''}
            </div>;
          }))}
          <div style={{ position: 'absolute', left: `${cursor * 100}%`, top: 0, bottom: 0, width: 2, background: 'var(--tx)', opacity: 0.7 }} />
        </div>
      </div>
    </div>
  );
}

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
  const [flowMode, setFlowMode] = useState<'ops' | 'pipe' | 'graph'>('ops');   // 流动面：层内算子序列 / PP 甘特 / 算子图
  const [straggler, setStraggler] = useState<number | null>(null);   // PP 甘特：掉队 stage
  const [vpp, setVpp] = useState(1);                                  // PP 甘特：VPP 交错度
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

  // ── 流动面 → 结构面：游标扫到的当前算子（与泳道共用 opAtCursor）→ 通信则高亮对端。
  //    当前算子若是计算、但其下有并发的「掩盖」通信（如 Backward 下的 DP AllReduce），也触发对端（标注掩盖）。 ──
  const cursor01 = (step % 61) / 60;
  const fl = useMemo(() => flowLayout(workload), [workload]);
  const curOp = useMemo(() => opAtCursor(workload, cursor01), [workload, cursor01]);
  const activeComm = useMemo(() => {
    if (curOp.kind === 'comm') return { op: curOp, hidden: false };
    const h = fl.hidden.find((hh) => hh.op.kind === 'comm' && cursor01 >= hh.x && cursor01 < hh.x + hh.w);
    return h ? { op: h.op, hidden: true } : null;
  }, [curOp, fl, cursor01]);
  const curDim: Exclude<ParDim, 'sp' | 'tp'> | null = activeComm
    ? (activeComm.op.coll === 'ring' ? 'dp' : activeComm.op.coll === 'p2p' ? 'pp' : 'ep') : null;
  const peers = useMemo(() => (sel != null && curDim ? dep.peersOf(sel, curDim, PEER_MAX) : []), [sel, curDim, dep, step]);
  const peerColor = curDim ? PARALLEL_COLORS[curDim] : '#4369ef';
  const dimLabel: Record<string, string> = { ep: '专家 All-to-All', dp: '数据并行 AllReduce', pp: '流水 P2P' };

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
            selected={sel} hover={hover} onPick={setSel} onHover={setHover} peers={peers} peerColor={peerColor} />
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

        {/* 当前算子横幅（流动面游标 → 结构面）：显示游标此刻在算什么；通信算子+选中卡 → 高亮对端 */}
        {(
          <div style={{ position: 'absolute', left: '50%', top: 12, transform: 'translateX(-50%)', ...card, padding: '7px 14px', pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: OP_COL[curOp.kind] }} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>{curOp.name}</span>
            <span style={{ fontSize: 10.5, color: 'var(--tx3)' }}>{OP_KIND_LBL[curOp.kind]}</span>
            {curDim && sel != null && peers.length > 0 && (
              <span style={{ fontSize: 10.5, color: peerColor, borderLeft: '1px solid var(--bd)', paddingLeft: 9 }}>
                rank {sel} · 与 {peers.length} 张卡做 {dimLabel[curDim]}
                <span style={{ color: 'var(--tx3)', marginLeft: 6 }}>{activeComm?.hidden ? '（掩盖·并发）' : '（暴露）'}</span>
              </span>
            )}
          </div>
        )}

        {/* 视图说明 + 状态图例 */}
        <div style={{ position: 'absolute', left: 12, top: 12, ...card, padding: '9px 12px', maxWidth: 340, pointerEvents: 'none' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 3 }}>{LAYOUT_LABEL[view]}<span style={{ color: 'var(--tx3)', fontWeight: 400, fontFamily: MONO, marginLeft: 8 }}>{lay.cols}×{lay.rows}{settling ? ' · 重排中…' : ''}</span></div>
          <div style={{ fontSize: 10.5, color: 'var(--tx2)', lineHeight: 1.5 }}>{lay.note}</div>
          {anom !== 'none' && (
            <div style={{ marginTop: 5, borderTop: '1px solid var(--bd)', paddingTop: 5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: '#fff', background: ANOM_TYPE[anom].scatter === '散布维' ? '#ff4b7b' : PARALLEL_COLORS[anom as Exclude<ParDim, 'sp'>], borderRadius: 3, padding: '1px 6px' }}>{ANOM_TYPE[anom].scatter}</span>
                <span style={{ fontSize: 9.5, color: 'var(--tx3)' }}>{ANOM_TYPE[anom].tag}</span>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--tx2)', lineHeight: 1.5 }}>{ANOM_NOTE[anom]}</div>
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
              <div style={{ fontSize: 9.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--tx3)', margin: '11px 0 5px', borderTop: '1px solid var(--bd)', paddingTop: 9 }}>此刻在算（t={step}）</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11 }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: OP_COL[curOp.kind], flexShrink: 0 }} />
                <span style={{ color: 'var(--tx)', fontWeight: 600 }}>{curOp.name}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--tx3)' }}>{OP_KIND_LBL[curOp.kind]}</span>
              </div>
              <div style={{ fontSize: 9.5, color: 'var(--tx3)', lineHeight: 1.5, marginTop: 9 }}>
                反查（rolesOf + opAtCursor）：这张卡此刻在算什么算子 + 它的并行角色。切「算子图」看结构、切「堆叠方式」看它与谁成组。
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── 流动面 docked 在 3D 下方：结构面看位置，这里看时间。每级一套语义：层内算子 / PP 流水甘特 ── */}
      <div style={{ flexShrink: 0, borderTop: '1px solid var(--bd)', background: 'var(--panel-solid)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px 0' }}>
          <span style={LBL}>流动面</span>
          {([['ops', '层内算子'], ['pipe', 'PP 流水甘特'], ['graph', '算子图']] as [typeof flowMode, string][]).map(([m, l]) => (
            <button key={m} onClick={() => setFlowMode(m)} style={{ ...btnBase, padding: '3px 10px', ...navBtn(flowMode === m) }}>{l}</button>
          ))}
          <span style={{ fontSize: 9.5, color: 'var(--tx3)', marginLeft: 6 }}>{flowMode === 'ops' ? '一层内算子时序 · 掩盖/暴露' : flowMode === 'pipe' ? 'L4 · PP stage × microbatch · 1F1B bubble' : '算子 DAG 结构 · 此刻在算哪个算子'}</span>
        </div>
        {flowMode === 'ops' ? <Swimlane workload={workload} step={step} />
          : flowMode === 'pipe' ? <PipelineGantt stages={pm.pp} step={step} straggler={straggler} onStraggler={setStraggler} vpp={vpp} onVpp={setVpp} />
          : <OperatorGraph workload={workload} step={step} />}
      </div>
    </div>
  );
}

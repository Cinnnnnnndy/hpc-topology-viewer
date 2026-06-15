/**
 * ClusterView — interactive 3D model of a large-scale HPC cluster (standalone view).
 *
 * Three-level drill-down + topology:
 *   overview (16 cabinets) → cabinet view (power / blade / cooling) → node view
 *   interconnect topology (48 nodes × 7 planes, two-tier Clos)
 *
 * Fully procedural modeling (no GLB). Display text with product/brand terms is
 * sourced from ../content (decoded at runtime); this file carries no plaintext
 * product names.
 */
import { useCallback, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  RACKS, INFO, SOURCES, SPEC, UB_PLANE_COLORS, RDMA_COLOR, VPC_COLOR,
  type RackInfo, type ViewMode,
} from '../scene/data';
import { TOK, FOOTNOTE } from '../content';
import { OverviewScene, RackScene, NodeScene, TopologyScene } from '../scene/scenes';

// initial camera position + look-at per view mode
const CAMERA: Record<ViewMode, { pos: [number, number, number]; target: [number, number, number] }> = {
  overview: { pos: [7.5, 5.5, 9.5], target: [0, 1.0, 0] },
  rack:     { pos: [4.6, 4.4, 8.6], target: [0, 2.8, 0] },
  node:     { pos: [2.4, 2.6, 3.0], target: [0, 0.5, 0] },
  topology: { pos: [0, 9, 14], target: [0, 2.8, 0] },
};

const MODE_TABS: { id: ViewMode; label: string }[] = [
  { id: 'overview', label: '全景总览' },
  { id: 'rack',     label: '机柜视图' },
  { id: 'node',     label: '节点视图' },
  { id: 'topology', label: '互联拓扑' },
];

export function ClusterView() {
  const [mode, setMode] = useState<ViewMode>('overview');
  const [rack, setRack] = useState<RackInfo>(RACKS.find((r) => r.kind === 'compute')!);
  const [nodeSlot, setNodeSlot] = useState(0);
  const [hoverInfo, setHoverInfo] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [nodeSubMode, setNodeSubMode] = useState<'compute' | 'ubswitch'>('compute');

  const onHoverInfo = useCallback((t: string | null) => setHoverInfo(t), []);

  const infoKey =
    mode === 'overview' ? 'overview' :
    mode === 'rack' ? (rack.kind === 'compute' ? 'computeRack' : 'switchRack') :
    mode === 'node' ? 'node' : 'topology';
  const info = INFO[infoKey];

  const breadcrumb: { label: string; onClick?: () => void }[] = [
    { label: TOK.supernode, onClick: mode !== 'overview' ? () => setMode('overview') : undefined },
  ];
  if (mode === 'rack' || mode === 'node') {
    breadcrumb.push({ label: rack.label, onClick: mode === 'node' ? () => setMode('rack') : undefined });
  }
  if (mode === 'node') {
    breadcrumb.push({ label: `节点 ${nodeSlot + 1}` });
  }

  const cam = CAMERA[mode];

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#f5f5f5', color: 'rgba(0,0,0,0.90)' }}>
      {/* ── toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 14px', borderBottom: '1px solid rgba(0,0,0,0.12)', flexWrap: 'wrap', background: 'white' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {MODE_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setMode(t.id)}
              style={{
                padding: '5px 14px', fontSize: 12, borderRadius: 5, cursor: 'pointer',
                border: `1px solid ${mode === t.id ? '#4369ef' : 'rgba(0,0,0,0.12)'}`,
                background: mode === t.id ? 'rgba(67,105,239,0.10)' : 'transparent',
                color: mode === t.id ? '#4369ef' : 'rgba(0,0,0,0.55)',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {/* node sub-mode switch */}
        {mode === 'node' && (
          <div style={{ display: 'flex', gap: 4, borderLeft: '1px solid rgba(0,0,0,0.12)', paddingLeft: 12 }}>
            {[{ id: 'compute', label: '计算节点' }, { id: 'ubswitch', label: `${TOK.ub}总线设备` }].map((t) => (
              <button key={t.id} onClick={() => setNodeSubMode(t.id as 'compute' | 'ubswitch')} style={{
                padding: '4px 12px', fontSize: 11.5, borderRadius: 4, cursor: 'pointer',
                border: `1px solid ${nodeSubMode === t.id ? '#4369ef' : 'rgba(0,0,0,0.12)'}`,
                background: nodeSubMode === t.id ? 'rgba(67,105,239,0.10)' : 'transparent',
                color: nodeSubMode === t.id ? '#4369ef' : 'rgba(0,0,0,0.55)',
              }}>{t.label}</button>
            ))}
          </div>
        )}
        {/* breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
          {breadcrumb.map((b, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {i > 0 && <span style={{ color: 'rgba(0,0,0,0.42)' }}>›</span>}
              <span
                onClick={b.onClick}
                style={b.onClick ? { cursor: 'pointer', color: '#4369ef' } : { color: 'rgba(0,0,0,0.75)' }}
              >
                {b.label}
              </span>
            </span>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.55)' }}>{`${SPEC.name} · 384× ${TOK.n910c} · ${TOK.ub} UB 全互联`}</span>
        <button
          onClick={() => setPanelOpen((v) => !v)}
          style={{ padding: '4px 10px', fontSize: 12, borderRadius: 5, cursor: 'pointer', border: '1px solid rgba(0,0,0,0.12)', background: 'transparent', color: 'rgba(0,0,0,0.55)' }}
        >
          {panelOpen ? '收起信息 ▸' : '◂ 信息面板'}
        </button>
      </div>

      {/* ── main: Canvas + info panel ── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <Canvas
            key={mode}    /* reset camera + controls on view switch */
            camera={{ position: cam.pos, fov: 42 }}
            shadows
            dpr={[1, 2]}
            gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
            onCreated={({ gl }) => { gl.shadowMap.type = THREE.PCFSoftShadowMap; }}
          >
            <color attach="background" args={['#f5f5f5']} />
            <fog attach="fog" args={['#f5f5f5', 22, 46]} />
            <ambientLight intensity={1.1} />
            <directionalLight
              position={[8, 12, 6]}
              intensity={1.2}
              castShadow
              shadow-mapSize={[2048, 2048]}
              shadow-camera-left={-12} shadow-camera-right={12}
              shadow-camera-top={12} shadow-camera-bottom={-12}
            />
            <pointLight position={[0, 8, 0]} intensity={1.0} color="#e8f0ff" />

            {mode === 'overview' && (
              <OverviewScene
                onHoverInfo={onHoverInfo}
                onSelectRack={(r) => { setRack(r); setMode('rack'); }}
              />
            )}
            {mode === 'rack' && (
              <RackScene
                rack={rack}
                onHoverInfo={onHoverInfo}
                onSelectNode={(slot) => { setNodeSlot(slot); setMode('node'); }}
              />
            )}
            {mode === 'node' && <NodeScene onHoverInfo={onHoverInfo} nodeType={nodeSubMode} />}
            {mode === 'topology' && <TopologyScene onHoverInfo={onHoverInfo} />}

            <OrbitControls
              target={cam.target}
              enableDamping
              dampingFactor={0.08}
              minPolarAngle={0.1}
              maxPolarAngle={Math.PI / 2 - 0.04}
              minDistance={1.2}
              maxDistance={30}
            />
          </Canvas>

          {/* hover info bar */}
          {hoverInfo && (
            <div style={{
              position: 'absolute', left: 14, bottom: 14, maxWidth: '70%',
              padding: '7px 12px', fontSize: 12.5, lineHeight: 1.5,
              background: 'rgba(255,255,255,0.95)', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 6,
              color: 'rgba(0,0,0,0.90)', pointerEvents: 'none',
            }}>
              {hoverInfo}
            </div>
          )}

          {/* color legend: 7 colors = 7 planes (shown in every view) */}
          <div style={{
            position: 'absolute', right: 14, bottom: 14, padding: '8px 12px', fontSize: 11.5,
            background: 'rgba(255,255,255,0.95)', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 6,
            display: 'flex', flexDirection: 'column', gap: 4, pointerEvents: 'none',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.75)' }}>
              {`7 色 = 7 个${TOK.ub} UB 平面`}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', maxWidth: 230 }}>
              {UB_PLANE_COLORS.map((c, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <span style={{ width: 10, height: 3, background: c, display: 'inline-block', borderRadius: 1 }} />
                  <span style={{ color: 'rgba(0,0,0,0.55)' }}>P{i + 1}</span>
                </span>
              ))}
            </div>
            <div style={{ fontSize: 10.5, color: 'rgba(0,0,0,0.42)', maxWidth: 230, lineHeight: 1.5 }}>
              每个平面是一套独立的无阻塞交换网络，每颗 NPU/CPU 同时接入全部 7 个平面
            </div>
            {mode === 'topology' && (
              <div style={{ display: 'flex', gap: 10 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 10, height: 3, background: RDMA_COLOR, display: 'inline-block', borderRadius: 1 }} />
                  <span style={{ color: 'rgba(0,0,0,0.55)' }}>{`RDMA 跨${TOK.supernode}`}</span>
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 10, height: 3, background: VPC_COLOR, display: 'inline-block', borderRadius: 1 }} />
                  <span style={{ color: 'rgba(0,0,0,0.55)' }}>VPC 外网</span>
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── right info panel ── */}
        {panelOpen && (
          <div style={{
            width: 295, borderLeft: '1px solid rgba(0,0,0,0.12)', padding: '14px 16px',
            overflowY: 'auto', fontSize: 12.5, lineHeight: 1.65, flexShrink: 0,
            background: 'white', color: 'rgba(0,0,0,0.90)',
          }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#4369ef', marginBottom: 8 }}>{info.title}</div>
            <ul style={{ margin: 0, paddingLeft: 16, color: 'rgba(0,0,0,0.75)' }}>
              {info.lines.map((l, i) => (
                <li key={i} style={{ marginBottom: 5 }}>{l}</li>
              ))}
            </ul>

            <div style={{ margin: '14px 0 6px', fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.75)' }}>关键规格</div>
            <table style={{ width: '100%', fontSize: 11.5, color: 'rgba(0,0,0,0.75)', borderCollapse: 'collapse' }}>
              <tbody>
                {[
                  ['NPU 总数', `${SPEC.totalNpus}× ${TOK.ascend} ${TOK.n910c}`],
                  ['CPU 总数', `${SPEC.totalCpus}× ${TOK.kunpeng} ${TOK.n920}`],
                  ['FP16 算力', `${SPEC.fp16Pflops} PFLOPS`],
                  ['HBM 总量', `${SPEC.totalHbmTB} TB 统一编址`],
                  ['UB 带宽/NPU', `${SPEC.npuUbGBs} GB/s 单向`],
                  ['单跳时延', `${SPEC.hopLatencyNs} ns`],
                  ['散热', SPEC.cooling],
                ].map(([k, v]) => (
                  <tr key={k} style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
                    <td style={{ padding: '3px 0', color: 'rgba(0,0,0,0.55)', whiteSpace: 'nowrap' }}>{k}</td>
                    <td style={{ padding: '3px 0 3px 10px', color: 'rgba(0,0,0,0.90)' }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ margin: '14px 0 6px', fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.75)' }}>数据来源</div>
            <div style={{ fontSize: 10.5, color: 'rgba(0,0,0,0.55)', lineHeight: 1.7 }}>
              {SOURCES.map((s, i) => (<div key={i}>{s}</div>))}
            </div>
            <div style={{ marginTop: 10, fontSize: 10.5, color: 'rgba(0,0,0,0.55)', fontStyle: 'italic' }}>
              {FOOTNOTE}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

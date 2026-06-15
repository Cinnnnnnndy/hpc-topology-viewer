/**
 * 3D scene components (fully procedural modeling, no GLB dependency).
 *
 * Four scenes switched by ClusterView per view mode:
 *   OverviewScene  cluster overview: 16 cabinets (12 compute + 4 switch) + inter-cabinet optical links
 *   RackScene      single cabinet internals: power / mgmt blade / compute node / liquid cooling
 *   NodeScene      compute node blade: 8 accelerators + 4 CPUs + 7 L1 switch chips + DPU + optics
 *   TopologyScene  two-tier Clos: 48 nodes × 7 planes uplink + RDMA/VPC planes
 *
 * Display text with product/brand terms is sourced from ../content (decoded at
 * runtime); this file carries no plaintext product names.
 */
import { Suspense, useMemo, useState, type ComponentProps } from 'react';
import { Text as DreiText, Edges } from '@react-three/drei';
import * as THREE from 'three';
import {
  RACKS, RACK_DIM, ROW_GAP_Z, rackWorldPos,
  COMPUTE_RACK_UNITS, SWITCH_RACK_UNITS,
  NODE_DIM, NODE_PARTS,
  UB_PLANE_COLORS, RDMA_COLOR, VPC_COLOR, RACK_COLORS,
  type RackInfo, type RackUnit, type NodePart,
} from './data';
import { TOK } from '../content';

// ─── Light-theme palette (white surfaces + light grey + accent blue) ─────────
const LC = {
  primary:     '#4369ef',
  rackBody:    '#e8ebf1',
  rackDoor:    '#dde1e9',
  rackEdge:    '#aab4c4',
  rackEdgeHov: '#4369ef',
  text:        '#1c2433',
  textDim:     '#6b7890',
  nodeUnit:    '#f2f4f8',
  powerUnit:   '#e9edf3',
  mgmtUnit:    '#e6eaf1',
  switchUnit:  '#edf0f5',
  cduUnit:     '#e2e7ee',
  pcb:         '#bcd2c4',
  npuBody:     '#e4e8ef',
  npuTop:      '#aeb8c6',
  cpuBody:     '#e1e7ea',
  cpuTop:      '#b2c6c0',
  ubBody:      '#e8ebf1',
  dpuBody:     '#e3e8f2',
  opticalBody: '#dde3ec',
  dimmBody:    '#e0e5ee',
  metal:       '#c4cad4',
  vent:        '#9aa4b2',
} as const;

// ─── Shared callback type ────────────────────────────────────────────────────
export interface SceneCallbacks {
  onHoverInfo: (text: string | null) => void;
}

const setCursor = (on: boolean) => { document.body.style.cursor = on ? 'pointer' : 'default'; };

// drei <Text> preloads a font via suspend-react (CDN by default). Wrap in a local
// Suspense so an unreachable font source can't bubble up and block the view.
function Text(props: ComponentProps<typeof DreiText>) {
  return (
    <Suspense fallback={null}>
      <DreiText {...props} />
    </Suspense>
  );
}

// ─── Generic: edged box ──────────────────────────────────────────────────────
function Slab(props: {
  size: [number, number, number];
  position?: [number, number, number];
  color: string;
  metalness?: number;
  roughness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  edgeColor?: string;
  opacity?: number;
}) {
  const { size, position, color, metalness = 0.3, roughness = 0.6, emissive, emissiveIntensity = 0, edgeColor, opacity } = props;
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        metalness={metalness}
        roughness={roughness}
        emissive={emissive ?? '#000000'}
        emissiveIntensity={emissiveIntensity}
        transparent={opacity !== undefined}
        opacity={opacity ?? 1}
      />
      {edgeColor && <Edges color={edgeColor} threshold={20} />}
    </mesh>
  );
}

// ─── Floor ───────────────────────────────────────────────────────────────────
function Floor({ size = 22 }: { size?: number }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
        <planeGeometry args={[size, size]} />
        <meshStandardMaterial color="#f0f1f4" roughness={0.95} metalness={0.05} />
      </mesh>
      <gridHelper args={[size, size * 2, '#d0d5dd', '#e1e4ea']} position={[0, 0.001, 0]} />
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Overview: 16 cabinets + inter-cabinet optical links
// ═══════════════════════════════════════════════════════════════════════════

/** Single cabinet exterior: sheet metal + accent strip + front-panel glow slots. */
function RackBox({ rack, hovered, onClick, onHover }: {
  rack: RackInfo;
  hovered: boolean;
  onClick: () => void;
  onHover: (h: boolean) => void;
}) {
  const [x, , z] = rackWorldPos(rack);
  const isCompute = rack.kind === 'compute';
  const glow = isCompute ? RACK_COLORS.computeGlow : RACK_COLORS.switchGlow;
  const units = isCompute ? COMPUTE_RACK_UNITS : SWITCH_RACK_UNITS;
  // front door faces the aisle: front row toward +Z, back row toward -Z
  const faceDir = rack.row === 0 ? 1 : -1;

  return (
    <group
      position={[x, 0, z]}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerOver={(e) => { e.stopPropagation(); onHover(true); setCursor(true); }}
      onPointerOut={() => { onHover(false); setCursor(false); }}
    >
      {/* body */}
      <Slab
        size={[RACK_DIM.w, RACK_DIM.h, RACK_DIM.d]}
        position={[0, RACK_DIM.h / 2, 0]}
        color={LC.rackBody}
        metalness={0.55} roughness={0.45}
        edgeColor={hovered ? LC.rackEdgeHov : LC.rackEdge}
      />
      {/* front door */}
      <Slab
        size={[RACK_DIM.w - 0.06, RACK_DIM.h - 0.08, 0.02]}
        position={[0, RACK_DIM.h / 2, faceDir * (RACK_DIM.d / 2 + 0.011)]}
        color={LC.rackDoor}
        metalness={0.4} roughness={0.6}
      />
      {/* accent strip */}
      <Slab
        size={[0.018, RACK_DIM.h - 0.12, 0.012]}
        position={[RACK_DIM.w / 2 - 0.05, RACK_DIM.h / 2, faceDir * (RACK_DIM.d / 2 + 0.024)]}
        color={RACK_COLORS.accent}
        emissive={RACK_COLORS.accent} emissiveIntensity={0.35}
        metalness={0.2} roughness={0.5}
      />
      {/* front-panel glow slots */}
      {units.filter((u) => u.type === 'node' || u.type === 'switch-unit' || u.type === 'power').map((u) => (
        <Slab
          key={u.id}
          size={[RACK_DIM.w - 0.14, Math.max(0.02, u.hFrac * RACK_DIM.h * 0.28), 0.008]}
          position={[0, (u.y0 + u.hFrac / 2) * RACK_DIM.h, faceDir * (RACK_DIM.d / 2 + 0.028)]}
          color={u.type === 'power' ? LC.metal : glow}
          emissive={u.type === 'power' ? '#86efac' : glow}
          emissiveIntensity={hovered ? 0.9 : 0.4}
        />
      ))}
      {/* hover label */}
      {hovered && (
        <Text
          position={[0, RACK_DIM.h + 0.22, 0]}
          fontSize={0.16}
          color={glow}
          anchorX="center" anchorY="bottom"
          outlineWidth={0.008} outlineColor="#f5f5f5"
        >
          {rack.id.startsWith('compute') ? `Compute ${rack.label.replace(/[^C0-9]/g, '')}` : `UB Switch ${rack.label.replace(/[^S0-9]/g, '')}`}
        </Text>
      )}
    </group>
  );
}

/** Inter-cabinet optical bundles: each compute cabinet top → same-row switch cabinet tops. */
function OpticalLinks({ onHoverInfo }: SceneCallbacks) {
  const geo = useMemo(() => {
    const group: THREE.TubeGeometry[] = [];
    const switches = RACKS.filter((r) => r.kind === 'switch');
    for (const c of RACKS.filter((r) => r.kind === 'compute')) {
      const [cx, , cz] = rackWorldPos(c);
      for (const s of switches.filter((s) => s.row === c.row)) {
        const [sx, , sz] = rackWorldPos(s);
        const mid = new THREE.Vector3((cx + sx) / 2, RACK_DIM.h + 0.5 + Math.abs(cx - sx) * 0.08, (cz + sz) / 2);
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(cx, RACK_DIM.h, cz),
          mid,
          new THREE.Vector3(sx, RACK_DIM.h, sz),
        );
        group.push(new THREE.TubeGeometry(curve, 24, 0.008, 5));
      }
    }
    return group;
  }, []);
  return (
    <group
      onPointerOver={(e) => { e.stopPropagation(); onHoverInfo(`柜间${TOK.ub}光缆束 · 计算柜 ↔ 总线柜全光互联 · 每节点 7 平面上行光纤经顶部走线`); }}
      onPointerOut={() => onHoverInfo(null)}
    >
      {geo.map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshBasicMaterial color="#4369ef" transparent opacity={0.35} />
        </mesh>
      ))}
    </group>
  );
}

export function OverviewScene({ onHoverInfo, onSelectRack }: SceneCallbacks & {
  onSelectRack: (rack: RackInfo) => void;
}) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  return (
    <group>
      <Floor size={14} />
      {RACKS.map((rack) => (
        <RackBox
          key={rack.id}
          rack={rack}
          hovered={hoverId === rack.id}
          onClick={() => onSelectRack(rack)}
          onHover={(h) => {
            setHoverId(h ? rack.id : null);
            onHoverInfo(h
              ? rack.kind === 'compute'
                ? `${rack.label} · 4 计算节点 / 32× ${TOK.n910c} / 16× ${TOK.kunpeng} ${TOK.n920} · 液冷（点击下钻）`
                : `${rack.label} · ${TOK.ub} L2 交换设备 · 全光互联 · 风冷（点击下钻）`
              : null);
          }}
        />
      ))}
      <OpticalLinks onHoverInfo={onHoverInfo} />
      {/* cold aisle markers */}
      <Text position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.22} color={LC.textDim} anchorX="center">
        COLD AISLE
      </Text>
      <Text position={[0, 0.02, ROW_GAP_Z / 2 + RACK_DIM.d + 0.8]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.16} color={LC.textDim} anchorX="center">
        {`${TOK.atlasLine} - 16 Racks / 384 NPU`}
      </Text>
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Cabinet internals
// ═══════════════════════════════════════════════════════════════════════════

/** Round liquid-cooling quick connectors (grouped circular ports on the front panel). */
function QuickConnectors({ count, width }: { count: number; width: number }) {
  return (
    <group>
      {Array.from({ length: count }, (_, i) => (
        <mesh key={i} position={[(i - (count - 1) / 2) * (width / count), 0, 0.012]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.028, 0.028, 0.02, 20]} />
          <meshStandardMaterial color={LC.metal} metalness={0.7} roughness={0.35} />
        </mesh>
      ))}
    </group>
  );
}

/** In-cabinet unit (blade / power / plumbing), front-panel detail by type. */
function RackUnitMesh({ unit, rackKind, planeIdx, hovered, clickable, onClick, onHover }: {
  unit: RackUnit;
  rackKind: 'compute' | 'switch';
  planeIdx?: number;
  hovered: boolean;
  clickable: boolean;
  onClick?: () => void;
  onHover: (h: boolean) => void;
}) {
  const innerW = RACK_DIM.w * 2.6;       // cabinet view scaled 2.6×
  const innerD = RACK_DIM.d * 2.6;
  const rackH = RACK_DIM.h * 2.6;
  const h = unit.hFrac * rackH * 0.92;
  const y = (unit.y0 + unit.hFrac / 2) * rackH;
  const planeColor = planeIdx !== undefined ? UB_PLANE_COLORS[planeIdx % 7] : RACK_COLORS.computeGlow;

  const bodyColor =
    unit.type === 'power'       ? LC.powerUnit :
    unit.type === 'mgmt'        ? LC.mgmtUnit :
    unit.type === 'cdu'         ? LC.cduUnit :
    unit.type === 'switch-unit' ? LC.switchUnit : LC.nodeUnit;

  return (
    <group
      position={[0, y, 0]}
      onClick={clickable ? (e) => { e.stopPropagation(); onClick?.(); } : undefined}
      onPointerOver={(e) => { e.stopPropagation(); onHover(true); if (clickable) setCursor(true); }}
      onPointerOut={() => { onHover(false); setCursor(false); }}
    >
      <Slab
        size={[innerW - 0.12, h, innerD - 0.2]}
        color={bodyColor}
        metalness={0.3} roughness={0.55}
        edgeColor={hovered ? (rackKind === 'switch' ? planeColor : RACK_COLORS.computeGlow) : LC.rackEdge}
      />
      {/* front-panel detail (toward +Z) */}
      <group position={[0, 0, (innerD - 0.2) / 2]}>
        {unit.type === 'power' && (
          // 4 power modules + green LED
          <group>
            {Array.from({ length: 4 }, (_, i) => (
              <group key={i} position={[(i - 1.5) * (innerW / 4.6), 0, 0.015]}>
                <Slab size={[innerW / 5.2, h * 0.7, 0.02]} color={LC.metal} metalness={0.6} roughness={0.4} edgeColor={LC.rackEdge} />
                <Slab size={[0.02, 0.02, 0.012]} position={[innerW / 12, h * 0.22, 0.014]} color="#22c55e" emissive="#22c55e" emissiveIntensity={1.2} />
              </group>
            ))}
          </group>
        )}
        {unit.type === 'mgmt' && (
          <group>
            <Slab size={[innerW * 0.7, h * 0.5, 0.02]} position={[-innerW * 0.06, 0, 0.012]} color={LC.rackDoor} edgeColor={LC.rackEdge} />
            {Array.from({ length: 6 }, (_, i) => (
              <Slab key={i} size={[0.05, 0.026, 0.014]} position={[(i - 2.5) * 0.09 - innerW * 0.06, 0, 0.026]} color={LC.vent} edgeColor={LC.rackEdge} />
            ))}
            <Slab size={[0.016, 0.016, 0.012]} position={[innerW * 0.36, 0, 0.018]} color="#38bdf8" emissive="#38bdf8" emissiveIntensity={1.1} />
          </group>
        )}
        {unit.type === 'node' && (
          <group>
            {/* pull handles ×2 */}
            {[-1, 1].map((s) => (
              <Slab key={s} size={[0.05, h * 0.62, 0.03]} position={[s * (innerW / 2 - 0.16), 0, 0.02]} color={LC.metal} metalness={0.6} roughness={0.4} />
            ))}
            {/* vent grille lines */}
            {Array.from({ length: 3 }, (_, i) => (
              <Slab key={i} size={[innerW * 0.62, 0.012, 0.012]} position={[0, (i - 1) * h * 0.26, 0.016]} color={LC.vent} />
            ))}
            {/* liquid cooling quick connectors */}
            <group position={[0, -h * 0.32, 0.01]}>
              <QuickConnectors count={2} width={0.3} />
            </group>
            {/* status LED */}
            <Slab size={[0.018, 0.018, 0.012]} position={[innerW * 0.33, h * 0.3, 0.018]} color={RACK_COLORS.computeGlow} emissive={RACK_COLORS.computeGlow} emissiveIntensity={hovered ? 1.6 : 0.9} />
          </group>
        )}
        {unit.type === 'switch-unit' && (
          <group>
            {/* plane color strip */}
            <Slab size={[innerW * 0.78, 0.022, 0.014]} position={[0, h * 0.3, 0.016]} color={planeColor} emissive={planeColor} emissiveIntensity={0.8} />
            {/* liquid cooling quick connector row */}
            <group position={[0, -h * 0.12, 0.01]}>
              <QuickConnectors count={6} width={innerW * 0.72} />
            </group>
          </group>
        )}
        {unit.type === 'cdu' && (
          <group>
            {[-1, 1].map((s) => (
              <mesh key={s} position={[s * innerW * 0.22, 0, 0.03]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.045, 0.045, 0.05, 16]} />
                <meshStandardMaterial color="#26527a" metalness={0.6} roughness={0.4} />
              </mesh>
            ))}
          </group>
        )}
      </group>
      {/* left-side English label */}
      <Text
        position={[-(innerW / 2) + 0.02, 0, (innerD - 0.2) / 2 + 0.04]}
        fontSize={0.072}
        color={hovered ? LC.primary : LC.textDim}
        anchorX="left" anchorY="middle"
      >
        {unit.labelEn}
      </Text>
    </group>
  );
}

export function RackScene({ rack, onHoverInfo, onSelectNode }: SceneCallbacks & {
  rack: RackInfo;
  onSelectNode: (nodeSlot: number) => void;
}) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const units = rack.kind === 'compute' ? COMPUTE_RACK_UNITS : SWITCH_RACK_UNITS;
  const innerW = RACK_DIM.w * 2.6;
  const innerD = RACK_DIM.d * 2.6;
  const rackH = RACK_DIM.h * 2.6;
  let switchPlane = 0;

  return (
    <group>
      <Floor size={12} />
      {/* front fill light (front-panel detail faces +Z; low intensity for light materials) */}
      <pointLight position={[0, 4.2, 6]} intensity={18} color="#ffffff" />
      <pointLight position={[3.5, 1.4, 4.5]} intensity={8} color="#ffffff" />
      {/* cabinet frame (open view): base + side panels + top + back panel */}
      <group
        onPointerOver={(e) => { e.stopPropagation(); onHoverInfo(`${rack.label} 机柜框架 · 标准 19 英寸 · 浅色钣金 + 后背板走线`); }}
        onPointerOut={() => onHoverInfo(null)}
      >
        <Slab size={[innerW + 0.1, 0.08, innerD + 0.1]} position={[0, 0.04, 0]} color={LC.rackBody} metalness={0.5} roughness={0.55} edgeColor={LC.rackEdge} />
        {[-1, 1].map((s) => (
          <Slab key={s} size={[0.05, rackH, innerD]} position={[s * (innerW / 2 + 0.05), rackH / 2 + 0.08, 0]} color={LC.rackBody} metalness={0.55} roughness={0.45} edgeColor={LC.rackEdge} />
        ))}
        <Slab size={[innerW + 0.1, 0.06, innerD + 0.1]} position={[0, rackH + 0.11, 0]} color={LC.rackBody} metalness={0.55} roughness={0.45} edgeColor={LC.rackEdge} />
        <Slab size={[innerW, rackH, 0.04]} position={[0, rackH / 2 + 0.08, -(innerD / 2 + 0.02)]} color={LC.rackDoor} metalness={0.4} roughness={0.6} />
        {/* accent strip */}
        <Slab size={[0.02, rackH, 0.02]} position={[innerW / 2 + 0.08, rackH / 2 + 0.08, innerD / 2 - 0.02]} color={RACK_COLORS.accent} emissive={RACK_COLORS.accent} emissiveIntensity={0.35} />
      </group>

      {/* internal units */}
      <group position={[0, 0.08, 0]}>
        {units.map((u) => {
          const planeIdx = u.type === 'switch-unit' ? switchPlane++ : undefined;
          return (
            <RackUnitMesh
              key={u.id}
              unit={u}
              rackKind={rack.kind}
              planeIdx={planeIdx}
              hovered={hoverId === u.id}
              clickable={u.type === 'node'}
              onClick={u.type === 'node' ? () => onSelectNode(u.nodeSlot!) : undefined}
              onHover={(h) => {
                setHoverId(h ? u.id : null);
                onHoverInfo(h
                  ? u.type === 'switch-unit' && planeIdx !== undefined
                    ? `${u.label} · 对应 UB 平面 ${planeIdx + 1}/7（颜色即平面编号，7 个平面互为独立交换网络）`
                    : `${u.label}${u.type === 'node' ? '（点击下钻查看刀片内部）' : ''}`
                  : null);
              }}
            />
          );
        })}
      </group>
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Compute node (blade abstraction)
// ═══════════════════════════════════════════════════════════════════════════

function NodePartMesh({ part, hovered, onHover }: {
  part: NodePart;
  hovered: boolean;
  onHover: (h: boolean) => void;
}) {
  const S = 3.2;       // node view scale
  const [px, py, pz] = part.pos;
  const [sx, sy, sz] = part.size;
  const planeIdx = part.type === 'ub-switch' ? Number(part.id.split('-')[1]) : 0;

  const visuals: Record<NodePart['type'], { body: string; top?: string; edge: string; em?: string }> = {
    npu:        { body: LC.npuBody,     top: LC.npuTop,  edge: '#4ade80' },
    cpu:        { body: LC.cpuBody,     top: LC.cpuTop,  edge: '#38bdf8' },
    'ub-switch':{ body: LC.ubBody,      top: UB_PLANE_COLORS[planeIdx % 7], edge: UB_PLANE_COLORS[planeIdx % 7] },
    dpu:        { body: LC.dpuBody,     top: '#23304a',  edge: '#818cf8' },
    optical:    { body: LC.opticalBody, edge: '#fbbf24' },
    dimm:       { body: LC.dimmBody,    edge: '#475263' },
  };
  const v = visuals[part.type];

  return (
    <group
      position={[px * S, py * S, pz * S]}
      onPointerOver={(e) => { e.stopPropagation(); onHover(true); }}
      onPointerOut={() => onHover(false)}
    >
      {/* base package */}
      <Slab
        size={[sx * S, sy * S, sz * S]}
        color={v.body}
        metalness={0.35} roughness={0.6}
        edgeColor={hovered ? v.edge : LC.rackEdge}
      />
      {/* top face: accelerator/CPU cold plate, switch-chip plane-color die */}
      {v.top && (
        <Slab
          size={[sx * S * 0.82, sy * S * 0.5, sz * S * 0.82]}
          position={[0, sy * S * 0.62, 0]}
          color={v.top}
          metalness={part.type === 'ub-switch' ? 0.3 : 0.85}
          roughness={part.type === 'ub-switch' ? 0.5 : 0.3}
          emissive={part.type === 'ub-switch' ? v.top : undefined}
          emissiveIntensity={part.type === 'ub-switch' ? (hovered ? 0.9 : 0.35) : 0}
        />
      )}
      {/* cold-plate fin + dual-die seam hint */}
      {part.type === 'npu' && (
        <Slab size={[0.006 * S, sy * S * 0.56, sz * S * 0.84]} position={[0, sy * S * 0.64, 0]} color="#7e848e" metalness={0.8} roughness={0.35} />
      )}
      {/* optical port row */}
      {part.type === 'optical' && (
        <group>
          {Array.from({ length: 14 }, (_, i) => (
            <Slab
              key={i}
              size={[0.028 * S, sy * S * 0.6, 0.008 * S]}
              position={[(i - 6.5) * 0.044 * S, 0, sz * S * 0.7]}
              color={LC.vent}
              emissive="#fbbf24" emissiveIntensity={hovered ? 0.8 : 0.3}
            />
          ))}
        </group>
      )}
      {/* silkscreen */}
      {(part.type === 'npu' || part.type === 'cpu') && (
        <Text
          position={[0, sy * S * 0.92, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={part.type === 'npu' ? 0.062 : 0.045}
          color="#5a6478"
          anchorX="center" anchorY="middle"
        >
          {part.type === 'npu' ? `${TOK.ascendEn} ${TOK.n910c}` : `${TOK.kunpengEn} ${TOK.n920}`}
        </Text>
      )}
    </group>
  );
}

export function NodeScene({ onHoverInfo, nodeType = 'compute' }: SceneCallbacks & { nodeType?: 'compute' | 'ubswitch' }) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const S = 3.2;
  const w = NODE_DIM.w * S, h = NODE_DIM.h * S, d = NODE_DIM.d * S;

  if (nodeType === 'ubswitch') {
    return <UBSwitchScene onHoverInfo={onHoverInfo} />;
  }

  return (
    <group>
      <Floor size={10} />
      <group position={[0, 0.5, 0]}>
        {/* tray: base + low side walls */}
        <group
          onPointerOver={(e) => { e.stopPropagation(); onHoverInfo('节点托盘机箱 · 全宽液冷刀片 · 安装于计算柜节点槽位'); }}
          onPointerOut={() => onHoverInfo(null)}
        >
          <Slab size={[w + 0.12, 0.04, d + 0.12]} position={[0, -0.02, 0]} color={LC.rackBody} metalness={0.6} roughness={0.45} edgeColor={LC.rackEdge} />
          {[-1, 1].map((s) => (
            <Slab key={'w' + s} size={[0.03, h * 0.9, d + 0.12]} position={[s * (w / 2 + 0.045), h * 0.43, 0]} color={LC.rackDoor} metalness={0.6} roughness={0.45} />
          ))}
        </group>
        {/* mainboard PCB */}
        <mesh
          position={[0, 0.012, 0]}
          onPointerOver={(e) => { e.stopPropagation(); onHoverInfo(`节点主板 PCB · 板载 7 颗${TOK.ub} L1 交换芯片（彩色 = 7 个 UB 平面）`); }}
          onPointerOut={() => onHoverInfo(null)}
        >
          <boxGeometry args={[w, 0.018, d]} />
          <meshStandardMaterial color={LC.pcb} metalness={0.1} roughness={0.85} />
        </mesh>
        {/* parts */}
        {NODE_PARTS.map((p) => (
          <NodePartMesh
            key={p.id}
            part={p}
            hovered={hoverId === p.id}
            onHover={(hv) => {
              setHoverId(hv ? p.id : null);
              onHoverInfo(hv
                ? p.type === 'ub-switch'
                  ? `${p.label} · 颜色对应 UB 平面编号（共 7 色 = 7 个独立交换平面，每颗 NPU 同时接入 7 平面）`
                  : p.label
                : null);
            }}
          />
        ))}
        {/* on-board UB traces: each accelerator/CPU → 7 L1 chips */}
        <UbBoardTraces />
      </group>
    </group>
  );
}

/** On-board traces: accelerator/CPU to L1 switch-chip row (single BufferGeometry). */
function UbBoardTraces() {
  const S = 3.2;
  const { geo, colors } = useMemo(() => {
    const pts: number[] = [];
    const cols: number[] = [];
    const l1 = NODE_PARTS.filter((p) => p.type === 'ub-switch');
    const chips = NODE_PARTS.filter((p) => p.type === 'npu' || p.type === 'cpu');
    for (const c of chips) {
      for (let i = 0; i < l1.length; i++) {
        const t = l1[i];
        const col = new THREE.Color(UB_PLANE_COLORS[i % 7]);
        pts.push(c.pos[0] * S, 0.03, c.pos[2] * S, t.pos[0] * S, 0.03, t.pos[2] * S);
        cols.push(col.r, col.g, col.b, col.r, col.g, col.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    return { geo: g, colors: cols };
  }, []);
  void colors;
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial vertexColors transparent opacity={0.35} />
    </lineSegments>
  );
}

// ─── UB switch device scene ──────────────────────────────────────────────────
function UBSwitchScene({ onHoverInfo }: SceneCallbacks) {
  const [hov, setHov] = useState<string | null>(null);
  const S = 2.2;
  const W = 1.1 * S, H = 0.28 * S, D = 0.65 * S;
  return (
    <group>
      <Floor size={10} />
      <group position={[0, 0.5, 0]}>
        {/* Chassis tray */}
        <mesh
          position={[0, -0.02, 0]}
          onPointerOver={(e) => { e.stopPropagation(); onHoverInfo(`${TOK.ub}互联设备机箱托盘 · 安装于总线柜交换槽位 · 液冷`); }}
          onPointerOut={() => onHoverInfo(null)}
        >
          <boxGeometry args={[W + 0.1, 0.04, D + 0.1]} />
          <meshStandardMaterial color={LC.rackBody} metalness={0.5} roughness={0.5} />
          <Edges color={LC.rackEdge} threshold={20} />
        </mesh>
        {/* PCB */}
        <mesh
          position={[0, 0.012, 0]}
          onPointerOver={(e) => { e.stopPropagation(); onHoverInfo('交换设备主板 PCB · 承载 7 颗 L2 平面交换 ASIC'); }}
          onPointerOut={() => onHoverInfo(null)}
        >
          <boxGeometry args={[W, 0.022, D]} />
          <meshStandardMaterial color={LC.pcb} metalness={0.1} roughness={0.85} />
        </mesh>
        {/* 7 UB plane switch ASICs */}
        {UB_PLANE_COLORS.map((c, i) => {
          const id = `asic-${i}`, isH = hov === id;
          return (
            <group key={id} position={[(i - 3) * W / 8.5, 0.012, -0.04 * S]}
              onPointerOver={(e) => { e.stopPropagation(); setHov(id); onHoverInfo(`${TOK.ub}交换 ASIC · UB 平面 ${i + 1}/7（颜色 = 平面编号，7 个平面互为独立无阻塞网络）· 上行 448 GB/s`); }}
              onPointerOut={() => { setHov(null); onHoverInfo(null); }}>
              <Slab size={[W / 10, 0.07, 0.22 * S]} color={c} emissive={c} emissiveIntensity={isH ? 1.0 : 0.35} metalness={0.3} roughness={0.5} edgeColor={isH ? '#fff' : c} />
              <Text position={[0, 0.06, 0.13 * S]} fontSize={0.07} color={c} anchorX="center">{`P${i + 1}`}</Text>
            </group>
          );
        })}
        {/* Front port panel: 128×800GE in 8 banks × 16 ports */}
        <group
          position={[0, H / 2, D / 2 + 0.008]}
          onPointerOver={(e) => { e.stopPropagation(); onHoverInfo('前面板光口 · 128× OSFP 800GE · 8 组 × 16 口 · 接入计算节点上行光纤'); }}
          onPointerOut={() => onHoverInfo(null)}
        >
          {Array.from({ length: 8 }, (_, bank) => (
            <group key={bank} position={[(bank - 3.5) * W / 9, 0, 0]}>
              {Array.from({ length: 16 }, (_, j) => (
                <Slab key={j} size={[0.025 * S, 0.025 * S, 0.006]}
                  position={[(j % 4 - 1.5) * 0.032 * S, (Math.floor(j / 4) - 1.5) * 0.032 * S, 0]}
                  color={LC.vent} emissive="#fbbf24" emissiveIntensity={0.5} />
              ))}
            </group>
          ))}
        </group>
        {/* Liquid cooling connectors on sides */}
        {[-1, 1].map(side => (
          <group
            key={side}
            position={[side * (W / 2 + 0.018), H / 4, 0]}
            onPointerOver={(e) => { e.stopPropagation(); onHoverInfo('液冷快接头 ×4 · 冷板式液冷进/回水 · 盲插免工具维护'); }}
            onPointerOut={() => onHoverInfo(null)}
          >
            {Array.from({ length: 4 }, (_, i) => (
              <mesh key={i} position={[0, 0, (i - 1.5) * D / 5]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.028 * S, 0.028 * S, 0.032, 16]} />
                <meshStandardMaterial color="#6b9fd4" metalness={0.7} roughness={0.3} />
              </mesh>
            ))}
          </group>
        ))}
        {/* Chassis outline */}
        <Slab size={[W, H, D]} position={[0, H / 2, 0]} color={LC.rackBody} opacity={0.18} edgeColor={LC.rackEdge} />
        {/* Plane color strip on front */}
        {UB_PLANE_COLORS.map((c, i) => (
          <Slab key={i} size={[W / 8.2, 0.018, 0.01]} position={[(i - 3) * W / 8.5, H + 0.01, D / 2 + 0.002]}
            color={c} emissive={c} emissiveIntensity={0.7} />
        ))}
        <Text position={[0, H + 0.14, D / 2 + 0.04]} fontSize={0.1} color={LC.text} anchorX="center">
          {`${TOK.ub}互联设备 ${TOK.unifiedbus} · 128×800GE 全光 · 7 UB 平面 · 液冷`}
        </Text>
        <Text position={[0, H + 0.04, D / 2 + 0.04]} fontSize={0.08} color={LC.textDim} anchorX="center">
          {'点击各 ASIC 查看详情 · 前面板 128 个 OSFP 800GE 光口 · 两侧液冷快接头'}
        </Text>
      </group>
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Interconnect topology (two-tier Clos abstraction)
// ═══════════════════════════════════════════════════════════════════════════

// ── Topology config ──────────────────────────────────────────────────────────
const TP = {
  N: 12,          // full set: 12 compute cabinets (4 nodes / 32 accelerators each)
  xSpan: 11.4,
  nodeW: 0.62, nodeH: 0.32, nodeD: 0.38,
  nodeY: 0.32,
  l1Size: 0.052,
  l2BaseY: 2.2, l2StepY: 0.35,
  planeLen: 12.6, planeH: 0.18, planeD: 0.4,
  rdmaY: 5.3, vpcY: 5.75,
};

function tpX(i: number) { return (i / (TP.N - 1) - 0.5) * TP.xSpan; }
function tpL2Y(p: number) { return TP.l2BaseY + p * TP.l2StepY; }

/** All uplinks as a single LineSegments (dim base + bright highlight) */
function TopoUplinks({ hoverNode, hoverPlane }: { hoverNode: number | null; hoverPlane: number | null }) {
  const baseGeo = useMemo(() => {
    const pts: number[] = [], cols: number[] = [];
    for (let n = 0; n < TP.N; n++) {
      const x = tpX(n);
      for (let p = 0; p < 7; p++) {
        const c = new THREE.Color(UB_PLANE_COLORS[p]);
        pts.push(x + (p - 3) * 0.08, TP.nodeY + TP.nodeH, 0,  x, tpL2Y(p), 0);
        cols.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    return g;
  }, []);

  const hiGeo = useMemo(() => {
    if (hoverNode === null && hoverPlane === null) return null;
    const pts: number[] = [], cols: number[] = [];
    for (let n = 0; n < TP.N; n++) {
      if (hoverNode !== null && hoverNode !== n) continue;
      const x = tpX(n);
      for (let p = 0; p < 7; p++) {
        if (hoverPlane !== null && hoverPlane !== p) continue;
        const c = new THREE.Color(UB_PLANE_COLORS[p]);
        pts.push(x + (p - 3) * 0.08, TP.nodeY + TP.nodeH, 0,  x, tpL2Y(p), 0);
        cols.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }
    if (pts.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    return g;
  }, [hoverNode, hoverPlane]);

  const dim = hoverNode !== null || hoverPlane !== null ? 0.07 : 0.22;
  return (
    <group>
      <lineSegments geometry={baseGeo}>
        <lineBasicMaterial vertexColors transparent opacity={dim} />
      </lineSegments>
      {hiGeo && (
        <lineSegments geometry={hiGeo}>
          <lineBasicMaterial vertexColors transparent opacity={0.9} />
        </lineSegments>
      )}
    </group>
  );
}

export function TopologyScene({ onHoverInfo }: SceneCallbacks) {
  const [hoverNode, setHoverNode] = useState<number | null>(null);
  const [hoverPlane, setHoverPlane] = useState<number | null>(null);

  return (
    <group>
      <Floor size={18} />

      {/* ── tier labels (left) ── */}
      <Text position={[-7.6, TP.nodeY + TP.nodeH / 2, 0]} fontSize={0.19} color={LC.textDim} anchorX="right" anchorY="middle" maxWidth={3}>{'计算节点层\n12柜 / 48节点'}</Text>
      <Text position={[-7.6, TP.l2BaseY + 3 * TP.l2StepY, 0]} fontSize={0.19} color={LC.textDim} anchorX="right" anchorY="middle" maxWidth={3}>{`L2 ${TOK.ub}交换层\n7平面×16芯片`}</Text>
      <Text position={[-7.6, (TP.rdmaY + TP.vpcY) / 2, 0]} fontSize={0.19} color={LC.textDim} anchorX="right" anchorY="middle" maxWidth={3}>{`跨${TOK.supernode}\n互联层`}</Text>

      {/* ── compute-node tier (full 12 cabinets, 4 nodes / 32 accelerators each) ── */}
      {Array.from({ length: TP.N }, (_, n) => {
        const x = tpX(n);
        const isH = hoverNode === n;
        return (
          <group
            key={n}
            position={[x, TP.nodeY, 0]}
            onPointerOver={(e) => { e.stopPropagation(); setHoverNode(n); setHoverPlane(null); setCursor(true); onHoverInfo(`计算柜 C${n + 1} · 4 节点 / 32× ${TOK.n910c} / 16× ${TOK.kunpeng} ${TOK.n920} · 每节点 7 平面 UB 上行 · 392 GB/s/NPU`); }}
            onPointerOut={() => { setHoverNode(null); setCursor(false); onHoverInfo(null); }}
          >
            <mesh>
              <boxGeometry args={[TP.nodeW, TP.nodeH, TP.nodeD]} />
              <meshStandardMaterial color={isH ? '#d6e2fb' : '#e8ebf1'} metalness={0.3} roughness={0.55} emissive={isH ? '#4369ef' : '#000000'} emissiveIntensity={isH ? 0.18 : 0} />
              <Edges color={isH ? '#4369ef' : LC.rackEdge} threshold={20} />
            </mesh>
            {/* L1 chip dots (7 planes) */}
            {Array.from({ length: 7 }, (_, p) => (
              <mesh key={p} position={[(p - 3) * 0.075, TP.nodeH / 2 + 0.016, 0]}>
                <boxGeometry args={[TP.l1Size, 0.026, 0.044]} />
                <meshStandardMaterial color={UB_PLANE_COLORS[p]} emissive={UB_PLANE_COLORS[p]} emissiveIntensity={isH ? 1.0 : 0.45} />
              </mesh>
            ))}
            <Text position={[0, -TP.nodeH / 2 - 0.13, 0]} fontSize={0.1} color={LC.textDim} anchorX="center">{`C${n + 1}`}</Text>
          </group>
        );
      })}

      {/* ── uplinks ── */}
      <TopoUplinks hoverNode={hoverNode} hoverPlane={hoverPlane} />

      {/* ── L2 switch tier (7 plane bars) ── */}
      {UB_PLANE_COLORS.map((c, p) => {
        const y = tpL2Y(p);
        const isH = hoverPlane === p;
        return (
          <group
            key={p}
            position={[0, y, 0]}
            onPointerOver={(e) => { e.stopPropagation(); setHoverPlane(p); setHoverNode(null); setCursor(true); onHoverInfo(`UB 平面 ${p + 1}/7（颜色 = 平面编号）· 16 颗 L2 交换芯片 · 每颗 48×28 GB/s 端口 · 全 48 节点 1:1 无阻塞`); }}
            onPointerOut={() => { setHoverPlane(null); setCursor(false); onHoverInfo(null); }}
          >
            <mesh>
              <boxGeometry args={[TP.planeLen, TP.planeH, TP.planeD]} />
              <meshStandardMaterial color={c} transparent opacity={isH ? 0.7 : 0.38} emissive={c} emissiveIntensity={isH ? 0.45 : 0.18} metalness={0.1} roughness={0.65} />
            </mesh>
            {/* 16 L2 chip marks */}
            {Array.from({ length: 16 }, (_, i) => (
              <Slab key={i} size={[0.2, TP.planeH * 1.7, TP.planeD * 1.06]} position={[(i - 7.5) * (TP.planeLen / 16.5), 0, 0]} color={c} emissive={c} emissiveIntensity={isH ? 0.7 : 0.35} />
            ))}
            {/* Right label */}
            <Text position={[TP.planeLen / 2 + 0.18, 0, 0]} fontSize={0.17} color={c} anchorX="left">{`P${p + 1} · 16×L2`}</Text>
            {/* Left bandwidth label on hover */}
            {isH && <Text position={[-TP.planeLen / 2 - 0.12, 0, 0]} fontSize={0.13} color={c} anchorX="right">48×28 GB/s/chip · 无阻塞</Text>}
          </group>
        );
      })}

      {/* ── cross-node interconnect tier ── */}
      {/* RDMA */}
      <group
        position={[0, TP.rdmaY, 0]}
        onPointerOver={(e) => { e.stopPropagation(); onHoverInfo(`RDMA Scale-Out 平面 · 400 Gbps/NPU · RoCE v2 · 跨${TOK.supernode} all-to-all 通信`); }}
        onPointerOut={() => onHoverInfo(null)}
      >
        <mesh>
          <boxGeometry args={[TP.planeLen * 0.85, 0.13, 0.58]} />
          <meshStandardMaterial color={RDMA_COLOR} transparent opacity={0.42} emissive={RDMA_COLOR} emissiveIntensity={0.22} />
        </mesh>
        <Text position={[TP.planeLen * 0.425 + 0.18, 0, 0]} fontSize={0.16} color={RDMA_COLOR} anchorX="left">RDMA · 400 Gbps/NPU</Text>
      </group>
      {/* VPC */}
      <group
        position={[0, TP.vpcY, 0]}
        onPointerOver={(e) => { e.stopPropagation(); onHoverInfo(`VPC 平面 · ${TOK.qingtian} · 400 Gbps/节点 · 接数据中心外网`); }}
        onPointerOut={() => onHoverInfo(null)}
      >
        <mesh>
          <boxGeometry args={[TP.planeLen * 0.85, 0.11, 0.52]} />
          <meshStandardMaterial color={VPC_COLOR} transparent opacity={0.35} emissive={VPC_COLOR} emissiveIntensity={0.15} />
        </mesh>
        <Text position={[TP.planeLen * 0.425 + 0.18, 0, 0]} fontSize={0.16} color={VPC_COLOR} anchorX="left">VPC · 数据中心网关</Text>
      </group>

      {/* ── bottom caption ── */}
      <Text position={[0, 0.04, TP.nodeD / 2 + 1.4]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.18} color={LC.textDim} anchorX="center">
        {'两层无阻塞 Clos · 全量 12 计算柜 / 48 节点 / 84 条上行 · 7 色 = 7 个 UB 平面 · 悬停高亮'}
      </Text>
    </group>
  );
}

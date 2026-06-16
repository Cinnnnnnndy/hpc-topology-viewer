/**
 * 3D scene components (fully procedural modeling, no GLB dependency).
 *
 * Two generations (A5 / A6). Four scenes, switched by ClusterView per view mode:
 *   OverviewScene   data-hall floor: compute-cabinet grid + comms-cabinet block
 *   RackScene       single cabinet internals (compute blade rack / UB switch rack)
 *   NodeScene       compute blade: 8× NPU (multi-die) + CPU + UB fabric,
 *                   with toggleable die / process(rank) / thread comm overlays
 *   TopologyScene   UB interconnect hierarchy L0→L4 (die → node → rack mesh
 *                   → pod-level Clos → cluster scale-out)
 *
 * Colour coding follows the UB hierarchy levels (UB_LEVELS), not per-plane.
 * Display text with product/brand terms is sourced from ../content (decoded at
 * runtime); this file carries no plaintext product names.
 */
import { Suspense, useMemo, useState, useLayoutEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { Text as DreiText, Edges } from '@react-three/drei';
import * as THREE from 'three';
import {
  RACK_DIM, COMPUTE_RACK_UNITS, SWITCH_RACK_UNITS,
  NODE_DIM, NODE_PARTS, NPU_GRID, DIES_PER_NPU, NPUS_PER_NODE,
  UB_LEVELS, COMM_PATTERNS, RACK_COLORS,
  buildHall, CAB_W, CAB_H, CAB_D,
  SCALES, makeAdjacency,
  type RackKind, type RackUnit, type NodePart, type GenSpec, type CabinetCell, type Scale,
} from './data';
import { TOK } from '../content';

// ─── Light-theme palette ─────────────────────────────────────────────────────
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

const L = (i: number) => UB_LEVELS[i].color;       // UB level colour shortcut

export interface SceneCallbacks { onHoverInfo: (text: string | null) => void; }
const setCursor = (on: boolean) => { document.body.style.cursor = on ? 'pointer' : 'default'; };

// drei <Text> preloads a font via suspend-react; wrap in local Suspense so an
// unreachable font source can't bubble up and block the view.
function Text(props: ComponentProps<typeof DreiText>) {
  return <Suspense fallback={null}><DreiText {...props} /></Suspense>;
}

// ─── Generic edged box ───────────────────────────────────────────────────────
function Slab(props: {
  size: [number, number, number];
  position?: [number, number, number];
  color: string; metalness?: number; roughness?: number;
  emissive?: string; emissiveIntensity?: number; edgeColor?: string; opacity?: number;
}) {
  const { size, position, color, metalness = 0.3, roughness = 0.6, emissive, emissiveIntensity = 0, edgeColor, opacity } = props;
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color} metalness={metalness} roughness={roughness}
        emissive={emissive ?? '#000000'} emissiveIntensity={emissiveIntensity}
        transparent={opacity !== undefined} opacity={opacity ?? 1}
      />
      {edgeColor && <Edges color={edgeColor} threshold={20} />}
    </mesh>
  );
}

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
// 1. Overview: data-hall floor (compute grid + comms block)
// ═══════════════════════════════════════════════════════════════════════════

function HallCabinet({ cell, hovered, onClick, onHover }: {
  cell: CabinetCell; hovered: boolean; onClick: () => void; onHover: (h: boolean) => void;
}) {
  const isCompute = cell.kind === 'compute';
  const glow = isCompute ? RACK_COLORS.computeGlow : RACK_COLORS.switchGlow;
  return (
    <group
      position={cell.pos}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerOver={(e) => { e.stopPropagation(); onHover(true); setCursor(true); }}
      onPointerOut={() => { onHover(false); setCursor(false); }}
    >
      <Slab
        size={[CAB_W, CAB_H, CAB_D]} position={[0, CAB_H / 2, 0]}
        color={hovered ? '#dbe4fb' : LC.rackBody} metalness={0.5} roughness={0.5}
        edgeColor={hovered ? LC.rackEdgeHov : LC.rackEdge}
      />
      {/* top status strip = cabinet kind */}
      <Slab
        size={[CAB_W * 0.78, 0.03, CAB_D * 0.7]} position={[0, CAB_H + 0.02, 0]}
        color={glow} emissive={glow} emissiveIntensity={hovered ? 1.1 : 0.5}
      />
    </group>
  );
}

/** Schematic UB optical spine: arcs from compute block to comms block. */
function HallSpine({ cells }: { cells: CabinetCell[] }) {
  const geo = useMemo(() => {
    const compute = cells.filter((c) => c.kind === 'compute');
    const comms = cells.filter((c) => c.kind === 'switch');
    if (!compute.length || !comms.length) return [];
    const cFrontZ = Math.max(...compute.map((c) => c.pos[2]));   // compute rear edge
    const sFrontZ = Math.min(...comms.map((c) => c.pos[2]));     // comms front edge
    const out: THREE.TubeGeometry[] = [];
    const cols = 16;
    for (let i = 0; i < cols; i++) {
      const x = (i - (cols - 1) / 2) * (CAB_W + 0.12);
      const a = new THREE.Vector3(x, CAB_H + 0.05, cFrontZ);
      const b = new THREE.Vector3(x, CAB_H + 0.05, sFrontZ);
      const mid = new THREE.Vector3(x, CAB_H + 0.9, (cFrontZ + sFrontZ) / 2);
      out.push(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 20, 0.01, 5));
    }
    return out;
  }, [cells]);
  return (
    <group>
      {geo.map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshBasicMaterial color={L(3)} transparent opacity={0.4} />
        </mesh>
      ))}
    </group>
  );
}

export function OverviewScene({ gen, onHoverInfo, onSelectRack }: SceneCallbacks & {
  gen: GenSpec; onSelectRack: (kind: RackKind) => void;
}) {
  const cells = useMemo(() => buildHall(gen), [gen]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const depth = useMemo(() => {
    const zs = cells.map((c) => c.pos[2]); return Math.max(...zs) - Math.min(...zs) + 4;
  }, [cells]);

  return (
    <group>
      <Floor size={Math.max(16, depth + 4)} />
      {cells.map((cell) => (
        <HallCabinet
          key={cell.id}
          cell={cell}
          hovered={hoverId === cell.id}
          onClick={() => onSelectRack(cell.kind)}
          onHover={(h) => {
            setHoverId(h ? cell.id : null);
            onHoverInfo(h
              ? cell.kind === 'compute'
                ? `计算柜 · 8 节点 / 64× ${gen.npuShort} NPU · 柜内 ${TOK.fullmesh} · 液冷（点击下钻）`
                : `通信柜 · ${TOK.ub} 交换设备 · Clos 顶层 · 全光（点击下钻）`
              : null);
          }}
        />
      ))}
      <HallSpine cells={cells} />
      <Text position={[0, 0.02, -(depth / 2) + 0.6]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.34} color={LC.textDim} anchorX="center">
        {`${gen.code} · ${gen.totalCabs} cabinets (${gen.computeCabs} compute + ${gen.commCabs} comms) · ${gen.totalNpus} NPU`}
      </Text>
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Cabinet internals
// ═══════════════════════════════════════════════════════════════════════════

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

function RackUnitMesh({ unit, rackKind, hovered, clickable, onClick, onHover }: {
  unit: RackUnit; rackKind: RackKind; hovered: boolean; clickable: boolean;
  onClick?: () => void; onHover: (h: boolean) => void;
}) {
  const innerW = RACK_DIM.w * 2.6, innerD = RACK_DIM.d * 2.6, rackH = RACK_DIM.h * 2.6;
  const h = unit.hFrac * rackH * 0.92;
  const y = (unit.y0 + unit.hFrac / 2) * rackH;
  const swColor = L(3);   // UB Clos level colour for switch trays
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
        size={[innerW - 0.12, h, innerD - 0.2]} color={bodyColor} metalness={0.3} roughness={0.55}
        edgeColor={hovered ? (rackKind === 'switch' ? swColor : RACK_COLORS.computeGlow) : LC.rackEdge}
      />
      <group position={[0, 0, (innerD - 0.2) / 2]}>
        {unit.type === 'power' && (
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
            <Slab size={[0.016, 0.016, 0.012]} position={[innerW * 0.36, 0, 0.018]} color="#38bdf8" emissive="#38bdf8" emissiveIntensity={1.1} />
          </group>
        )}
        {unit.type === 'node' && (
          <group>
            {[-1, 1].map((s) => (
              <Slab key={s} size={[0.05, h * 0.62, 0.03]} position={[s * (innerW / 2 - 0.16), 0, 0.02]} color={LC.metal} metalness={0.6} roughness={0.4} />
            ))}
            {Array.from({ length: 3 }, (_, i) => (
              <Slab key={i} size={[innerW * 0.62, 0.012, 0.012]} position={[0, (i - 1) * h * 0.26, 0.016]} color={LC.vent} />
            ))}
            <group position={[0, -h * 0.3, 0.01]}><QuickConnectors count={2} width={0.3} /></group>
            <Slab size={[0.018, 0.018, 0.012]} position={[innerW * 0.33, h * 0.3, 0.018]} color={RACK_COLORS.computeGlow} emissive={RACK_COLORS.computeGlow} emissiveIntensity={hovered ? 1.6 : 0.9} />
          </group>
        )}
        {unit.type === 'switch-unit' && (
          <group>
            <Slab size={[innerW * 0.78, 0.022, 0.014]} position={[0, h * 0.3, 0.016]} color={swColor} emissive={swColor} emissiveIntensity={0.8} />
            {/* optical port row */}
            {Array.from({ length: 10 }, (_, i) => (
              <Slab key={i} size={[0.03, 0.03, 0.01]} position={[(i - 4.5) * (innerW * 0.085), -h * 0.12, 0.016]} color={LC.vent} emissive="#fbbf24" emissiveIntensity={0.5} />
            ))}
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
      <Text position={[-(innerW / 2) + 0.02, 0, (innerD - 0.2) / 2 + 0.04]} fontSize={0.072} color={hovered ? LC.primary : LC.textDim} anchorX="left" anchorY="middle">
        {unit.labelEn}
      </Text>
    </group>
  );
}

export function RackScene({ rackKind, label, onHoverInfo, onSelectNode, onSelectSwitch }: SceneCallbacks & {
  rackKind: RackKind; label: string; onSelectNode: (slot: number) => void; onSelectSwitch?: () => void;
}) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const units = rackKind === 'compute' ? COMPUTE_RACK_UNITS : SWITCH_RACK_UNITS;
  const innerW = RACK_DIM.w * 2.6, innerD = RACK_DIM.d * 2.6, rackH = RACK_DIM.h * 2.6;

  return (
    <group>
      <Floor size={12} />
      <pointLight position={[0, 4.2, 6]} intensity={18} color="#ffffff" />
      <pointLight position={[3.5, 1.4, 4.5]} intensity={8} color="#ffffff" />
      <group
        onPointerOver={(e) => { e.stopPropagation(); onHoverInfo(`${label} 机柜框架 · 标准 19" · 浅色钣金 + 后背板全光走线`); }}
        onPointerOut={() => onHoverInfo(null)}
      >
        <Slab size={[innerW + 0.1, 0.08, innerD + 0.1]} position={[0, 0.04, 0]} color={LC.rackBody} metalness={0.5} roughness={0.55} edgeColor={LC.rackEdge} />
        {[-1, 1].map((s) => (
          <Slab key={s} size={[0.05, rackH, innerD]} position={[s * (innerW / 2 + 0.05), rackH / 2 + 0.08, 0]} color={LC.rackBody} metalness={0.55} roughness={0.45} edgeColor={LC.rackEdge} />
        ))}
        <Slab size={[innerW + 0.1, 0.06, innerD + 0.1]} position={[0, rackH + 0.11, 0]} color={LC.rackBody} metalness={0.55} roughness={0.45} edgeColor={LC.rackEdge} />
        <Slab size={[innerW, rackH, 0.04]} position={[0, rackH / 2 + 0.08, -(innerD / 2 + 0.02)]} color={LC.rackDoor} metalness={0.4} roughness={0.6} />
        <Slab size={[0.02, rackH, 0.02]} position={[innerW / 2 + 0.08, rackH / 2 + 0.08, innerD / 2 - 0.02]} color={RACK_COLORS.accent} emissive={RACK_COLORS.accent} emissiveIntensity={0.35} />
      </group>
      <group position={[0, 0.08, 0]}>
        {units.map((u) => {
          const clickable = u.type === 'node' || u.type === 'switch-unit';
          return (
            <RackUnitMesh
              key={u.id}
              unit={u}
              rackKind={rackKind}
              hovered={hoverId === u.id}
              clickable={clickable}
              onClick={u.type === 'node' ? () => onSelectNode(u.nodeSlot!) : u.type === 'switch-unit' ? () => onSelectSwitch?.() : undefined}
              onHover={(h) => {
                setHoverId(h ? u.id : null);
                onHoverInfo(h ? `${u.label}${u.type === 'node' ? '（点击下钻查看刀片 + die/AI Core/Tile）' : u.type === 'switch-unit' ? '（点击下钻查看 UB 交换设备内部）' : ''}` : null);
              }}
            />
          );
        })}
      </group>
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Compute node (blade) — static structure (die-level detail)
// ═══════════════════════════════════════════════════════════════════════════

const S_NODE = 3.2;   // node view scale

function NodePartMesh({ part, hovered, selected, onHover, onSelect }: {
  part: NodePart; hovered: boolean; selected?: boolean; onHover: (h: boolean) => void; onSelect?: () => void;
}) {
  const S = S_NODE;
  const [px, py, pz] = part.pos;
  const [sx, sy, sz] = part.size;
  const selColor = COMM_PATTERNS[2].color;   // selected-NPU accent (cyan, matches die view)

  const visuals: Record<NodePart['type'], { body: string; top?: string; edge: string }> = {
    npu:        { body: LC.npuBody,     top: LC.npuTop, edge: '#4ade80' },
    cpu:        { body: LC.cpuBody,     top: LC.cpuTop, edge: '#38bdf8' },
    'ub-fabric':{ body: LC.ubBody,      top: L(1),      edge: L(1) },
    dpu:        { body: LC.dpuBody,     top: '#23304a', edge: '#818cf8' },
    optical:    { body: LC.opticalBody, edge: L(3) },
    dimm:       { body: LC.dimmBody,    edge: '#475263' },
  };
  const v = visuals[part.type];
  const edge = selected ? selColor : hovered ? v.edge : LC.rackEdge;

  return (
    <group
      position={[px * S, py * S, pz * S]}
      onPointerOver={(e) => { e.stopPropagation(); onHover(true); if (onSelect) setCursor(true); }}
      onPointerOut={() => { onHover(false); if (onSelect) setCursor(false); }}
      onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(); } : undefined}
    >
      <Slab size={[sx * S, sy * S, sz * S]} color={v.body} metalness={0.35} roughness={0.6} edgeColor={edge} />
      {/* NPU: render dies on top (L0 die-level) */}
      {part.type === 'npu' && (
        <group>
          {Array.from({ length: DIES_PER_NPU }, (_, d) => (
            <Slab
              key={d}
              size={[sx * S * 0.4, sy * S * 0.55, sz * S * 0.8]}
              position={[(d - (DIES_PER_NPU - 1) / 2) * sx * S * 0.46, sy * S * 0.6, 0]}
              color={L(0)}
              emissive={L(0)} emissiveIntensity={selected ? 1.0 : hovered ? 0.9 : 0.5}
              metalness={0.5} roughness={0.4}
            />
          ))}
          {/* die-to-die UB seam (L0) */}
          <Slab size={[0.006 * S, sy * S * 0.6, sz * S * 0.82]} position={[0, sy * S * 0.62, 0]} color={L(0)} emissive={L(0)} emissiveIntensity={0.9} />
          {/* selected marker */}
          {selected && <Slab size={[sx * S * 1.06, 0.004 * S, sz * S * 1.06]} position={[0, sy * S * 1.0, 0]} color={selColor} emissive={selColor} emissiveIntensity={1} />}
        </group>
      )}
      {v.top && part.type !== 'npu' && (
        <Slab size={[sx * S * 0.82, sy * S * 0.5, sz * S * 0.82]} position={[0, sy * S * 0.62, 0]}
          color={v.top} metalness={part.type === 'ub-fabric' ? 0.3 : 0.85} roughness={part.type === 'ub-fabric' ? 0.5 : 0.3}
          emissive={part.type === 'ub-fabric' ? v.top : '#000000'} emissiveIntensity={part.type === 'ub-fabric' ? (hovered ? 0.9 : 0.4) : 0} />
      )}
      {part.type === 'optical' && (
        <group>
          {Array.from({ length: 14 }, (_, i) => (
            <Slab key={i} size={[0.028 * S, sy * S * 0.6, 0.008 * S]} position={[(i - 6.5) * 0.044 * S, 0, sz * S * 0.7]}
              color={LC.vent} emissive="#fbbf24" emissiveIntensity={hovered ? 0.8 : 0.3} />
          ))}
        </group>
      )}
      {(part.type === 'npu' || part.type === 'cpu') && (
        <Text position={[0, sy * S * 1.0, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={part.type === 'npu' ? 0.06 : 0.045} color="#5a6478" anchorX="center" anchorY="middle">
          {part.type === 'npu' ? `${TOK.ascendEn} ${TOK.n950dt}` : `${TOK.kunpengEn} ${TOK.n950}`}
        </Text>
      )}
    </group>
  );
}

/** Build a LineSegments geometry from an array of [ax,ay,az,bx,by,bz] in one colour. */
function segGeo(segments: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
  return g;
}

/** Toggleable overlays. ring/a2a → UB hierarchy view; tile/cores → node view. */
export interface CommOverlays { ring: boolean; a2a: boolean; tile: boolean; cores: boolean; }

// ─── Node die compute-detail (AI Core array + SRAM + Tile dataflow) ──────────
const DIE = {
  pos: [2.7, 0.06, 0] as [number, number, number],   // inset podium beside the blade
  w: 1.7, d: 1.1,
  cube: { rows: 4, cols: 4 },     // Cube core array (schematic)
  vec: { rows: 2, cols: 4 },      // Vector cores
};

/** Enlarged single-die view: HBM → L1 → L0 → Cube/Vector cores, with tile dataflow. */
function DieDetail({ npuIdx, overlays, onHoverInfo }: { npuIdx: number; overlays: CommOverlays; onHoverInfo: (t: string | null) => void }) {
  const [hx, hz] = [DIE.w / 2, DIE.d / 2];
  const cubeColor = COMM_PATTERNS[2].color;   // thread/tile colour (cyan)
  const tileColor = '#f59e0b';

  // tile dataflow polyline: HBM → L1 → L0A/L0B → Cube → L0C → L1
  const flowGeo = useMemo(() => {
    const p = (x: number, z: number): [number, number, number] => [x, 0.06, z];
    const seg: number[] = [];
    const hbm = p(-hx + 0.18, 0), l1 = p(-hx + 0.62, 0), l0 = p(-0.1, 0), cube = p(0.55, 0), l0c = p(0.55, -hz + 0.3);
    const chain = [hbm, l1, l0, cube, l0c, l1];
    for (let i = 0; i < chain.length - 1; i++) seg.push(...chain[i], ...chain[i + 1]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    return g;
  }, [hx, hz]);

  const Block = ({ x, z, w, d, label, color }: { x: number; z: number; w: number; d: number; label: string; color: string }) => (
    <group position={[x, 0, z]}
      onPointerOver={(e) => { e.stopPropagation(); onHoverInfo(`${label}`); }}
      onPointerOut={() => onHoverInfo(null)}
    >
      <Slab size={[w, 0.05, d]} position={[0, 0.025, 0]} color={color} metalness={0.3} roughness={0.55} edgeColor={LC.rackEdge} />
      <Text position={[0, 0.07, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.08} color={LC.text} anchorX="center" anchorY="middle">{label}</Text>
    </group>
  );

  return (
    <group position={DIE.pos}>
      {/* substrate */}
      <Slab size={[DIE.w + 0.1, 0.03, DIE.d + 0.1]} position={[0, 0, 0]} color="#eef1f6" edgeColor={LC.rackEdge} />
      {/* HBM stack (left) */}
      <Block x={-hx + 0.18} z={0} w={0.22} d={DIE.d * 0.8} label="HBM" color="#cdd6e4" />
      {/* L1 SRAM */}
      <Block x={-hx + 0.62} z={0} w={0.2} d={DIE.d * 0.7} label="L1" color="#d6e0f0" />
      {/* L0A/L0B buffers */}
      <Block x={-0.1} z={hz - 0.28} w={0.5} d={0.18} label="L0A/L0B" color="#dbe6f2" />
      {/* AI Core array: Cube + Vector */}
      {overlays.cores && (
        <group>
          {Array.from({ length: DIE.cube.rows * DIE.cube.cols }, (_, k) => {
            const r = Math.floor(k / DIE.cube.cols), c = k % DIE.cube.cols;
            return (
              <Slab key={`cube-${k}`} size={[0.085, 0.06, 0.085]}
                position={[0.4 + c * 0.1, 0.03, (r - 1.5) * 0.1]}
                color={cubeColor} emissive={cubeColor} emissiveIntensity={0.5} />
            );
          })}
          {Array.from({ length: DIE.vec.rows * DIE.vec.cols }, (_, k) => {
            const r = Math.floor(k / DIE.vec.cols), c = k % DIE.vec.cols;
            return (
              <Slab key={`vec-${k}`} size={[0.07, 0.05, 0.07]}
                position={[0.4 + c * 0.1, 0.03, (r - 0.5) * 0.1 + hz - 0.22]}
                color="#7dd3fc" emissive="#7dd3fc" emissiveIntensity={0.35} />
            );
          })}
          <Text position={[0.62, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.075} color={cubeColor} anchorX="center">Cube ×16</Text>
        </group>
      )}
      {/* L0C accumulator */}
      <Block x={0.55} z={-hz + 0.3} w={0.5} d={0.18} label="L0C" color="#dbe6f2" />
      {/* tile dataflow */}
      {overlays.tile && (
        <group
          onPointerOver={(e) => { e.stopPropagation(); onHoverInfo(`Tile 数据流：HBM→L1→L0→Cube→L0C 异步流水（TileShape 切分 · 参考 TileLang/${TOK.pypto}）`); }}
          onPointerOut={() => onHoverInfo(null)}
        >
          <lineSegments geometry={flowGeo}><lineBasicMaterial color={tileColor} transparent opacity={0.9} /></lineSegments>
        </group>
      )}
      <Text position={[0, 0.05, hz + 0.18]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.1} color={LC.textDim} anchorX="center">
        {`放大：NPU #${npuIdx + 1} 的 die · AI Core + 多级 SRAM · 线程/Tile 级（点左侧 NPU 切换）`}
      </Text>
    </group>
  );
}

/** Node-internal UB 2D-mesh among the 8 NPUs (L1 board fabric). */
function BoardMesh() {
  const S = S_NODE;
  const geo = useMemo(() => {
    const npu = NODE_PARTS.filter((p) => p.type === 'npu');
    const pos = (i: number): [number, number, number] => [npu[i].pos[0] * S, 0.05 * S, npu[i].pos[2] * S];
    const seg: number[] = [];
    for (let r = 0; r < NPU_GRID.rows; r++)
      for (let c = 0; c < NPU_GRID.cols; c++) {
        const i = r * NPU_GRID.cols + c;
        if (i >= npu.length) continue;
        if (c + 1 < NPU_GRID.cols) seg.push(...pos(i), ...pos(i + 1));
        if (r + 1 < NPU_GRID.rows && i + NPU_GRID.cols < npu.length) seg.push(...pos(i), ...pos(i + NPU_GRID.cols));
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    return g;
  }, []);
  return <lineSegments geometry={geo}><lineBasicMaterial color={L(1)} transparent opacity={0.7} /></lineSegments>;
}

export function NodeScene({ onHoverInfo, overlays }: SceneCallbacks & { overlays: CommOverlays }) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);   // which NPU's die is enlarged
  const S = S_NODE;
  const w = NODE_DIM.w * S, h = NODE_DIM.h * S, d = NODE_DIM.d * S;
  const selColor = COMM_PATTERNS[2].color;

  // leader line from the selected NPU to the die inset
  const leaderGeo = useMemo(() => {
    const npu = NODE_PARTS.filter((p) => p.type === 'npu')[selected];
    const a: [number, number, number] = [npu.pos[0] * S, 0.06 * S + 0.5, npu.pos[2] * S];
    const b: [number, number, number] = [DIE.pos[0] - DIE.w / 2, DIE.pos[1] + 0.2, DIE.pos[2]];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b], 3));
    return g;
  }, [selected, S]);

  return (
    <group>
      <Floor size={10} />
      <group position={[0, 0.5, 0]}>
        <group
          onPointerOver={(e) => { e.stopPropagation(); onHoverInfo(`节点托盘 · 全宽液冷刀片 · ${NPUS_PER_NODE}× NPU + CPU + 板载 UB fabric`); }}
          onPointerOut={() => onHoverInfo(null)}
        >
          <Slab size={[w + 0.12, 0.04, d + 0.12]} position={[0, -0.02, 0]} color={LC.rackBody} metalness={0.6} roughness={0.45} edgeColor={LC.rackEdge} />
          {[-1, 1].map((s) => (
            <Slab key={'w' + s} size={[0.03, h * 0.9, d + 0.12]} position={[s * (w / 2 + 0.045), h * 0.43, 0]} color={LC.rackDoor} metalness={0.6} roughness={0.45} />
          ))}
        </group>
        <mesh
          position={[0, 0.012, 0]}
          onPointerOver={(e) => { e.stopPropagation(); onHoverInfo(`节点主板 PCB · 板载 ${TOK.ub} L1 UB 2D-Mesh fabric（蓝=L1）`); }}
          onPointerOut={() => onHoverInfo(null)}
        >
          <boxGeometry args={[w, 0.018, d]} />
          <meshStandardMaterial color={LC.pcb} metalness={0.1} roughness={0.85} />
        </mesh>
        {NODE_PARTS.map((p) => (
          <NodePartMesh
            key={p.id}
            part={p}
            hovered={hoverId === p.id}
            selected={p.type === 'npu' && p.npuIdx === selected}
            onSelect={p.type === 'npu' ? () => setSelected(p.npuIdx!) : undefined}
            onHover={(hv) => {
              setHoverId(hv ? p.id : null);
              onHoverInfo(hv ? (p.type === 'npu' ? `${p.label}（点击放大该 die 算子视图 →）` : p.label) : null);
            }}
          />
        ))}
        {/* node-internal UB 2D-mesh (L1 board fabric) */}
        <BoardMesh />
      </group>
      {/* leader: selected NPU → die inset */}
      <lineSegments geometry={leaderGeo}><lineBasicMaterial color={selColor} transparent opacity={0.8} /></lineSegments>
      {/* enlarged single-die compute detail of the selected NPU */}
      <DieDetail npuIdx={selected} overlays={overlays} onHoverInfo={onHoverInfo} />
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. UB interconnect hierarchy (L0 → L4)
// ═══════════════════════════════════════════════════════════════════════════

const HT = {
  y: [0.4, 1.5, 2.7, 4.0, 5.3],   // tier Y per level
  xSpan: 9.5,
};

export function TopologyScene({ gen, overlays, onHoverInfo }: SceneCallbacks & { gen: GenSpec; overlays: CommOverlays }) {
  const [hov, setHov] = useState<number | null>(null);

  // node-tier sample positions (8 NPU dots) for L0/L1 illustration
  const dieX = (i: number) => (i / 7 - 0.5) * 2.2;
  // rank dots at the L1 tier (one process / rank per NPU)
  const rankX = (i: number) => (i / 7 - 0.5) * 2.6;

  // ── process(rank) + thread comm overlays ──
  const ringGeo = useMemo(() => {
    const seg: number[] = [];
    const order = [0, 1, 2, 3, 7, 6, 5, 4];   // snake ring over the 2×4 rank grid
    const y = HT.y[1] + 0.18;
    for (let k = 0; k < order.length; k++) {
      const a = order[k], b = order[(k + 1) % order.length];
      seg.push(rankX(a), y, 0.16, rankX(b), y, 0.16);
    }
    return segGeo(seg);
  }, []);

  const a2aGeo = useMemo(() => {
    const seg: number[] = [];
    const y = HT.y[1] + 0.18;
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) seg.push(rankX(i), y, -0.16, rankX(j), y, -0.16);
    return segGeo(seg);
  }, []);

  // counts text per level
  const levelInfo = (lvl: number): string => {
    switch (lvl) {
      case 0: return `L0 片内：${TOK.ascend} ${gen.npuShort} 封装内 ${DIES_PER_NPU} die · die 间 UB/SIO 直连 · ${UB_LEVELS[0].detail}`;
      case 1: return `L1 节点内：${NPUS_PER_NODE}× NPU 板载 UB 2D-Mesh 直连 · 单 NPU ${gen.chipUbTBs} TB/s`;
      case 2: return `L2 机柜内：8 节点 / 64 NPU 跨节点 ${TOK.fullmesh} 总线级直连`;
      case 3: return `L3 ${TOK.supernode}内：${gen.computeCabs} 计算柜 + ${gen.commCabs} 通信柜 Clos · ${gen.totalNpus} NPU 全互联 · ${gen.interconnectPBs} PB/s`;
      case 4: return `L4 ${TOK.supernode}间：${TOK.supercluster} scale-out · ${gen.superclusterNpu}卡（全光 UBoE）`;
      default: return '';
    }
  };

  // connecting lines between adjacent tiers, coloured by upper level
  const linkGeo = useMemo(() => {
    const seg: number[] = [];
    // L0→L1: 8 dies up to node bar
    for (let i = 0; i < 8; i++) seg.push(dieX(i), HT.y[0] + 0.1, 0, dieX(i), HT.y[1] - 0.05, 0);
    return segGeo(seg);
  }, []);

  const Tier = ({ lvl, children }: { lvl: number; children?: ReactNode }) => {
    const isH = hov === lvl;
    return (
      <group
        position={[0, HT.y[lvl], 0]}
        onPointerOver={(e) => { e.stopPropagation(); setHov(lvl); setCursor(true); onHoverInfo(levelInfo(lvl)); }}
        onPointerOut={() => { setHov(null); setCursor(false); onHoverInfo(null); }}
      >
        {children}
        <Text position={[-HT.xSpan / 2 - 0.3, 0, 0]} fontSize={0.2} color={isH ? L(lvl) : LC.textDim} anchorX="right" anchorY="middle" maxWidth={3}>
          {`${UB_LEVELS[lvl].id} ${UB_LEVELS[lvl].label}`}
        </Text>
        <Text position={[HT.xSpan / 2 + 0.3, 0, 0]} fontSize={0.16} color={isH ? L(lvl) : LC.textDim} anchorX="left" anchorY="middle" maxWidth={5}>
          {lvl === 3 ? `${gen.totalNpus} NPU · ${gen.interconnectPBs} PB/s` : lvl === 4 ? `${gen.superclusterNpu}卡` : lvl === 0 ? `${DIES_PER_NPU} die/pkg` : lvl === 1 ? `${NPUS_PER_NODE}× NPU` : '64 NPU/柜'}
        </Text>
      </group>
    );
  };

  return (
    <group>
      <Floor size={16} />

      {/* L0 — dies (8 NPU × dies) */}
      <Tier lvl={0}>
        {Array.from({ length: 8 }, (_, i) => (
          <group key={i} position={[dieX(i), 0, 0]}>
            {Array.from({ length: DIES_PER_NPU }, (_, dd) => (
              <Slab key={dd} size={[0.09, 0.09, 0.12]} position={[(dd - (DIES_PER_NPU - 1) / 2) * 0.11, 0, 0]} color={L(0)} emissive={L(0)} emissiveIntensity={hov === 0 ? 0.8 : 0.4} />
            ))}
          </group>
        ))}
      </Tier>
      <lineSegments geometry={linkGeo}><lineBasicMaterial color={L(1)} transparent opacity={0.5} /></lineSegments>

      {/* L1 — node bar with 8 NPU + 2D-mesh */}
      <Tier lvl={1}>
        <Slab size={[3.0, 0.14, 0.5]} color={'#e8ebf1'} edgeColor={hov === 1 ? L(1) : LC.rackEdge} />
        {Array.from({ length: 8 }, (_, i) => (
          <Slab key={i} size={[0.12, 0.16, 0.16]} position={[(i / 7 - 0.5) * 2.6, 0.05, 0]} color={L(1)} emissive={L(1)} emissiveIntensity={hov === 1 ? 0.8 : 0.4} />
        ))}
      </Tier>

      {/* L2 — rack-level full mesh: 8 node bars + all-pairs lines */}
      <Tier lvl={2}>
        {(() => {
          const N = 8, xs = Array.from({ length: N }, (_, i) => (i / (N - 1) - 0.5) * HT.xSpan * 0.78);
          const seg: number[] = [];
          for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) seg.push(xs[i], 0.02, 0.18, xs[j], 0.02, 0.18);
          return (
            <group>
              {xs.map((x, i) => (
                <Slab key={i} size={[0.5, 0.16, 0.34]} position={[x, 0, 0.18]} color={'#efe7fb'} edgeColor={hov === 2 ? L(2) : LC.rackEdge} />
              ))}
              <lineSegments geometry={segGeo(seg)}><lineBasicMaterial color={L(2)} transparent opacity={hov === 2 ? 0.85 : 0.4} /></lineSegments>
            </group>
          );
        })()}
      </Tier>

      {/* L3 — pod-level Clos: compute block + comms switch bar */}
      <Tier lvl={3}>
        <Slab size={[HT.xSpan * 0.9, 0.18, 0.55]} color={L(3)} opacity={hov === 3 ? 0.7 : 0.4} emissive={L(3)} emissiveIntensity={hov === 3 ? 0.4 : 0.18} />
        {Array.from({ length: 16 }, (_, i) => (
          <Slab key={i} size={[0.22, 0.3, 0.62]} position={[(i - 7.5) * (HT.xSpan * 0.9 / 16.5), 0, 0]} color={L(3)} emissive={L(3)} emissiveIntensity={hov === 3 ? 0.6 : 0.3} />
        ))}
      </Tier>

      {/* L4 — cluster scale-out */}
      <Tier lvl={4}>
        <Slab size={[HT.xSpan * 0.72, 0.14, 0.5]} color={L(4)} opacity={hov === 4 ? 0.7 : 0.38} emissive={L(4)} emissiveIntensity={hov === 4 ? 0.4 : 0.16} />
      </Tier>

      {/* tier-to-tier vertical connectors (L1..L4) */}
      {[1, 2, 3].map((lvl) => (
        <mesh key={lvl} position={[0, (HT.y[lvl] + HT.y[lvl + 1]) / 2, 0]}>
          <boxGeometry args={[0.04, HT.y[lvl + 1] - HT.y[lvl] - 0.3, 0.04]} />
          <meshBasicMaterial color={L(lvl + 1)} transparent opacity={0.5} />
        </mesh>
      ))}

      {/* ── process(rank) comm overlays (toggled in toolbar) ── */}
      {overlays.a2a && (
        <group
          onPointerOver={(e) => { e.stopPropagation(); onHoverInfo(`进程级 All-to-All（MoE 专家并行）：rank 间全互联，经 L1/L2 UB 直连 + L3 Clos`); }}
          onPointerOut={() => onHoverInfo(null)}
        >
          <lineSegments geometry={a2aGeo}><lineBasicMaterial color={COMM_PATTERNS[1].color} transparent opacity={0.4} /></lineSegments>
          <Text position={[rankX(7) + 0.4, HT.y[1] + 0.18, -0.16]} fontSize={0.14} color={COMM_PATTERNS[1].color} anchorX="left">All-to-All</Text>
        </group>
      )}
      {overlays.ring && (
        <group
          onPointerOver={(e) => { e.stopPropagation(); onHoverInfo(`进程级 Ring-AllReduce（数据并行梯度规约）：rank 环形通信，沿 UB 2D-Mesh`); }}
          onPointerOut={() => onHoverInfo(null)}
        >
          <lineSegments geometry={ringGeo}><lineBasicMaterial color={COMM_PATTERNS[0].color} transparent opacity={0.9} /></lineSegments>
          <Text position={[rankX(7) + 0.4, HT.y[1] + 0.18, 0.16]} fontSize={0.14} color={COMM_PATTERNS[0].color} anchorX="left">Ring AllReduce</Text>
        </group>
      )}

      <Text position={[0, 0.04, 2.4]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.2} color={LC.textDim} anchorX="center">
        {`${TOK.ubmesh} 互联层级 · ${gen.code} ${gen.name} · 悬停查看各级带宽 · 顶栏开关叠加进程级通信`}
      </Text>
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. UB adjacency matrix (NPU × NPU, recursive full-mesh)
// ═══════════════════════════════════════════════════════════════════════════

/** Thin cylinder link between two points (for emphasised pair). */
function LinkTube({ a, b, color, r = 0.025 }: { a: [number, number, number]; b: [number, number, number]; color: string; r?: number }) {
  const { pos, quat, len } = useMemo(() => {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const dir = vb.clone().sub(va);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    return { pos: va.clone().add(vb).multiplyScalar(0.5), quat: q, len };
  }, [a, b]);
  return (
    <mesh position={pos} quaternion={quat}>
      <cylinderGeometry args={[r, r, len, 10]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  );
}

const MAT_SPAN = 3.8;       // upright matrix footprint
const MAT_POS: [number, number, number] = [-3.7, 2.2, 0];
const MODEL_POS: [number, number, number] = [3.3, 0.5, 0];

export function AdjacencyScene({ scale, onHoverInfo }: SceneCallbacks & { scale: Scale }) {
  const dims = SCALES[scale].dims;
  const { n, cell } = useMemo(() => makeAdjacency(dims), [dims]);
  const ref = useRef<THREE.InstancedMesh>(null);
  const modelRef = useRef<THREE.InstancedMesh>(null);
  const lastMat = useRef(-1);     // guard: only setState when hovered cell changes
  const lastModel = useRef(-1);
  const [hoverCell, setHoverCell] = useState<[number, number] | null>(null);  // from matrix
  const [hoverNpu, setHoverNpu] = useState<number | null>(null);              // from 3D model

  // unified highlight: rows/cols to guide in matrix, NPUs to emphasise in model
  const hi = useMemo(() => {
    if (hoverCell) return { rows: [hoverCell[0]], cols: [hoverCell[1]], npus: [hoverCell[0], hoverCell[1]] as number[], pair: hoverCell };
    if (hoverNpu !== null) return { rows: [hoverNpu], cols: [hoverNpu], npus: [hoverNpu], pair: null as [number, number] | null };
    return { rows: [] as number[], cols: [] as number[], npus: [] as number[], pair: null as [number, number] | null };
  }, [hoverCell, hoverNpu]);

  // ── matrix geometry (upright XY plane) ──
  const cellSize = MAT_SPAN / n;
  const colX = (j: number) => -MAT_SPAN / 2 + cellSize * (j + 0.5);
  const rowY = (i: number) => MAT_SPAN / 2 - cellSize * (i + 0.5);   // row 0 at top

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    const cSelf = new THREE.Color('#3a4256');
    const cIndirect = new THREE.Color('#e2e6ec');
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const idx = i * n + j;
        m.makeScale(cellSize * 0.9, cellSize * 0.9, 1);
        m.setPosition(colX(j), rowY(i), 0);
        mesh.setMatrixAt(idx, m);
        const a = cell(i, j);
        if (a.hops === 0) col.copy(cSelf);
        else if (a.direct) col.set(L(a.level));
        else col.copy(cIndirect);
        mesh.setColorAt(idx, col);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [n, cell, cellSize]);

  // ── 3D scale model positions (boards × 8 NPU) ──
  const { posArr, links } = useMemo(() => {
    const perBoard = dims[0], boards = dims[1];
    const bcols = boards <= 2 ? boards : (boards <= 4 ? 2 : 4);
    const lc4 = 4, npuP = 0.34, gapX = 0.5, gapY = 0.55;
    const boardW = lc4 * npuP + gapX, boardH = 2 * npuP + gapY;
    const P: [number, number, number][] = [];
    for (let k = 0; k < n; k++) {
      const b = Math.floor(k / perBoard), l = k % perBoard;
      const bc = b % bcols, br = Math.floor(b / bcols);
      const lcx = l % lc4, lcy = Math.floor(l / lc4);
      P.push([bc * boardW + lcx * npuP, br * boardH + lcy * npuP, 0]);
    }
    // centre
    const mx = (Math.min(...P.map(p => p[0])) + Math.max(...P.map(p => p[0]))) / 2;
    const my = (Math.min(...P.map(p => p[1])) + Math.max(...P.map(p => p[1]))) / 2;
    for (const p of P) { p[0] -= mx; p[1] -= my; }
    // direct UB links by level
    const l1: number[] = [], l2: number[] = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = cell(i, j);
      if (!a.direct) continue;
      const arr = a.level <= 1 ? l1 : l2;
      arr.push(...P[i], ...P[j]);
    }
    const g = (s: number[]) => { const x = new THREE.BufferGeometry(); x.setAttribute('position', new THREE.Float32BufferAttribute(s, 3)); return x; };
    return { posArr: P, links: { l1: g(l1), l2: g(l2) } };
  }, [dims, n, cell]);

  const boardOf = (k: number) => Math.floor(k / dims[0]);
  const localOf = (k: number) => k % dims[0];

  // model instance transforms + colours (recomputed only when highlight changes)
  useLayoutEffect(() => {
    const mesh = modelRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    const base = new THREE.Color(LC.npuBody);
    for (let k = 0; k < n; k++) {
      const on = hi.npus.includes(k);
      const s = on ? 0.22 : 0.13;
      m.makeScale(s, s, s);
      m.setPosition(posArr[k][0], posArr[k][1], posArr[k][2]);
      mesh.setMatrixAt(k, m);
      if (on) {
        const lvl = hi.pair ? cell(hi.pair[0], hi.pair[1]).level : 1;
        col.set(L(lvl));
      } else col.copy(base);
      mesh.setColorAt(k, col);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [posArr, hi, n, cell]);

  return (
    <group>
      <Floor size={16} />

      {/* ── left: upright adjacency matrix ── */}
      <group position={MAT_POS}>
        <instancedMesh
          ref={ref}
          args={[undefined, undefined, n * n]}
          onPointerMove={(e) => {
            e.stopPropagation();
            const id = e.instanceId;
            if (id === undefined || id === lastMat.current) return;   // only on cell change
            lastMat.current = id;
            const i = Math.floor(id / n), j = id % n;
            setHoverCell([i, j]); setHoverNpu(null);
            const a = cell(i, j);
            const desc = a.hops === 0 ? '对角（自身）'
              : a.direct ? `直连 · ${UB_LEVELS[a.level].id} ${UB_LEVELS[a.level].label}`
              : `多跳 ×${a.hops}（经 ${UB_LEVELS[a.level].id}）`;
            onHoverInfo(`NPU ${i} ↔ NPU ${j}：${desc}（右侧 3D 同步高亮）`);
          }}
          onPointerOut={() => { lastMat.current = -1; setHoverCell(null); onHoverInfo(null); }}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial toneMapped={false} />
        </instancedMesh>
        {/* board boundary lines (every dims[0] cells) */}
        {Array.from({ length: dims[1] + 1 }, (_, b) => {
          const o = -MAT_SPAN / 2 + (MAT_SPAN / dims[1]) * b;
          return (
            <group key={b}>
              <mesh position={[0, o, 0.01]}><planeGeometry args={[MAT_SPAN, 0.01]} /><meshBasicMaterial color={LC.rackEdge} transparent opacity={0.5} /></mesh>
              <mesh position={[o, 0, 0.01]}><planeGeometry args={[0.01, MAT_SPAN]} /><meshBasicMaterial color={LC.rackEdge} transparent opacity={0.5} /></mesh>
            </group>
          );
        })}
        {/* hovered row(i)+col(j) crosshair; intersection = the hovered cell */}
        {hi.rows.map((i) => <mesh key={'r' + i} position={[0, rowY(i), 0.02]}><planeGeometry args={[MAT_SPAN, cellSize]} /><meshBasicMaterial color="#4369ef" transparent opacity={0.16} /></mesh>)}
        {hi.cols.map((j) => <mesh key={'c' + j} position={[colX(j), 0, 0.02]}><planeGeometry args={[cellSize, MAT_SPAN]} /><meshBasicMaterial color="#4369ef" transparent opacity={0.16} /></mesh>)}
        {/* bright marker at the hovered cell (i,j) + i/j end labels */}
        {hi.pair && (
          <group>
            <mesh position={[colX(hi.pair[1]), rowY(hi.pair[0]), 0.03]}><planeGeometry args={[cellSize, cellSize]} /><meshBasicMaterial color="#ffffff" transparent opacity={0.55} /></mesh>
            <Text position={[-MAT_SPAN / 2 - 0.12, rowY(hi.pair[0]), 0.03]} fontSize={0.14} color="#4369ef" anchorX="right">{`i=${hi.pair[0]}`}</Text>
            <Text position={[colX(hi.pair[1]), MAT_SPAN / 2 + 0.12, 0.03]} fontSize={0.14} color="#4369ef" anchorX="center">{`j=${hi.pair[1]}`}</Text>
          </group>
        )}
        <Text position={[0, MAT_SPAN / 2 + 0.3, 0]} fontSize={0.22} color={LC.text} anchorX="center">{`${n}×${n} NPU UB 邻接矩阵`}</Text>
        <Text position={[0, -MAT_SPAN / 2 - 0.28, 0]} fontSize={0.15} color={LC.textDim} anchorX="center">NPU j →</Text>
        <Text position={[-MAT_SPAN / 2 - 0.28, 0, 0]} rotation={[0, 0, Math.PI / 2]} fontSize={0.15} color={LC.textDim} anchorX="center">NPU i →</Text>
      </group>

      {/* ── right: 3D scale model (boards × 8 NPU) with UB links ── */}
      <group position={MODEL_POS}>
        <lineSegments geometry={links.l1}><lineBasicMaterial color={L(1)} transparent opacity={hi.npus.length ? 0.15 : 0.45} /></lineSegments>
        <lineSegments geometry={links.l2}><lineBasicMaterial color={L(2)} transparent opacity={hi.npus.length ? 0.1 : 0.3} /></lineSegments>
        {/* NPUs as a single instanced mesh (perf) */}
        <instancedMesh
          ref={modelRef}
          args={[undefined, undefined, n]}
          onPointerMove={(e) => {
            e.stopPropagation();
            const k = e.instanceId;
            if (k === undefined || k === lastModel.current) return;
            lastModel.current = k;
            setHoverNpu(k); setHoverCell(null);
            onHoverInfo(`NPU ${k}（板 ${boardOf(k)} · 本地 ${localOf(k)}）：板内→L1，跨板→L2（左侧矩阵同步高亮行列）`);
          }}
          onPointerOut={() => { lastModel.current = -1; setHoverNpu(null); onHoverInfo(null); }}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial metalness={0.3} roughness={0.5} toneMapped={false} />
        </instancedMesh>
        {/* emphasised pair link + i/j tags on the two NPUs */}
        {hi.pair && hi.pair[0] !== hi.pair[1] && cell(hi.pair[0], hi.pair[1]).direct && (
          <LinkTube a={posArr[hi.pair[0]]} b={posArr[hi.pair[1]]} color={L(cell(hi.pair[0], hi.pair[1]).level)} />
        )}
        {hi.pair && hi.pair[0] !== hi.pair[1] && (
          <group>
            <Text position={[posArr[hi.pair[0]][0], posArr[hi.pair[0]][1] + 0.2, posArr[hi.pair[0]][2]]} fontSize={0.16} color="#4369ef" anchorX="center">i</Text>
            <Text position={[posArr[hi.pair[1]][0], posArr[hi.pair[1]][1] + 0.2, posArr[hi.pair[1]][2]]} fontSize={0.16} color="#4369ef" anchorX="center">j</Text>
          </group>
        )}
        <Text position={[0, 2.1, 0]} fontSize={0.22} color={LC.text} anchorX="center">{`${SCALES[scale].label} · 3D 结构（${dims[1]} 板 × ${dims[0]} NPU）`}</Text>
        <Text position={[0, -2.0, 0]} fontSize={0.14} color={LC.textDim} anchorX="center">{`${dims.join('×')} 递归 full-mesh · 蓝=L1 板内 · 紫=L2 跨板`}</Text>
      </group>

      <Text position={[0, 0.02, 4.4]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.22} color={LC.textDim} anchorX="center">
        {`${SCALES[scale].label} 邻接矩阵 ↔ 3D 结构联动 · 悬停任一侧，另一侧同步高亮`}
      </Text>
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. UB switch device (communication-cabinet switch box internals)
// ═══════════════════════════════════════════════════════════════════════════

export function UBSwitchScene({ onHoverInfo }: SceneCallbacks) {
  const [hov, setHov] = useState<string | null>(null);
  const S = 2.4;
  const W = 1.15 * S, H = 0.3 * S, D = 0.62 * S;
  const sw = L(3);   // Clos-level (orange)

  return (
    <group>
      <Floor size={10} />
      <pointLight position={[0, 4.2, 6]} intensity={14} color="#ffffff" />
      <group position={[0, 0.55, 0]}>
        {/* chassis tray */}
        <group onPointerOver={(e) => { e.stopPropagation(); onHoverInfo(`${TOK.ub} 交换设备机箱 · 安装于通信柜 · 冷板式液冷`); }} onPointerOut={() => onHoverInfo(null)}>
          <Slab size={[W + 0.1, 0.05, D + 0.1]} position={[0, -0.02, 0]} color={LC.rackBody} metalness={0.5} roughness={0.5} edgeColor={LC.rackEdge} />
        </group>
        {/* PCB */}
        <mesh position={[0, 0.012, 0]} onPointerOver={(e) => { e.stopPropagation(); onHoverInfo('交换主板 PCB · 承载 HRS / LRS 交换 ASIC'); }} onPointerOut={() => onHoverInfo(null)}>
          <boxGeometry args={[W, 0.022, D]} />
          <meshStandardMaterial color={LC.pcb} metalness={0.1} roughness={0.85} />
        </mesh>
        {/* HRS high-radix switch (large, centre) */}
        <group position={[0, 0.04, -0.05 * S]}
          onPointerOver={(e) => { e.stopPropagation(); setHov('hrs'); onHoverInfo('HRS 高基数交换 ASIC · Clos 顶层核心 · All-Path-Routing 全路径路由'); }}
          onPointerOut={() => { setHov(null); onHoverInfo(null); }}>
          <Slab size={[0.4 * S, 0.09, 0.34 * S]} color={sw} emissive={sw} emissiveIntensity={hov === 'hrs' ? 1.0 : 0.4} metalness={0.3} roughness={0.45} edgeColor={hov === 'hrs' ? '#fff' : sw} />
          <Text position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.1} color="#fff" anchorX="center">HRS</Text>
        </group>
        {/* LRS low-radix switches (row of 4) */}
        {Array.from({ length: 4 }, (_, i) => {
          const id = `lrs-${i}`, isH = hov === id;
          return (
            <group key={id} position={[(i - 1.5) * 0.26 * S, 0.04, 0.16 * S]}
              onPointerOver={(e) => { e.stopPropagation(); setHov(id); onHoverInfo(`LRS 低基数交换 ASIC #${i + 1} · 汇聚计算柜上行 UB 流量`); }}
              onPointerOut={() => { setHov(null); onHoverInfo(null); }}>
              <Slab size={[0.16 * S, 0.07, 0.14 * S]} color="#f6a45a" emissive="#f6a45a" emissiveIntensity={isH ? 0.9 : 0.35} metalness={0.3} roughness={0.5} edgeColor={isH ? '#fff' : '#f6a45a'} />
              <Text position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.06} color="#5a3a10" anchorX="center">{`LRS${i + 1}`}</Text>
            </group>
          );
        })}
        {/* front optical port panel: 8 banks × 16 OSFP = 128×800GE */}
        <group position={[0, H / 2, D / 2 + 0.01]}
          onPointerOver={(e) => { e.stopPropagation(); onHoverInfo('前面板全光 OSFP 端口 · 128× 800GE · 8 组 × 16 口 · 接入计算柜上行光纤'); }}
          onPointerOut={() => onHoverInfo(null)}>
          {Array.from({ length: 8 }, (_, bank) => (
            <group key={bank} position={[(bank - 3.5) * W / 9, 0, 0]}>
              {Array.from({ length: 16 }, (_, j) => (
                <Slab key={j} size={[0.024 * S, 0.024 * S, 0.006]}
                  position={[(j % 4 - 1.5) * 0.03 * S, (Math.floor(j / 4) - 1.5) * 0.03 * S, 0]}
                  color={LC.vent} emissive="#fbbf24" emissiveIntensity={0.5} />
              ))}
            </group>
          ))}
        </group>
        {/* side liquid-cooling connectors */}
        {[-1, 1].map((side) => (
          <group key={side} position={[side * (W / 2 + 0.02), H / 4, 0]}
            onPointerOver={(e) => { e.stopPropagation(); onHoverInfo('液冷快接头 ×4 · 冷板式进 / 回水 · 盲插免工具'); }}
            onPointerOut={() => onHoverInfo(null)}>
            {Array.from({ length: 4 }, (_, i) => (
              <mesh key={i} position={[0, 0, (i - 1.5) * D / 5]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.026 * S, 0.026 * S, 0.03, 14]} />
                <meshStandardMaterial color="#6b9fd4" metalness={0.7} roughness={0.3} />
              </mesh>
            ))}
          </group>
        ))}
        {/* chassis outline */}
        <Slab size={[W, H, D]} position={[0, H / 2, 0]} color={LC.rackBody} opacity={0.16} edgeColor={LC.rackEdge} />
        {/* level strip */}
        <Slab size={[W * 0.5, 0.02, 0.01]} position={[0, H + 0.02, D / 2 + 0.004]} color={sw} emissive={sw} emissiveIntensity={0.7} />
        <Text position={[0, H + 0.16, D / 2 + 0.04]} fontSize={0.11} color={LC.text} anchorX="center">
          {`${TOK.ub} 交换设备 · HRS + LRS · 128×800GE 全光 · L3 Clos 顶层`}
        </Text>
        <Text position={[0, H + 0.04, D / 2 + 0.04]} fontSize={0.08} color={LC.textDim} anchorX="center">
          {'All-Path-Routing 全路径路由 · 1:1 无阻塞 · 液冷'}
        </Text>
      </group>
    </group>
  );
}

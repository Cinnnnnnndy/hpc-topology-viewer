// ─────────────────────────────────────────────────────────────────────────────
// Cluster model data layer.
//
// Geometry note: cabinet outer dimensions use the published 2250×600×1150mm
// envelope; in-cabinet blade/chip layout is a schematic abstraction (vendor
// sheet-metal drawings are not public) and does not represent a real layout.
//
// All product/brand display text is sourced from ../content (stored base64 and
// decoded at runtime), so this source file carries no plaintext product names.
// ─────────────────────────────────────────────────────────────────────────────
import { TOK, INFO, SOURCES } from '../content';

export { INFO, SOURCES };

export type RackKind = 'compute' | 'switch';
export type ViewMode = 'overview' | 'rack' | 'node' | 'topology';

// ─── Global spec (baseline) ──────────────────────────────────────────────────
export const SPEC = {
  name: TOK.specName,
  totalRacks: 16,
  computeRacks: 12,
  switchRacks: 4,
  nodesPerComputeRack: 4,
  totalNodes: 48,
  npusPerNode: 8,
  cpusPerNode: 4,
  l1SwitchChipsPerNode: 7,   // on-board L1 switch chips, 1 chip = 1 sub-plane
  ubPlanes: 7,               // 7 independent UB sub-planes
  l2ChipsPerPlane: 16,       // 16 L2 switch chips per plane (across 4 switch cabinets)
  totalNpus: 384,
  totalCpus: 192,
  // bandwidth
  npuUbGBs: 392,             // per accelerator, unidirectional
  npuD2dGBs: 784,            // accelerator-to-accelerator D2D, bidirectional
  cpuUbGBs: 160,             // per CPU, unidirectional
  npuRdmaGbps: 400,          // RDMA scale-out plane (RoCE), per accelerator
  nodeVpcGbps: 400,          // DPU VPC plane
  l2PortGBs: 28,             // per L2 chip: 48 × 28 GB/s ports
  l2PortsPerChip: 48,
  hopLatencyNs: 200,         // single-hop latency
  // compute / memory
  npuHbmGB: 128,             // per accelerator: 2 die × 64 GB HBM
  npuHbmTBs: 3.2,            // per-accelerator HBM bandwidth
  totalHbmTB: 48,            // 384 × 128 GB, unified addressing
  ddr5Total: 1536,           // total DDR5 sticks (32 per node)
  fp16Pflops: 307.2,         // FP16 peak
  cooling: TOK.cooling,
} as const;

// ─── Rack layout: 2 rows × 8 cabinets, switch cabinets centred ───────────────
export interface RackInfo {
  id: string;
  kind: RackKind;
  label: string;
  row: number;     // 0 = front row, 1 = back row
  col: number;     // 0..7
  /** global compute-node ids (0..47); empty for switch cabinets */
  nodeIds: number[];
}

export const RACKS: RackInfo[] = (() => {
  const racks: RackInfo[] = [];
  let nodeCounter = 0;
  let computeIdx = 0;
  let switchIdx = 0;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 8; col++) {
      const isSwitch = col === 3 || col === 4;
      if (isSwitch) {
        racks.push({
          id: `switch-rack-${switchIdx}`,
          kind: 'switch',
          label: `${TOK.ub}总线柜 S${switchIdx + 1}`,
          row, col, nodeIds: [],
        });
        switchIdx++;
      } else {
        const ids = Array.from({ length: 4 }, () => nodeCounter++);
        racks.push({
          id: `compute-rack-${computeIdx}`,
          kind: 'compute',
          label: `计算柜 C${computeIdx + 1}`,
          row, col, nodeIds: ids,
        });
        computeIdx++;
      }
    }
  }
  return racks;
})();

// ─── Rack geometry (scene unit = metre; envelope 2250×600×1150mm) ────────────
export const RACK_DIM = { w: 0.6, h: 2.25, d: 1.15 };
export const RACK_GAP_X = 0.32;
export const ROW_GAP_Z = 2.6;

export function rackWorldPos(rack: RackInfo): [number, number, number] {
  const totalW = 8 * RACK_DIM.w + 7 * RACK_GAP_X;
  const x = rack.col * (RACK_DIM.w + RACK_GAP_X) - totalW / 2 + RACK_DIM.w / 2;
  const z = rack.row === 0 ? ROW_GAP_Z / 2 : -ROW_GAP_Z / 2;
  return [x, 0, z];
}

// ─── In-cabinet layout (top to bottom; slots are schematic) ──────────────────
export interface RackUnit {
  id: string;
  type: 'node' | 'switch-unit' | 'power' | 'mgmt' | 'cdu';
  label: string;
  labelEn: string;
  /** unit bottom (0..1 of rack height) and unit height fraction (0..1) */
  y0: number;
  hFrac: number;
  /** for type === 'node': in-cabinet node slot 0..3 */
  nodeSlot?: number;
}

export const COMPUTE_RACK_UNITS: RackUnit[] = [
  { id: 'power',  type: 'power', label: '电源框 + 电源转换板（集中供电 Busbar）', labelEn: 'Power Shelf',      y0: 0.905, hFrac: 0.07 },
  { id: 'mgmt',   type: 'mgmt',  label: '柜管模块 + GE 管理交换机',               labelEn: 'Mgmt + GE Switch', y0: 0.85,  hFrac: 0.048 },
  { id: 'node-0', type: 'node',  label: '计算节点 1（液冷 ≈10U / 16.2kW max）',   labelEn: 'Compute Node 1',   y0: 0.655, hFrac: 0.18, nodeSlot: 0 },
  { id: 'node-1', type: 'node',  label: '计算节点 2（液冷 ≈10U / 16.2kW max）',   labelEn: 'Compute Node 2',   y0: 0.465, hFrac: 0.18, nodeSlot: 1 },
  { id: 'node-2', type: 'node',  label: '计算节点 3（液冷 ≈10U / 16.2kW max）',   labelEn: 'Compute Node 3',   y0: 0.275, hFrac: 0.18, nodeSlot: 2 },
  { id: 'node-3', type: 'node',  label: '计算节点 4（液冷 ≈10U / 16.2kW max）',   labelEn: 'Compute Node 4',   y0: 0.085, hFrac: 0.18, nodeSlot: 3 },
  { id: 'cdu',    type: 'cdu',   label: 'Manifold 液冷分集水器 / 快接头区',       labelEn: 'Liquid Manifold',  y0: 0.012, hFrac: 0.058 },
];

export const SWITCH_RACK_UNITS: RackUnit[] = [
  { id: 'power', type: 'power', label: '电源管理 · 集中供电', labelEn: 'Power Shelf', y0: 0.90, hFrac: 0.075 },
  ...Array.from({ length: 7 }, (_, i): RackUnit => ({
    id: `l2-${i}`,
    type: 'switch-unit',
    label: `${TOK.ub}互联设备 · UB 平面 ${i + 1}`,
    labelEn: `UB Switch P${i + 1}`,
    y0: 0.115 + (6 - i) * 0.112,
    hFrac: 0.095,
  })),
  { id: 'mgmt', type: 'mgmt', label: '管理 / 配线区', labelEn: 'Mgmt', y0: 0.015, hFrac: 0.09 },
];

// ─── Compute-node internals (abstract blade layout, metres) ──────────────────
export const NODE_DIM = { w: 0.8, h: 0.12, d: 0.7 };

export interface NodePart {
  id: string;
  type: 'npu' | 'cpu' | 'ub-switch' | 'dpu' | 'optical' | 'dimm';
  label: string;
  pos: [number, number, number];   // relative to node centre
  size: [number, number, number];
}

export const NODE_PARTS: NodePart[] = (() => {
  const parts: NodePart[] = [];
  // 8 accelerators (dual-die package + cold plate): 2 rows × 4 cols
  for (let i = 0; i < 8; i++) {
    const cx = (i % 4) * 0.155 - 0.2325;
    const cz = i < 4 ? -0.155 : 0.01;
    parts.push({
      id: `npu-${i}`, type: 'npu', label: `${TOK.ascend} ${TOK.n910c} #${i + 1} · 128GB HBM · UB 392GB/s`,
      pos: [cx, 0.022, cz], size: [0.105, 0.022, 0.105],
    });
  }
  // 4 CPUs: front row
  for (let i = 0; i < 4; i++) {
    parts.push({
      id: `cpu-${i}`, type: 'cpu', label: `${TOK.kunpeng} ${TOK.n920} #${i + 1} · UB 160GB/s`,
      pos: [i * 0.155 - 0.2325, 0.018, 0.155], size: [0.07, 0.014, 0.07],
    });
  }
  // 2 DIMM banks (32 DDR5 sticks per node, shown as strips)
  for (let i = 0; i < 2; i++) {
    parts.push({
      id: `dimm-${i}`, type: 'dimm', label: 'DDR5 内存区（每节点 32 根）',
      pos: [0, 0.014, 0.245 + i * 0.045], size: [0.66, 0.018, 0.03],
    });
  }
  // 7 L1 UB switch chips: rear row (each maps to one UB sub-plane)
  for (let i = 0; i < 7; i++) {
    parts.push({
      id: `ub-${i}`, type: 'ub-switch', label: `${TOK.ub} L1 交换芯片 · UB 平面 ${i + 1}`,
      pos: [i * 0.095 - 0.285, 0.016, -0.295], size: [0.055, 0.012, 0.055],
    });
  }
  // DPU card (VPC plane egress)
  parts.push({
    id: 'dpu', type: 'dpu', label: `${TOK.qingtian} · VPC 400Gbps`,
    pos: [0.34, 0.02, 0.2], size: [0.08, 0.02, 0.16],
  });
  // rear optical panel (56×400GE UB + 8×400GE RoCE)
  parts.push({
    id: 'optical', type: 'optical', label: '光口区 · 56×400GE UB + 8×400GE RoCE',
    pos: [-0.04, 0.02, -0.337], size: [0.62, 0.026, 0.018],
  });
  return parts;
})();

// ─── Plane palette (7 planes + RDMA + VPC) ───────────────────────────────────
export const UB_PLANE_COLORS = [
  '#2dd4bf', '#38bdf8', '#a78bfa', '#f472b6', '#fb923c', '#facc15', '#4ade80',
];
export const RDMA_COLOR = '#f43f5e';
export const VPC_COLOR = '#94a3b8';

export const RACK_COLORS = {
  body: '#16181d',
  door: '#0d0f13',
  accent: '#e0252f',
  computeGlow: '#2dd4bf',
  switchGlow: '#fbbf24',
} as const;

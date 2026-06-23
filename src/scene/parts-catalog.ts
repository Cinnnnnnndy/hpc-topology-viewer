// ─────────────────────────────────────────────────────────────────────────────
// Parts catalog — the swap-able 3D parts and where they appear.
//
// This is the "shopping list" that maps a generic, BRAND-FREE part id to:
//   • a human label + the real-world reference size (mm) you should look for
//   • the optional load-time rotation needed to align a downloaded model
//   • which views currently use it (so you know what a swap will change)
//
// Drop  src/scene/models/<id>.glb  and the part auto-loads (see model-registry).
// Filenames here are intentionally free of product / brand names so the
// committed tree (and built bundle) stays scrape-clean, matching this repo's
// content-encoding design. See models/README.md for the download guide.
// ─────────────────────────────────────────────────────────────────────────────

/** 'contain' = uniform scale to fit inside the slot (no distortion, default).
 *  'stretch' = per-axis scale to exactly fill the slot (may distort). */
export type FitMode = 'contain' | 'stretch';

export interface CatalogPart {
  /** model filename stem: models/<id>.glb */
  id: string;
  /** short human label (no brand names) */
  label: string;
  /** real-world reference dimensions in mm [w, h, d] — for picking a model; the
   *  loader auto-fits to the on-screen slot, so exact size is informational. */
  realMM: [number, number, number];
  /** load-time Euler rotation (deg) applied BEFORE auto-fit, to fix orientation.
   *  World axes: Y up, Z = front→back, X = left→right. */
  modelRotationDeg?: [number, number, number];
  /** how the model fills its slot (default 'contain'). Use 'stretch' when a
   *  generic box should fill a slot of different proportions (e.g. a tray). */
  fit?: FitMode;
  /** views that render this part */
  usedIn: string[];
  /** search hints / suggested sources */
  hint: string;
}

export const PARTS_CATALOG: CatalogPart[] = [
  {
    id: 'npu-accelerator-module',
    label: 'NPU 加速模组（OAM / 夹层卡）',
    realMM: [102, 50, 165],
    usedIn: ['节点视图', 'UB 互联层级 (L0/L1)', '邻接矩阵', '阵列全景'],
    hint: 'Sketchfab/GrabCAD: "OAM module", "GPU accelerator module", "AI accelerator OAM" · 选 CC-BY/CC0',
  },
  {
    id: 'cpu-server-package',
    label: '服务器 CPU 封装（LGA）',
    realMM: [52, 5, 45],
    modelRotationDeg: [90, 0, 0],
    usedIn: ['节点视图'],
    hint: 'Sketchfab/GrabCAD: "server CPU", "LGA CPU package", "datacenter processor"',
  },
  {
    id: 'mem-ddr5-rdimm',
    label: 'DDR5 RDIMM 内存条',
    realMM: [133, 31, 4],
    modelRotationDeg: [0, 0, 0],
    usedIn: ['节点视图'],
    hint: 'KiCad kicad-packages3D / GrabCAD: "DDR5 RDIMM", "DIMM 288-pin"',
  },
  {
    id: 'optic-osfp-module',
    label: '光模块 / OSFP 收发器',
    realMM: [100, 17, 22],
    usedIn: ['节点视图（光口区）', 'UB 交换设备'],
    hint: 'TraceParts/GrabCAD: "OSFP", "QSFP-DD", "optical transceiver 800G"',
  },
  {
    id: 'dpu-nic-card',
    label: 'DPU / 网卡（PCIe 卡）',
    realMM: [167, 19, 69],
    usedIn: ['节点视图'],
    hint: 'GrabCAD/OCP: "PCIe NIC half height", "DPU card", "OCP 3.0 mezzanine"',
  },
  {
    id: 'compute-blade',
    label: '计算刀片 / 液冷节点托盘',
    realMM: [104, 34, 169],
    // current model is a compact box (deeper-than-wide); 'stretch' lets it fill
    // the wide, shallow blade slot. Switch to 'contain' if you swap in a real
    // wide rack-mount tray model (then it won't need distorting).
    fit: 'stretch',
    usedIn: ['机柜视图（节点槽）', 'UB 互联层级 (L2)', '阵列全景'],
    hint: 'GrabCAD: "server blade", "1U 2U liquid cooled tray", "GPU server tray"',
  },
  {
    id: 'cabinet-compute',
    label: '计算机柜（19" 整柜）',
    realMM: [600, 2235, 1200],
    usedIn: ['全景总览', 'UB 互联层级 (L3)'],
    hint: 'GrabCAD/OCP: "server rack 42U", "data center cabinet", "ORV3 rack" · 低面数优先（总览有上百个实例）',
  },
  {
    id: 'cabinet-switch',
    label: '通信柜（UB 交换整柜）',
    realMM: [600, 2235, 1200],
    usedIn: ['全景总览'],
    hint: '同计算机柜，可用同款换不同面板配色；低面数优先',
  },
  {
    id: 'ub-switch-line-card',
    label: 'UB 交换托盘 / 线卡',
    realMM: [500, 88, 700],
    usedIn: ['机柜视图（通信柜交换单元）'],
    hint: 'GrabCAD: "switch line card", "1U switch tray"',
  },
  {
    id: 'psu-crps-shelf',
    label: '电源框 / PSU（CRPS）',
    realMM: [440, 88, 700],
    usedIn: ['机柜视图（供电单元）'],
    hint: 'GrabCAD: "CRPS power supply", "server PSU", "power shelf"',
  },
  {
    id: 'cdu-liquid-manifold',
    label: '液冷分集水器 / CDU 歧管',
    realMM: [500, 200, 150],
    usedIn: ['机柜视图（液冷单元）'],
    hint: 'GrabCAD: "liquid cooling manifold", "CDU", "coolant distribution"',
  },
];

const byId: Record<string, CatalogPart> = Object.fromEntries(PARTS_CATALOG.map((p) => [p.id, p]));

/** Catalog lookup by id (undefined if not a known part). */
export function getPart(id: string): CatalogPart | undefined {
  return byId[id];
}

/** Load-time rotation (deg) for a part, or [0,0,0] if none configured. */
export function partRotationDeg(id: string): [number, number, number] {
  return byId[id]?.modelRotationDeg ?? [0, 0, 0];
}

/** Configured fit mode for a part, or 'contain' if none configured. */
export function partFit(id: string): FitMode {
  return byId[id]?.fit ?? 'contain';
}

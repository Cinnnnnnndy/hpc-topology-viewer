/**
 * layout — 立方体重排布局引擎（P1 · 5 种 3D 堆法，纯函数，不碰渲染）。
 *
 * 「切视图 = 换一种堆法」：同一批卡（rank），按不同并行轴重新排布到三维空间。
 * 5 种视图来自原型 HTML（chipCubeM v22），坐标直接以 THREE.js world unit 返回：
 *   standard    — 标准 3D 立方，X=TP · Y=PP · Z=DP，基准对照视图
 *   dp-tile     — DP 平铺，64 个副本排 8×8 宫格，每格内展示 TP×PP 竖板
 *   ep-cluster  — EP 聚簇，专家 Host 成墙 · 其余压缩块
 *   tp-slice    — TP 切片，8 张权重墙沿 X 展开
 *   pp-pipeline — PP 流水，16 段竖板沿 X（左→右流水）
 *
 * pos[rank] 直接是 Three.js 世界坐标（单位 = THREE.js unit），CubeField 不再乘 PITCH。
 * cols/rows 是 XZ 平面的世界空间跨度（用于相机取景）；yExtent 是 Y 轴跨度。
 */
import { deploymentOf } from './deployment';
import { NPUS_PER_NODE, type ParallelWorkload, type ParallelConfig } from './data';

export type LayoutView = 'standard' | 'dp-tile' | 'ep-cluster' | 'tp-slice' | 'pp-pipeline';
export const LAYOUT_VIEWS: LayoutView[] = ['standard', 'dp-tile', 'ep-cluster', 'tp-slice', 'pp-pipeline'];
export const LAYOUT_LABEL: Record<LayoutView, string> = {
  standard:      '标准',
  'dp-tile':     'DP 平铺',
  'ep-cluster':  'EP 聚簇',
  'tp-slice':    'TP 切片',
  'pp-pipeline': 'PP 流水',
};

/** 每个 rank 的三维世界坐标（THREE.js unit，原点居中）。 */
export interface Cell { x: number; y: number; z: number; }

export interface LayoutResult {
  view: LayoutView;
  cols: number;    // XZ 平面 X 轴跨度（world unit），供相机取景
  rows: number;    // XZ 平面 Z 轴跨度（world unit），供相机取景
  yExtent: number; // Y 轴跨度（world unit），供相机取景
  pos: Cell[];     // pos[rank] — 每个 rank 的三维世界坐标
  note: string;    // 该视图的一句话说明
}

/**
 * layoutOf — 给定视图，返回每个 rank 的三维世界坐标（pos）和视图元信息。
 * 坐标 = THREE.js world unit；CubeField 直接使用，不再乘 PITCH。
 */
export function layoutOf(view: LayoutView, workload: ParallelWorkload, N: number, cfg?: ParallelConfig): LayoutResult {
  const d = deploymentOf(workload, N, cfg);
  const TP = d.pm.groupCount('tp'), PP = d.pm.groupCount('pp'), DP = d.pm.groupCount('dp');
  const HOST = NPUS_PER_NODE;
  const pos: Cell[] = new Array(N);

  const tpC = (TP - 1) / 2, ppC = (PP - 1) / 2, dpC = (DP - 1) / 2;
  let cols = 1, rows = 1, yExtent = 0, note = '';

  if (view === 'standard') {
    // 标准 3D 立方：X=TP · Y=PP(倒序,低 stage 在顶) · Z=DP
    for (let k = 0; k < N; k++) {
      const c = d.coordsOf(k);
      pos[k] = { x: (c.tp - tpC) * 1.6, y: (ppC - c.pp) * 1.15, z: (c.dp - dpC) * 0.75 };
    }
    cols = (TP - 1) * 1.6 + 1;
    rows = (DP - 1) * 0.75 + 1;
    yExtent = (PP - 1) * 1.15;
    note = `标准立方：X=TP×${TP} · Y=PP×${PP}（模型深度，低 stage 在顶）· Z=DP×${DP}`;

  } else if (view === 'dp-tile') {
    // DP 平铺：DP 个副本排近方阵宫格，每格内 TP（横） × PP（竖，低 stage 在顶）竖板
    const DGX = Math.max(1, Math.ceil(Math.sqrt(DP)));
    const DGZ = Math.ceil(DP / DGX);
    const dpGapX = TP * 1.3 + 5;   // DP 宫格间距（X）
    const dpGapZ = PP * 0.9 + 2;   // DP 宫格间距（Z）
    for (let k = 0; k < N; k++) {
      const c = d.coordsOf(k);
      const gx = c.dp % DGX, gz = Math.floor(c.dp / DGX);
      pos[k] = {
        x: (gx - (DGX - 1) / 2) * dpGapX + (c.tp - tpC) * 1.3,
        y: (ppC - c.pp) * 0.9,
        z: (gz - (DGZ - 1) / 2) * dpGapZ,
      };
    }
    cols = (DGX - 1) * dpGapX + (TP - 1) * 1.3 + 1;
    rows = (DGZ - 1) * dpGapZ + 1;
    yExtent = (PP - 1) * 0.9;
    note = `DP 平铺：${DP} 个副本排 ${DGX}×${DGZ} 宫格 · 每格内 TP×PP 竖板 · 「整网=一份×${DP} 份」`;

  } else if (view === 'ep-cluster') {
    // EP 聚簇：按物理 Host 指定「专家 Host」→ 右侧专家墙；其余压缩到左侧块。
    // 专家 Host 公式（与原型 HTML 一致）：expertHostIdx = (e * step + 5) % nHosts
    const nHosts = Math.max(1, Math.ceil(N / HOST));
    const nExp = Math.max(1, Math.floor(nHosts / 16));
    const step = Math.max(1, Math.ceil(nHosts / nExp));
    const hostExpertIdx = new Int32Array(nHosts).fill(-1);
    for (let e = 0; e < nExp; e++) hostExpertIdx[(e * step + 5) % nHosts] = e;
    const EGX = Math.max(1, Math.ceil(Math.sqrt(nExp)));
    const EGY = Math.ceil(nExp / EGX);

    for (let k = 0; k < N; k++) {
      const h = Math.floor(k / HOST), slot = k % HOST;
      const e = hostExpertIdx[h];
      if (e >= 0) {
        // 专家墙（右侧）：8×8 Host 排列，每 Host 2×4 卡块
        const ex = e % EGX, ey = Math.floor(e / EGX);
        pos[k] = {
          x: 15 + (ex - (EGX - 1) / 2) * 2.4 + (slot % 4) * 0.45,
          y: ((EGY - 1) / 2 - ey) * 2.4 + ((slot >> 2) - 0.5) * 0.9,
          z: 0,
        };
      } else {
        // 非专家（左侧）：pp × dp 展开，tp 微偏移
        const c = d.coordsOf(k);
        pos[k] = {
          x: -14 + (slot - (HOST - 1) / 2) * 0.9,
          y: (ppC - c.pp) * 0.8,
          z: (c.dp - dpC) * 0.5,
        };
      }
    }
    const expertWallX = 15 + (EGX - 1) / 2 * 2.4 + 1.5 * 0.45;
    const nonExpertX = 14 + (HOST - 1) / 2 * 0.9;
    cols = expertWallX + nonExpertX + 1;
    rows = Math.max((EGY - 1) * 2.4 + 1.5 * 0.9, (DP - 1) * 0.5) + 1;
    yExtent = Math.max((EGY - 1) * 2.4 + 1.5 * 0.9, (PP - 1) * 0.8);
    note = `EP 聚簇：${nExp} 个专家 Host 成墙（右）· 其余 ${nHosts - nExp} Host 压缩块（左）· 专家域边界直观可见`;

  } else if (view === 'tp-slice') {
    // TP 切片：8 张权重墙沿 X 展开；每墙 = DP×PP 平面（一个 TP 切片的完整模型）
    for (let k = 0; k < N; k++) {
      const c = d.coordsOf(k);
      pos[k] = { x: (c.tp - tpC) * 7, y: (ppC - c.pp) * 1.15, z: (c.dp - dpC) * 0.75 };
    }
    cols = (TP - 1) * 7 + 1;
    rows = (DP - 1) * 0.75 + 1;
    yExtent = (PP - 1) * 1.15;
    note = `TP 切片：${TP} 张权重墙沿 X 展开 · 每墙内 Y=PP×${PP} · Z=DP×${DP} · 张量分片一目了然`;

  } else {
    // PP 流水（pp-pipeline）：PP 段竖板沿 X 展开（左→右流水方向）；TP 沿 Y · DP 沿 Z
    for (let k = 0; k < N; k++) {
      const c = d.coordsOf(k);
      pos[k] = { x: (c.pp - ppC) * 6.2, y: (c.tp - tpC) * 1.2, z: (c.dp - dpC) * 0.75 };
    }
    cols = (PP - 1) * 6.2 + 1;
    rows = (DP - 1) * 0.75 + 1;
    yExtent = (TP - 1) * 1.2;
    note = `PP 流水：${PP} 段竖板从左（stage 0）到右（stage ${PP - 1}）展开 · Y=TP×${TP} · Z=DP×${DP}`;
  }

  return { view, cols, rows, yExtent, pos, note };
}

/**
 * verifyBijection — 校验布局是「同一批卡的置换」（每个三维位置最多一张卡）。
 * 供测试/自检使用；返回 { ok, reason }。
 */
export function verifyBijection(r: LayoutResult, N: number): { ok: boolean; reason: string } {
  if (r.pos.length !== N) return { ok: false, reason: `pos 数量 ${r.pos.length} ≠ N ${N}` };
  const seen = new Set<string>();
  for (let k = 0; k < N; k++) {
    const key = `${r.pos[k].x.toFixed(3)},${r.pos[k].y.toFixed(3)},${r.pos[k].z.toFixed(3)}`;
    if (seen.has(key)) return { ok: false, reason: `位置 (${key}) 被 rank ${k} 重叠` };
    seen.add(key);
  }
  return { ok: true, reason: `${N} 张卡各占唯一三维位置` };
}

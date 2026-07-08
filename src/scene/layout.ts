/**
 * layout — P1 立方体重排的布局引擎（加法，纯函数，不碰渲染）。
 *
 * 「切视图 = 换一种堆法」：同一批卡（rank），按不同并行轴重新分组、摆到不同格子。
 * 本模块只算「每个 rank 在某视图下落在网格的哪一格」，派生自 deployment（→ parallelMap SSOT），
 * 不 import three、不接场景。接入 FullPodScene 是 P1 第二步（藏在 layout='physical' 默认后）。
 *
 * 硬不变量（方案漏洞 #13，可单元测试、作为验收门槛）：
 *   每个视图都必须是「同一批卡的一个置换」—— 每张卡在网格里恰好占一格、不重叠、不丢失（双射）。
 * 因为每个 rank 的位置只由它「唯一的空间坐标 (pp,dp,tp)」决定（tp·pp·dp 乘积 = N），
 * 所以只要位置是这三者的函数、且不同三元组映到不同格，就天然是双射。
 *
 * EP 是塌缩轴（不是独立空间轴，见 deployment.MeshDim.kind）——所以 EP 视图按「同 EP 组相邻」
 * 排成条带，而非干净矩形，这是诚实的（EP 本就没有独立体量）。
 */
import { deploymentOf } from './deployment';
import { NPUS_PER_NODE, type ParallelWorkload, type ParallelConfig } from './data';

export type LayoutView = 'physical' | 'tp' | 'pp' | 'dp' | 'ep';
export const LAYOUT_VIEWS: LayoutView[] = ['physical', 'tp', 'pp', 'dp', 'ep'];
export const LAYOUT_LABEL: Record<LayoutView, string> = {
  physical: '物理', tp: 'TP 视图', pp: 'PP 视图', dp: 'DP 视图', ep: 'EP 视图',
};

export interface Cell { x: number; z: number; }   // 居中的抽象网格坐标（原点在阵列中心；场景再缩放/摆放）
export interface LayoutResult {
  view: LayoutView;
  cols: number; rows: number;
  pos: Cell[];      // pos[rank] —— 每个 rank 的格心
  note: string;     // 该视图的一句话说明（含塌缩轴提示）
}

// 把整数 (col,row) 居中成抽象坐标：原点落在网格中心。
function center(col: Int32Array, row: Int32Array, cols: number, rows: number): Cell[] {
  const cx = (cols - 1) / 2, cz = (rows - 1) / 2;
  const pos: Cell[] = new Array(col.length);
  for (let k = 0; k < col.length; k++) pos[k] = { x: col[k] - cx, z: row[k] - cz };
  return pos;
}
const nearCols = (n: number) => Math.max(1, Math.ceil(Math.sqrt(n)));

/**
 * layoutOf — 给定视图，返回每个 rank 的网格位置（居中抽象坐标）。
 * physical 复现主机平铺（host 4×2 卡块，host 近方阵）；cube 视图按并行轴重排。
 */
export function layoutOf(view: LayoutView, workload: ParallelWorkload, N: number, cfg?: ParallelConfig): LayoutResult {
  const d = deploymentOf(workload, N, cfg);
  const TP = d.pm.groupCount('tp'), PP = d.pm.groupCount('pp'), DP = d.pm.groupCount('dp'), EP = d.pm.groupCount('ep');
  const HOST = NPUS_PER_NODE;
  const col = new Int32Array(N), row = new Int32Array(N);
  let cols = 1, rows = 1, note = '';

  if (view === 'physical') {
    // 物理平铺：host = ⌊k/8⌋、slot = k%8；host 排近方阵，每 host 是 4×2 卡块。
    const nHosts = Math.max(1, Math.ceil(N / HOST));
    const hc = nearCols(nHosts);
    cols = hc * 4; rows = Math.ceil(nHosts / hc) * 2;
    for (let k = 0; k < N; k++) {
      const host = Math.floor(k / HOST), slot = k % HOST;
      col[k] = (host % hc) * 4 + (slot % 4);
      row[k] = Math.floor(host / hc) * 2 + Math.floor(slot / 4);
    }
    note = '物理平铺：Host 4×2 卡块 · 与现有阵列一致';
  } else if (view === 'tp') {
    // TP 视图：每个 TP 组（=一台 Host 的 8 卡，同 pp·dp）聚成 4×2 块；块按 (pp,dp) 排近方阵。
    const nB = PP * DP, bc = nearCols(nB);
    cols = bc * 4; rows = Math.ceil(nB / bc) * 2;
    for (let k = 0; k < N; k++) {
      const c = d.coordsOf(k), b = c.dp * PP + c.pp;
      col[k] = (b % bc) * 4 + (c.tp % 4);
      row[k] = Math.floor(b / bc) * 2 + Math.floor(c.tp / 4);
    }
    note = `TP 视图：${PP * DP} 个 TP 组（8 卡/组）各成 4×2 块 · 张量切片贴在 Host 内`;
  } else if (view === 'pp') {
    // PP 视图：PP 个 stage 并排成竖板（左→右流水）；板内按 (tp 横, dp 纵) 铺满。
    cols = PP * TP; rows = DP;
    for (let k = 0; k < N; k++) {
      const c = d.coordsOf(k);
      col[k] = c.pp * TP + c.tp;
      row[k] = c.dp;
    }
    note = `PP 视图：${PP} 个 stage 并排竖板（左→右流水）· 板内 ${TP}×${DP}`;
  } else if (view === 'dp') {
    // DP 视图：每个 DP 副本成一个 TP×PP 矩形块；块按近方阵平铺 → 「整网 = 一份 × N 副本」直观可见。
    const bc = nearCols(DP);
    cols = bc * TP; rows = Math.ceil(DP / bc) * PP;
    for (let k = 0; k < N; k++) {
      const c = d.coordsOf(k);
      col[k] = (c.dp % bc) * TP + c.tp;
      row[k] = Math.floor(c.dp / bc) * PP + c.pp;
    }
    note = `DP 视图：${DP} 个相同副本各成 ${TP}×${PP} 块 · 整网 = 一份 × ${DP}`;
  } else {
    // EP 视图：EP 是塌缩轴（无独立体量）→ 按「同 EP 组相邻」排成条带，非干净矩形（诚实反映塌缩）。
    // key = ((ep·DP + dp)·PP + pp)·TP + tp —— 含唯一空间三元组，天然可排序且双射。
    const order = Array.from({ length: N }, (_, k) => k);
    const keyOf = (k: number): number => { const c = d.coordsOf(k); return ((c.ep * DP + c.dp) * PP + c.pp) * TP + c.tp; };
    order.sort((a, b) => keyOf(a) - keyOf(b));
    const C = nearCols(N);
    cols = C; rows = Math.ceil(N / C);
    for (let ord = 0; ord < N; ord++) { const k = order[ord]; col[k] = ord % C; row[k] = Math.floor(ord / C); }
    note = `EP 视图：${EP} 组按「同组相邻」排成条带（EP 为塌缩轴、无独立矩形体量）`;
  }

  return { view, cols, rows, pos: center(col, row, cols, rows), note };
}

/**
 * verifyBijection — 校验一个布局是「同一批卡的置换」（每格 ≤1 张卡、共 N 张、都在网格内）。
 * 供测试/自检使用；返回 { ok, reason }。
 */
export function verifyBijection(r: LayoutResult, N: number): { ok: boolean; reason: string } {
  if (r.pos.length !== N) return { ok: false, reason: `pos 数量 ${r.pos.length} ≠ N ${N}` };
  const seen = new Set<number>();
  const cx = (r.cols - 1) / 2, cz = (r.rows - 1) / 2;
  for (let k = 0; k < N; k++) {
    const c = Math.round(r.pos[k].x + cx), rw = Math.round(r.pos[k].z + cz);
    if (c < 0 || c >= r.cols || rw < 0 || rw >= r.rows) return { ok: false, reason: `rank ${k} 越界 (${c},${rw}) / ${r.cols}×${r.rows}` };
    const cell = rw * r.cols + c;
    if (seen.has(cell)) return { ok: false, reason: `格 (${c},${rw}) 被占两次（rank ${k} 冲突）` };
    seen.add(cell);
  }
  return { ok: true, reason: `${N} 张卡各占一格（${r.cols}×${r.rows}=${r.cols * r.rows} 格）` };
}

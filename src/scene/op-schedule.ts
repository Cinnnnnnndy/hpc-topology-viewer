/**
 * op-schedule — 真实数据输入：泳道 / 算子时序的真实锚点（加法，暂不接入视图，P2 泳道消费）。
 *
 * 全部取自 盘古 Pro MoE 技术报告 arXiv:2505.21411v2（表 1/5/6/7 + §4.2）。
 * 现有 STEP_DECOMP 只给「计算/通信/访存」的*比例*；泳道还需要*先后顺序*与*重叠(掩盖)*，
 * 本模块补的就是这个——把论文的硬锚点组成一条「一层内」的有序算子序列。
 *
 * 硬锚点（真实）：注意力占步 30–50%（取中 ~40%）· KV 搬运占注意力 70% · 权重搬运占 decode 时延 29%
 *   · EP All-to-All ≈ 8%（decode）/ 16%（prefill）· 训练 DP AllReduce+EP A2A ≈ 30%。
 * 单个算子在残差内的细分是「照真实比例的示意切分」（同 STEP_DECOMP 的口径），不是逐算子实测 trace。
 */
export type OpKind = 'compute' | 'comm' | 'mem';
export type CollKind = 'a2a' | 'ring' | 'p2p' | 'allgather';

export interface ScheduledOp {
  id: string;
  name: string;
  kind: OpKind;
  w: number;                 // 相对时长权重（同 phase 内比较；非绝对时间）
  coll?: CollKind;           // kind==='comm' 时的集合通信形态
  overlapBg?: boolean;       // 是否与背景访存/权重搬运轨重叠（→ 被掩盖）
  note: string;
}
export interface PhaseSchedule {
  phase: 'pretrain' | 'prefill' | 'decode';
  bound: 'compute' | 'memory';                        // 该阶段瓶颈（decode 访存受限 · prefill/训练 计算受限）
  bg?: { name: string; frac: number; note: string };  // 背景轨（权重/KV 搬运，可被计算掩盖）
  ops: ScheduledOp[];                                  // 一个 transformer 层内的有序算子（48 层重复）
  src: string;
}

// ── decode：访存受限。权重搬运 29% 作背景轨、与专家 GMM 重叠；注意力 KV-heavy；EP A2A 两次≈8%。 ──
const DECODE: PhaseSchedule = {
  phase: 'decode', bound: 'memory',
  bg: { name: '权重搬运（背景）', frac: 0.29, note: 'decode 权重传输占总时延 29%（§4.2）· 与专家 GMM 计算重叠掩盖' },
  ops: [
    { id: 'rmsnorm1', name: 'RMSNorm', kind: 'compute', w: 0.03, note: '前注意力归一' },
    { id: 'qkv', name: 'QKV Proj', kind: 'compute', w: 0.07, note: 'GQA 40 query / 8 kv 头' },
    { id: 'attn', name: 'Attention', kind: 'compute', w: 0.06, note: '注意力占步 30–50%（MulAttention MTE2 利用 >89%）' },
    { id: 'kv', name: 'KV 搬运', kind: 'mem', w: 0.15, note: 'KV 向量搬运占注意力计算 70%（§4.2.3）' },
    { id: 'oproj', name: 'O Proj', kind: 'compute', w: 0.05, note: '注意力输出投影' },
    { id: 'rmsnorm2', name: 'RMSNorm', kind: 'compute', w: 0.03, note: '前 MoE 归一' },
    { id: 'router', name: 'Router / Gating', kind: 'compute', w: 0.03, note: 'MoGE 分组 Top-1（64 专家均分 M 组）' },
    { id: 'a2a-d', name: 'EP All-to-All · dispatch', kind: 'comm', w: 0.04, coll: 'a2a', note: 'token 路由到专家所在卡（EP A2A 合计≈8%）' },
    { id: 'gmm', name: 'Expert GMM', kind: 'compute', w: 0.17, overlapBg: true, note: 'SwiftGMM · MTE2 利用达 95% · 与权重搬运重叠' },
    { id: 'a2a-c', name: 'EP All-to-All · combine', kind: 'comm', w: 0.04, coll: 'a2a', note: '专家结果聚合回原卡' },
  ],
  src: 'arXiv:2505.21411v2 §4.2 · 表 6（Ascend 800I A2）',
};

// ── prefill：计算受限。大 GEMM 主导；KV 是建立（写）而非搬运；EP A2A ≈16%。 ──
const PREFILL: PhaseSchedule = {
  phase: 'prefill', bound: 'compute',
  bg: { name: 'KV 建立（背景）', frac: 0.12, note: 'prefill 阶段建立 KV cache' },
  ops: [
    { id: 'rmsnorm1', name: 'RMSNorm', kind: 'compute', w: 0.02, note: '前注意力归一' },
    { id: 'qkv', name: 'QKV Proj', kind: 'compute', w: 0.10, note: 'GQA 投影' },
    { id: 'attn', name: 'Attention', kind: 'compute', w: 0.12, note: '注意力占步 30–50%（prefill 大序列）' },
    { id: 'kv', name: 'KV 建立', kind: 'mem', w: 0.06, note: '写入 KV cache' },
    { id: 'oproj', name: 'O Proj', kind: 'compute', w: 0.06, note: '输出投影' },
    { id: 'rmsnorm2', name: 'RMSNorm', kind: 'compute', w: 0.02, note: '前 MoE 归一' },
    { id: 'router', name: 'Router / Gating', kind: 'compute', w: 0.03, note: 'MoGE 路由' },
    { id: 'a2a-d', name: 'EP All-to-All · dispatch', kind: 'comm', w: 0.08, coll: 'a2a', note: 'EP A2A 合计≈16%' },
    { id: 'gmm', name: 'Expert GMM', kind: 'compute', w: 0.33, note: 'Top-8 专家大 GEMM（计算主导）· GMM >50% e2e' },
    { id: 'a2a-c', name: 'EP All-to-All · combine', kind: 'comm', w: 0.08, coll: 'a2a', note: '专家结果聚合' },
  ],
  src: 'arXiv:2505.21411v2 §4.2 · 表 5（Ascend 800I A2）',
};

// ── pretrain：计算受限 + DP 梯度同步。FWD/BWD 主导；DP Ring-AllReduce + EP A2A ≈30%（STEP_DECOMP 口径）。 ──
const PRETRAIN: PhaseSchedule = {
  phase: 'pretrain', bound: 'compute',
  bg: { name: '访存（背景）', frac: 0.12, note: '激活/梯度访存' },
  ops: [
    { id: 'fwd', name: 'Forward', kind: 'compute', w: 0.29, note: '前向（注意力 + MoE）' },
    { id: 'ep-a2a', name: 'EP All-to-All', kind: 'comm', w: 0.10, coll: 'a2a', note: '专家并行 token 路由（EP2）' },
    { id: 'bwd', name: 'Backward', kind: 'compute', w: 0.29, note: '反向传播' },
    { id: 'dp-ar', name: 'DP Ring-AllReduce', kind: 'comm', w: 0.20, coll: 'ring', overlapBg: true, note: '梯度同步（跨 Pod DP）· 可与 BWD 重叠掩盖' },
  ],
  src: 'arXiv:2505.21411v2 §4.1 · STEP_DECOMP（计算58%/通信30%/访存12%）',
};

export const OP_SCHEDULE: Record<'pretrain' | 'prefill' | 'decode', PhaseSchedule> = {
  pretrain: PRETRAIN, prefill: PREFILL, decode: DECODE,
};

// ── 真实测量：decode batch 扩展曲线（Ascend 800I A2 · 表 6）。真实数据点，供吞吐/时延面板显示。 ──
export interface BatchPoint { batch: number; tpotMs: number; tokps: number; mtp?: boolean; }
export const DECODE_BATCH_SCALING: BatchPoint[] = [
  { batch: 1, tpotMs: 18.44, tokps: 456 },
  { batch: 64, tpotMs: 95.56, tokps: 1148 },
  { batch: 64, tpotMs: 95.56, tokps: 1528, mtp: true },   // + MTP 推测解码
];
export const PREFILL_MEASURED = { batch: 2, ttftMs: 424.21, tokps: 4828 } as const;   // 表 5（800I A2）

// ── flow 布局（泳道 + 3D 游标共用的单一真值）：把算子分成「关键路径(wall-clock)」与「被计算掩盖」两类。 ──
//   关键路径 = 所有计算算子 + 未被掩盖的通信/访存（overlapBg=false）。
//   掩盖 = 通信/访存且 overlapBg=true（藏在前一个计算算子之下，不占 wall-clock）+ 背景搬运带 sched.bg。
//   暴露通信 = 落在关键路径上的通信占比（= 浪费的墙钟时间，监控要盯的靶子）。
export interface Placed { op: ScheduledOp; x: number; w: number; }   // x/w 归一到关键路径 [0,1]
export interface HiddenBand { op: ScheduledOp; x: number; w: number; }  // 画在其掩盖的计算算子之下
export interface FlowLayout {
  placed: Placed[];            // 关键路径算子（有序、占 wall-clock）
  hidden: HiddenBand[];        // 被掩盖的通信/访存（叠在计算下方）
  bgBand: { name: string; x: number; w: number; note: string } | null;  // 背景搬运带（掩盖）
  exposedComm: number;         // 暴露通信占比（关键路径内）
  hiddenFrac: number;          // 被掩盖占比（相对关键路径）
}
const isCritical = (o: ScheduledOp) => o.kind === 'compute' || !o.overlapBg;
export function flowLayout(phase: 'pretrain' | 'prefill' | 'decode'): FlowLayout {
  const sched = OP_SCHEDULE[phase], ops = sched.ops;
  const crit = ops.filter(isCritical);
  const critTotal = crit.reduce((s, o) => s + o.w, 0) || 1;
  let acc = 0;
  const placed: Placed[] = crit.map((op) => { const x = acc / critTotal, w = op.w / critTotal; acc += op.w; return { op, x, w }; });
  // 被掩盖的算子 → 放到「原序列中它前面最近的计算算子」之下
  const underOf = (opId: string): Placed | undefined => {
    const idx = ops.findIndex((o) => o.id === opId);
    for (let i = idx - 1; i >= 0; i--) if (ops[i].kind === 'compute') { const p = placed.find((pp) => pp.op.id === ops[i].id); if (p) return p; }
    return placed.find((p) => p.op.kind === 'compute');
  };
  const hidden: HiddenBand[] = ops.filter((o) => !isCritical(o)).map((op) => { const u = underOf(op.id); return { op, x: u?.x ?? 0, w: Math.min(u?.w ?? 0.2, op.w / critTotal) }; });
  // 背景搬运带：放在带 overlapBg 的计算算子（如 Expert GMM）之下
  const bgUnder = placed.find((p) => p.op.overlapBg && p.op.kind === 'compute') ?? placed.find((p) => p.op.kind === 'compute');
  const bgBand = sched.bg && bgUnder ? { name: sched.bg.name, x: bgUnder.x, w: Math.min(1 - bgUnder.x, sched.bg.frac / critTotal), note: sched.bg.note } : null;
  const exposedComm = crit.filter((o) => o.kind === 'comm').reduce((s, o) => s + o.w, 0) / critTotal;
  const hiddenFrac = (ops.filter((o) => !isCritical(o)).reduce((s, o) => s + o.w, 0) + (sched.bg?.frac ?? 0)) / critTotal;
  return { placed, hidden, bgBand, exposedComm, hiddenFrac };
}
// 游标(0..1)扫到的当前算子（关键路径上）—— 泳道与 3D 游标共用，保证一致。
export function opAtCursor(phase: 'pretrain' | 'prefill' | 'decode', cursor01: number): ScheduledOp {
  const { placed } = flowLayout(phase);
  for (const p of placed) if (cursor01 >= p.x && cursor01 < p.x + p.w) return p.op;
  return placed[placed.length - 1].op;
}

// ── 一层内 计算/通信/访存(含背景) 的真实占比（由上面的有序算子归一得出，与 STEP_DECOMP 对齐、校验一致）。 ──
export function phaseMix(phase: 'pretrain' | 'prefill' | 'decode'): { compute: number; comm: number; mem: number } {
  const s = OP_SCHEDULE[phase];
  let compute = 0, comm = 0, mem = 0;
  for (const op of s.ops) { if (op.kind === 'compute') compute += op.w; else if (op.kind === 'comm') comm += op.w; else mem += op.w; }
  mem += s.bg?.frac ?? 0;
  const tot = compute + comm + mem || 1;
  return { compute: compute / tot, comm: comm / tot, mem: mem / tot };
}

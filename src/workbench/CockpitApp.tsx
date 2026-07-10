/**
 * CockpitApp — 统一驾驶舱（取代工作台内容）· P0 骨架。
 *
 * 以 CubeView（立方重排视图）为主画布，融合工作台的 L0–L7 层级轴，构建左右联动的
 * 「一张画布四个维度」驾驶舱（设计文档 §8/9/12 · v2 原型第九组件的工程化形态）：
 *   · 物理结构 = 位置（CubeView 基准画布 + 重排飞行动画）
 *   · 并行策略 = 着色（互斥图层 · stratColor）
 *   · 卡间通信 = 连线（时间的函数 · 随 op-schedule 阶段演化，P1 完整实现）
 *   · 算子整网 = 下钻（右栏②，不占画布）
 *   · 时间     = 第四轴（顶栏 Scrubber / 播放，复用 ViewSync）
 *
 * 联动（双向）：左 click rank → 右②③刷新 + ①高亮归属链；左 hover → ③遥测浮条；
 *              右①点层级 → 左画布按该粒度重排（aggLevel）。
 *
 * P0 范围：布局骨架 + CubeView 嵌入 + HierarchyAxis 抽取复用 + 点击/悬停左右联动 +
 *          层级→粒度（至少 L4/L2 两档）。策略着色互斥已一并接线；通信连线随时间演化 = P1。
 */
import { useMemo, useState } from 'react';
import {
  DEFAULT_GEN, GENERATIONS, PARALLEL_COLORS, PARTITION_META,
  WORKLOAD, NODES_PER_CAB, NPUS_PER_NODE, levelName,
  type Gen, type ViewSync, type ParallelWorkload, type PartitionDim, type LevelKey, type ParDim,
} from '../scene/data';
import { LAYOUT_VIEWS, LAYOUT_LABEL, type LayoutView } from '../scene/layout';
import { deploymentOf } from '../scene/deployment';
import { phaseMix, opAtCursor, flowLayout, type OpKind } from '../scene/op-schedule';
import { CubeView } from '../view/CubeView';
import { HierarchyAxis } from '../view/HierarchyAxis';

const MONO = "'JetBrains Mono','Consolas',ui-monospace,monospace";
const OP_COL: Record<OpKind, string> = { compute: '#22d3ee', comm: '#ff4b7b', mem: '#a78bfa' };
const OP_KIND_LBL: Record<OpKind, string> = { compute: '计算', comm: '通信', mem: '访存' };
const CAB_CARDS = NODES_PER_CAB * NPUS_PER_NODE;

const WL_LABEL: Record<ParallelWorkload, string> = { pretrain: '预训练', prefill: 'Prefill', decode: 'Decode' };
const STRAT_DIMS: PartitionDim[] = ['none', 'tp', 'pp', 'dp', 'ep'];
const STRAT_LABEL: Record<PartitionDim, string> = { none: '无', tp: 'TP', pp: 'PP', dp: 'DP', ep: 'EP' };

// PTO 主题桥接（与 ClusterView 同一套 legacy→PTO 语义 token 映射，随 data-theme 切换）。
const THEME_VARS: React.CSSProperties = {
  '--bg': 'var(--background)', '--bg2': 'var(--background-subtle)',
  '--panel': 'var(--panel-shell-bg)', '--panel-solid': 'var(--background-elevated)',
  '--tx': 'var(--foreground)', '--tx2': 'var(--foreground-muted)', '--tx3': 'var(--foreground-subtle)',
  '--bd': 'var(--border)', '--bd2': 'var(--border-strong)',
  '--shadow': 'var(--shadow-md)', '--shadow-sm': 'var(--shadow-sm)',
  '--btn': 'var(--button-secondary-bg)', '--btn-bd': 'var(--button-secondary-border)',
  '--primary': 'var(--primary)', '--primary-foreground': 'var(--primary-foreground)',
} as React.CSSProperties;

const SECONDARY: React.CSSProperties = { border: '1px solid var(--button-secondary-border)', background: 'var(--button-secondary-bg)', color: 'var(--foreground-muted)' };
function navBtn(on: boolean): React.CSSProperties {
  return on ? { border: '1px solid var(--primary)', background: 'var(--primary)', color: 'var(--primary-foreground)', fontWeight: 600 } : { ...SECONDARY };
}
function chipBtn(on: boolean, c: string): React.CSSProperties {
  return on ? { border: `1px solid ${c}`, background: c, color: '#0b0f16', fontWeight: 700 } : { ...SECONDARY };
}
const btn: React.CSSProperties = { padding: '4px 11px', fontSize: 11.5, borderRadius: 8, cursor: 'pointer' };
const LBL: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--tx3)', alignSelf: 'center' };
const card: React.CSSProperties = { background: 'var(--panel-solid)', border: '1px solid var(--bd)', borderRadius: 10, padding: '11px 12px' };

// deterministic per-rank telemetry (hover 探针；纯示意，与 StatusView 同风格)
const rnd = (x: number) => { const v = Math.sin(x * 99.13) * 43758.5453; return v - Math.floor(v); };

export function CockpitApp() {
  const [gen] = useState<Gen>(DEFAULT_GEN);
  const [dark, setDark] = useState(true);   // 驾驶舱默认深色（贴合原型第九组件观感）
  const N = GENERATIONS[gen].totalNpus;

  // ── 共享工况 / 时间 / 播放（ViewSync）+ 驾驶舱专属：着色 / 图层 / 粒度 / 选区 ──
  const [workload, setWorkload] = useState<ParallelWorkload>('pretrain');
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [metric, setMetric] = useState<'util' | 'strag' | 'fault'>('util');
  const [planeOn, setPlaneOn] = useState({ ub: true, rdma: true, vpc: false });
  const [layout, setLayout] = useState<LayoutView>('physical');
  const [stratColor, setStratColor] = useState<PartitionDim>('none');
  const [commLayer, setCommLayer] = useState(true);
  const [alertLayer, setAlertLayer] = useState(true);
  const [aggLevel, setAggLevel] = useState<LevelKey>('card');   // L2 满卡粒度起步
  const [sel, setSel] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const sync: ViewSync = {
    workload, step, playing, metric, planeOn,
    setWorkload, setStep, setPlaying, setMetric, setPlaneOn,
    stratColor, commLayer, alertLayer, aggLevel, selRank: sel,
  };

  const dep = useMemo(() => deploymentOf(workload, N), [workload, N]);
  const pm = dep.pm;

  // ── 流动面 → 结构面：当前时间步的算子 + 活跃通信维（与 CubeView 同一推导）──
  const cursor01 = (step % 61) / 60;
  const curOp = useMemo(() => opAtCursor(workload, cursor01), [workload, cursor01]);
  const activeComm = useMemo(() => {
    if (curOp.kind === 'comm') return curOp;
    const fl = flowLayout(workload);
    const h = fl.hidden.find((hh) => hh.op.kind === 'comm' && cursor01 >= hh.x && cursor01 < hh.x + hh.w);
    return h ? h.op : null;
  }, [curOp, workload, cursor01]);
  const curDim: Exclude<ParDim, 'sp' | 'tp'> | null = activeComm
    ? (activeComm.coll === 'ring' ? 'dp' : activeComm.coll === 'p2p' ? 'pp' : 'ep') : null;
  const mix = useMemo(() => phaseMix(workload), [workload]);

  // ── COMM BUS 阶段自适应：当前主导链路（柜内 UB / 柜内接力 PP / 跨柜 OCS）随 activeComm 切换 ──
  const bus = curDim === 'ep' ? { ub: 20, pp: 16, ocs: 88, lead: '跨柜 OCS 全光 · EP AllToAll 星状 ⚠', hot: true }
    : curDim === 'dp' ? { ub: 18, pp: 22, ocs: 76, lead: '跨柜全局网络 · DP 同步环（低频）', hot: false }
      : curDim === 'pp' ? { ub: 30, pp: 82, ocs: 24, lead: '柜内接力 · PP 边界激活传递', hot: false }
        : { ub: 90, pp: 20, ocs: 12, lead: '柜内灵衢/UB · TP 高频域', hot: false };

  const aggLabel = aggLevel === 'card' ? '满卡粒度（一卡一块）'
    : aggLevel === 'node' ? `Host 粒度（${NPUS_PER_NODE} 卡/块）`
      : (aggLevel === 'cab' || aggLevel === 'super') ? `Pod 物理分组（一柜 ${CAB_CARDS} 卡一块）`
        : `${levelName(aggLevel)} 粒度（宏观降噪）`;

  // ── 底栏 desc：着色 × 连线 × 层级 × 时间 的组合语义一句话 ──
  const stratTxt = stratColor === 'none' ? '未开策略着色（颜色 = 状态红黄绿）' : `${STRAT_LABEL[stratColor]} 着色：同色 = ${PARTITION_META[stratColor as Exclude<PartitionDim, 'none'>].same}`;
  const desc = `${stratTxt} ｜ 连线：${commLayer ? (curDim ? `随阶段演化（当前 ${curDim.toUpperCase()}）` : '当前为计算步、无活跃通信') : '关'} ｜ 层级：${aggLabel} ｜ 时间：t=${step}·${WL_LABEL[workload]}。四维同屏：位置(物理)＋着色(策略)＋连线(通信)＋下钻(算子)，时间为第四轴。`;

  return (
    <div data-theme={dark ? 'dark' : 'light'} className="hpc-workbench-view pto-workbench-shell" style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--bg)', color: 'var(--tx)', fontFamily: 'var(--font-sans)', ...THEME_VARS,
    }}>
      {/* ══ 顶栏：工况 · 策略着色 · 图层 · 布局 · 时间轴 ══ */}
      <div style={{ flexShrink: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--bd)', background: 'var(--panel-solid)' }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: 0.3 }}>统一驾驶舱</span>
        <span style={{ fontSize: 9.5, color: 'var(--tx3)' }}>一张画布四维 · 取代工作台</span>

        <span style={{ ...LBL, marginLeft: 6 }}>工况</span>
        {(Object.keys(WL_LABEL) as ParallelWorkload[]).map((w) => (
          <button key={w} onClick={() => setWorkload(w)} style={{ ...btn, ...navBtn(workload === w) }}>{WL_LABEL[w]}</button>
        ))}

        <span style={{ ...LBL, marginLeft: 6 }}>策略着色</span>
        {STRAT_DIMS.map((d) => {
          const on = stratColor === d, sig = d === 'none' ? undefined : PARALLEL_COLORS[d];
          return (
            <button key={d} onClick={() => setStratColor(d)} title={d === 'none' ? '关闭策略着色' : `${PARTITION_META[d as Exclude<PartitionDim, 'none'>].label} · 互斥`}
              style={{ ...btn, ...(sig ? chipBtn(on, sig) : navBtn(on)) }}>{STRAT_LABEL[d]}</button>
          );
        })}

        <span style={{ ...LBL, marginLeft: 6 }}>图层</span>
        <button onClick={() => setCommLayer((v) => !v)} title="通信连线图层（P0 复用选中卡对端高亮 · 完整随时间演化 = P1）"
          style={{ ...btn, ...navBtn(commLayer) }}>🛣️ 通信线</button>
        <button onClick={() => setAlertLayer((v) => !v)} title="热点/告警图层（跨 L4 链路统计与散射建议 = P3）"
          style={{ ...btn, ...navBtn(alertLayer) }}>⚠️ 热点</button>

        <span style={{ ...LBL, marginLeft: 6 }}>布局</span>
        {LAYOUT_VIEWS.map((v) => (
          <button key={v} onClick={() => setLayout(v)} title={v === 'physical' ? '物理基准' : `按 ${v.toUpperCase()} 重排（飞行动画）`}
            style={{ ...btn, ...navBtn(layout === v) }}>{LAYOUT_LABEL[v]}</button>
        ))}

        {/* 时间轴 Scrubber + 播放 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <button onClick={() => setPlaying((p) => !p)} style={{ ...btn, ...navBtn(playing) }}>{playing ? '⏸ 暂停' : '▶ 播放'}</button>
          <input type="range" min={0} max={60} value={step % 61} onChange={(e) => setStep(+e.target.value)} style={{ width: 160 }} />
          <span style={{ fontSize: 10.5, fontFamily: MONO, color: 'var(--tx2)', minWidth: 84 }}>t={step % 61} · {activeComm ? activeComm.name : curOp.name}</span>
          <button onClick={() => setDark((d) => !d)} title="切换深/浅色" style={{ ...btn, ...SECONDARY }}>{dark ? '☾' : '☀'}</button>
        </div>
      </div>

      {/* ══ 主体：左 CubeView 主画布（~70%）· 右 联动三段面板（~30%）══ */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 左：CubeView 主画布 */}
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <CubeView
            gen={gen} dark={dark} sync={sync} embedded
            layout={layout} stratColor={stratColor} showComm={commLayer} showAlert={alertLayer}
            aggLevel={aggLevel} sel={sel} onSelectRank={setSel} onHoverRank={setHover}
          />
        </div>

        {/* 右：联动面板（三段纵排） */}
        <div style={{ width: 'clamp(320px, 30%, 420px)', flexShrink: 0, borderLeft: '1px solid var(--bd)', background: 'var(--bg)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: 10 }}>
          {/* ① L0–L7 层级状态轴 */}
          <div style={card}>
            <HierarchyAxis selLevel={aggLevel} onSelectLevel={setAggLevel} selRank={sel} deployment={dep} />
          </div>

          {/* ② 算子下钻面板 */}
          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>算子下钻 <span style={{ fontSize: 9.5, color: 'var(--tx3)', fontWeight: 400 }}>（第四维度 · 不占画布）</span></div>
            {sel == null ? (
              <div style={{ fontSize: 11, color: 'var(--tx3)', lineHeight: 1.6 }}>点左画布任一方块下钻：逻辑坐标、当前时间步算子构成、参与的通信组（TP组/PP链/DP环/EP路由）、承载层切片。</div>
            ) : (() => {
              const phys = dep.physOf(sel);
              const roles = dep.rolesOf(sel).filter((r) => r.dim !== 'sp');
              const roleLbl: Record<string, string> = { tp: 'TP 张量切片', pp: 'PP 流水级', dp: 'DP 数据副本', ep: 'EP 专家组' };
              const commLbl: Record<string, string> = { tp: 'TP 组', pp: 'PP 链', dp: 'DP 环', ep: 'EP 路由' };
              const ppStage = pm.groupOf(sel, 'pp'), ppDeg = pm.groupCount('pp');
              const lps = Math.ceil(WORKLOAD.layers / Math.max(1, ppDeg));
              const layA = ppStage * lps + 1, layB = Math.min(WORKLOAD.layers, (ppStage + 1) * lps);
              const row = (l: string, v: string, c?: string) => (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, margin: '3px 0' }}>
                  <span style={{ color: 'var(--tx2)' }}>{l}</span><span style={{ fontFamily: MONO, color: c ?? 'var(--tx)' }}>{v}</span>
                </div>
              );
              return (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, fontFamily: MONO, color: '#4369ef' }}>rank {sel}</span>
                    <button onClick={() => setSel(null)} style={{ ...btn, padding: '1px 8px', ...SECONDARY }}>✕</button>
                  </div>
                  <div style={{ ...LBL, margin: '4px 0 2px' }}>物理位置</div>
                  {row('Pod', `${phys.pod}`)}
                  {row('机柜（物理分组）', `C${phys.cabinet}`)}
                  {row('Host · 卡槽', `H${phys.host} / slot ${phys.slot}`)}

                  <div style={{ ...LBL, margin: '9px 0 3px', borderTop: '1px solid var(--bd)', paddingTop: 8 }}>当前算子构成（t={step % 61}）</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, marginBottom: 4 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: OP_COL[curOp.kind], flexShrink: 0 }} />
                    <span style={{ color: 'var(--tx)', fontWeight: 600 }}>{curOp.name}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--tx3)' }}>{OP_KIND_LBL[curOp.kind]}</span>
                  </div>
                  {([['compute', mix.compute], ['comm', mix.comm], ['mem', mix.mem]] as [OpKind, number][]).map(([k, v]) => (
                    <div key={k} style={{ margin: '3px 0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--tx2)' }}><span>{OP_KIND_LBL[k]}</span><span>{Math.round(v * 100)}%</span></div>
                      <div style={{ height: 5, borderRadius: 3, background: 'var(--btn)', overflow: 'hidden' }}><div style={{ width: `${v * 100}%`, height: '100%', background: OP_COL[k] }} /></div>
                    </div>
                  ))}

                  <div style={{ ...LBL, margin: '9px 0 3px', borderTop: '1px solid var(--bd)', paddingTop: 8 }}>参与的通信组 · {pm.cfg}</div>
                  {roles.map((r) => {
                    const c = PARALLEL_COLORS[r.dim as Exclude<ParDim, 'sp'>];
                    const peers = dep.peersOf(sel, r.dim, 4096).length;
                    const hot = curDim === r.dim;
                    return (
                      <div key={r.dim} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, margin: '3px 0' }}>
                        <span style={{ width: 9, height: 9, borderRadius: 2, background: c, flexShrink: 0, boxShadow: hot ? `0 0 0 2px color-mix(in srgb, ${c} 45%, transparent)` : 'none' }} />
                        <span style={{ color: 'var(--tx2)', flex: 1 }}>{commLbl[r.dim]}（{roleLbl[r.dim]}）{hot ? ' · 此刻活跃' : ''}</span>
                        <span style={{ fontFamily: MONO, color: 'var(--tx)' }}>{peers} 卡</span>
                      </div>
                    );
                  })}

                  <div style={{ ...LBL, margin: '9px 0 3px', borderTop: '1px solid var(--bd)', paddingTop: 8 }}>承载层切片</div>
                  {row('PP stage', `${ppStage} / ${ppDeg}`)}
                  {row('承载 Transformer 层', `L${layA}–L${layB}`)}
                  {row('专家（MoGE）', `${WORKLOAD.routedExperts} 路由 / 每组 Top-${WORKLOAD.activatedExperts}`)}
                </div>
              );
            })()}
          </div>

          {/* ③ COMM BUS 遥测 */}
          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>COMM BUS 遥测 <span style={{ fontSize: 9.5, color: 'var(--tx3)', fontWeight: 400 }}>· 阶段自适应</span></div>
            <div style={{ fontSize: 10.5, color: bus.hot ? '#ff4b7b' : '#22d3ee', marginBottom: 8 }}>当前主导链路：{bus.lead}</div>
            {([['柜内 UB（TP 域）', bus.ub, '#04d793'], ['柜内接力（PP）', bus.pp, '#a78bfa'], ['跨柜 OCS / RDMA', bus.ocs, bus.hot ? '#ff4b7b' : '#39c5cf']] as [string, number, string][]).map(([l, v, c]) => (
              <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '5px 0' }}>
                <span style={{ fontSize: 10, color: 'var(--tx2)', width: 110, flexShrink: 0 }}>{l}</span>
                <div style={{ flex: 1, height: 7, borderRadius: 4, background: 'var(--btn)', overflow: 'hidden' }}><div style={{ width: `${v}%`, height: '100%', background: v > 50 ? c : '#556' }} /></div>
                <span style={{ fontSize: 10, fontFamily: MONO, color: 'var(--tx2)', width: 32, textAlign: 'right' }}>{v}%</span>
              </div>
            ))}
            <div style={{ ...LBL, margin: '9px 0 3px', borderTop: '1px solid var(--bd)', paddingTop: 8 }}>硬件遥测探针</div>
            <div style={{ fontSize: 10.5, fontFamily: MONO, color: '#4369ef', lineHeight: 1.5, minHeight: 30 }}>
              {hover == null ? '悬停左画布方块读取遥测' : (() => {
                const p = dep.physOf(hover);
                return `GPU_${hover} · Pod${p.pod}/C${p.cabinet}/H${p.host}/s${p.slot} · UB ${55 + Math.round(rnd(hover) * 35)}% · HBM ${60 + Math.round(rnd(hover * 3) * 20)}/${GENERATIONS[gen].memGB}GB · ${62 + Math.round(rnd(hover * 7) * 9)}℃`;
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* ══ 底栏 desc：着色 × 连线 × 层级 × 时间 的组合语义 ══ */}
      <div style={{ flexShrink: 0, borderTop: '1px solid var(--bd)', background: 'var(--panel-solid)', padding: '7px 12px', fontSize: 11, color: 'var(--tx2)', lineHeight: 1.5 }}>
        {desc}
      </div>
    </div>
  );
}

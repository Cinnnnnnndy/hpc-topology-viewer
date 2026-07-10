/**
 * HierarchyAxis — L0–L7 层级状态轴（共用选区组件）。
 *
 * 从「层级状态轴＝共用选区：全球 L7 → 集群 L6 → 服务池 L5 → Pod L4 → Host L3 →
 * Chip·NPU L2 → Die L1(可选) → Core-Group L0」这条既有语义抽出的独立、可复用组件，
 * 供 CockpitApp（统一驾驶舱右栏①）与其它视图共用。颜色/tag 严格来自 data.ts 的
 * ENTITY_COLORS / HW_LEVELS（唯一真值），不自造第二套配色。
 *
 * 交互（右→左联动的左半边）：
 *   · 点某一层 → onSelectLevel(该层 key)：调用方据此对主画布「按该层聚合粒度重新取粒度并染色」。
 *   · 传入 selRank + deployment → 轴上高亮该 rank 的 L7→L0 归属链（面包屑）。
 *
 * 机柜 / Tile 不是层级（机柜=Pod 内物理分组、Tile=L0 内部粒度），不出现在本轴。
 */
import { HW_LEVELS, ENTITY_COLORS, levelName, type LevelKey } from '../scene/data';
import type { Deployment } from '../scene/deployment';

const MONO = "'JetBrains Mono','Consolas',ui-monospace,monospace";

// 每个层级的签名色（唯一真值 = ENTITY_COLORS；die/core 复用硬件/核组色）。
const LEVEL_COLOR: Record<LevelKey, string> = {
  global: ENTITY_COLORS.global,
  cluster: ENTITY_COLORS.cluster,
  pool: ENTITY_COLORS.pool,
  super: ENTITY_COLORS.super,
  cab: ENTITY_COLORS.cab,
  node: ENTITY_COLORS.node,
  card: ENTITY_COLORS.card,
  die: ENTITY_COLORS.computeDie,
  core: ENTITY_COLORS.cube,
  tile: ENTITY_COLORS.cube,   // 归入 L0（非独立层级，不在轴上渲染，仅补全类型）
};

// 该 rank 在每个层级上的「归属编号」（面包屑用）——纯派生自 deployment 的物理坐标 + 并行角色。
function attributionOf(dep: Deployment, rank: number): Partial<Record<LevelKey, string>> {
  const phys = dep.physOf(rank);
  return {
    global: 'DCN',
    cluster: 'Cluster',
    pool: 'Pool 1',
    super: `Pod ${phys.pod}`,
    node: `Host ${phys.host}`,
    card: `rank ${rank}`,
    die: '计算 Die',
    core: 'Core-Group',
  };
}

export function HierarchyAxis({
  selLevel, onSelectLevel, selRank, deployment, title = 'L0–L7 层级状态轴',
}: {
  selLevel: LevelKey;
  onSelectLevel: (k: LevelKey) => void;
  selRank?: number | null;
  deployment?: Deployment;
  title?: string;
}) {
  const attr = (selRank != null && deployment) ? attributionOf(deployment, selRank) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>{title}</span>
        <span style={{ fontSize: 9.5, color: 'var(--tx3)' }}>点一层 → 左画布按该粒度重排</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {HW_LEVELS.map((lv) => {
          const on = selLevel === lv.key;
          const c = LEVEL_COLOR[lv.key];
          const onChain = !!(attr && attr[lv.key]);
          return (
            <button
              key={lv.key}
              onClick={() => onSelectLevel(lv.key)}
              title={`${lv.tag} ${lv.name} · ${lv.en}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '5px 8px', borderRadius: 7, cursor: 'pointer', textAlign: 'left',
                border: `1px solid ${on ? c : 'var(--bd)'}`,
                background: on ? `color-mix(in srgb, ${c} 20%, transparent)` : (onChain ? 'var(--btn)' : 'transparent'),
                color: 'var(--tx)',
              }}
            >
              <span style={{ width: 11, height: 11, borderRadius: 3, background: c, flexShrink: 0, boxShadow: onChain ? `0 0 0 2px color-mix(in srgb, ${c} 45%, transparent)` : 'none' }} />
              <span style={{ fontSize: 10, fontFamily: MONO, color: 'var(--tx3)', width: 22, flexShrink: 0 }}>{lv.tag}</span>
              <span style={{ fontSize: 11.5, fontWeight: on ? 700 : 500, flex: 1 }}>{lv.name}{lv.optional ? ' ·可选' : ''}</span>
              {attr && attr[lv.key] && (
                <span style={{ fontSize: 9.5, fontFamily: MONO, color: onChain ? c : 'var(--tx3)' }}>{attr[lv.key]}</span>
              )}
            </button>
          );
        })}
      </div>
      {attr ? (
        <div style={{ fontSize: 9.5, color: 'var(--tx3)', lineHeight: 1.5, borderTop: '1px solid var(--bd)', paddingTop: 5 }}>
          归属链（L7→L0）：{HW_LEVELS.map((l) => attr[l.key]).filter(Boolean).join(' / ')}
        </div>
      ) : (
        <div style={{ fontSize: 9.5, color: 'var(--tx3)', lineHeight: 1.5, borderTop: '1px solid var(--bd)', paddingTop: 5 }}>
          当前粒度：<b style={{ color: 'var(--tx)' }}>{levelName(selLevel)}</b> · 点左画布任一方块 → 高亮其 L7→L0 归属链
        </div>
      )}
    </div>
  );
}

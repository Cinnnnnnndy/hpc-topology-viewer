/**
 * PlanesPanel — a shared, collapsible overlay that surfaces the PHYSICAL device
 * layer the logical "NPU 经 UB 全互联" bus model omitted: the three communication
 * planes (UB scale-up / RDMA scale-out / VPC) and the physical hop-chain
 * (NPU 端口 → 铜/LPO → 交换) with the devices on each path (NPU UB/RDMA ports,
 * CPU, LPO 光模块, 擎天 NIC). Rendered in BOTH the 平面视图 (PlaneView) and the
 * 阵列全景/all 3-D sub-views (ClusterView) so the model is consistent everywhere.
 *
 * Driven entirely by the canonical data in ../scene/data (PLANES / PHYS_DEVICES /
 * PHYS_CHAINS); brand terms come from ../content via those tokens.
 */
import { useState } from 'react';
import { PLANES, PHYS_DEVICES, PHYS_CHAINS, type PlaneId } from '../scene/data';

const PLANE_BY_ID: Record<PlaneId, (typeof PLANES)[number]> = Object.fromEntries(PLANES.map((p) => [p.id, p])) as Record<PlaneId, (typeof PLANES)[number]>;

export function PlanesPanel() {
  const [open, setOpen] = useState(false);

  const pill: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6, padding: '5px 11px', fontSize: 11.5, fontWeight: 600,
    borderRadius: 9, cursor: 'pointer', border: '1px solid var(--bd)', background: 'var(--panel)',
    color: 'var(--tx)', boxShadow: 'var(--shadow-sm)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
  };

  return (
    <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 30, maxWidth: 'calc(100vw - 24px)' }}>
      {!open ? (
        <button onClick={() => setOpen(true)} title="物理器件层 & 三平面（UB scale-up / RDMA scale-out / VPC）" style={pill}>
          <span style={{ display: 'inline-flex', gap: 3 }}>
            {PLANES.map((p) => <span key={p.id} style={{ width: 9, height: 9, borderRadius: 2, background: p.color }} />)}
          </span>
          三平面 / 物理器件 ▾
        </button>
      ) : (
        <div style={{
          width: 'min(560px, calc(100vw - 24px))', padding: '10px 13px', fontSize: 11.5, lineHeight: 1.5,
          background: 'var(--panel)', border: '1px solid var(--bd)', borderRadius: 12, boxShadow: 'var(--shadow)',
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', color: 'var(--tx2)', maxHeight: 'calc(100vh - 90px)', overflowY: 'auto',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
            <span style={{ fontWeight: 700, color: 'var(--tx)', fontSize: 12.5 }}>物理器件层 & 三平面</span>
            <span style={{ color: 'var(--tx3)', fontSize: 10 }}>逻辑 UB 全互联 → 展开为物理链</span>
            <button onClick={() => setOpen(false)} title="收起" style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 11, lineHeight: 1, borderRadius: 7, cursor: 'pointer', border: '1px solid var(--bd)', background: 'var(--btn)', color: 'var(--tx2)' }}>✕</button>
          </div>

          {/* three planes */}
          {PLANES.map((p) => (
            <div key={p.id} style={{ marginBottom: 7, padding: '6px 8px', borderRadius: 8, background: `${p.color}14`, border: `1px solid ${p.color}55` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color, flexShrink: 0 }} />
                <span style={{ fontWeight: 700, color: 'var(--tx)' }}>{p.name}</span>
                <span style={{ marginLeft: 'auto', fontSize: 9.5, padding: '0 6px', borderRadius: 5, color: p.color, border: `1px solid ${p.color}88` }}>{p.parallel}</span>
              </div>
              <div style={{ marginTop: 3 }}><span style={{ color: 'var(--tx3)' }}>作用</span> {p.role}</div>
              <div><span style={{ color: 'var(--tx3)' }}>参与</span> {p.members} · <span style={{ color: 'var(--tx3)' }}>范围</span> {p.scope}</div>
              <div style={{ color: 'var(--tx)' }}><span style={{ color: 'var(--tx3)' }}>器件链</span> {p.devices}</div>
            </div>
          ))}

          {/* physical hop-chains: NPU 端口 → 铜/LPO → 交换 */}
          <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--tx2)', margin: '4px 0 4px' }}>物理链路（hop-chain）</div>
          {PHYS_CHAINS.map((c) => {
            const col = PLANE_BY_ID[c.plane].color;
            return (
              <div key={c.plane} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: col, flexShrink: 0 }} />
                <span style={{ color: 'var(--tx3)', minWidth: 116, fontSize: 10.5 }}>{c.label}</span>
                {c.hops.map((h, i) => (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {i > 0 && <span style={{ color: col }}>→</span>}
                    <span style={{ padding: '1px 6px', borderRadius: 5, fontSize: 10.5, background: `${col}1f`, border: `1px solid ${col}66`, color: 'var(--tx)' }}>{h}</span>
                  </span>
                ))}
              </div>
            );
          })}

          {/* physical device legend */}
          <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--tx2)', margin: '6px 0 4px', borderTop: '1px solid var(--bd)', paddingTop: 5 }}>物理器件</div>
          {PHYS_DEVICES.map((d) => (
            <div key={d.id} style={{ marginBottom: 2 }}>
              <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: d.color, verticalAlign: '-1px', marginRight: 5 }} />
              <span style={{ color: 'var(--tx)', fontWeight: 600 }}>{d.label}</span>
              <span style={{ color: 'var(--tx3)' }}> · {d.note}</span>
            </div>
          ))}
          <div style={{ marginTop: 6, fontSize: 9.5, color: 'var(--tx3)', fontStyle: 'italic' }}>
            关键点：scale-out RDMA 走 NPU 自带 RoCE 口（非擎天 NIC）；擎天 NIC 负责 VPC 平面。LPO 800G 为下一代趋势（待核），原理同。来源：CloudMatrix384 三平面解读 · LPO 功耗/时延（厂商/媒体口径 C）。
          </div>
        </div>
      )}
    </div>
  );
}

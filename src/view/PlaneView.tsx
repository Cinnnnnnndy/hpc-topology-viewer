/**
 * PlaneView — a flat 2-D "tiled" diagram of the full super-node, complementary to
 * the 3-D full-pod view (which it does not touch). Drawn on a 2-D <canvas> so it
 * scales to the full ~8 K-card super-node. Nesting shows the physical containment
 * (super-node → cabinet → blade → card); colour shows parallel-group relationships
 * (TP/PP/DP/EP). Pan = drag, zoom = wheel, hover a card for its identity.
 *
 * Display text with brand terms is sourced from ../content (decoded at runtime).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { GENERATIONS, PARTITION_PALETTE, PARTITION_META, UB_LEVELS, type Gen, type PartitionDim } from '../scene/data';
import { TOK } from '../content';

const CPB = 8, BPC = 8;   // cards / blade, blades / cabinet (= 64 NPU / cabinet)
const COLOR_BTNS: { id: PartitionDim; label: string }[] = [
  { id: 'none', label: '无' }, { id: 'tp', label: 'TP' }, { id: 'pp', label: 'PP' }, { id: 'dp', label: 'DP' }, { id: 'ep', label: 'EP' },
];

export function PlaneView({ gen }: { gen: Gen }) {
  const spec = GENERATIONS[gen];
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tf = useRef<{ s: number; tx: number; ty: number } | null>(null);   // world→screen transform
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const hoverRef = useRef<number | null>(null);
  const [colorBy, setColorBy] = useState<PartitionDim>('none');
  const [tip, setTip] = useState<{ k: number; x: number; y: number } | null>(null);

  // ── layout in world units ──
  const L = (() => {
    const N1 = spec.totalNpus;
    const nB = Math.ceil(N1 / CPB), nC = Math.ceil(nB / BPC);
    const cCols = Math.ceil(Math.sqrt(nC)), cRows = Math.ceil(nC / cCols);
    const cs = 1, gap = 0.3, bpad = 0.5, bgap = 0.5;
    const bw = 4 * (cs + gap) - gap + bpad * 2;        // blade: 4 cols × 2 rows
    const bh = 2 * (cs + gap) - gap + bpad * 2;
    const cpad = 0.9, cgap = 1.6;
    const cw = 2 * bw + bgap + cpad * 2;               // cabinet: 2 blade cols × 4 rows
    const ch = 4 * bh + 3 * bgap + cpad * 2;
    const tw = cCols * cw + (cCols - 1) * cgap;
    const th = cRows * ch + (cRows - 1) * cgap;
    return { N1, nB, nC, cCols, cRows, cs, gap, bpad, bgap, bw, bh, cpad, cgap, cw, ch, tw, th, PP: Math.min(16, nB) };
  })();

  const cabXY = (cab: number): [number, number] => [(cab % L.cCols) * (L.cw + L.cgap), Math.floor(cab / L.cCols) * (L.ch + L.cgap)];
  const bladeXY = (cab: number, bl: number): [number, number] => { const [cx, cy] = cabXY(cab); return [cx + L.cpad + (bl % 2) * (L.bw + L.bgap), cy + L.cpad + Math.floor(bl / 2) * (L.bh + L.bgap)]; };
  const cardXY = (k: number): [number, number] => {
    const b = Math.floor(k / CPB), l = k % CPB, cab = Math.floor(b / BPC), bl = b % BPC;
    const [bx, by] = bladeXY(cab, bl);
    return [bx + L.bpad + (l % 4) * (L.cs + L.gap), by + L.bpad + Math.floor(l / 4) * (L.cs + L.gap)];
  };
  const groupOf = (k: number): number => {
    const b = Math.floor(k / CPB);
    if (colorBy === 'tp') return k % CPB;
    if (colorBy === 'pp') return b % L.PP;
    if (colorBy === 'dp') return Math.floor(b / L.PP);
    if (colorBy === 'ep') return Math.floor(b / BPC);
    return -1;
  };
  const cfg = `TP${CPB}×PP${L.PP}×DP${Math.max(1, Math.round(L.nB / L.PP))}`;

  const fit = useCallback((W: number, H: number) => Math.min(W / L.tw, H / L.th) * 0.92, [L]);

  // hit-test a world point → card index (O(1) via the grid math)
  const pick = (wx: number, wy: number): number | null => {
    const cc = Math.floor(wx / (L.cw + L.cgap)), cr = Math.floor(wy / (L.ch + L.cgap));
    if (cc < 0 || cc >= L.cCols || cr < 0) return null;
    const cab = cr * L.cCols + cc; if (cab >= L.nC) return null;
    let lx = wx - cc * (L.cw + L.cgap) - L.cpad, ly = wy - cr * (L.ch + L.cgap) - L.cpad;
    const blc = Math.floor(lx / (L.bw + L.bgap)), blr = Math.floor(ly / (L.bh + L.bgap));
    if (blc < 0 || blc >= 2 || blr < 0 || blr >= 4) return null;
    const bl = blr * 2 + blc, blade = cab * BPC + bl; if (blade >= L.nB) return null;
    lx -= blc * (L.bw + L.bgap) + L.bpad; ly -= blr * (L.bh + L.bgap) + L.bpad;
    const lc = Math.floor(lx / (L.cs + L.gap)), lr = Math.floor(ly / (L.cs + L.gap));
    if (lc < 0 || lc >= 4 || lr < 0 || lr >= 2) return null;
    if (lx - lc * (L.cs + L.gap) > L.cs || ly - lr * (L.cs + L.gap) > L.cs) return null;   // in the gap
    const k = blade * CPB + (lr * 4 + lc);
    return k < L.N1 ? k : null;
  };

  const draw = useCallback(() => {
    const cv = canvasRef.current, wrap = wrapRef.current; if (!cv || !wrap) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
    if (!tf.current) { const f = fit(W, H); tf.current = { s: f, tx: (W - L.tw * f) / 2, ty: (H - L.th * f) / 2 }; }
    const { s, tx, ty } = tf.current;
    const ctx = cv.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#f3f4f7'; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(tx, ty); ctx.scale(s, s);

    // cabinets (L2) + blades (L1) containment frames
    ctx.lineWidth = 1.2 / s; ctx.strokeStyle = UB_LEVELS[2].color; ctx.fillStyle = 'rgba(167,139,250,0.07)';
    for (let cab = 0; cab < L.nC; cab++) { const [x, y] = cabXY(cab); ctx.fillRect(x, y, L.cw, L.ch); ctx.strokeRect(x, y, L.cw, L.ch); }
    ctx.lineWidth = 0.8 / s; ctx.strokeStyle = UB_LEVELS[1].color;
    for (let b = 0; b < L.nB; b++) { const [x, y] = bladeXY(Math.floor(b / BPC), b % BPC); ctx.strokeRect(x, y, L.bw, L.bh); }

    // cards
    const showBorder = s > 4, showId = s > 16;
    ctx.lineWidth = 0.6 / s; ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    for (let k = 0; k < L.N1; k++) {
      const [x, y] = cardXY(k); const g = groupOf(k);
      ctx.fillStyle = g < 0 ? '#cfd6e2' : PARTITION_PALETTE[g % PARTITION_PALETTE.length];
      ctx.fillRect(x, y, L.cs, L.cs);
      if (showBorder) ctx.strokeRect(x, y, L.cs, L.cs);
      if (showId) { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.font = `${0.34}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(k % CPB), x + L.cs / 2, y + L.cs / 2); }
    }
    // hovered card outline
    const hk = hoverRef.current;
    if (hk != null) { const [x, y] = cardXY(hk); ctx.lineWidth = 2.5 / s; ctx.strokeStyle = '#ffb020'; ctx.strokeRect(x - 0.06, y - 0.06, L.cs + 0.12, L.cs + 0.12); }
    ctx.restore();
  }, [L, colorBy, fit, cabXY, bladeXY, cardXY, groupOf]);

  // redraw on colour / size changes
  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const onR = () => { tf.current = null; draw(); };   // re-fit on resize
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, [draw]);

  // ── interaction ──
  const toWorld = (clientX: number, clientY: number): [number, number] => {
    const cv = canvasRef.current!; const r = cv.getBoundingClientRect(); const t = tf.current!;
    return [(clientX - r.left - t.tx) / t.s, (clientY - r.top - t.ty) / t.s];
  };
  const onWheel = (e: React.WheelEvent) => {
    if (!tf.current) return; const t = tf.current; const r = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const wx = (mx - t.tx) / t.s, wy = (my - t.ty) / t.s;
    const f = Math.exp(-e.deltaY * 0.0015); const ns = Math.max(fit(r.width, r.height) * 0.5, Math.min(t.s * f, fit(r.width, r.height) * 60));
    tf.current = { s: ns, tx: mx - wx * ns, ty: my - wy * ns }; draw();
  };
  const onDown = (e: React.PointerEvent) => { if (!tf.current) return; drag.current = { x: e.clientX, y: e.clientY, tx: tf.current.tx, ty: tf.current.ty }; (e.target as Element).setPointerCapture(e.pointerId); };
  const onUp = (e: React.PointerEvent) => { drag.current = null; try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* noop */ } };
  const onMove = (e: React.PointerEvent) => {
    if (drag.current && tf.current) { tf.current = { ...tf.current, tx: drag.current.tx + (e.clientX - drag.current.x), ty: drag.current.ty + (e.clientY - drag.current.y) }; draw(); return; }
    const [wx, wy] = toWorld(e.clientX, e.clientY); const k = pick(wx, wy);
    if (k !== hoverRef.current) { hoverRef.current = k; draw(); }
    const r = canvasRef.current!.getBoundingClientRect();
    setTip(k == null ? null : { k, x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const onLeave = () => { if (hoverRef.current != null) { hoverRef.current = null; draw(); } setTip(null); };

  const tipInfo = tip && (() => {
    const k = tip.k, b = Math.floor(k / CPB), cab = Math.floor(b / BPC);
    const parts = [`NPU ${k} · rank ${k}`, `刀片 B${b} · 机柜 C${cab}`, `节点内 tp${k % CPB}`];
    if (colorBy !== 'none') parts.push(`${PARTITION_META[colorBy as Exclude<PartitionDim, 'none'>].label}：组 ${groupOf(k)}`);
    return parts;
  })();

  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0, zIndex: 11, background: '#f3f4f7', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor: drag.current ? 'grabbing' : 'crosshair', touchAction: 'none' }}
        onWheel={onWheel} onPointerDown={onDown} onPointerUp={onUp} onPointerMove={onMove} onPointerLeave={onLeave}
      />
      {/* controls */}
      <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'rgba(255,255,255,0.95)', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 8, boxShadow: '0 2px 12px rgba(0,0,0,0.10)' }}>
        <span style={{ fontSize: 11.5, color: 'rgba(0,0,0,0.6)' }}>平面 · 上色</span>
        {COLOR_BTNS.map((c) => {
          const on = colorBy === c.id;
          return <button key={c.id} onClick={() => setColorBy(c.id)} style={{ padding: '4px 9px', fontSize: 11.5, borderRadius: 4, cursor: 'pointer', border: `1px solid ${on ? '#4369ef' : 'rgba(0,0,0,0.12)'}`, background: on ? 'rgba(67,105,239,0.10)' : 'transparent', color: on ? '#4369ef' : 'rgba(0,0,0,0.55)' }}>{c.label}</button>;
        })}
        <span style={{ fontSize: 10.5, color: 'rgba(0,0,0,0.45)', marginLeft: 2 }}>{`${L.N1.toLocaleString()} 卡 · ${L.nC} 机柜 · 拖动平移 / 滚轮缩放`}</span>
      </div>
      {/* legend */}
      <div style={{ position: 'absolute', bottom: 12, left: 12, padding: '7px 11px', fontSize: 11, background: 'rgba(255,255,255,0.95)', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 6, lineHeight: 1.6, color: 'rgba(0,0,0,0.6)' }}>
        <div style={{ fontWeight: 600, color: 'rgba(0,0,0,0.75)', marginBottom: 2 }}>{`全量${TOK.supernode} · 平面拓扑`}</div>
        <div><span style={{ display: 'inline-block', width: 11, height: 11, background: 'rgba(167,139,250,0.18)', border: `1px solid ${UB_LEVELS[2].color}`, borderRadius: 2, verticalAlign: '-2px', marginRight: 5 }} />L2 机柜框（含 8 刀片）</div>
        <div><span style={{ display: 'inline-block', width: 11, height: 11, border: `1px solid ${UB_LEVELS[1].color}`, borderRadius: 2, verticalAlign: '-2px', marginRight: 5 }} />L1 刀片框（含 8 卡）</div>
        <div>{colorBy === 'none' ? '格子 = NPU 卡（嵌套=包含关系）' : `卡按 ${colorBy.toUpperCase()} 组上色（${cfg}）`}</div>
      </div>
      {/* hover tooltip */}
      {tip && tipInfo && (
        <div style={{ position: 'absolute', left: Math.min(tip.x + 14, (wrapRef.current?.clientWidth ?? 9999) - 200), top: tip.y + 14, padding: '6px 9px', fontSize: 11.5, background: 'rgba(255,255,255,0.97)', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 6, pointerEvents: 'none', boxShadow: '0 2px 10px rgba(0,0,0,0.12)', color: 'rgba(0,0,0,0.85)' }}>
          {tipInfo.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
    </div>
  );
}

/**
 * PlaneView — a flat 2-D "tiled" diagram of the full super-node, complementary to
 * the 3-D full-pod view (which it does not touch). Drawn on a 2-D <canvas> so it
 * scales to the full ~8 K-card super-node. Nesting shows the physical containment
 * (super-node → cabinet → blade → card); colour shows parallel-group relationships
 * (TP/PP/DP/EP). Pan = drag, zoom = wheel, hover a card for its identity.
 *
 * Display text with brand terms is sourced from ../content (decoded at runtime).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GENERATIONS, PARTITION_PALETTE, PARALLEL_COLORS, PARTITION_META, UB_LEVELS, COMM_PATTERNS, type Gen, type PartitionDim } from '../scene/data';
import { TOK } from '../content';

const CPB = 8, BPC = 8;   // cards / blade, blades / cabinet (= 64 NPU / cabinet)
const THREADS = 3;        // threads (AI-core groups) per NPU / rank
const COLOR_BTNS: { id: PartitionDim; label: string }[] = [
  { id: 'none', label: '无' }, { id: 'tp', label: 'TP' }, { id: 'pp', label: 'PP' }, { id: 'dp', label: 'DP' }, { id: 'ep', label: 'EP' },
];

export function PlaneView({ gen, dark }: { gen: Gen; dark: boolean }) {
  const spec = GENERATIONS[gen];
  // canvas-2D palette (cannot use CSS var() in fillStyle/strokeStyle)
  const P = dark
    ? { bg: '#101010', cardBd: 'rgba(255,255,255,0.16)', cardN: '#2a2f3a', ink: 'rgba(255,255,255,0.80)', ink2: 'rgba(255,255,255,0.55)' }
    : { bg: '#f3f4f7', cardBd: 'rgba(0,0,0,0.18)', cardN: '#cfd6e2', ink: 'rgba(0,0,0,0.62)', ink2: 'rgba(0,0,0,0.55)' };
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tf = useRef<{ s: number; tx: number; ty: number } | null>(null);   // world→screen transform
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const hoverRef = useRef<number | null>(null);
  const [colorBy, setColorBy] = useState<PartitionDim>('none');
  const [links, setLinks] = useState(true);   // draw card↔card (L1) + node↔node (L2) connections
  const [tip, setTip] = useState<{ k: number; x: number; y: number } | null>(null);
  const [play, setPlay] = useState(false);          // scenario playback (animated hop-by-hop flow)
  const [scenario, setScenario] = useState<'ring' | 'a2a'>('ring');
  const [layout, setLayout] = useState<'top' | 'layers'>('top');   // top-down map vs. layered hierarchy
  const [selL, setSelL] = useState<{ lvl: number; idx: number } | null>(null);   // layered-view selection
  const downXY = useRef<{ x: number; y: number } | null>(null);   // pointer-down (click vs drag)
  const phaseRef = useRef(0);                       // flow animation phase
  const rafRef = useRef<number | null>(null);

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

  // ── layered-hierarchy layout (world units): the same levels as the 3-D topology
  // (线程→进程→L0卡→L1节点→L2机柜→L3超节点) flattened to stacked bands, with a bounded,
  // count-labelled representative fan-out so containment (层级间) + peer mesh (层级内) read. ──
  const LAY = useMemo(() => {
    const N = spec.totalNpus;
    const nCab = Math.max(1, Math.round(N / 64)), Bd = 8, Cd = CPB, Th = THREADS;   // FULL fan-out: 8 nodes/cab · 8 cards/node · 3 thr/rank
    // icicle subdivision: every level fills the SAME fixed width Wc (just divided
    // finer) → the full super-node fits without ever growing horizontally.
    const margin = 9.5, Wc = 52, bandH = 3.0, boxH = 1.0;
    type S = { x0: number; x1: number; cx: number; parent: number };
    const mk = (x0: number, x1: number, parent: number): S => ({ x0, x1, cx: (x0 + x1) / 2, parent });
    const divide = (parents: S[], n: number): S[] => {
      const gf = n >= 24 ? 0.008 : n >= 8 ? 0.05 : 0.09, out: S[] = [];
      parents.forEach((p, pi) => {
        const w = p.x1 - p.x0, g = w * gf, cw = (w - g * (n + 1)) / n;
        for (let k = 0; k < n; k++) { const a = p.x0 + g + k * (cw + g); out.push(mk(a, a + cw, pi)); }
      });
      return out;
    };
    const sup = [mk(margin, margin + Wc, -1)];
    const cab = divide(sup, nCab);
    const node = divide(cab, Bd);
    const card = divide(node, Cd);
    const proc = card.map((c, i) => mk(c.x0, c.x1, i));   // 1 rank : 1 card
    const thr = divide(proc, Th);
    const y = [0, 1, 2, 3, 4, 5].map((i) => boxH + i * bandH);
    return { sup, cab, node, card, proc, thr, boxH, y, margin, Wc, w: margin + Wc + margin, h: boxH * 2 + bandH * 5,
      grp: { cab: nCab, node: Bd, card: Cd, proc: 1, thr: Th },   // children-per-parent at each level
      counts: { sup: 1, cab: nCab, node: nCab * Bd, card: N, proc: N, thr: N * Th } };
  }, [spec]);

  const ext = layout === 'layers' ? { tw: LAY.w, th: LAY.h } : { tw: L.tw, th: L.th };
  const fit = useCallback((W: number, H: number) => Math.min(W / ext.tw, H / ext.th) * 0.92, [ext.tw, ext.th]);

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

  // layered view: hit-test world point → { level, slice index }
  const layArrs = () => [LAY.sup, LAY.cab, LAY.node, LAY.card, LAY.proc, LAY.thr];
  const pickLayer = (wx: number, wy: number): { lvl: number; idx: number } | null => {
    const arrs = layArrs();
    for (let li = 0; li < 6; li++) {
      if (Math.abs(wy - LAY.y[li]) > LAY.boxH * 0.75) continue;
      const idx = arrs[li].findIndex((b) => wx >= b.x0 && wx <= b.x1);
      if (idx >= 0) return { lvl: li, idx };
    }
    return null;
  };
  // Selected up/down-stream chain as a CONTIGUOUS [lo,hi) range per level (the icicle
  // is ordered, so a node's ancestors/descendants are contiguous) → O(1), no per-frame
  // iteration over the 24 K threads.
  const layRange = (): { lo: number[]; hi: number[] } | null => {
    if (!selL) return null;
    const cp = [LAY.grp.cab, LAY.grp.node, LAY.grp.card, LAY.grp.proc, LAY.grp.thr];   // children-per-parent at transition l→l+1
    const lo = [0, 0, 0, 0, 0, 0], hi = [1, 1, 1, 1, 1, 1];
    lo[selL.lvl] = selL.idx; hi[selL.lvl] = selL.idx + 1;
    for (let l = selL.lvl; l > 0; l--) { lo[l - 1] = Math.floor(lo[l] / cp[l - 1]); hi[l - 1] = lo[l - 1] + 1; }   // ancestors
    for (let l = selL.lvl; l < 5; l++) { lo[l + 1] = lo[l] * cp[l]; hi[l + 1] = hi[l] * cp[l]; }                   // descendants
    return { lo, hi };
  };

  const draw = useCallback(() => {
    const cv = canvasRef.current, wrap = wrapRef.current; if (!cv || !wrap) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
    if (!tf.current) { const f = fit(W, H); tf.current = { s: f, tx: (W - ext.tw * f) / 2, ty: (H - ext.th * f) / 2 }; }
    const { s, tx, ty } = tf.current;
    const ctx = cv.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;   // context state persists across frames; force a fully-opaque clear (no ghosting)
    ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(tx, ty); ctx.scale(s, s);

    // ── layered-hierarchy view: full super-node, icicle bands with level-of-detail ──
    if (layout === 'layers') {
      type Slc = { x0: number; x1: number; cx: number; parent: number };
      const half = LAY.boxH / 2, yOf = (i: number) => LAY.y[i], { margin, Wc } = LAY;
      const arrs: Slc[][] = [LAY.sup, LAY.cab, LAY.node, LAY.card, LAY.proc, LAY.thr];
      const meta = [
        { kind: 'super', color: UB_LEVELS[3].color, label: 'L3 超节点' },
        { kind: 'cab',   color: UB_LEVELS[2].color, label: 'L2 机柜' },
        { kind: 'node',  color: UB_LEVELS[1].color, label: 'L1 节点' },
        { kind: 'card',  color: UB_LEVELS[0].color, label: 'L0 卡' },
        { kind: 'proc',  color: '#4369ef',         label: '进程 rank' },
        { kind: 'thread',color: COMM_PATTERNS[2].color, label: '线程' },
      ];
      const counts = [LAY.counts.sup, LAY.counts.cab, LAY.counts.node, LAY.counts.card, LAY.counts.proc, LAY.counts.thr];
      const rr = (x: number, y: number, w: number, h: number, r: number) => {
        const rad = Math.min(r, w / 2, h / 2);
        ctx.beginPath(); ctx.moveTo(x + rad, y);
        ctx.arcTo(x + w, y, x + w, y + h, rad); ctx.arcTo(x + w, y + h, x, y + h, rad);
        ctx.arcTo(x, y + h, x, y, rad); ctx.arcTo(x, y, x + w, y, rad); ctx.closePath();
      };
      const hi = layRange();
      const lit = (li: number, idx: number) => !hi || (idx >= hi.lo[li] && idx < hi.hi[li]);
      const vx0 = -tx / s, vx1 = (W - tx) / s;
      const stepPx = (li: number) => (Wc / counts[li]) * s;          // avg slice width in screen px
      const glyphLOD = (li: number) => stepPx(li) >= 7;              // wide enough to draw individual glyphs
      const visRange = (li: number): [number, number] => { const c = counts[li]; return [Math.max(0, Math.floor((vx0 - margin) / Wc * c) - 1), Math.min(c, Math.ceil((vx1 - margin) / Wc * c) + 1)]; };

      // single-entity glyph (each level drawn as itself)
      const glyph = (kind: string, b: Slc, yy: number, col: string, A: number) => {
        const w = Math.min(b.x1 - b.x0, 3.2) * 0.9, x = b.x0 + (b.x1 - b.x0 - w) / 2, top = yy - half, h = LAY.boxH, cx = b.cx;
        ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = (hi && A === 1 ? 1.4 : 1) / s;
        if (kind === 'super') { ctx.globalAlpha = 0.16 * A; rr(x, top, w, h, 0.18); ctx.fill(); ctx.globalAlpha = A; ctx.stroke(); ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '0.6px sans-serif'; ctx.fillText(TOK.supernode, cx, yy); }
        else if (kind === 'cab') { ctx.globalAlpha = 0.14 * A; rr(x, top, w, h, 0.12); ctx.fill(); ctx.globalAlpha = A; ctx.stroke(); ctx.globalAlpha = 0.55 * A; ctx.lineWidth = 0.4 / s; for (let r = 1; r < 4; r++) { const yk = top + (h * r) / 4; ctx.beginPath(); ctx.moveTo(x + w * 0.14, yk); ctx.lineTo(x + w * 0.86, yk); ctx.stroke(); } ctx.globalAlpha = 1; }
        else if (kind === 'node') { ctx.globalAlpha = 0.13 * A; rr(x, top + h * 0.3, w, h * 0.4, 0.07); ctx.fill(); ctx.globalAlpha = A; ctx.stroke(); ctx.globalAlpha = 0.9 * A; for (let d = 0; d < 8; d++) { const dx = x + w * (0.1 + 0.8 * (d / 7)); ctx.beginPath(); ctx.arc(dx, yy, Math.min(0.07, w * 0.04), 0, 7); ctx.fill(); } ctx.globalAlpha = 1; }
        else if (kind === 'card') { ctx.globalAlpha = 0.18 * A; rr(x, top + h * 0.18, w, h * 0.64, 0.05); ctx.fill(); ctx.globalAlpha = A; ctx.stroke(); ctx.globalAlpha = 0.5 * A; ctx.fillRect(x + w * 0.3, top + h * 0.34, w * 0.4, h * 0.32); ctx.globalAlpha = 1; }
        else if (kind === 'proc') { ctx.globalAlpha = 0.9 * A; ctx.beginPath(); ctx.arc(cx, yy, Math.min(h * 0.3, (b.x1 - b.x0) * 0.32), 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
        else { ctx.globalAlpha = 0.85 * A; const bw2 = Math.min(0.16, (b.x1 - b.x0) * 0.42); rr(cx - bw2 / 2, yy - h * 0.24, bw2, h * 0.44, bw2 * 0.4); ctx.fill(); ctx.globalAlpha = 1; }
      };

      // ── 层级间 (between levels): grey containment lines, only where children resolve (culled) ──
      if (!hi) for (let i = 1; i < 6; i++) {
        if (!glyphLOD(i)) continue;
        const [i0, i1] = visRange(i);
        ctx.strokeStyle = P.cardBd; ctx.globalAlpha = 0.4; ctx.lineWidth = 0.4 / s;
        for (let ci = i0; ci < i1; ci++) { const c = arrs[i][ci], p = arrs[i - 1][c.parent]; if (!p) continue; ctx.beginPath(); ctx.moveTo(p.cx, yOf(i - 1) + half); ctx.lineTo(c.cx, yOf(i) - half); ctx.stroke(); }
      }
      // selected: amber up-stream chain only (selL → super), a few lines; downstream shown via bright bands
      if (hi) { ctx.strokeStyle = '#ffb020'; ctx.globalAlpha = 0.95; ctx.lineWidth = 0.9 / s; for (let i = 1; i <= selL!.lvl; i++) { const p = arrs[i - 1][hi.lo[i - 1]], c = arrs[i][hi.lo[i]]; ctx.beginPath(); ctx.moveTo(p.cx, yOf(i - 1) + half); ctx.lineTo(c.cx, yOf(i) - half); ctx.stroke(); } }
      ctx.globalAlpha = 1;

      // ── 层级内 (within a level): colored arc per sibling group; only when resolved (culled) ──
      const peer = (li: number, gsz: number, color: string, baseA: number, side: number) => {
        if (gsz < 2 || (!glyphLOD(li) && !hi)) return;
        const yEdge = yOf(li) + side * half, c = counts[li], nG = Math.ceil(c / gsz);
        const g0 = Math.max(0, Math.floor((vx0 - margin) / Wc * c / gsz) - 1), g1 = Math.min(nG, Math.ceil((vx1 - margin) / Wc * c / gsz) + 1);
        ctx.lineCap = 'round';
        for (let g = g0; g < g1; g++) {
          const a0 = arrs[li][g * gsz], a1 = arrs[li][Math.min(c - 1, g * gsz + gsz - 1)]; if (!a0 || !a1) continue;
          const on = !hi || (g * gsz >= hi.lo[li] && g * gsz < hi.hi[li]);
          if (hi && !on) continue;
          ctx.strokeStyle = color; ctx.globalAlpha = baseA; ctx.lineWidth = 1.1 / s;
          const x1 = a0.cx, x2 = a1.cx, bow = yEdge + side * (0.32 + Math.min(1.1, (x2 - x1) * 0.14));
          ctx.beginPath(); ctx.moveTo(x1, yEdge); ctx.quadraticCurveTo((x1 + x2) / 2, bow, x2, yEdge); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      };
      peer(1, LAY.grp.cab, UB_LEVELS[3].color, 0.8, -1);     // 机柜↔机柜 · L3 Clos
      peer(2, LAY.grp.node, UB_LEVELS[2].color, 0.8, -1);    // 节点↔节点 · L2 柜内
      peer(3, LAY.grp.card, UB_LEVELS[1].color, 0.78, -1);   // 卡↔卡 · L1 板载 full-mesh
      peer(4, LAY.grp.card, COMM_PATTERNS[0].color, 0.7, 1); // rank↔rank · 进程级集合通信 (TP 域, 下侧)

      // ── levels: detailed glyphs when zoomed in; else EVERY real unit as a batched
      //    mark (no solid "band" — you see all 8192/24576 individuals, culled to view) ──
      ctx.lineCap = 'butt';
      const markSet = (li: number, m0: number, m1: number) => {   // one batched path over a slice range
        if (m1 <= m0) return; const arr = arrs[li], top = yOf(li) - half, tick = li >= 4;
        ctx.beginPath();
        for (let i = m0; i < m1; i++) { const b = arr[i], w = Math.max((b.x1 - b.x0) * (tick ? 0.5 : 0.82), 0.0008); ctx.rect(b.x0 + (b.x1 - b.x0 - w) / 2, top + LAY.boxH * (tick ? 0.18 : 0.16), w, LAY.boxH * (tick ? 0.64 : 0.68)); }
      };
      meta.forEach((m, li) => {
        const yy = yOf(li), [i0, i1] = visRange(li);
        if (glyphLOD(li)) {
          for (let i = i0; i < i1; i++) glyph(m.kind, arrs[li][i], yy, m.color, lit(li, i) ? 1 : 0.14);
        } else if (!hi) {
          markSet(li, i0, i1); ctx.fillStyle = m.color; ctx.globalAlpha = 0.78; ctx.fill(); ctx.globalAlpha = 1;
        } else {
          markSet(li, i0, i1); ctx.fillStyle = m.color; ctx.globalAlpha = 0.13; ctx.fill();          // dim all
          markSet(li, Math.max(i0, hi.lo[li]), Math.min(i1, hi.hi[li])); ctx.fillStyle = m.color; ctx.globalAlpha = 1; ctx.fill();   // bright = selected range
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = m.color; ctx.globalAlpha = 1; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'; ctx.font = '0.66px sans-serif';
        ctx.fillText(m.label, 8.8, yy - 0.05);
        ctx.fillStyle = P.ink2; ctx.font = '0.42px sans-serif';
        ctx.fillText(`×${counts[li].toLocaleString()}`, 8.8, yy + 0.6);
      });
      ctx.restore();
      return;
    }

    const vx0 = -tx / s, vy0 = -ty / s, vx1 = (W - tx) / s, vy1 = (H - ty) / s;   // visible world rect (cull per-card detail)

    // cabinets (L2) + blades (L1) containment frames
    ctx.lineWidth = 1.2 / s; ctx.strokeStyle = UB_LEVELS[2].color; ctx.fillStyle = 'rgba(167,139,250,0.07)';
    for (let cab = 0; cab < L.nC; cab++) { const [x, y] = cabXY(cab); ctx.fillRect(x, y, L.cw, L.ch); ctx.strokeRect(x, y, L.cw, L.ch); }
    ctx.lineWidth = 0.8 / s; ctx.strokeStyle = UB_LEVELS[1].color;
    for (let b = 0; b < L.nB; b++) { const [x, y] = bladeXY(Math.floor(b / BPC), b % BPC); ctx.strokeRect(x, y, L.bw, L.bh); }

    // cards
    const showBorder = s > 4, showId = s > 14, showThr = s > 26;   // card = NPU/rank; threads shown on deep zoom
    const thrC = COMM_PATTERNS[2].color;
    ctx.lineWidth = 0.6 / s; ctx.strokeStyle = P.cardBd;
    for (let k = 0; k < L.N1; k++) {
      const [x, y] = cardXY(k); const g = groupOf(k);
      ctx.fillStyle = g < 0 ? P.cardN : PARTITION_PALETTE[g % PARTITION_PALETTE.length];
      ctx.fillRect(x, y, L.cs, L.cs);
      if (showBorder) ctx.strokeRect(x, y, L.cs, L.cs);
      // process = the NPU's rank (label); threads = 3 AI-core slices (sub-cells) — only for visible cards
      if (showId && x + L.cs >= vx0 && x <= vx1 && y + L.cs >= vy0 && y <= vy1) {
        ctx.fillStyle = P.ink; ctx.textAlign = 'center'; ctx.font = '0.28px sans-serif';
        ctx.textBaseline = showThr ? 'top' : 'middle';
        ctx.fillText(`r${k}`, x + L.cs / 2, y + (showThr ? 0.07 : L.cs / 2));
        if (showThr) {
          const gp = L.cs * 0.07, tw = (L.cs - gp * (THREADS + 1)) / THREADS, th = L.cs * 0.34, tyy = y + L.cs - th - gp;
          ctx.fillStyle = thrC;
          for (let t = 0; t < THREADS; t++) ctx.fillRect(x + gp + t * (tw + gp), tyy, tw, th);
        }
      }
    }
    // same-level connections (LOD): L2 node mesh (blade↔blade full-mesh per cabinet) +
    // L1 board 2-D mesh (card↔card neighbours per blade)
    if (links && s * L.bw > 14) {
      ctx.strokeStyle = UB_LEVELS[2].color; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.1 / s; ctx.beginPath();
      for (let cab = 0; cab < L.nC; cab++) {
        const c: [number, number][] = [];
        for (let bl = 0; bl < BPC; bl++) { const blade = cab * BPC + bl; if (blade >= L.nB) break; const [bx, by] = bladeXY(cab, bl); c.push([bx + L.bw / 2, by + L.bh / 2]); }
        for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) { ctx.moveTo(c[i][0], c[i][1]); ctx.lineTo(c[j][0], c[j][1]); }
      }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (links && s * L.cs > 4) {
      ctx.strokeStyle = UB_LEVELS[1].color; ctx.globalAlpha = 0.55; ctx.lineWidth = 0.7 / s; ctx.beginPath();
      for (let b = 0; b < L.nB; b++) {
        const cen: [number, number][] = [];
        for (let l = 0; l < CPB; l++) { const k = b * CPB + l; if (k >= L.N1) break; const [x, y] = cardXY(k); cen.push([x + L.cs / 2, y + L.cs / 2]); }
        for (let l = 0; l < cen.length; l++) {
          const col = l % 4, row = Math.floor(l / 4);
          if (col < 3 && l + 1 < cen.length) { ctx.moveTo(cen[l][0], cen[l][1]); ctx.lineTo(cen[l + 1][0], cen[l + 1][1]); }   // right neighbour
          if (row === 0 && l + 4 < cen.length) { ctx.moveTo(cen[l][0], cen[l][1]); ctx.lineTo(cen[l + 4][0], cen[l + 4][1]); }  // down neighbour
        }
      }
      ctx.stroke(); ctx.globalAlpha = 1;
    }

    // ── scenario playback: animated hop-by-hop flow (marching ants) ──
    // Ring-AllReduce → staged L1 (intra-blade) then L2 (intra-cabinet); All-to-All
    // → L2 cross-blade full-mesh emphasised. Reads as "卡→刀片→机柜逐跳流动".
    if (play) {
      const ph = phaseRef.current, cyc = ph % 1;
      const col = scenario === 'ring' ? COMM_PATTERNS[0].color : COMM_PATTERNS[1].color;
      const l1A = scenario === 'ring' ? (cyc < 0.5 ? 1 : 0.3) : 0.45;
      const l2A = scenario === 'ring' ? (cyc >= 0.5 ? 1 : 0.3) : 1;
      ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 8;
      ctx.setLineDash([0.16, 0.46]); ctx.lineDashOffset = -ph * 1.4;
      // L1 board flow
      if (links && s * L.cs > 4) {
        ctx.globalAlpha = 0.95 * l1A; ctx.lineWidth = 1.5 / s; ctx.beginPath();
        for (let b = 0; b < L.nB; b++) {
          const cen: [number, number][] = [];
          for (let l = 0; l < CPB; l++) { const k = b * CPB + l; if (k >= L.N1) break; const [x, y] = cardXY(k); cen.push([x + L.cs / 2, y + L.cs / 2]); }
          for (let l = 0; l < cen.length; l++) {
            const col2 = l % 4, row = Math.floor(l / 4);
            if (col2 < 3 && l + 1 < cen.length) { ctx.moveTo(cen[l][0], cen[l][1]); ctx.lineTo(cen[l + 1][0], cen[l + 1][1]); }
            if (row === 0 && l + 4 < cen.length) { ctx.moveTo(cen[l][0], cen[l][1]); ctx.lineTo(cen[l + 4][0], cen[l + 4][1]); }
          }
        }
        ctx.stroke();
      }
      // L2 cabinet blade-mesh flow
      if (links && s * L.bw > 14) {
        ctx.globalAlpha = 0.95 * l2A; ctx.lineWidth = 1.8 / s; ctx.beginPath();
        for (let cab = 0; cab < L.nC; cab++) {
          const c: [number, number][] = [];
          for (let bl = 0; bl < BPC; bl++) { const blade = cab * BPC + bl; if (blade >= L.nB) break; const [bx, by] = bladeXY(cab, bl); c.push([bx + L.bw / 2, by + L.bh / 2]); }
          for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) { ctx.moveTo(c[i][0], c[i][1]); ctx.lineTo(c[j][0], c[j][1]); }
        }
        ctx.stroke();
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.restore();
    }

    // hovered card: "active" glow on its links — board neighbours (L1) + its blade↔
    // cabinet blades (L2). Rounded caps + shadow blur = a flow-engine "active" style.
    const hk = hoverRef.current;
    if (hk != null) {
      const b = Math.floor(hk / CPB), cab = Math.floor(b / BPC);
      const [hx, hy] = cardXY(hk); const hc: [number, number] = [hx + L.cs / 2, hy + L.cs / 2];
      ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // L2: hovered blade centre → other blade centres in the cabinet
      const [bx, by] = bladeXY(cab, b % BPC); const bc: [number, number] = [bx + L.bw / 2, by + L.bh / 2];
      ctx.strokeStyle = UB_LEVELS[2].color; ctx.shadowColor = UB_LEVELS[2].color; ctx.shadowBlur = 10; ctx.lineWidth = 1.6 / s; ctx.globalAlpha = 0.9; ctx.beginPath();
      for (let bl = 0; bl < BPC; bl++) { const blade = cab * BPC + bl; if (blade >= L.nB || blade === b) continue; const [ox, oy] = bladeXY(cab, bl); ctx.moveTo(bc[0], bc[1]); ctx.lineTo(ox + L.bw / 2, oy + L.bh / 2); }
      ctx.stroke();
      // L1: hovered card → its 7 board siblings
      ctx.strokeStyle = UB_LEVELS[1].color; ctx.shadowColor = UB_LEVELS[1].color; ctx.shadowBlur = 12; ctx.lineWidth = 2 / s; ctx.globalAlpha = 1; ctx.beginPath();
      for (let l = 0; l < CPB; l++) { const k2 = b * CPB + l; if (k2 >= L.N1 || k2 === hk) continue; const [sx, sy] = cardXY(k2); ctx.moveTo(hc[0], hc[1]); ctx.lineTo(sx + L.cs / 2, sy + L.cs / 2); }
      ctx.stroke();
      ctx.restore();
      // hovered card outline (on top, no blur)
      ctx.lineWidth = 2.5 / s; ctx.strokeStyle = '#ffb020'; ctx.strokeRect(hx - 0.06, hy - 0.06, L.cs + 0.12, L.cs + 0.12);
    }
    ctx.restore();
  }, [L, colorBy, links, fit, cabXY, bladeXY, cardXY, groupOf, dark, play, scenario, layout, selL]);

  // re-fit when the layout (top ↔ layers) changes, then redraw
  useEffect(() => { tf.current = null; setSelL(null); setPlay(false); }, [layout]);
  // redraw on colour / size changes
  useEffect(() => { draw(); }, [draw]);

  // scenario playback loop: advance the flow phase and redraw
  useEffect(() => {
    if (!play || layout !== 'top') { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = null; return; }
    const loop = () => { phaseRef.current += 0.02; draw(); rafRef.current = requestAnimationFrame(loop); };
    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = null; };
  }, [play, draw, layout]);
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
    const fb = fit(r.width, r.height), maxZ = layout === 'layers' ? fb * 400 : fb * 60;   // layers needs deep zoom to resolve cards/threads
    const f = Math.exp(-e.deltaY * 0.0015); const ns = Math.max(fb * 0.5, Math.min(t.s * f, maxZ));
    tf.current = { s: ns, tx: mx - wx * ns, ty: my - wy * ns }; draw();
  };
  const onDown = (e: React.PointerEvent) => { if (!tf.current) return; downXY.current = { x: e.clientX, y: e.clientY }; drag.current = { x: e.clientX, y: e.clientY, tx: tf.current.tx, ty: tf.current.ty }; (e.target as Element).setPointerCapture(e.pointerId); };
  const onUp = (e: React.PointerEvent) => {
    // layered view: a click (no drag) selects a node → highlight its up/down-stream chain
    if (layout === 'layers' && downXY.current && Math.abs(e.clientX - downXY.current.x) + Math.abs(e.clientY - downXY.current.y) < 5) {
      const [wx, wy] = toWorld(e.clientX, e.clientY); const hit = pickLayer(wx, wy);
      setSelL((prev) => (hit && prev && prev.lvl === hit.lvl && prev.idx === hit.idx ? null : hit));
    }
    downXY.current = null; drag.current = null; try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };
  const onMove = (e: React.PointerEvent) => {
    if (drag.current && tf.current) { tf.current = { ...tf.current, tx: drag.current.tx + (e.clientX - drag.current.x), ty: drag.current.ty + (e.clientY - drag.current.y) }; draw(); return; }
    if (layout === 'layers') return;   // layered view: pan/zoom only (no per-card hover)
    const [wx, wy] = toWorld(e.clientX, e.clientY); const k = pick(wx, wy);
    if (k !== hoverRef.current) { hoverRef.current = k; draw(); }
    const r = canvasRef.current!.getBoundingClientRect();
    setTip(k == null ? null : { k, x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const onLeave = () => { if (hoverRef.current != null) { hoverRef.current = null; draw(); } setTip(null); };

  const tipInfo = tip && (() => {
    const k = tip.k, b = Math.floor(k / CPB), cab = Math.floor(b / BPC);
    const parts = [`NPU ${k} = 进程 rank ${k}`, `线程 ${THREADS} 个（AI Core 组）· tp${k % CPB}`, `刀片 B${b} · 机柜 C${cab}`];
    if (colorBy !== 'none') parts.push(`${PARTITION_META[colorBy as Exclude<PartitionDim, 'none'>].label}：组 ${groupOf(k)}`);
    return parts;
  })();

  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0, zIndex: 11, background: 'var(--bg2)', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor: drag.current ? 'grabbing' : layout === 'layers' ? 'pointer' : 'crosshair', touchAction: 'none' }}
        onWheel={onWheel} onPointerDown={onDown} onPointerUp={onUp} onPointerMove={onMove} onPointerLeave={onLeave}
      />
      {/* controls */}
      <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'var(--panel)', border: '1px solid var(--bd)', borderRadius: 12, boxShadow: 'var(--shadow)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}>
        {/* layout: top-down map vs. layered hierarchy */}
        <span style={{ fontSize: 11.5, color: 'var(--tx2)' }}>布局</span>
        {([['top', '顶视图'], ['layers', '层级图']] as [typeof layout, string][]).map(([id, lb]) => {
          const on = layout === id;
          return <button key={id} onClick={() => setLayout(id)} title={id === 'top' ? '超节点顶视图（嵌套平铺）' : '层级图（线程→进程→卡→节点→机柜→超节点，示意层级间/层级内关系）'}
            style={{ padding: '4px 10px', fontSize: 11.5, borderRadius: 6, cursor: 'pointer', border: `1px solid ${on ? '#4369ef' : 'var(--bd)'}`, background: on ? 'rgba(67,105,239,0.12)' : 'transparent', color: on ? '#4369ef' : 'var(--tx2)' }}>{lb}</button>;
        })}
        <span style={{ borderLeft: '1px solid var(--bd)', height: 16, margin: '0 2px' }} />
        {layout === 'top' ? (
          <>
            <span style={{ fontSize: 11.5, color: 'var(--tx2)' }}>上色</span>
            {COLOR_BTNS.map((c) => {
              const on = colorBy === c.id; const sig = PARALLEL_COLORS[c.id];
              return <button key={c.id} onClick={() => setColorBy(c.id)} title={`按 ${c.label} 上色`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', fontSize: 11.5, borderRadius: 6, cursor: 'pointer', border: `1px solid ${on ? sig : 'var(--bd)'}`, background: on ? `${sig}1f` : 'transparent', color: on ? sig : 'var(--tx2)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: sig, display: 'inline-block', opacity: on ? 1 : 0.6 }} />{c.label}
              </button>;
            })}
            <button onClick={() => setLinks((v) => !v)} title="卡↔卡（L1 板载）+ 节点↔节点（L2 机柜内）连线，放大后显示"
              style={{ padding: '4px 9px', fontSize: 11.5, borderRadius: 6, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 4, border: `1px solid ${links ? UB_LEVELS[1].color : 'var(--bd)'}`, background: links ? `${UB_LEVELS[1].color}22` : 'transparent', color: links ? 'var(--tx)' : 'var(--tx3)' }}>
              <span style={{ width: 9, height: 3, background: UB_LEVELS[1].color, display: 'inline-block', borderRadius: 1, opacity: links ? 1 : 0.4 }} />连线
            </button>
            <span style={{ borderLeft: '1px solid var(--bd)', height: 16, margin: '0 2px' }} />
            {(['ring', 'a2a'] as const).map((sc) => {
              const on = scenario === sc, c = sc === 'ring' ? COMM_PATTERNS[0].color : COMM_PATTERNS[1].color;
              return <button key={sc} onClick={() => { setScenario(sc); setPlay(true); }} title={sc === 'ring' ? 'Ring-AllReduce（数据并行梯度规约）' : 'All-to-All（MoE 专家并行）'}
                style={{ padding: '4px 9px', fontSize: 11.5, borderRadius: 6, cursor: 'pointer', border: `1px solid ${on ? c : 'var(--bd)'}`, background: on ? `${c}1f` : 'transparent', color: on ? c : 'var(--tx2)' }}>{sc === 'ring' ? 'AllReduce' : 'All-to-All'}</button>;
            })}
            <button onClick={() => setPlay((v) => !v)} title="播放 / 暂停 数据流动"
              style={{ padding: '4px 10px', fontSize: 11.5, borderRadius: 6, cursor: 'pointer', border: `1px solid ${play ? '#4369ef' : 'var(--bd)'}`, background: play ? 'rgba(67,105,239,0.12)' : 'transparent', color: play ? '#4369ef' : 'var(--tx2)' }}>{play ? '⏸ 播放中' : '▶ 播放'}</button>
            <span style={{ fontSize: 10.5, color: 'var(--tx3)', marginLeft: 2 }}>{`${L.N1.toLocaleString()} 卡 · ${L.nC} 机柜 · 拖动 / 滚轮缩放`}</span>
          </>
        ) : (
          <span style={{ fontSize: 10.5, color: 'var(--tx3)' }}>{`层级图 · 全量${LAY.counts.card.toLocaleString()} 卡 · 竖线=层级间包含 / 彩弧=层级内互联 · 缩放看个体，点节点高亮上下游`}</span>
        )}
      </div>
      {/* legend */}
      <div style={{ position: 'absolute', bottom: 12, left: 12, padding: '7px 11px', fontSize: 11, background: 'var(--panel)', border: '1px solid var(--bd)', borderRadius: 10, boxShadow: 'var(--shadow-sm)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', lineHeight: 1.6, color: 'var(--tx2)' }}>
        {layout === 'top' ? (
          <>
            <div style={{ fontWeight: 600, color: 'var(--tx)', marginBottom: 2 }}>{`全量${TOK.supernode} · 平面拓扑`}</div>
            <div><span style={{ display: 'inline-block', width: 11, height: 11, background: 'rgba(167,139,250,0.18)', border: `1px solid ${UB_LEVELS[2].color}`, borderRadius: 2, verticalAlign: '-2px', marginRight: 5 }} />L2 机柜框（含 8 刀片）</div>
            <div><span style={{ display: 'inline-block', width: 11, height: 11, border: `1px solid ${UB_LEVELS[1].color}`, borderRadius: 2, verticalAlign: '-2px', marginRight: 5 }} />L1 刀片框（含 8 卡）</div>
            <div>卡 = NPU / 进程 rank · <span style={{ display: 'inline-block', width: 9, height: 7, background: COMM_PATTERNS[2].color, borderRadius: 1, verticalAlign: '-1px', margin: '0 4px' }} />卡内 3 格 = 线程（放大显示）</div>
            <div>{colorBy === 'none' ? '格子 = NPU 卡（嵌套=包含关系）' : `卡按 ${colorBy.toUpperCase()} 组上色（${cfg}）`}</div>
            {links && <div><span style={{ display: 'inline-block', width: 11, height: 0, borderTop: `2px solid ${UB_LEVELS[1].color}`, verticalAlign: 'middle', marginRight: 5 }} />卡↔卡(L1) · <span style={{ display: 'inline-block', width: 11, height: 0, borderTop: `2px solid ${UB_LEVELS[2].color}`, verticalAlign: 'middle', margin: '0 5px' }} />节点↔节点(L2)，放大显示</div>}
            {play && <div style={{ color: scenario === 'ring' ? COMM_PATTERNS[0].color : COMM_PATTERNS[1].color }}>{scenario === 'ring' ? '▶ Ring-AllReduce：先卡内(L1)逐跳→再机柜内(L2)' : '▶ All-to-All：机柜内刀片全互联(L2)'} · 放大看流动</div>}
          </>
        ) : (
          <>
            <div style={{ fontWeight: 600, color: 'var(--tx)', marginBottom: 3 }}>{`${TOK.supernode} · 层级图（与立体拓扑同层级）`}</div>
            {/* what each glyph means */}
            {([['L3 超节点', UB_LEVELS[3].color, '面板'], ['L2 机柜', UB_LEVELS[2].color, '柜(槽位)'], ['L1 节点', UB_LEVELS[1].color, '刀片·8 NPU 点'], ['L0 卡', UB_LEVELS[0].color, '芯片·die'], ['进程 rank', '#4369ef', '圆点'], ['线程', COMM_PATTERNS[2].color, '小竖条']] as [string, string, string][]).map(([nm, c, g]) => (
              <div key={nm}><span style={{ display: 'inline-block', width: 9, height: 9, background: c, borderRadius: 2, verticalAlign: '-1px', marginRight: 5 }} />{nm} <span style={{ color: 'var(--tx3)' }}>= {g}</span></div>
            ))}
            <div style={{ borderTop: '1px solid var(--bd)', marginTop: 3, paddingTop: 3 }}>
              <span style={{ display: 'inline-block', width: 11, height: 0, borderTop: '2px solid var(--tx3)', verticalAlign: 'middle', marginRight: 5 }} /><b style={{ color: 'var(--tx2)' }}>层级间</b> 灰竖线 = 包含（父⊃子）
            </div>
            <div><span style={{ display: 'inline-block', width: 12, height: 6, borderTop: `2px solid ${UB_LEVELS[1].color}`, borderRadius: '8px 8px 0 0', verticalAlign: 'middle', marginRight: 5 }} /><b style={{ color: 'var(--tx2)' }}>层级内</b> 彩弧 = 同级互联（卡/节点/机柜 mesh · rank 集合通信）</div>
            <div style={{ color: 'var(--tx3)', fontSize: 10, marginTop: 2 }}>{`全量${TOK.supernode}（${LAY.counts.card.toLocaleString()} 卡 / ${LAY.counts.thr.toLocaleString()} 线程）· 每层铺满全部单元，放大显示单个图元+层内连线 · 点节点高亮上下游`}</div>
            {selL && <div style={{ color: '#ffb020' }}>已选中：高亮其所属链路（上游父级 + 下游子级）· 再点取消</div>}
          </>
        )}
      </div>
      {/* hover tooltip */}
      {tip && tipInfo && (
        <div style={{ position: 'absolute', left: Math.min(tip.x + 14, (wrapRef.current?.clientWidth ?? 9999) - 200), top: tip.y + 14, padding: '6px 9px', fontSize: 11.5, background: 'var(--panel)', border: '1px solid var(--bd2)', borderRadius: 10, pointerEvents: 'none', boxShadow: 'var(--shadow-sm)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', color: 'var(--tx)' }}>
          {tipInfo.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
    </div>
  );
}

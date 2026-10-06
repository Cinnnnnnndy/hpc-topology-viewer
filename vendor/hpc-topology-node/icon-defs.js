// Hardware entity 2D SVG icon builders
// window.HWICONS.build(id, led, R, light) → React SVG element (48×36 viewBox)
// led: null=default; '#04D793'=idle '#FFAA3B'=warn '#FF4B7B'=busy '#5A6172'=offline
// Status is integrated INTO the icon (no separate bottom bar)
(function(){
'use strict';
window.HWICONS = {};
window.HWICONS.build = function(id, led, R, light) {
  // Blend helper: subtle status wash on body colors — same language as 3D
  const blend=(baseHex,tintHex,ratio)=>{
    const b=parseInt(baseHex.slice(1),16), t=parseInt(tintHex.slice(1),16);
    const br=(b>>16)&255,bg=(b>>8)&255,bb=b&255, tr=(t>>16)&255,tg=(t>>8)&255,tb=t&255;
    const r=Math.round(br*(1-ratio)+tr*ratio), g=Math.round(bg*(1-ratio)+tg*ratio), bl=Math.round(bb*(1-ratio)+tb*ratio);
    return '#'+[r,g,bl].map(v=>v.toString(16).padStart(2,'0')).join('');
  };
  const TINT = led||null;      // any status color triggers body wash
  const R0 = 0.22, R1 = 0.16;  // R0=main body ratio, R1=lighter zones (less tint, stay brighter)

  let F=light?'#CCCDD0':'#535151';       // main body
  let D=light?'#C4C4C4':'#5a5a5a';       // deep / secondary
  let L=light?'#F7F8F8':'#78797d';       // bright / highlight
  const BK=light?'#6F7072':'#1a1a1a';      // dark elements (stay neutral — structural)
  let METAL=light?'#B8BABE':'#A0A0A0';   // metallic silver (IHS, bracket)
  const BL='#4369EF';
  let SW=light?'#8090A8':'#2e3d52';
  // Structural zone colors — all gray-toned, no hue semantics in default state
  let AIC_BG=light?'#D8DADC':'#484848';  // AIC Cube zone — lighter gray
  let AIC_GR=light?'#B4B6B8':'#363636';  // AIC grid lines
  let AIV_BG=light?'#C8C8CA':'#404040';  // AIV Vector zone — mid gray
  let AIV_GR=light?'#A8A8AA':'#2e2e2e';  // AIV grid lines
  let SCAL_BG=light?'#DCDCDE':'#525050'; // Scalar zone — light gray
  let HBM_BG=light?'#CACACE':'#484848';  // HBM stack — slightly cooler gray
  const ST=led||null;  // status color = full saturation, reserved for LED/key regions

  if(TINT){
    F=blend(F,TINT,R0); D=blend(D,TINT,R0); L=blend(L,TINT,R1);
    METAL=blend(METAL,TINT,R1); SW=blend(SW,TINT,R0);
    AIC_BG=blend(AIC_BG,TINT,R1); AIC_GR=blend(AIC_GR,TINT,R0);
    AIV_BG=blend(AIV_BG,TINT,R0); AIV_GR=blend(AIV_GR,TINT,R0);
    SCAL_BG=blend(SCAL_BG,TINT,R1); HBM_BG=blend(HBM_BG,TINT,R0);
  }

  const s = (...ch) => R.createElement('svg',{viewBox:'0 0 48 36',xmlns:'http://www.w3.org/2000/svg',style:{display:'block',width:'100%',height:'100%'}},...ch.filter(x=>x!=null));
  const r = (x,y,w,h,f=F,rx=0) => R.createElement('rect',{x,y,width:w,height:h,fill:f,rx});
  const l = (x1,y1,x2,y2,stroke=L,sw=0.8) => R.createElement('line',{x1,y1,x2,y2,stroke,strokeWidth:sw});
  const ci = (cx,cy,rr,f) => R.createElement('circle',{cx,cy,r:rr,fill:f});

  switch(id){

  // ── SuperPoD: 3 rack columns + spine bridge at top ──
  case 'superpod': return s(
    r(2,5,12,28,F,1.5), r(19,5,12,28,F,1.5), r(36,5,12,28,F,1.5),
    r(12,6,7,27,D), r(29,6,7,27,D),
    // status: spine bridge changes color
    r(0,0,48,5,ST||SW,1.5),
    l(8,5,8,1,D,1), l(25,5,25,1,D,1), l(42,5,42,1,D,1));

  // ── Rack: vertical frame + blade slot lines + side LED column ──
  case 'rack': return s(
    r(10,1,28,34,F,1),
    ...[5,9,13,17,21,25,29].map(y=>r(11,y,26,1.5,D)),
    r(37,2,2,32,ST||D));   // LED column = status

  // ── Blade: flat slab + NPU spreaders + handle notch + integrated LED ──
  case 'blade': return s(
    r(2,11,44,14,F,1.5),
    ...[4,9,14,19,24,29,34,39].map(x=>r(x,5,3.5,11,D,0.5)),
    r(19,4,10,10,D,1.5),
    r(2,24,44,2,ST||D));   // blade LED strip = status (part of blade face)

  // ── NPU: Ascend 910 top-down — large IHS frame + 3-col silver blocks + full BGA dot border ──
  case 'npu': {
    let SIL  = light?'#D8D8DA':'#8a8a8a';  // silver functional blocks
    const DIE  = light?'#282828':'#080808';   // dark die substrate (stays neutral)
    const PCB  = light?'#181818':'#040404';   // dark PCB ring (stays neutral)
    const GOLD2= light?'#C8A855':'#8B6914';
    if(TINT) SIL=blend(SIL,TINT,R1);
    // Dot rows on all 4 die edges (BGA / connector pads)
    const TR = Array.from({length:20},(_,i)=>ci(7+i*1.72,7.2,.52,light?'#5a5a5c':'#383838'));
    const BR = Array.from({length:20},(_,i)=>ci(7+i*1.72,28.8,.52,light?'#5a5a5c':'#383838'));
    const LR = Array.from({length:7}, (_,i)=>ci(5.8,9+i*2.8,.52,light?'#5a5a5c':'#383838'));
    const RR = Array.from({length:7}, (_,i)=>ci(42.2,9+i*2.8,.52,light?'#5a5a5c':'#383838'));
    return s(
      // Outer IHS silver frame — large rounded corners per real hardware
      r(0,0,48,36,METAL,7.5),
      // Dark PCB substrate ring (visible inside IHS)
      r(3,3,42,30,PCB,5),
      // Dark die bezel / window frame
      r(5,5,38,26,DIE,3),
      // BGA / connector dot rows on all sides
      ...TR,...BR,...LR,...RR,
      // Left col — top block (notch at bottom-right corner)
      r(6,6,10,9,SIL,.5),
      r(14,13,2,2,DIE,0),  // bottom-right notch of left-top
      // Left col — gap (dark, middle)
      // (gap = r(6,15,10,4,DIE) — achieved by simply not filling)
      // Left col — bottom block (notch at top-right corner)
      r(6,19,10,9,SIL,.5),
      r(14,19,2,2,DIE,0),  // top-right notch of left-bottom
      // Center col — single large dominant block
      r(18,6,12,24,SIL,.5),
      // Right col — top block (notch at bottom-left corner)
      r(32,6,10,9,SIL,.5),
      r(32,13,2,2,DIE,0),  // bottom-left notch of right-top
      // Right col — bottom block (notch at top-left corner)
      r(32,19,10,9,SIL,.5),
      r(32,19,2,2,DIE,0),  // top-left notch of right-bottom
      // Vertical dark dividers between columns
      r(16,6,2,24,DIE,0), r(30,6,2,24,DIE,0),
      // Horizontal middle gap in left and right columns
      r(6,15,10,4,DIE,0), r(32,15,10,4,DIE,0),
      // Status strip at die window bottom edge
      ST ? r(6,29,36,2,ST,.5) : null);
  }

  // ── Die pair: two die blocks + HBM stepped tiers on sides (matches HBM entity) + D2D bridge ──
  case 'die': {
    const hbmL=[ r(1,22,4,8,HBM_BG,0.5), r(2,14,3,7,HBM_BG,0.5), r(2,8,3,5,HBM_BG,0.5) ];
    const hbmR=[ r(43,22,4,8,HBM_BG,0.5), r(45,14,3,7,HBM_BG,0.5), r(45,8,3,5,HBM_BG,0.5) ];
    const zoneL=[ r(6,8,6,7,L,0.5),r(13,8,6,7,AIC_BG,0.5), r(6,16,6,6,AIC_BG,0.5),r(13,16,6,6,D,0.5), r(6,23,13,4,F,0.5) ];
    const zoneR=[ r(29,8,6,7,L,0.5),r(36,8,6,7,AIC_BG,0.5), r(29,16,6,6,AIC_BG,0.5),r(36,16,6,6,D,0.5), r(29,23,13,4,F,0.5) ];
    return s(
      r(4,6,40,23,BK,1.5),
      r(5,7,16,21,F,1), r(27,7,16,21,F,1),
      ...hbmL,...hbmR,
      ...zoneL,...zoneR,
      r(21,13,6,8,ST||D,1.5));  // D2D bridge = status
  }

  // ── HBM stack: 3 tiers, stepped wider toward base ──
  case 'hbm': return s(
    r(12,26,24,7,BK,1.5),
    r(15,19,18,6,HBM_BG,1), r(12,12,24,6,HBM_BG,1), r(9,5,30,6,HBM_BG,1),
    l(15,19,15,25,L,.6), l(33,19,33,25,L,.6),
    l(12,12,12,18,L,.6), l(36,12,36,18,L,.6),
    r(9,4,30,2,ST||D));  // top layer highlight = status (gray default)

  // ── AI Core: AIC block array (5×4 cubes matching 3D) + AIV stripes + Scalar ──
  case 'aicore': {
    const cubeW=4.2, cubeH=5.0, gapX=0.8, gapY=0.8;
    const startX=3, startY=6;
    const cubeRowCols=[AIC_BG, F, D, AIC_GR]; // front=bright → back=deep
    const cubes=[];
    for(let col=0;col<5;col++) for(let row=0;row<4;row++)
      cubes.push(r(startX+col*(cubeW+gapX), startY+row*(cubeH+gapY), cubeW, cubeH, cubeRowCols[row], 0.5));
    return s(
      r(1,4,46,26,D,1.5),
      r(2,5,26,24,AIC_BG,1),   // AIC base plate
      ...cubes,
      r(29,5,12,24,AIV_BG,1),
      l(29,10,41,10,AIV_GR,.7), l(29,16,41,16,AIV_GR,.7), l(29,22,41,22,AIV_GR,.7),
      r(42,9,5,16,SCAL_BG,1.5),
      r(2,27,26,2,ST||D));  // AIC bottom strip = status
  }

  // ── Tile: 4×2 grid, one cell lit ──
  case 'tile': return s(
    r(8,4,32,28,F,1.5),
    // Tile: all cells gray, status cell slightly lighter (no green in default state)
    ...Array.from({length:8},(_,i)=>r(9+(i%4)*7,5+Math.floor(i/4)*13,6,11,
      i===1?(ST||F):D,0.8)));  // lit cell = ST or main (lighter gray)

  // ── UB Switch: port array + LPO module slots ──
  case 'ub_switch': return s(
    r(0,8,48,18,SW,1.5),
    ...Array.from({length:16},(_,p)=>r(1+p*3,10,2,2,p===0&&ST?ST:D,0.5)),
    r(0,3,48,5,D),
    ...[5,14,23,32,41].map(x=>r(x,4,6,3,L,1)));  // first port dot = status

  // ── CPU 鲲鹏: retention bracket + IHS + inner panel + 4 corner screws (BRASS) ──
  case 'cpu': return s(
    r(2,1,44,34,BK,3.5),
    r(8,5,32,26,METAL,2.5),
    r(12,8,25,20,F,1.5),
    ci(5.5,3.5,2.5,'#B8A06A'),   // brass screws — match 3D
    ci(42.5,3.5,2.5,'#B8A06A'),
    ci(5.5,32.5,2.5,'#B8A06A'),
    ci(42.5,32.5,2.5,'#B8A06A'),
    ST ? r(12,26,25,2,ST,1) : null);

  // ── LPO 800G: QSFP-DD style module + fiber port cage (rounded per MSA spec) ──
  case 'lpo': return s(
    r(16,5,22,26,SW,3.5),           // module body (MSA corner radius)
    r(17,6,20,24,D,2.5),            // module inner
    r(16,10,22,2,ST||L),            // accent stripe = status (integrated on module top)
    r(17,14,2,5,BK), r(21,14,2,5,BK),  // fiber port holes
    r(1,15,4,7,D,1.5), l(4,18,16,18,L,2));  // cable tail + stub

  // ── NIC 擎天: PCB + ASIC heatsink + cage openings ──
  case 'nic': return s(
    r(3,4,42,28,F,1.5), r(3,4,5,28,METAL,1.5),
    r(4,7,3,8,BK,1), r(4,20,3,8,BK,1),
    r(9,6,36,24,D,1),
    r(3,30,5,2,ST||D));  // front face bottom strip = status

  // ── Port: 4 UB cages + 1 RDMA cage inline + LED strip ──
  case 'port': return s(
    r(4,4,40,28,F,1.5),
    r(5,8,7,10,SW,2),  r(6,9,5,8,ST||D,1.5),   // UB0 = status
    r(13,8,7,10,SW,2), r(14,9,5,8,D,1.5),
    r(21,8,7,10,SW,2), r(22,9,5,8,D,1.5),
    r(29,8,7,10,SW,2), r(30,9,5,8,D,1.5),
    r(37,8,7,10,BK,2), r(38,9,5,8,D,1),   // RDMA cage: darker, same row
    r(5,21,34,2,ST||D,.5),   // LED strip below cages
    l(4,20,44,20,L,.5));

  default: return s(r(8,8,32,20,F,1.5));
  }
};
})();

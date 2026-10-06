// Hardware entity 3D scene builders
// Each builder: (g, C, T, H) => void
// H = { bm, rb, bl, b, s, k, cyl }
//
// 6-level light palette:
//   C.LITE  #F7F8F8 — polished metal (IHS, fin highlights, screw heads)
//   C.AIC   #E9E9E9 — bright compute zone (AIC cube)
//   C.MAIN  #CCCDD0 — primary body (structural shell, blade body)
//   C.DEEP  #C4C4C4 — secondary panels (heatspreaders, front plates, ASIC)
//   C.METAL #6F7072 — dark metal (front panels, switch body, port cages)
//   C.DARK  #3D3D3D — darkest (sockets, port holes, die windows, scalar)

(function(){
'use strict';
window.HWENT = {};
const E = window.HWENT;

// Blend helper: mix base color toward tint at given ratio (0-1) — same technique as 2D icons
// Keeps gray gradient visible underneath (a "wash", not a flat swap) for drill-down highlights
const mix=(base,tint,ratio)=>{
  const br=(base>>16)&0xFF,bg=(base>>8)&0xFF,bb=base&0xFF;
  const tr=(tint>>16)&0xFF,tg=(tint>>8)&0xFF,tb=tint&0xFF;
  const r=Math.round(br*(1-ratio)+tr*ratio), g=Math.round(bg*(1-ratio)+tg*ratio), b=Math.round(bb*(1-ratio)+tb*ratio);
  return (r<<16)|(g<<8)|b;
};
const HI_RATIO = 0.68; // drill-down highlight blend ratio — strong but keeps base tone showing through

E.superpod = (g,C,T,H) => {
  // Atlas 950 / CloudMatrix style: rack row + interspersed switch racks + UB fiber canopy
  const RH=3.8,RW=0.55,RD=0.65,SP=0.78;
  const N=8; // total racks
  const SW_IDX=[2,5]; // switch rack positions

  // Row of 8 racks (6 compute + 2 switch)
  for(let i=0;i<N;i++){
    const rx=(i-(N-1)/2)*SP;
    const isSw=SW_IDX.includes(i);
    const rg=new T.Group(); rg.position.x=rx;

    // Main rack body: METAL for switch, DEEP for compute
    const body=H.rb(RW,RH,RD,0.03,isSw?C.METAL:C.DEEP); body.position.y=RH/2; rg.add(body);
    // Front panel: METAL — back face 0.008 clear of body surface
    const fp=H.bl(RW-0.04,RH-0.06,0.012,C.METAL); fp.position.set(0,RH/2,RD/2+0.014); rg.add(fp);
    // (fmid removed — caused fp-front / fmid-back z-fighting)

    if(isSw){
      // Switch rack: dense port matrix on front
      for(let r=0;r<6;r++){for(let c=0;c<8;c++){
        const dc=r<2&&c<3?C.STATUS:r%2===0?C.DEEP:C.DARK;
        const dot=H.bl(0.026,0.026,0.014,dc);
        dot.position.set(-0.18+c*0.052,0.48+r*0.45,RD/2+0.030); rg.add(dot);
      }}
      // LPO module slots: DARK (open apertures)
      for(let l=0;l<4;l++){const lm=H.rb(0.06,0.045,0.16,0.008,C.DARK);lm.position.set(-0.15+l*0.10,RH-0.16,0);rg.add(lm);}
    } else {
      // U-slot lines: depth INSIDE rack (RD-0.02) to avoid front/back surface z-fight
      for(let u=0;u<9;u++){const sl=H.bl(RW-0.05,0.006,RD-0.02,C.DARK);sl.position.set(0,0.38+u*0.38,0);rg.add(sl);}
      // Blade strips: fp front face at RD/2+0.020, strips at RD/2+0.026 (0.006 clear)
      // Drill-down highlight: blades represent next level down — light up under active status
      const hiBlade = C._ACTIVE ? mix(C.DEEP, C.STATUS, HI_RATIO) : C.DEEP;
      for(let b=0;b<6;b++){const bf=H.bl(RW-0.08,0.10,0.008,hiBlade);bf.position.set(0,0.42+b*0.52,RD/2+0.026);rg.add(bf);}
    }
    // Status LED column: tall visible strip on side
    const led=H.bl(0.032,RH*0.74,0.032,C.STATUS); led.position.set(RW/2+0.020,RH*0.5,RD/4); rg.add(led);
    g.add(rg);
  }

};

E.rack = (g,C,T,H) => {
  const W=0.88,D=0.7,HT=3.6;
  // Frame posts: MAIN
  [[-0.44,-0.35],[-0.44,0.35],[0.44,-0.35],[0.44,0.35]].forEach(([px,pz])=>{
    const p=new T.Mesh(H.b(0.04,HT,0.04),H.s(C.MAIN)); p.position.set(px,HT/2,pz); g.add(p);
  });
  // Top/bottom rails: LITE
  [HT+0.015,-0.015].forEach(y=>{const pl=H.bm(W,0.03,D,C.LITE);pl.position.y=y;g.add(pl);});
  // U-slot rails: METAL (more visible than GLINE)
  for(let u=0;u<9;u++){const r=H.bm(W,0.006,D,C.METAL);r.position.y=0.28+u*0.38;g.add(r);}
  // Blade slots: MAIN body, METAL front plate
  // Drill-down highlight: blade body represents next level down
  const hiBlade = C._ACTIVE ? mix(C.MAIN, C.STATUS, HI_RATIO) : C.MAIN;
  for(let b=0;b<6;b++){
    const bl=H.rb(W-0.1,0.16,D-0.1,0.018,hiBlade); bl.position.y=0.3+b*0.52; g.add(bl);
    const fp=H.bm(W-0.1,0.12,0.016,C.METAL); fp.position.set(0,0.3+b*0.52,D/2-0.008); g.add(fp);
    // Small LED on each blade front: STATUS + BRASS accent dot
    const ld=H.bl(0.14,0.014,0.014,C.STATUS); ld.position.set(-W*0.3,0.3+b*0.52,D/2+0.008); g.add(ld);
    const bDot=H.bl(0.04,0.014,0.014,C.BRASS); bDot.position.set(W*0.3,0.3+b*0.52,D/2+0.008); g.add(bDot);
  }
  // Top switch: METAL
  const sw=H.rb(W-0.06,0.22,D-0.08,0.02,C.METAL); sw.position.y=HT-0.14; g.add(sw);
  // Switch port dots: STATUS first 2, then DEEP
  for(let p=0;p<8;p++){const pm=H.bl(0.045,0.045,0.016,p<2?C.STATUS:C.DEEP);pm.position.set(-0.26+p*0.076,HT-0.14,D/2+0.014);g.add(pm);}
  // Side LED column: STATUS — thicker for visibility from all angles
  const led=H.bl(0.055,HT,0.055,C.STATUS); led.position.set(W/2+0.030,HT/2,D/2-0.04); g.add(led);
  // Caster wheels: METAL
  const cg=H.cyl(0.05,0.05,0.07,8);
  [[-0.35,-0.28],[-0.35,0.28],[0.35,-0.28],[0.35,0.28]].forEach(([cx,cz])=>{
    const c=new T.Mesh(cg,H.s(C.METAL)); c.position.set(cx,0.035,cz); g.add(c);
  });
};

E.blade = (g,C,T,H) => {
  const W=4.5,HT=0.2,D=1.8;
  // Main PCB tray: MAIN
  g.add(H.rb(W,HT,D,0.025,C.MAIN));
  // Front panel: METAL (dark, gives depth)
  const fp=H.rb(W,HT-0.04,0.07,0.015,C.METAL); fp.position.z=D/2+0.04; g.add(fp);
  // Front panel top edge accent: BRASS
  const fpe=H.bl(W-0.1,0.008,0.008,C.BRASS); fpe.position.set(0,HT/2+0.002,D/2+0.075); g.add(fpe);
  // Grab handles: LITE (bright, polished)
  [[-W*0.43],[W*0.43]].forEach(([hx])=>{
    const h=H.rb(0.22,HT*0.6,0.12,0.012,C.LITE); h.position.set(hx,0,D/2+0.1); g.add(h);
  });
  // Status LED strip
  const led=H.bl(W-0.5,0.028,0.02,C.STATUS); led.position.set(0,HT/2+0.015,D/2+0.095); g.add(led);
  // NPU heatspreaders: DEEP (slightly darker than MAIN body)
  // Drill-down highlight: NPU/CPU on blade represent next level down
  const hiChip = C._ACTIVE ? mix(C.DEEP, C.STATUS, HI_RATIO) : C.DEEP;
  const hsH=0.11;
  const hsTopY=HT/2+hsH+0.003;
  const finH=0.08;
  for(let n=0;n<8;n++){
    const hs=H.rb(0.42,hsH,0.5,0.012,hiChip); hs.position.set(-1.75+n*0.5, HT/2+hsH/2+0.003, -0.15); g.add(hs);
    // Fins: LITE (bright aluminum fin tips)
    for(let f=0;f<3;f++){
      const fin=H.bm(0.04,finH,0.5,C.LITE);
      fin.position.set(-1.75+n*0.5-0.06+f*0.06, hsTopY+0.004+finH/2, -0.15); g.add(fin);
    }
  }
  // CPU on blade: METAL body, DEEP fins
  const hiCpuBody = C._ACTIVE ? mix(C.METAL, C.STATUS, HI_RATIO) : C.METAL;
  const cpuH=0.14;
  const cpu=H.rb(0.65,cpuH,0.65,0.018,hiCpuBody); cpu.position.set(0,HT/2+cpuH/2+0.003,D*0.3); g.add(cpu);
  // CPU fins: LITE (same as NPU/NIC fins — unified heatsink language)
  for(let f=0;f<5;f++){
    const fin=H.bm(0.65,cpuH+0.01,0.02,C.LITE); fin.position.set(0,HT/2+cpuH/2+0.005,-D*0.14+f*0.06); g.add(fin);
  }
};

E.npu = (g,C,T,H) => {
  // PCB substrate: DARK
  const pcb=H.bm(2.52,0.04,2.52,C.DARK); pcb.position.y=-0.11; g.add(pcb);
  // BGA ball grid: DEEP
  const bgaG=new T.BoxGeometry(0.085,0.065,0.085);
  const bgaI=new T.InstancedMesh(bgaG,H.s(C.DEEP),144);
  const mx=new T.Matrix4(); let bi=0;
  for(let bx=0;bx<12;bx++){for(let bz=0;bz<12;bz++){
    mx.setPosition(-1.1+bx*0.2,-0.165,-1.1+bz*0.2); bgaI.setMatrixAt(bi++,mx);
  }}
  bgaI.instanceMatrix.needsUpdate=true; g.add(bgaI);
  // IHS bevel frame: LITE (polished metal, large rounded corners)
  const ihsFr=H.rb(2.35,0.32,2.35,0.04,C.LITE); ihsFr.position.y=0.05; g.add(ihsFr);
  // IHS inner surface: MAIN
  const ihsIn=H.bm(2.22,0.06,2.22,C.MAIN); ihsIn.position.y=0.225; g.add(ihsIn);
  // Die window base: DARK
  const dieW=H.bm(1.82,0.012,1.82,C.DARK); dieW.position.y=0.264; g.add(dieW);

  // 3-column silver panel layout — matches 2D icon top-down view
  // Left(25%) | sep(5%) | Center(35%) | sep(5%) | Right(25%)
  const pH=0.036, pY=0.271+0.018+0.001;
  const lw=0.44, cw=0.64;

  // Left column: AIC (#E9E9E9) — lighter than die window but not as stark as center
  const lCol=H.rb(lw,pH,1.33,0.018,C.AIC); lCol.position.set(-0.645,pY,-0.105); g.add(lCol);
  // Center column: LITE (#F7F8F8) — dominant, brightest panel
  // Drill-down highlight: center column = die window area, next level down
  const hiCenter = C._ACTIVE ? mix(C.LITE, C.STATUS, HI_RATIO) : C.LITE;
  const cCol=H.rb(cw,pH,1.54,0.020,hiCenter); cCol.position.set(0,pY,0); g.add(cCol);
  // Right column: AIC (mirror of left)
  const rCol=H.rb(lw,pH,1.33,0.018,C.AIC); rCol.position.set(0.645,pY,-0.105); g.add(rCol);

  // Dark vertical separators between columns
  [-0.37,+0.37].forEach(sx=>{
    const sep=H.bm(0.09,pH+0.008,1.82,C.DARK); sep.position.set(sx,pY,0); g.add(sep);
  });

  // Connector dot row: BRASS (substrate edge contact pads — gold-plated in real hardware)
  for(let d=0;d<7;d++){const dot=H.bl(0.04,0.015,0.04,C.BRASS);dot.position.set(0.28+d*0.09,0.271,0.88);g.add(dot);}

  // Gold connector pads + finger connectors: REMOVED (too noisy at scale)
  // (pins removed per design feedback)
  // Status LED strip
  const led=H.bl(2.32,0.04,0.04,C.STATUS); led.position.set(0,0.23,1.19); g.add(led);
};

E.die = (g,C,T,H) => {
  // Substrate: DARK (thin)
  const sub=H.bm(0.58,0.04,0.46,C.DARK); sub.position.y=-0.025; g.add(sub);
  [{dx:-0.14,di:0},{dx:0.14,di:1}].forEach(({dx,di})=>{
  // Die block: MAIN (#CCCDD0) — softer against DARK substrate, METAL grid contrast 93pts not 122
    const dm=H.rb(0.24,0.05,0.38,0.012,C.MAIN); dm.position.set(dx,0.025,0); g.add(dm);
    // Die floorplan: 3×4 discrete functional unit blocks, clearly separated
    const bW=0.058,bD=0.058,bH=0.010,bGap=0.014;
    const bCols=3,bRows=4;
    const totalW=bCols*bW+(bCols-1)*bGap;
    const totalD=bRows*bD+(bRows-1)*bGap;
    const startX=dx-totalW/2+bW/2;
    const startZ=-totalD/2+bD/2;
    const blockY=0.050+0.003+bH/2; // die top(0.05) + gap(0.003) + half height
    // Die floorplan blocks: 4-level color zoning, ALL become STATUS when active (drill-down highlight)
    const blockPalette=[
      [C.LITE, C.AIC,  C.DEEP, C.MAIN],   // col 0: compute heavy
      [C.AIC,  C.LITE, C.LITE, C.DEEP],   // col 1: cache + IO
      [C.MAIN, C.DEEP, C.AIC,  C.LITE],   // col 2: control + PHY
    ];
    for(let col=0;col<bCols;col++){for(let row=0;row<bRows;row++){
      const bx=startX+col*(bW+bGap);
      const bz=startZ+row*(bD+bGap);
      const bc=C._ACTIVE ? mix(blockPalette[col][row], C.STATUS, HI_RATIO) : blockPalette[col][row];
      const blk=H.rb(bW,bH,bD,0.004,bc);
      blk.position.set(bx,blockY,bz); g.add(blk);
    }}
    // HBM on die side — 2-tier mini HBM Stack (same visual language)
    const hx=di===0?dx-0.22:dx+0.22;
    const tW0=0.09, tW1=0.102, tH=0.045, gapY=0.058;
    [tW0,tW1].forEach((tw,tier)=>{
      const hm=H.rb(tw,tH,0.36,0.008,C.HBM);
      hm.position.set(hx, 0.018+tier*gapY, 0); g.add(hm);
    });
    // Divider: METAL
    const div=H.bl(tW0-0.006,0.003,0.356,C.METAL);
    div.position.set(hx, 0.018+tH/2+gapY/2-tH/2, 0); g.add(div);
    // HBM bump connectors: BRASS
    for(let b=0;b<4;b++){const bp=H.bl(0.004,0.004,0.004,C.BRASS);bp.position.set(di===0?hx+0.05:hx-0.05,0.012+b*0.022,b*0.08-0.12);g.add(bp);}
  });
  // D2D bridge: COPPER
  const cylG=new T.CylinderGeometry(0.018,0.018,0.12,8);
  const d2d=new T.Mesh(cylG,H.s(C.COPPER)); d2d.rotation.z=Math.PI/2; d2d.position.set(0,0.04,0); g.add(d2d);
};

E.hbm = (g,C,T,H) => {
  const tH=0.065, gap=0.075;
  const widths=[0.14,0.15,0.17,0.19];
  // Base: DARK, placed below first tier
  const baseH=0.025;
  const baseTopY=-tH/2-0.008;
  const base=H.bm(0.22,baseH,0.20,C.DARK);
  base.position.y=baseTopY-baseH/2; g.add(base);
  widths.forEach((w,i)=>{
    const cy=i*gap;
    // Alternate MAIN/DEEP for adjacent tiers — ALL become STATUS when active (drill-down highlight)
    const tierBase = i%2===0 ? C.MAIN : C.DEEP;
    const tierCol = C._ACTIVE ? mix(tierBase, C.STATUS, HI_RATIO) : tierBase;
    const hm=H.rb(w,tH,0.18,0.008,tierCol); hm.position.y=cy; g.add(hm);
    if(i<widths.length-1){
      const midGap=(cy+tH/2+(i+1)*gap-tH/2)/2;
      const div=H.bl(w-0.008,0.003,0.185,C.BRASS); div.position.y=midGap; g.add(div);
    }
    // Bump connectors: LITE
    for(let b=0;b<4;b++){
      const bp=H.bl(0.004,0.004,0.004,C.LITE);
      bp.position.set(-w/2-0.012,cy-0.01+b*0.018,-0.05+b*0.034); g.add(bp);
    }
  });
  const stripe=H.bl(0.192,0.004,0.004,C.METAL); stripe.position.set(0,0.30,0.09); g.add(stripe);
};

E.aicore = (g,C,T,H) => {
  const W=2.5,HT=0.58,D=3.8;
  // Outer shell: METAL (dark, creates strong contrast with lighter functional zones above)
  g.add(H.rb(W,HT,D,0.04,C.METAL));
  // AIC Cube zone: MAIN (#CCCDD0) — softer base reduces METAL grid contrast from 122→93 pts
  const aicW=W*0.58,aicD=D*0.82;
  const aic=H.rb(aicW,HT+0.05,aicD,0.035,C.MAIN); aic.position.set(-W*0.18,0,0.1); g.add(aic);
  // AIC Cube array: 5×4, ALL become STATUS when active (drill-down highlight into cube array)
  const cubeW=(aicW-0.06)/5, cubeD=(aicD-0.06)/4, cubeH=0.038, cubeGap=0.012;
  const cubeRowCols=[C.LITE, C.AIC, C.MAIN, C.DEEP]; // front=brightest, back=deepest
  for(let col=0;col<5;col++){for(let row=0;row<4;row++){
    const cx=-W*0.18 - aicW/2 + 0.03 + col*(cubeW+cubeGap) + cubeW/2;
    const cz= 0.1    - aicD/2 + 0.03 + row*(cubeD+cubeGap) + cubeD/2;
    const cc=C._ACTIVE ? mix(cubeRowCols[row], C.STATUS, HI_RATIO) : cubeRowCols[row];
    const cb=H.rb(cubeW,cubeH,cubeD,0.006,cc);
    cb.position.set(cx, HT/2+0.025+cubeH/2, cz); g.add(cb);
  }}
  // AIC top edge accent: LITE strip
  const aicEdge=H.bl(aicW,0.006,0.006,C.LITE); aicEdge.position.set(-W*0.18,HT/2+0.056,aicD/2+0.003); g.add(aicEdge);
  // BRASS accent at AIC/AIV boundary
  const boundary=H.bl(0.012,HT+0.06,D*0.82+0.01,C.BRASS);
  boundary.position.set(W*0.33-W*0.11-0.008, 0, 0.1); g.add(boundary);
  // AIV Vector zone: DEEP (distinct from AIC=MAIN, gives 5-level: DARK/METAL/DEEP/MAIN/LITE)
  const aiv=H.rb(W*0.22,HT+0.03,D*0.82,0.025,C.DEEP); aiv.position.set(W*0.33,0,0.1); g.add(aiv);
  // AIV stripe dividers: METAL
  for(let s=0;s<4;s++){const st=H.bl(W*0.22,0.022,0.022,C.METAL);st.position.set(W*0.33,HT/2+0.03,-D*0.4+s*D*0.27);g.add(st);}
  // Scalar unit: DARK (darkest accent, clearly distinct)
  const sc=H.rb(W*0.1,HT-0.06,D*0.22,0.015,C.DARK); sc.position.set(W*0.44,0,-D*0.35); g.add(sc);
  // Status LED strip
  const led=H.bl(W,0.038,0.038,C.STATUS); led.position.set(0,HT/2+0.019,D/2+0.019); g.add(led);
};

E.tile = (g,C,T,H) => {
  const W=0.1,HT=0.008,D=0.14;
  // Body: MAIN
  g.add(H.rb(W,HT,D,0.008,C.MAIN));
  // Cells: ALL become STATUS when active (drill-down highlight) / structural pattern in default
  for(let cr=0;cr<2;cr++){for(let cc=0;cc<4;cc++){
    const lit=(cr===0&&cc===1);
    const idle=(cc===0||cc===3); // corner cells slightly darker
    const cellBase = lit?C.STATUS:idle?C.METAL:C.DEEP;
    const cellCol = C._ACTIVE ? mix(cellBase, C.STATUS, HI_RATIO) : cellBase;
    const cell=H.bl(W*0.42,HT*0.55,D*0.22,cellCol);
    cell.position.set(-W*0.24+cr*W*0.48,HT*1.15,-D*0.38+cc*D*0.25); g.add(cell);
  }}
  const glow=H.bl(W*0.42,HT*0.4,D*0.22,C.STATUS); glow.position.set(-W*0.24,HT*0.9,0.04); g.add(glow);
  for(let gx=0;gx<3;gx++){const r=H.bl(W,0.002,0.002,C.METAL);r.position.set(0,HT/2+0.004,-D*0.42+gx*D*0.28);g.add(r);}
};

E.ub_switch = (g,C,T,H) => {
  const W=7,HT=0.24,D=0.92;
  // Switch body: METAL
  g.add(H.rb(W,HT,D,0.04,C.METAL));
  // LPO bar: DEEP (slight contrast with METAL body)
  const lpoH=0.045;
  const lpo=H.bm(W*0.92,lpoH,D*0.38,C.DEEP); lpo.position.y=HT/2+lpoH/2+0.003; g.add(lpo);
  // Port dots: STATUS(first 3) / DEEP(rest)
  for(let p=0;p<20;p++){const pm=H.bl(0.11,0.11,0.018,p<3?C.STATUS:C.DEEP);pm.position.set(-3.2+p*0.335,0,D/2+0.016);g.add(pm);}
  // LPO fiber module bodies: DARK (deep port openings)
  const lmH=0.07;
  const hiLpo = C._ACTIVE ? mix(C.DARK, C.STATUS, HI_RATIO) : C.DARK;
  for(let l=0;l<6;l++){
    const lm=H.rb(0.12,lmH,0.26,0.012,hiLpo); lm.position.set(-2.5+l*0.98,HT/2+lmH/2+0.003,0); g.add(lm);
    // Fiber tails: DEEP
    const ft=H.bl(0.012,0.012,0.2,C.DEEP); ft.position.set(-2.5+l*0.98,HT/2+lmH+0.006,-0.22); g.add(ft);
  }
};

E.cpu = (g,C,T,H) => {
  const IW=1.88, IH=0.07, ID=1.88;
  const FW=IW+0.68, FH=0.16, FD=ID+0.68;
  // PCB substrate: DARK
  const subH=0.06;
  const sub=H.bm(FW+0.36,subH,FD+0.36,C.DARK);
  sub.position.y=-(FH/2+subH/2+0.003); g.add(sub);
  // Retention bracket: METAL
  const frame=H.rb(FW,FH,FD,0.055,C.METAL);
  frame.position.y=0; g.add(frame);
  // Bracket inner recess: DEEP (slight contrast with METAL)
  const trim=H.bm(FW-0.04,0.008,FD-0.04,C.DEEP);
  trim.position.y=FH/2+0.003; g.add(trim);
  // IHS plate: LITE (polished)
  const ihsY=FH/2+IH/2+0.005;
  const ihs=H.rb(IW,IH,ID,0.022,C.LITE);
  ihs.position.y=ihsY; g.add(ihs);
  // IHS inner recessed panel: MAIN
  // Drill-down highlight: inner panel = die area, next level down
  const hiInner = C._ACTIVE ? mix(C.MAIN, C.STATUS, HI_RATIO) : C.MAIN;
  const inW=IW*0.80, inH=IH*0.45, inD=ID*0.80;
  const inner=H.bm(inW,inH,inD,hiInner);
  inner.position.y=ihsY+IH/2-inH/2+0.001; g.add(inner);
  // Edge highlight strip: LITE
  const eh=H.bl(IW-0.02,0.003,ID-0.02,C.LITE);
  eh.position.y=ihsY+IH/2+0.002; g.add(eh);
  // Corner screws: COPPER post, BRASS head
  const sx=FW/2-0.16, sz=FD/2-0.16, sY=FH/2+0.003;
  [[sx,sz],[sx,-sz],[-sx,sz],[-sx,-sz]].forEach(([cx,cz])=>{
    const post=new T.Mesh(H.cyl(0.052,0.052,0.038,10),H.s(C.COPPER));
    post.position.set(cx,sY+0.019,cz); g.add(post);
    const head=new T.Mesh(H.cyl(0.066,0.066,0.013,10),H.s(C.BRASS));
    head.position.set(cx,sY+0.038+0.007,cz); g.add(head);
  });
};

E.lpo = (g,C,T,H) => {
  // Module body: METAL — drill-down highlight target
  const hiBody = C._ACTIVE ? mix(C.METAL, C.STATUS, HI_RATIO) : C.METAL;
  g.add(H.rb(0.16,0.09,0.4,0.015,hiBody));
  // Cage end: DEEP
  const cage=H.rb(0.16,0.1,0.065,0.01,C.DEEP); cage.position.z=0.24; g.add(cage);
  // Port apertures: DARK
  for(let p=0;p<2;p++){const hole=H.bl(0.042,0.044,0.02,C.DARK);hole.position.set(-0.038+p*0.076,0,0.278);g.add(hole);}
  // Label stripe: BRASS (warm accent)
  const lbl=H.bl(0.1,0.012,0.19,C.BRASS); lbl.position.set(0,0.048,-0.03); g.add(lbl);
  // Fiber tail: DEEP
  const ft=H.rb(0.016,0.016,0.24,0.005,C.DEEP); ft.position.z=-0.32; g.add(ft);
  // Fiber end face: METAL
  const cylG=new T.CylinderGeometry(0.013,0.013,0.065,8);
  const fe=new T.Mesh(cylG,H.s(C.METAL)); fe.rotation.x=Math.PI/2; fe.position.z=-0.44; g.add(fe);
};

E.nic = (g,C,T,H) => {
  // PCB: DARK (same substrate language as NPU/CPU)
  g.add(H.rb(1.85,0.1,1.12,0.02,C.DARK));
  // ASIC block: METAL (dark heat spreader) — drill-down highlight target
  const hiAsic = C._ACTIVE ? mix(C.METAL, C.STATUS, HI_RATIO) : C.METAL;
  const asic=H.rb(0.62,0.13,0.62,0.018,hiAsic); asic.position.set(-0.2,0.120,0); g.add(asic);
  // ASIC fins: lower profile, tighter pitch — realistic NIC heatsink
  const finH=0.055;
  const finY=0.185+finH/2+0.004;
  for(let f=0;f<5;f++){const fin=H.bm(0.58,finH,0.022,C.LITE);fin.position.set(-0.2,finY,-0.20+f*0.10);g.add(fin);}
  // Network ports: METAL cages, DARK holes
  for(let p=0;p<2;p++){
    const port=H.rb(0.19,0.21,0.065,0.015,C.METAL); port.position.set(-0.34+p*0.68,0.160,-0.58); g.add(port);
    const hole=H.bl(0.14,0.13,0.02,C.DARK); hole.position.set(-0.34+p*0.68,0.160,-0.62); g.add(hole);
  }
  // PCIe slot: DEEP
  const pci=H.rb(1.65,0.065,0.19,0.01,C.DEEP); pci.position.set(0,-0.075,0.6); g.add(pci);
  // Gold contacts
  for(let c=0;c<10;c++){const ct=H.bm(0.062,0.04,0.16,C.GOLD);ct.position.set(-1.0+c*0.22,-0.075,0.6);g.add(ct);}
};

E.port = (g,C,T,H) => {
  const BW=0.82,BH=0.14,BD=0.36;
  g.add(H.rb(BW,BH,BD,0.02,C.MAIN));

  // Panel face: DEEP — back face at body front + 0.004 gap
  const bodyFrontZ = BD/2;                           // 0.180
  const panelD = 0.018;
  const panelZ = bodyFrontZ + 0.004 + panelD/2;     // 0.193
  const panelFrontZ = panelZ + panelD/2;             // 0.202
  const panel=H.rb(BW, BH-0.012, panelD, 0.010, C.DEEP);
  panel.position.z = panelZ; g.add(panel);

  // UB port cages: w=0.10, spacing=0.135 — drill-down highlight target
  const hiCage = C._ACTIVE ? mix(C.METAL, C.STATUS, HI_RATIO) : C.METAL;
  const cageD=0.048, cageW=0.10, cageH=0.11;
  const cageCZ = panelFrontZ + 0.006 + cageD/2;   // 0.232
  const cageFZ = cageCZ + cageD/2;                 // 0.256
  const ubXs = [-0.27,-0.135,0.00,0.135];
  ubXs.forEach((cx,p)=>{
    const ub=H.rb(cageW,cageH,cageD,0.009,hiCage);
    ub.position.set(cx,0,cageCZ); g.add(ub);
    const uh=H.bl(0.048,0.012,0.009, p===0?C.STATUS:C.DARK);
    uh.position.set(cx,0.034,cageFZ+0.007); g.add(uh);
  });

  // RDMA cage: x=0.32, w=0.10 → left edge=0.27, gap from UB[3]=0.085
  const rdma=H.rb(0.10,0.12,cageD,0.009,C.DARK);
  rdma.position.set(0.32, -0.005, cageCZ); g.add(rdma);
  const rh=H.bl(0.058,0.012,0.009,C.STATUS);
  rh.position.set(0.32, 0.034, cageFZ+0.007); g.add(rh);

  // Panel LED strips: y=0.050 (below body top 0.070), z clear of panel front
  const ul=H.bl(0.40,0.007,0.007,C.STATUS);
  ul.position.set(-0.10, 0.050, panelFrontZ+0.008); g.add(ul);
  const rl=H.bl(0.10,0.007,0.007,C.STATUS);
  rl.position.set(0.32, 0.050, panelFrontZ+0.008); g.add(rl);
};

})();

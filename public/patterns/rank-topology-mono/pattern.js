/* rank-topology-mono · 模型分片与训练设备映射（黑白极简版）
   ─────────────────────────────────────────────────────────────────────
   与 /patterns/rank-topology-3d/ 同一题面（五刀切完之后，这一份落到哪张卡上），
   但换一种画法：2.5D 斜向平行投影的层叠平面，每个平面是一份**不同的模型分片**
   ——分片由 (pp, tp, ep) 决定，DP / CP 只是把同一份复制多遍，所以复制份数写在
   标注里（×N 副本），不再逐卡铺一只壳。每个平面里是一张「层 × 算子块」的宫格，
   灰度 = 该层该块在本卡上的字节（log 尺度，全图统一）。
   数值口径逐条照搬 demo.html（opBytes / paramsPerCard / memParts / commLoad9），
   坐标算术同源（order = tp‑cp‑dp‑pp，EP 折进 tp·cp·dp 平面）。

   URL 即状态：?preset=pangu&mode=comm&sel=23&group=tp&zero=1&embed=1
   不认识的参数一律忽略，非法值退回默认，任何情况下不报错。
   宿主可 postMessage({type:'pto:state', sel, mode, group, zero}) 推状态；
   本页每次状态变化也会向 parent 回报同一形状的消息。 */
(function(){
'use strict';
var NS='http://www.w3.org/2000/svg', GiB=Math.pow(2,30), MiB=Math.pow(2,20);

/* ── 预置：并行维与模型尺寸（与 demo.html 同名同值；pangu 的模型尺寸按 Pangu Pro MoE 72B-A16B 公开口径：
   48 层 · hidden 5120 · 64 路由专家 · 专家 ffn 1344（按 72B 总量反推，未计 4 个共享专家）· vocab 153376） */
var PRESETS={
  default128:{name:'默认',cfg:{world:128,tp:2,cp:1,pp:4,ep:8,etp:1,layers:48,hidden:4096,heads:32,kv:8,ffn:2048,vocab:128256,seq:8192,experts:64,topk:8,mbs:1,ga:8,hbm:64}},
  dense64:{name:'稠密',cfg:{world:64,tp:4,cp:1,pp:4,ep:1,etp:1,layers:32,hidden:4096,heads:32,kv:8,ffn:14336,vocab:128256,seq:8192,experts:0,topk:0,mbs:1,ga:8,hbm:64}},
  longcp:{name:'长序列 CP',cfg:{world:64,tp:4,cp:4,pp:2,ep:8,etp:1,layers:32,hidden:4096,heads:32,kv:8,ffn:2048,vocab:128256,seq:131072,experts:64,topk:8,mbs:1,ga:16,hbm:64}},
  moe64:{name:'MoE 折叠',cfg:{world:64,tp:2,cp:1,pp:4,ep:8,etp:1,layers:32,hidden:4096,heads:32,kv:8,ffn:2048,vocab:128256,seq:8192,experts:64,topk:2,mbs:1,ga:8,hbm:64}},
  pangu:{name:'盘古 Pro MoE',cfg:{world:4000,tp:8,cp:1,pp:5,ep:2,etp:1,layers:48,hidden:5120,heads:40,kv:8,ffn:1344,vocab:153376,seq:4096,experts:64,topk:8,mbs:1,ga:20,hbm:64}}
};
var MKEY={weight:'w',comm:'comm',hbm:'hbm'};
var MODES={
  weight:{name:'权重',code:'W',unit:'GB',bar:'本卡权重 bf16',legend:'格 = 该层该块在本卡上的权重字节 · log 尺度 · 空格 = 不在本卡'},
  comm:{name:'通信',code:'∑/步',unit:'GB/步',bar:'本卡每步跨卡字节',legend:'格 = 每步跨卡字节 · DP 覆盖全部块 · TP 在 attn.out · PP 在段边界'},
  hbm:{name:'显存',code:'HBM',unit:'GB',bar:'HBM 合计',legend:'格 = 模型态 W+∇W+O · 柱 = HBM 合计 · 横线 = 容量'}
};
var GROUPS={none:'无',tp:'TP',dp:'DP',ep:'EP',pp:'PP'};

function el(tag,attrs,text){var n=document.createElementNS(NS,tag);if(attrs)for(var k in attrs)n.setAttribute(k,attrs[k]);if(text!==undefined)n.textContent=text;return n}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function fmtGB(b){return (b/GiB).toFixed(b>=GiB*10?0:1)}
function fmtB(b){if(!b)return '0';if(b>=GiB)return fmtGB(b)+' GB';if(b>=MiB)return (b/MiB).toFixed(b>=MiB*10?0:1)+' MB';return Math.round(b/1024)+' KB'}
function fmtP(n){return n>=1e9?(n/1e9).toFixed(1)+' B':n>=1e6?(n/1e6).toFixed(0)+' M':String(n)}
function loadSeed(k,salt){var r=Math.sin((k+1)*45.233+(salt+1)*97.117)*28657.13;return r-Math.floor(r)}
function shade(v){var n=Math.round(25+v*157);return 'rgb('+n+','+n+','+n+')'}
function edgeShade(v){var n=Math.round(55+Math.pow(clamp(v,0,1),1.65)*180);return 'rgb('+n+','+n+','+n+')'}

/* ── 状态 ── */
var q=new URLSearchParams(location.search);
var state={preset:PRESETS[q.get('preset')]?q.get('preset'):'default128',mode:'weight',sel:null,group:'none',zero:0,embed:q.get('embed')==='1'};
(function(){var m=(q.get('mode')||'').toLowerCase();var map={weight:'weight',w:'weight',comm:'comm',c:'comm',hbm:'hbm',h:'hbm',mem:'hbm'};if(map[m])state.mode=map[m];
  var g=(q.get('group')||'').toLowerCase();if(GROUPS[g])state.group=g;
  var z=parseInt(q.get('zero'),10);if(z>=0&&z<=3)state.zero=z;
  var s=parseInt(q.get('sel'),10);if(isFinite(s)&&s>=0)state.sel=s;})();
var overrides={};['world','tp','cp','pp','dp','ep','etp','layers','ga','mbs'].forEach(function(k){var v=parseInt(q.get(k),10);if(isFinite(v)&&v>0)overrides[k]=v});
if(state.embed)document.body.classList.add('embed');

/* ── 配置推导（demo.html 的 derive 的最小子集：非法值退回最近合法值，不报错） ── */
function derive(){
  var c=PRESETS[state.preset].cfg,D={},k;for(k in c)D[k]=c[k];for(k in overrides)D[k]=overrides[k];
  D.moe=D.experts>0;if(!D.moe){D.ep=1;D.etp=1}
  D.tp=Math.max(1,D.tp|0);D.cp=Math.max(1,D.cp|0);D.pp=Math.max(1,D.pp|0);D.ep=Math.max(1,D.ep|0);D.etp=Math.max(1,D.etp|0);
  var denom=D.tp*D.cp*D.pp;
  if(overrides.dp&&!overrides.world)D.world=D.tp*D.cp*D.pp*overrides.dp;
  D.dp=Math.max(1,Math.round(D.world/denom));D.world=D.dp*denom;
  if(D.moe&&D.experts%D.ep){var e=D.ep;while(e>1&&D.experts%e)e--;D.ep=e}
  if(D.moe&&(D.tp*D.cp*D.dp)%(D.ep*D.etp)){D.ep=1;D.etp=1}
  D.lps=Math.ceil(D.layers/D.pp);
  D.headDim=Math.floor(D.hidden/D.heads)||1;
  D.kvPerTp=Math.ceil(D.kv/D.tp);
  D.actB=D.mbs*(D.seq/D.cp)*D.hidden*2;
  D.buckets=D.moe?Math.min(8,D.experts):0;
  D.zero=state.zero;
  D.zW=D.zero>=3?D.dp:1;D.zG=D.zero>=2?D.dp:1;D.zO=D.zero>=1?D.dp:1;
  return D;
}
function coordsOf(g,D){return {t:g%D.tp,c:Math.floor(g/D.tp)%D.cp,d:Math.floor(g/(D.tp*D.cp))%D.dp,p:Math.floor(g/(D.tp*D.cp*D.dp))%D.pp}}
function rankOf(t,c,d,p,D){return ((p*D.dp+d)*D.cp+c)*D.tp+t}
function epOf(t,c,d,D){if(!D.moe)return {ep:0,etp:0,mdp:0,q:0};var qq=(d*D.cp+c)*D.tp+t;return {etp:qq%D.etp,ep:Math.floor(qq/D.etp)%D.ep,mdp:Math.floor(qq/(D.etp*D.ep)),q:qq}}
function stageRange(p,D){var a=p*D.lps,b=Math.min(D.layers,(p+1)*D.lps);if(b<=a){a=Math.max(0,D.layers-1);b=D.layers}return {a:a,b:b}}

/* ── 分片枚举：planes = 不同的 (pp, tp, ep, etp)；同一分片的所有 rank 记在 ranks 里 ── */
function buildShards(D){
  var map={},list=[],g;
  for(g=0;g<D.world;g++){
    var co=coordsOf(g,D),me=epOf(co.t,co.c,co.d,D),key=co.p+'/'+co.t+'/'+me.ep+'/'+me.etp,s=map[key];
    if(!s){s={i:list.length,p:co.p,t:co.t,ep:me.ep,etp:me.etp,ranks:[],rep:g};map[key]=s;list.push(s)}
    s.ranks.push(g);
  }
  return list;
}
function shardOfRank(g,D,shards){var co=coordsOf(g,D),me=epOf(co.t,co.c,co.d,D);for(var i=0;i<shards.length;i++){var s=shards[i];if(s.p===co.p&&s.t===co.t&&s.ep===me.ep&&s.etp===me.etp)return s}return null}
function groupRanks(g,dim,D){
  var co=coordsOf(g,D),out=[],i;
  if(dim==='tp'){for(i=0;i<D.tp;i++)out.push(rankOf(i,co.c,co.d,co.p,D))}
  else if(dim==='dp'){for(i=0;i<D.dp;i++)out.push(rankOf(co.t,co.c,i,co.p,D))}
  else if(dim==='pp'){for(i=0;i<D.pp;i++)out.push(rankOf(co.t,co.c,co.d,i,D))}
  else if(dim==='ep'&&D.moe){var me=epOf(co.t,co.c,co.d,D);for(i=0;i<D.ep;i++){var qq=(me.mdp*D.ep+i)*D.etp+me.etp;out.push(rankOf(qq%D.tp,Math.floor(qq/D.tp)%D.cp,Math.floor(qq/(D.tp*D.cp))%D.dp,co.p,D))}}
  return out;
}

/* ── 列（算子块）── */
function buildColumns(D){
  var cols=[{id:'embed',name:'embed / lm_head',grp:0},{id:'attn.q',name:'attn.q',grp:1},{id:'attn.kv',name:'attn.kv',grp:1},{id:'attn.out',name:'attn.out',grp:1},{id:'norm',name:'norm×2',grp:2}];
  if(D.moe){cols.push({id:'router',name:'router',grp:2});for(var i=0;i<D.buckets;i++)cols.push({id:'e'+i,name:'专家桶 '+i,grp:3,bucket:i})}
  else cols.push({id:'mlp.up',name:'mlp.gate/up',grp:3},{id:'mlp.down',name:'mlp.down',grp:3});
  return cols;
}

/* ── 每个分片的宫格：三种口径一起算好（w / comm / hbm），画的时候只换尺度 ── */
function cellsFor(s,D,cols){
  var r=stageRange(s.p,D),rows=r.b-r.a,vPer=Math.ceil(D.vocab/D.tp),vOwn=Math.max(0,Math.min(vPer,D.vocab-s.t*vPer)),hd=D.headDim,out=[],li,ci;
  var perBucket=D.moe?D.experts/D.buckets:0,expOwn=D.moe?D.experts/D.ep:0,e0=s.ep*expOwn,e1=e0+expOwn;
  var zf=1/D.zW+1/D.zG+6/D.zO;
  for(li=0;li<rows;li++){var l=r.a+li;
    for(ci=0;ci<cols.length;ci++){var c=cols[ci],w=0,comm=0,cut='',ep=false,why='';
      switch(c.id){
        case 'embed':if(s.p===0&&li===0){w+=2*vOwn*D.hidden;why='embed 词表列切 ×'+D.tp}if(s.p===D.pp-1&&li===rows-1){w+=2*D.hidden*vOwn;why+=(why?' + ':'')+'lm_head 词表列切 ×'+D.tp}cut=why;break;
        case 'attn.q':w=2*D.hidden*(D.heads/D.tp)*hd;cut='列切 ×'+D.tp;if(s.p>0&&li===0){comm+=D.actB*D.ga;cut+=' · PP 段边界收激活 '+fmtB(D.actB)+' /μb'}break;
        case 'attn.kv':w=2*D.hidden*2*D.kvPerTp*hd;cut='头切 ×'+D.tp+(D.kv%D.tp?'（复制）':'');break;
        case 'attn.out':w=2*(D.heads/D.tp)*hd*D.hidden;cut='行切 ×'+D.tp;if(D.tp>1){comm+=D.actB*2*D.ga;cut+=' · TP AllReduce '+fmtB(D.actB)+' ×2/层'}break;
        case 'norm':w=2*2*D.hidden;cut='复制';if(s.p<D.pp-1&&li===rows-1){comm+=D.actB*D.ga;cut+=' · PP 段边界发激活 '+fmtB(D.actB)+' /μb'}break;
        case 'router':w=2*D.hidden*D.experts;cut='复制';break;
        case 'mlp.up':w=2*2*D.hidden*(D.ffn/D.tp);cut='列切 ×'+D.tp;break;
        case 'mlp.down':w=2*(D.ffn/D.tp)*D.hidden;cut='行切 ×'+D.tp;if(D.tp>1){comm+=D.actB*2*D.ga;cut+=' · TP AllReduce '+fmtB(D.actB)+' ×2/层'}break;
        default:var b0=c.bucket*perBucket,b1=b0+perBucket,own=Math.max(0,Math.min(e1,b1)-Math.max(e0,b0));w=2*own*3*D.hidden*(D.ffn/D.etp);cut=own>0?('桶切 ×'+D.ep+'·ETP'+D.etp+' · 本卡 '+own+' 个专家 · EP All-to-All ×2/MoE 层（各边不等，不给数）'):'不在本卡';ep=own>0;break;
      }
      var held=w>0;
      if(held)comm+=w;                       /* DP：本卡梯度 bf16 = 权重字节，步末一次 */
      out.push({w:w,comm:held?comm:0,hbm:held?w*zf:0,held:held,ep:ep,tip:'L'+l+' · '+c.name+' · '+(held?fmtB(w)+' · '+cut:'不在本卡')});
    }
  }
  return {rows:rows,a:r.a,b:r.b,cells:out};
}
function shardLoad(s,D){
  var co=coordsOf(s.rep,D),key=(((co.t*7+co.c)*13+co.d)*17+co.p)+s.ep*211;
  var actK=(D.moe?0.74+loadSeed(s.ep,3)*0.62:0.92+loadSeed(key,5)*0.17)*(0.95+loadSeed(key,11)*0.10);
  var inflight=Math.max(1,Math.min(D.pp,D.ga)-s.p);
  return {actK:actK,inflight:inflight,rsv:(1.1+loadSeed(key,29)*1.6)*GiB};
}

/* ── 构建 ── */
var D,shards,cols,data,maxCell={},maxBar={},scale={},colGrp=[],geom;
function build(){
  D=derive();shards=buildShards(D);cols=buildColumns(D);
  colGrp=cols.map(function(c,i){var g=0;for(var j=1;j<=i;j++)if(cols[j].grp!==cols[j-1].grp)g++;return g});
  maxCell={weight:0,comm:0,hbm:0};maxBar={weight:0,comm:0,hbm:0};
  data=shards.map(function(s){
    var m=cellsFor(s,D,cols),L=shardLoad(s,D),w=0,comm=0,hbm=0,P=0;
    m.cells.forEach(function(c){w+=c.w;comm+=c.comm;hbm+=c.hbm;maxCell.weight=Math.max(maxCell.weight,c.w);maxCell.comm=Math.max(maxCell.comm,c.comm);maxCell.hbm=Math.max(maxCell.hbm,c.hbm)});
    P=w/2;
    var act=D.mbs*(D.seq/D.cp)*D.hidden*m.rows*4*L.inflight*L.actK;
    var agWin=(D.zero>=3&&m.rows>0)?2*(2*P/m.rows):0;
    var tot=hbm+act+L.rsv+agWin;
    var o={shard:s,m:m,w:w,comm:comm,hbmModel:hbm,act:act,rsv:L.rsv,agWin:agWin,hbm:tot,inflight:L.inflight,params:P};
    o.bar={weight:w,comm:comm,hbm:tot};
    maxBar.weight=Math.max(maxBar.weight,w);maxBar.comm=Math.max(maxBar.comm,comm);maxBar.hbm=Math.max(maxBar.hbm,tot);
    return o;
  });
  scale={weight:maxBar.weight||1,comm:maxBar.comm||1,hbm:Math.max(maxBar.hbm,D.hbm*GiB)||1};
  if(state.sel===null||state.sel>=D.world)state.sel=Math.min(D.world-1,Math.floor(D.tp*D.cp*D.dp/2)+1);
}

/* ── 平面几何：固定斜向平行投影，各层同向等距；选中的沿层序向上抽出 ── */
var PX=.72,PY=.46*.72,CELL=13,PITCH=16,GG=5,MX=22,MT=44,MB=20;
function planeGeom(){
  var ncg=colGrp[colGrp.length-1],rows=Math.max.apply(null,data.map(function(o){return o.m.rows})),rg=rows>4?Math.floor((rows-1)/4):0;
  var W=MX*2+cols.length*PITCH-(PITCH-CELL)+ncg*GG,H=MT+rows*PITCH-(PITCH-CELL)+rg*GG+MB;
  var N=shards.length,dx=clamp(900/N,6.5,18),dy=dx*.33,xs=[],ys=[],x=0,i;
  for(i=0;i<N;i++){if(i>0)x+=dx+(shards[i].p!==shards[i-1].p?2*dx:0);xs.push(x);ys.push(-x*(dy/dx))}
  var raise=Math.round(H*.55);
  var minX=-215,maxX=xs[N-1]+W*PX+130,minY=ys[N-1]-raise-24,maxY=ys[0]+H+W*PY+24;
  return {W:W,H:H,xs:xs,ys:ys,raise:raise,rows:rows,vb:[minX,minY,maxX-minX,maxY-minY],dx:dx};
}

/* ── DOM ── */
var scene=document.getElementById('scene'),planes=document.getElementById('planes'),annotation=document.getElementById('annotation'),guides=document.getElementById('guides');
var rowsEl=document.getElementById('rows');
var groups=[],cellEls=[],labels=[],buttons=[],bars=[];
function drawScene(){
  geom=planeGeom();scene.setAttribute('viewBox',geom.vb.join(' '));
  planes.replaceChildren();guides.replaceChildren();groups=[];cellEls=[];labels=[];
  data.forEach(function(o,i){
    var s=o.shard,g=el('g',{'class':'plane','data-shard':i});
    g.append(el('title',{},'分片 '+i+' · rank '+s.rep+(s.ranks.length>1?' 等 '+s.ranks.length+' 张卡':'')+' · pp'+s.p+' tp'+s.t+(D.moe?' ep'+s.ep:'')));
    g.append(el('rect',{x:0,y:0,width:geom.W,height:geom.H,fill:'#131313',stroke:'#393939','class':'outline'}));
    var lab=el('text',{x:18,y:27,'class':'plane-label'},'');g.append(lab);labels.push(lab);
    var matrix=el('g'),arr=[],rg=o.m.rows>4;
    for(var li=0;li<o.m.rows;li++)for(var ci=0;ci<cols.length;ci++){
      var cx=MX+ci*PITCH+colGrp[ci]*GG,cy=MT+li*PITCH+(rg?Math.floor(li/4)*GG:0);
      var rect=el('rect',{x:cx,y:cy,width:CELL,height:CELL,fill:'#1c1c1c','class':'matrix-cell'});
      var t=el('title',{},'');rect.append(t);matrix.append(rect);
      var mk=el('rect',{x:cx+3,y:cy+3,width:CELL-6,height:CELL-6,'class':'ep-mark'});matrix.append(mk);
      arr.push({rect:rect,title:t,mark:mk});
    }
    g.append(matrix);
    g.append(el('rect',{x:geom.W-19,y:8,width:10,height:10,'class':'sib'}));
    g.addEventListener('click',function(){choose(s.rep)});
    groups.push(g);cellEls.push(arr);
  });
  for(var i=data.length-1;i>=0;i--)planes.append(groups[i]);
  /* 入口 / 出口：流水线方向，只标两头 */
  var last=data.length-1;
  guides.append(el('text',{x:geom.xs[0]-12,y:geom.ys[0]+geom.H-4,'text-anchor':'end','class':'scene-hint'},'入口 · PP0 · L0'));
  guides.append(el('text',{x:geom.xs[last]+geom.W*PX+10,y:geom.ys[last]+geom.W*PY+4,'class':'scene-hint'},'出口 · PP'+(D.pp-1)+' · L'+(D.layers-1)));
  drawSelector();
}
function drawSelector(){
  rowsEl.replaceChildren();buttons=[];bars=[];
  var byStage={};data.forEach(function(o){(byStage[o.shard.p]=byStage[o.shard.p]||[]).push(o)});
  Object.keys(byStage).sort(function(a,b){return a-b}).forEach(function(p){
    var row=document.createElement('div');row.className='sel-row';
    var lab=document.createElement('span');lab.className='sel-lab';var r=stageRange(+p,D);
    lab.innerHTML='<b>PP'+p+'</b>L'+r.a+'–L'+(r.b-1)+' · '+byStage[p].length+' 片';row.append(lab);
    var scroll=document.createElement('div');scroll.className='layer-scroll';
    var nav=document.createElement('nav');nav.className='layer-list';nav.setAttribute('aria-label','PP'+p+' 各分片柱状图，点击选择');
    byStage[p].forEach(function(o){
      var i=o.shard.i,b=document.createElement('button');b.type='button';b.className='layer-button';
      var track=document.createElement('span');track.className='bar-track';track.setAttribute('aria-hidden','true');
      var cap=document.createElement('i');cap.className='cap';track.append(cap);
      var bar=document.createElement('span');bar.className='layer-bar';var val=document.createElement('span');val.className='bar-value';bar.append(val);track.append(bar);
      var num=document.createElement('span');num.className='layer-number';num.textContent='R'+o.shard.rep;
      b.append(track,num);b.setAttribute('aria-pressed','false');b.addEventListener('click',function(){choose(o.shard.rep)});
      nav.append(b);buttons[i]=b;bars[i]=bar;
    });
    scroll.append(nav);row.append(scroll);rowsEl.append(row);
  });
}

/* ── 上色：换口径只换尺度，几何不动 ── */
function paint(){
  var mode=state.mode,mx=maxCell[mode]||1,lg=Math.log(Math.max(2,mx/MiB));
  data.forEach(function(o,i){
    var s=o.shard,r=stageRange(s.p,D);
    labels[i].textContent='R'+String(s.rep).padStart(3,'0')+'  /  pp'+s.p+' tp'+s.t+(D.moe?' ep'+s.ep:'')+'  /  '+MODES[mode].code;
    o.m.cells.forEach(function(c,k){
      var v=c[MKEY[mode]],e=cellEls[i][k],g=0;
      if(v>0)g=.10+.90*clamp(Math.log(Math.max(1,v/MiB))/lg,0,1);
      e.rect.setAttribute('fill',v>0?shade(g):'#1c1c1c');
      e.title.textContent=(mode==='weight'?c.tip:mode==='comm'?(c.tip+(c.comm?' · 每步跨卡 '+fmtB(c.comm):'')):c.tip+(c.hbm?' · 模型态 '+fmtB(c.hbm):''));
      e.mark.classList.toggle('show',mode==='comm'&&c.ep);
    });
    var bv=o.bar[mode],sc=scale[mode];
    bars[i].style.height=(bv/sc*100)+'%';bars[i].style.background=edgeShade(bv/(maxBar[mode]||1));
    bars[i].querySelector('.bar-value').textContent=fmtGB(bv);
    buttons[i].setAttribute('aria-label','分片 '+i+' · rank '+s.rep+'，'+MODES[mode].bar+' '+fmtGB(bv)+' '+MODES[mode].unit);
    buttons[i].title='rank '+s.rep+' · '+MODES[mode].bar+' '+fmtGB(bv)+' '+MODES[mode].unit+' · ×'+s.ranks.length+' 副本';
  });
  document.querySelectorAll('.layer-list').forEach(function(n){n.classList.toggle('capped',mode==='hbm');n.style.setProperty('--cap',(D.hbm*GiB/scale.hbm*100)+'%')});
  document.querySelectorAll('.bar-track .cap').forEach(function(c){c.style.bottom='var(--cap)'});
  document.getElementById('rms-range').textContent='0 — '+fmtGB(scale[mode])+' '+MODES[mode].unit+(mode==='hbm'?' · 容量 '+D.hbm+' GB':'');
  document.getElementById('bar-metric').textContent=MODES[mode].bar;
  document.getElementById('legend-text').textContent=MODES[mode].legend;
  document.getElementById('legend-hollow').style.display=mode==='comm'&&D.moe?'inline':'none';
  document.querySelectorAll('[data-mode]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.mode===mode))});
  document.querySelectorAll('[data-zero]').forEach(function(b){b.setAttribute('aria-pressed',String(+b.dataset.zero===state.zero))});
}

/* ── 选中态：白边 + 编号高亮 + 位置抽出；同组标记只画记号，不改柱高 ── */
function redraw(){
  var selShard=shardOfRank(state.sel,D,shards)||shards[0],si=selShard.i;
  var sibSet={};
  if(state.group!=='none'){groupRanks(state.sel,state.group,D).forEach(function(g){var sh=shardOfRank(g,D,shards);if(sh&&sh.i!==si)sibSet[sh.i]=true})}
  data.forEach(function(o,i){
    var on=i===si,g=groups[i],x=geom.xs[i],y=geom.ys[i]-(on?geom.raise:0);
    g.setAttribute('transform','matrix('+PX+' '+PY+' 0 1 '+x+' '+y+')');
    g.classList.toggle('chosen',on);g.classList.toggle('sibling',!!sibSet[i]);
    var ol=g.querySelector('.outline');ol.setAttribute('fill',on?'#1b1b1b':'#131313');ol.setAttribute('stroke',on?'#ffffff':edgeShade(o.bar[state.mode]/(maxBar[state.mode]||1)));
    buttons[i].setAttribute('aria-pressed',String(on));buttons[i].classList.toggle('sibling',!!sibSet[i]);
  });
  var o=data[si],s=o.shard,ax=geom.xs[si],ay=geom.ys[si]-geom.raise,co=coordsOf(state.sel,D);
  annotation.replaceChildren();
  annotation.append(el('path',{d:'M'+(ax-32)+','+(ay+18)+'H'+ax,fill:'none',stroke:'#bdbdbd','stroke-width':1}));
  annotation.append(el('text',{x:ax-43,y:ay+9,'text-anchor':'end','class':'scene-label'},'rank '+state.sel));
  annotation.append(el('text',{x:ax-43,y:ay+34,'text-anchor':'end','class':'scene-small'},'pp'+s.p+' · tp'+co.t+(D.cp>1?' · cp'+co.c:'')+' · dp'+co.d+(D.moe?' · ep'+s.ep:'')+' · L'+o.m.a+'–L'+(o.m.b-1)));
  annotation.append(el('text',{x:ax-43,y:ay+52,'text-anchor':'end','class':'scene-small'},MODES[state.mode].name+' '+fmtGB(o.bar[state.mode])+' '+MODES[state.mode].unit+' · ×'+s.ranks.length+' 副本'));
  var sibN=Object.keys(sibSet).length,sum=document.getElementById('selected-summary');
  var extra=state.mode==='hbm'?(' · W '+fmtGB(o.w)+' / ∇W '+fmtGB(o.w/D.zG)+' / O '+fmtGB(6*o.w/D.zO)+' / A '+fmtGB(o.act)+'（在途 '+o.inflight+' μb）/ 碎片 '+fmtGB(o.rsv)+(o.agWin?' / AllGather 窗口 '+fmtGB(o.agWin):'')+' · 合计 '+fmtGB(o.hbm)+' / '+D.hbm+' GB'):
    state.mode==='comm'?(' · 每步跨卡 '+fmtGB(o.comm)+' GB（DP 梯度 '+fmtGB(o.w)+' + TP/PP 激活）'):(' · 权重 '+fmtGB(o.w)+' GB · '+fmtP(o.params)+' 参数');
  sum.textContent='rank '+state.sel+' / '+MODES[state.mode].name+extra+(state.group!=='none'?' · 同 '+GROUPS[state.group]+' 组另 '+sibN+' 片':'');
  document.getElementById('previous').disabled=si===0;document.getElementById('next').disabled=si===data.length-1;
  document.querySelectorAll('[data-group]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.group===state.group));if(b.dataset.group==='ep')b.disabled=!D.moe});
  syncUrl();report();
}
function choose(g){state.sel=clamp(g,0,D.world-1);redraw()}
function step(d){var sh=shardOfRank(state.sel,D,shards);var i=clamp((sh?sh.i:0)+d,0,data.length-1);choose(data[i].shard.rep)}
function setMode(m){if(!MODES[m])return;state.mode=m;paint();redraw()}
function setGroup(g){if(!GROUPS[g])return;state.group=g;redraw()}
function setZero(z){z=clamp(z|0,0,3);if(z===state.zero)return;state.zero=z;var sel=state.sel;build();state.sel=sel;paint();redraw()}
function syncUrl(){
  var u=new URLSearchParams(location.search);
  if(state.preset!=='default128')u.set('preset',state.preset);else u.delete('preset');
  if(state.mode!=='weight')u.set('mode',state.mode);else u.delete('mode');
  u.set('sel',state.sel);
  if(state.group!=='none')u.set('group',state.group);else u.delete('group');
  if(state.zero)u.set('zero',state.zero);else u.delete('zero');
  var t=location.pathname+'?'+u.toString()+location.hash;
  if(t!==location.pathname+location.search+location.hash)try{history.replaceState(null,'',t)}catch(e){}
}
function report(){if(window.parent===window)return;try{window.parent.postMessage({type:'pto:state',pattern:'rank-topology-mono',preset:state.preset,mode:state.mode,sel:state.sel,group:state.group,zero:state.zero},'*')}catch(e){}}

/* ── 页头文字 ── */
function heading(){
  var hd=D.headDim,perLayer=D.hidden*D.heads*hd+2*D.hidden*D.kv*hd+D.heads*hd*D.hidden+2*D.hidden+(D.moe?D.hidden*D.experts+D.experts*3*D.hidden*D.ffn:3*D.hidden*D.ffn);
  var total=perLayer*D.layers+2*D.vocab*D.hidden;
  document.getElementById('title-sub').textContent=' / '+PRESETS[state.preset].name+' · '+D.world+' 卡';
  document.getElementById('meta').textContent='TP'+D.tp+' × CP'+D.cp+' × PP'+D.pp+' × DP'+D.dp+(D.moe?' · EP'+D.ep+'（折入 TP·CP·DP 平面）':'')+' · '+D.layers+' 层 · hidden '+D.hidden+(D.moe?' · '+D.experts+' 专家 / 卡持 '+(D.experts/D.ep):'')+' · '+shards.length+' 种分片 × '+(D.world/shards.length)+' 副本';
  document.getElementById('status').textContent='模拟数据 · 约 '+fmtP(Math.round(total))+' 参数 · seq '+D.seq+' · mbs '+D.mbs+' · GA '+D.ga;
  document.title='模型分片与训练设备映射 · 黑白版 · '+D.world+' 卡';
}

/* ── 交互 ── */
document.querySelectorAll('[data-mode]').forEach(function(b){b.addEventListener('click',function(){setMode(b.dataset.mode)})});
document.querySelectorAll('[data-group]').forEach(function(b){b.addEventListener('click',function(){setGroup(b.dataset.group)})});
document.querySelectorAll('[data-zero]').forEach(function(b){b.addEventListener('click',function(){setZero(+b.dataset.zero)})});
document.getElementById('previous').addEventListener('click',function(){step(-1)});
document.getElementById('next').addEventListener('click',function(){step(1)});
document.addEventListener('keydown',function(e){if(e.target&&/INPUT|TEXTAREA/.test(e.target.tagName))return;if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();step(e.key==='ArrowRight'?1:-1);var sh=shardOfRank(state.sel,D,shards);if(sh&&buttons[sh.i])buttons[sh.i].focus()}});
window.addEventListener('message',function(ev){
  var d=ev.data;if(!d||d.type!=='pto:state')return;
  var rebuild=false;
  if(d.preset&&PRESETS[d.preset]&&d.preset!==state.preset){state.preset=d.preset;rebuild=true}
  if(d.zero!==undefined&&isFinite(+d.zero)&&clamp(+d.zero,0,3)!==state.zero){state.zero=clamp(+d.zero,0,3);rebuild=true}
  if(rebuild){build();drawScene();heading()}
  if(d.mode&&MODES[d.mode])state.mode=d.mode;
  if(d.group!==undefined){var g=String(d.group).toLowerCase();state.group=GROUPS[g]?g:'none'}
  if(d.sel!==undefined&&isFinite(+d.sel))state.sel=clamp(+d.sel,0,D.world-1);
  paint();redraw();
});

build();drawScene();heading();paint();redraw();
window.RankAtlas={state:state,get D(){return D},get shards(){return shards},get data(){return data},choose:choose,setMode:setMode,setGroup:setGroup,setZero:setZero};
})();

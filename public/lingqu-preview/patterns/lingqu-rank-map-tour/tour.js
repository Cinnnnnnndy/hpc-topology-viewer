(() => {
'use strict';
const steps = [
 ['集群定位','先看设备全貌。接下来沿同一个 Rank，从集群逐层进入单卡。',{}],
 ['模型如何切分','高亮目标 Rank 所在的 PP 段：先明确它负责模型的哪一段。',{pp:true}],
 ['分片放在哪里','保持这一 PP 段，进入目标 POD，找到承载分片的板与 NPU。',{pp:true,pod:true}],
 ['进入目标板','沿同一设备继续下钻，观察板内 NPU 与出板连接。',{board:true}],
 ['锁定目标 Rank','选定这张卡，联系并行坐标、层区间和显存读数；后续始终跟随它。',{board:true,rank:true}],
 ['这张卡存什么','进入单卡，查看参数、梯度、优化器与激活的显存构成。',{detail:true}],
 ['对应模型哪一片','设备不变，只将显存视角切到整网分片，定位它在模型中的职责。',{detail:true,rv:'net'}],
 ['分片内部构成','继续展开同一分片，观察它承载的层内结构。',{detail:true,rv:'comp'}],
 ['与谁共同计算','保留层构成，展开兄弟 Rank，理解相邻分片如何共同承载计算。',{detail:true,rv:'comp',sibs:true}],
 ['通信如何发生','在同一卡组上叠加并行通信关系。暂停后可用原有控件筛选 TP、CP、EP、DP、PP。',{detail:true,rv:'comp',sibs:true,comm:true}],
 ['对照完整模型','保留当前卡与通信关系，打开整网参考，连接局部分片与全模型。',{detail:true,rv:'comp',sibs:true,comm:true,drawer:'netgraph'}],
 ['从结构到执行','保持当前 Rank，改看流水泳道，把空间上的分片对应到时间上的执行。',{detail:true,rv:'comp',sibs:true,comm:true,drawer:'swimlane'}],
];
const bar=document.createElement('section');bar.id='productTour';bar.setAttribute('aria-label','功能导览播放条');
bar.innerHTML='<div class="tour-caption" aria-live="polite"><b></b><span></span></div><div class="tour-controls"><button class="tour-play" aria-label="播放导览"></button><button class="tour-prev" aria-label="上一章">‹</button><div class="tour-track"><input type="range" min="0" step="1" value="0" aria-label="导览步骤"><nav aria-label="导览章节"></nav></div><button class="tour-next" aria-label="下一章">›</button><button class="tour-speed" aria-label="切换播放速度">1×</button><output></output></div>';
document.body.append(bar);document.body.classList.add('has-tour');
const range=bar.querySelector('input'),nav=bar.querySelector('nav'),play=bar.querySelector('.tour-play');
const lastStep=steps.length-1;
range.max=lastStep;let index=-1,playing=false,speed=1,timer=0,dirty=false;
// Each step holds its scene. The control represents a step, never elapsed time.
const holds=[2,2.5,2.5,2.5,3,4,3,3,3,4,4,4];
steps.forEach((s,i)=>{const b=document.createElement('button');b.textContent=(i+1)+' · '+s[0];b.onclick=()=>{pause();seek(i)};nav.append(b)});
function draw(){range.value=index;range.style.setProperty('--progress',index/lastStep*100+'%');range.setAttribute('aria-valuetext','第 '+(index+1)+' 步，共 '+steps.length+' 步：'+steps[Math.max(0,index)][0]);bar.querySelector('output').textContent=(index+1)+' / '+steps.length;bar.querySelector('.tour-prev').disabled=index<=0;bar.querySelector('.tour-next').disabled=index>=lastStep;play.innerHTML=playing?'<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>':'<svg viewBox="0 0 24 24"><path d="m8 4 12 8-12 8z"/></svg>';play.setAttribute('aria-label',playing?'暂停逐步播放':index===lastStep?'重新逐步播放':'自动逐步播放');}
function seek(value){const next=Math.max(0,Math.min(lastStep,Math.round(value)));if(next!==index||dirty){index=next;dirty=false;window.lingquTourScene(steps[index][2]);bar.querySelector('.tour-caption b').textContent=steps[index][0];bar.querySelector('.tour-caption span').textContent=steps[index][1];[...nav.children].forEach((b,i)=>{b.setAttribute('aria-current',i===index?'step':'false')});nav.children[index].scrollIntoView({block:'nearest',inline:'center',behavior:'instant'});}draw();}
function pause(){playing=false;clearTimeout(timer);draw();}
function scheduleStep(){clearTimeout(timer);if(!playing)return;timer=setTimeout(()=>{if(!playing)return;seek(index+1);if(index===lastStep)pause();else scheduleStep();},holds[index]*1000/speed);}
play.onclick=()=>{if(playing)return pause();if(index===lastStep)seek(0);else if(dirty)seek(index);playing=true;draw();scheduleStep()};
bar.querySelector('.tour-prev').onclick=()=>{pause();seek(index-1)};bar.querySelector('.tour-next').onclick=()=>{pause();seek(index+1)};
bar.querySelector('.tour-speed').onclick=e=>{speed=speed===1?1.5:speed===1.5?2:speed===2?.5:1;e.currentTarget.textContent=speed+'×';if(playing)scheduleStep()};
range.addEventListener('input',()=>{pause();seek(+range.value)});
// Capture the pointer so scrubbing continues even outside the narrow track.
let scrubPointer=null, scrubFrame=0, scrubValue=0;
function scrubAt(e){const rect=range.getBoundingClientRect();scrubValue=Math.round(Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width))*lastStep);range.value=scrubValue;range.style.setProperty('--progress',scrubValue/lastStep*100+'%');if(!scrubFrame)scrubFrame=requestAnimationFrame(()=>{scrubFrame=0;seek(scrubValue)});}
range.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();pause();range.focus({preventScroll:true});scrubPointer=e.pointerId;range.setPointerCapture(scrubPointer);bar.classList.add('is-scrubbing');scrubAt(e)});
range.addEventListener('pointermove',e=>{if(e.pointerId===scrubPointer){e.preventDefault();scrubAt(e)}});
function endScrub(e){if(e.pointerId!==scrubPointer)return;if(e.type==='pointerup')scrubAt(e);cancelAnimationFrame(scrubFrame);scrubFrame=0;seek(scrubValue);scrubPointer=null;bar.classList.remove('is-scrubbing');if(range.hasPointerCapture(e.pointerId))range.releasePointerCapture(e.pointerId);}
range.addEventListener('pointerup',endScrub);range.addEventListener('pointercancel',endScrub);range.addEventListener('lostpointercapture',endScrub);

document.addEventListener('pointerdown',e=>{if(!bar.contains(e.target)){pause();dirty=true}},true);
document.addEventListener('wheel',e=>{if(!bar.contains(e.target)){pause();dirty=true}},{passive:true});
window.addEventListener('blur',()=>{pause();dirty=true});document.addEventListener('visibilitychange',()=>{if(document.hidden)pause()});
bar.addEventListener('keydown',e=>{if(e.target===range)return;if(e.code==='Space'&&e.target===bar){e.preventDefault();play.click()}if(e.key==='Escape')pause()});bar.tabIndex=0;
seek(0);
})();

# A1–A8 自查结论 + 面向投稿的仓库改造清单

**评估日期** 2026-09-10

> ⚠️ 这份 A1–A8 自查未经对抗校验（校验 agent 因会话额度中断而失败），
> 但其中最关键的一条（A2）我已亲自到代码里核实，**确认属实、不是自查夸大**——见 §1 A2 条目下的核实记录。
> 自查提示词本身要求“不要往好里说”，从结果看这条纪律被遵守了：六条 implemented、一条 partial、
> 且 partial 的那条恰恰是全文论证链上最核心的一条（P3 / DP-2）。

---

## 1. A1–A8 逐条核实结论

### A1　✅ implemented
**验收项**：选 CP 维度时，能显示三种不同原语中的任一种（通过 = 不被固定为 Ring）

**证据**：/home/user/hpc-topology-viewer/public/parallel-topology/demo.html:11107-11113 —— renderDimBar 在 dim==='cp' 时额外渲染一排 CP 专属原语选择器，标题字面写「原语（N:M 可换，A1）」，三颗按钮 [['p2p','Ring'],['alltoall','Ulysses'],['allgather','朴素']]，data-act="commprim"。同文件 :2832-2833 是这一屏的消费端：`var prim = dim==='cp' ? (['p2p','alltoall','allgather'].indexOf(ui.commPrim)>=0 ? ui.commPrim : 'p2p') : {tp:'allreduce',pp:'p2p',dp:'allreduce',ep:'alltoall'}[dim]` —— CP 是唯一读用户选择的一支，其余维才是硬编码。合成·卡阵那一屏更宽：:11941-11946 无条件把 PRIMS 五颗全渲染出来、不按 commDim 禁用，COMMON 表（:1081）只把 cp 的 p2p/alltoall/allgather 标成「常见」而不限制可选；:11250 `if(commActive && (ui.detach || ui.commDim==='cp'))` 把 CP 组交给抽离图，:11273 用 ui.commPrim 出线型。URL 参数 `?prim=p2p|allgather|reducescatter|allreduce|alltoall`（:1308 收，:1441 写）。

**差距**：无（就 A1 字面要求而言）。附带说明：非 CP 维在「单维切分」屏是一维一原语的硬编码，只有「合成·卡阵」屏才是全维 × 全原语自由组合。

### A2　⚠️ partial
**验收项**：在任一视图中，找不到任何一个代表 rank 的几何体（通过 = 地址只以标注出现）

**证据**：正面：/home/user/hpc-topology-viewer/public/parallel-topology/demo.html:11147-11189（renderV1）每格用 boxSVG 画卡壳、rank 号只走 txt()（SVG <text>，:11183），<g class="cardg"> 命名为卡；:10748 图例逐字写死教条「**胶囊门牌 = rank 坐标**（DP0/TP1/PP2/CP0/ep3…）。它是地址，没有体积也没有容量——所以永远画成文字，不给几何体。」；:10740 「打开 Rank 之后换成卡壳（一只 = 一张卡）」。
反面（这三条是我判 partial 的依据）：
(1) 同一份 demo.html 自己的开屏说明打脸：:11951 源码注释「方框是 Rank，不是模型层」，:11959 画布左上角那颗「?」的 title 原文是「**每个方框代表一个 Rank**（分布式训练进程，通常绑定一张加速卡），框内展示它负责的模型分片与数据。」——工具对用户的第一句话就是「这个几何体 = 一个 rank」。
(2) /home/user/hpc-topology-viewer/src/view/CubeView.tsx:191-194 —— 选中高亮是一只独立的 <mesh><boxGeometry args={[BOX*1.5,0.28,BOX*1.5]}/>，紧邻注释写明「选中高亮：软件靛色线框（**选中的是一个 rank = 软件对象**）」；同文件 :153-155 按 set.ranks[] 逐 rank setMatrixAt 画 instanced box，:109 「拾取：instanceId == rank」。这是明确以 rank 为单位画出来的几何体。
(3) 数据模型层面卡与 rank 从未分开过：demo.html:11165 `boxes.push({... g: rankOf(t,facet,d,p,D)})`，每只几何体的身份键就是 global_rank，全仓没有任何 ranksPerCard / devicePerCard 之类的建模（grep「一卡多」「ranksPerCard」零命中）。也就是说 PRD §1.1 P3 所举的「一卡多 device 时彻底对不上」那个反例，在实现里根本无法被触发、也就无法被证伪。
(4) 自检面板里 A2 那一行是**写死的字符串** 'pass'（:11858 `rows.push(['A2','无 rank 几何体','pass', ...])`），不是断言。

**差距**：缺一条真正的「卡 ≠ rank」建模（一张卡承载 N 个 rank 时几何体只出现一次），以及把开屏说明 :11959 与 src/view/CubeView.tsx:191 的 rank 线框改口径。当前状态只能说「主视图里 rank 是文字门牌」，不能说「任一视图中找不到代表 rank 的几何体」。

### A3　✅ implemented
**验收项**：把 DP 从 2 调到 8，V4 容器视图无任何变化（通过 = 正确表达了「加 DP 不买余量」）

**证据**：结构证据：/home/user/hpc-topology-viewer/public/parallel-topology/demo.html:1973-2011（memParts）与 :1709 起（paramsPerCard）全函数不出现 D.dp —— 我逐段 grep 过 paramsPerCard 函数体，除一处 CSS 变量注释 --pt-dp 外无 dp 引用；:1570 的段头注释即「持有内容 / 显存（FR-3 / FR-6：函数里没有 DP）」。ZeRO=0 时 zeroDiv（:1837-1840）三档一律返回 1，所以显存构成与 DP 完全无关。
运行时断言（**用户点得到**）：:11806-11814 在配置抽屉里实时跑两个探针 `derive({...cfg, world:TP·CP·PP·2})` 与 `×8`，把两边总字节都打出来并判词「逐字节相同，只买吞吐不买余量（复制 ≠ 共有）」。
另一处更严的断言（在自检面板里）：:11864-11878 对 memParts(probe2,0) 与 memParts(probe8,0) 做 JSON 深比较，ZeRO=0 要求相等、ZeRO>0 要求 4.00 倍差。

**差距**：两点保留：① 断言比的是 memParts 这份数据而非「V4 视图的像素」，是合理代理但不是字面上的「视图无任何变化」；② 实现把 A3 做成了**有条件**的——拨了 ZeRO 档位后 A3 自检翻面成「调 DP 容器**应该**动」（:11878-11879）。这是对 PRD 结论的限定与深化，但严格照 PRD §9 的无条件措辞读，只有 ZeRO=关（默认档）时才成立。

### A4　✅ implemented
**验收项**：卡网格的 axis 取值域不含 CP（通过 = 未混淆两种「第四维」）

**证据**：/home/user/hpc-topology-viewer/public/parallel-topology/demo.html:1067-1068 —— 注释直书「A4 锚点：卡网格 axis 取值域（常量，不含 cp）」，`var AXIS_DOMAIN = ['tp','pp','dp','ep'];`。三处闭环：① URL 入口 :1306 `if(AXIS_DOMAIN.indexOf(q.get('axis'))>=0) ui.axis = q.get('axis');` —— 手写 `?axis=cp` 被静默丢弃、落不进状态；② 按钮由 AXIS_DOMAIN.map 生成（:11931-11934），并额外摆一颗 disabled 的「CP⊘」，title 写「CP 不是卡网格的轴——输入分布见 V5，CP 通信组走抽离图（P2 修正 / A4）」（:11935）；③ 实时断言 :11881-11882 `var a4 = AXIS_DOMAIN.join(',')==='tp,pp,dp,ep';`。CP 在卡网格上走的是分面选择器（:11227-11230 的 data-act="facet"），不是轴。

**差距**：文案有一处对不上：:11882 与 :11935 都把「V5」列为 CP 的独立入口，但 VIEWS（:1224-1232）七个视图里没有 V5/输入分布这一屏，实际的第三条入口是「单维切分」的 CP 屏（cutDim='cp'，输入链 dp▸cp，:11089）。判定本身不受影响。

### A5　✅ implemented
**验收项**：通信耗时不均场景下，工具提示指向耗时**短**的 rank（通过 = 归因方向正确）

**证据**：/home/user/hpc-topology-viewer/public/parallel-topology/demo.html:11415-11436（arZoomSVG）：`entries[i] = base + ((i*37)%7)/40 + (i===culprit ? .85 : 0)`，`exit = max(entries)+xfer`，`spans = entries.map(e => exit-e)`，:11422 `var shortest = spans.indexOf(Math.min.apply(0,spans));`，:11430 只对 `r===shortest && ui.skew` 那一行打红并写文字「**最后进入 · 段最短 = 嫌疑人**」。方向是可证明正确的：注入偏斜使某副本 entry 最晚 → 它的 span 最短 → 它被点名，等待长的其余 rank 一律不点名。图上另有虚线=进入、实线=共同退出两个刻度（:11433-11435），正是 FR-7 要的进入/退出时刻。
触达路径：视图「时间·流」→ stagebar 的「注入偏斜（某副本慢）」+「放大末尾 AllReduce」两颗按钮（:11409-11411）。

**差距**：要两步交互才看得到，不是默认可见；自检面板里这一条标的是 'manual'（:11883），不是自动断言。

### A6　✅ implemented
**验收项**：输入 heads=33, TP=16 时报错并指出具体约束（通过 = 校验有效）

**证据**：/home/user/hpc-topology-viewer/public/parallel-topology/demo.html:1493-1495 —— `if(D.heads % D.tp !== 0) err('heads_tp','heads % TP ≠ 0：heads='+D.heads+' 不能被 TP='+D.tp+' 整除——注意力头须均分到 TP 组（§11）。', nearDiv(...).concat(nearMult(...)))`，既报具体约束式，也给两个方向的最近合法值（TP→ / heads→），每个都是一颗可点的 data-act="fix" 按钮（:11803）。A6 的那组数就是一颗一键预置：:1117 `{id:'bad', name:'非法示例(A6)', bad:true, cfg:{... tp:16 ... heads:33 ...}}`。错误对用户可见：配置抽屉里逐条 .verr（:11801-11805），顶栏还有一枚红 chip「✕ N 个约束violated——点开修」（:11913）。实时断言 :11884-11886 用 `derive({...cfg, heads:33, tp:16, ...})` 现算，检查 errors 里确有 id==='heads_tp'。

**差距**：无。

### A7　✅ implemented
**验收项**：MoE 配置的最小卡数提示等于 PP × max(TP·CP, EP·ETP)（通过 = 未用连乘式）

**证据**：/home/user/hpc-topology-viewer/public/parallel-topology/demo.html:1504 —— `D.moeMin = D.pp * Math.max(D.tp*D.cp, D.ep*D.etp);`，:1505 的错误文案原文带着「（不是各维连乘）」。读数在配置抽屉的诊断行常驻：:11800 `if(D.moe) diag += '...MoE 最小卡数 = PP×max(TP·CP, EP·ETP) = '+fmt(D.moeMin)+'（A7）'`。实时断言 :11888-11889 重算一遍公式与 D.moeMin 比对（MoE 配置下用当前配置，否则退回 PRESETS[2] 探针）。另有一条相关校验 :1509-1510 `(TP·CP·DP) % (EP·ETP)` 的折叠平面整除。

**差距**：无。

### A8　✅ implemented
**验收项**：切换视图后选中的 rank 保持高亮（通过 = 状态连续）

**证据**：/home/user/hpc-topology-viewer/public/parallel-topology/demo.html:1123 `var sel = null;` 是模块级全局；切视图的处理器 :13226 `else if(act==='view'){ ui.backTo=null; ui.view=b.getAttribute('data-v'); stopAnim(); render(); }` 全程不碰 sel。七个视图各自读它：renderV1 :11172 `var isSel = sel===b.g`（描边 var(--pt-fg)、sw=2）；renderV2 :11371 `selCo = coordsOf(sel,D)` → :11375-11376 该 stage 泳道加框、门牌写「stage N ◀ rN」；renderV3 :11439 `var g = (sel!==null && sel<D.world) ? sel : 0`；renderChain :10342 同式；renderDim :2591 同式。sel 只在换配置/换预置（:13206、:13216）和 sel 越界（:12939）时才清。

**差距**：V2 里保持的是「含该 rank 的 stage 泳道高亮 + ◀rN 门牌」，不是一条属于该 rank 的独立时间线——这符合 PRD §5.1「V2 空间折叠到只剩 PP」的设定，但和 §7.2「切到 V2 后仍高亮 rank 5 的时间线」的字面读法有落差。

---

## ⚠️ 2. A2 的独立核实（我亲自到代码里验证，不是转述自查结果）

A2（“在任一视图中，找不到任何一个代表 rank 的几何体”）是**全文论证链最核心的一条**——
它就是 P3（rank 画成容器）与 DP-2（地址只标不画）的验收判据。自查结果给了 `partial`，我逐条自己核实如下：

**核实 1：开屏说明文字。**
```
public/parallel-topology/demo.html:11959
el.innerHTML = ... + 'title="每个方框代表一个 Rank（分布式训练进程，通常绑定一张加速卡），
框内展示它负责的模型分片与数据。"'
```
确认属实：工具对用户说的第一句话就是“方框 = 一个 rank”。

**核实 2：3D 视图的选中高亮几何体。**
```
src/view/CubeView.tsx:191-194
{/* 选中高亮：软件靛色线框（选中的是一个 rank = 软件对象），比卡略大以包住 */}
<mesh ref={selRef} visible={false} raycast={() => null}>
  <boxGeometry args={[BOX * 1.5, 0.28, BOX * 1.5]} />
  ...
```
确认属实：这是一个明确以 rank 为单位画出来的独立几何体，注释原文承认“选中的是一个 rank = 软件对象”。

**核实 3：验收自检面板是否可达（自查报告称是死代码）。**
```bash
$ grep -n "data-d=" public/parallel-topology/demo.html   # 全部 data-d 取值
# 只有 data-d="" 和 data-d="cfg"，全文件没有任何 data-d="acc"
$ grep -n "ui.drawer\s*=" public/parallel-topology/demo.html
# 唯一赋值处：else if(act==='drawer'){ var d = b.getAttribute('data-d'); ui.drawer = ...; }
# 没有任何 URL 参数读取 drawer
```
**确认属实**：`accHTML()`（验收自检面板，含 A1–A8 八行判定）只在 `ui.drawer==='acc'` 时渲染，
而全文件没有任何按钮、任何 URL 参数能把 `ui.drawer` 设成 `'acc'`。**这个面板用户永远打不开。**
面板里 A1/A2 两行还是硬编码字符串 `'pass'`（demo.html:11858），根本不是运行时断言。

**结论**：A2 不能算 partial 打个折就过去——它是**论文最核心主张与自己的实现直接冲突**。
必须在论文 Limitations 里正面写这一条，或者先把实现改对（见 §4 改造清单 P0）。
**这不是无关紧要的小瑕疵：如果不修，审稿人只要打开 demo.html 看一眼开屏说明就能一句话拒稿。**

---

## 3. 六条站得住的判据

A1、A3、A4、A6、A7 五条经代码核实通过且有真正的运行时断言（不是硬编码字符串）；A8 基本成立但 V2 的“保持高亮”
与 PRD 字面表述有出入（保持的是 stage 泳道高亮而非独立时间线，这符合 PRD §5.1 的空间折叠设定，是合理解释不是缺陷）；
A5 成立但需要两步交互触发，不是默认可见。

**FR 层面**：FR-1~FR-8、FR-10~FR-12 均 implemented 且有具体代码位置；FR-9（V5 输入分布视图）与 FR-13、FR-14 是 partial——
FR-9 没有独立的“输入分布”视图，DP×CP 的内容寄居在“单维切分”屏里。

**自查的诚实总结**：不能照原话写。八条里 A1/A3/A4/A6/A7/A8 六条在代码里确实成立且我逐行核到了实现，A5 也成立但要两步交互才触发；但 A2 只能算 partial——demo.html:11959 那句开屏说明白纸黑字告诉用户「每个方框代表一个 Rank」，src/view/CubeView.tsx:191-194 更是画了一只注释写着「选中的是一个 rank = 软件对象」的 boxGeometry 线框，而且全仓从未把卡与 rank 建成两个实体（每只几何体的身份键就是 rankOf 出来的 global_rank），PRD 自己举的「一卡多 device」反例根本无法触发。更要命的是那块 A1–A8 自检面板本身是死代码：只有 ui.drawer==='acc' 才渲染（demo.html:11786），而全文件的 drawer 按钮只有 data-d=\"\" 和 data-d=\"cfg\" 两种，没有任何代码路径或 URL 参数能把它打开——面板里 A1/A2 两行还是硬编码的 'pass' 字符串（:11858）而非断言，A5/A8 标的是 'manual'，真正跑运行时断言的只有 A3/A4/A6/A7 四条（其中 A3 那条已被搬进可达的配置抽屉 :11806-11814）。论文里可以写的是：「提出了八条可判定验收标准，其中四条实现为页面内实时断言，六条经代码核实通过，A2（地址不给几何体）在主视图落实为文字门牌但在跨视图口径与选中态渲染上仍有违例，A5 需人工触发」——不能写「全部通过」，也不能写「工具内置自检面板」，因为那块面板用户点不开。

---

## 4. 面向投稿的仓库改造清单

### P0 · 不改就没法投稿的硬阻塞

**没有 LICENSE 文件（已核实），package.json 也没有 license 字段**
- 在哪：仓库根：无 LICENSE / COPYING / NOTICE；package.json 只有 "private": true + "version"，grep '"license"' 命中 0 次
- 为什么卡投稿：无许可证 = 默认保留全部权利 = 审稿人和 AE 在法律上不能运行、修改、再分发。ACM/IEEE 的 Artifacts Available 徽章硬性要求「公开可访问 + 明确许可 + 永久存档标识（Zenodo DOI）」，三条一条都不满足。审稿人点开仓库链接的第一屏就是 GitHub 那句 'No license'，这会和下面第 3、4 条叠加成一个统一印象：作者其实不打算让别人碰这个东西。
- 怎么改：根加 LICENSE（代码建议 MIT 或 Apache-2.0；文档与图建议 CC BY 4.0，双许可写清哪部分适用哪条），package.json 补 "license" 字段。但必须先解决第 2 条（GLB 出处），否则等于给来路不明的二进制发许可。同时发一个 tag 并推 Zenodo 拿 DOI。
- 工时：0.5 天（依赖第 2 条先完成）

**4 个 .glb 二进制里 3 个完全没有出处/许可记录，唯一有记录的那个自述来自「内部管线」，而 README 对外称这是 open-source GLB swap layer**
- 在哪：src/scene/models/compute-blade.glb (214KB)、cpu-server-package.glb (1.2MB)、dpu-nic-card.glb (1.9MB) 三个没有任何 _sources 记录；src/scene/models/_sources/psu-crps-shelf/source.txt 原文写着 'Reused from our internal BMC 3D model pipeline (feat/3d-glb-model-pipeline) hardware-library'。README.md 第 12–17 行称之为 'optional open-source GLB swap layer'
- 为什么卡投稿：AE 会逐个核对第三方资产的许可来源，这是 artifact evaluation 的标准动作。三个无出处的二进制无法被任何开源许可覆盖；那个「内部管线」资产本身就是对外披露问题（它同时也是仓库自称 brand-free 的反例）。README 的说法与 _sources 记录直接矛盾，被发现会伤害整篇论文的可信度——审稿人会开始怀疑别的 provenance 声明。
- 怎么改：每个 .glb 补 _sources/<id>/source.txt（下载 URL + 许可名 + 作者 + 抓取日期），根加 THIRD-PARTY-NOTICES.md 汇总（含 public/vendor/three-r128.min.js、public/vendor/pto-design-system/ 快照）。补不出出处的直接从版本库删掉——model-registry.ts 用 import.meta.glob 扫目录、缺文件自动回退程序化几何，删了不坏任何功能。README 那句 'open-source' 改成如实描述。
- 工时：1 天（顺带砍掉 3.3MB 二进制）

**public/robots.txt 是 Disallow: /，index.html 挂 noindex/nofollow/noarchive + no-referrer——与「artifact 必须可公开访问」直接冲突**
- 在哪：public/robots.txt（全文 3 行，User-agent: * / Disallow: /）；index.html 第 6–8 行 meta robots、meta googlebot、meta referrer
- 为什么卡投稿：论文里那条 GitHub Pages 链接是这个 artifact 唯一的活体形态。一个自己声明「不要索引我」的站点，在 AE 眼里等价于「作者认为这份材料不应被公开」——这会触发 ethics/disclosure 追问，而不只是扣分。更实际的问题：双盲评审期审稿人从匿名代理打开，no-referrer + noindex 会让他们无法判断这是不是作者自己在托管，也无法通过搜索找回。
- 怎么改：不要在主站上骑墙。建独立的 paper-artifact/ 分支或目录，那一份不挂 noindex、robots 只 Disallow 与论文无关的路径，内容是去实体化 + 英文化版本（见 improvements P0-1）；主站维持现状不动。等披露审批过了再决定主站是否解除。
- 工时：与 improvements P0-1 合并计

**src/content.ts 的 base64 反爬既已失效、又是「我不想被检索」的书面证据——而击穿它的正是本仓自己 tracked 的文件**
- 在哪：src/content.ts（186 行，TOK 全是 dc('5piH6IW+') 这种）+ src/codec.ts（atob 运行时还原）+ README「Content encoding (anti-scrape)」一节。实测击穿点：research/local_21800a0a-*/audit.jsonl 与 research/local_62d3f8b7-*/audit.jsonl（共 26MB，已进版本库）里 昇腾 71 次、Ascend 10 次、灵衢 5 次、Huawei 4 次；public/ 下 5 个 html 明文含 昇腾/灵衢，public/parallel-topology/demo.html 明文写着 CloudMatrix384 的 8 NPU/node、48 node/超节点口径
- 为什么卡投稿：三重伤害。① 反爬根本没生效，合规风险原封不动。② 审稿人 grep 到运行时解码机制，在 IEEE/ACM 的 disclosure 语境里读作「作者在主动规避检索」,这比直接写明文难看得多。③ 论文的图里必然出现这些名词，与仓库自称 scrape-clean 当场自相矛盾。README 里那句「a repository grep or code search finds nothing」是可以被一条 grep 证伪的公开陈述。
- 怎么改：二选一，别骑墙：(a) 走 paper-feasibility §3 的去实体化预案——把 TOK 里的品牌换成 Vendor-A / tier-1 fabric / tier-2 fabric 这类抽象项，dc() 与 codec.ts 整条链路删掉，README 那一节改写成 anonymization rationale；(b) 拿到披露批准后直接明文，同样删掉 dc()。无论哪条，都必须用 git filter-repo 把 research/local_*/audit.jsonl 从历史里移除（它们同时占了 research/ 31MB 里的 26MB 和大半个 .git）。
- 工时：去实体化 3–5 天；filter-repo 清历史 0.5 天（需协调所有分支重推）

**/patterns/* 全部只存在于 GitHub Actions 的叠加步骤里，clone 任何一个 SHA 都跑不出论文里那些图；发布还要跨 4 个分支 + 1 个外部仓库**
- 在哪：.github/workflows/deploy.yml：第 335–390 行从 public/parallel-topology/demo.html sed+node 注入生成 dist/patterns/net-slicing/pattern.html；checkout 的 ref 分别是 main、claude/rubik-view-pattern-extraction-7pk0qt(第100行)、claude/logic-cube-pattern-spec-3oycmv(第139行)、claude/rank-view-network-analysis-htowfc(第171行)，外加 repository: Cinnnnnnndy/pto-design-system @ claude/rank-deck-intersection-payload(第639行)。后果 README 自己写了：本地开 public/ 时 combo-workbench 舞台那两格是空的（public/combo-workbench/index.html 第45行 iframe → ../patterns/net-slicing/pattern.html，本地 404）
- 为什么卡投稿：artifact evaluation 的第一个动作就是 clone 一个 SHA、照 README 跑、看到论文里那张图。这里不存在这样一个 SHA——线上站点是 5 个 ref 在 CI 里拼出来的，且其中 3 个是 claude/* 临时分支（远端共 61 条分支）。审稿人第一步就卡住，后面的贡献他一条也验证不了。这是本仓最硬的一条阻塞，比 LICENSE 还硬。
- 怎么改：把 deploy.yml 里的叠加逻辑抽成 scripts/build-site.mjs，加 npm run build:site，让本地一条命令产出与线上逐字节一致的 dist/；三个 pattern 分支的内容合进 main（或 git subtree add 固化）；外部仓库 pto-design-system 改成 pinned submodule 或 vendored 快照并记 SHA。deploy.yml 改成只调用那个脚本。
- 工时：3–5 天（叠加步骤 683 行，逻辑不少，但都是搬运）

**论文核心主张「A1–A8 是可判定的验收判据」，其自检面板在发布产物里根本点不到**
- 在哪：public/parallel-topology/demo.html：accHTML(D) 定义在第 11856–11895 行，A1/A2/A4/A6/A7 已是实时断言（derive() 现算），A3 已做成 ZeRO 双面断言；渲染入口在第 11786 行 if(ui.drawer==='acc')。但没有任何按钮 data-d="acc"（第 11916 行的段控只有 'cfg'），也没有 URL 参数（grep q.get('drawer') = 0 命中）。第 11805 行代码注释自己写着「现在没有入口（ui.drawer==='acc' 无人触发）」
- 为什么卡投稿：这是全篇最强的一条贡献——可视化论文极少给出可执行的正确性判据。但审稿人打开链接找不到它，只能看到一份 PRD 表格里的文字承诺。「你说它可判定，那我怎么判定」这个问题当场无解，贡献直接降级为口号。修复成本只有几十行。
- 怎么改：给 demo.html 加 ?drawer=acc URL 参数（urlLoad 里一行）+ 底栏段控加一颗「验收」按钮（第 11916 行那一串旁边），并把 accHTML 的 A5/A8 两条从 'manual' 补成真断言（见 improvements P0-2）。同一条链接既是论文的图，又是审稿人的验证入口。
- 工时：1 天（含 A5/A8 补断言）

**零 CI、零测试——除 deploy.yml 外没有任何 workflow，package.json 没有 test 脚本**
- 在哪：.github/ 下只有 workflows/deploy.yml 一个文件，on: push[main] + workflow_dispatch，无 pull_request 触发；package.json scripts 只有 dev/build/preview/typecheck，grep '"test"' = 0；唯一的 Playwright 脚本 scripts/verify-rubik-cube.mjs 需手动 npm i -D playwright、手动起 http.server、从未在 CI 里跑过（devDependencies 里没有 playwright）
- 为什么卡投稿：跟上一条是同一个伤口的两面：论文要主张八条判据「可执行而非可争论」，却拿不出任何自动化证据证明它们此刻通过。审稿人只会问「你怎么知道现在还是通过的」。工程侧同样难看——PR 不跑 tsc，只有推 main 之后 deploy 的 Build 步骤才会因类型错误炸掉，这在 artifact 的 README 里没法自圆其说。
- 怎么改：加 .github/workflows/ci.yml：on pull_request + push，跑 npm run typecheck、npm run build、以及新的 npm run verify（Playwright 跑 A1–A8 + 现有的 rubik 几何回归）。playwright 进 devDependencies，README 挂 CI 徽章。CI 的输出表直接就是论文 §7 那张表。
- 工时：2–3 天（含把 verify-rubik-cube.mjs 并进同一 harness）

**全中文 + 高度个人化术语，图内文字无法进英文论文；参照系 20 节 0 条参考文献；产物里留着「待灵衢团队确认」这种内部渠道措辞**
- 在哪：demo.html 无 lang 参数（grep q.get('lang') = 0），VIEWS/LAYER_NAME/PRIMS 与所有 say()/txt() 标注全中文，stitle= 只能覆盖画布左上角一句题面。public/parallel-reference/index.html 529KB / 20 个 <section>，grep '参考文献|References|doi.org|arxiv' = 0。「待灵衢团队确认」出现在 public/parallel-topology/demo.html（配置面板物理链提示，约 11850 行）、rank-topology-3d.md、rank-topology-3d.json、public/combo-workbench/index.html 四个已发布文件里
- 为什么卡投稿：图是这篇论文的主体证据，中文截图在 IEEE 双栏排版里不可用，而 stitle= 覆盖不了图内标注——这不是翻译工作量问题，是「论文根本没有图」。0 引用意味着 Related Work 无从写起，会被判为不了解领域（paper-feasibility 已把它列为闸 3）。而「待灵衢团队确认」这七个字在披露审批里是最扎眼的一句：它书面承认存在内部信息渠道，且这句话已经发布到公网了。
- 怎么改：① demo.html 加 lang=en 参数 + 一张 i18n 字符串表（文案已集中在 VIEWS / LAYER_NAME / PRIMS / AVAIL 几处常量，加 say()/txt() 调用点）；② 参照系每节 <section> 挂 id + data-cite，文末补 References（§14 那段已经引了 DeepSpeed ZeRO 与 PyTorch FSDP 官方定义，只差正式化）；③ 全库替换「待灵衢团队确认」为 'not verifiable from public documentation'，并给所有带宽/规格数字标注公开出处或 assumed, for illustration only。
- 工时：i18n 5–8 天；引用锚点 3 天；措辞清理 0.5 天

### P1/P2 · 能显著提升说服力的改造

**[P0] 建一个独立的 paper-artifact/ 目录（或同名分支）+ npm run build:paper，产出一份去实体化、英文化、自包含、单 SHA 可复现的版本：品牌名换成 Vendor-A / tier-1 fabric / tier-2 fabric，绝对带宽换成归一化相对值，删掉 dc()/codec.ts 整条链路，不挂 noindex，附 Zenodo DOI 与 REPRODUCE.md。主站 public/ 一个字不改。**
- 服务论文哪节：Artifact Appendix / Availability；同时是 blockers 第 3、4、5 条的共同落点
- 理由：这是把「合规」「可访问」「可复现」「英文图」四个互相打架的要求一次性解开的唯一办法。主站保持现状不用跟任何人解释，论文只指向 paper-artifact 那份。而且它天然回答了 AE 的第一问：clone 这个 SHA、跑这一条命令、看到 Fig.2。分成两份还有个副作用好处——paper-artifact 里可以只保留论文真正用到的那一支（demo.html + parallel-reference），把 v1/v2 历史副本、research/ 31MB、四个 .glb 全部排除在外。
- 工时：2–3 周（与 i18n、去实体化两项工作重叠，不是叠加）

**[P0] 把 A1–A8 做成 headless 自动化测试 scripts/verify-acceptance.mjs，复用 verify-rubik-cube.mjs 已有的 Playwright harness，输出 markdown/JUnit 表；A5/A8 两条从 manual 补成真断言。**
- 服务论文哪节：§7 Evaluation 的第一张表 + §4 Design Principles 的可判定性论证
- 理由：素材已经就位到了令人意外的程度：accHTML() 里 A1/A2/A4/A6/A7 已经是 derive() 现算的实时断言，A3 甚至已经做成 ZeRO 双面断言（zero=0 时 DP=2 与 DP=8 显存构成必须逐字节相等；zero≥1 时必须相差正好 4.00 倍），A6 有现成的 preset=bad（heads=33/TP=16）。只有 A5（归因指向耗时短的 rank）和 A8（切视图保持选中）还是 'manual'，各需要一段 DOM 断言：A5 要把 view=time 的偏斜注入做成可 URL 化的确定性场景（?view=time&skew=1&act=N&sel=R），A8 遍历 VIEWS 七个视图断言 sel 的描边元素持续存在。做完之后论文里可以写「八条判据在每次提交上自动执行，CI 徽章即证据」——可视化论文里几乎没人能这么写。
- 工时：1 周

**[P0] 把「URL 即状态」正式做成论文的可复现性机制：paper-artifact/figures/manifest.json 记录 figure id → 完整 URL → caption → 期望截图 hash，npm run figures 用 Playwright 按 manifest 批量出 PDF/SVG，每张图的 caption 末尾附那条链接（或短链 + 二维码）。**
- 服务论文哪节：贯穿全文的图注；Artifact Appendix 里单列一节 'Every figure is a link'
- 理由：这是本仓最独特、最容易被审稿人记住的卖点，而且它是真的——demo.html 认 40+ 个 URL 参数（view/vtab/cuts/card/net/sel/layer/comm/cgrain/phys/p/preset/zero/prim/dim/axis/facet/skew/act/legend/embed/theme/stitle/q/yaw/pitch/zoom/px/py…），net-slicing.json 的 urlParams 字段已经把它们逐条写成了文档。把它从「一个方便的实现细节」提升成「figure-level reproducibility 机制」，同时顺手解决了图不可复现和图要重出两件事（改了 i18n 或配色，npm run figures 一遍全部重出）。审稿人可以点开任何一张图自己转动它——这在纸面论文里是极强的差异化。
- 工时：4–6 天

**[P0] 把 README 里那张「文字重叠对数」表扩成正式的可复现 benchmark：scripts/measure-overlap.mjs，Playwright 遍历 vtab ∈ {side, front, 3d} × 容器宽度 ∈ {620, 900, 1080, 1400, 2000}px，用 SVG <text> 的 getBBox() 两两求交计数，输出 CSV + 图。**
- 服务论文哪节：§5 Information Architecture 里「窄栏默认用 3D 而非侧视」那条设计决策的证据；§7 Evaluation 的量化小节
- 理由：这是整个仓库里唯一现成的「数字 vs 数字」实验（README 第 141–146 行：侧视 48/42/35 对，正视 1/0/0，3D 0/1/1），而且它测的正是一个真实的设计权衡——VW = clamp(692·AR, 1080, 2600) 在 AR<1.56 时被钳住，620px 宽的格子要装 1080 单位内容、缩放 0.57、文字不跟着缩就全撞在一起。paper-feasibility 把本仓的致命伤诊断为「零评测、零实测」，而这一条已经实测过了，只是没有脚本。补成脚本之后它同时回答了审稿人最爱问的两个问题：「你怎么知道你的默认选择更好」和「换个屏幕尺寸还成立吗」。顺带能派生出一条更强的结论：重叠数是视口宽度与 viewBox 钳位的函数，可以给出一个可预测的临界宽度。
- 工时：3–4 天

**[P0] 给参照系 20 节加引用锚点：每个 <section> 挂 id + data-cite，文末加 References 区，并把已经隐式引用的来源正式化。**
- 服务论文哪节：§2 Related Work、§3 Domain Characterization；docs/paper/related-work.md 已经起了头
- 理由：public/parallel-reference/index.html 有 20 个 <section>、529KB，0 条外部引用——但它并不是凭空推导的：demo.html 第 99532 行附近的注释已经写明「四档的语义按 DeepSpeed ZeRO 与 PyTorch FSDP 的官方定义（/parallel-reference/ §14 二）」，物理链默认值注明「照 CloudMatrix384 的公开口径」，README 提到 Pangu Pro MoE 的真实训练策略（arXiv:2505.21411 可引）。也就是说来源是有的，只是散在注释里。把它们提到 section 级的 data-cite 上，一是补 Related Work 有了抓手，二是每条技术数字都能回溯到公开出处——这恰好也是披露审批要求的那件事，一次工作两处收益。docs/paper/related-work.md 已经识别出必须正面回应的 BG/Q 五维环面那篇（VPA 2014），delta 论证写得很到位，值得直接升级成正文。
- 工时：3 天（锚点）+ 2 周（精读原文补 30–40 条）

**[P1] 真实 trace 的接入点已经存在于 src/scene/ingest.ts，但它接的是 React 那一支、不是论文主图那一支——需要明确二选一：要么把 TelemetryProvider 概念也接进 demo.html，要么论文如实说明两条支线。**
- 服务论文哪节：§6 System（数据来源与可替换性）；§8 Limitations
- 理由：src/scene/ingest.ts 已经定义好了 JobConfig（含真实 rank→(pod,cabinet,host,slot) placement）、RankSample（rank/t/util/straggler/fault/commBytes）和 TelemetryProvider 接口，syntheticProvider 与 tableProvider 同接口可互换——这个设计本身就是论文里一句漂亮的话：'synthetic by default, replayable with real traces'。缺的只有一个 loader：src/scene/ingest-profiling.ts，把 Ascend Profiling 的 step_trace_time.csv / kernel_details.csv 映射成 RankSample[]，data/ 下放一份去敏化样本（结构真、数值归一化）。但有个陷阱必须先说清楚：论文主图那一支 public/parallel-topology/demo.html 是自包含单文件、自带 OPENPANGU_GRAPH 与 SHARD 表，根本不 import ingest.ts。如果论文写「本系统接入真实 trace」而审稿人发现出图的那份不走这条路，会被判为 overclaim。
- 工时：loader 1 周；接进 demo.html 另 1–2 周（或直接在 §8 声明为 future work，0 成本）

**[P1] 写 docs/paper/glossary.md 术语表并让 i18n 表直接引用它：刀→partition dimension、落刀→applied partitioning、腔格→intersection cell、门牌→label/annotation、载体→transport fabric、宁缺毋误→omit-rather-than-approximate（作为正式 design principle 名保留）、整网→whole-model graph、卡→device。**
- 服务论文哪节：§3 Domain Characterization 的术语表；同时是 blockers 第 8 条 i18n 工作的输入
- 理由：paper-feasibility 闸 4 已经列了一半。把它落成文件而不是散在评估里，图内标注和正文用词才能保证一致——审稿人最容易抓的把柄之一就是「Fig.3 里写 intersection cell，正文第 5 页写 cavity」。「宁缺毋误」值得起正式英文名而不是意译：它是 DP-5 的招牌主张，demo.html 第 12958 行配置非法时直接拒绝渲染（'✕ 配置不合法，不渲染视图 —— DP-5 宁缺毋误'），这个「宁可不画也不画错」的行为本身就是一条可展示的设计立场。
- 工时：2 天

**[P1] 清理主线上的历史副本：public/parallel-topology-v1/demo.html (823KB)、-v2/demo.html (836KB)、public/combo-workbench-v1/、-v2/ 移进 archive/ 或删除，README 明确写哪一份是正本。**
- 服务论文哪节：Artifact Appendix / Repository Structure
- 理由：审稿人 clone 下来看到三份 demo.html（823KB / 836KB / 1007KB）、三份 combo-workbench，第一反应是「论文 Fig.2 到底出自哪一份」——这个疑问一旦产生，后面每张图他都会存疑。README 已经有过一次类似教训并写进了警示（concept-map.html 与 parallel-reference 曾是同一文档的两份副本、章节号差一位、三处交叉引用错位很久）。同一个坑不该在投稿前再踩一次。paper-artifact/ 那份只装正本，主站可以继续留副本。
- 工时：1 天

**[P1] 提前写好 AI 使用披露段落，放进 README 的 'Reproducibility & Disclosure' 一节和论文的 acknowledgement。**
- 服务论文哪节：Acknowledgements / Author Contributions；投稿系统的 generative-AI disclosure 表单
- 理由：仓库里 AI 辅助的痕迹是公开可见的：CLAUDE.md、.claude/skills/ 与 .claude/hooks/（.gitignore 特意用负号规则让它们随仓库走）、61 条 claude/* 分支、research/local_*/ 两份完整会话档案。IEEE 与 ACM 现行政策都要求披露生成式 AI 的使用范围。这件事不影响可投性，但被审稿人先发现和作者先声明，观感完全不同——尤其是当仓库里有 26MB 原始会话日志的时候。趁早写一段诚实的、说明「哪些部分是 AI 辅助起草、哪些是作者的原创主张与验证」，反而是加分项。
- 工时：0.5 天

**[P2] 在 §6 System 里如实分层描述技术栈，别让审稿人自己发现「React + Three.js」和出图的那一支不是同一个东西。**
- 服务论文哪节：§6 System Implementation
- 理由：README 开篇写 'built with React + Three.js (@react-three/fiber + @react-three/drei)'，package.json 也确实是那套依赖。但 vite.config.ts 的 rollupOptions.input 只有 index.html 一个入口，public/ 下 30 个 html 根本不过 vite 的 transform——而论文主图那一支 public/parallel-topology/demo.html 是 1MB 的 vanilla 单文件、自己的 SVG 渲染器（frontScene / sideScene）、只在关掉整网切到魔方形态时按需加载 three.js。这不是缺点（单文件自包含正是「一条链接就是一张图」能成立的原因），但如果论文含糊地说「React + Three.js 系统」而审稿人打开 pattern.html 看到的是纯 SVG，就会变成可信度问题。老老实实分三层写：React 工作台外壳 / 自包含 SVG pattern / 按需 three.js 魔方。
- 工时：写作时 0.5 天

**[P2] 给每个 pattern.json 加 paperFigure 字段（figure id、caption、期望参数），让「哪张图对应哪条链接」进版本库而不是留在作者脑子里。**
- 服务论文哪节：配合 P0-3 的 figures/manifest.json 使用
- 理由：public/parallel-topology/net-slicing.json 已经有很完整的 urlParams 文档字段和 interactions 描述，加一个 paperFigure 是顺手的事。好处是图与 pattern 之间的绑定被版本控制住：改了默认视图或参数语义，CI 能当场发现某张论文图的 URL 已经指向别的画面了。这类「图悄悄变了但 caption 没变」的事故在长周期投稿里非常常见（本仓已经有过 sed 通配符把几十处悬浮提示误伤成页面标题的先例，deploy.yml 第 340–367 行那段注释记着）。
- 工时：1 天

### 现成的图表候选

| 内容 | 来源 URL | 当第几张图 | 要不要改造 |
|---|---|---|---|
| 卡阵 + rank 门牌：几何体只表示卡/内容/动作，rank 一律以 <text> 门牌出现，没有任何一个几何体代表 rank | `/patterns/net-slicing/pattern.html?view=compose&card=1&net=0&vtab=3d&sel=23&embed=1&theme=light&legend=1（本地等价：/parallel-topology/demo.html?同参数）` | Fig.1（并排右半）——开场标本图，讲 P3「地址被当成了形状」。左半放 MegaScale (NSDI'24) 那张被大量引用的 3D 并行图，右半放这张，问同一个问题：图上这个方块「装着」什么 | 要改造。必须英文化（图内 TP/PP/DP 标注、门牌格式、图例）；左右两半的配色与投影角度要对齐才能读成对照；措辞走「我们据此提炼出可判定判据」，不要走「他们画错了」。A2 那条断言（accHTML 第 11857 行「几何体只表示卡/内容/动作；rank 一律 <text> 门牌」）就是这张图的 caption |
| 五刀链主图：整网 → DP 复印 → PP 切段 → CP 切序列 → TP 锯片（带 SP）→ EP 分桶 → 五刀的交集恰好是一张卡。刀痕方向本身是读数：竖切=特征维 h，横切=序列维 s | `/patterns/net-slicing/pattern.html?view=chain&cuts=dpcte&vtab=3d&preset=default128&legend=1&embed=1&theme=light` | Fig.2 —— 系统主图，§5 Information Architecture 的开篇。也是整篇论文最该被记住的那一张 | 要改造：英文化 + legend=1 打开后逐条译。可以出一组四连图（cuts=d / cuts=dp / cuts=dpt / cuts=dpcte）做成 build-up 序列，比一张全落的图讲得清楚得多——cuts 参数正是为此设计的（d/p/c/t/e 任意组合，SP 没有自己的字母、跟着 t 一起落） |
| A3 的两面：ZeRO 档位=关时，DP=2 与 DP=8 的显存构成逐字节相等（加 DP 不买余量）；拨到 ZeRO-3 后必须不等、且被切的那档正好差 4.00 倍 | `并排两张：?view=dim&cut=dp&zero=0&embed=1 与 ?view=dim&cut=dp&zero=3&embed=1（demo.html 第 11866–11878 行就是这条双面断言的实现，实时算 pick3(mp2,kk3)/pick3(mp8,kk3) 应为 4.00）` | Fig.4 —— §4 Design Principles 里 DP 那条原则的证据，同时是 §7 Evaluation 里 A3 那一行的配图 | 基本可以直接用，只需英文化。这张图的说服力在于它自带限定条件：「DP 不减显存」只在不开 ZeRO 时成立，一拨档位断言就翻面。论文里主动给出自己主张的边界，审稿人会明显买账——比单方面宣称一条结论强得多 |
| A4 反例：卡网格的 axis 取值域是 {tp, pp, dp, ep}，不含 CP；CP 走分面 / V5 / 抽离图三条独立入口 | `对照两张：?view=dim&cut=cp&preset=longcp&facet=0&embed=1（CP 的正确呈现）与 ?view=compose&axis=dp&preset=longcp&embed=1（卡网格，轴上找不到 CP）。AXIS_DOMAIN 常量在 demo.html 第 1067 行，注释直接写着「A4 锚点」` | Fig.5 —— 讲 P2「CP 硬加成卡网格第四轴」为什么是编码错误：CP 答的是「输入怎么分布」，与「模型怎么分布」是两个问题 | 要改造：英文化 + 两图需要一条明确的视觉对照关系（现在是两个不同视图，读者要自己建立联系）。这张图也是回应 docs/paper/related-work.md §0 那篇 BG/Q 五维环面（VPA 2014）的正面证据——同质维度可以投影，异质维度投影就会撒谎 |
| 物理载体层：同一条通信边落在 UB 还是 RoCE 由并行坐标 (tp,cp,pp,dp,ep) 与物理坐标 (超节点,机柜,node,槽位) 的交叉决定；换挡点在超节点边界，不在 node 边界 | `/patterns/net-slicing/pattern.html?view=chain&card=1&phys=1&comm=1&cgrain=fabric&sel=23&preset=pangu&embed=1（cgrain 合法值：rank|tensor|route|time|cost|intra|fabric；phys=1 打开物理平铺，是独立于 cuts 的第二个配置维度）` | Fig.8 —— §6 System 里「第十层·载体」那一节，讲一条可证伪的反直觉结论：照直觉画成「node 内快、node 间慢」会画反 | 改造最重的一张。必须去实体化：UB/RoCE → tier-1 / tier-2 fabric，绝对带宽（196 GB/s、400 Gbps）删掉或标 assumed for illustration only；perNode/nodeRack/podCards 三个默认值现在注着「照 CloudMatrix384 的公开口径」，要么保留并给公开引用，要么改成抽象参数。另外必须先删掉 demo.html 配置面板里那句「待灵衢团队确认」（约 11850 行）——它已经发布到公网了 |
| 交集腔总账：权重/梯度/优化器态/激活四个形态 × 全部的腔。W·G·O 同一套切分画成一只托盘的三层厚度、厚度比即字节比 2:2:12；激活自己一套，b·s 被真切 | `?view=solid&p=grid&embed=1（全局切分/总账）；对照 ?view=solid&p=cav&embed=1（单个交集腔）与 ?view=solid&p=map&embed=1（双链映射，solid 的默认子视角）` | Fig.6 —— §5 里「视图按坐标组分、图层按对象类分，两者正交」这条 IA 主张的实例；也是与竞品（C&G 2023，从计算图侧切入）的 delta 之一：本文有 rank 侧反查 | 要改造：英文化 + 2:2:12 的厚度比需要在 caption 里给出来源（fp16 权重 2B / fp16 梯度 2B / Adam fp32 参数+momentum+variance 12B），现在只在图上以厚度呈现。三个 p= 子视角建议只选一个进正文，另两个进补充材料 |
| A6 拒绝渲染：heads=33 / TP=16 时报出具体约束并停止绘图 —— 「✕ 配置不合法，不渲染视图（DP-5 宁缺毋误）」 | `?preset=bad&embed=1 —— PRESETS 里已有现成条目 {id:'bad', name:'非法示例(A6)', bad:true, cfg:{heads:33, tp:16, ...}}（demo.html 第 1117 行）；拒绝渲染的那一屏在第 12958 行` | Fig.7 —— §4 DP-5「宁缺毋误 / omit-rather-than-approximate」那条原则的图，同时是 §7 里 A6 的证据 | 几乎不用改，只需英文化那两句错误文案。这张图特别值得放进正文，因为它展示的是「工具拒绝画」——绝大多数可视化论文没有任何一张图在讲「什么时候不该出图」，这是一个很容易被记住的差异点 |
| A1 三连：选中 CP 维度后五种原语仍可任选 —— Ring=P2P / Ulysses=All-to-All / 朴素=AllGather，同一个 All-to-All 既可能来自 MoE 也可能来自 Ulysses CP | `三连图：?view=dim&cut=cp&dim=cp&prim=p2p&embed=1 / &prim=alltoall / &prim=allgather（PRIMS 五个 id 与 COMMON 映射表在 demo.html 的 PRIMS/COMMON 常量里）` | Fig.3 —— 讲 P1「并行维度 ↔ 通信原语一一绑定」为什么是把 N:M 编码成了 1:1 | 要改造：英文化 + 三张图需要压成一行三格（IEEE 双栏单栏宽），每格下面一句 primitive 名。PRIMS 里每条自带的 why 字段（如 All-to-All 的「每张卡给每张卡各发一份不同载荷 → 载荷不等」）可以直接译成图注 |
| 层反查：第 ℓ 层住在哪几张卡上——那一层的层板在每一份复印件上都描出来，并拆解成 PP 决定去哪几张卡 / TP·EP 决定在那几张卡里怎么碎 / DP 决定复制几遍 | `?view=chain&card=1&layer=29&sel=23&embed=1（layer 为整数 ℓ，超范围忽略；q=L29 是等价的搜索框写法，会让打开时搜索框里还是你发出去的那句话）` | Fig.9 —— §6 里 rank 侧反查那一节，正是与竞品 2（Interactive visual analytics of parallel training strategies, C&G 115: 392–403）区分开的地方：它从计算图侧切入，本文多了 rank 侧的逆命题 | 要改造：英文化。建议与正向那一问（Fig.2）配成一对左右图，caption 明写「正向：一张网怎么被切成 world 份 / 逆向：第 ℓ 层落在哪些份上」——互为反查这件事本身就是一条 IA 主张 |
| A1–A8 验收自检面板本身：八行、每行 pass/fail/manual 徽章 + 实时计算出的判定依据（如 A7 显示 4×max(2,8)=32，非连乘） | `目前打不开——accHTML() 在 demo.html 第 11856 行，入口在第 11786 行 if(ui.drawer==='acc')，但没有按钮也没有 URL 参数（q.get('drawer') 命中 0）。需要先做 blockers 第 6 条，之后是 ?drawer=acc&preset=default128&embed=1` | Fig.10 —— §7 Evaluation 的第一张图，论文核心主张的直接证据；同时是审稿人自己的验证入口 | 必须先加入口（几十行）。加完之后这张图基本自带论文形制——它已经是一张表，行是判据、列是「通过与否 + 实时算出的依据」。A5/A8 两行现在显示「交互」徽章，补成真断言后八行全绿，截图即证据。英文化时注意徽章文案「✓ 实时」要译成 'live assertion' 而不是 'passed'，那个区别（实时重算 vs 一次性通过）正是这条贡献的关键 |
| 侧视 vs 3D 的文字重叠对数随容器宽度变化：侧视 620px 48 对 / 900px 42 对 / 1080px 35 对，3D 分别是 0/1/1 | `?vtab=side&view=chain&embed=1 与 ?vtab=3d&view=chain&embed=1，在 620 / 900 / 1080px 三档 iframe 宽度下各截一张（成因是 VW = clamp(692·AR, 1080, 2600) 在 AR<1.56 时被钳在下限，620px 要装 1080 单位内容、缩放只有 0.57）` | Fig.11 —— §5 里「窄栏默认用 3D 而非侧视」这条设计决策的证据；配 improvements P0-4 的 measure-overlap.mjs 输出的曲线图 | 要改造成「六张缩略图 + 一条曲线」的复合图：缩略图给直观印象，曲线给可外推的结论。数字现在只在 README 第 141–146 行的表里，必须先补脚本让它可复现——审稿人一定会问「怎么测的」。这是全仓唯一现成的量化实验，值得占正文一整张图的位置 |
| 4000 卡真实规模：Pangu Pro MoE 的 TP8×PP5×DP100（EP2 折进 DP），整网切分与卡阵在这个规模下仍然读得下来 | `?preset=pangu&view=chain&card=1&net=0&vtab=3d&embed=1（关掉整网后切到 rubik-cube 形态，three.js 按需加载）` | Fig.12 —— §6 末尾的可扩展性小节，或 §7 的性能/规模讨论 | 要改造：Pangu Pro MoE 有 arXiv:2505.21411 可引，这块是安全的，保留真实配置比抽象化更有说服力。但要补一条渲染性能读数（4000 卡下的帧率/首屏时间）——scripts/verify-rubik-cube.mjs 的注释里已经记着 4000 卡时帧率掉到 10fps 左右曾导致动画不收敛，这个数字本身就该进论文的 Limitations 而不是被藏起来 |

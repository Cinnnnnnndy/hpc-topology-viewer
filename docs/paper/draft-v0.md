# 论文初稿 v0 · 本仓（hpc-topology-viewer）

**状态** 初稿骨架 + 已确证章节的实写内容
**目标形制** IEEE CG&A（≤14 页 / 8000 词）或 PacificVis Conference Track
**依据** `docs/parallel-topology-prd.md`、`public/parallel-reference/index.html`、
`public/parallel-topology/rank-topology-3d.md`、`README.md`、`docs/paper/related-work.md`
**待填** §2 Related Work 需精读原文、§8 Evaluation 待嫁接方案定稿、§7 System 待 A1–A8 自查复核结论

> ⚠️ 本稿的 framing 与 `docs/paper-feasibility.md` 初版**不同**。
> 初版说「可判定验收在可视化界少见」——检索发现 visualization linting 已是成熟研究线（见 related-work §3.5）。
> 本稿改用更准确也更安全的立论：**把 linting 从通用构造错误推进到领域语义错误**。

---

## 拟题

> **Address Is Not Shape: Domain-Specific Visualization Linting for
> Six-Dimensional Parallelism in Large-Model Training**

备选（更保守）：
> *From Ontology to Information Architecture: Structurally Faithful Visualization of
> Heterogeneous Parallelism in Large-Model Training*

---

## Abstract（草稿，约 180 词）

Training a large model today is configured along six parallel dimensions — tensor, sequence,
context, pipeline, expert, and data parallelism. Existing visualizations compress this
six-dimensional configuration space into three spatial axes. We argue that the resulting
figures do not merely look cluttered: they **encode the domain incorrectly**, and readers act
on the errors.

We contribute (i) an **ontology** of distributed training — five partitionable axes, two
partitioned objects, three coordinate groups, and five object classes — derived from and
cross-checked against framework documentation; (ii) a taxonomy of **four structural encoding
errors** that follow directly from violating that ontology, each traced to a specific
misreading practitioners make; (iii) five design principles and an information architecture in
which **views are separated by coordinate group and layers by object class, orthogonally**; and
(iv) **eight decidable acceptance criteria** — checks that can be executed against a running
tool rather than argued about.

Where visualization linting today detects generic construction errors, we show that a domain
with a sufficiently articulated ontology admits **domain-specific, decidable** correctness
checks. We instantiate the architecture on a real 4000-rank MoE training configuration.

> 待补最后一句：evaluation 的结论。等 §8 定稿。

---

## 1. Introduction

### 1.1 开场（用活体标本，不用抽象论述）

开篇给一张**真实存在、被大量引用**的图——MegaScale (NSDI'24) 的 3D 并行拓扑，
或那个免费在线的 LLM 并行策略模拟器（DeepSeek V3 TP=8·EP=8·PP=4 配置）。
然后提一个具体问题：

> 图上每个方块代表一个 rank。请问：这个方块**装着**什么？

答案是——**什么都没装**。`rank` 是地址，不是容器。装东西的是**卡**（device）。
在一卡一 device 的常见情形下这个区别看不出来；一卡多 device 时彻底对不上。
这不是吹毛求疵：**当读者以为地址是容器，他就会以为"加 DP 能减少每个 rank 装的东西"**——
而实际上加 DP 不减单卡显存分毫。

这就是本文要处理的那一类错误：**不是画得难看，是编码错了。**

### 1.2 问题陈述

并行训练的配置空间是六维的（TP / SP / CP / PP / EP / DP），人只能在三维里看东西。
现有方案普遍"硬塞"，产生四类**结构性错误**：

| # | 现象 | 本质 | 后果 |
|---|---|---|---|
| **P1** | 把并行维度与通信原语一一绑定 | 把 **N:M 关系编码成 1:1** | 看到 All-to-All 就以为是 MoE，而它同样可能是 Ulysses CP |
| **P2** | 把 CP 硬加成卡网格的一根轴 | 混淆两种「第四维」——切分维与时间轴 | CP 与 DP 在卡网格上长得一样，用户分不清 |
| **P3** | 把 rank 画成容器 | **地址被当成了形状** | 让人以为 rank「装着」东西，一卡多 device 时彻底对不上 |
| **P4** | 只呈现单卡时间线 | 丢掉跨 rank 的相对关系 | 把「等待」误判为「链路慢」，归因方向完全反了 |

> 每一条都要在正文里配一张**真实工具的截图**作为标本，并给出**该错误导致的具体误判**。
> P4 尤其重要：它有一条可以写成一句话的反直觉结论——
> **等待时间长的那张卡是受害者，等待时间短的才是嫌疑人。**

### 1.3 为什么"再画好看一点"解决不了

这里要正面回应 §2 的关键前作。**BG/Q 五维环面**那篇（VPA'14）解决的是结构上同一个问题：
高维网络没有自然的低维表示。它的解法是**投影 + 多级切片**。

**但那套解法在这里不适用**，因为两种"高维"性质不同：

| | 五维环面 | 六维并行 |
|---|---|---|
| 维度性质 | **同质**——五根轴都是物理网格坐标，可互换 | **异质**——六根轴性质各不相同 |
| 有序性 | 全部有序 | `pp_rank` 有序必须占轴；`tp_rank`/`dp_rank` 只是标签，折叠不丢信息 |
| 被切的对象 | 都是节点 | 权重体 vs 激活体，两个不同对象 |
| 是不是切分维 | 都是 | **CP 不是**——它是"输入怎么分布" |

> **一句话立论**：同质维度可以投影；**异质维度投影就会撒谎**。
> 把 CP 和 DP 投到同一根轴上，它们在图上长得一样，而代价差一个量级。
> 所以本文不是"找一个更好的投影"，而是**先建立本体论，再由本体论决定谁能上轴、谁只能标注**。

### 1.4 贡献

1. **一套分布式训练的本体论**：五根轴（`ℓ h e b s`）· 两个对象（权重体/激活体）·
   三组坐标（空间/时间/粒度）· 五类对象（结构/内容/容器/地址/动作）
2. **四类结构性编码错误的分类学**（P1–P4），每一条都追溯到从业者的一个具体误读
3. **五条设计原则 + 一套正交信息架构**：视图按坐标组划分、图层按对象类别划分，二者正交
4. **八条可判定的验收标准**（A1–A8），可对运行中的工具直接执行，而不是靠争论
5. 在一个**真实的 4000-rank MoE 训练配置**上的实例化

**相对 visualization linting 已有工作的位置**（见 §2）：现有 linter 只能检测**通用构造错误**
（截断轴、比例失真）。本文表明，当一个领域的本体论被梳理得足够清楚时，
**领域语义层面的正确性判据也可以做成可判定的**。

---

## 2. Related Work

> 素材见 `docs/paper/related-work.md`。以下是成文时的组织方式。

**2.1 高维并行结构的可视化。** BG/Q 五维环面（VPA'14）、多维环面拓扑与流量（IEEE Access'18）、
Boxfish（InfoVis'12）。→ 引出 §1.3 的同质/异质之分。

**2.2 大模型并行训练的可视化。** TVCG'23 的性能诊断、C&G'23 的计算图-通信双部图、
MegaScale 的 3D 并行视图。→ 说清三条 delta：结构 vs 性能、六维 vs 三维、有无物理载体层。

**2.3 并行执行 trace 的可视化。** 逻辑时间（InfoVis'14）、Ravel/lateness（TPDS'16）、
Traveler（VIS'22）。→ **明确承认本仓的泳道/流水线部分是复用这一系的范式，不作为贡献点。**

**2.4 可视化 linting 与误导性图表分类学。** 74 类误导问题、7+7 双层错误分类、规则化 linting。
→ 引出本文的定位：从通用构造错误推进到领域语义错误。

**2.5 设计研究方法论。** Munzner nested model (InfoVis'09)、Sedlmair et al. design study
methodology (InfoVis'12)、nested blocks and guidelines (IV'15)。
→ 说明本文落在 nested model 的哪几层，以及 DP-1~5 对应 "guidelines" 这一层。

---

## 3. Domain Characterization: An Ontology of Distributed Training

> 来源：参照系 §00–§10。成文时**大幅压缩**——参照系有 20 节，论文里只能占 1.5 页。
> 原则：**只保留后面 §4–§6 会用到的那些**，其余进补充材料。

### 3.1 五根轴
可切的东西一共只有五样，记作 `ℓ`（层）`h`（注意力头）`e`（专家）`b`（批）`s`（序列）。
六种并行各切其中一到两根：

| 并行 | 切哪根轴 | 切的是 |
|---|---|---|
| TP | `h` / FFN 中间维 | 权重体 |
| SP（Megatron 语义） | `s` | 激活体（仅 LayerNorm/Dropout 段） |
| CP（Ulysses/Ring 语义） | `s` | 激活体 |
| PP | `ℓ` | 权重体 |
| EP | `e` | 权重体 |
| DP | `b` | 都不切，整套复制 |

> **勘误 K**：`SP` 一词有两种互不相容的语义。本文一律把 Ulysses 语义写作 `CP`。
> 这一条要在论文里单独成段——它是本文相对框架文档的真增量，因为混乱正是文档各说各话造成的。

### 3.2 两个对象
**权重体**（参数/梯度/优化器态，字节比约 2:2:12）与 **激活体**（随 `b·s` 变化）。
被切的是这两者之一，切法与代价都不同。

> 这条直接支撑 **A3**：`DP` 复制的是整套安排，不改变单卡容器里装的量——**加 DP 不买余量**。

### 3.3 三组坐标
空间（4 维）· 时间 · 粒度（整网→层→算子→kernel）。
**三组坐标而只有三根空间轴**——这是硬约束，是 DP-5「宁缺毋误」的来源。

### 3.4 五类对象 ⭐
全文研究的东西一共五类，**每类的视觉语法不同**：

| 类别 | 是什么 | 该画成什么 |
|---|---|---|
| 结构 | 图 / 层 / 算子的拓扑 | 节点 + 边，**无厚度** |
| 内容 | 权重体 / 激活体 | 实心块，**体积 ∝ 字节数** |
| 容器 | 卡、流 | 线框盒，有明确容量边界 |
| **地址** | rank、各域内 rank | **文字标注 —— 不得是任何几何体** |
| 动作 | 通信 | 连线 / 箭头 |

> **这张表是全文的枢纽。** P3 就是"地址"被当成了"容器"；DP-2 就是这张表本身。

### 3.5 基数：每种关系是几对几
- 并行维度 ↔ 通信原语：**N:M**（CP 可以是 Ring(P2P) / Ulysses(All-to-All) / 朴素(AllGather)）
- 层 ↔ 卡：**多对多**
- 卡 ↔ rank：**不是一回事**（一卡可多 device；rank 是域限定的）

> **任何 N:M 关系在界面上呈现为 1:1，就是 P1。**

---

## 4. Four Structural Errors（本文的分类学）

> 每一条按统一模板写：**标本图 → 现象 → 本质（违反了本体论的哪一条）→ 导致的具体误判 → 判据**

| # | 违反了 | 判据（对应 §6 的验收项） |
|---|---|---|
| P1 | §3.5 基数 N:M | A1：选 CP 维度时，能显示三种不同原语中的任一种 |
| P2 | §3.1 CP 切的是输入不是模型 | A4：卡网格的 axis 取值域不含 CP |
| P3 | §3.4 地址 ≠ 容器 | A2：在任一视图中，找不到任何一个代表 rank 的几何体 |
| P4 | §3.3 时间是独立坐标组 | A5：通信耗时不均时，提示指向耗时**短**的 rank |

> **写作要点**：P1–P4 不是"我们发现的四个问题"，而是"违反本体论会且只会产生这四类后果"。
> 前者是经验清单，后者是可推导的结论——**后者才是论文级的表述。**

---

## 5. Design Principles

五条，全部从 §3 直接推出。**当需求与原则冲突时以原则为准。**

| | 原则 | 正式命名（英文） | 它否决了什么 |
|---|---|---|---|
| DP-1 | 基数不压平 | *No Cardinality Flattening* | 否决"维度→原语"下拉框联动 |
| DP-2 | 五类对象，五种语法；**地址只标不画** | *Address Is Annotation, Never Geometry* | 否决"把 rank 画成柱子/盒子" |
| DP-3 | 有序维优先上轴，对称维可折叠 | *Ordered Axes First, Symmetric Axes Foldable* | 把"画哪三根轴"从主观选择变成由配置推导 |
| DP-4 | 视图按坐标组划分，图层按对象类别划分，二者正交 | *Orthogonal Views and Layers* | 否决"选了 TP 就只能看 AllReduce" |
| DP-5 | 宁缺毋误 | *Omit Rather Than Approximate* | 否决"找个近似塞进去" |

> **DP-3 有现成的可交互证据**：`public/pp-pipeline/`（PP 的两张脸）
> 把 PP 留在轴上、把 `TP×DP×CP` 折成每格一个 Stage 截面，
> 于是斜线（一个 micro-batch 的因果链）、重叠（并行）、两角空白（气泡）三件事同时可读；
> 点开任一 Stage 又能把折叠的卡摊回来。**折与不折的代价与收益在同一张图里同时可见。**
> ——这是论文里少有的"原则不是断言、有图为证"的段落，要重点写。

---

## 6. Information Architecture

### 6.1 视图族（按坐标组划分）

| 视图 | 展开的轴 | 折叠/冻结 | 回答什么 |
|---|---|---|---|
| V1 卡网格（空间） | TP × PP × DP | 时间冻结；CP 分面 | 谁和谁在一个通信域 |
| V2 时间线（时间） | 时间 × rank | 空间折叠到只剩 PP | 什么时候谁在算什么 |
| V3 粒度链（粒度） | 整网→层→算子→kernel | 空间折叠 | 某个东西被切在哪一级 |
| V4 单卡容器（内容） | 显存构成 | 折叠为一张卡 | 容器里装了什么、还剩多少 |
| **V5 输入分布（正交）** | DP × CP | —— | **输入**怎么分布 |

> **V5 单独立出来就是 P2 的解法**：V1 回答"模型怎么分布"，CP 属于另一个问题。
> 两个问题各配一张图，比塞进同一张更清楚。

### 6.2 图层（按对象类别划分）
L1 结构 · L2 内容 · L3 容器 · L4 地址 · L5 动作（通信）。
**L5 与维度选择解耦是 DP-4 的硬性落地，也是修正 P1 的关键。**

### 6.3 坐标读出规范（修正 P3）
- `global_rank` **常驻**，任何视图任何时候都不变
- 域内 rank 随当前 axis **高亮**，不替换全局号
- rank 一律以**标注**贴在卡（容器）上，**不得**渲染为独立几何体

---

## 7. System

> ⚠️ 待 A1–A8 自查复核结论回来后填。已知素材：

- **实例化配置**：Pangu Pro MoE 72B-A16B 的真实训练策略 `tp8·pp5·dp100·ep2 = 4000 rank`（arXiv:2505.21411）
- **七个可交互 pattern**：net-slicing、rank-topology-3d、model-netgraph、rubik-cube、
  net-sharding、pp-pipeline、combo-workbench
- **URL 即状态**：每张图都对应一条可分享链接（`?phys=1&cgrain=fabric&sel=23`），
  → **这是极强的可复现性卖点：论文每张图下面直接附链接，审稿人点开就是那一屏**
- **第十层「载体」**：卡同时挂在并行坐标 `(tp,cp,pp,dp,ep)` 与物理坐标 `(超节点,机柜,node,槽位)` 上，
  两套坐标的交叉决定这条边走 UB 还是 RoCE（带宽差一个数量级）
  → 反直觉结论：**超节点内 node 边界不是降速点，换挡点是超节点边界**
- **已有的一次量化实验**：README 里那张"侧视/正视/3D 三个机位在 620/900/1080px 下文字重叠对数"表
  （侧视 48/42/35 对，正视 1/0/0，3D 0/1/1）→ **这是仓库里唯一现成的量化证据，要扩成正式 benchmark**

---

## 8. Evaluation

> ⚠️ **待定。** 这是全文最关键也最缺的一章。

### 8.1 一个现成的对照组（本轮新发现）⭐

检索到一个公开可访问的 **LLM 并行策略在线模拟器**（simulations4all.com），
覆盖 DP / TP / PP / EP / SP，带 GPU 网格布局、动画数据流、流水线气泡、逐卡显存，
内置 DeepSeek V3（TP=8·EP=8·PP=4）等真实配置。

**初步按 A1–A8 对照的结果**（⚠️ 来源为该站说明页的抓取摘要，**尚未亲自打开工具逐条核实**，
写进论文前必须自己跑一遍并截图存证）：

| 判据 | 初判 | 依据 |
|---|---|---|
| **A1** 选 CP 时能显示三种不同原语中的任一种 | ❌ **不通过** | 该站明示"每种策略天然决定它的通信类型，用户不能单独切换原语"：DP/TP→AllReduce、PP→P2P、EP→All-to-All、SP→ring exchange。**这正是 P1：把 N:M 编码成 1:1** |
| **A4** 卡网格 axis 取值域不含 CP | ⚠️ **不适用/存疑** | 该工具**根本没有 CP**，把 Ulysses 语义折进了 `SP`。**这正是勘误 K 描述的那种混淆** |
| **A3** 把 DP 从 2 调到 8，容器视图纹丝不动 | ❌ **不通过（且疑似事实错误）** | 该站称逐卡显存随 DP 增大而"按卡数成比例下降"，给的式子是 `M_DP = 12P bytes`。**但朴素 DP 每张卡持有完整模型副本，显存不减分毫**；按卡数下降的是 ZeRO/FSDP 的分片，那是另一回事，而 `12P` 恰是 ZeRO 优化器态的量级 |
| A2 找不到代表 rank 的几何体 | ❓ 未知 | 说明页只写"GPU grid layouts"，未描述具体图元。需亲自看 |

**为什么这个发现重要**

1. **它比自建 MegaScale 复现省事得多**，而且是**真实存在、任何人可复现**的对照物——
   审稿人可以自己点开验证，这比论文里放一张别人的截图有力得多
2. **A3 那一条如果核实成立，是本文最有力的单个证据**：一个公开工具在显存这件事上
   编码了一个**可证伪的错误论断**，而本文的判据 A3 恰好能机械地把它检出来。
   这正是"领域语义 linting"这个立论要的东西——不是"我们的图更好看"，
   而是"**我们的判据能查出别人图里的实质错误**"
3. 它同时坐实了 P1（原语与维度绑死）与勘误 K（SP/CP 语义混淆）在**当下、真实、公开**的工具里存在，
   不是稻草人

**必做**
- [ ] 亲自打开该工具，逐条跑 A1–A8，截图存证，记录版本与访问日期
- [ ] 特别核实 A3：确认它说的到底是朴素 DP 还是 ZeRO/FSDP。**若它写的是 ZeRO 而摘要误读，这条要撤回**
- [ ] 再找 2–3 个同类工具（框架官方文档配图、vLLM MoE 并行指南、Meta 那篇 TP/CP/EP 工程博客）一并打分，
      凑成一张 baseline 对照表 —— **这张表本身就可以是论文的一个贡献**

### 8.2 主体评测方案

> 取决于两件事：①真实 profiling 报告能否嫁接（效度判断进行中）②误判率实验做不做得起来。
> 候选设计见 `docs/paper-feasibility.md` §1 P-A：
> - **回溯性任务复现**（拿真实 incident，比新旧两条路径的正确率与耗时）
> - **数据驱动案例研究**（把真实 trace 喂进视图）
> - **专家验收**（请工程师按 A1–A8 逐条打分）

---

## 9. Limitations

> 素材现成且质量很高，来自参照系 §20「本文的简化、留白与边界」与各 pattern 的「约束与不适用」。
> 直接可写进论文的自我限定：

- **不做性能预测。** 只有"计算密集/访存密集"的定性判据，没有 roofline 这类可算模型。不承诺吞吐数字
- **不做配置推荐。** 只给决策**顺序**，不给数值方法。做校验与诊断，不做"你应该配 TP=8"
- **不覆盖推理。** 全文训练视角，推理的并行语义相当不同
- **耗时是示意口径。** 通信**字节**按配置真算并带量词（`64MB ×2/层` / `5.5GB /步`——
  不写量词的话四条边会被当成同一口径读，实际重复次数差 2–3 个数量级）；
  但**耗时**按算子类别估的量级，非实测，图上一律带 `≈`
- **CP 与 EP 不给数。** CP 逐跳一块 KV、EP 各边由 top-k 路由当场决定——算不出就不给，**宁缺毋误**
- **代价只是传输时间下界。** `载荷÷带宽`，写 `≥`：没算跳数、没算集合通信算法系数
  （环形 AllReduce 要搬 `2(N−1)/N` 份）、没算争用与协议开销
- **一条明示的口径假设**：超节点内一律按同一档带宽算，不区分板内/板间/机架间——待确认

> **写作要点**：这一章不要写成道歉。把"知道自己不知道什么"当作方法论贡献来写——
> 尤其"算不出就不给数"这条，它是 DP-5 在自己身上的应用，**是自洽性的证据**。

---

## 10. 图表清单（初排）

| # | 图 | 来源 | 状态 |
|---|---|---|---|
| Fig.1 | 标本：现有工具把 rank 画成方块 | MegaScale 图 / 在线模拟器截图 | 需授权或重绘 |
| Fig.2 | 本体论总览：五轴·两对象·三坐标·五类对象 | 需新绘 | ❌ |
| Fig.3 | P1–P4 四类错误对照 | 需新绘 | ❌ |
| Fig.4 | V1–V5 视图族 × L1–L5 图层的正交矩阵 | 需新绘 | ❌ |
| Fig.5 | PP 的两张脸（折与不折同时可见） | `public/pp-pipeline/` | ✅ 现成 |
| Fig.6 | rank 三维阵列 + 四刀交集 | `/patterns/rank-topology-3d/?sel=23` | ✅ 现成 |
| Fig.7 | 第十层载体：UB/RoCE 换挡点 | `?phys=1&cgrain=fabric&sel=23` | ✅ 现成 |
| Fig.8 | 单卡容器：调 DP 纹丝不动（A3） | `?net=0` 前后对比 | ✅ 现成 |
| Fig.9 | Evaluation 结果 | —— | ❌ 待 §8 |

> **可复现性卖点**：Fig.5–8 每张下面直接附 URL。这在可视化论文里不常见，是加分项。

---

## 附 · 与 `docs/paper-feasibility.md` 的关系

| 那份说 | 本稿的处置 |
|---|---|
| 「可判定验收在可视化界少见」 | **下调**——linting 已是成熟研究线，改用"从通用构造错误推进到领域语义错误"的 framing |
| 「零引用是闸 3」 | 已开工，见 `docs/paper/related-work.md` |
| 「零验证是最硬的伤」 | 仍然成立，见 §8 |
| 「P-A 已完成 6/9 章」 | **修正为 5/10**——Related Work 有了骨架但未精读；Evaluation 与 System 仍空 |

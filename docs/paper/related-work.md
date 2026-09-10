# Related Work 素材库（本仓论文用）

> 用途：补齐 `docs/paper-feasibility.md` 里点名的「闸 3 · 零引用体系」。
> 参照系全文 0 条外部引用，这份文件是补引用的起点。
> **状态**：外部前作已核实（见每条的链接）；本仓与各前作的 delta 已写明，但尚未逐条对照原文精读。

---

## 0. 一条必须正面回应的前作 ⚠️

### Visualizing the Five-dimensional Torus Network of the IBM Blue Gene/Q
McCarthy, Isaacs, Bhatele, Bremer, Hamann · **1st Workshop on Visual Performance Analysis (VPA), 2014**
<https://ieeexplore.ieee.org/document/7018174/> · [PDF](https://web.cs.ucdavis.edu/~hamann/McCarthyIsaacsBhateleBremerHamannVPA2014PaperFinal10152014.pdf)

**为什么它是本文最危险也最有用的一篇**：它解决的是**结构上同一个问题**——

> "recent supercomputing architectures use networks that do not have natural low-dimensional
> representations, making them difficult to comprehend or visualize"

它的解法是四联视图：minimaps（所有可能投影的总览）→ hyperplanes（选定投影的全览）→
4D slices（最多五维的逐链数据）→ 3D slice（单个 3D 子环面）。

**本文的 delta（必须在论文里明写，否则会被判为重复工作）**：

| | BG/Q 五维环面 | 本文六维并行 |
|---|---|---|
| 维度性质 | **同质**——五根轴都是物理网格坐标，可互换、可投影 | **异质**——TP/SP/CP/PP/EP/DP 性质各不相同 |
| 有序性 | 全部有序 | `pp_rank` 有序必须占轴；`tp_rank`/`dp_rank` 只是标签、折叠不丢信息（DP-3） |
| 切的是什么 | 都是节点 | 权重体 vs 激活体，两个不同对象 |
| 是不是切分维 | 都是 | **CP 不是**——它是"输入怎么分布"，与"模型怎么分布"是两个问题（P2） |
| 解法 | 投影 + 多级切片 | **本体论先行**：先分清五类对象，再决定谁能上轴、谁只能标注 |

> **这一条差异恰恰是本文的立论**：同质维度可以"投影"，异质维度**投影就会撒谎**——
> 把 CP 和 DP 投到同一根轴上，它们在图上长得一样，而代价差一个量级。
> BG/Q 那篇不需要处理这个问题，因为它的五根轴本来就可互换。

---

## 1. 直接竞品：大模型并行训练可视化

| 前作 | 出处 | 它做了什么 | 本文 delta |
|---|---|---|---|
| **Visual Diagnostics of Parallel Performance in Training Large-Scale DNN Models** | IEEE **TVCG** 2023 · <https://ieeexplore.ieee.org/iel7/2945/10576039/10041726.pdf> | 大模型并行训练的**性能**诊断可视化 | 它诊断性能（时间轴/瓶颈），本文诊断**结构正确性**（谁持有什么）；它 3D 并行，本文六维；本文有物理载体层 |
| **Interactive visual analytics of parallel training strategies for DNN models** | Computers & Graphics 115 (2023) 392–403 · <https://dl.acm.org/doi/10.1016/j.cag.2023.07.030> | 计算图 + 通信算子的双部图构造，辅助并行策略选择 | **最接近的一篇。** 它从计算图侧切入（≈ 本仓 model-netgraph pattern），本文多了 rank 侧反查、地址/容器分离、物理侧 |
| **MegaScale** | USENIX **NSDI** 2024 · <https://www.usenix.org/system/files/nsdi24-jiang-ziheng.pdf> | 万卡训练系统，附 3D 并行拓扑可视化：选中 worker 看逻辑位置、数据流向与通信操作 | 它是系统论文的一个组件、无设计论证。**正好当 P3「地址被当成形状」的活体标本** |

> **战术**：拿 MegaScale 那张被大量引用的图当 P1–P4 的标本开场。
> 措辞走"我们据此提炼出可判定判据"，**不要**走"他们画错了"。

---

## 2. HPC 性能与拓扑可视化（Isaacs 一系是主线）

| 前作 | 出处 | 与本文的关系 |
|---|---|---|
| **Combing the communication hairball: Visualizing large-scale parallel execution traces using logical time** | TVCG (InfoVis '14) | ⭐ **逻辑时间**这个概念的出处。本仓 `pp-pipeline`（PP 的两张脸）与泳道用的正是逻辑时间而非物理时间——必须引，否则等于把别人的概念当自己的 |
| **Ravel** / *Ordering traces logically to identify lateness in message passing programs* | TPDS 2016 | 「谁在等谁」的归因（本文 P4 / A5）在 MPI 语境下的前作。**本文的 P4 主张必须说明相对它的增量** |
| **Traveler: Navigating Task Parallel Traces for Performance Analysis** | TVCG (IEEE VIS 2022) | 任务并行 trace 导航；方法论上是标准 design study，可作为本文 evaluation 设计的范本 |
| **Visualizing a Moving Target: A Design Study on Task Parallel Programs...** | TVCG (InfoVis '19) | design study 范本 #2 |
| **Visualizing the topology and data traffic of multi-dimensional torus interconnect networks** | IEEE Access, 2018 | 多维环面拓扑 + 流量，与 §0 那篇同系 |
| **Visualizing network traffic to understand the performance of massively parallel simulations**（Boxfish） | TVCG (InfoVis '12) | 5D 环面的多视图可视化；"投影到 2D 平面"的做法是本文 DP-5「宁缺毋误」要反对的对象 |
| **State of the art of performance visualization** | EuroVis '14 STAR | ⭐ **必引的综述**。写 Related Work 时先把这篇读透，它给出整个领域的地图 |
| **Recovering logical structure from Charm++ event traces** | SC15 | 逻辑结构恢复 |

> **风险提示**：Isaacs 一系已经把「并行执行的逻辑时间可视化」做得很深。
> 本文若把泳道/流水线那部分当作贡献点，会被这一系直接压住。
> **建议**：把泳道明确定位为"复用已有范式"，把贡献收紧到**静态结构侧**（谁持有什么、地址不是形状、异质维度不可投影）。

---

## 3. 可视化方法论（论文体例必需）

| 前作 | 出处 | 用在哪 |
|---|---|---|
| **A Nested Model for Visualization Design and Validation** · Munzner | TVCG (InfoVis '09) | ⭐ 本文 §3 Domain Characterization → §4 Design Principles → §5 IA 的推导链，正是 nested model 的 domain→abstraction→encoding 三层。**必引，且要明说自己落在哪几层** |
| **Design Study Methodology: Reflections from the Trenches and the Stacks** · Sedlmair, Meyer, Munzner | TVCG 18(12):2431–2440, 2012 (InfoVis '12) | ⭐ 九阶段框架（learn/winnow/cast/discover/design/implement/deploy/reflect/write）。本文若定位为 design study，必须按它的体例组织 |
| **The nested blocks and guidelines model** · Meyer, Sedlmair, Quinan, Munzner | Information Visualization, 2015 | nested model 的细化版；本文的 DP-1~5 本质上就是 "guidelines"，可以直接借它的术语 |

> **一条方法论上的自我诊断**：本仓目前是「先有本体论、后有实现」，
> 而 design study 的标准流程要求 **winnow/cast**（选对合作者与问题）与 **deploy/reflect**（真实部署与反思）。
> 本仓缺 deploy 与 reflect 这两阶段的证据——这正是 `paper-feasibility.md` 说的"零验证"在方法论上的准确表述。

---

## 3.5 ⭐ 可视化 linting 与「误导性可视化」分类学 —— A1–A8 的真正前作

这是本轮检索最重要的发现：**「把可视化错误做成可检测的判据」已经有一整条研究线。**
`paper-feasibility.md` 里说 A1–A8「可视化界少见」，这个说法需要**下调**——不是没有，是**层次不同**。

| 已有工作 | 做了什么 |
|---|---|
| 误导性可视化分类学 | 开放编码上千张被举报为误导的真实图表，归出 **74 类**问题 |
| 设计违规 + 推理错误的双层分类 | **14 条**：7 条可视化设计违规 + 7 条推理错误 |
| 欺骗性编码手法清单 | 截断轴、纵横比失真、双轴、反转轴、扭曲投影、数据-视觉不成比例、不当连续编码、不当类别编码 |
| 规则化 linting 系统 | 已能自动检测并推荐修正 |

**但关键的一句话给了本文位置**（检索结果原文）：

> current linting systems are only able to detect **"basic construction errors of visualization"**

也就是说：**已有 linting 只能查通用的、与领域无关的构造错误**（轴截断了没有、比例对不对）。
而本文的 P1–P4 是**领域语义错误**——

- P1「把 N:M 编码成 1:1」：linter 看不出来，因为它不知道并行维度与通信原语是 N:M
- P2「把 CP 当成卡网格第四轴」：linter 看不出来，因为它不知道 CP 切的是输入不是模型
- P3「rank 画成容器」：linter 看不出来，因为它不知道 rank 是地址不是容器
- P4「只画单卡时间线」：linter 看不出来，因为它不知道跨 rank 的相对关系才是归因依据

**⇒ 论文framing 应该改成这句话**：

> We extend visualization linting from **generic construction errors** to
> **domain-specific semantic encoding errors**, and show that in a domain with a rich enough
> ontology, correctness criteria can be made *decidable* (A1–A8) rather than merely advisory.

这个 framing 比原来的「可视化界很少有可判定判据」**强得多且更安全**：
它承认前人做过，并明确说出自己往前走了哪一步。审稿人最恨的是"没读过前人工作还宣称首创"。

**必须做的事**
- [ ] 精读那份 74 类分类学与 14 条双层分类，看 P1–P4 会不会被它们中的某几条覆盖
- [ ] 精读现有 linting 系统（如 VisuaLint / Draco 一系），确认"只能查构造错误"这个论断在 2026 年是否仍成立
- [ ] 如果 P3 已被"不当类别编码"之类覆盖，要重新论证 P3 的独立性

---

## 3.6 ⚠️ 一个已经存在的同类工具（非论文，但审稿人会问）

检索到一个**免费在线的 LLM 并行策略模拟器**，覆盖 DP / TP / PP / EP / SP，
带 GPU 网格布局、动画数据流、流水线气泡、AllReduce 通信、逐卡显存，
并内置真实配置（DeepSeek V3 的 TP=8·EP=8·PP=4、LLaMA-70B 多卡集群）。
另有 Meta 2025 年关于 TP/CP/EP 推理并行的工程博客、vLLM MoE 并行的可视化指南。

**这意味着什么**
1. 「六维并行需要可视化」这件事**已被市场验证**——这是好消息，说明问题真实
2. 但"我们做了个能画六维并行的工具"**不再是贡献**——工具本身不稀缺
3. **贡献必须收紧到那个模拟器做不到的事**：
   - 它有没有把 CP 与 DP 分开？（多半没有——多数工具把它们并列成轴）
   - 它把 rank 画成什么？（多半是格子/方块 = P3）
   - 它的通信原语是不是与维度绑死？（多半是 = P1）
   → **如果是，它就是 P1–P3 的第二个活体标本，比 MegaScale 更贴题**

**必须做的事**
- [ ] 实际打开这个模拟器，逐条对照 A1–A8 打分，作为论文的 baseline 对比对象
- [ ] 用它当误判率实验的对照组（比自建 MegaScale 复现更省事、更有说服力）

---

## 4. 系统侧（概念来源，必须引用而非重新发明）

参照系里大量内容是对下列系统既有语义的整理。**论文里每一条都要标明出处，否则会被判为把已知当原创。**

| 概念 | 出处 |
|---|---|
| TP（张量并行）、SP（Megatron 语义的序列并行） | Megatron-LM 系列论文 |
| PP（流水线并行）、1F1B、气泡率 | GPipe、PipeDream |
| ZeRO / 优化器态切分、权重-梯度-优化器态的 2:2:12 字节比 | DeepSpeed / ZeRO |
| CP（上下文并行）的两种实现 | Ring Attention（Ring/P2P 语义）、DeepSpeed-Ulysses（All-to-All 语义） |
| EP（专家并行）、MoE 路由、ETP、MoE Parallel Folding | GShard、Switch Transformer、以及各框架版本文档 |
| 自动并行策略搜索 | Alpa |
| 集合通信原语语义 | NCCL / HCCL 文档 |
| 训练负载配置（tp8·pp5·dp100·ep2 = 4000 rank） | Pangu Pro MoE, **arXiv:2505.21411** ✅ 已有可引出处 |

> **勘误 K/L/M 那几条**（SP 的两种语义、原语与维度是 N:M、EP 语义随框架版本变动）
> 是本文相对这些一手文档的**真增量**——因为它们恰恰是这些文档各说各话造成的。
> 写作时要把"谁在哪个版本里怎么说的"列成表，这一节会很有说服力。

---

## 5. 待补（下一轮）

- [ ] 精读 EuroVis '14 STAR，把本文放进它的分类体系
- [ ] 精读 C&G 2023 那篇（最接近的竞品），逐节对照写 delta
- [ ] 查 2024–2026 有没有更新的「LLM 训练可视化」工作（本轮检索止于 2024 的 MegaScale）
- [ ] 查高维数据投影/降维可视化的理论工作，支撑 DP-5「宁缺毋误」
- [ ] 查「可判定的可视化正确性判据」有没有前作——若有，A1–A8 的原创性要重新评估

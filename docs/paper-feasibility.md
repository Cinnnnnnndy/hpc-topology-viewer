# 论文编写与投递可能性评估

**评估日期** 2026-09-10
**评估对象（两个仓库合并看）**
- `Cinnnnnnndy/hpc-topology-viewer` —— 并行拓扑参照系 + PRD + 7 个可视化 pattern，约 17.2 万行
- `yinyucheng0601/compute-graph-viewer`（PTO 计算图工作台）—— 30+ 模块，847 个前端/脚本文件，约 72 万行，含 C++ 算法子工程与 7 份真实 Profiling 分析报告

**要回答的三个问题** ①够不够写 IEEE 论文 ②不投 IEEE 还有哪些去处 ③两个仓库合起来该怎么切题

---

## 0. 结论先说

**够，而且不止一篇。** 两个仓库合起来至少有 **5 个可独立成文的选题**，其中 3 个够得着正经场馆。

最关键的发现是**两个仓库恰好互补**：

| | hpc-topology-viewer | compute-graph-viewer |
|---|---|---|
| 概念框架 | ★★★★★ 参照系 + PRD + 可判定验收 | ★★ 散在各 SPEC/白皮书里 |
| 真实数据 | ✗ 零评测、零实测 | ★★★★★ **7 份 Ascend 910B 真实 Profiling 报告** |
| 量化结果 | ✗ | ★★★★ PycPlacer 有 C++ 实测加速比与 HPWL |
| 工程规模 | 中 | 大 |

> 单看 `hpc-topology-viewer`，"零验证"是**致命伤**；把 `compute-graph-viewer` 的真实报告接上来，
> 这一条从"致命"降级成"要整理"。这是本次评估最重要的一句话。

**但合规风险同步质变了**（见 §5）：`Analysis Report/` 里是 910B 上 Megatron-LM / verl / Pangu 2.0 Flash 的
真实实测数据——设备空闲率、MFU、AllReduce wait、HCCS 带宽利用率、跨节点 RDMA 小包比例。
**这类数字对外发表几乎必然需要走审批。合规现在是一号阻塞项，不是四号。**

---

## 1. 五个候选选题（按可发表性排序）

### ⭐ P-B · H-Anchor 分层锚点布局算法 —— 唯一自带量化结果的"硬"论文

**在哪** `compute-graph-viewer/PycPlacer/`

**是什么** 受 HNSW（分层可导航小世界图）启发的 VLSI 布局算法。C++ 核心 + OpenMP + pybind11，
三阶段：层次构建（带空间抑制的打分选点）→ 自顶向下力导向（变质量节点）→ Tetris 式合法化。

**已有的量化结果**（README 自报）
| | 速度 | 吞吐 |
|---|---|---|
| 纯 Python | 42 s | 79 cells/s |
| C++ 单线程 | 3.0 s | 1084 cells/s |
| C++ 多核 | **1.1 s** | **2907 cells/s** |

增量更新：3300 cell 全量 ~1.1 s vs 改 5 个 cell ~0.02 s，**50–100×**；且确定性可复现。

**为什么它排第一** 这是两个仓库里**唯一**已经有"数字 vs 数字"的东西。可视化论文最难的那一关（证明有用），
它天然就过了一半。而且「HNSW → 布局」的类比是个真新颖的框架，增量/ECO 布局本身是活跃子领域。

**缺什么（都是机械工作，不需要灵感）**
1. ❌ **基准选错了**。现在跑的是 ISCAS85/89、EPFL、MCNC、ITC99 —— 这些是**逻辑综合**基准（BLIF 网表），
   不是**布局**基准。EDA 审稿人会立刻指出：没有真实单元尺寸、没有固定宏、没有行结构。
   → 必须换成 **ISPD-2005/2006 placement contest**、**ICCAD-2004 IBM**、或 **ISPD-2015** 基准。
2. ❌ **没有 baseline 对比**。现在的 HPWL 只跟自己比（增量前 vs 增量后）。
   → 必须对上 **DREAMPlace**（GPU 解析式，事实标准）、**RePlAce**、**NTUplace3**，报 HPWL 差距 %。
   速度快但线长差 20% 是不能发的；速度快且线长差 <3% 才是论文。
3. ❌ 没有密度/合法化质量、可布通性（routability）指标。
4. ❌ 没有消融（层数、decimation factor、各力系数）。

**工期估计** 6–10 周（换基准 2 周 + 跑 baseline 3 周 + 消融 2 周 + 写作 3 周）

**去处**
| 场馆 | 档次 | 备注 |
|---|---|---|
| **IEEE/ACM ICCAD** | 顶会 | 需要 baseline 对比扎实 |
| **ACM/IEEE DAC** | 顶会 | 同上，更难 |
| **ASP-DAC**（IEEE/ACM，亚太） | 好会 | **最现实的第一目标**，亚太场，对新框架宽容 |
| **ACM ISPD** | 布局专门会 | 主场，但小而精，标准高 |
| **IEEE TCAD / ACM TODAES** | 期刊 | 滚动，适合把工作做透了再投 |

---

### ⭐ P-C · 昇腾真实训练/推理负载的性能画像与证据链诊断方法 —— 数据最独特

**在哪** `compute-graph-viewer/Profiling_Insight_and_Tool/`，尤其 `Analysis Report/` 下 7 份报告

**已有的真实材料**（这是别人拿不到的东西）
| 报告 | 场景 | 关键实测 |
|---|---|---|
| `ascend_analysis_verl_20260602` | verl RL 训练，910B rank0 | Rollout 生成占墙钟 88.5%，设备占用 37%，MAC 利用率 3.8%；27687 次 All-Reduce 累计 12.95 s，其中 **9.4 s 是 wait**，overlap 仅 0.32 s |
| `MultiProfLevel2MemoryUB_20260618` | Megatron-LM，2 节点 ×8 卡 = 16 rank | 单步 6.33 s；rank15 空闲 40.7%、`slowAffectCount=70`；8390 次在线算子编译；AICPU 融合算子占 40.4% 计算；HCCS 仅 ~54% 理论带宽；跨节点 RDMA **82% 是小包** |
| `eta_eager_l1_20260528` | 单卡 eager 推理 | NPU 仅 7.36% 墙钟在算，92.6% device idle；step 呈双峰（86.7 ms / 18.7 ms）而计算恒定 4.3 ms |
| `pangu2.0flash_20260715` 等 4 份 | Pangu 2.0 Flash 等 | 含 `evidence/`、`chart-data.json` |

**能立住的贡献**
1. **一套"证据链"诊断方法论**：每条结论都锚定到具体文件与字段（`step_trace_time.csv` / `kernel_details.csv` /
   `analysis.db` / `trace_view.json`），并指定"用哪个视图能看到它"。这套「问题 → 证据 → 改哪 → 哪个视图举证」
   的四元组，是可以形式化成方法贡献的。
2. **一个可复算的健康度评分**（计算/通信/调度/内存四档 → 0–100 分 + 优化后预估）。
3. **一批反直觉的实测结论**，每一条都是论文里的好素材：
   - eager 推理下 NPU 92.6% 空转 —— 瓶颈完全在 host 下发而非算力
   - RL 训练的墙钟被 rollout 而非 update 主导（88.5% vs 6.5%）
   - TP 融合算子静悄悄落到 AICPU 上，吃掉 40.4% 计算时间
   - `NonZero` 引发的 D2H 同步是"慢 step"的直接触发源，单次最高 72 ms
4. **一次公开的自我订正**（verl 报告里通信子项从 57% 下调到 33%，因为初版误用"逐 op 平均带宽"而非
   字节加权有效带宽）。**把这个写进论文的 methodology 章节是加分项**——它证明了口径的重要性。

**缺什么**
- ❌ 报告是给工程用的，不是论文体例：需要重组为 workload characterization 的标准结构
- ❌ 缺横向对比（同一负载在 GPU 上的对应数字），不然读者没有参照
- ❌ 缺可复现说明（哪个 CANN 版本、哪个 Megatron commit、采集配置）
- ⚠️ **合规风险最高的一块**（见 §5）

**工期估计** 4–8 周（假设合规过得了）

**去处**
| 场馆 | 档次 | 匹配度 |
|---|---|---|
| **IEEE IISWC**（Workload Characterization） | 好会 | ★★★★★ **天生就是给这种论文开的**。2026 届正刊截稿 2026-05-21 已过、poster 2026-08-03 已过；**2027 届预计 2027-05 截稿** |
| **IEEE ISPASS**（Performance Analysis of Systems & Software） | 好会 | ★★★★★ 同样对口。2027 届预计 2026-11~12 截稿，**须核对官网** |
| **SC "State of the Practice" track**（ACM/IEEE） | 顶会 | ★★★★ 专收这类实践经验论文 |
| **ProTools @ SC27**（VPA+ESPT 合并 workshop） | workshop | ★★★★ 门槛低，2026 届截稿 2026-08-10 已过，2027 届预计 2027-08 |
| **IEEE TPDS / IEEE Micro** | 期刊 | ★★★ IEEE Micro 对"新硬件的实测画像"很买账 |

---

### P-A · 并行拓扑可视化框架（"地址不是形状"） —— 概念最原创

**在哪** `hpc-topology-viewer` 的 `public/parallel-reference/`（20 节参照系）+ `docs/parallel-topology-prd.md`

**核心主张**
现有拓扑可视化犯四类**信息编码错误**（不是美观问题）：

| | 现象 | 本质 |
|---|---|---|
| P1 | 并行维度 ↔ 通信原语一一绑定 | 把 N:M 编码成 1:1（看到 All-to-All 就以为是 MoE，其实同样可能是 Ulysses CP） |
| P2 | CP 硬加成卡网格第四轴 | 混淆切分维与时间轴 |
| P3 | rank 画成容器 | **地址被当成了形状** |
| P4 | 只呈现单卡时间线 | 丢掉跨 rank 相对关系，归因方向反了 |

配 5 条设计原则（DP-1~5）、5 视图族 × 5 图层的正交 IA、以及 **A1–A8 八条可直接测的验收**
（例："在任一视图中找不到任何一个代表 rank 的几何体"）。

**为什么值钱** 可视化论文极少给出**可证伪的正确性判据**，绝大多数停在"更好看/更好用"。
一套负面结果驱动 + 可判定的设计规约，本身就是方法论贡献。
而且 P3 是一条**能推翻别人图**的硬主张——包括 MegaScale 那张被反复引用的 3D 图。

**独有的第二层** `rank-topology-3d.md` 的「第十层·载体」：一张卡同时挂在并行坐标 `(tp,cp,pp,dp,ep)`
与物理坐标 `(超节点,机柜,node,槽位)` 上，两套坐标的**交叉**决定这条边走 UB 还是 RoCE（带宽差一个数量级），
并给出一条可证伪的反直觉结论：

> 超节点内 node 边界不是降速点，换挡点是超节点边界。照直觉画成"node 内快、node 间慢"会画反。

**缺什么**
- ❌ 零用户研究、零专家访谈、零基线对比（全库 grep 确认）
- ❌ 零引用、零外链（参照系全文没有一条参考文献）
- ⚠️ 全中文且行文高度个人化（「五根轴」「刀」「宁缺毋误」「腔格」「门牌」），是**重写不是翻译**

**关键补救** PRD §11 自己就写了答案：

> 建议把**误判率**作为北极星指标。它是唯一能证明「结构正确」有价值的量化证据——
> 否则「不犯 P1–P4」这件事在评审里很难被看见。

**这句话原封不动就是审稿意见。** 实验设计现成：

```
被试   12–20 名有分布式训练经验的工程师
任务   每题对应一类结构性错误
       T1(P1) 给一段 All-to-All，判断来自 MoE 还是 Ulysses CP
       T2(P2) 给 CP=2/DP=2 配置，判断哪些卡持有同一份权重
       T3(P3) 指出"rank 5 里装着什么"这个问句的毛病
       T4(P4) 某卡 AllReduce 40 ms，指出该怀疑谁
       T5     加 DP 之后单卡显存变不变
基线   (a) 配置文件+框架文档  (b) MegaScale 式 3D 图（自建复现）  (c) 本工具
指标   误判率（主）、首次正确归因时长（次）、置信度自评
设计   被试内 + 拉丁方配平；McNemar / GLMM
工期   设计 3d + 招募 5d + 跑 5d + 分析 5d ≈ 3 周
```

**外加**：现在可以用 `compute-graph-viewer` 的真实报告做 **2 个案例研究**
（Megatron 16 卡那份的 rank15 空闲定位、verl 那份的 AllReduce wait 归因），
正好对应 P4「等待长的是受害者、等待短的是嫌疑人」。**这是两仓合并带来的最大增益。**

**工期估计** 3–5 个月

**去处** 见 §4 可视化圈那一栏（PacificVis / VIS / CG&A / C&G / Visual Informatics）

---

### P-D · PTO 工作台：面向 NPU 算子开发全链路的可视化工具集

**在哪** `compute-graph-viewer` 整体（30+ 模块）

**是什么** 从 Pass IR → 内存层级 → 执行泳道 → 精度调试 → 算子融合推荐 → 迁移助手 → 训练监控的一整条链路，
统一在一套设计系统（`pto-design-system` submodule）与模式库（`patterns.json`）之上。

**贡献形态** 这是"工具/系统论文"，卖点是**覆盖广度 + 设计系统一致性**，不是单点深度。
`design-system-dependency.md`、`whitepaper.md`（白皮书生成规范）、模式库那套 `pattern.html/css/js/json` 四件套，
本身就是一个可讲的"可视化组件治理"故事。

**缺什么** 广度型论文最容易被批"没有 evaluation、没有 novelty"。必须挑 2–3 个模块做深，其余作为背景。

**去处** IEEE CG&A（★★★★，14 页、对 evaluation 要求最轻）、**IEEE VISSOFT**（软件可视化，★★★☆）、
Visual Informatics（★★★★，作者免 APC）、SoftwareX（Elsevier，工具专刊）

---

### P-E · CUDA → AscendC 算子迁移的经验研究

**在哪** `ascendport_migration-pangu/`（Flash MLA 迁移）、`ascend-950-workbench-demo/feature_taxonomy.html`（A3→A5 差异分类）、
`Ascend operator matrix/`（算子支持矩阵）

**贡献形态** 迁移经验论文（experience paper）：一套 A3→A5 的差异分类学 + 一个真实算子（Flash MLA）的分阶段迁移记录。

**去处** IEEE Cluster / CCGrid / HiPC（★★★）、ACM PPoPP 的 practice track、IEEE Micro（★★★）
**但**：这一块的合规敏感度最高（涉及未发布代际的硬件差异），建议**最后再考虑**。

---

## 2. 相关工作：躲不开的三篇（针对 P-A）

**目前最大的知识盲区**——两个仓库加起来，参照系全文 0 条外部引用。

| 前作 | 出处 | 它做了什么 | delta |
|---|---|---|---|
| **Visual Diagnostics of Parallel Performance in Training Large-Scale DNN Models** | IEEE **TVCG** 2023 | 大模型并行训练的性能诊断可视化 | 它做**性能**诊断，P-A 做**结构**正确性；它 3D 并行，P-A 六维；P-A 有物理载体层 |
| **Interactive visual analytics of parallel training strategies for DNN models** | Computers & Graphics 115 (2023) 392–403 | 计算图 + 通信算子双部图，辅助并行策略选择 | 最接近的一篇。它从**计算图**侧切入，P-A 多了 rank 侧反查、地址/容器分离、物理侧 |
| **MegaScale** 的 3D 并行可视化 | USENIX **NSDI** 2024 | 万卡训练系统，附 3D 并行拓扑 + 选中 worker 看逻辑位置 | 它是系统论文的一个组件、无设计论证；**正好当 P3 的活体标本** |

> **战术建议**：拿 MegaScale 那张被大量引用的图当 P1–P4 的标本开场，比抽象讲原则有力得多。
> 措辞走"我们据此提炼出可判定判据"，不要走"他们画错了"。

**还要补的第二圈**（30–40 条）：
- 可视化方法论：Munzner nested model / task abstraction；Sedlmair et al. design study methodology
- 系统侧：Megatron-LM、DeepSpeed/ZeRO、GPipe/PipeDream、Alpa、Ring Attention、DeepSpeed-Ulysses、GShard、NCCL/HCCL
- HPC 性能可视化：Vampir、Paraver、Traveler、Chakra、Perfetto/HTA
- P-B 专属：HNSW、RePlAce、DREAMPlace、NTUplace3、ePlace、ISPD/ICCAD contest 系列

---

## 3. 合规与形制：四道闸

### 闸 1 ⚠️ 对外披露合规 —— **一号阻塞项**

两个仓库都在用行动说明"这些东西现在不打算被公开检索"：

- `hpc-topology-viewer/src/content.ts`：产品/品牌名以 base64 存储、运行时 `dc()` 还原，明写目的是"仓库 grep 找不到"
- `hpc-topology-viewer/public/robots.txt`：`Disallow: /` 全站禁爬；`index.html` 挂 `noindex`
- `compute-graph-viewer`：**无 LICENSE 文件**；多份文档含内部口径与未公开代际信息

**而投稿的定义就是永久公开 + 可检索 + 进 Xplore/DL。** 冲突是直接的。

新增的、比上一版严重得多的一条：`Analysis Report/` 里是**真实机器上的真实实测**——
910B 的 HCCS 带宽利用率、跨节点 RDMA 小包比例、Pangu 2.0 Flash 的 step 分解、verl/Megatron 的设备空闲率。
这类数字通常属于需要审批的范畴。

**必须先做的事**
- [ ] 走所属单位**对外发表审批**。这一步没过，后面全白做
- [ ] 明确 `compute-graph-viewer` 的 LICENSE（现在没有 = 默认保留全部权利 = 不可复用）
- [ ] 每个技术数字回溯到**可引用的公开来源**（UB 196 GB/s、RoCE 400 Gbps、CloudMatrix384 的 8 NPU/node、
      48 node/超节点等）；引不到公开出处的，要么删，要么显式标 `assumed, for illustration only`
- [ ] `rank-topology-3d.md` 里"待灵衢团队确认"说明存在**内部信息渠道**——要么拿授权，要么整段换公开白皮书口径
- [ ] Pangu Pro MoE 有 arXiv:2505.21411 可引，这块安全
- [ ] **artifact 可访问性冲突**：多数场馆鼓励提供可访问 demo/代码，而站点现在 `Disallow: /`

**去实体化预案（建议默认按这条走）**
> 删掉所有具体型号与带宽，改写成「一个具备两级带宽层级的加速器集群（tier-1: 非阻塞域内互联，
> tier-2: 跨域 RDMA，带宽差约一个数量级）」的抽象模型；实测数字改为**归一化相对值**（如"HCCS 达到理论带宽的 54%"
> 保留，绝对 GB/s 去掉）。学术价值损失约 20%，合规风险大幅下降。

**P-B 是唯一基本不受这条影响的选题**——H-Anchor 是通用布局算法，跟昇腾无关。这也是它排第一的另一个理由。

### 闸 2 · 署名与合作

两个仓库两个维护者（`Cindy_wxd` / `Yin Yucheng`），且已经互相 vendored：
`compute-graph-viewer/hpc-topology-viewer-main/` 是前者的拷贝，
`hpc-topology-viewer/public/combo-workbench/swimlane.html` 自称是后者 `pangu-moe-trainviz/` 的上游拷贝。

**动笔前必须先谈定作者顺序与各自贡献边界。** 这不是形式问题——合作论文的作者纠纷是最常见的撤稿原因之一。

### 闸 3 · 引用体系

见 §2。不是"补几条参考文献"，是**重新把自己放进坐标系**：参照系现在是"从零推导"的姿态，
论文不接受，每条结论都要说明是复述已知还是新主张。估 2 周精读 + 1 周改写。

### 闸 4 · 语言与文体

全中文，且高度个人化。术语要换成学界通用：

| 仓库用词 | 论文用词 |
|---|---|
| 刀 / 落刀 | partition dimension / applied partitioning |
| 载体 | transport fabric |
| 腔格 | intersection cell |
| 门牌 | label / annotation |
| 宁缺毋误 | omit-rather-than-approximate（作为正式 design principle 命名保留） |

> 「宁缺毋误」值得**保留原意并起正式英文名**——它是招牌主张之一，不该被翻译稀释。

### 闸 5 · AI 使用披露与可复现性

- 两仓都有大量 AI 辅助生成的痕迹（`CLAUDE.md`、`AGENTS.md`、`.learnings/`、`research/local_*/`）。
  IEEE/ACM 现行政策要求披露生成式 AI 的使用范围。不影响可投性，但要提前写好。
- `hpc-topology-viewer`：`/patterns/*` 是发布流水线产物、仓库里没源文件，`scripts/` 被 gitignore。
- `compute-graph-viewer`：无统一构建、依赖 submodule。
- → 投稿前需要一条干净的「clone → build → 看到论文里那张图」路径，否则 artifact evaluation 直接挂。

---

## 4. 场馆总表

> ⚠️ 除标注「已核对」外，日期均需在投稿前到官网 CFP 复核。

### 4.1 IEEE 侧

| 场馆 | 截稿 | 适配选题 | 匹配度 |
|---|---|---|---|
| **IEEE PacificVis 2027** Conference Track | **2026-11-08**（通知 12-15，会期 2027-04-19 釜山，**已核对**） | P-A | ★★★★☆ **当下唯一够得着的可视化窗口** |
| **IEEE PacificVis 2027** VisNotes（短文 ~4 页） | 同上 | P-A | ★★★★★ 长文跑不动就降到这里，别空手 |
| **IEEE ISPASS 2027** | 预计 2026-11~12（**须核对**） | P-C | ★★★★★ 性能分析主场 |
| **IEEE IISWC 2027** | 预计 2027-05（2026 届为 05-21，**已核对**，已过） | P-C | ★★★★★ 负载画像主场 |
| **IEEE/ACM ICCAD 2027** | 预计 2027-05 | P-B | ★★★★ 顶会，需 baseline 扎实 |
| **ASP-DAC 2027**（IEEE/ACM） | CFP 已开（**须核对具体日期**） | P-B | ★★★★☆ **P-B 最现实的第一目标** |
| **IEEE VIS 2027 / TVCG** | 预计 2027-03（VIS 2026 为 abstract 03-21 / full 03-31） | P-A | ★★★★★ 最高回报，design study 正宫 |
| **IEEE CG&A**（杂志） | 滚动，≤14 页/8000 词，参考文献不限（**已核对**） | P-A / P-D | ★★★★☆ **对 evaluation 要求最轻** |
| **IEEE TCAD** | 滚动 | P-B | ★★★★ 做透了再投 |
| **IEEE Micro** | 滚动/专刊 | P-C / P-E | ★★★ 对新硬件实测画像买账 |
| **IEEE VISSOFT** | 约每年 6 月 | P-D | ★★★☆ |
| **ProTools @ SC27**（VPA+ESPT 合并） | 预计 2027-08（2026 届 08-10，**已核对**，已过） | P-C / P-A 的物理层 | ★★★★ 门槛低，10 页双栏 |
| **IEEE Access** | 滚动约 6–8 周，APC 约 $2045 | 任意 | ★★☆ **保底，别处全挂了才用** |

### 4.2 非 IEEE 侧（回答"不投 IEEE 还能去哪"）

**可视化圈**

| 场馆 | 出版方 | 截稿 | 适配 | 评价 |
|---|---|---|---|---|
| **Computers & Graphics** | Elsevier | 滚动 | P-A / P-D | ★★★★★ **强烈推荐**——竞品之一就发在这，审稿人天然懂题面 |
| **Visual Informatics** | Elsevier + 浙大 | 滚动 | P-A / P-D | ★★★★★ **补贴型 OA，作者免 APC**，性价比最高 |
| **EuroVis 2027** | Eurographics / Wiley CGF | full paper 约 2026-12（workshop proposal 已定 2026-10-12） | P-A | ★★★★☆ 与 VIS 同档 |
| **Graphics & Visual Computing** | Elsevier（C&G 的 OA 姊妹刊） | 滚动 | P-D | ★★★☆ 介绍期 Elsevier 代付 APC，作者免费 |
| **Journal of Visualization** | Springer | 滚动 | P-A | ★★★ |
| **VINCI** | ACM | 约每年 3–4 月 | P-D | ★★★ 小而专，适合练手 |

**系统 / EDA 圈**

| 场馆 | 适配 | 评价 |
|---|---|---|
| **ACM ISPD** | P-B | ★★★★ 布局主场 |
| **ACM TODAES** | P-B | ★★★★ 期刊，滚动 |
| **ACM PPoPP practice / EuroSys / SoCC** | P-C / P-E | ★★★ 需要更强的系统贡献 |
| **MLSys** | P-C | ★★★☆ 若能把诊断方法做成可复用工具则合适 |
| **SoftwareX**（Elsevier） | P-D | ★★★★ 工具论文专刊，门槛友好、见刊快 |

**HCI 圈**

| 场馆 | 适配 | 评价 |
|---|---|---|
| **ACM CHI 2027** Papers | P-A | ★★★ 只有误判率实验做到大样本 + 严谨统计才值得试 |
| **ACM CHI LBW / UIST Poster** | P-A | ★★★★ 4 页低成本占坑 |

**中文场馆（不用重写语言，成本最低）**

| 场馆 | 评价 |
|---|---|
| **《计算机辅助设计与图形学学报》** | ★★★★★ CCF 推荐中文 A 类（图形学/可视化中文顶刊），**中文直接投，闸 4 整关消失** |
| **《软件学报》/《计算机学报》** | ★★★★ CCF 推荐中文 A 类，偏系统/软件视角 |
| **ChinaVis** | ★★★★ 约每年 4 月投稿，**最适合第一次投稿练手** |

> **认真考虑**：如果闸 1 合规注定难过（涉及国产芯片互联与实测细节），
> **中文期刊 + 国内场馆反而是更顺的路**——审批链条短、涉密判定标准明确、不必披露到 Xplore。

**arXiv 预印本** —— 零门槛、立刻拿时间戳（cs.DC / cs.HC / cs.AR）。
**但必须排在闸 1 之后**：上了 arXiv 就撤不干净。

---

## 5. 推荐组合

### 🥇 主线（推荐）· 双轨并行

```
轨道一（不受合规限制，先跑）
  P-B / H-Anchor
  ─▶ 换 ISPD-2005/2006 基准（2 周）
  ─▶ 对上 DREAMPlace / RePlAce 基线，报 HPWL 差距（3 周）
  ─▶ 消融 + 增量更新专门实验（2 周）
  ─▶ 写作（3 周）
  ─▶ 投 ASP-DAC 2027 / ICCAD 2027；退路 TCAD / TODAES 滚动

轨道二（合规先行）
  闸 1 审批（立刻启动，与轨道一并行）
  ─▶ 过了 ─▶ P-C（IISWC 2027 / ISPASS 2027）
  ─▶ 没过 ─▶ 去实体化改写 ─▶ P-A 投 C&G / Visual Informatics / 中文期刊
```

**为什么这样排**：P-B 是唯一**既有量化结果又无合规风险**的选题，应该第一个出手；
合规审批周期不可控，让它跟 P-B 并行跑，不阻塞产出。

### 🥈 若只想做一篇、且要最快见刊

```
P-A 去实体化 ─▶ 补 §2 相关工作 ─▶ 用 compute-graph-viewer 的两份真实报告做案例
           ─▶ 不做用户实验 ─▶ 投 IEEE CG&A 或 Computers & Graphics（滚动，无 deadline 压力）
```

### 🥉 若想抢 2026-11-08 那个窗口（59 天，激进）

```
P-A ─▶ 合规（1 周）─▶ 相关工作（2 周）─▶ 误判率实验（3 周，部分重叠）
    ─▶ 英文重写（2 周）─▶ 投 PacificVis 2027 Conference Track
    ─▶ 跑不完降级投同期 VisNotes
```
**风险**：单人 59 天做完用户实验 + 全文英文重写非常紧；合规卡住则全盘停摆。

---

## 6. 论文骨架

### P-B · H-Anchor（ASP-DAC / ICCAD 形制，8–9 页）

**拟题** *H-Anchor: Hierarchical Anchor-Based Placement with Fast Incremental Updates, Inspired by Navigable Small-World Graphs*

| 章节 | 素材 | 状态 |
|---|---|---|
| 1 Introduction | 增量/ECO 布局的痛点 | 待写 |
| 2 Related Work | 解析式布局（ePlace/RePlAce/DREAMPlace）、多层次布局、HNSW | ❌ 缺 |
| 3 H-Anchor Algorithm | `src/h_anchor_core.cpp` 三阶段 | ✅ 有 |
| 4 Incremental Update | `update_positions` + propagation_radius | ✅ 有 |
| 5 Implementation | C++/OpenMP/pybind11 | ✅ 有 |
| 6 Experiments | **换 ISPD 基准 + DREAMPlace 基线 + 消融** | ❌ **核心缺口** |
| 7 Conclusion | | 待写 |

### P-C · 昇腾负载画像（IISWC / ISPASS 形制，10–11 页）

**拟题** *Characterizing LLM Training and Inference on a Domain-Specific NPU Cluster: Seven Real-World Profiling Case Studies*

| 章节 | 素材 | 状态 |
|---|---|---|
| 1 Introduction | | 待写 |
| 2 Background | Ascend 910B / CANN / HCCL 架构（**公开口径**） | 部分有 |
| 3 Methodology | 证据链四元组 + 健康度评分 + **口径订正那一段** | ✅ 有，质量高 |
| 4 Case Studies | 7 份报告重组（eager 推理 / verl RL / Megatron 16 卡 / Pangu Flash） | ✅ **有真实数据** |
| 5 Cross-cutting Findings | host 下发瓶颈、AICPU 静默回退、小包 RDMA、通信不重叠 | ✅ 有 |
| 6 Implications | 对框架与运行时的建议 | 部分有 |
| 7 Threats to Validity | 单次采集、版本绑定、合规删节 | ❌ 缺 |

### P-A · 并行拓扑可视化（CG&A / PacificVis 形制）

**拟题** *Address Is Not Shape: A Structurally Faithful Visualization Framework for Six-Dimensional Parallelism in Large-Model Training*

| 章节 | 素材 | 状态 |
|---|---|---|
| 1 Introduction | PRD §1.1 四类错误 + MegaScale 图作标本 | ✅ 有 |
| 2 Related Work | —— | ❌ **全缺** |
| 3 Domain Characterization | 参照系 §00–§08 | ✅ 有，需压缩 |
| 4 Design Principles | PRD §4 DP-1~5 | ✅ 有，需正式命名 |
| 5 Information Architecture | PRD §5 五视图族 × 五图层 + §8 视觉编码 | ✅ 有 |
| 6 System | 各 pattern + 物理载体层 | ✅ 有 |
| 7 Evaluation | 误判率实验 + **2 个来自 compute-graph-viewer 的真实案例** | ⚠️ 案例有了，实验缺 |
| 8 Limitations | 参照系 §20 + 各 pattern 的"约束与不适用" | ✅ 有，质量很高 |

> 素材侧 P-A 已完成 6/9 章、P-C 已完成 4/7 章。这是本次评估最乐观的结论：
> 缺的都是**有明确做法、可排期**的工作，不是需要灵感的工作。

---

## 7. 行动清单

**立刻（本周）**
- [ ] 启动闸 1 对外披露审批 —— 唯一一条**不做完就全白做**的前置
- [ ] 与 `compute-graph-viewer` 维护者谈定署名与贡献边界
- [ ] 给 `compute-graph-viewer` 补 LICENSE
- [ ] 选主线（建议：P-B 与合规审批双轨并行）

**1 个月内**
- [ ] P-B：换 ISPD-2005/2006 基准，跑通 DREAMPlace 对照
- [ ] P-A/P-C：补相关工作与 30–40 条引用
- [ ] 打通两仓各自的「clone → build → 出图」可复现路径

**3 个月内**
- [ ] P-B 成文，投 ASP-DAC / ICCAD
- [ ] P-C 的 7 份报告重组为 workload characterization 体例
- [ ] P-A 英文重写 + arXiv 预印本

**6 个月内**
- [ ] P-A 误判率实验（n≥16），冲 VIS 2027 / TVCG
- [ ] P-C 投 IISWC 2027 / ISPASS 2027

---

## 附录 · 事实来源

- PacificVis 2027 会期与地点：<https://pacificvis2027.github.io/>；截稿 2026-11-08 / 通知 2026-12-15 来自会议聚合站，**投稿前须以官网 CFP 为准**
- IEEE VIS 2026 投稿指南（用于推算 2027 档期）：<https://ieeevis.org/year/2026/info/call-participation/paper-submission-guidelines/>
- ProTools 2026 @ SC26（VPA + ESPT 合并）：<https://sc-protools-workshop.github.io/protools26/>
- IISWC 2026 CFP 与日期：<https://iiswc.org/iiswc2026/cfp.html>
- ISPASS 2026 投稿页（用于推算 2027 档期）：<https://ispass.org/ispass2026/submission.php>
- ASP-DAC 2027 CFP：<https://www.aspdac.com/aspdac/cfp2027/>
- IEEE CG&A 作者须知：<https://www.computer.org/csdl/magazine/cg/write-for-us/15470>
- Visual Informatics 开放获取政策（浙大补贴、作者免 APC）：<https://www.elsevier.com/journals/visual-informatics/2468-502X/open-access-journal>
- Graphics & Visual Computing 开放获取政策：<https://www.elsevier.com/journals/graphics-and-visual-computing/2666-6294/open-access-journal>
- 竞品 1：*Visual Diagnostics of Parallel Performance in Training Large-Scale DNN Models*, IEEE TVCG 2023 — <https://ieeexplore.ieee.org/iel7/2945/10576039/10041726.pdf>
- 竞品 2：*Interactive visual analytics of parallel training strategies for DNN models*, Computers & Graphics 115 (2023) 392–403 — <https://dl.acm.org/doi/10.1016/j.cag.2023.07.030>
- 竞品 3：*MegaScale*, USENIX NSDI 2024 — <https://www.usenix.org/system/files/nsdi24-jiang-ziheng.pdf>
- 训练负载出处：Pangu Pro MoE, arXiv:2505.21411
- 仓库内证据：`PycPlacer/README.md`（加速比与基准清单）、`Profiling_Insight_and_Tool/Analysis Report/*/report.md`（7 份实测报告）、`docs/parallel-topology-prd.md`、`public/parallel-reference/index.html`

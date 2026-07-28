# net-sharding pattern（整网切分 · rank 装载 · 独立迭代）

以**模型计算图**为坐标系理解 rank 的 pattern。独立迭代入口：**`public/net-sharding-pattern.html`**
（`npm run dev` 后访问 `/hpc-topology-viewer/net-sharding-pattern.html`）。
控制台暴露 `window.ns` 句柄可直接调 API。

| file | what it is |
|---|---|
| `pattern.json` | **设计系统契约**（同 `rubik-cube` / `memory-architecture` 约定）：id/type/描述、来源、`useWhen`、`requiredApis`、`layoutRules`、允许与禁止的覆盖、`integrationHooks`、`agentReuseRule`。改动或复用前先读它。 |
| `pattern.js` | 切分规格表 `SHARD` + 纯数据层 `createModel(config)` + DOM/SVG 渲染层 `mount(container, opts)`。无 Three.js 依赖。 |
| `pattern.css` | pattern 独有的样式（维度签名色、装载卡、分片状态流水带、整网图上的切分标记）。控件本身复用设计系统的 `.btn` / `.panel-shell` / `.stat-chip`。 |

## 先说清楚「整网」是哪一个

本仓库里「整网」同时指两样东西，**本 pattern 说的是第一种**：

| | 是什么 | 谁在画 |
|---|---|---|
| **整网图** ← 本 pattern | **模型计算图**：openPangu 的 Model → DecoderLayer → Attention/MoE → 算子 DAG | `model-graphviz` pattern · `WholeNetGraph.tsx` · 本 pattern |
| 物理整网 | 机房互联拓扑：Die→NPU→Host→Pod→池→集群 + 三张网 | `PlaneView.tsx` · `FullPodScene` · `cube-cockpit.html` 物理形态 |

## 它回答什么（和逻辑魔方的分工）

逻辑魔方（`rubik-cube`）的坐标系是**并行超立方**，卡是主体，答「谁和谁一组」。
本 pattern 的坐标系是**模型本身**，算子是主体，答「整网被切开之后，这个 rank 装了什么」。
两者是同一批 p 的两种读法，互为反查。

具体三件事，缺一不可，同屏才成立：

1. **每个算子被哪个维、沿张量的哪根轴切开** —— 切分规格表 `SHARD`（55 个节点逐条标注）；
2. **每个 rank 因此持有哪一片** —— `payloadOf(rank)`：层段 / 注意力头片 / FFN 中间维 / 词表片 /
   专家桶 / 上下文段 / 序列片 / 数据副本；
3. **HCCL 集合原语 = 分片状态的转换器** —— `flowOf()`：一个 decoder layer 走一遍，
   每一步给出此刻张量处于什么分片状态、是哪个原语把它搬过去的。

第 3 条是「算子的输入输出 × attention/MoE × HCCL 算子」三者关系的正面回答：
集合通信不是附加在计算旁边的东西，**它就是分片状态发生改变的那一步**。

## 与 `graph-meta.ts` 的 `NODE_DIM` 是细化关系，不是替代

现有 `src/vendor/model-graphviz/graph-meta.ts` 用启发式 `deriveDim()` 给每个算子贴**一个**维
（tp/pp/dp/ep），够用来做整网图 ↔ 魔方的着色联动。但它答不了两件事：**切的是哪根轴**、
**我这张卡持有哪一片**；而且**没有 CP/SP**——长上下文与 norm 区的切分在那份标签里根本不存在。

本 pattern 把标注升级为 `{维, 轴, 份数, 本 rank 持有区间}`，并补上 CP/SP 两维。
两处若对同一算子给出不同的维，以 `pattern.json` 的 `agentReuseRule` 为准：本文件优先，并回补 `graph-meta.ts`。

## 六个维度各切什么

| 维 | 切的对象 | 张量轴 | 典型算子 | 集合原语 |
|---|---|---|---|---|
| **TP** 张量并行 | 单层权重 | head / hidden / ffn / vocab | QKV 投影 · o_proj · dense_gate_up · lm_head | AllReduce / AllGather / ReduceScatter |
| **CP** 上下文并行 | 上下文长度 | ctx（KV 段） | attention_core · key/value_tensor | AllGather(KV) |
| **SP** 序列并行 | 序列 token | seq | 各 RMSNorm（norm 不改变特征维 → 沿 token 切最省显存） | AllGather / ReduceScatter |
| **PP** 流水并行 | 模型层 | layer | decoder_layer（stage 边界） | P2P Send/Recv |
| **EP** 专家并行 | MoE 专家 | expert | routed_expert_bank · expert_bank_weights | AllToAll dispatch/combine |
| **DP** 数据并行 | 数据批次 | batch | 整模型复制 | AllReduce（梯度） |

**判据不是「这个算子长什么样」，而是它的权重/激活的哪根轴上有可分的份数**：
线性层按输出维列切 / 按输入维行切（**行切的输出是 partial sum，必须归约才完整**——
`o_proj` 与 `dense_down` 都是，画面上会显式标出来）；norm 与逐元素不改变特征维，
沿 token 切最省显存，这正是 SP 的存在理由；MoE 专家 bank 沿 expert 轴切，
token 要先 AllToAll 送到专家所在的卡。

## rank 分解与两条容易搞错的约定

```
tp = k % TP · cp = ⌊k/TP⌋ % CP · pp = ⌊k/(TP·CP)⌋ % PP · dp = ⌊k/(TP·CP·PP)⌋
rank 总数 = TP × CP × PP × DP
```

**CP=1 时与仓库现有约定（`data.ts` 的 `parallelMap`）逐位相同**——本 pattern 是它的推广，
不是另起一套。两条约定值得单独说，因为反直觉：

- **SP 不进乘法**：序列并行复用 TP 组（Megatron 口径，与 `data.ts`「SP 与 TP 同域」一致）。
  把 SP 建成独立的 rank 维会让总数凭空乘一遍 TP。
- **EP 不进乘法**：EP 折入 DP 轴，`ep = dp % EP`，相邻 EP 个副本构成一个 AllToAll 域。
  与逻辑魔方的口径一致，只要求 `ep` 整除 `dp`。

**SP 的分片在 CP 段之内再切一次**：先按 CP 把序列切成段，段内再按 TP(=SP) 切成 token 片。
所以 `spTokens ⊂ ctx`，两者不是平行的切法。（实测：seq 4096 · CP2 · TP8 →
本 rank 上下文段 `tok 0–2047`，其中 norm 区序列片 `tok 0–255`。）

## URL 即状态

```
…/net-sharding-pattern.html?tp=8&cp=2&pp=5&ep=2&dp=50&rank=2000&dim=ep&node=routed_expert_bank&theme=light
```

| 参数 | 取值 |
|---|---|
| `tp` `cp` `pp` `ep` `dp` | 并行度（给几个改几个）。`ep` 不整除 `dp` 时整组退回默认，不报错 |
| `rank` | 直接选中某个 rank |
| `node` | 直接选中整网图上的某个算子（id，如 `routed_expert_bank`） |
| `dim` | `tp`/`cp`/`sp`/`pp`/`ep`/`dp` —— 高亮被该维切开的算子，其余压暗 |
| `layers` `heads` `experts` `seq` | 模型规格 |
| `theme` | `light` / `dark` |
| `v` | 版本戳，页面忽略它，只用来跳过缓存 |

不认识的参数一律忽略，非法值退回默认，不报错。

## 与整网图 / 逻辑魔方的挂点

- `opts.onSelectRank(rank, payload)` —— 选中 rank 反抛宿主：可驱动魔方 `handle.select(rank)`，
  于是「魔方里选中的那张卡装了什么」两屏同时成立；
- `opts.onSelectNode(nodeId, dim)` —— 选中算子反抛宿主：可驱动魔方按该维重着色
  （与 cockpit `onPickNode` → `S.lens` 同一条联动）；
- `handle.selectRank / selectNode / highlightDim / setConfig` —— 反向受控；
- postMessage 桥（与 `rubik-pattern.html` 同一套约定）：收 `net-sharding-cmd`
  `{rank,node,dim,config}` 与 `net-sharding-theme`，回报 `net-sharding-rank` /
  `net-sharding-node` / `net-sharding-theme`。宿主可直接 iframe 嵌入。

## 已知缺口（诚实标注，不假装完整）

- **切分规格是静态标注，不是从框架产物解析出来的**。真实作业的切分由 MindSpeed/Megatron 的
  并行配置与 `ranktable` 决定；本 pattern 的 `SHARD` 是按 openPangu 图与公开的并行实践写死的，
  换一个模型要重写这张表。要做成数据驱动，接入口是 `ingest.ts` 的 `JobConfig`。
- **EP 的 token 负载不均没有表达**。AllToAll 的真实代价取决于路由后每个专家收到多少 token
  （热专家会拖慢整个域），目前只画「按专家切成几份」这个结构事实，不画负载。
- **CP 的 attention 掩码语义没有展开**。因果注意力下 CP 各 rank 的计算量本就不均
  （后面的 chunk 要看前面全部），这里只表达上下文被切成段。
- **一个算子只用主导维着色**。被多维同时切的算子（如 `attention_core` 同时被 TP 与 CP 切）
  在图上只显示最内层那一维的签名色，完整切分在右侧装载卡里给全。

Provenance：整网图取自 `public/vendor/model-graphviz/graph.js`（`window.OPENPANGU_GRAPH`，
openPangu-2.0-Flash，55 节点 / 61 边 / 5 cluster）；rank 分解与并行落位口径对齐
`src/scene/data.ts` 的 `parallelMap` 与 `src/scene/deployment.ts` 的 `sliceOf` /
`stageLayerRange`；真实并行策略取自 `data/ascend-workload-pangu-moe.json`
（盘古 Pro MoE：TP8 · EP2 · PP5 · 4K NPU）。既有代码未改动。

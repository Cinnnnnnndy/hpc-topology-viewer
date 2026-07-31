# HPC Topology Viewer

Interactive 3D viewer for a large-scale HPC accelerator cluster — racks, compute
nodes, and the interconnect fabric — built with **React + Three.js**
(`@react-three/fiber` + `@react-three/drei`). Geometry is **procedural by
default**, with an **optional open-source GLB swap layer**: drop a correctly
named `.glb` into `src/scene/models/` and the matching part (NPU module, CPU,
blade, cabinet, DIMM, optic, DPU, PSU, CDU, switch line-card) renders the real
model instead — no code edits, automatic fall-back if absent. See
[`src/scene/models/README.md`](src/scene/models/README.md) for the part list and
download guide.

## Views

- **Overview** — 16 cabinets (12 compute + 4 switch) with inter-cabinet optical links.
- **Cabinet** — drill into one cabinet: power shelf, management blade, compute nodes, liquid-cooling manifold.
- **Node** — a compute blade (accelerators, CPUs, on-board L1 switch chips, DPU, optics) and the on-board switch device.
- **Topology** — two-tier non-blocking Clos: all compute cabinets → 7 switch planes → cross-node RDMA / VPC planes, with hover-to-highlight uplinks.

Every interactive element shows a hover tooltip. The seven recurring colors map to
the seven independent switch planes (each plane is its own non-blocking fabric).

## Rubik-cube pattern（逻辑魔方 · 独立迭代）

The cockpit's 逻辑魔方 (5 形态重排 · 轴标注 · 正交 2D/剖面 · 四维通信组) is also
extracted as a standalone, parallelism-configurable pattern for independent
iteration — default **TP8×PP5×DP100 = 4000 ranks**, Pangu Pro MoE's real
training strategy (EP2 folded into DP). Entry page:
`public/rubik-pattern.html` (dev: `/hpc-topology-viewer/rubik-pattern.html`);
sources & docs: [`public/vendor/rubik-cube/`](public/vendor/rubik-cube/README.md).
Integration hooks for the whole-network graph / expert graph are pre-wired
(`selectLayer` / `selectBucket` / `onSelect`).

## 整网切分 · rank 装载（net-sharding · 独立迭代）

与逻辑魔方并列的第二个独立 pattern，坐标系是**模型计算图**而不是并行超立方：把 openPangu
整网图的每个算子标注成「被哪个并行维、沿张量的哪根轴切成几份」，据此算出任意一个 rank
到底装了什么（层段 / 注意力头片 / FFN 中间维 / 词表片 / 专家桶 / 上下文段 / 序列片 / 数据副本），
并把 **HCCL 集合原语呈现为分片状态的转换器**——AllGather / ReduceScatter / AllToAll /
AllReduce / P2P 各自把张量从一种分片状态搬到另一种。支持 6 维 **TP·CP·SP·PP·EP·DP**
（CP/SP 是现有 `NODE_DIM` 四维标签所没有的）。默认盘古 Pro MoE 真实策略
tp8·pp5·dp100·ep2 = 4000 rank。入口页：`public/net-sharding-pattern.html`
（dev: `/hpc-topology-viewer/net-sharding-pattern.html`）；
sources & docs：[`public/vendor/net-sharding/`](public/vendor/net-sharding/README.md)。

魔方答「谁和谁一组」，它答「这一组各自装了什么」——两者互为反查，
挂点见 `pattern.json` 的 `integrationHooks`。

## 并行拓扑 · 参照系 / PRD / Demo（三条独立链接）

`public/parallel-topology/` 放同一套概念的三个层次，互不影响。两份文档各自单文件
自包含；Demo 是**应用形态**的整页工具（与逻辑魔方 / net-sharding pattern 同一壳形制），
复用 `public/vendor/pto-design-system/` 的 token（样式表缺失时所有 `var()` 自动回退，
单文件打开仍可用）：

| 链接 | 是什么 |
|---|---|
| `/parallel-topology/concept-map.html` | **《分布式训练参照系 —— 五根轴 · 两个对象 · 三组坐标》**：术语、基数、切分、映射、通信、编号、运行时的完整参照系，配可交互示意图与勘误 |
| `/parallel-topology/prd.html` | **《并行拓扑可视化工具 PRD》v0.1**：把参照系直接落成信息架构——四类结构性错误、五条设计原则、五个视图族与五个图层、可直接测的验收标准 |
| `/parallel-topology/demo.html` | **并行拓扑可视化工具 · Demo v0.2（应用形态）**：主视图**单维切分**——一个切分一个视图，模板取参照系最后一张总图：粒度做竖轴（输入→整网→层→算子→kernel），rank 柱=容器贯穿全高，**块的横跨=共有、归属边界线（§02）随维移动、索引五元组条（§03）常驻**；切分的最小单位是片/段/桶而不是卡，卡只是各维区间交集的落位容器。另有合成·卡阵（五维相乘 + 通信 + 训练步动画）、卡内解剖（容器打开：层→算子→kernel→流）、**交集腔**（两只索引空间盒：权重体 ℓ×h×e 三轴 / 激活体 ℓ×h×b×s 四轴；每把刀是一整片板，三片板相交剁出这张卡的那一腔，体积∶全盒 = 持有占比。DP 在权重体上没有轴 —— 腔的三条边长里没有 d ⇒ 体积不变 ⇒ **A3「加 DP 不买余量」的几何证明**；EP 在激活体上没有轴，路由是动作不是切分）、时间·流（1F1B + AllReduce 归因）。默认 128 卡（tp2·cp1·pp4·dp16·ep8，EP 折入 DP）。URL 即状态（`?view= &cut= &sel= &dim= &prim= &preset= &theme= &net3d=`，旧 `v1..v5` 别名兼容），明暗主题随 token 翻转，A1–A8 页内实时自检 |

`/parallel-topology/` 本身是一张目录页，同时指向三者。

已发布链接（本分支 push 即刷新，deploy.yml 的叠加段负责）：

- 目录页：<https://cinnnnnnndy.github.io/hpc-topology-viewer/parallel-topology/>
- Demo 直达：<https://cinnnnnnndy.github.io/hpc-topology-viewer/parallel-topology/demo.html>
- Demo 规范入口（pattern.html 与 pattern.json 同级、自带依赖副本）：
  <https://cinnnnnnndy.github.io/hpc-topology-viewer/patterns/parallel-topology-demo/pattern.html>
- 带状态示例（MoE 预置 · 卡内解剖 · 选中 r21 · EP×All-to-All · 深色）：
  `…/parallel-topology/demo.html?preset=moe64&view=v3&sel=21&dim=ep&prim=alltoall&l5=1&theme=dark`

（main 的 `public/` 里另有 `/parallel-reference/` 与 `/parallel-prd/`——那是同一对文档在
main 上的路径；`/parallel-topology/` 是含 Demo 的成套目录，两边互不影响。）

另有一条**跨仓库**叠加：`Cinnnnnnndy/pto-design-system` 的
`claude/rank-deck-intersection-payload` 分支（纠正版 rank-deck——Rank 装的是
层段×TP片×EP桶的**交集**，不是缩小的整网；含五元组/持有占比/归属边界检查器）发布在
<https://cinnnnnnndy.github.io/hpc-topology-viewer/pto-ds/patterns/model-parallel-rank-deck/pattern.html>
（深链参数：`?rank= &layer= &scene=rank &topology= &theme=`）。该 fork 分支 push 后需
重跑本分支 workflow 才会刷新此链接。

`prd.html` 是 `prd.md` 的**构建产物**，不要手改：改 md 之后跑
`node scripts/build-prd-page.mjs public/parallel-topology/prd.md public/parallel-topology/prd.html`
重新生成（需先 `npm i -D marked`），两者一起提交。手改 HTML 会让 md 与页面分叉，
之后没人说得清哪份是准的。视觉语言与 `concept-map.html` 同源——两条链接是一对文档，
不该长成两种东西。

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build to dist/
npm run preview
```

## Content encoding (anti-scrape)

All product/brand display strings live in `src/content.ts` as **base64(UTF-8)**
and are reconstructed at runtime by `src/codec.ts` (`dc()`), so the committed
source tree (and the built bundle) contain no plaintext product names — a
repository grep or code search finds nothing; the terms only materialize in the
browser at runtime.

The plaintext generator that produces `content.ts` is intentionally **kept out
of version control** (`scripts/` is git-ignored) so the plaintext never lands in
the repo. `content.ts` is the committed, encoded artifact.

The deployment is also marked `noindex` (see `index.html` meta tags and
`public/robots.txt`) so crawlers do not index it.

## Notes

Cabinet outer dimensions use the published envelope; in-cabinet and on-board
layouts are schematic abstractions based on public material and do not represent
real engineering layouts.

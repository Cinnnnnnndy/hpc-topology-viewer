# HPC Topology Viewer

> **启动页（一站入口）：<https://cinnnnnnndy.github.io/hpc-topology-viewer/launch.html>**
> —— 工作台、驾驶舱、独立 pattern、参照系 / PRD / 映射简图与 `research/` 研究报告
> 按组整合在一张浅色启动页上，点开即看（dev: `/hpc-topology-viewer/launch.html`）。
> `research/` 顶层报告 HTML 由构建带进站点（`/research/*.html`，见 `vite.config.ts`
> 的 `researchHtml` 插件），仓库里不存第二份。

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

## 并行拓扑：参照系与 PRD（两条各自独立的链接）

同一套概念的两份文档，各占一条顶层链接，各自自包含（单文件打开即可，零外部依赖），
互不依赖也不共用目录——打开就是内容本身，中间没有目录页：

| 链接 | 源 | 是什么 |
|---|---|---|
| `/parallel-reference/` | `public/parallel-reference/index.html` | **《分布式训练参照系 —— 五根轴 · 两个对象 · 三组坐标》**：术语、基数、切分、映射、通信、编号、运行时的完整参照系，配可交互示意图与勘误 |
| `/parallel-prd/` | `docs/parallel-topology-prd.md` | **《并行拓扑可视化工具 PRD》v0.1**：把参照系直接落成信息架构——四类结构性错误、五条设计原则、五个视图族与五个图层、可直接测的验收标准 |

PRD 那张页是**构建产物**，不要手改：改 `docs/parallel-topology-prd.md` 之后跑
`node scripts/build-prd-page.mjs docs/parallel-topology-prd.md public/parallel-prd/index.html`
重新生成（需先 `npm i -D marked`），md 与产物一起提交。手改 HTML 会让两者分叉，
之后没人说得清哪份是准的。源放 `docs/` 而不是 `public/`：`public/` 下的东西会原样发布，
md 跟着发出去就等于同一份内容有两条链接。

两条链接各自独立，但视觉语言同源（同一套 token、版心、章节标尺）——是一对文档，
不该长成两种东西。

## 组合工作台（`/combo-workbench/` · 独立迭代）

一块**摞格子**的应用台面，后续的工作台组合往它上面继续摞。形制与视觉语言同
`public/cube-cockpit.html`：顶栏 + 舞台 + 底部抽屉，铺满视口、自己不滚动（滚动都发生在
格子里面），同一套 PTO token（浅色优先、`[data-theme=dark]` 单块覆盖）、同一种面板圆角与
段控，抽屉就是驾驶舱那张「Profiling 视图」卡的形制。token 是内联的，不引 vendor。

现在三格：

| 格子 | 内容 | 我们给了什么 |
|---|---|---|
| 舞台左 · 整网图 | iframe → `/pto-ds/patterns/model-architecture-training-sidecar/pattern.html?view=front`（跨仓 `pto-design-system`） | 格头：名字 + 收起（名字由台面出，好和并行拓扑同一套字号）；默认看**正视** |
| 舞台右 · 并行拓扑 | iframe → `/patterns/net-slicing/pattern.html`（为「被嵌」抽出来的那一屏，应用顶栏天然收起） | 什么都不加；名字与「＋ 搜索」由它自己在画布左上角出 |
| 抽屉 · 微批次生命周期泳道 | iframe → `./swimlane.html?chrome=0`，MB07 · step 18420 | 格头：三档时间范围的段控 + 收起 |

三格之间两条可拖的分隔条（左右一条、上下一条）。

整网图默认看**正视**而不是 pattern 出厂的侧视，是因为这一格装不下侧视：那个视图里的
算子名/指标名是**固定字号**的 HTML 标注，不随缩放变小，左右还各挂一条 input/output
标注带，量下来要 ~950px 视口才收得住（460 宽时左溢 407px、右溢 285px），点多少次
「适配」都没用。正视这一屏本来就是模型计算图，460 宽完整装得下。3D / 侧视 没拿掉，
pattern 自己那三颗段控一点就换。「适配」只管缩放不管重心（固定字号的标注不跟着缩），
所以点完它我们再量一遍包围盒补一次居中——**只动 pan 不动 zoom**，且只居中**装得下的
那条轴**，本来就溢出的轴一平移只会把一侧推得更远。

认 `pto:state` 的格子用 `postMessage` 驱动，**不重载 iframe**——切视图不会丢掉格子里
选中的那张卡 / 那条事件。顶栏那颗月亮是**主题桥**，外壳与三格里的页面一起换明暗：认
`?theme=`/`pto:state` 的走消息，sidecar 那份两样都没有（明暗只认它自己 `data-theme`），
所以同源翻进去按它自己那颗浅色/深色按钮——不碰内部状态，只按它自己的控件。
台面状态（看哪个视图、左格多宽、抽屉多高、折了谁、明暗）写进 URL，
`?a=solid&b=l34&w=600&h=460&ui=dark` 这样一条链接就是你当时那一屏。

**整网图 → 并行拓扑的联动**：左格选中第 *n* 层（点层本身，或展开某层后点里面的算子），
右格就落一枚它**自己那套属性搜索**的 `层 · Ln` 标签——由它自己算出这一层落在哪个 stage、
被 TP/EP/DP 各切几份、共几张卡与之有关，并把那些卡点亮；取消选中就摘掉这一枚
（不碰用户手填的别的标签）。因为高亮的是**卡**不是算子，「打开 Rank → 关闭整网」
进魔方那个模式一样有效。走的是它自己的控件（点「＋ 搜索」→ 点「层」→ 填值 → 回车，
全程它自己的事件处理器），**不重载 iframe**，视角/缩放/选中卡都不丢；它的 `pto:state`
白名单里没有搜索标签，chips 关在它的 IIFE 里，所以只能这么走。
台面这边靠轮询 `window.trainingSidecarController` 的 `selectedLayer` /
`base.state.selected.layer` 拿层号——整网图改选中的入口不止一条，盯结果比盯入口可靠。
注意两个 pattern 现在描述的**不是同一个模型**：整网图是 openPangu-flash（46 层 + MTP），
并行拓扑默认预置是 32 层，所以 L32 以上会被它如实回一句「只有 32 层（L0–L31）」——
层号原样转发，台面不替它编一个对应关系。

台面在启动页上另有一张卡（「工作台 · 主线」组的头一张），那张卡用的是启动页的样式；
片段本体在 `public/combo-workbench/launch-card.html`，由 `deploy.yml` 叠加插入。

`public/combo-workbench/swimlane.html` 是 **compute-graph-viewer 的上游拷贝**
（`pangu-moe-trainviz/microbatch-lifecycle-swimlane-mock.html`），连同
`vendor/swimlane-task/` 一起搬过来。相对上游只加了三处：文件头出处说明、
`embed.css`、`embed-bridge.js`（后两个是内嵌壳，一律靠 `.click()` 现有控件，
不碰它自己那个 IIFE）。正文一行没动，上游更新时重拷一遍再补这三处即可。
`embed.css` 里还修了一处跨仓类名撞车：本仓 pto-design-system 快照的
`.legend`（色板面板用，`flex-direction: column`）会把泳道底部那排图例竖着摞成
138px 高、压穿 38px 的页脚——独立打开也一样坏，所以那条修复不分内嵌与否都生效。

**与被嵌 pattern 的同步**：舞台那两格嵌的是**规范路径上的本体**，不是拷贝——
`/patterns/net-slicing/pattern.html` 与 `/pto-ds/patterns/model-architecture-training-sidecar/pattern.html`
各由自己的发布步骤从各自分支的 HEAD 叠加，所以「工作台里的那一份」和「直接打开那条链接」
永远是同一个文件、同一个版本。`?v=<短SHA>` 版本戳**只打本目录自己的文件**（`swimlane.html`）：
拿本分支的 SHA 去戳别人的成品是反效果——它们更新而我们没动时戳不变（该刷的没刷），
我们改台面而它们没动时戳变了（不该刷的刷了）。

台面本体自包含（token 内联，不引外部样式）。三格的内容都是**构建期产物**——
`/patterns/net-slicing/`、`/pto-ds/patterns/model-architecture-training-sidecar/`
由发布流水线叠加，仓库里没有这两份文件，所以本地直接开 `public/` 时那两格是空的
（有兜底文案说明），要看真样子得看发布后的站点。哪条 404 也只坏那一格，外壳还在。

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

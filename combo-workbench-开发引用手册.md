# 组合工作台 · 开发引用手册

这是给要接手 `/combo-workbench/` 开发的人看的**索引文档**：每个部分的代码在哪、
上游出处是什么、由哪个分支的哪一步发布上线。产品向的说明（三格是什么、为什么这样切）
看 [README.md 的「组合工作台」一节](README.md)，两份不重复。

核对时间：2026-08-20，`main@9546011`。本文档记的是**引用关系**，这类关系不常变；
但如果某个格子换了实现、或部署步骤挪了地方，下面的行号会先过期，发现对不上以文件里的
实际内容为准。

---

## 0. ⚠️ 先说清楚：改动要落在哪个分支

`public/combo-workbench/` 在 `main` 和 `claude/topology-swimlane-card-layout-fdrgiq`
两个分支上**都有**，但**线上 `/combo-workbench/` 是 `deploy.yml` 从 `fdrgiq` 分支拉的**，
不是从 `main` 拉的（见 `.github/workflows/deploy.yml:493` "Checkout combo-workbench branch"，
`ref: claude/topology-swimlane-card-layout-fdrgiq`）。`main` 上那份是历史 PR 合并进来的镜像，
两边内容此刻一致，但这只是因为最近一次 PR（#70）刚把 `fdrgiq` 领先的改动合回了 `main`——
机制上随时可能再次跑偏：只要有人往 `fdrgiq` 提交但还没发起/合并 PR，`main` 上的
`public/combo-workbench/` 就会立刻落后于线上实际发布的内容，且**不会有任何报错**提示这件事。

这和 `/parallel-topology/` 曾经踩过的坑是同一种：那边最初也是从专属分支
（`ff10w3`）checkout 发布，「推 main」与「推 ff10w3」谁最后跑谁赢，同一条链接的内容
会在两版之间随机跳（`deploy.yml:248-251` 的注释原话记着这段历史）。后来的修法是把
源码彻底合并进 `main`、checkout 改成 `ref: main`，只留 `main` 一个发布口子。
**combo-workbench 还没有做这次搬迁**，`Checkout combo-workbench branch` 那一步仍然
按分支名取，`main` 与 `fdrgiq` 靠人工记得「改完要合并」维持同步，没有机制保证。

对开发者的直接影响：
- 在 `main` 上改 `public/combo-workbench/` 下的文件、直接推 `main` —— **不会**反映到
  `/combo-workbench/`，deploy.yml 那一步取的还是 `fdrgiq` 分支的旧内容。
- 要改这个工作台，去 `claude/topology-swimlane-card-layout-fdrgiq` 分支上改，改完照常走
  PR 合回 `main`（`main` 需要保有源码副本，`vite dev` 本地预览、以后如果要复刻
  parallel-topology 那次「改成从 main 发布」的修法都要靠它）。
- 如果打算把 checkout 也改成 `ref: main`（消除这个隐患），那是一次和 parallel-topology
  当年同类的迁移，别顺手在无关 PR 里捎带做。

---

## 1. 目录 → 部署产物映射

| 站点路径 | 本仓源文件（`fdrgiq` 分支） | 怎么产出 |
|---|---|---|
| `/combo-workbench/index.html` | `public/combo-workbench/index.html` | `deploy.yml:499-531`："Overlay 组合工作台" 步骤用 `sed` 把 `var BUILD = '';` 替换成本分支短 SHA，其余原样拷贝 |
| `/combo-workbench/swimlane.html` | `public/combo-workbench/swimlane.html` | 同一步骤，`sed` 给所有相对 `href=/src=` 的 `.css/.js` 打 `?v=<SHA>` |
| `/combo-workbench/vendor/swimlane-task/{pattern.css,pattern.js}` | `public/combo-workbench/vendor/swimlane-task/` | 原样 `cp`，不打版本戳 |
| `/combo-workbench/embed.css`<br>`/combo-workbench/embed-bridge.js`<br>`/combo-workbench/favicon.svg` | 同名文件 | 原样 `cp` |
| `/combo-workbench/observatory/**`（30+ 个文件） | `public/combo-workbench/observatory/` | `cp -r` 整目录搬，见 `deploy.yml:522-528` |
| `/launch.html` 里「组合工作台」那张卡 | `public/combo-workbench/launch-card.html` | `deploy.yml:532-559`："Overlay 组合工作台卡片" 步骤把这个片段插进 main 构建出的 `dist/launch.html`「工作台 · 主线」组最前面 |
| 舞台两格实际内容 `/patterns/net-slicing/pattern.html` | **不在本仓库、不在 combo-workbench 目录下** | 由 `main` 分支自己的 `public/parallel-topology/demo.html` 在更早一步（`deploy.yml:248-377`，"Overlay 并行拓扑"）产出。combo-workbench 只是引用这条**规范路径**，构建期不复制第二份 |

本地 `npm run dev` 直接开 `public/combo-workbench/index.html`：舞台两格是空的（有兜底文案），
因为 `/patterns/net-slicing/` 是构建期产物，仓库里没有这份文件。要看两格的真样子只能看
发布后的站点。抽屉（swimlane / observatory）是自包含文件，本地能看到真样子。

---

## 2. 三个格子逐一的引用

代码位置：`public/combo-workbench/index.html:430` 起的 `var SLOTS = [...]` 数组，
三个条目分别是 `id: 'netgraph'`、`id: 'topology'`、`id: 'swimlane'`；对应的 DOM 挂点是
`#slot-topology`（`index.html:326`）、`#slot-netgraph`（`:345`）、`#dock`（`:366`）。

### 格子「并行拓扑」（主视图，`id: topology`）与「整网图」（跟随视图，`id: netgraph`）

- 两格都指向同一个构建产物 `../patterns/net-slicing/pattern.html`，只是 query 参数不同
  （`netgraph` 加 `cuts=pcte&rank=0`，见 `index.html:475-499` 的 `src()` 函数与其上方注释）。
- 上游来源：`main` 分支的 `public/parallel-topology/demo.html`，经 `deploy.yml` 的
  "Overlay 并行拓扑" 步骤抽取发布。这条链本身**不受本文档第 0 节那个分支隐患影响**——
  它已经完成了从专属分支迁到 `main` 发布的修法。
- 两格之间**不共享配置，只走语义消息**：
  - 主视图选中一张卡 → 整网图亮起对应层段（`index.html:950` `wireOpToRank`）；
  - 任一格选中某一层 → 另一格同步高亮（`index.html:960-984` `wireLinkage` / `:933` `pushHL`）；
  - 走带进度（训练步 t）→ 两格同时收到 `pto:state{step}`（`index.html:1006` `xpPushStep`）。
  - 收消息的判别逻辑在 `index.html:1220` 起，只认 `pto:select` / `pto:state-ack` / `pto:comm`。
- 要把「整网图」抽成独立 pattern 时（README 里提到的后续计划），只需要换这一格的
  `src` 与 `hideCss`（`index.html:453-472`），上面三条语义消息的挂钩不用动。

### 格子「微批次生命周期泳道」（抽屉，`id: swimlane`，4 个 tab）

- `swimlane.html`：**上游拷贝**，源仓库 `github.com/Cinnnnnnndy/compute-graph-viewer`，
  路径 `pangu-moe-trainviz/microbatch-lifecycle-swimlane-mock.html @ 7ca2142`
  （出处写在文件头注释 `swimlane.html:1-22`）。相对上游只有 4 处改动，逐条登记在同一段注释里；
  正文（DOM / 绘制逻辑 / 模拟数据）没有再动过，上游更新时重拷一遍、补这 4 处即可。
- `vendor/swimlane-task/{pattern.css,pattern.js}`：与 `swimlane.html` 同一来源，逐字节一致。
- `embed.css` / `embed-bridge.js`：**本仓原创**，不是上游文件——内嵌桥，只靠 `.click()`
  驱动上游已有控件，不碰上游 IIFE 里的任何变量（约束写在 `embed-bridge.js:1-16`）。
- Tab「通信观测」（`obs`）指向 `./observatory/`，来源另一个上游目录：同一个
  `compute-graph-viewer` 仓库下的 `distributed-communication-observatory-3d-traffic`
  （出处见 `index.html:565-566`）。内部 `observatory/vendor/pto-design-system/` 是钉版快照，
  钉在上游子模块当时指向的 `pto-design-system@d58dd4eb`——升级这份快照要去上游对应仓库找
  子模块新指向的 commit，不能直接拿本仓 `public/vendor/pto-design-system/`（版本不同源）。
- 走带游标（时间轴上那根线，`index.html` 里 `xpPlaceCursor`/`XP_GUTTER`/`XP_PAD_R`
  一带）读的是 `swimlane.html:1573` 里 `const gutter = 236` 这个**上游字面量**的复述，
  改不了也读不到，只能在宿主这边硬编一份同步。上游这个常量变了，这边要跟着改。

---

## 3. 部署步骤的先后顺序（要碰 `deploy.yml` 时对照）

只列与 combo-workbench 直接相关、或顺序上会影响它的步骤，按文件里的出现顺序：

1. `deploy.yml:70` Checkout `main`（站点框架）
2. `deploy.yml:248` Checkout `parallel-topology` 分支 → 实际 `ref: main`（本步已完成迁移，见 `:248-251` 注释）
3. `deploy.yml:258` Overlay 并行拓扑 → 产出 `/patterns/net-slicing/pattern.html`，combo-workbench 两格依赖它
4. `deploy.yml:379` Overlay 并行拓扑卡片 into `/launch.html`
5. `deploy.yml:493` **Checkout combo-workbench 分支** → `ref: claude/topology-swimlane-card-layout-fdrgiq`（本文档第 0 节说的隐患就在这一行）
6. `deploy.yml:499` Overlay 组合工作台 at `/combo-workbench/`
7. `deploy.yml:532` Overlay 组合工作台卡片 into `/launch.html`
8. `deploy.yml:566` Checkout `pto-design-system`（跨仓库，供 `/pto-ds/`、`atlas.html` 用，与 combo-workbench 无直接关系，紧接其后）

第 5-7 步新增文件（比如给 combo-workbench 再加一个子目录）时，要同步改这三步——尤其是
第 6 步："逐页列举（不是 `cp -r`）：新增页面必须补到这一步，否则线上 404"
（`deploy.yml:495-498` 原话），`observatory/` 那一条是唯一的例外（整目录 `cp -r`）。

---

## 4. 已知的口径不一致（交接前必须知道，不是本文档臆测，可复现）

`swimlane.html` 里硬编码的训练步事件（`swimlane.html:407-416`）按 **46 层**切 PP 段：

```
PP0 · L0–L11    PP1 · L12–L22    PP2 · L23–L34    PP3 · L35–L45
```

而「并行拓扑」「整网图」两格当前默认配置（`default128` 预设）是 **48 层**：

```
PP0 · L0–L11    PP1 · L12–L23    PP2 · L24–L35    PP3 · L36–L47
```

`L23`、`L34`/`L35` 这几层在上下两部分屏幕上分属不同的 PP 段。工作台的核心卖点是
「同一件事的空间/时间两面对齐着看」，这条错位直接影响这个卖点——打开 `/combo-workbench/`
同屏对比两侧的 PP 段标注即可复现，不需要特殊操作。

这不是新问题：`index.html:29-33` 的注释记着，此前挂在这一格的
`pto-design-system` training-sidecar 正是因为「46 层 vs 48 层，层号对不齐」被换掉的；
换成同源的两格之后，右边两格互相对齐了，但左边泳道那份 46 层的上游拷贝没有跟着改，
矛盾只是从「两格之间」挪到了「舞台和抽屉之间」，没有消失。

修法二选一：把 `swimlane.html` 的硬编码事件改成按 48 层重新切分（会偏离「正文一行没动」
的上游同步纪律，需要在文件头注释里补登记为第 5 处改动）；或者反过来让舞台默认配置切到
46 层。哪个方向由做产品判断的人定，本文档只负责把矛盾点钉清楚。

---

## 5. 加第四格的改动清单

`index.html:411-413` 的注释原话：「按 **N 格** 写：加第三格只需要往 SLOTS 里加一条 +
照抄一节 `<section class="slot">`，下面这些（段控、折叠、关闭、URL 状态）都不用改」。
具体拆开：

**要改的：**
- `var SLOTS = [...]`（`index.html:430`）里加一条新对象：`id` / `el` / `src()` /
  可选的 `key`+`def`+`tabs`（要不要段控）/ 可选的 `foldable`（要不要「收起」按钮）/
  可选的 `hideCss`（要不要藏掉内嵌页自带的某些 UI）。
- HTML 里照抄一节 `<section class="slot" id="...">`（参照 `:326` 或 `:345` 的写法）。

**不用改的（通用逻辑，按 N 格写好的）：**
- `readURL`/`writeURL`（`:657`/`:680`）—— URL 状态编解码
- `buildTabs`/`syncTabs`/`select`/`load`（`:699`起）—— 段控与加载
- `wireFrame`（`:750`）/`applySlotVisibility`（`:766`）/`settleFrame`（`:851`）—— 折叠/关闭/加载态判定
- `applyDockH`/`applySideW`（`:778`/`:782`）—— 分隔条拖拽

**如果新格子要跟主视图联动**，接的是三条既有语义消息（不要接某一套具体 query 参数）：
- `sel`（选中卡）
- `hl`（层高亮，走 `pushHL`，`:933`）
- `step`（训练步进度，走 `xpPushStep`，`:1006`）

新格子要收/发这几条，照抄 `wireLinkage`（`:975`）或 `xpPushStep`（`:1006`）里已有的
`postMessage({type:'pto:state', ...})` 写法，白名单字段要跟被嵌页面（如果是别的 pattern）
自己认的 `pto:state` 字段对上——参考 `topology`/`netgraph` 两格已经接好的样子。

---

## 6. 相关文档

- [`README.md` 「组合工作台」一节](README.md)——产品向说明，讲「为什么这样切」
- [`CLAUDE.md`](CLAUDE.md)——提交身份规范；「新增分支目录要同步 `deploy.yml`」的仓库级规则
- `.github/workflows/deploy.yml` 顶部大段注释——全站发布策略，覆盖不止 combo-workbench 这一个分支

# rubik-cube pattern（逻辑魔方 · 独立 pattern）

pto-design-system 风格的 **rubik-cube** pattern —— 把 `public/cube-cockpit.html`
里的「逻辑魔方」抽成可独立迭代的自包含模块（同 `model-graphviz` /
`memory-architecture` 的 vendor 约定），注册为 `window.PtoRubikCubePattern`。

独立迭代入口：**`public/rubik-pattern.html`**（`npm run dev` 后访问
`/hpc-topology-viewer/rubik-pattern.html`）。控制台暴露 `window.rubik` 句柄可直接调 API。

| file | what it is |
|---|---|
| `pattern.js` | 布局模型 + Three.js（r128，全局 `THREE`）渲染器。公开 API：`createModel(config)` / `mount(container, opts)`。 |
| `pattern.css` | 工具栏 / HUD / 图例 / 粒度贴士 / 信息卡样式（`.prc-` 前缀，`[data-theme]` 明暗联动）。 |

## 并行度配置（本次迭代的规格）

```js
PtoRubikCubePattern.mount(el, { config: { tp: 2, pp: 4, dp: 128, ep: 8 } });
```

rank 总数 = **tp × pp × dp = 2 × 4 × 128 = 1024**。**EP 不参与乘法**——语义与
cockpit 白皮书一致：EP 折入 DP 轴、不新增轴，`ep` 只要求整除 `dp`：副本
`rep` 持有专家桶 `rep % ep`（8 桶），相邻 `ep` 个副本构成 1 个 A2A 域
（共 `dp/ep` = 16 域；桶↔卡非 1:1）。`layers`（默认 48 → 每 PP 段 12 层）、
`experts`（默认 64 → 每桶 8 个）、`hotBuckets` 均可配。

> 注：需求原文「pp4、tp2、ep8、dp6、rank1024」中，rank1024 与 tp2×pp4 定死
> 稠密副本 dp=128；ep8 折入其中（8 桶×16 域），不进乘法；「dp6」无法与
> 1024 吻合（2×4×6=48），故按 dp=128 取值。若本意不同，改
> `rubik-pattern.html` 里的一行 config 即可。

## 保留的表达（与 cockpit 逻辑魔方逐项对齐）

- **5 种形态**（切形态 = 换投影轴，飞行动画重排）：标准（X=TP·Y=PP·Z=DP，位置即
  多维坐标）/ DP平铺（128 副本成 16×8 宫格，找慢副本）/ EP聚簇（8 专家桶成墙，
  桶故障=整面墙同红）/ TP切片（2 片权重墙，查同槽位系统性故障）/ PP流水
  （4 段横向展开，找慢段/气泡）；
- 每形态的 **3D 坐标网格框 + 轴刻度 + 语义标注 + 关键结构线**（TP 层内
  AllReduce · PP 段间 P2P + 层段标尺 S0·L1-12… · DP 梯度 AllReduce · A2A 域
  横穿桶墙 · ★热点桶）；轴间距遵守「同屏两轴步距比 ≲4×」的失衡修正教训；
- **1 小块 = 1 卡（rank）=（TP,PP,DP）坐标交点 · 另叠 EP 桶**；
- **正交 顶/前/侧 2D**（各形态平面不同，按钮名随形态换）+ 被折叠深度维的
  **剖面逐层翻** + **「每格=几张卡」粒度小贴士**（折叠时如实标注 n 卡重叠）；
- 选中一张卡 → **TP/PP/DP/EP 四维通信组同屏高亮**（签名色：TP 青 #39c5cf ·
  PP 橙 #FFAA3B · DP 蓝 #4369EF · EP 紫 #9B3CF6；TP 环 / PP 链 / DP 采样 /
  EP A2A 星形互发），随重排飞行跟随；
- **着色透镜**（状态热力 / 按 TP·PP·DP·EP 分组）与 **异常注入**（TP槽0 /
  PP级0 / DP副本0 / EP桶3）——「异常的形状」直接对应根因类别，HUD 同步给出
  「切到哪个形态 snap 成一块」的读图钥匙；
- 每形态的「为什么这样摆」（CUBE_WHY）HUD 文案、明暗主题联动。

## API

`createModel(config)` —— 纯布局/拓扑模型，无 Three.js 依赖（可单测、可被其他
视图复用）：`posOf(rank, mode, out)`、`tpOf/ppOf/repOf/epOf/domOf`、
`commGroup(rank, dim)`、`stageLayerRange(s)`、`boundsOf(mode)`、`modes` 元数据
（含各形态正交视角的折叠维表）。

`mount(container, opts)` → handle：`setMode(0-4)` / `setView(0-3)` /
`setSlice(on, val)` / `setColorBy('load'|'tp'|'pp'|'dp'|'ep')` /
`setAnomaly(...)` / `select(rank)` / `setTheme('dark'|'light')` /
`setPlaying(bool)` / `resize()` / `destroy()`。
opts：`{ config, theme, mode, chrome:false（隐藏自带工具栏，宿主接管）, onSelect }`。

## 与整网图 / 专家图结合的挂点（预留）

- `handle.selectLayer(l)` —— 整网图（`model-graphviz`）选中层 → 魔方标准形态的
  水平切片高亮（对应 cockpit「选中整网层 → 魔方水平切片」）；
- `handle.selectBucket(e)` —— 专家图选中桶 → 切 EP 聚簇并聚焦整面墙；
- `opts.onSelect({rank, tp, pp, rep, bucket, domain, stage})` —— 反向：魔方选卡
  → 宿主反查该 rank 的多维身份（整网图高亮其算子归属 / 专家图高亮其持桶）；
- `rubik-pattern.html` 已桥好 postMessage：`rubik-theme`、`rubik-cmd`
  （mode/layer/bucket/anom）、`rubik-select` 回报，宿主可直接 iframe 嵌入
  （与 `CubeCockpit.tsx` 挂 cockpit 的方式一致）。

Provenance：布局/语义/文案抽取自 `public/cube-cockpit.html` 的逻辑魔方
（`chipCubeM` 五形态、`renderCubeAxes` 轴标注、ODEP 折叠维表、`CUBE_WHY`
读图钥匙、`#cardGran` 粒度贴士、DIMHEX 维度色），并行度由写死的
8192（TP8×PP16×DP64）参数化为任意 `tp×pp×ep×dp`。cockpit 本体未改动。

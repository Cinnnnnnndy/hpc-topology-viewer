# rubik-cube pattern（逻辑魔方 · 独立 pattern）

pto-design-system 风格的 **rubik-cube** pattern —— 把 `public/cube-cockpit.html`
里的「逻辑魔方」抽成可独立迭代的自包含模块（同 `model-graphviz` /
`memory-architecture` 的 vendor 约定），注册为 `window.PtoRubikCubePattern`。

独立迭代入口：**`public/rubik-pattern.html`**（`npm run dev` 后访问
`/hpc-topology-viewer/rubik-pattern.html`）。控制台暴露 `window.rubik` 句柄可直接调 API。

| file | what it is |
|---|---|
| `pattern.json` | **设计系统契约**（同 `memory-architecture` 约定）：id/type/描述、来源、`useWhen`、`requiredApis`、`layoutRules`、允许与禁止的覆盖、`agentReuseRule`。改动或复用前先读它。 |
| `pattern.js` | 布局模型 + Three.js（r128，全局 `THREE`）渲染器。公开 API：`createModel(config)` / `mount(container, opts)`。 |
| `pattern.css` | pattern 独有的样式（3D 舞台 / 阶段轨道 / 图例色块 / tooltip 定位）；控件本身复用设计系统的 `.panel-shell` / `.btn` / `.stat-chip`，颜色圆角阴影间距一律 `var(--token)`。 |
| `favicon.svg` | 等距魔方图标（维度签名色）。 |

## 并行度配置（本次迭代的规格）

```js
// 默认即盘古 Pro MoE 真实训练策略；不传 config 也是这一组
PtoRubikCubePattern.mount(el, { config: { tp: 8, pp: 5, dp: 100, ep: 2 } });
```

rank 总数 = **tp × pp × dp = 8 × 5 × 100 = 4000**（盘古 Pro MoE 预训练用 4K
昇腾 NPU）。**EP 不参与乘法**——语义与 cockpit 白皮书一致：EP 折入 DP 轴、
不新增轴，`ep` 只要求整除 `dp`：副本 `rep` 持有专家桶 `rep % ep`（2 桶），
相邻 `ep` 个副本构成 1 个 A2A 域（共 `dp/ep` = 50 域；桶↔卡非 1:1）。
`layers`（默认 48 → 每 PP 段约 10 层）、`experts`（默认 64 → 每桶 32 个）、
`hotBuckets` 均可配。

**维度可自由输入**：工具栏「并行」一排是 TP/PP/DP/EP 数字输入框（回车或
「应用」提交），任意组合即时重建魔方——布局、飞行重排、轴标注、正交折叠维、
图例、HUD、异常注入桶号全部跟随新配置（DP 平铺板间距、EP 墙内 TP 偏移等随
TP 自适应）。校验：四数 ≥1、`ep` 整除 `dp`、rank ≤ 65536（超限报错不应用）。
内置两个快捷预设（标签按 TP·PP·DP·EP 顺序）：
**盘古ProMoE 8·5·100·2**（= 默认）—— 真实训练策略 TP8·EP2·PP5·4K NPU，出处
`data/ascend-workload-pangu-moe.json` ← arXiv 2505.21411（dp = 4000/(8×5)
= 100，EP2 折入 → 50 个 A2A 域）；**128卡 2·4·16·8** —— 单超节点量级的
小规格（tp2×pp4×dp16 = 128 rank，EP8 折入 DP → 2 个 A2A 域），适合逐卡
细看结构。
程序侧同能力：`handle.setConfig({tp,pp,dp,ep})` → `{ok}` 或 `{ok:false,error}`。
`rubik-pattern.html` 默认浅色主题（`?theme=dark` 或右上按钮切换）。

> 沿革：最早的示意规格是 tp2·pp4·dp128·ep8（1024 rank，出自「pp4、tp2、ep8、
> rank1024」的口径——EP 不进乘法，故 rank1024 与 tp2×pp4 定死稠密副本 dp=128）。
> 改用真实数据后，默认与预设都收敛到盘古 Pro MoE 与 128 卡两组；1024 那组仍可
> 在输入框手填 2·4·128·8 得到。

## 布局规则（任何数字都自动排布好 · 扩展只需声明）

间距不再是逐形态手调的常量，而是由 `pattern.js` 顶部一处规则推导——**换任何
并行数字都自动成立，新增维度（CP/SP…）或新增形态只需按同样规则声明轴的意图**：

1. **卡块是恒定的正方体**（`CARD = {x:.6, y:.6, z:.6}`）——换形态、换配置都不改变一
   张卡的大小与形状；卡块几何、取景留白都以它为唯一事实源。用长方体会让「某个维度落到
   哪根轴上、卡就把哪个面朝向你」，读起来像卡被转了 90°，同一种东西在不同视图里长得
   不一样（cockpit 当年修过的失衡问题）。
2. **单维轴步距 = `CARD[轴] + 缝隙(成员数) × 层级倍率`**。缝隙按成员数分档
   （`GAP_BY_N`：≤4 → .85 · ≤12 → .6 · ≤48 → .3 · 更多 → .13）：成员越多缝越紧，
   长轴不被拉成细丝；成员越少缝越松，短轴不退化成薄片。层级倍率（`TIER`）表达
   意图：`dense` 密排 · `normal` 常规 · `spread` 留白（如 EP 的 A2A 域界）·
   `emph` 强调分离（TP切片的墙、PP流水的段）。
3. **复合轴 = 外维分块 + 内维紧邻**（板 / 墙）：外维步距 = 内维总跨度 +
   块间留白（`padOf`，随跨度成比例）→ 任何规模下块与块都清楚分开。

4. **2D 可读性约束**：3D 摆法必须同时对每个正交视角成立。任一视角下屏幕两根轴的
   **最细步距之比 ≤ 4**——否则一根轴被拉成稀疏条纹（例：DP 平铺的板在顶视里只有
   1 张卡厚，行距若按板宽取方形宫格，每格 98% 是空的，完全读不出结构）。分块轴的
   块间距因此以「同屏另一轴最细步距 × 4」封顶（`clampFor2D`）；块的**内维在会退化成
   薄片时折成 2D**（DP 平铺的板内 TP → `TPC 列 × TPD 排`，取「宽 ≥ 深」且世界跨度最
   接近方形的分法：TP8 → 4×2 · TP16 → 4×4 · TP2 → 2×1），板因此有厚度，顶/侧视里
   每个副本是一片瓦而不是一条线。
5. **网格线 = 格边界（各形态各轴同一约定）· 分组按世界跨度取方**：所有网格线都画在
   「格边界」上（`cellLines`：中心 ± n·step/2，线过多时每 k 格一条，仍是边界），
   卡永远落在格子里、不被线穿过；外框即首尾两条边界线。原先分块轴画边界、其余轴画
   「穿过卡中心的刻度」，同一个框里两种约定混用，看起来就是「和网格没对齐」。
   宫格的行列数按**世界跨度**取近方形（而不是按数量取方阵）——板是宽而薄的，数量方阵
   会把顶视与轴测拉成长条（例：100 副本 → 5 列 × 20 行，而不是 10×10）。
   **网格自己说明轴的语义、也承担强调**：一根轴的格边界线用这一维的签名色画
   （标准：X=TP 青 · Y=PP 橙 · Z=DP 蓝；EP聚簇：X=EP 紫 · Z=域 蓝；PP流水：X=PP 橙），
   所以不需要轴向箭头——原先每根轴外挂的「圆锥箭头」是 3D 建模工具的语汇，在这套正交
   画面里既抢眼又与卡块语言不搭，已全部换成不带箭头的**轴脊细线**（只标范围），方向交给
   文案与刻度（`L1（上）→L48（下）`、`S0→S4（左→右）`、`域0（近）→域N（远）`）。
   选中聚焦时网格整体提亮 1.6 倍（`applyGridEmphasis`）：卡退成背景，格子接手空间参照。
6. **视角收编 + 折叠如实标注**：若某视角把「块维」和「块内维」同时折进视线、剩下的
   信息塌陷，则不给出该视角（并在视角行给出原因）。保留的视角一律用粒度贴士如实报出
   **每格重叠卡数 = 各折叠维成员数之积**
   （例：EP 聚簇侧视 = 专家桶×2 × TP×8 = 16 张卡重叠），剖面按最外层折叠维逐层翻。

**不变量：任一轴步距 ≥ 该轴卡块尺寸 + 最小缝 → 永不重叠。** 已用逐对包围盒
检测在 11 组差异极大的配置（1 卡到 8192 卡，含 `tp=1`/`tp=32`/`pp=60` 等退化与
极端形状）× 5 形态上验证：零重叠。取景与标注同样自适应——相机按包围盒在相机
基向量上的精确投影取景（含卡块自身尺寸），字牌尺寸与偏移随模型跨度伸缩，并自动
避让左上角工具栏（`chrome:false` 嵌入时不避让）。

## 保留的表达（与 cockpit 逻辑魔方逐项对齐）

- **5 种形态**（切形态 = 换投影轴，飞行动画重排）：标准（X=TP·Y=PP·Z=DP，位置即
  多维坐标）/ DP平铺（每个副本一块板、排成宫格，找慢副本）/ EP聚簇（每个专家桶
  一面墙，桶故障=整面墙同红）/ TP切片（每个 TP 槽位一片权重墙，查同槽位系统性
  故障）/ PP流水（流水段横向展开，找慢段/气泡）——组数与形状随配置自动生成；
- 每形态的 **3D 坐标网格框 + 轴刻度 + 语义标注 + 关键结构线**（TP 层内
  AllReduce · PP 段间 P2P + 层段标尺 S0·L1-12… · DP 梯度 AllReduce · A2A 域
  横穿桶墙 · ★热点桶）；轴间距遵守「同屏两轴步距比 ≲4×」的失衡修正教训；
- **1 小块 = 1 卡（rank）=（TP,PP,DP）坐标交点 · 另叠 EP 桶**；
- **轴测 3D + 正交 顶/前/侧 2D** + 被折叠深度维的**剖面逐层翻** +
  **「每格=几张卡」粒度小贴士**（折叠时如实标注 n 卡重叠）；任何正交视角下
  **拖动即从当前朝向无缝转回 3D 轴测**。视角按「每个 2D 平面只属于一个形态」
  收编——每个 2D 平面只属于一个形态，且只保留信息不塌陷的视角：

  | 形态 | 轴测 | 顶 | 前 | 侧 |
  |---|---|---|---|---|
  | 标准 | ✓ | DP×TP | TP×PP | DP×PP |
  | DP平铺 | ✓ | 副本网格 | 列×PP | 行×PP |
  | EP聚簇 | ✓ | 桶×域 | 桶×PP | 域×PP |
  | TP切片 | ✓ | — 同标准 | — 同标准 | — 同标准 |
  | PP流水 | ✓ | — 同标准 | — 同标准 | — 同标准 |

  （TP切片/PP流水 与标准共享坐标系、2D 投影完全重合，价值在 3D 的「墙拉开/段拉开」
  强调读法，间距因此放开拉大；被略去的视角在视角行给出原因。DP平铺 的三个 2D 视角
  在「板内 TP 折成列×排」之后都成立——板有了厚度，顶视每个副本是一片瓦而非一条线。）
- **时间轴 = 一个训练 step 的 4 个通信阶段**（与集群驾驶舱 `cube-cockpit.html` 的
  `PHASES` 同一套语义）：TP 前向 AllReduce → PP 阶段接力 → EP MoE AllToAll 浪涌 →
  DP 梯度 AllReduce。阶段轨道可拖拽定位，热力场随阶段变形（TP 组齐动 / PP 接力波沿
  流水级前进 / EP 浪涌点亮热点桶 / DP 全网梯度），选中卡的四维通信组里**当前阶段
  主导的那一维加亮**，其余淡显；`setTime(t | {phase:'EP'})` 可程序驱动；
- UI 全量采用 **PTO Design System**（`vendor/pto-design-system/` 是
  [上游仓库](https://github.com/yinyucheng0601/pto-design-system) 的快照：`tokens/` +
  `css/style.css`）：面板用 `.panel-shell`、按钮用 `.btn`（`.btn-sm` / `.btn-solid` /
  选中态 `.is-selected`）、读数用 `.stat-chip`，颜色/圆角/阴影/间距一律 `var(--token)`，
  明暗随 `:root[data-theme]` 切换；**核心 UI 无 emoji**，图标为 Lucide 风格内联 SVG
  （`stroke=currentColor`），数字与 ID 一律 mono，行首标签 ALL CAPS + 字距。
  **3D 场景内的着色同样全部取自色卡**——Three.js 用不了 CSS 变量，故挂载与切主题时
  把 token 解析成色值再喂给材质（`readTokens`）：负载热力 = `--success → --warning →
  --danger` 三段插值（与图例那条色带同源，颜色逐格一致）· 异常组 = `--danger` ·
  分组着色 = highlight 六族（copy-blue / accum-orange / l0a-violet / ub-green /
  mte-amber / l0b-deep-violet）的 400 与 600 两档共 12 色循环 · 网格与外框 =
  `--border-default` / `--border-strong` · 字牌底 = `--surface-1`、描边 =
  `--border-strong`、字体 = `--font-sans` · 场景底 = `--background`；
- 选中一张卡 → **TP/PP/DP/EP 四维通信组同屏高亮**，随重排飞行跟随。连线按
  **集合原语的实际算法**画（对齐驾驶舱的「算法展开」）：TP/DP = AllReduce →
  **Ring**（闭合成环，前半程 ReduceScatter、后半程 AllGather）或 **Tree**（二叉树，
  工具栏可切）· PP = P2P **接力链** · EP = **AllToAll**（成员少画全连、多则退化为星形）。
  另有 **域轮廓**（把整组用线框包起来——切到对应形态时组 snap 成整块，轮廓直接画出
  「这一组在这种堆法下是什么形状」）与 **方向粒子**（沿此刻主导维的走线跑，进度 =
  阶段内进度，于是 Ring 的 RS→AG 两段跟着时间轴走完）。
  **「连线」一排的五个图层——成员 / 通信线 / 域轮廓 / 粒子 / 聚焦——各自独立开关，可以全关**
  （程序侧 `setWire({members,lines,outline,movers,focus})` / `setAlgo('auto'|'ring'|'tree')`）。
  连线是「选中卡的通信域」，**没选卡就没有对象可画**：因此开图层时若还没选卡，会自动
  替你选一张居中的代表卡（否则按钮亮着、画面毫无变化，看上去像开关坏了），空态的提示
  文案也直说这一点；
- **选中聚焦**（`focus`，默认开）：几千张卡各自有色时，四维高亮会被整片颜色淹没——
  选中一张卡后，与它四个通信域都无关的卡**压暗并缩到 0.42**（色值向 `--background`
  插值，暗色主题压得更狠，因为卡是 MeshStandard 材质、环境光会把它提亮约 1.4 倍），
  同时**网格反过来加强**，空间参照不丢。与正交剖面共用同一套 dim 机制
  （`dimLv`：0 正常 / 1 聚焦压暗 / 2 剖面压暗），关掉即恢复原样；
  签名色取自设计系统色卡：
  PP=`--warning` · DP=`--primary` · EP=`--highlight-l0a-violet-400`；
  **TP 是唯一的例外**——它需要一个既不占用红黄绿（状态色专用）、又不与 DP 蓝 / EP 紫
  撞色的青，而上游色卡没有青族，故由本 pattern 提供 `--dim-tp`，**待回补上游**
  （同上游对 `.toggle-outline` 的处理方式）；
- **着色透镜**（状态热力 / 按 TP·PP·DP·EP 分组）——图例跟着当前着色走：分组时列出
  各组实际配色（组数超过色环时注明「同色非同组」），负载时给色带并标当前阶段，注入
  异常时标出异常组是什么；维度签名色不画在卡上，故不进图例。与 **异常注入**（TP槽0 /
  PP级0 / DP副本0 / EP桶3）——「异常的形状」直接对应根因类别，HUD 同步给出
  「切到哪个形态 snap 成一块」的读图钥匙；
- 每形态的「为什么这样摆」（CUBE_WHY）HUD 文案、明暗主题联动；
- **每排控件行首的问号**（hover / 键盘聚焦弹出）：两个字的行名说不清「注入和着色是什么
  关系」这类问题，长文案又不该常驻工具栏 → 收进问号气泡（`HELP` 文案表）。其中把
  **注入 与 着色 的关系**讲明白：注入不是另一种着色镜头，而是**接管**着色——一旦注入
  非「无」，卡色改由故障决定（受影响卡 = `--danger`，其余按低负载淡色），着色镜头暂时
  让位、图例同步切换，选回「无」即恢复。

## API

`createModel(config)` —— 纯布局/拓扑模型，无 Three.js 依赖（可单测、可被其他
视图复用）：`posOf(rank, mode, out)`、`tpOf/ppOf/repOf/epOf/domOf`、
`commGroup(rank, dim)`、`stageLayerRange(s)`、`boundsOf(mode)`、`modes` 元数据
（含各形态正交视角的折叠维表）。

`mount(container, opts)` → handle：`setConfig({tp,pp,dp,ep,…})` / `setMode(0-4)` / `setView(0-3)` /
`setSlice(on, val)` / `setColorBy('load'|'tp'|'pp'|'dp'|'ep')` /
`setAnomaly(...)` / `select(rank)` / `setTime(t | {phase:'TP'|'PP'|'EP'|'DP'})` /
`setWire({members,lines,outline,movers,focus})` / `setAlgo('auto'|'ring'|'tree')` /
`setTheme('dark'|'light')` / `setPlaying(bool)` / `resize()` / `destroy()`；
只读：`handle.model`、`handle.state`、`handle.phases`。
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

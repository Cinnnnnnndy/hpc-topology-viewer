# 模型分片与训练设备映射 · 简洁版（抽象图）· Pattern

> 构建产物：`/patterns/rank-topology-lite/pattern.html`
> 完整交互版：[`/patterns/rank-topology-3d/`](../rank-topology-3d/pattern.html)（可转动的三维阵列、六档通信、十层可观测性）
> 契约：同级 `pattern.json`

## 它是什么

`/patterns/rank-topology-3d/` 的**简洁抽象版**。同一个题面——「五刀切完之后，这一份落到哪张卡上」——
换一种画法：不用 Three.js 转动的三维卡阵，改用
[compute-graph-viewer 的抽象图网页 prompt](https://github.com/yinyucheng0601/compute-graph-viewer/blob/main/docs/抽象图网页prompt.md)
（深色极简、无边框灰卡、语义配色只落在训练语义图元上、直角连线、不搭装饰性中间层）画成一张固定
16:9 画布的组织关系图，纯 HTML / CSS / SVG，零第三方依赖。

规模也简化到 **TP2 × PP2 × DP2 = 8 卡、省略 EP**：只求「组织关系一眼看懂、点一张卡看它的执行活动
与激活驻留」，不追求覆盖完整并行度组合、六档通信切换或真实计时——那些仍然是
`/patterns/rank-topology-3d/` 的题面，这一份不重复。

## 结构

- **组织树**（上半屏）：模型 → PP（层段）→ TP（张量切片）→ Rank 导航条（DP 副本），自上而下展开，
  同级从左到右排列，用分区标题 + 直角连线表达共同父级，不为每一层单独起卡片。
- **Rank 详情**（下半屏）：点一张 Rank 导航条之后，用「执行活动」与「激活驻留」两组共同标题
  直接连接各自的内容卡片（抽象图 prompt 原句给的例子）：
  - **执行活动**——前向（蓝）→ 通信（绿）→ 反向（粉）→ 通信（绿）→ 优化器（橙）五个色块，
    宽度只表达相对占比，没有真实计时依据，标题下方写明「长度示意 · 非实测」。
  - **激活驻留**——低透明度紫色长条，两端菱形端点：亮紫 `#A856F7` 是驻留产生、
    黄绿 `#88C911` 是释放，边界描边是这张图里唯一保留的描边（因为轮廓本身表达驻留区间的语义）。

选中一张 Rank 后，它的组织树路径（模型 → 所在 PP → 所在 TP → 这张 Rank）保持常态，
其余分支的文字适度降低透明度——但不改变颜色编码本身，也不隐藏其他 Rank 的导航条（仍可点选）。

## URL 参数

| 参数 | 取值 | 作用 |
|---|---|---|
| `rank` | `0`–`7` | 初始选中哪张卡（TP2×PP2×DP2 的 global rank）；不给或非法值退回 `0`，不报错 |
| `embed` | `1` | 嵌入形态：收起顶栏（标题 / Run 信息 / 完整版链接）与页脚（图例 / 状态行） |

## 颜色语义（沿用 `/patterns/rank-topology-3d/` 的映射，不为视觉均衡换色）

| 语义 | 颜色 |
|---|---|
| 前向 | `#4469EF` |
| 反向 | `#FF4C7C` |
| 通信 | `#05D793` |
| 优化器 | `#FFAA3B` |
| 激活驻留 | `#8E4ACE`（低透明度长条） |
| 驻留产生端点 | `#A856F7` |
| 释放端点 | `#88C911` |

## 它不回答什么

- **完整的并行度组合**（preset / 自定义 tp·cp·pp·dp·ep、ZeRO 档位、物理平铺）——那是
  `/patterns/rank-topology-3d/` 的题面，这一份固定死 TP2×PP2×DP2=8、省略 EP。
- **六档通信切换**（谁和谁 / 搬的是什么 / token 去哪 / 何时 / 代价 / rank 内）——简洁版只画一次
  执行活动的示意色块，不做逐层切换。
- **真实计时**——执行活动块的宽度与激活驻留条的长度都没有真实耗时依据，页面上一律标
  「示意 / 非实测」；真正按字节算出的传输时间下界在 `/patterns/rank-topology-3d/`。

## 嵌入

```html
<iframe src="/patterns/rank-topology-lite/pattern.html?embed=1&rank=5"
        style="width:100%;height:100%;border:0"></iframe>
```

## 依赖

无第三方依赖（无 three.js、无 CDN 字体或脚本）。整个 pattern 只有四个文件：
`pattern.html` + `pattern.css` + `pattern.js` + `favicon.svg`。

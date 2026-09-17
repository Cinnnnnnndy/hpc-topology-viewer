# 模型分片与训练设备映射 · 简洁版 · Pattern

> 构建产物：`/patterns/rank-topology-lite/pattern.html`
> 完整交互版：[`/patterns/rank-topology-3d/`](../rank-topology-3d/pattern.html)（Three.js、六档通信、preset/ZeRO/物理平铺、十层可观测性）
> 契约：同级 `pattern.json`

## 它是什么

`/patterns/rank-topology-3d/` 的**简洁版**。同一个题面——「五刀切完之后，这一份落到哪张卡上」——
保留同一个核心比喻：**world 张卡壳排成的可转动三维阵列**。变的是引擎与控制面板，不是这个比喻本身：

- 三维阵列从 Three.js/WebGL 场景换成纯 **CSS 3D transform**（`perspective` + `preserve-3d`），
  零第三方依赖；
- 去掉六档通信切换、preset、ZeRO 档位、物理平铺这些控制面板，只留「转一转、点一张卡」；
- 规模简化到 **TP2 × PP2 × DP2 = 8 卡、省略 EP**。

选中一张卡之后，详情区换成
[compute-graph-viewer 的抽象图网页 prompt](https://github.com/yinyucheng0601/compute-graph-viewer/blob/main/docs/抽象图网页prompt.md)
的画法（深色极简、无边框灰卡、语义配色只落在训练语义图元上、直角连线、不搭装饰性中间层）——
这一份只用在详情区，3D 卡阵本身仍然是卡片 + 空间位置，不是这份 prompt 描述的平面关系图。

## 结构

- **3D 卡阵**（上半屏）：8 张卡按 `(TP, PP, DP)` 摆成一个可转动的立方阵列——水平 = TP、
  纵向 = PP、深度 = DP。默认静置时缓慢自转；拖动可以任意角度查看；拖一下或选中一张卡之后
  自转停住，方便看清当前选中的是哪张。卡阵下方另有一条等高短横线导航条（`R0`–`R7`）
  作为精确点选的兜底——卡阵转到某个角度时后排的卡不好点，这一条稳定可点。
- **Rank 详情**（下半屏）：选中一张卡之后，用「执行活动」与「激活驻留」两组共同标题
  直接连接各自的内容卡片（抽象图 prompt 原句给的例子）：
  - **执行活动**——前向（蓝）→ 通信（绿）→ 反向（粉）→ 通信（绿）→ 优化器（橙）五个色块，
    宽度只表达相对占比，没有真实计时依据，标题下方写明「长度示意 · 非实测」。
  - **激活驻留**——低透明度紫色长条，两端菱形端点：亮紫 `#A856F7` 是驻留产生、
    黄绿 `#88C911` 是释放，边界描边是这张图里唯一保留的描边（因为轮廓本身表达驻留区间的语义）。

选中一张卡后，其余卡（3D 卡阵里的和导航条上的）适度降低透明度——但不改变颜色编码本身，
也不隐藏它们，仍可再次点选。

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

无第三方依赖（无 three.js、无 CDN 字体或脚本）。3D 卡阵是纯 CSS 3D transform，不是 WebGL 场景。
整个 pattern 只有四个文件：`pattern.html` + `pattern.css` + `pattern.js` + `favicon.svg`。

# 模型分片与训练设备映射 · 黑白版 · Pattern

> 链接：`/patterns/rank-topology-mono/pattern.html`（自包含，带 `?v=<短SHA>` 版本戳）
> 源：`public/patterns/rank-topology-mono/`（pattern.html / pattern.css / pattern.js / pattern.json 同级）
> 题面与 `/patterns/rank-topology-3d/` 相同，画法不同；**没有合并进 demo.html**，是另一个页面。

## 它答什么

**五刀切完之后，这一份落到哪张卡上。** 但这一版不逐卡铺壳：world 张卡里真正不同的只有
`pp × (tp, ep)` 这几种**分片**，DP / CP 只是把同一份复制 N 遍。所以画的是分片——
128 卡是 32 个平面、4000 卡是 40 个平面——每个平面右上角的标注写着它被复制了几遍、
选中的那张卡坐标是什么。

每个平面里是一张 **层 × 算子块** 的正方形宫格：

| 行 | 列 |
|---|---|
| 这一段的每一层（PP 决定拿哪几层） | `embed / lm_head` · `attn.q` `attn.kv` `attn.out` · `norm×2` `router` · 专家桶 0–7 |

- TP 切的块（attn.q / kv / out、embed）只有 1/TP 份 → 灰一档；
- EP 决定哪几个专家桶是实的、哪几个是空的；
- 复制的块（norm、router）每卡都有，但字节小，灰度低——log 尺度让它仍然看得见。

## 三种口径（顶部切换）

| 口径 | 格 | 柱 |
|---|---|---|
| 权重 | 该层该块在本卡上的 bf16 字节 | 本卡权重合计 |
| 通信 | 每步跨卡字节：DP 梯度覆盖全部块，TP 落在行切块（attn.out）出口，PP 落在段边界（末层 norm 发 / 首层 attn.q 收）；EP 各边不等**不给数**，画空心记号 | 本卡每步跨卡字节 |
| 显存 | 模型态 W + ∇W + O（ZeRO 之后） | HBM 合计（含激活、碎片），横线 = 64 GB 容量 |

数值口径逐条照搬 `demo.html`（`opBytes` / `paramsPerCard` / `memParts` / `commLoad9`），
坐标算术同源（`order = tp‑cp‑dp‑pp`，EP 折进 tp·cp·dp 平面）。

## 视觉规则（黑白极简）

- 只用中性灰，R = G = B：背景 `#111111`，表面 `#131313–#282828`，主文字 `#E8E8E8`，次文字 `#A0A0A0`；
  纯白 `#FFFFFF` 只给选中平面的边框与选中柱的编号。
- 固定斜向平行投影 `matrix(.72 .33 0 1 x y)`，各层同向等距，段与段之间加大一档间距；
  宫格随平面一起投影，横向收缩，格子不被拉宽。
- 选中的平面**沿原层序向上抽出**，仍被前方平面部分遮挡，不置顶。标注在它左上侧，一根细引线。
- 轮廓 1.5px 直边；小按钮 5px 圆角；没有渐变、阴影、发光。Inter 400–500，数字等宽对齐。
- 柱状选择器：每段一行、共用基线；每根柱一种分片、下面一个编号；只在选中柱顶显示数值。
  同组标记（TP / DP / EP / PP）只提亮编号、在平面右上加一枚白点，**不改柱高**。

## 参数表

| 参数 | 值 | 说明 |
|---|---|---|
| `preset` | `default128` `dense64` `longcp` `moe64` `pangu` | 预置；`pangu` = 盘古 Pro MoE · 4000 卡（tp8·pp5·dp100·ep2） |
| `tp` `cp` `pp` `dp` `ep` `etp` `world` `layers` `ga` `mbs` | 整数 | 覆盖预置；非法值退回最近合法值 |
| `mode` | `weight` `comm` `hbm` | 口径 |
| `sel` | global rank | 选中哪张卡 |
| `group` | `none` `tp` `dp` `ep` `pp` | 同组标记 |
| `zero` | 0–3 | ZeRO 档位（只影响显存） |
| `embed` | 1 | 嵌入形态，收起页头 |

示例：`pattern.html?preset=pangu&mode=hbm&zero=1&sel=23&group=tp`

## 嵌入

```html
<iframe src="/patterns/rank-topology-mono/pattern.html?embed=1&preset=pangu&zero=1"
        style="width:100%;height:100%;border:0"></iframe>
```

宿主 `postMessage({type:'pto:state', sel, mode, group, zero, preset})` 推状态；本页每次状态变化
回报同一形状的消息。不认识的参数一律忽略，非法值退回默认，不报错。

## 不做什么

- 不画时间轴、不画通信边的耗时——那是「时间·流」与 3D 版 `cgrain=cost` 的题面。
- 不画物理链（超节点 / 机柜 / UB 与 RoCE）——3D 版 `?phys=1` 有。
- 不给 CP / EP 的通信字节：CP 逐跳一块 KV、EP 由 top-k 路由当场决定，硬凑一个数就是把示意值当成算出来的。

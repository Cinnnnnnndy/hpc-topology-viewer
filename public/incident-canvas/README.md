# 故障故事线 · 无限画布（`incident-canvas`）

**主视图永远是并行拓扑 pattern 本体**——就是你打开 [`/combo-workbench/`](../combo-workbench/)
在舞台上看到的那张「模型分片与训练设备映射」，不是另画一份像它的图。画布围着它长。

## 合的是哪几份

| 出处 | 这一页拿走的是 |
|---|---|
| 本仓 `/patterns/net-slicing/` | **主视图**，以及「整网 · 真图展开」那一格。两格是同一个 pattern 的两份配置：主视图五刀全落并进卡维度（问「切完之后落成 world 张卡」），整网那格独独不落 DP、不进卡维度（问「一张整网被切成什么」）。 |
| 本仓 `/combo-workbench/swimlane.html` | 「泳道 · 微批次生命周期」那一格，compute-graph-viewer 的上游拷贝，原样嵌入。 |
| `compute-graph-viewer` 的 [`config-relation-observer.html`](https://github.com/yinyucheng0601/compute-graph-viewer/blob/main/Profiling_Insight_and_Tool/training-run-twin-standalone/config-relation-observer.html) | **故事线与数据**：两条问题线、11 个运行事件、传播源→受影响、5 套机制相位、11 张证据图与全部读数。数值逐条照搬，一个没改。 |
| `pangu_sophon_pytorch` | 「训推大盘」那一格的**指标口径**：十条关键少数各由哪段代码算出、期望往哪个方向走，加五个早停钩子。**只取口径，不取值。** |

前两份嵌的是**规范路径上的本体，不是拷贝**——所以「画布里的那一份」和「直接打开那条链接」
永远是同一个文件、同一个版本。

## 「无限画布」是字面意思：下钻 = 在画布上展开一格

主视图钉在原点、永远在，不提供收起——它是这一页的主语。别的格子按需展开，各自落在画布上
自己那个位置，用一条贝塞尔连回主视图。**展开得越多，画布越大**；收起就是那一格的 ×。

```
                    ┌── 故事线 · 运行事件 ──┐
                    └──────────┬───────────┘
   ┌── 整网 ──┐          ┌─────┴──────┐        ┌── 事件传播 ──┐   ┌── 证据 ──┐
   │ 真图展开 │ ───────  │  主视图     │ ────── │  机制舞台   │   │ 单卡解剖 │
   └──────────┘          │  并行拓扑   │        └─────────────┘   └──────────┘
                         └─────┬──────┘
                    ┌──────────┴───────────┐
                    │ 泳道 · 微批次生命周期 │   训推大盘
                    └──────────────────────┘
```

展开的入口长在主视图自己的格头上（整网 / 泳道 / 故事线 / 大盘 那排筹码）；
点故事线上的事件会一并摊开「事件传播 + 证据」，事件里再点「看机制 ▸」摊开机制舞台。
`Esc` 从最外面那一格开始收。

## 联动搭在**层号**上，不是 rank

这是一处必须说清的口径差异：

- 故事线讲的是一个 **2048 卡的实跑**（PP4 × EDP8 × EP64，`rank 1559` / `1553` 是那个集群里的门牌）；
- 被嵌的 pattern 画的是它自己那个 **128 卡的演示集群**（`world 128 · TP2 × PP4 × DP16 · EP8`，与组合工作台同一套缺省）。

两边卡数不同，**rank 号天然对不上**。把 1559 推过去要么无声无息（它那儿只有 R0–R127），
要么照亮一张根本不是那张的卡——后者比不亮更坏。也试过让 pattern 直接画 2048 卡：
DP 512 行会退化成一条看不清的斜线，还要 12 秒才画完，那不是「更真」，是把主视图毁了。

**层号则是两边都成立的主键**：L38 在故事线里落在 PP3（L34–L45），在 pattern 的 48 层口径里
也落在 PP3（L36–L47）——同一段流水线。所以选中一个事件，主视图点亮**承载这一层的那些卡**，
pattern 自己会在角上报「L38 · 32 张卡 · 各持 1/16，无一张完整」，并注明这是
「来自另一个视图的联动高亮，不是这一屏的选中」。rank 只从 pattern 流回来
（读者在整网那格点算子 → 主视图照亮那一层），不往它那儿推。

## 五种机制

`router-collapse`（路由塌缩）· `barrier-wait`（barrier 语义）· `pp-cascade`（依赖链回压）·
`activation-lifetime`（存活区间叠加）· `fragmented-oom`（碎片）。

没有共用一张「通用示意图」：五条机制本来就不是同一件事。比如 `pp-cascade` 把
「2048 卡停摆」拆成一条可验算的乘法链 `1 →×EP64→ 64 →×EDP8→ 512 →×PP4→ 2048`，
每一步都是一个已知的并行度，而不是一句「故障扩散」。

## 训推大盘：十条关键少数 + 五个钩子

口径来自 `pangu_sophon_pytorch`——真正会在每个 `log_interval` 被打印、写进
TensorBoard / Prometheus 的就这几条：

| 指标 | 期望 | 出处 |
|---|---|---|
| `lm loss` | ↓ | `loss_func()` → `training_log()` |
| `grad_norm` | 稳定 | `training_log()` |
| `loss_scale` | 不触发 | `logger_and_track_metrics_callback.py:74` |
| `num_zeros_in_grad` | ↓ | `training_log()` |
| `throughput`（TFLOP/s/GPU） | ↑ | `PretrainMetricConfig._compute_throughput` |
| `MFU`（%） | ↑ | `PretrainMetricConfig._compute_mfu` |
| `throughput_per_day`（B tokens/day） | ↑ | `_build_log_dict:1505` |
| `elapsed time / iter`（ms） | ↓ | `_build_log_dict:1491` |
| `learning_rate` | 按计划 | lr scheduler（cosine / WSD） |
| `mem_reserved_bytes`（GB） | 平稳 | NPU 保留显存 / `theoretical_memory` |

五个早停钩子：`check_for_nan_in_loss_and_grad`、`loss_spike_monitor_callback`、
`init_heartbeat_monitor_pid`、`_warn_data_production_speed`、`mem_reserved_bytes` 增长趋势。
每个钩子下面一排小点是本条故事线的事件序列，在哪个事件上触发就点亮哪一颗——
**一颗都不亮也是信息**：这两条线里「数据生产速度告警」一次都没响过。

> **只取口径，不取值。** 大盘上每一个数都能在故事线的同一个事件里找到原文；
> 没采到的格子一律写「—」，不替它编一个。代码里这两份也是分开放的：
> `GROUPS` 是照搬的故事线，`BOARD` 只是这一层的口径映射。

## URL 即这一屏

`?g=problem-2&e=p1-a2a&ph=4&r=1559&open=story,netgraph,swimlane,event,mech,evidence&theme=dark`

故事线 / 事件 / 机制相位 / 单卡 / **摊开了哪几格** / 明暗。`open` 是这一页的重点：
一条链接不只带住「看的是哪个事件」，还带住「当时摊开了哪几块证据」。
`?embed=1` 收顶栏；`postMessage({type:'pto:state', theme|group|event|rank})` 与
combo-workbench 同一套约定。

## 相对路径只有一处

整页只有 `var BASE` 知道自己离站点根有多深（`/incident-canvas/` 是 `'..'`，
`/patterns/incident-canvas/` 是 `'../..'`），三格 iframe 的地址都从它拼。
发布步骤按入口 sed 这一行，并用断言兜住——BASE 错了不会报错，只会让三格静默 404、
显示兜底文案，是从线上看不出来的那种坏法。

本地直接开 `public/` 时那三格是空的（被嵌的是构建期产物），有兜底文案说明；
要看真样子得看发布后的站点。

# 故障故事线 · 无限画布（`incident-canvas`）

把两个已有的 demo 合成一页：

| 出处 | 这一页拿走的是 |
|---|---|
| `compute-graph-viewer` 的 [`config-relation-observer.html`](https://github.com/yinyucheng0601/compute-graph-viewer/blob/main/Profiling_Insight_and_Tool/training-run-twin-standalone/config-relation-observer.html) | **故事线与数据**：两条问题线、11 个运行事件、传播源→受影响、5 套机制相位（`mechanism.phases`）、11 张证据图（`evidence.chart`）与全部读数。数值逐条照搬，一个没改。 |
| 本仓的 [`/combo-workbench/`](../combo-workbench/) | **形制与视觉语言**：PTO token（浅色优先 + `[data-theme=dark]` 单块覆盖）、ide-frame 的渐变光晕底与磨砂面板、顶栏 + 舞台骨架、URL 即这一屏、`pto:state` 主题桥。 |
| `pangu_sophon_pytorch-master` | **训推指标的口径**：「关键少数」十条（`lm loss` / `grad_norm` / `loss_scale` / `num_zeros_in_grad` / `throughput TFLOP/s/GPU` / `MFU` / `throughput_per_day` / `elapsed time per iter` / `learning_rate` / `mem_reserved_bytes`）与它们各自由哪段代码算出来，以及五个异常检测钩子。**只取口径，不取值**——值仍旧只引用故事线原文。 |

它自己新出的那一件事是**编排**。组合工作台是「摞格子」——格子的位置由台面定，格与格之间靠消息对齐；
这一页是「**一个主视图 + 四周卫星**」：主视图坐在画布正中，五块卫星（故事线 / 作用面 / 读数 /
证据 / 泳道）围着它，用贝塞尔连线接回中心，当前跟着主视图变的那几块会亮起来。

## 「无限画布」是字面意思：下钻 = 往画布外再铺一站

这一点是这一页与「一块能缩放的屏幕」的分界，也是它最要紧的机制：

**下钻不把中心那块的内容换掉，而是把整个星系搬到一个新原点**，原地留下一张虚线的
**轨迹卡**，两站之间用一条长曲线连起来。于是画布真的随着探索变大——缩小就能看见
自己走过的整条路径，点任一张轨迹卡原路退回。

```
第 1 站            第 2 站            第 3 站                      第 N 站
整网 2048 卡 ──→  All-to-all 超时 ──→ 机制 · barrier 语义 ──→ …  ┌───────────────┐
（轨迹卡）         （轨迹卡）          （轨迹卡）                  │ 完整星系：     │
                                                                 │ 主视图 + 5 卫星 │
                                                                 └───────────────┘
```

站与站按 `(1500, 820)` 的步距往右下走成阶梯，缩放下限放到 0.09——
**「总览 · 整条路径」那一屏是一张地图，不是阅读态**（和 Figma / Miro 缩到底一个道理）。
进页面落在**当前这一站**（带 `?e=&r=&lane=` 的深链一进来就该是能读的那一屏），
整条路径要按「总览」或双击空白才去。换站时镜头带缓动飞过去；同一站里换事件、
换相位不动镜头——跟着每次点击跑会晕。

## 下钻链

```
整网 2048 卡  ─点一张卡→  单卡解剖  ─点「放到时间轴上」→  时间泳道
     │                                                        └─「训推大盘 ▸」→ 训推大盘
     └─点故事线上的事件→  传播关系  ─点「看机制」→  机制舞台（四相可播）
```

整页只有**一条**下钻链（`levelChain()`）：主视图看哪一档、面包屑有几级、画布上走到第几站，
三件事全从它读。以前各写一份判断，加一档就得三处同时改，漏一处就错位。
面包屑就是这条链的可视形态，点哪一级退回哪一级（`Esc` 退一级）。

## 五档主视图

| 档 | 回答 |
|---|---|
| **整网全景** | 2048 张卡按 PP4 × EDP8 × EP64 摆开，按「离震中多远」染成四档 |
| **传播关系** | 传播源 → 途经 → 受影响；中间那栏是事件自己写的链路，不是按范围反推的 |
| **机制舞台** | 范围图答「打到了谁」，机制图答「凭什么传过去」——五种机制各一套自绘 SVG |
| **单卡解剖** | 64 GB 容量柱 + 装了哪几层 + 持有哪几个专家 + 四条通信端口此刻在做什么 |
| **时间泳道** | 前四档答的都是空间；「63 张卡空等 30 s」里最要紧的那个量是时间，只在时间轴上才有形状 |
| **训推大盘** | 把同一时刻摆回训练框架真的在盯的那块表：十条关键少数 + 五个早停钩子（见下） |

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

五个早停 / 异常检测钩子：`check_for_nan_in_loss_and_grad`、`loss_spike_monitor_callback`、
`init_heartbeat_monitor_pid`、`_warn_data_production_speed`、`mem_reserved_bytes` 增长趋势。
每个钩子下面一排小点就是本条故事线的事件序列，在哪个事件上会触发就点亮哪一颗——
**一颗都不亮也是信息**：这两条线里「数据生产速度告警」一次都没响过。

> **只取口径，不取值。** 大盘上每一个数都能在故事线的同一个事件里找到原文；
> 故事线没采到的格子一律写「—」，不替它编一个。大盘上最容易骗人的正是
> 「看起来每格都有数」。代码里这两份也是分开放的：`GROUPS` 是照搬的故事线，
> `BOARD` 是这一层的口径映射。

## 拓扑口径

`global rank = stage×512 + edp×64 + ep`。这条式子同时解释了故事线里那两个门牌：
`1559 = 3×512 + 0×64 + 23`（PP3 / EP23，问题2 的首个阻塞卡）、
`1553 = 3×512 + 0×64 + 17`（PP3 / EP17，问题1 的首个 OOM 卡）。
46 层按 PP 分四段 `L0-11 / L12-23 / L24-33 / L34-45`，L38 落在 PP3——两条故事线的病灶都在这一层。

## URL 即这一屏

`?g=problem-2&e=p1-a2a&ph=4&r=1559&lane=1&b=1&theme=dark`
（故事线 / 事件 / 机制相位 / 下钻到的卡 / 泳道是否在中心 / 训推大盘是否在中心 / 明暗）。
参数越多，进来时就已经站在越靠后的那一站，前面几站会以轨迹卡的形式排在它左上方。
`?embed=1` 收起顶栏；`postMessage({type:'pto:state', theme|group|event|rank})` 与
combo-workbench 同一套约定，所以这一页可以直接当成那块台面上的一格嵌进去。

## 自包含

token、样式、数据、全部图元都在 `index.html` 这一份里，零外部依赖，也不引 CDN。
整页可直接拷走。发布时同时落两个入口：
`/incident-canvas/`（短链接）与 `/patterns/incident-canvas/pattern.html`（规范位置，
`pattern.json` 契约同级）。

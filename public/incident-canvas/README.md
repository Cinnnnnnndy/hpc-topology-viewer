# 故障故事线 · 无限画布（`incident-canvas`）

把两个已有的 demo 合成一页：

| 出处 | 这一页拿走的是 |
|---|---|
| `compute-graph-viewer` 的 [`config-relation-observer.html`](https://github.com/yinyucheng0601/compute-graph-viewer/blob/main/Profiling_Insight_and_Tool/training-run-twin-standalone/config-relation-observer.html) | **故事线与数据**：两条问题线、11 个运行事件、传播源→受影响、5 套机制相位（`mechanism.phases`）、11 张证据图（`evidence.chart`）与全部读数。数值逐条照搬，一个没改。 |
| 本仓的 [`/combo-workbench/`](../combo-workbench/) | **形制与视觉语言**：PTO token（浅色优先 + `[data-theme=dark]` 单块覆盖）、ide-frame 的渐变光晕底与磨砂面板、顶栏 + 舞台骨架、URL 即这一屏、`pto:state` 主题桥。 |

它自己新出的那一件事是**编排**。组合工作台是「摞格子」——格子的位置由台面定，格与格之间靠消息对齐；
这一页是「**一个主视图 + 四周卫星**」：主视图坐在无限画布正中，五块卫星（故事线 / 作用面 / 读数 /
证据 / 泳道）围着它，用贝塞尔连线接回中心，当前跟着主视图变的那几块会亮起来。
**点主视图里的东西就下钻**，每下钻一级，主视图换一张图、四周五块同时改写自己的内容。

## 下钻链

```
整网 2048 卡  ─点一张卡→  单卡解剖  ─点「放到时间轴上」→  时间泳道
     │
     └─点故事线上的事件→  传播关系  ─点「看机制」→  机制舞台（四相可播）
```

面包屑就是这条栈的可视形态，点哪一级退回哪一级（`Esc` 退一级）。

## 五档主视图

| 档 | 回答 |
|---|---|
| **整网全景** | 2048 张卡按 PP4 × EDP8 × EP64 摆开，按「离震中多远」染成四档 |
| **传播关系** | 传播源 → 途经 → 受影响；中间那栏是事件自己写的链路，不是按范围反推的 |
| **机制舞台** | 范围图答「打到了谁」，机制图答「凭什么传过去」——五种机制各一套自绘 SVG |
| **单卡解剖** | 64 GB 容量柱 + 装了哪几层 + 持有哪几个专家 + 四条通信端口此刻在做什么 |
| **时间泳道** | 前四档答的都是空间；「63 张卡空等 30 s」里最要紧的那个量是时间，只在时间轴上才有形状 |

## 五种机制

`router-collapse`（路由塌缩）· `barrier-wait`（barrier 语义）· `pp-cascade`（依赖链回压）·
`activation-lifetime`（存活区间叠加）· `fragmented-oom`（碎片）。

没有共用一张「通用示意图」：五条机制本来就不是同一件事。比如 `pp-cascade` 把
「2048 卡停摆」拆成一条可验算的乘法链 `1 →×EP64→ 64 →×EDP8→ 512 →×PP4→ 2048`，
每一步都是一个已知的并行度，而不是一句「故障扩散」。

## 拓扑口径

`global rank = stage×512 + edp×64 + ep`。这条式子同时解释了故事线里那两个门牌：
`1559 = 3×512 + 0×64 + 23`（PP3 / EP23，问题2 的首个阻塞卡）、
`1553 = 3×512 + 0×64 + 17`（PP3 / EP17，问题1 的首个 OOM 卡）。
46 层按 PP 分四段 `L0-11 / L12-23 / L24-33 / L34-45`，L38 落在 PP3——两条故事线的病灶都在这一层。

## URL 即这一屏

`?g=problem-2&e=p1-a2a&ph=4&r=1559&lane=1&theme=dark`
（故事线 / 事件 / 机制相位 / 下钻到的卡 / 泳道是否在中心 / 明暗）。
`?embed=1` 收起顶栏；`postMessage({type:'pto:state', theme|group|event|rank})` 与
combo-workbench 同一套约定，所以这一页可以直接当成那块台面上的一格嵌进去。

## 自包含

token、样式、数据、全部图元都在 `index.html` 这一份里，零外部依赖，也不引 CDN。
整页可直接拷走。发布时同时落两个入口：
`/incident-canvas/`（短链接）与 `/patterns/incident-canvas/pattern.html`（规范位置，
`pattern.json` 契约同级）。

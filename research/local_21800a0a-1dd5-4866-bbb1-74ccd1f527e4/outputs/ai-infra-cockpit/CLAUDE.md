# CLAUDE.md — AI Infra 统一驾驶舱

大模型训练/推理运行时监控诊断工具的**交互原型**（单文件 HTML + Three.js r128 CDN）。
当前版本 v20，入口 `index.html`。视觉基于 PTO 设计系统（`vendor/pto-design-system/` 的 foundation/semantic/components token），默认 `<html data-theme="light">`；本地 CSS 变量（--bg/--panel/--txt…）已重映射到 PTO 语义 token，切主题只需改 data-theme。顶栏三组下拉（着色/连线/形态，`.menu`+`.menu-panel`，点击外部关闭）收纳原先平铺的 ~30 个按钮；场景剧本行为主操作常驻。data-viz 语义色（COL{} 十六进制）在 JS 内，不随主题变。模型侧数据为 Pangu Pro MoE 72B-A16B 真实参数（arXiv:2505.21411）：48 层、64 路由专家=8 组×组内 top-1（MoGE）+4 共享、专家占权重 95%；吞吐/负载均衡叙事同源。设计事实源：`docs/交互与联动设计文档.md`（13 章，含联动矩阵、版本决策、路线图）。

## 快速开始

- 运行：浏览器直接打开 `index.html`（需联网加载 cdnjs 的 three.js r128）。
- 回归测试：`npm i jsdom three@0.128.0 && node tools/harness.js`（jsdom + WebGLRenderer stub，模拟点击断言状态机，见文件头注释）。
- 语法检查：把 `<script>` 内容抽出后 `node --check`。

## 代码结构（index.html 单 `<script>`，按注释分节）

| 分节注释 | 内容 |
|---|---|
| `数据模型` | 常量（N_HOST=1024, N_CHIP=8192, TP8×PP16×DP64, 64 层整网）、health/expertHosts/anomExperts/JOBS/memLevel 伪遥测 |
| `Smartscape 式筛选下钻` | relSet/filterInfo/setFilter/renderFilterBar/updateCounts/updateLevelKPI/renderTopN |
| `左侧页签 1：2D 层级剖面` | L7-L0 行、cvL3/cvL2/cvL4 画布、锚定弧线 drawArcs（含 podSel 归属链） |
| `左侧页签 2：整网分隔映射` | 64 层×128 卡矩阵 renderMM、显存面板、选择 setModelSel |
| `右侧：统一 3D 拓扑` | 场景/hostPos/chipPhys/chipCubeM(5 种魔方排列)/chipStack/stackGroup/cubeGroup/memMesh |
| `3D 通信线` | buildComm 分发：buildPhysLines(维度)/buildFlowLines/buildLinkLines/buildPathLines(PXN 3hop vs 1hop) + cubeComm（魔方内）；EP 异常受 S.scatter 控制（SCATTER_XDC 对比） |
| `颜色/Morph/指示器` | applyColors（instanceColor）、applyMorph（三形态权重混合 Wgt）、updateIndicators |
| `相机` | camGoal（按 level/form/cubeMode）、updateCamera（阻尼+下钻分级淡化） |
| `全局状态机` | 透镜/连线镜头/形态/排列/异常/时间轴 handlers |
| `场景剧本` | scenario(k)：patrol/moe/slowdp/deep/deploy/reset 一键编排 |
| `模式 B` | 抽屉三页签：renderLane（泳道+同轴计数器轨）/renderBw（busbw 基线）/renderMx（通信矩阵） |
| `主循环` | loop：权重推进→applyMorph→buildComm→applyColors→相机→渲染 |

## 全局状态 `S`（单一状态源，改状态不直接改视图）

`lens`(着色透镜) · `wire`(连线镜头) · `level`(L7-L0) · `focusHost/focusChip` · `filterHost+rel`(下钻) ·
`selLayer/selCard`(整网选择) · `focusPod`(SN) · `form+cubeMode`(形态/排列) · `phase/t/playing`(时间) · `anomaly`

## 关键约定（改代码前必读）

1. **物理是唯一位置基准**；逻辑只以着色/连线/下钻叠加。着色互斥、连线按阶段过滤、算子只下钻不平铺。
2. **同一批实体多种呈现**：Host/芯片位置 = phys/cube/stack 三形态按权重 `Wgt` 混合插值（applyMorph），任何新"视图"应实现为新的位置映射函数，而不是新建实体。
3. **软硬结合**：色相=软件分组，明度=硬件利用率；形变=容量（显存水位条）；连线=软件通信域×硬件流量/链路健康；泳道下方计数器轨与软件块同时间轴。
4. **TDZ 陷阱**：脚本大量 const/let + 分节顺序，新增顶层语句若引用后文声明（如 `$`、`drawer`）必须延迟到事件/init 时执行（历史 bug：topn 监听器）。
5. 修改后跑 `tools/harness.js`，新交互请顺手加断言。

## 下一阶段施工图

`docs/设计系统与数据接入规划.md`：①设计系统（三层 Token、组件清单、模块化/TS 工程化路径）
②真实数据替换（DataSource 接口定义、昇腾栈数据源映射表、MockSource 重构 → 遥测 → trace → HCCL 的五步施工顺序）。
**做数据接入时先做第 1 步纯重构（MockSource 抽取，harness 全绿），再逐源替换。**

## 已知缺口（详见 docs 文档第 11/13 章）

统一选择模型（filterHost 与 selLayer 两套并存）、全文本可点、导航历史栈、真实数据源接入
（MindStudio Insight / PyTorch Profiler trace）、万卡 LOD、逐 NPU overlap% 排名、工况（Prefill/Decode）维度。

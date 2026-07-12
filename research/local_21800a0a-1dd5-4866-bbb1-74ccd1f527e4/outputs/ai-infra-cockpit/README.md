# AI Infra 统一驾驶舱（原型 v20）

大模型训练/推理运行时监控诊断工具的交互原型：一个 Atlas 950 超节点（8192 NPU）的
物理集群 ⇄ 逻辑魔方 ⇄ 层级堆叠统一 3D 视图 + Smartscape 式下钻 + 整网分隔映射 + 模式 B 深潜（泳道/busbw/通信矩阵）。

## 使用

浏览器直接打开 `index.html`（需联网加载 three.js CDN）。建议体验路径：
场景剧本栏依次点 🩺巡检 → 🚨MoE 越界诊断 → 🐢找慢副本 → 🔬单机深潜；再试魔方形态的五种排列切换。

## 目录

```
index.html          当前版本（=history/v20）
vendor/pto-design-system/  PTO 设计系统 token/css（foundation·semantic·components·style）
CLAUDE.md           给 Claude Code 的工程上下文（架构图、状态机、约定、陷阱）
docs/
  上游设计文档_训练监控可视化.md    产品/领域设计（12 章：并行策略、NCCL/HCCL、双模式…）
  交互与联动设计文档.md            交互事实源（13 章：原则、联动矩阵、版本决策、路线图）
  设计系统与数据接入规划.md        下一阶段施工图：Token/组件化/工程化路径 + DataSource 接口与真实数据替换顺序
history/            v2(Gemini)→v17 全部版本，docs 第 10 章有各版关键决策
tools/harness.js    jsdom 运行时回归测试（npm i jsdom three@0.128.0 && node tools/harness.js）
```

## 版本脉络（细节见 docs/交互与联动设计文档.md 第 10 章）

v4 统一 3D 单相机 · v5 Smartscape 下钻 · v6 层级反馈+L4 机柜 · v7 模式 B+SP/CP ·
v8 任务透镜+魔方多排列 · v9-v10 联动修复+L5 语义 · v11-v12 IDE 分屏+泳道动态化+遮挡治理 ·
v13 魔方通信线 · v14 场景剧本 · v15 TP/PP 专属排列 · v16 软硬形态映射 · v17 业界范式（计数器轨/通信矩阵/Top5 分诊） · v18 NCCL 语义深化（PXN 消息路径镜头/散射对比/双 Channel/算法 HUD） · v19 真实数据注入（Pangu Pro MoE 72B-A16B，arXiv:2505.21411）+ 排列选型论证 · v20 接入 PTO 设计系统（默认 light）+ 顶栏按钮分组下拉 · v21 彻底 light 化（3D 光照/网格/机柜/Host 材质、浮层玻璃底、Mode-B 画布、压暗色）+ 关系筛选选中态实心强化

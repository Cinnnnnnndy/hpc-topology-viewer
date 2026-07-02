# hw-native-sys 层级坐标规范（L7 → L0）——所有视图统一遵循

> 参照 hw-native-sys（compute-graph-viewer）7+1 级递归层级。本仓库唯一层级编号来源为
> `src/scene/data.ts` 中的 `HW_LEVELS` / `HW_BY_KEY` / `UB_COORD`（helper：`levelTag/levelName/levelFull`）。

## 层级表

| L | key（代码内部） | 名称 | 英文 | 通往下一级的互联 | 备注 |
|----|----------------|------|------|------------------|------|
| L7 | `global`（UB_COORD 里为 `job`） | 全球调度 | Global | **DCN**（跨地域数据中心网络） | sibling 样例 Global A/C |
| L6 | `cluster` | 集群 | Cluster | **Scale-Out**（跨 Pool UBoE/RoCE 全光） | |
| L5 | `pool` | 服务池 | Service Pool | **Pool 内互联**（Pool 内 Pod 间） | 新增级；`PODS_PER_POOL = 4` |
| L4 | `super` | Pod · 超节点 | Pod · UBL128 | **Scale-Up**（柜内 nD-FullMesh + UB 交换 Clos） | **机柜 `cab` 并入本级**，无独立 L 级、tag 为 '' |
| L3 | `node` | Host · 节点 | Host · 1 OS | **PCIe / UB** | 1 CPU + 8 NPU 同挂 1 OS |
| L2 | `card` | Chip · NPU | Chip · NPU | **封装互连**（Die 间 UB/SIO · D2D 784 GB/s） | rank ↔ device 1:1 |
| L1 | `die` | Die | Die | **NoC**（片上互联核组） | **可选级**（单 die 芯片可省略） |
| L0 | `core` | 核组 | Core-Group | 内部：MTE / FixPipe 流水 | 成员 = AIV·向量 / AIC·Cube / AICPU；**`tile` 归入 L0 内部**（tag ''） |

## 关键规则

1. **L 编号唯一**：`L0`…`L7` 只表示上表层级。旧 UB 互联层级（`UB_LEVELS`）已改用互联名
   id（`NoC·D2D` / `UB·Host` / `SU·柜内` / `SU·Pod` / `SO`），任何视图不得再把互联层级标成 L0–L4。
   物理交换芯片名 “L1 交换 / L2 交换”（switch tier）是产品名，保留不变。
2. **并入级**：机柜（cab）显示为 “机柜（并入 L4 Pod）”、无 L tag；Tile 显示为 “Tile（L0 内）”。
3. **可选级**：Die 标注 “L1 · 可选”。
4. **L0 内部组织统一复用 memory-architecture pattern**（`src/view/CoreGroupPattern.tsx`）：
   GM / L2 Cache 轨道 + AIV1 / AIC / AIV2 + UB/L1/L0A/L0B/L0C/BT/FP 缓冲 + MTE1/MTE2/MTE3/FixPipe 路由。
   2D / 工作台 / 运行状态视图钻取到 L0（core / tile）时渲染该组件；运行相位经
   `phaseKind`（load/compute/comm/mem/store）驱动路由高亮与缓冲占用。3D 场景的 die 内部
   （DieDetail）按同一 pattern 的结构组织（GM/L2 轨道 → AIV/AIC/AIV 块 → 缓冲 → MTE 路径）。
5. **并行维度落位**（`PARTITION_META`）：TP=L3 Host 内 · EP=L4 Pod 内机柜域 · PP=L4 Pod 内跨 Host ·
   DP=跨 Pod（L5 Pool / L6 Cluster）。
6. 旧→新对照：超节点 L5→**L4 Pod**、节点 L4→**L3 Host**、卡 L3→**L2 Chip·NPU**、
   计算 Die L2→**L1 Die（可选）**、AI Core L1→**L0 Core-Group**、Tile L0→**L0 内部**。
   集群 L6 不变；新增 L5 服务池、L7 全球调度（原 job）。

# HPC Topology Viewer

Interactive 3D viewer for a large-scale HPC accelerator cluster — racks, compute
nodes, and the interconnect fabric — built with **React + Three.js**
(`@react-three/fiber` + `@react-three/drei`). Geometry is **procedural by
default**, with an **optional open-source GLB swap layer**: drop a correctly
named `.glb` into `src/scene/models/` and the matching part (NPU module, CPU,
blade, cabinet, DIMM, optic, DPU, PSU, CDU, switch line-card) renders the real
model instead — no code edits, automatic fall-back if absent. See
[`src/scene/models/README.md`](src/scene/models/README.md) for the part list and
download guide.

## Views

- **Overview** — 16 cabinets (12 compute + 4 switch) with inter-cabinet optical links.
- **Cabinet** — drill into one cabinet: power shelf, management blade, compute nodes, liquid-cooling manifold.
- **Node** — a compute blade (accelerators, CPUs, on-board L1 switch chips, DPU, optics) and the on-board switch device.
- **Topology** — two-tier non-blocking Clos: all compute cabinets → 7 switch planes → cross-node RDMA / VPC planes, with hover-to-highlight uplinks.

Every interactive element shows a hover tooltip. The seven recurring colors map to
the seven independent switch planes (each plane is its own non-blocking fabric).

## Rubik-cube pattern（逻辑魔方 · 独立迭代）

The cockpit's 逻辑魔方 (4 问题导向形态 + 1 基准投影 · 轴标注 · 正交 2D/剖面 ·
四维通信组) is also extracted as a standalone, parallelism-configurable pattern
for independent iteration — lands on **PP流水 · TP2×PP4×DP16 = 128 ranks**
(EP8 folded into DP), with Pangu Pro MoE's real strategy (TP8×PP5×DP100 = 4000)
one click away as a preset. Entry page:
`public/rubik-pattern.html` (dev: `/hpc-topology-viewer/rubik-pattern.html`);
sources & docs: [`public/vendor/rubik-cube/`](public/vendor/rubik-cube/README.md).
设计 Pattern 规范（场景说明 / 场景引导 / 场景设计 / 正例与反例 / 设计资源 /
设计原则 · 浅色默认 · 内嵌可交互示例）：`public/rubik-pattern-spec.html`
(dev: `/hpc-topology-viewer/rubik-pattern-spec.html`)。

发布后的三条链接（Pages，见 `.github/workflows/deploy.yml`）：

| 链接 | 是什么 |
|---|---|
| `…/patterns/rubik-cube-logical/pattern.html` | pattern 本体的**规范位置**，`pattern.css/js/json` 同级，可直接 `<script src>` 复用 |
| `…/rubik/` | 早先的短链接，保持可用 |
| `…/rubik-spec/` | **设计 Pattern 规范页**，自包含、不并进 `/patterns/` 那套目录；支持 `?theme=dark`，章节锚点 `#s1`…`#s8` |

三个目录各由自己那条分支的 workflow 叠加发布；Pages 每次部署整体替换，
所以另一条分支（或 main）发布之后，重跑本分支的 workflow 即可找回自己的目录。
Integration hooks for the whole-network graph / expert graph are pre-wired
(`selectLayer` / `selectBucket` / `onSelect`).

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build to dist/
npm run preview
```

## Content encoding (anti-scrape)

All product/brand display strings live in `src/content.ts` as **base64(UTF-8)**
and are reconstructed at runtime by `src/codec.ts` (`dc()`), so the committed
source tree (and the built bundle) contain no plaintext product names — a
repository grep or code search finds nothing; the terms only materialize in the
browser at runtime.

The plaintext generator that produces `content.ts` is intentionally **kept out
of version control** (`scripts/` is git-ignored) so the plaintext never lands in
the repo. `content.ts` is the committed, encoded artifact.

The deployment is also marked `noindex` (see `index.html` meta tags and
`public/robots.txt`) so crawlers do not index it.

## Notes

Cabinet outer dimensions use the published envelope; in-cabinet and on-board
layouts are schematic abstractions based on public material and do not represent
real engineering layouts.

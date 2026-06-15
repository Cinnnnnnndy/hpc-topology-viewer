# HPC Topology Viewer

Interactive 3D viewer for a large-scale HPC accelerator cluster — racks, compute
nodes, and the interconnect fabric — built with **React + Three.js**
(`@react-three/fiber` + `@react-three/drei`). Everything is **procedurally
modeled** (no GLB/external 3D assets).

## Views

- **Overview** — 16 cabinets (12 compute + 4 switch) with inter-cabinet optical links.
- **Cabinet** — drill into one cabinet: power shelf, management blade, compute nodes, liquid-cooling manifold.
- **Node** — a compute blade (accelerators, CPUs, on-board L1 switch chips, DPU, optics) and the on-board switch device.
- **Topology** — two-tier non-blocking Clos: all compute cabinets → 7 switch planes → cross-node RDMA / VPC planes, with hover-to-highlight uplinks.

Every interactive element shows a hover tooltip. The seven recurring colors map to
the seven independent switch planes (each plane is its own non-blocking fabric).

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

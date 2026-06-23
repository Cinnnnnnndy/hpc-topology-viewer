#!/usr/bin/env node
/**
 * convert-to-glb.mjs — convert open-source hardware models to optimized GLB and
 * drop them where the model-registry auto-detects them.
 *
 * Usage:
 *   node scripts/convert-to-glb.mjs <input-file> <part-id> [--draco]
 *
 * IMPORTANT: <part-id> MUST equal a CatalogPart.id (see src/scene/parts-catalog.ts)
 *   e.g.  an OAM accelerator model → part id "npu-accelerator-module"
 *
 * Examples:
 *   node scripts/convert-to-glb.mjs ~/Downloads/oam.glb  npu-accelerator-module
 *   node scripts/convert-to-glb.mjs ~/Downloads/dimm.obj mem-ddr5-rdimm
 *
 * Output: src/scene/models/<part-id>.glb  → auto-loaded, no code edits needed.
 *
 * Supported inputs:
 *   .glb / .gltf   → optimize                       (via npx gltf-pipeline)
 *   .obj           → convert + optimize             (via npx obj2gltf + gltf-pipeline)
 *   .stl / .step   → not pure-Node; use step-to-glb.mjs (STEP) or Blender (STL)
 *
 * Compression: by default NO Draco (so runtime needs no external decoder — keeps
 *   the offline / noindex deployment self-contained). Pass --draco to shrink the
 *   file (then the browser fetches the Draco decoder at load time).
 *
 * No package.json deps are added — tools are fetched on demand via `npx`.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../src/scene/models');

const args = process.argv.slice(2).filter((a) => a !== '--draco');
const useDraco = process.argv.includes('--draco');
const [inputArg, nameArg] = args;

if (!inputArg || !nameArg) {
  console.error('用法: node scripts/convert-to-glb.mjs <输入文件> <part-id> [--draco]');
  console.error('示例: node scripts/convert-to-glb.mjs ~/Downloads/oam.glb npu-accelerator-module');
  process.exit(1);
}

const input = resolve(process.cwd(), inputArg);
if (!existsSync(input)) {
  console.error(`✗ 找不到输入文件: ${input}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const out = resolve(OUT_DIR, `${nameArg}.glb`);
const ext = extname(input).toLowerCase();
const dracoFlag = useDraco ? ' -d' : '';

function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

try {
  if (ext === '.glb' || ext === '.gltf') {
    run(`npx --yes gltf-pipeline -i "${input}" -o "${out}"${dracoFlag}`);
  } else if (ext === '.obj') {
    const tmp = resolve(OUT_DIR, `${nameArg}.tmp.glb`);
    run(`npx --yes obj2gltf -i "${input}" -o "${tmp}" -b`);
    run(`npx --yes gltf-pipeline -i "${tmp}" -o "${out}"${dracoFlag}`);
    rmSync(tmp, { force: true });
  } else if (ext === '.stl' || ext === '.step' || ext === '.stp' || ext === '.iges' || ext === '.igs') {
    console.error(`\n✗ ${ext} 无法在纯 Node 直接转换。`);
    if (ext === '.step' || ext === '.stp') {
      console.error('  STEP → 用全自动脚本: node scripts/step-to-glb.mjs ' + inputArg + ' ' + nameArg + '\n');
    } else {
      console.error('  方案 1 — Blender：导入 → File → Export → glTF 2.0 (.glb)，再跑本脚本压缩');
      console.error('  方案 2 — STL 在线转 GLB: https://products.aspose.app/3d/conversion/stl-to-glb\n');
    }
    process.exit(2);
  } else {
    console.error(`✗ 不支持的格式: ${ext}`);
    process.exit(1);
  }

  console.log(`\n✓ 完成: ${out}`);
  console.log(`已按 part id「${nameArg}」命名，model-registry 会自动加载，刷新页面即可生效。`);
  console.log(`⚠ 若仍是程序化几何：确认 ${nameArg} 与 parts-catalog.ts 里的 id 完全一致。\n`);
} catch (err) {
  console.error('\n✗ 转换失败:', err.message);
  process.exit(1);
}

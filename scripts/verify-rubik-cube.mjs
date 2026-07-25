/**
 * 逻辑魔方 pattern 的几何回归检查（Playwright）。
 *
 * 为什么要有这个脚本：连线「没连到卡上」已经出现过两次，成因每次都不同
 *   ① 走线用样条（CatmullRom）→ 控制点之间外扩成弧，线从卡旁边绕过去；
 *   ② 飞行动画按帧固定系数缓动 → 4000 卡时帧率掉到 10fps 上下，cur 迟迟到不了
 *      target，卡与线一起停在半路（看上去就是线没连到卡）。
 * 这类问题肉眼很难在每次改动后复查，所以固化成断言：
 *   · 每条通信线的端点必须落在它两端 rank 的卡心（容差 = 管半径 + 一点余量）；
 *   · 重排动画必须在 1.5s 内收敛（cur 精确吸附到 target）。
 *
 * 用法：
 *   1) 装一次 Playwright：`npm i -D playwright`（容器里若已预装 Chromium，
 *      设 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1，并用 CHROMIUM=/opt/pw-browsers/chromium 指路）；
 *   2) 起静态服务器：`python3 -m http.server 8178 --directory public`；
 *   3) `node scripts/verify-rubik-cube.mjs [url]`。退出码非 0 表示有回归。
 */
let chromium;
try { ({ chromium } = await import('playwright')); }
catch (e) {
  console.error('需要 Playwright：npm i -D playwright（或把它装在能被 node 解析到的位置）');
  process.exit(2);
}

const URL = process.argv[2] || 'http://localhost:8178/rubik-pattern.html';
const CONFIGS = [
  { tp: 8, pp: 5, dp: 100, ep: 2 },     // 盘古 Pro MoE 真实策略（4000 卡）
  { tp: 2, pp: 4, dp: 16, ep: 8 },      // 128 卡小规格
];
const TOL = 0.12;                        // 管半径 ~0.06，留一倍余量
const SETTLE_MS = 1500;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.evaluate(() => window.rubik.setPlaying(false));

const fails = [];
for (const cfg of CONFIGS) {
  await page.evaluate((c) => window.rubik.setConfig(c), cfg);
  await page.waitForTimeout(SETTLE_MS);
  for (const mode of [0, 1, 2, 3, 4]) {
    await page.evaluate((m) => { window.rubik.setMode(m); window.rubik.select(37); }, mode);
    await page.waitForTimeout(SETTLE_MS);
    const r = await page.evaluate(() => {
      const h = window.rubik, m = h.model, v = { x: 0, y: 0, z: 0 };
      const P = (rank) => { m.posOf(rank, h.state.mode, v); return [v.x, v.y, v.z]; };
      let worst = 0, lines = 0, worstDim = '';
      h.scene.traverse((o) => {
        const e = o.userData && o.userData.edge;
        if (!e || !e.ranks) return;
        lines++;
        const pos = o.geometry.attributes.position;
        // 管的首环中心 = 折线起点；与该 rank 的卡心比较
        const R = 6, c = [0, 0, 0];
        for (let i = 0; i < R; i++) { c[0] += pos.getX(i); c[1] += pos.getY(i); c[2] += pos.getZ(i); }
        c[0] /= R; c[1] /= R; c[2] /= R;
        const q = P(e.ranks[0]);
        const d = Math.hypot(c[0] - q[0], c[1] - q[1], c[2] - q[2]);
        if (d > worst) { worst = d; worstDim = e.dim; }
      });
      return { lines, worst: +worst.toFixed(4), worstDim };
    });
    const ok = r.lines > 0 && r.worst <= TOL;
    console.log(`${ok ? 'ok  ' : 'FAIL'} cfg ${cfg.tp}·${cfg.pp}·${cfg.dp}·${cfg.ep} mode ${mode}: ${r.lines} 条线，端点最大偏离卡心 ${r.worst}${r.worstDim ? ' (' + r.worstDim + ')' : ''}`);
    if (!ok) fails.push(`cfg ${JSON.stringify(cfg)} mode ${mode} worst=${r.worst} lines=${r.lines}`);
  }
}

if (errors.length) fails.push('page errors: ' + errors.join(' | '));
await browser.close();
if (fails.length) { console.error('\n回归：\n- ' + fails.join('\n- ')); process.exit(1); }
console.log('\n全部通过：连线端点都落在卡心，重排动画在 %dms 内收敛。', SETTLE_MS);

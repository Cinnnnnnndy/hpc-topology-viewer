import { chromium } from 'playwright';
const SP='/tmp/claude-0/-home-user-hpc-topology-viewer/a1c7fe8d-5ec1-5239-a2b2-8be8b10295fa/scratchpad';
const B = 'http://127.0.0.1:8099/parallel-topology/demo.html';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const [n,q] of [
  ['norank','?view=chain&embed=1'],
  ['norank-sel','?view=chain&embed=1&sel=37'],
  ['norank-top','?view=chain&embed=1&vtab=top'],
  ['rank','?view=chain&embed=1&card=1'],
  ['front','?view=chain&embed=1&card=1&vtab=front'],
  ['front-norank','?view=chain&embed=1&vtab=front'],
]) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  await p.goto(B+q, { waitUntil: 'networkidle' });
  await p.waitForTimeout(q.includes('front') ? 10000 : 3000);
  const s = await p.evaluate(() => {
    const t = [...document.querySelectorAll('#stage text')].map(e=>e.textContent);
    const dk = [...document.querySelectorAll('#deck .pt-axlab')].map(e=>e.textContent);
    return { svgGroups: t.filter(x=>x.startsWith('EP 组')).length,
             deckGroups: dk.filter(x=>x.startsWith('EP 组')).length,
             deckBoxes: document.querySelectorAll('#deck .pt-epbox').length,
             deckEpTags: dk.filter(x=>/^ep\d+$/.test(x)).length };
  });
  await p.screenshot({ path: `${SP}/nr2-${n}.png` });
  console.log('—', n.padEnd(13), JSON.stringify(s), errs.length ? 'ERR ' + errs.slice(0,2).join(' | ') : '');
  await p.close();
}
await b.close();

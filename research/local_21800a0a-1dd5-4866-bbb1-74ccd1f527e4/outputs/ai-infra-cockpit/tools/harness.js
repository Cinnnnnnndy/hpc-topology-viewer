/**
 * DOM 级运行时回归测试（无需真实浏览器/WebGL）
 * 用法：npm i jsdom three@0.128.0 && node tools/harness.js [html路径]
 * 原理：jsdom 加载页面 + 真 three.js（仅 stub WebGLRenderer 与 canvas 2d 上下文），
 *       执行主脚本后模拟点击并断言全局状态 S 的变化。
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(file, 'utf8');
const mainJs = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const cleaned = html
  .replace(/<script src=[^>]+><\/script>/, '')
  .replace(/<script>[\s\S]*?<\/script>/, '');

const dom = new JSDOM(cleaned, { pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;

// canvas 2d stub：吸收一切调用
window.HTMLCanvasElement.prototype.getContext = function () {
  const t = { measureText: () => ({ width: 10 }) };
  return new Proxy(t, { get: (o, k) => (k in o ? o[k] : (...a) => undefined), set: () => true });
};
// 真 three + WebGLRenderer stub
const THREE = require('three/build/three.js');
THREE.WebGLRenderer = class { constructor(){} setPixelRatio(){} setSize(){} render(){} };
window.THREE = THREE;

let rafQ = [];
window.requestAnimationFrame = fn => { rafQ.push(fn); return rafQ.length; };
const step = (n = 1) => { for (let i = 0; i < n; i++) { const q = rafQ; rafQ = []; q.forEach(f => f(performance.now())); } };

const errs = [];
window.addEventListener('error', e => errs.push(e.message));

// 暴露闭包内部状态供断言（S 等以 const/let 声明，不挂 window）
window.eval(mainJs + '\n;window.__T={get S(){return S},setFilter,setLevel,drawArcs};');
step(3);

const doc = window.document;
const g = expr => window.eval('__T.' + expr);
let fail = 0;
const check = (name, cond) => { console.log((cond ? '  ✔ ' : '  ✘ ') + name); if (!cond) fail++; };

console.log('=== 冒烟：初始状态 ===');
check('level=L4', g('S.level') === 'L4');
check('无脚本错误', errs.length === 0);

console.log('=== 层级行点击 ===');
for (const lv of ['L6', 'L5', 'L7', 'L3', 'L2', 'L4']) {
  doc.querySelector(`.lvrow[data-level="${lv}"]`).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('click ' + lv, g('S.level') === lv);
}

console.log('=== 下钻筛选 ===');
window.eval('__T.setFilter(320)');
check('filterHost=320 且 level=L3', g('S.filterHost') === 320 && g('S.level') === 'L3');

console.log('=== 顶栏/形态/剧本按钮 ===');
for (const id of ['btnStack', 'btnCube', 'btnPhys', 'btnAnom', 'btnPlay', 'tabModel', 'tabHier',
                  'btnModeB', 'drTabBw', 'drTabMx', 'drClose',
                  'scPatrol', 'scMoe', 'scSlow', 'scDeep', 'scDeploy', 'scReset']) {
  const el = doc.getElementById(id);
  if (!el) { check(id + ' 存在', false); continue; }
  el.click(); step(2);
  check(id + ' 点击无错', errs.length === 0);
}

console.log('=== 快速分诊 ===');
const top1 = doc.querySelector('#topn button');
if (top1) { top1.click(); check('Top1 点击→下钻', g('S.filterHost') != null); }

console.log(errs.length ? '累计错误: ' + JSON.stringify(errs.slice(0, 5)) : '无运行时错误');
console.log(fail ? `FAILED: ${fail}` : 'ALL PASS');
process.exit(fail ? 1 : 0);

---
name: shareable-pattern-link
description: 把一个可视化 pattern / 演示页发布成「一条链接就能交付」的形态——规范路径 /patterns/<id>/pattern.html + 同级 pattern.css/js/json、URL 即状态的参数、?v=<短SHA> 版本戳、旧链接别名、GitHub Pages 叠加发布与发布后校验。凡是用户提到「把这个页面/pattern 发给别人」「怎么分享这个链接」「别人怎么复用/嵌入我的组件」「链接里带上当前视图/配置」「发布到 GitHub Pages」「链接打开还是旧版/缓存」「别人打开看到的不是我这一屏」，或者在做 pattern 库、设计系统组件页、可交互 demo 的发布，都应该用这个 skill——即使他们没说「规范」「版本戳」这些词。
---

# 可分享的 pattern 链接

一个 pattern 页面做好之后，"交付"通常有三种含义，很多人只做到第一种：

1. **让人看** —— 打开链接就能交互；
2. **让人复现某一屏** —— 链接带着状态，对方打开就是你说的那个视图，不用口头指路；
3. **让人复用** —— 别人把它嵌进自己的页面，或者先读契约再决定怎么用。

这三件事对应三条约定：规范路径、URL 即状态、版本戳。缺一条就会退化成"你自己点一下第三个按钮，再切到深色"这种口头交付。

## 一、规范路径：pattern 与它的资源同级

```
/patterns/<pattern-id>/
├── pattern.html    ← 分享出去的链接
├── pattern.css
├── pattern.js
├── pattern.json    ← 机器可读契约（id/描述/API/规则/版本）
└── vendor/…        ← 第三方依赖（three.js、设计系统 token 等）
```

为什么不是 `/my-demo/index.html`：别人要复用时需要的是 `pattern.js` 和 `pattern.json` 的**稳定地址**，而不是去猜你把它藏在哪个 `vendor/` 子目录里。同级摆放之后，一条链接同时给出了三样东西——演示页、可 `<script src>` 的实现、可先读的契约。

**旧链接别名**：如果之前已经把某个路径发出去过，保留它（同一份内容复制两份，或做重定向）。链接一旦发出去就不再由你控制，换路径等于让别人手里的链接失效。

## 二、URL 即状态

页面启动时读 URL 参数，把它们落到组件的初始状态上。判断哪些参数值得支持：**凡是你会在口头交付里说的那句话，都应该能写进链接。**"你切到 EP 聚簇、着色选 EP、时间拖到 EP 阶段" → `?mode=ep&color=ep&phase=EP`。

实现要点（顺序很重要）：

- 能在 `mount()` 时传的（初始形态、主题、配置）就传进去，避免先渲染一次再跳变；
- 其余的在 mount 之后按序调 setter；
- **不认识的参数一律忽略，非法值退回默认，任何情况下不报错**——链接会被人手改、被聊天软件截断、被加上追踪参数，页面不能因此白屏。

```js
const qs = new URLSearchParams(location.search);
const pick = (k, map, dflt) => {
  const v = (qs.get(k) || '').toLowerCase();
  if (!v) return dflt;
  if (map[v] != null) return map[v];          // 语义名：?mode=ep
  const n = parseInt(v, 10);
  return isFinite(n) ? n : dflt;              // 也接受序号：?mode=2
};
```

参数名用**语义值**而不是内部序号（`?mode=ep` 比 `?mode=2` 可读、可手改、换实现也不会失效），同时兼容序号做后备。

在 README / pattern.json 里放一张参数表——链接的能力如果没人知道，等于不存在。

## 三、版本戳 `?v=<短 SHA>`

发布时给页面内每个本地资源链接追加 `?v=<短 SHA>`，并把同一个值写进 `pattern.json` 的 `version`。

解决两个具体问题：

- **缓存**：`pattern.html` 常被浏览器/CDN 缓存较短、`pattern.js` 较长，改完发出去对方看到的是新壳配旧脚本，表现为"你说的那个功能我这儿没有"；
- **对账**：对方截图反馈问题时，`pattern.json` 里的 `version` 能直接确认他看的是哪一版。

页面本身应当**忽略** `v` 参数——它只是给缓存看的。

## 四、GitHub Pages 叠加发布

具体的 workflow 片段（含 sed 改写、双入口、版本戳注入）见 `references/github-pages-overlay.md`。

一个容易踩的坑：**Pages 每次部署是整体替换**。如果主分支的 workflow 里没有这段叠加逻辑，主分支一发布，你叠加上去的目录就会消失。要么把叠加逻辑合进主分支的 workflow，要么在发布说明里写清"主分支发布后需重跑本分支 workflow"。

## 五、发布后校验（不要靠肉眼）

`scripts/verify-published-pattern.sh <base-url> <pattern-id>` 会检查：

- `pattern.html` / `pattern.css` / `pattern.js` / `pattern.json` 都是 200；
- `pattern.json` 里的 `version` 与页面里的 `?v=` 一致；
- 跨站引用可行（`access-control-allow-origin`）。

再加一条**带参链接的冒烟**：用一条组合参数的 URL 打开页面，读回组件状态确认每个参数都落到了位。用户手改一个参数就白屏是这类交付最常见的翻车方式，而它恰恰最容易自动化。

```bash
node -e '…' # 或用 Playwright：goto(带参 URL) → 读 window.<handle>.state 逐项断言
```

## 交付时怎么说

给对方的一句话里应当包含：规范链接、一条带状态的示例链接、以及"要嵌进自己页面就引这两个文件"。三样东西各对应上面一条约定：

```
看/用：      https://<host>/patterns/<id>/pattern.html
带状态：      https://<host>/patterns/<id>/pattern.html?mode=ep&color=ep&theme=light&v=<sha>
嵌进页面：    <script src="https://<host>/patterns/<id>/pattern.js"></script> + pattern.css
契约：        https://<host>/patterns/<id>/pattern.json   （version 可核对版本）
```

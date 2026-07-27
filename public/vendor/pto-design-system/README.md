# pto-design-system（上游快照）

原样取自 https://github.com/yinyucheng0601/pto-design-system ：`tokens/{foundation,semantic,components}.css`
与 `css/style.css`（类实现层：`.btn` / `.panel-shell` / `.stat-chip` / `.segmented-control` …）。

页面只 `@import './vendor/pto-design-system/styles.css'` 这一个入口；组件层不得硬编码颜色、圆角、
阴影、间距，一律 `var(--token)`。更新时重新覆盖这四个文件即可，不要在本目录里改动上游内容。

未引入上游 `tokens/fonts.css`（Google Fonts CDN），字体走 `--font-sans` / `--font-mono` 的回退链。

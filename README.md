# 组合工作台 · Standalone

这是 [`hpc-topology-viewer`](https://github.com/Cinnnnnnndy/hpc-topology-viewer) 主仓库
`main` 分支上 `/combo-workbench/` 的**独立、纯静态导出**——只保留渲染这一个工作台需要的
文件，去掉了主仓库里其它所有页面、React 工程壳和多分支发布流水线。

对应主仓库线上地址：<https://cinnnnnnndy.github.io/hpc-topology-viewer/combo-workbench/>

产品向说明（三格是什么、为什么这样切）见主仓库 `main` 分支的
[README.md「组合工作台」一节](https://github.com/Cinnnnnnndy/hpc-topology-viewer/blob/main/README.md)
与 `combo-workbench-开发引用手册.md`——这份仓库不重复搬运那些内容，只讲这份精简导出
本身怎么跑、怎么改。

## 怎么本地打开

纯静态文件，不需要 Node / npm / 任何构建步骤。用任意本地静态服务器打开即可
（直接双击用 `file://` 打开会因为浏览器的同源限制导致 iframe 嵌套页面加载不出来）：

```bash
npx serve .          # 或者
python3 -m http.server 8080
```

然后打开 `http://localhost:<port>/`——会自动跳转到 `/combo-workbench/index.html`。

## 目录结构

```
index.html                  ← 根路径重定向到 ./combo-workbench/index.html
combo-workbench/
├── index.html               ← 工作台本体：三格摞起来的台面（SLOTS 数组在这个文件里）
├── swimlane.html             ← 抽屉·微批次生命周期泳道（compute-graph-viewer 上游拷贝）
├── vendor/swimlane-task/     ← 泳道的渲染器
├── observatory/              ← 抽屉第四个 tab·通信观测台（自包含，含自己的 vendor 快照）
├── embed.css / embed-bridge.js  ← 内嵌桥，只用 .click() 驱动泳道已有控件
└── favicon.svg
parallel-topology/
└── demo.html                 ← 舞台两格（"并行拓扑" / "整网图"）实际嵌的是这一份文件
favicon.svg                  ← 网站图标（demo.html 引用 ../favicon.svg）
vendor/                       ← demo.html 需要的渲染器与设计系统 token
├── pto-design-system/
├── pto-tokens/
├── model-graphviz/
├── net-sharding/
├── rubik-cube/                （"关闭整网" 开关按下时才 loadOnce 进来）
└── three-r128.min.js
```

## 跟主仓库 main 分支的一处差异

主仓库里 `/combo-workbench/` 舞台两格 iframe 指向的是 `/patterns/net-slicing/pattern.html`
——这是 `main` 的 `deploy.yml` 在发布时**现场生成**的产物（把 `parallel-topology/demo.html`
的相对 vendor 路径拍平、打版本戳、注入默认 `view`/`embed` 参数），仓库源码里不存在这份
文件本体。

这份精简导出没有任何构建流水线，所以 `combo-workbench/index.html` 里两格的 `src()`
改成**直接引用 `../parallel-topology/demo.html`**，并显式带上 `embed=1`（`demo.html`
本身原生支持这个参数，`.pt-root.embed` 会收起顶栏/页脚只剩画布——跟 `pattern.html`
效果完全一致，不是新行为）。除了这一处 URL 改写，`combo-workbench/index.html` 与
`main` 上的源文件逐字节一致。

## 更新到 main 的最新版

这份分支不会自动跟着 `main` 更新。`main` 上 `public/combo-workbench/` 或
`public/parallel-topology/demo.html` 有改动之后，重新执行一遍上面「跟主仓库的差异」
里说的那处 URL 改写即可同步：

```bash
git fetch origin main
git checkout origin/main -- public/combo-workbench public/parallel-topology/demo.html
# 把 public/combo-workbench/* 拷到 combo-workbench/，public/parallel-topology/demo.html 拷到 parallel-topology/
# 再重复上面两处 pattern.html → parallel-topology/demo.html + embed=1 的改写
```

## 关于发布

这份分支**没有配自己的 GitHub Pages 发布流水线**，是有意如此：`main` 的
`deploy.yml` 顶部注释记着一段历史教训——同一个仓库如果有两条分支都能触发发布到
同一个 GitHub Pages 站点，会变成"谁最后跑谁赢"，已经发出去的链接内容随机跳变
（这仓库早年真实踩过三次）。如果你 fork 出去自己发布，去自己 fork 的
`Settings → Pages` 单独配一份 `GitHub Actions` workflow 发布这份目录即可，
不会跟主仓库的站点冲突（fork 是独立仓库，各自的 Pages 互不相干）。

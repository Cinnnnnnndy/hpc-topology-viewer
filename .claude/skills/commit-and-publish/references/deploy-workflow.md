# 部署 workflow：从零建一份 / 在已有那份上改

`pages-status.sh` 判定为 `none` 时看第一节，`live` / `workflow-only` 时看第二节。
叠加步骤本身怎么写（sed 改写、双入口、`?v=` 版本戳注入）已经在
`../../shareable-pattern-link/references/github-pages-overlay.md` 里，不重复。

## 一、从零建一份（PAGES: none）

`.github/workflows/deploy.yml`。这是最小可用版，纯静态站点连 build 步骤都可以删掉。

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]     # 要发布的分支都列在这里，漏了就不会触发
  workflow_dispatch:      # 留着它：不推代码也能手动重跑，排查问题时很有用

permissions:
  contents: read
  pages: write
  id-token: write

# 同一时刻只跑一个部署，且不打断进行中的那个
concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # 纯静态站点（只有 html/css/js，没有构建步骤）把这三步删掉，
      # 并把下面 upload 的 path 改成站点根目录，例如 ./public 或 .
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run build

      - uses: actions/configure-pages@v5
        with:
          enablement: true    # 第一次跑会自动开启 Pages（Source = GitHub Actions）

      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist          # 构建产物目录

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

**第一次跑几乎一定会在 deploy 步骤失败**，而且没有日志——build 明明是绿的。
那不是构建有问题，是分支不在 `github-pages` environment 的白名单里。到
`Settings → Environments → github-pages → Deployment branches and tags`
把分支名加进去，再重跑这一次 run 即可。知道这一条能省掉半小时的瞎找。

站点地址是 `https://<owner>.github.io/<repo>/`（全小写）。

## 二、在已有那份上改（PAGES: live / workflow-only）

**不要新增第二份 workflow 文件，不要换发布路径。** Pages 每次部署整体替换整个
站点，两份 workflow 各发各的会让站点内容随机变；换路径则会让已经发出去的链接失效。

改动清单，三条都要过一遍：

1. **触发**：新分支要能发布 → 分支名加进 `on.push.branches`。
2. **内容**：新目录要出现在站点上 → 在 build 之后加一段叠加步骤：

   ```yaml
   - name: Checkout <你的分支>
     uses: actions/checkout@v4
     with:
       ref: <你的分支>
       path: my-src        # 检出到子目录，别覆盖主分支的工作区

   - name: Overlay 到 /<你的路径>/
     run: |
       set -euo pipefail
       SHA=$(git -C my-src rev-parse --short HEAD)
       mkdir -p dist/<你的路径>
       cp -r my-src/public/<你的目录>/. dist/<你的路径>/
       echo "published: /<你的路径>/?v=$SHA"
   ```

3. **主分支同步**：主分支那份 workflow 通常叠加**全部**分支的目录。漏加一段，
   下次从主分支发布就会把你这个目录抹掉——表现为「昨天还好好的，今天 404」。
   加完顺手在 workflow 顶部的注释里补一行说明，下一个人才知道要同步。

### 各分支自己的 workflow

分支上跑的是**该分支自己那份** `deploy.yml`（不是主分支的）。所以：

- 只叠加自己那份的 workflow，一发布会让其它分支的目录暂时消失。找回方式是重跑
  受影响分支的 workflow，或者干脆重跑主分支（一次补齐所有目录）。
- 更省心的做法是让每条分支的 workflow 都叠加全部目录，这样谁发布都不会打掉谁。
  代价是新增目录时要改的文件更多——所以务必在注释里写清楚有哪几份要同步。

## 三、验证

```bash
scripts/pages-status.sh                      # 站点根目录活着吗
curl -sI "<你发布的具体页面 URL>" | head -1   # 你新加的那一页呢
```

根目录 200 不代表新页面 200。部署有 1–2 分钟延迟，push 完立刻打开多半是旧的——
等 workflow 跑完再验，别用肉眼在浏览器里刷。

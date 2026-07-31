---
name: commit-and-publish
description: 用仓库主人的身份提交并推送（绝不留 Claude 尾注、绝不让 @claude 变成 commit 作者），并把改动发布到 GitHub Pages——没有 Pages 就建一份部署 workflow，已经有就在原有那份上更新、保持链接不变。凡是用户说「提交」「commit」「推送」「push」「保存一下」「发布」「上线」「部署」「deploy」「发个链接」「更新那个页面」「发到 Pages」，或者你刚改完文件准备落盘、准备把页面发给别人看，都应该用这个 skill——包括用户只说「提交一下」这种最短的说法。改动要进版本库、或者要变成一条别人能打开的链接时，一律走这里。
---

# 提交、推送、发布

这件事有两个会**静默出错**的地方——不报错、看起来成功了，但结果是错的：

1. **提交身份**：云端沙箱的全局 `~/.gitconfig` 写的是 `Claude <noreply@anthropic.com>`。不管就提交，commit 的 Author 会变成 GitHub 上的 `@claude` 账号，仓库主人的贡献图上一片空白。message 末尾还会自动带上 `Co-Authored-By: Claude ...` / `Claude-Session: ...` 尾注。
2. **Pages 部署**：Pages 每次部署是**整体替换整个站点**，不是增量更新。所以「再建一份 workflow 发布我这部分」的直觉做法会把别人已经发出去的链接打成 404。

两件事都不会报错，所以别靠事后肉眼检查——用下面两个脚本，它们会把结果验给你看。

## 一、提交推送

```bash
.claude/skills/commit-and-publish/scripts/commit-push.sh -m "标题

正文" [路径...]
```

不给路径就暂存全部改动。脚本做的事，按顺序：

1. 确认 `user.email` 是仓库主人的身份，不是就地设置（仓库级配置优先于全局，沙箱重建也盖得住）；
2. 从 message 里剥掉 `Co-Authored-By: Claude` / `Claude-Session:` / `Generated with Claude Code` 这类尾注（有就报告剥了什么）；
3. 关掉 `commit.gpgsign`——沙箱那把签名 key 是 Anthropic 的，作者换成本人之后它验证不了，GitHub 会给每条 commit 挂黄色 Unverified 徽章；
4. 提交，然后**复核 HEAD 的 author**，不对就 `--amend --reset-author` 重来；
5. 推送，失败按 2/4/8/16 秒退避重试 4 次（网络抖动很常见，一次失败不代表推不上去）；
6. 打印最终的 author 与 commit 链接。

要手动做的话，关键是这三条——顺序不能反，`git config` 必须在 commit **之前**：

```bash
git config --local user.name  "Cindy_wxd"
git config --local user.email "209322477+Cinnnnnnndy@users.noreply.github.com"
git config --local commit.gpgsign false
```

提交后一定要复核 `git log -1 --pretty='%an <%ae>'`。出现 `noreply@anthropic.com` 说明配置没生效，`git commit --amend --reset-author` 重来。

### commit message 怎么写

看仓库已有的 message 风格再动手（`git log -20 --pretty=%s`）。这几个仓库的惯例是中文、标题一行说清「改了什么」，正文用 `·` 分条讲**为什么**——不是罗列文件名，而是说清这个改动解决的是哪个具体问题。读者是三个月后的自己。

不要写 `Co-Authored-By` 或 `Claude-Session` 尾注。`.claude/settings.json` 里的 `attribution` 已经把它们关掉了，但如果哪次配置没读到，你手写上去就等于自己把它加了回来。

## 二、GitHub Pages

先问脚本，别猜：

```bash
.claude/skills/commit-and-publish/scripts/pages-status.sh
```

它会输出四种判定之一，外加已有 workflow 的路径、`on.push.branches` 里的分支列表、站点 URL 与实际 HTTP 状态码：

| 判定 | 含义 | 怎么办 |
|---|---|---|
| `live` | 有 Actions workflow，站点 200 | 改现有那份 workflow |
| `workflow-only` | 有 workflow，站点没起来 | 先查最近一次 run，多半是 environment 白名单 |
| `live-no-workflow` | 站点 200，但没有 Actions workflow | Source 是「从分支目录发布」，直接往那个目录提交 |
| `none` | 都没有 | 新建一份 workflow |

### PAGES: live-no-workflow —— 直接往发布目录提交

站点在跑但仓库里没有部署 workflow，说明 Pages 的 Source 是「Deploy from a branch」，
内容直接来自某个分支的某个目录。更新内容就是往那个目录提交、推送，Pages 会自己重新发布。

**这时候千万别新建 Actions workflow**：带 `enablement: true` 的 `configure-pages`
会把 Source 切换成 Actions，原来的发布方式当场失效，站点内容会变成 workflow 产物。
发布源在 `Settings → Pages → Build and deployment` 可以确认。

按判定分三种走法：

### PAGES: live 或 workflow-only —— 在原有那份上改，别新建

**这是最要紧的一条。** 已经有部署 workflow 时，绝不要新增第二份 workflow 文件，也不要换发布路径。原因很直接：

- Pages 整体替换站点，两份 workflow 各发各的，谁最后跑完谁赢，站点内容会随机变；
- 链接一旦发出去就不再由你控制。换路径 = 让别人手里的链接失效。

要做的是**改现有那份**：

1. 新分支要能触发发布 → 把分支名加进 `on.push.branches`；
2. 新目录要出现在站点上 → 在构建步骤后面加一段叠加（checkout 该分支到子目录 → 拷进 `dist/<你的路径>/`）；
3. **主分支那份 workflow 也要同步加上这一段**。主分支的 workflow 通常叠加全部分支的目录，漏掉一个，下次从主分支发布就会把它抹掉——这是最常见的「昨天还好好的，今天 404 了」。

具体的 sed 改写、双入口、`?v=<短SHA>` 版本戳注入等写法，见 `references/deploy-workflow.md`。本仓库还有一个专讲可分享链接约定的 skill：`shareable-pattern-link`，发布 pattern / demo 页时配合用。

### PAGES: none —— 建一份

`references/deploy-workflow.md` 里有可直接抄的最小 workflow（含 `enablement: true`，第一次跑会自动开启 Pages）。

建完第一次跑，**build 成功但 deploy 秒失败且没有日志**是预期内的：那是分支不在 environment 白名单里，不是构建有问题。到 `Settings → Environments → github-pages → Deployment branches and tags` 把分支名加进去，再重跑这次 run。

### 发布后校验

Pages 部署有延迟，push 完立刻打开多半还是旧的。等 workflow 跑完再验，别用肉眼：

```bash
.claude/skills/commit-and-publish/scripts/pages-status.sh   # 站点 200 了吗
curl -sI "<你发布的具体页面 URL>" | head -1                  # 你这一页 200 了吗
```

站点根目录 200 不代表你新加的那一页 200——一定要验**你实际要发出去的那条 URL**。

## 交付给用户时说什么

提交推送后给出：author 是谁、commit 短 SHA、推到了哪条分支。
涉及 Pages 时补上：站点 URL、这次改的是哪个目录、以及部署 run 的状态（跑完了没有）。

如果部署还在跑，说清楚「已推送，Pages 部署约 1–2 分钟后生效」，不要说「已发布」——用户照着链接点过去看到旧内容，会以为改动丢了。

#!/usr/bin/env bash
# 判断本仓库的 GitHub Pages 是「还没有」「配了但没上线」还是「已经在跑」，
# 好决定是新建部署 workflow 还是在原有那份上改。
#
#   pages-status.sh [仓库路径]
#
# 输出第一行是判定，供脚本/人一眼取用：
#   PAGES: none           —— 没有任何部署 workflow → 新建一份
#   PAGES: workflow-only  —— 有 workflow 但站点没上线 → 多半是 environment 分支白名单
#   PAGES: live           —— 站点在跑 → 改现有那份，别新建、别换路径
#
# 后面列出 workflow 路径、会触发发布的分支、站点 URL 与实际状态码。
set -uo pipefail

# 默认认「脚本所在的那个仓库」（每个仓库各有一份副本），给了路径参数就用参数。
# 按 cwd 取仓库会在从别处调用时静默看错仓库。
if [ $# -ge 1 ]; then
  cd "$1" || exit 1
else
  cd "$(dirname "$0")" || exit 1
fi
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -n "$ROOT" ] || { echo "不在 git 仓库里" >&2; exit 1; }
cd "$ROOT" || exit 1

# origin 可能是 https://github.com/Owner/Repo(.git)，也可能是沙箱代理的
# http://local_proxy@127.0.0.1:PORT/git/Owner/Repo —— 一律取最后两段。
SLUG="$(git remote get-url origin 2>/dev/null \
  | sed -E 's#\.git$##; s#.*[/:]([^/]+/[^/]+)$#\1#')"
OWNER="${SLUG%%/*}"
REPO="${SLUG##*/}"
OWNER_LC="$(printf '%s' "$OWNER" | tr '[:upper:]' '[:lower:]')"

# 找出用 Pages 部署 action 的 workflow
WFS=""
if [ -d .github/workflows ]; then
  WFS="$(grep -rlE 'actions/(deploy|configure)-pages' .github/workflows 2>/dev/null | sort)"
fi

# 站点 URL：<owner>.github.io/<repo>/，仓库名恰为 <owner>.github.io 时是根域名；
# 有 CNAME 文件则以自定义域名为准。
CNAME="$(find . -maxdepth 3 -name CNAME -not -path './.git/*' -print -quit 2>/dev/null)"
if [ -n "$CNAME" ] && [ -s "$CNAME" ]; then
  URL="https://$(head -1 "$CNAME" | tr -d '[:space:]')/"
elif [ "$OWNER_LC.github.io" = "$(printf '%s' "$REPO" | tr '[:upper:]' '[:lower:]')" ]; then
  URL="https://$OWNER_LC.github.io/"
else
  URL="https://$OWNER_LC.github.io/$REPO/"
fi

CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$URL" 2>/dev/null || echo 000)"

if [ -n "$WFS" ] && [ "$CODE" = "200" ]; then
  VERDICT="live"
elif [ -n "$WFS" ]; then
  VERDICT="workflow-only"
elif [ "$CODE" = "200" ]; then
  # 站点活着但仓库里没有 Actions 部署 workflow —— Pages 的 Source 是
  # 「Deploy from a branch」，内容直接来自某个分支目录。
  VERDICT="live-no-workflow"
else
  VERDICT="none"
fi

echo "PAGES: $VERDICT"
echo "repo:  $SLUG"
echo "url:   $URL  -> HTTP $CODE"

if [ -n "$WFS" ]; then
  echo "workflow:"
  printf '%s\n' "$WFS" | sed 's/^/  /'
  for wf in $WFS; do
    echo "  $wf 的 on.push.branches:"
    # 两种写法都要认：行内数组 `branches: [main, dev]`，以及下面挂 "- 分支名" 的块状列表
    awk '
      /^[[:space:]]*branches:[[:space:]]*\[/ {
        line = $0
        sub(/^[^[]*\[/, "", line); sub(/\].*$/, "", line)
        n = split(line, a, ",")
        for (i = 1; i <= n; i++) {
          gsub(/^[[:space:]"'"'"']+|[[:space:]"'"'"']+$/, "", a[i])
          if (a[i] != "") print "    " a[i]
        }
        next
      }
      /^[[:space:]]*branches:/ { inb=1; next }
      inb && /^[[:space:]]*-[[:space:]]/ { gsub(/^[[:space:]]*-[[:space:]]*/,""); print "    " $0; next }
      inb && /^[[:space:]]*[a-zA-Z_]+:/ { inb=0 }
    ' "$wf"
  done
fi

case "$VERDICT" in
  none)
    echo
    echo "→ 新建一份部署 workflow，模板见 references/deploy-workflow.md"
    echo "  第一次跑 build 成功但 deploy 秒失败没日志 = 分支不在 environment 白名单里，"
    echo "  到 Settings → Environments → github-pages 加上分支名再重跑。" ;;
  workflow-only)
    echo
    echo "→ workflow 在，站点没起来。先看最近一次 run 的结论，别急着新建 workflow。"
    echo "  最常见原因：分支不在 github-pages environment 的白名单里（deploy 步骤秒失败且无日志）。" ;;
  live-no-workflow)
    echo
    echo "→ 站点在跑，但仓库里没有 Actions 部署 workflow —— Pages 的 Source 是"
    echo "  「Deploy from a branch」，内容直接来自某个分支目录（常见是 main / 或 gh-pages 的 root|docs）。"
    echo "  更新内容 = 直接往那个分支的那个目录提交，push 完 Pages 自己会重新发布。"
    echo "  **别新建 Actions workflow**：带 enablement 的 configure-pages 会把 Source 切成"
    echo "  Actions，原来的发布方式当场失效。确认发布源：Settings → Pages → Build and deployment。" ;;
  live)
    echo
    echo "→ 站点已在跑。改**现有**这份 workflow，不要新增第二份、不要换发布路径："
    echo "  ① 新分支要触发发布 → 加进 on.push.branches"
    echo "  ② 新目录要出现 → 加一段叠加步骤（checkout → 拷进 dist/<路径>/）"
    echo "  ③ 主分支那份 workflow 同步加上，否则下次从主分支发布会把它抹掉"
    echo "  Pages 每次部署整体替换站点——两份 workflow 各发各的，谁最后跑完谁赢。" ;;
esac

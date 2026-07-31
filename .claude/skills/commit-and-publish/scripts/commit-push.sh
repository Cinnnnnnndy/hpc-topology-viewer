#!/usr/bin/env bash
# 用仓库主人的身份提交并推送，把两件会静默出错的事挡在前面：
# commit 的 Author 变成 @claude，以及 message 里混进 Claude 尾注。
#
#   commit-push.sh -m "标题
#
#   正文" [路径...]
#
# 不给路径就暂存全部改动（等价 git add -A）。
# 每一步都会把结果验给你看；任何一步验不过就非 0 退出，不会「看起来成功了」。
set -uo pipefail

FALLBACK_NAME="Cindy_wxd"
FALLBACK_EMAIL="209322477+Cinnnnnnndy@users.noreply.github.com"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

MSG=""
while [ $# -gt 0 ]; do
  case "$1" in
    -m|--message) MSG="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    --) shift; break ;;
    -*) die "未知参数 $1" ;;
    *) break ;;
  esac
done
[ -n "$MSG" ] || die '缺少 -m "<message>"'

# 认「脚本所在的那个仓库」，而不是当前工作目录所在的仓库。每个仓库各有一份
# 自己的副本，从别处调用时按 cwd 取仓库会静默作用到错误的仓库上——那种错误
# 不报错、只是什么都没提交，最难发现。脚本不在任何仓库里时才退回 cwd。
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)"
[ -n "$ROOT" ] || ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -n "$ROOT" ] || die "不在 git 仓库里"
cd "$ROOT" || die "进不去仓库根目录 $ROOT"
echo "repo: $ROOT"

# ── 1. 身份 ────────────────────────────────────────────────────────────
# 仓库自带的 hook 是身份的唯一事实来源（含「已经是本人就不动」的白名单）。
# 没有 hook 的仓库才退回下面写死的常量。
HOOK=".claude/hooks/set-git-identity.sh"
if [ -x "$HOOK" ]; then
  CLAUDE_PROJECT_DIR="$ROOT" "$HOOK" || die "hook $HOOK 执行失败"
else
  echo "no $HOOK — 用内置常量设置身份"
  git config --local user.name  "$FALLBACK_NAME"
  git config --local user.email "$FALLBACK_EMAIL"
fi
git config --local commit.gpgsign false

NAME="$(git config user.name || true)"
EMAIL="$(git config user.email || true)"
[ -n "$EMAIL" ] || die "user.email 仍为空"
case "$EMAIL" in
  *anthropic.com) die "user.email 仍是 $EMAIL —— 提交下去 Author 会是 @claude" ;;
esac
[ "$NAME" = "Claude" ] && die "user.name 仍是 Claude"
echo "identity: $NAME <$EMAIL>"

# ── 2. 剥掉 Claude 尾注 ────────────────────────────────────────────────
# settings.json 里的 attribution 已经关掉了自动尾注，但配置偶尔读不到，
# 或者尾注是手写进来的——这里兜一道底。
CLEAN="$(printf '%s\n' "$MSG" \
  | grep -viE '^(Co-Authored-By: *Claude|Claude-Session:|🤖 Generated with \[Claude Code\])' \
  | grep -viE '^Generated with \[?Claude Code\]?')"
# 去掉尾部空行
CLEAN="$(printf '%s\n' "$CLEAN" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}')"
[ -n "$(printf '%s' "$CLEAN" | tr -d '[:space:]')" ] || die "剥掉尾注后 message 为空"
if [ "$CLEAN" != "$MSG" ]; then
  echo "已从 message 中剥掉 Claude 尾注"
fi

# ── 3. 暂存 ────────────────────────────────────────────────────────────
if [ $# -gt 0 ]; then
  # 逐个 add：pathspec 不存在时 git add 会整条失败，静默跳过全部改动
  for p in "$@"; do
    [ -e "$p" ] || { echo "跳过不存在的路径: $p"; continue; }
    git add -A -- "$p" || die "git add $p 失败"
  done
else
  git add -A || die "git add -A 失败"
fi

if git diff --cached --quiet; then
  echo "没有待提交的改动，退出"
  exit 0
fi
echo "本次提交的文件："
git diff --cached --name-status | sed 's/^/  /'

# ── 4. 提交 + 复核 author ──────────────────────────────────────────────
printf '%s\n' "$CLEAN" | git commit -q -F - || die "git commit 失败"

ACTUAL="$(git log -1 --pretty='%ae')"
if [ "$ACTUAL" != "$EMAIL" ]; then
  echo "HEAD 的 author 是 $ACTUAL，与预期不符——amend 重来"
  git commit -q --amend --reset-author --no-edit || die "amend 失败"
  ACTUAL="$(git log -1 --pretty='%ae')"
  [ "$ACTUAL" = "$EMAIL" ] || die "amend 之后 author 仍是 $ACTUAL"
fi

if git log -1 --pretty=%B | git interpret-trailers --parse | grep -qiE 'co-authored-by: *claude|claude-session'; then
  die "commit 里仍有 Claude 尾注（不该发生，请检查本脚本的剥离规则）"
fi

SHA="$(git rev-parse --short HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# ── 5. 推送（退避重试）────────────────────────────────────────────────
pushed=""
for i in 1 2 3 4 5; do
  if git push -u origin "$BRANCH" 2>&1 | sed 's/^/  push: /'; then pushed=1; break; fi
  [ $i -lt 5 ] && { d=$((2 ** i)); echo "  推送失败，${d}s 后重试"; sleep "$d"; }
done
[ -n "$pushed" ] || die "推送失败（已重试 4 次）"

# ── 6. 报告 ────────────────────────────────────────────────────────────
SLUG="$(git remote get-url origin 2>/dev/null \
  | sed -E 's#\.git$##; s#.*[/:]([^/]+/[^/]+)$#\1#')"
echo
echo "author:  $(git log -1 --pretty='%an <%ae>')"
echo "commit:  $SHA on $BRANCH"
[ -n "$SLUG" ] && echo "link:    https://github.com/$SLUG/commit/$(git rev-parse HEAD)"

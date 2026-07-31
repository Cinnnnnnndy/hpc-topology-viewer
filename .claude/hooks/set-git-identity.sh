#!/usr/bin/env bash
# 把本仓库的 git 提交身份钉成仓库主人自己的身份。
#
# 为什么需要这个：Claude Code 的云端沙箱每次重建，全局 ~/.gitconfig 里写的是
#   user.name  = Claude
#   user.email = noreply@anthropic.com
# 于是所有 commit 的 Author 都是 GitHub 上的 @claude 账号，贡献图上不会有仓库
# 主人的任何记录。全局配置不归我们管、也不持久，所以在每次会话开始时把**仓库级**
# 配置（.git/config，优先级高于全局）写成正确的身份。
#
# 贡献图只认 commit author 的 email 是否匹配 GitHub 账号已验证的邮箱，
# 所以这里用 GitHub 提供的 noreply 邮箱（<数字ID>+<用户名>@users.noreply.github.com）：
# 一样计入贡献图，同时不把真实邮箱暴露在公开仓库的提交历史里。
#
# 换人/换邮箱只改下面两行即可。
set -euo pipefail

GIT_USER_NAME="Cindy_wxd"
GIT_USER_EMAIL="209322477+Cinnnnnnndy@users.noreply.github.com"

# 在仓库根目录执行；hook 的工作目录不保证，所以显式切过去。
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# 不在 git 仓库里就安静退出（别让 hook 拖垮会话启动）。
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

git config --local user.name  "$GIT_USER_NAME"
git config --local user.email "$GIT_USER_EMAIL"

# 全局配置默认用 Anthropic 的 SSH key 给每条 commit 签名。作者一旦换成仓库主人，
# 这把 key 与该账号无关，GitHub 会给每条 commit 打上黄色的 "Unverified" 徽章。
# 与其挂个验证不了的签名，不如不签。要恢复签名：把自己的 SSH signing key 传到
# GitHub（Settings → SSH and GPG keys → New SSH key，类型选 Signing Key），
# 然后把下面这行改成 true 并设置 user.signingkey 指向你自己的公钥。
git config --local commit.gpgsign false

echo "git identity for this repo: $GIT_USER_NAME <$GIT_USER_EMAIL> (signing off)"

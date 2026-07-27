#!/usr/bin/env bash
# 校验一个已发布的 pattern 链接是否满足「可分享」的三条约定。
#
#   verify-published-pattern.sh <base-url> <pattern-id> [legacy-path]
#
# 例：
#   verify-published-pattern.sh https://user.github.io/repo rubik-cube-logical rubik
#
# 检查项：
#   ① pattern.html / .css / .js / .json 四个地址都可达（200）
#   ② pattern.json 的 version 与页面里的 ?v= 一致（缓存与对账的前提）
#   ③ 静态资源允许跨站引用（别人才能 <script src> 复用）
#   ④ 旧入口（若提供）仍然可达——发出去的链接不能失效
#
# 退出码非 0 表示有问题；每项都会打印实际取到的值，便于直接贴给对方。
set -uo pipefail

BASE="${1:?用法: verify-published-pattern.sh <base-url> <pattern-id> [legacy-path]}"
ID="${2:?缺少 pattern-id}"
LEGACY="${3:-}"
BASE="${BASE%/}"
DIR="$BASE/patterns/$ID"
fail=0

code() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
check() {                      # check <url> <label>
  local c; c=$(code "$1")
  if [ "$c" = "200" ]; then printf 'ok    %-10s %s\n' "$2" "$1"
  else printf 'FAIL  %-10s %s -> %s\n' "$2" "$1" "$c"; fail=1; fi
}

echo "— ① 四个地址是否可达 —"
check "$DIR/pattern.html" html
check "$DIR/pattern.css"  css
check "$DIR/pattern.js"   js
check "$DIR/pattern.json" json

echo "— ② 版本戳是否一致 —"
json_ver=$(curl -s "$DIR/pattern.json" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
html_ver=$(curl -s "$DIR/pattern.html" | grep -o 'v=[A-Za-z0-9._-]\+' | sed 's/^v=//' | sort -u | head -1)
if [ -z "$json_ver" ]; then
  echo "FAIL  pattern.json 里没有 version 字段（发布时应写入短 SHA）"; fail=1
elif [ -z "$html_ver" ]; then
  echo "FAIL  pattern.html 的资源链接没有 ?v= 版本戳（换版后对方会吃到旧缓存）"; fail=1
elif [ "$json_ver" != "$html_ver" ]; then
  echo "FAIL  版本不一致：pattern.json=$json_ver · pattern.html=$html_ver"; fail=1
else
  echo "ok    version=$json_ver"
fi

echo "— ③ 是否允许跨站引用 —"
acao=$(curl -sI "$DIR/pattern.js" | tr -d '\r' | sed -n 's/^[Aa]ccess-[Cc]ontrol-[Aa]llow-[Oo]rigin:[[:space:]]*//p')
if [ -n "$acao" ]; then echo "ok    access-control-allow-origin: $acao"
else echo "warn  未见 access-control-allow-origin —— 别人无法跨站 <script src> 引用（GitHub Pages 默认会带）"; fi

if [ -n "$LEGACY" ]; then
  echo "— ④ 旧入口是否仍可达 —"
  check "$BASE/${LEGACY%/}/" legacy
fi

echo
if [ "$fail" = 0 ]; then
  echo "全部通过。可交付的三条链接："
  echo "  看/用   $DIR/pattern.html"
  echo "  带状态  $DIR/pattern.html?<你的参数>&v=${json_ver:-<sha>}"
  echo "  契约    $DIR/pattern.json"
else
  echo "有未通过项，见上。"
fi
exit "$fail"

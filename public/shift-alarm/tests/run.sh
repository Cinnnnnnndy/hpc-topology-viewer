#!/usr/bin/env bash
# 一次跑完全部检查：
#   1) node 单元测试（引擎 / 导出 / 解析）
#   2) 跨实现复核——用 python 的 icalendar + dateutil 重新展开我们生成的 .ics，
#      逐条比对是否与引擎算出的提醒实例集合完全相等。
#      自己写的 .ics 用自己写的解析器去验等于没验，所以这一步换了实现。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "── 单元测试 ─────────────────────────────"
node --test tests/engine.test.mjs tests/ics.test.mjs tests/parser.test.mjs

echo
echo "── 跨实现复核（python icalendar + dateutil）──"
FIX=$(mktemp -d)
trap 'rm -rf "$FIX"' EXIT
node tests/gen-fixtures.mjs "$FIX"
echo
python3 tests/verify_ics.py "$FIX"

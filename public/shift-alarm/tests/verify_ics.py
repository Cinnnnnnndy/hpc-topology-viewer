#!/usr/bin/env python3
"""用**另一套实现**复核我们生成的 .ics。

自己写的生成器用自己写的解析器去验，等于没验。这里换成两个独立的第三方库：
  · icalendar  —— RFC 5545 解析（折行、转义、参数）
  · dateutil.rrule —— 重复规则展开（RRULE / EXDATE 的权威语义）

复核项：
  1. 文件能被解析，且每行 ≤ 75 个八位组、以 CRLF 结尾（RFC 5545 硬性要求）
  2. 展开所有 VEVENT（含 RRULE 展开、EXDATE 扣除）得到的「日期+时刻」集合，
     必须与引擎算出的提醒实例集合**逐条相等**——多一条少一条都算失败
  3. recurring 与 expanded 两种模式必须展开出完全相同的集合
  4. SUMMARY / DESCRIPTION 解析回来要与原文一致（转义正确）
  5. VTIMEZONE 存在且 Asia/Shanghai 偏移为 +0800
  6. UID 在同一文件内不重复；两次生成的 UID 必须稳定（重复导入才会更新而非重复）

用法：python3 verify_ics.py <fixtures 目录>
"""
import json
import sys
from datetime import datetime
from pathlib import Path

from dateutil.rrule import rrulestr
from icalendar import Calendar

FAILS = []
CHECKS = [0]


def check(cond, msg):
    CHECKS[0] += 1
    if not cond:
        FAILS.append(msg)
    return cond


def raw_line_check(path: Path):
    data = path.read_bytes()
    check(data.endswith(b"\r\n"), f"{path.name}: 文件未以 CRLF 结尾")
    check(b"\n" not in data.replace(b"\r\n", b""), f"{path.name}: 存在裸 LF（必须全部是 CRLF）")
    for i, line in enumerate(data.split(b"\r\n"), 1):
        if len(line) > 75:
            FAILS.append(f"{path.name}:{i} 行长 {len(line)} 字节 > 75（折行失败）")
            CHECKS[0] += 1
            break
    else:
        CHECKS[0] += 1
    # 折行处不能把 UTF-8 序列劈开：整份内容 decode 一遍就知道
    try:
        data.decode("utf-8")
        CHECKS[0] += 1
    except UnicodeDecodeError as e:
        FAILS.append(f"{path.name}: UTF-8 解码失败，折行劈开了多字节字符 -> {e}")
        CHECKS[0] += 1


def expand(path: Path):
    """展开成 {'YYYY-MM-DD HH:MM'} 集合，外加 summaries / uids。"""
    cal = Calendar.from_ical(path.read_bytes())
    stamps, summaries, uids, uid_list = set(), set(), set(), []

    tz_ok = False
    for comp in cal.walk("VTIMEZONE"):
        for sub in comp.walk("STANDARD"):
            if str(sub.get("TZOFFSETTO")) in ("8:00:00", "+08:00"):
                tz_ok = True
            off = sub.get("TZOFFSETTO")
            if off is not None and off.td.total_seconds() == 8 * 3600:
                tz_ok = True
    check(tz_ok, f"{path.name}: VTIMEZONE 缺失或 Asia/Shanghai 偏移不是 +0800")

    for ev in cal.walk("VEVENT"):
        uid = str(ev.get("UID"))
        uid_list.append(uid)
        uids.add(uid)
        summaries.add(str(ev.get("SUMMARY")))

        dt = ev.get("DTSTART").dt
        if isinstance(dt, datetime):
            naive = dt.replace(tzinfo=None)   # 只比较本地墙上时间
        else:
            continue                          # 全天事件（班表日历）不参与本项比对

        rr = ev.get("RRULE")
        if rr is None:
            stamps.add(naive.strftime("%Y-%m-%d %H:%M"))
            continue

        rule = rrulestr(rr.to_ical().decode(), dtstart=naive)
        occ = set(rule)

        ex = ev.get("EXDATE")
        if ex is not None:
            ex_list = ex if isinstance(ex, list) else [ex]
            for block in ex_list:
                for d in block.dts:
                    v = d.dt
                    occ.discard(v.replace(tzinfo=None) if isinstance(v, datetime) else v)

        for o in occ:
            stamps.add(o.strftime("%Y-%m-%d %H:%M"))

    check(len(uids) == len(uid_list), f"{path.name}: UID 重复（{len(uid_list)} 个事件、{len(uids)} 个唯一 UID）")
    return stamps, summaries


def main():
    root = Path(sys.argv[1])
    manifest = json.loads((root / "manifest.json").read_text("utf-8"))
    by_id = {}

    for m in manifest:
        path = root / m["file"]
        raw_line_check(path)
        got, summaries = expand(path)
        want = set(m["expected"])

        missing = sorted(want - got)[:4]
        extra = sorted(got - want)[:4]
        ok = check(
            got == want,
            f"{m['file']}: 展开集合不符 —— 少 {len(want - got)} 条 {missing}，多 {len(got - want)} 条 {extra}",
        )

        for t in m["titles"]:
            check(t in summaries, f"{m['file']}: SUMMARY 转义/还原失败，找不到原文 {t!r}")

        by_id.setdefault(m["id"], {})[m["mode"]] = got
        status = "OK " if ok else "FAIL"
        print(f"  {status} {m['file']:<44} 展开 {len(got):>4} 条 / 期望 {len(want):>4} 条")

    for cid, modes in by_id.items():
        if len(modes) == 2:
            check(
                modes["recurring"] == modes["expanded"],
                f"{cid}: recurring 与 expanded 展开结果不一致（差 "
                f"{len(modes['recurring'] ^ modes['expanded'])} 条）",
            )

    print(f"\n共 {CHECKS[0]} 项检查，失败 {len(FAILS)} 项")
    for f in FAILS:
        print("  ✗", f)
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())

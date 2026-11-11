# -*- coding: utf-8 -*-
"""Precise, whitelisted edits to data/words.json. Only the listed fragments change."""
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "words.json"
BAK = ROOT / "data" / "words.json.bak"

SAFE = [
    ('"meaning":"使松驰"', '"meaning":"使松弛"'),
    ('"meaning":"起拆，诉讼"', '"meaning":"起诉，诉讼"'),
    ('"word":"reservior"', '"word":"reservoir"'),
]

RECOMMENDED = [
    # ooman 的音标是 /ˈrəʊmən/（Roman），不是 woman
    ('"word":"ooman"', '"word":"roman"'),
    # cycle 的 pos 已经是 n.，去掉释义里重复的 n
    ('"meaning":"n自行车"', '"meaning":"自行车"'),
    # restrict 的词性应为 vt.，去掉释义里粘连的 vt
    ('"pos":"n.","meaning":"vt限制"', '"pos":"vt.","meaning":"限制"'),
]

LITERAL = [
    ('"word":"ooman"', '"word":"woman"'),
    ('"meaning":"n自行车"', '"meaning":"n. 自行车"'),
    ('"meaning":"vt限制"', '"meaning":"vt. 限制"'),
]


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "safe"
    pairs = {"safe": SAFE, "recommended": RECOMMENDED, "literal": LITERAL}[mode]

    if not BAK.exists():
        shutil.copy2(DATA, BAK)
        print("backup created:", BAK)
    else:
        print("backup already exists:", BAK)

    text = DATA.read_text(encoding="utf-8")
    for old, new in pairs:
        count = text.count(old)
        if count != 1:
            raise SystemExit("ABORT: %r 出现 %d 次（应为 1）" % (old, count))
        text = text.replace(old, new)
        print("replaced:", old, "->", new)

    DATA.write_text(text, encoding="utf-8", newline="\n")

    entries = json.loads(DATA.read_text(encoding="utf-8"))
    print("JSON OK, total:", len(entries))
    words = [e["word"] for e in entries]
    print("duplicate words:", len(words) - len(set(words)))


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
"""CET Arena 词库体检：拼写 / 字符 / 中文错别字 / 结构校验。

只读 data/words.json，只写 reports/typo_report.csv，绝不修改词库。

用法：
    python scripts/check_typos.py
    python scripts/check_typos.py --json data/words.json --out reports/typo_report.csv
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_JSON = os.path.join(ROOT, "data", "words.json")
DEFAULT_OUT = os.path.join(ROOT, "reports", "typo_report.csv")

ALLOWED_POS = {
    "v.", "vt.", "vi.", "aux.", "n.", "pron.", "num.", "adj.", "a.",
    "adv.", "ad.", "prep.", "conj.", "int.", "art.", "pl.",
}

# 专有名词 / 缩写 / 英式拼法白名单（这些不是错别字）
WORD_WHITELIST = {
    "ok", "tv", "cd", "dvd", "mr", "mrs", "ms", "dr", "etc", "am", "pm",
    "usa", "uk", "un", "ceo", "gdp", "it", "ai",
    # 英式拼法（与美式并存，均为合法英文）
    "analyse", "cafe", "centimetre", "centre", "favour", "favourable",
    "fibre", "flavour", "harbour", "honour", "honourable", "humour",
    "labour", "metre", "mould", "neighbour", "neighbourhood", "vapour",
    "colour", "behaviour", "programme", "theatre", "defence", "offence",
    "travelling", "cancelled", "labelled", "modelling",
    # 古旧/异体拼写，可保留但值得人工确认
    "reflexion",
}

# 常见错别字对照表（左：错，右：对）。只收高信号、低歧义的词。
TYPO_MAP = {
    "起拆": "起诉", "按装": "安装", "既使": "即使", "部份": "部分",
    "松驰": "松弛", "陷井": "陷阱", "震憾": "震撼", "装璜": "装潢",
    "针贬": "针砭", "真缔": "真谛", "委糜": "萎靡", "无耐": "无奈",
    "犹其": "尤其", "坐阵": "坐镇", "走头无路": "走投无路",
    "自抱自弃": "自暴自弃", "中流抵柱": "中流砥柱", "置若惘闻": "置若罔闻",
    "义愤填鹰": "义愤填膺", "天翻地复": "天翻地覆", "情不自尽": "情不自禁",
    "迫不急待": "迫不及待", "前扑后继": "前仆后继", "毛骨耸然": "毛骨悚然",
    "形像": "形象", "材华": "才华", "成积": "成绩", "关健": "关键",
    "记念": "纪念", "精采": "精彩", "年令": "年龄", "入场卷": "入场券",
    "搔扰": "骚扰", "师付": "师傅", "是得其反": "适得其反", "推委": "推诿",
    "忘想": "妄想", "消毁": "销毁", "修茸": "修葺", "宣泻": "宣泄",
    "延申": "延伸", "遭迂": "遭遇", "诸候": "诸侯", "主弦律": "主旋律",
    "贮立": "伫立", "幅射": "辐射", "勾通": "沟通", "宏扬": "弘扬",
    "坚苦": "艰苦", "介召": "介绍", "痉孪": "痉挛", "决对": "绝对",
    "兰球": "篮球", "优柔寡段": "优柔寡断", "一如继往": "一如既往",
    "好高鹜远": "好高骛远", "竭泽而鱼": "竭泽而渔", "弄巧成绌": "弄巧成拙",
    "破斧沉舟": "破釜沉舟", "青出于兰": "青出于蓝", "世外桃园": "世外桃源",
    "首曲一指": "首屈一指", "谈笑风声": "谈笑风生", "挺而走险": "铤而走险",
    "图穷匕现": "图穷匕见", "委屈求全": "委曲求全", "无动于中": "无动于衷",
    "一愁莫展": "一筹莫展", "一张一驰": "一张一弛", "以逸代劳": "以逸待劳",
    "义气用事": "意气用事", "应接不遐": "应接不暇", "欲盖弥章": "欲盖弥彰",
    "再接再励": "再接再厉", "责无旁代": "责无旁贷", "震聋发聩": "振聋发聩",
    "支言片语": "只言片语", "珠联壁合": "珠联璧合", "自名得意": "自鸣得意",
    "坐无虚席": "座无虚席", "转弯摸角": "转弯抹角", "默守成规": "墨守成规",
    "披星带月": "披星戴月", "别出新裁": "别出心裁", "不径而走": "不胫而走",
    "出奇不意": "出其不意", "唇枪舌箭": "唇枪舌剑", "大有扁益": "大有裨益",
}

# 仅收录「简体中文不会用到」的繁体字形，避免把「西/北/南/境/雨」这类共用字误报。
TRADITIONAL_CHARS = set(
    "個這們說時對來後電詞語學習體關係應該麼幾頭長問題開經歷選擇準備錯誤讀寫聽"
    "發現環網頁軟動員價錢買賣車馬鳥魚龍門東風雲雪書畫聲醫藥農產資訊為與從會過"
    "還讓給無數據種類別邊裡點兒兩隻"
)

CJK_RE = re.compile(r"[\u4e00-\u9fff]")
LATIN_RE = re.compile(r"[A-Za-z]")
WORD_RE = re.compile(r"^[a-z]+$")
PUNCT_ONLY_RE = re.compile(r"^[\s\W_]+$", re.UNICODE)
DOUBLE_LETTER_RE = re.compile(r"([a-z])\1")
WEIRD_CHARS = set("?？�＊*　")
# 词性缩写与中文黏连，如「n自行车」「vt限制」
POS_GLUED_RE = re.compile(
    r"^(vt|vi|aux|n|pron|num|adj|a|adv|ad|prep|conj|int|art|pl)\s*[\u4e00-\u9fff]"
)
# 括号内的英文注释，如「(缩作OK)」「(+to武力等)」
PAREN_LATIN_RE = re.compile(r"[（(][^）)]*[A-Za-z][^）)]*[）)]")


def load_words(path):
    with open(path, "rb") as fh:
        data = json.loads(fh.read().decode("utf-8"))
    if not isinstance(data, list):
        raise SystemExit("词库不是 JSON 数组，停止排查")
    return data


def levenshtein(a, b):
    """小型编辑距离，用于给拼写建议打分。"""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


class SpellValidator:
    """优先用 pyspellchecker；不可用时降级为纯规则检查。"""

    def __init__(self):
        self.spell = None
        self.words = {}
        self.note = ""
        try:
            from spellchecker import SpellChecker  # type: ignore

            self.spell = SpellChecker(language="en")
            self.words = self.spell.word_frequency
            self.note = "pyspellchecker"
        except Exception as exc:  # pragma: no cover - 环境相关
            self.note = "unavailable: %s" % exc

    def known(self, word):
        if self.spell is None:
            return True
        return word in self.words

    def suggest(self, word):
        if self.spell is None:
            return ""
        try:
            return self.spell.correction(word) or ""
        except Exception:
            return ""


def add(rows, word, kind, detail, suggestion, confidence):
    rows.append({
        "单词": word,
        "问题类型": kind,
        "可疑内容": detail,
        "建议": suggestion,
        "置信度": confidence,
    })


def check_structure(entry, rows):
    word = entry.get("word", "")
    meanings = entry.get("meanings")

    if not isinstance(meanings, list) or not meanings:
        add(rows, word, "结构异常", "meanings 为空或不是数组", "补齐释义", "高")
        return
    if len(meanings) < 2:
        add(rows, word, "结构异常", "只有 %d 个释义（项目要求至少 2 个）" % len(meanings),
            "补充或剔除该词", "高")

    ranks = []
    seen = Counter()
    for item in meanings:
        if not isinstance(item, dict):
            add(rows, word, "结构异常", "释义项不是对象", "检查数据结构", "高")
            continue
        pos = (item.get("pos") or "").strip()
        meaning = (item.get("meaning") or "").strip()
        rank = item.get("frequencyRank")

        if not pos:
            add(rows, word, "结构异常", "释义缺少词性", "补词性", "高")
        elif pos not in ALLOWED_POS:
            add(rows, word, "词性异常", "词性 %r 不在白名单" % pos, "改为标准缩写", "中")

        if not meaning:
            add(rows, word, "空释义", "词性 %s 下释义为空" % pos, "补齐释义", "高")
        elif PUNCT_ONLY_RE.match(meaning):
            add(rows, word, "空释义", "释义只有标点：%r" % meaning, "补齐释义", "高")

        if isinstance(rank, int):
            ranks.append(rank)
        else:
            add(rows, word, "词频异常", "frequencyRank 不是整数：%r" % (rank,), "改为正整数", "高")

        # 只有「词性 + 释义」完全相同才算重复：
        # vt./vi. 共用同一中文释义是源数据写法，属于正常，不应报错。
        seen[(pos, meaning)] += 1

    if ranks:
        if len(set(ranks)) != len(ranks):
            add(rows, word, "词频异常", "frequencyRank 有重复：%s" % ranks, "改为唯一递增", "高")
        if 1 not in ranks:
            add(rows, word, "词频异常", "缺少 frequencyRank=1 的主释义", "指定最高频释义", "高")

    for (pos, text), count in seen.items():
        if count > 1 and text:
            add(rows, word, "重复释义",
                "词性 %s 下同一释义出现 %d 次：%s" % (pos, count, text), "去重", "中")


def check_word_form(word, spell, rows):
    if not word:
        add(rows, word, "结构异常", "word 为空", "补齐单词", "高")
        return
    if " " in word or "\t" in word:
        add(rows, word, "非法字符", "单词包含空白字符", "删除空白", "高")
    if not WORD_RE.match(word):
        bad = "".join(ch for ch in word if not ("a" <= ch <= "z"))
        add(rows, word, "非法字符", "包含非 a-z 字符：%r" % bad, "改为纯小写字母", "高")
    if word != word.lower():
        add(rows, word, "大小写异常", "包含大写字母", "统一小写", "高")
    if len(word) < 2:
        add(rows, word, "长度异常", "单词只有 %d 个字母" % len(word), "人工确认", "中")
    if len(word) > 20:
        add(rows, word, "长度异常", "单词长度 %d" % len(word), "人工确认", "中")

    if word in WORD_WHITELIST:
        return

    if not spell.known(word):
        suggestion = spell.suggest(word)
        distance = levenshtein(word, suggestion) if suggestion else 99
        # 只差 1~2 个字母说明很可能是真拼写错误
        confidence = "高" if distance <= 2 else "中"
        detail = "词典中查不到该词"
        for match in DOUBLE_LETTER_RE.finditer(word):
            detail += "；含连续重复字母 %r" % match.group(0)
        add(rows, word, "疑似拼写错误", detail,
            ("可能应为 %r" % suggestion) if suggestion and suggestion != word else "人工确认",
            confidence)


def check_meaning_chinese(word, meaning, rows):
    if not meaning:
        return

    if "【" in meaning or "】" in meaning:
        add(rows, word, "格式残留", "释义含编辑注释符【】：%s" % meaning, "移除注释", "高")
    if meaning.count("（") != meaning.count("）") or meaning.count("(") != meaning.count(")"):
        add(rows, word, "括号不匹配", "括号数量不配对：%s" % meaning, "补全或删除括号", "中")
    if any(ch in WEIRD_CHARS for ch in meaning):
        add(rows, word, "乱码字符", "释义含可疑符号：%s" % meaning, "人工确认编码", "中")

    glued = POS_GLUED_RE.match(meaning)
    if glued:
        add(rows, word, "词性黏连", "词性 %r 与释义之间缺少「. 」：%s" % (glued.group(1), meaning),
            "改为 %r 形式" % (glued.group(1) + ". " + meaning[len(glued.group(1)):].lstrip()), "高")

    paren = PAREN_LATIN_RE.search(meaning)
    if paren and not glued:
        add(rows, word, "释义含英文", "释义括号内混入英文：%s" % paren.group(0),
            "确认是否为必要注释，否则删除", "低")

    trad = sorted({ch for ch in meaning if ch in TRADITIONAL_CHARS})
    if trad:
        add(rows, word, "疑似繁体字", "含繁体字 %s：%s" % ("".join(trad), meaning),
            "改为简体", "低")

    for wrong, right in TYPO_MAP.items():
        if wrong in meaning:
            add(rows, word, "常见错别字", "命中 %r（建议 %r）：%s" % (wrong, right, meaning),
                "改为 %r" % right, "高")


def check_global(entries, rows):
    words = [e.get("word", "") for e in entries]
    for word, count in Counter(words).items():
        if word and count > 1:
            add(rows, word, "重复词条", "同一单词出现 %d 次" % count, "合并重复条目", "高")

    ids = [e.get("id", "") for e in entries]
    for item, count in Counter(ids).items():
        if item and count > 1:
            add(rows, item, "重复ID", "id 重复 %d 次" % count, "重新生成 id", "高")

    for entry in entries:
        if entry.get("level") not in ("CET4", "CET6"):
            add(rows, entry.get("word", ""), "等级异常",
                "level=%r" % entry.get("level"), "改为 CET4/CET6", "高")
        if not entry.get("id"):
            add(rows, entry.get("word", ""), "结构异常", "缺少 id", "补齐 id", "高")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", default=DEFAULT_JSON)
    parser.add_argument("--out", default=DEFAULT_OUT)
    args = parser.parse_args()

    entries = load_words(args.json)
    spell = SpellValidator()
    rows = []

    for entry in entries:
        word = (entry.get("word") or "").strip()
        check_word_form(word, spell, rows)
        check_structure(entry, rows)
        for item in entry.get("meanings") or []:
            if isinstance(item, dict):
                check_meaning_chinese(word, (item.get("meaning") or "").strip(), rows)

    check_global(entries, rows)

    order = {"高": 0, "中": 1, "低": 2}
    rows.sort(key=lambda r: (order.get(r["置信度"], 9), r["问题类型"], r["单词"]))

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    fields = ["单词", "问题类型", "可疑内容", "建议", "置信度"]
    with open(args.out, "w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

    by_kind = Counter(r["问题类型"] for r in rows)
    by_conf = Counter(r["置信度"] for r in rows)
    print("词库文件:", os.path.relpath(args.json, ROOT))
    print("总词条数:", len(entries))
    print("拼写校验器:", spell.note)
    print("问题总数:", len(rows))
    print("按类型:", json.dumps(dict(by_kind.most_common()), ensure_ascii=False))
    print("按置信度:", json.dumps(dict(by_conf), ensure_ascii=False))
    print("报告文件:", os.path.relpath(args.out, ROOT))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Build the app's Bible data from openly licensed sources.

Inputs (cloned by scripts/fetch_sources.sh into ./sources):
  sources/bible_databases  github.com/scrollmapper/bible_databases
  sources/morphhb          github.com/openscriptures/morphhb (Hebrew + Strong's)
  sources/strongs          github.com/openscriptures/strongs (lexicon)

Outputs (into public/data):
  catalog.json             list of translations with language and license
  bibles/<id>.json         {"id": ..., "books": {"Gen": [[verse, ...], ...], ...}}
  strongs-hebrew.json      Strong's lexicon entries
  strongs-greek.json

Verse text for Strong's-tagged editions uses inline markup:
  {word or phrase|H430 H853}
Everything else is plain text.
"""
import glob
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "sources")
OUT = os.path.join(ROOT, "public", "data")
SM = os.path.join(SRC, "bible_databases")

# Translations whose source text is marked up with Strong's numbers.
TAGGED = {"KJV": "sources/en/KJV/KJV-osis.json",
          "BSB": "sources/en/BSB/BSB-osis.json",
          "StatResGNT": "sources/grc/StatResGNT/StatResGNT-osis.json"}

# Not a translation for reading.
SKIP = {"KLV"}

BOOKS = [
    ("Gen", "Genesis", ["Genesis"]), ("Exod", "Exodus", ["Exodus"]),
    ("Lev", "Leviticus", ["Leviticus"]), ("Num", "Numbers", ["Numbers"]),
    ("Deut", "Deuteronomy", ["Deuteronomy"]), ("Josh", "Joshua", ["Joshua"]),
    ("Judg", "Judges", ["Judges"]), ("Ruth", "Ruth", ["Ruth"]),
    ("1Sam", "1 Samuel", ["I Samuel"]), ("2Sam", "2 Samuel", ["II Samuel"]),
    ("1Kgs", "1 Kings", ["I Kings"]), ("2Kgs", "2 Kings", ["II Kings"]),
    ("1Chr", "1 Chronicles", ["I Chronicles"]), ("2Chr", "2 Chronicles", ["II Chronicles"]),
    ("Ezra", "Ezra", ["Ezra"]), ("Neh", "Nehemiah", ["Nehemiah"]),
    ("Esth", "Esther", ["Esther"]), ("Job", "Job", ["Job"]),
    ("Ps", "Psalms", ["Psalms"]), ("Prov", "Proverbs", ["Proverbs"]),
    ("Eccl", "Ecclesiastes", ["Ecclesiastes"]), ("Song", "Song of Solomon", ["Song of Solomon"]),
    ("Isa", "Isaiah", ["Isaiah"]), ("Jer", "Jeremiah", ["Jeremiah"]),
    ("Lam", "Lamentations", ["Lamentations"]), ("Ezek", "Ezekiel", ["Ezekiel"]),
    ("Dan", "Daniel", ["Daniel"]), ("Hos", "Hosea", ["Hosea"]), ("Joel", "Joel", ["Joel"]),
    ("Amos", "Amos", ["Amos"]), ("Obad", "Obadiah", ["Obadiah"]), ("Jonah", "Jonah", ["Jonah"]),
    ("Mic", "Micah", ["Micah"]), ("Nah", "Nahum", ["Nahum"]), ("Hab", "Habakkuk", ["Habakkuk"]),
    ("Zeph", "Zephaniah", ["Zephaniah"]), ("Hag", "Haggai", ["Haggai"]),
    ("Zech", "Zechariah", ["Zechariah"]), ("Mal", "Malachi", ["Malachi"]),
    ("Matt", "Matthew", ["Matthew"]), ("Mark", "Mark", ["Mark"]), ("Luke", "Luke", ["Luke"]),
    ("John", "John", ["John"]), ("Acts", "Acts", ["Acts"]), ("Rom", "Romans", ["Romans"]),
    ("1Cor", "1 Corinthians", ["I Corinthians"]), ("2Cor", "2 Corinthians", ["II Corinthians"]),
    ("Gal", "Galatians", ["Galatians"]), ("Eph", "Ephesians", ["Ephesians"]),
    ("Phil", "Philippians", ["Philippians"]), ("Col", "Colossians", ["Colossians"]),
    ("1Thess", "1 Thessalonians", ["I Thessalonians"]), ("2Thess", "2 Thessalonians", ["II Thessalonians"]),
    ("1Tim", "1 Timothy", ["I Timothy"]), ("2Tim", "2 Timothy", ["II Timothy"]),
    ("Titus", "Titus", ["Titus"]), ("Phlm", "Philemon", ["Philemon"]), ("Heb", "Hebrews", ["Hebrews"]),
    ("Jas", "James", ["James"]), ("1Pet", "1 Peter", ["I Peter"]), ("2Pet", "2 Peter", ["II Peter"]),
    ("1John", "1 John", ["I John"]), ("2John", "2 John", ["II John"]), ("3John", "3 John", ["III John"]),
    ("Jude", "Jude", ["Jude"]), ("Rev", "Revelation", ["Revelation of John", "Revelation"]),
    # Deuterocanonical / apocryphal books, present in some editions
    ("Tob", "Tobit", ["Tobit"]), ("Jdt", "Judith", ["Judith"]),
    ("EsthGr", "Esther (Greek)", ["Esther (Greek)"]), ("AddEsth", "Additions to Esther", ["Additions to Esther"]),
    ("Wis", "Wisdom", ["Wisdom"]), ("Sir", "Sirach", ["Sirach"]), ("Bar", "Baruch", ["Baruch"]),
    ("EpJer", "Letter of Jeremiah", ["Epistle of Jeremiah"]), ("PrAzar", "Prayer of Azariah", ["Prayer of Azariah"]),
    ("Sus", "Susanna", ["Susanna"]), ("Bel", "Bel and the Dragon", ["Bel and the Dragon"]),
    ("AddDan", "Additions to Daniel", ["Additions to Daniel"]),
    ("1Macc", "1 Maccabees", ["I Maccabees"]), ("2Macc", "2 Maccabees", ["II Maccabees"]),
    ("3Macc", "3 Maccabees", ["III Maccabees"]), ("4Macc", "4 Maccabees", ["IV Maccabees"]),
    ("1Esd", "1 Esdras", ["I Esdras"]), ("2Esd", "2 Esdras", ["II Esdras"]),
    ("PrMan", "Prayer of Manasseh", ["Prayer of Manasses"]), ("AddPs", "Psalm 151", ["Additional Psalm"]),
    ("PssSol", "Psalms of Solomon", ["Psalms of Solomon"]), ("Odes", "Odes", ["Odes"]),
    ("1En", "1 Enoch", ["I Enoch"]), ("EpLao", "Laodiceans", ["Laodiceans"]),
]
NAME_TO_CODE = {alias: code for code, _, aliases in BOOKS for alias in aliases}

LANGS = {
    "bea": ("Beaver", "Dane-zaa"), "ceb": ("Cebuano", "Cebuano"), "chr": ("Cherokee", "ᏣᎳᎩ"),
    "cop-sa": ("Coptic (Sahidic)", "Ⲙⲉⲧⲣⲉⲙⲛ̀ⲭⲏⲙⲓ"), "cs": ("Czech", "Čeština"),
    "cu": ("Church Slavonic", "Словѣньскъ"), "da": ("Danish", "Dansk"), "de": ("German", "Deutsch"),
    "el": ("Greek (Modern)", "Ελληνικά"), "en": ("English", "English"),
    "enm": ("Middle English", "Middle English"), "eo": ("Esperanto", "Esperanto"),
    "es": ("Spanish", "Español"), "fi": ("Finnish", "Suomi"), "fr": ("French", "Français"),
    "got": ("Gothic", "Gutiska"), "grc": ("Greek (Ancient)", "Ἑλληνική"), "gv": ("Manx", "Gaelg"),
    "hbo": ("Hebrew (Ancient)", "עברית"), "hr": ("Croatian", "Hrvatski"),
    "ht": ("Haitian Creole", "Kreyòl ayisyen"), "hu": ("Hungarian", "Magyar"),
    "hy": ("Armenian", "Հայերեն"), "ja": ("Japanese", "日本語"), "ko": ("Korean", "한국어"),
    "la": ("Latin", "Latina"), "lv": ("Latvian", "Latviešu"), "lzh": ("Classical Chinese", "文言"),
    "mg": ("Malagasy", "Malagasy"), "ml": ("Malayalam", "മലയാളം"), "my": ("Burmese", "မြန်မာ"),
    "nb": ("Norwegian (Bokmål)", "Norsk bokmål"), "nl": ("Dutch", "Nederlands"),
    "nn": ("Norwegian (Nynorsk)", "Norsk nynorsk"), "pl": ("Polish", "Polski"),
    "pon": ("Pohnpeian", "Lokaiahn Pohnpei"), "pt": ("Portuguese", "Português"),
    "ru": ("Russian", "Русский"), "sl": ("Slovenian", "Slovenščina"), "sq": ("Albanian", "Shqip"),
    "sr": ("Serbian", "Српски"), "sv": ("Swedish", "Svenska"), "syr": ("Syriac", "ܣܘܪܝܝܐ"),
    "tl": ("Tagalog", "Tagalog"), "uk": ("Ukrainian", "Українська"), "vi": ("Vietnamese", "Tiếng Việt"),
    "vls": ("West Flemish", "West-Vlams"), "zh-hant": ("Chinese (Traditional)", "繁體中文"),
}
RTL = {"hbo", "he", "syr", "ar"}


def license_ok(lic):
    l = lic.lower()
    if not l or "null" in l or "copyright" in l:
        return False
    if "public domain" in l or "cc0" in l or "gpl" in l:
        return True
    if "creative commons" in l:
        terms = l.split("commons", 1)[1]
        return not re.search(r"\bnc\b|\bnd\b|non-?commercial|no-?deriv", terms.replace("-", " "))
    return False


def read_license(readme):
    text = open(readme, encoding="utf-8").read()
    m = re.search(r"\*\*License:?\*\*:?\s*(.*)", text)
    return m.group(1).strip() if m else ""


def read_title(readme):
    m = re.search(r"^#\s+(.*)", open(readme, encoding="utf-8").read(), flags=re.M)
    return m.group(1).strip() if m else ""


def clean_name(full, tid):
    name = full.split(":", 1)[1].strip() if full.startswith(tid + ":") else full.strip()
    return re.sub(r"\s+", " ", name)


# ---------- OSIS-in-JSON markup → inline Strong's markup ----------

STRONG_RE = re.compile(r"strong:([HG])0*(\d+)([a-z]?)")


def osis_to_tagged(text):
    text = re.sub(r"<note\b.*?</note>", "", text, flags=re.S)
    text = re.sub(r"<title\b.*?</title>", "", text, flags=re.S)
    text = re.sub(r"<w\b[^>]*/>", "", text)
    text = re.sub(r"<divineName\b[^>]*>(.*?)</divineName>", lambda m: m.group(1).upper(), text, flags=re.S)
    text = text.replace("¶", "")

    def w(m):
        attrs, inner = m.group(1), m.group(2)
        inner = re.sub(r"<[^>]+>", "", inner).strip()
        nums = []
        for p, n, _ in STRONG_RE.findall(attrs):
            s = p + n
            if s not in nums:
                nums.append(s)
        if not inner:
            return ""
        if not nums:
            return inner
        m2 = re.match(r"^(.*?)([,.;:!?·’”'\"]*)$", inner, re.S)
        return "{%s|%s}%s" % (m2.group(1), " ".join(nums), m2.group(2))

    text = re.sub(r"<w\b([^>]*)>(.*?)</w>", w, text, flags=re.S)
    text = re.sub(r"<l\b[^>]*/?>|</l>|<lb\b[^>]*/?>", " ", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"')
    text = text.replace("˚", "")  # StatResGNT nomina sacra marker
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    return text


def load_books(path, tagged):
    data = json.load(open(path, encoding="utf-8"))
    books = {}
    for b in data["books"]:
        code = NAME_TO_CODE.get(b["name"])
        if not code:
            print("  unknown book", b["name"], file=sys.stderr)
            continue
        chapters = []
        for ch in b["chapters"]:
            idx = ch["chapter"]
            verses = []
            for v in ch["verses"]:
                n = v["verse"]
                t = osis_to_tagged(v["text"]) if tagged else re.sub(r"\s+", " ", v["text"]).strip()
                while len(verses) < n - 1:
                    verses.append("")
                if len(verses) >= n:
                    verses[n - 1] = (verses[n - 1] + " " + t).strip()
                else:
                    verses.append(t)
            while len(chapters) < idx - 1:
                chapters.append([])
            chapters.append(verses)
        if any(any(v for v in c) for c in chapters):
            books[code] = chapters
    return data.get("translation", ""), books


# ---------- Open Scriptures Hebrew Bible (WLC + Strong's) ----------

OSIS_NS = "{http://www.bibletechnologies.net/2003/OSIS/namespace}"


def build_oshb():
    books = {}
    for code, _, _ in BOOKS[:39]:
        path = os.path.join(SRC, "morphhb", "wlc", code + ".xml")
        root = ET.parse(path).getroot()
        chapters = {}
        for verse in root.iter(OSIS_NS + "verse"):
            _, c, v = verse.get("osisID").split(".")
            parts = []
            for el in verse:
                tag = el.tag.replace(OSIS_NS, "")
                if tag == "w":
                    word = "".join(el.itertext()).replace("/", "")
                    nums = []
                    for piece in (el.get("lemma") or "").split("/"):
                        m = re.match(r"(\d+)", piece.strip())
                        if m and ("H" + m.group(1)) not in nums:
                            nums.append("H" + m.group(1))
                    parts.append(("w", "{%s|%s}" % (word, " ".join(nums)) if nums else word))
                elif tag == "seg":
                    parts.append(("s", el.text or ""))
            out = ""
            for kind, s in parts:
                if kind == "w" and out and not out.endswith("־"):
                    out += " "
                out += s
            ch = chapters.setdefault(int(c), [])
            while len(ch) < int(v) - 1:
                ch.append("")
            ch.append(out.strip())
        books[code] = [chapters.get(i, []) for i in range(1, max(chapters) + 1)]
    return books


# Public-domain texts from github.com/Beblia/Holy-Bible-XML-Format (books numbered 1–66).
BEBLIA = {"LSG": ("FrenchBible.xml", "fr", "La Sainte Bible, Louis Segond (1910)")}


def build_beblia(fname):
    root = ET.parse(os.path.join(SRC, "beblia", fname)).getroot()
    books = {}
    for book in root.iter("book"):
        code = BOOKS[int(book.get("number")) - 1][0]
        chapters = []
        for ch in book.iter("chapter"):
            verses = []
            for v in ch.iter("verse"):
                n = int(v.get("number"))
                while len(verses) < n - 1:
                    verses.append("")
                verses.append(re.sub(r"\s+", " ", v.text or "").strip())
            chapters.append(verses)
        books[code] = chapters
    return books


def load_lexicon(name, var):
    text = open(os.path.join(SRC, "strongs", name), encoding="utf-8").read()
    body = text[text.index(var) + len(var):].strip().lstrip("=").strip()
    body = body[: body.rindex("}") + 1]
    raw = json.loads(body)
    out = {}
    for k, e in raw.items():
        out[k] = {key: e[key].strip() for key in ("lemma", "xlit", "translit", "pron", "derivation", "strongs_def", "kjv_def") if e.get(key)}
    return out


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def main():
    only = set(sys.argv[1:])
    catalog = []
    for readme in sorted(glob.glob(os.path.join(SM, "sources", "*", "*", "README.md"))):
        lang, tid = readme.split(os.sep)[-3:-1]
        if tid in SKIP or (only and tid not in only):
            continue
        lic = read_license(readme)
        if not license_ok(lic):
            continue
        tagged = tid in TAGGED
        path = os.path.join(SM, TAGGED[tid]) if tagged else os.path.join(SM, "formats", "json", tid + ".json")
        if not os.path.exists(path):
            continue
        print("•", tid, file=sys.stderr)
        full, books = load_books(path, tagged)
        if not books:
            continue
        write_json(os.path.join(OUT, "bibles", tid + ".json"), {"id": tid, "books": books})
        name = re.sub(r"\s+with Strong.*$", "", clean_name(full or read_title(readme), tid), flags=re.I)
        catalog.append({"id": tid, "name": name, "lang": lang,
                        "license": lic, "strongs": tagged, "rtl": lang in RTL,
                        "books": list(books.keys()),
                        "source": "https://github.com/scrollmapper/bible_databases/tree/master/sources/%s/%s" % (lang, tid)})

    for tid, (fname, lang, name) in BEBLIA.items():
        if only and tid not in only:
            continue
        print("•", tid, file=sys.stderr)
        books = build_beblia(fname)
        write_json(os.path.join(OUT, "bibles", tid + ".json"), {"id": tid, "books": books})
        catalog.append({"id": tid, "name": name, "lang": lang, "license": "Public Domain",
                        "strongs": False, "rtl": False, "books": list(books.keys()),
                        "source": "https://github.com/Beblia/Holy-Bible-XML-Format"})

    if not only or "OSHB" in only:
        print("• OSHB", file=sys.stderr)
        write_json(os.path.join(OUT, "bibles", "OSHB.json"), {"id": "OSHB", "books": build_oshb()})
        catalog.append({"id": "OSHB", "name": "Westminster Leningrad Codex with Strong's (Open Scriptures Hebrew Bible)",
                        "lang": "hbo", "license": "Public Domain text; CC BY 4.0 lemma data (Open Scriptures)",
                        "strongs": True, "rtl": True, "books": [b[0] for b in BOOKS[:39]],
                        "source": "https://github.com/openscriptures/morphhb"})

    for c in catalog:
        en, native = LANGS.get(c["lang"], (c["lang"], c["lang"]))
        c["langName"], c["langNative"] = en, native
    featured = ["KJV", "BSB", "LSG"]
    catalog.sort(key=lambda c: (c["lang"] != "en", c["langName"], c["id"] not in featured, c["id"]))

    write_json(os.path.join(OUT, "catalog.json"), {
        "books": [{"id": code, "name": name} for code, name, _ in BOOKS],
        "translations": catalog})
    write_json(os.path.join(OUT, "strongs-hebrew.json"), load_lexicon("strongs-hebrew-dictionary.js", "var strongsHebrewDictionary"))
    write_json(os.path.join(OUT, "strongs-greek.json"), load_lexicon("strongs-greek-dictionary.js", "var strongsGreekDictionary"))
    print("%d translations, %d languages" % (len(catalog), len({c["lang"] for c in catalog})), file=sys.stderr)


if __name__ == "__main__":
    main()

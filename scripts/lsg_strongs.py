"""Strong's numbers for the Louis Segond 1910, from Clear Bible's word alignments.

Translators working with Clear Bible linked, by hand, each word of the Louis
Segond 1910 to the Hebrew (WLC, MACULA Hebrew) and Greek (SBLGNT) words it
translates. That alignment data is CC BY 4.0 (github.com/Clear-Bible/Alignments),
and its Hebrew and Greek word lists carry each word's Strong's number.

A link names the French word by its place in its verse, counted in eBible.org's
Louis Segond 1910 (public domain), split into words the way Clear did: an elided
word stands alone ("l’" "homme", "c’" "est"), a hyphenated word is one word
("lui-même", "Jésus-Christ"), punctuation counts as a word. eBible's text comes
verse by verse from the BibleNLP eBible corpus, in the Hebrew-style numbering.

Our LSG is another digitisation of the same text, so each verse of eBible's is
lined up with ours word by word (difflib), and a number is put on our word only
where the two words are the same. A verse the two numberings place apart
(psalm titles, Malachi 4, …) is left untagged, and so is any link that lands
on punctuation.
"""
import collections
import csv
import difflib
import json
import os
import re
import unicodedata

WORD = re.compile(r"[^\W\d_]+(?:-[^\W\d_]+)*['’]?|\d+|[^\w\s]")
USFM = ["GEN", "EXO", "LEV", "NUM", "DEU", "JOS", "JDG", "RUT", "1SA", "2SA", "1KI", "2KI", "1CH", "2CH",
        "EZR", "NEH", "EST", "JOB", "PSA", "PRO", "ECC", "SNG", "ISA", "JER", "LAM", "EZK", "DAN", "HOS",
        "JOL", "AMO", "OBA", "JON", "MIC", "NAM", "HAB", "ZEP", "HAG", "ZEC", "MAL",
        "MAT", "MRK", "LUK", "JHN", "ACT", "ROM", "1CO", "2CO", "GAL", "EPH", "PHP", "COL", "1TH", "2TH",
        "1TI", "2TI", "TIT", "PHM", "HEB", "JAS", "1PE", "2PE", "1JN", "2JN", "3JN", "JUD", "REV"]


def _src_strongs(path, prefix):
    """{Hebrew/Greek word id: 'H430'}"""
    out = {}
    with open(path, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE):
            m = re.match(r"[GH]?0*(\d+)", (r.get("strongs") or "").strip())
            if m and m.group(1) != "0":
                out[r["id"]] = prefix + m.group(1)
    return out


def _links(path, strongs):
    """{verse 'BBCCCVVV': {word place: ['H430', …]}}"""
    data = json.load(open(path, encoding="utf-8"))
    verses = collections.defaultdict(lambda: collections.defaultdict(list))
    for r in data["records"]:
        nums = []
        for s in r["source"]:
            n = strongs.get(s)
            if n and n not in nums:
                nums.append(n)
        for t in r["target"]:
            here = verses[t[:8]][int(t[8:11])]
            for n in nums:
                if n not in here:
                    here.append(n)
    return verses


def _norm(w):
    w = unicodedata.normalize("NFD", w.replace("’", "'").lower().replace("œ", "oe").replace("æ", "ae"))
    return "".join(c for c in w if unicodedata.category(c) != "Mn")


def place(ours, theirs, links):
    """[(start, end, numbers)] for our verse: each linked word of eBible's
    verse (theirs) put on the same word of ours."""
    mine = [(m.start(), m.end(), _norm(m.group())) for m in WORD.finditer(ours)]
    them = [_norm(w) for w in WORD.findall(theirs)]
    sm = difflib.SequenceMatcher(None, [w for _, _, w in mine], them, autojunk=False)
    out = []
    for a, b, size in sm.get_matching_blocks():
        for k in range(size):
            nums = links.get(b + k + 1)
            s, e, w = mine[a + k]
            if nums and w[:1].isalnum():
                out.append((s, e, nums))
    return out


def mark(text, spans):
    """Our verse with {word|H1 H2} around the placed words."""
    out, last = [], 0
    for s, e, nums in sorted(spans):
        out.append(text[last:s])
        out.append("{%s|%s}" % (text[s:e], " ".join(nums)))
        last = e
    out.append(text[last:])
    return "".join(out)


def ebible_verses(src):
    """{'GEN 1:1': text} from the BibleNLP eBible corpus."""
    d = os.path.join(src, "ebible")
    return {r.strip(): t.strip() for r, t in zip(open(os.path.join(d, "vref.txt"), encoding="utf-8"),
                                                  open(os.path.join(d, "fra-fraLSG.txt"), encoding="utf-8"))}


def tag_lsg(books, book_codes, src, moves):
    """Puts Strong's markup into the LSG books in place. book_codes: our book
    ids in canonical order (Gen…Rev). moves: Hebrew-style verse -> English
    verse, from ebible_numbering(); a psalm's title (English verse 0) is part
    of our verse 1, so eBible's verses are joined the way ours are before
    they are lined up. Returns counts for the build log."""
    al = os.path.join(src, "Alignments", "data")
    links = _links(os.path.join(al, "fra", "alignments", "LSG", "WLCM-LSG-manual.json"),
                   _src_strongs(os.path.join(al, "sources", "WLCM.tsv"), "H"))
    links.update(_links(os.path.join(al, "fra", "alignments", "LSG", "SBLGNT-LSG-manual.json"),
                        _src_strongs(os.path.join(al, "sources", "SBLGNT.tsv"), "G")))
    eb = ebible_verses(src)
    # Which of eBible's verses make up each of ours, in order.
    ours = collections.defaultdict(list)
    for ref in eb:
        m = re.match(r"(\w+) (\d+):(\d+)$", ref)
        if not m or m.group(1) not in USFM:
            continue
        k = (m.group(1), int(m.group(2)), int(m.group(3)))
        to = moves.get(k, k)
        if to[2] == 0:
            to = (to[0], to[1], 1)
        ours[to].append(k)
    stats = collections.Counter()
    for (bk, c, n), parts in ours.items():
        b = USFM.index(bk)
        chs = books.get(book_codes[b]) if b < len(book_codes) else None
        if not chs or c > len(chs) or n > len(chs[c - 1]) or not chs[c - 1][n - 1]:
            continue
        parts.sort(key=lambda k: (moves.get(k, k)[2], k[1], k[2]))
        theirs, vlinks, at = [], {}, 0
        for k in parts:
            words = WORD.findall(eb["%s %d:%d" % k])
            for pos, nums in links.get("%02d%03d%03d" % (b + 1, k[1], k[2]), {}).items():
                vlinks[at + pos] = nums
            theirs += words
            at += len(words)
        if not vlinks:
            continue
        spans = place(chs[c - 1][n - 1], " ".join(theirs), vlinks)
        stats["links"] += len(vlinks)
        stats["placed"] += len(spans)
        chs[c - 1][n - 1] = mark(chs[c - 1][n - 1], spans)
    return stats


# Words as the app counts them to put a Strong's file's numbers back
# (withTags in src/lib/text.ts): keep the two in step.
WORD_LETTERS = re.compile(r"[^\W\d_]+(?:-[^\W\d_]+)*['’]?")
TAG = re.compile(r"\{([^{}|]*)\|([^{}]*)\}")


def strongs_file(tagged):
    """The tags of tagged books, apart from their text: per verse, for each
    tagged word, how many words to skip since the last one, then its numbers
    ("1H7225 H430 H1254+H853"). Gzipped it is a third of the tagged text's
    extra size, and only people who show Strong's numbers download it."""
    out = {}
    for book, chs in tagged.items():
        out[book] = []
        for ch in chs:
            row = []
            for v in ch:
                plain, spans = "", []
                last = 0
                for m in TAG.finditer(v):
                    plain += v[last:m.start()]
                    spans.append((len(plain), m.group(2)))
                    plain += m.group(1)
                    last = m.end()
                plain += v[last:]
                starts = {m.start(): i for i, m in enumerate(WORD_LETTERS.finditer(plain))}
                parts, prev = [], -1
                for s, nums in spans:
                    i = starts[s]
                    gap = i - prev - 1
                    prev = i
                    parts.append((str(gap) if gap else "") + nums.replace(" ", "+"))
                row.append(" ".join(parts))
            out[book].append(row)
    return out

#!/usr/bin/env python3
"""Build the word dictionaries the app's "Define" uses (public/dict/*.json).

One small file per language (English, French, Spanish), holding only the
words that appear in that language's Bibles, with the definitions written in
the same language. The files are committed: the app's build and deploy never
download a dictionary. Run this again by hand when a Bible is added in one of
these languages, or to pick up Wiktionary's improvements:

    npm run data                      # the Bibles, for their words
    bash scripts/fetch_dict.sh        # the three Wiktionary extracts (about 1 GB)
    python3 scripts/build_dict.py

Source: Wiktionary (en.wiktionary.org, fr.wiktionary.org, es.wiktionary.org),
as extracted by Wiktextract and published at kaikki.org. Wiktionary's text is
under CC BY-SA 4.0, and so are these files.

A file looks like {"w": {word: {"d": [[kind, definition, ...], ...],
"f": [[base word, how the word comes from it], ...]}}}: "begat" has
f = [["beget", "simple past of beget"]], and the app shows beget's own
definitions under it. A form found only in its base word's list of forms
has no "how": "aïeux" has f = [["aïeul"]].
"""
import glob
import gzip
import json
import os
import re
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data")
SRC = os.environ.get("DICT_SOURCES", os.path.join(ROOT, "sources", "dict"))
OUT = os.path.join(ROOT, "public", "dict")

LANGS = ("en", "fr", "es")

# Kinds of entries that are words you would look up while reading.
POS = {"noun", "verb", "adj", "adv", "name", "pron", "prep", "conj", "det", "intj", "num",
       "article", "particle", "contraction", "postp", "adv_phrase", "prep_phrase"}
POS_EN = {"adj": "adjective", "adv": "adverb", "name": "proper noun", "pron": "pronoun",
          "prep": "preposition", "conj": "conjunction", "det": "determiner", "intj": "interjection",
          "num": "number", "postp": "postposition", "adv_phrase": "adverb", "prep_phrase": "preposition"}

PER_ENTRY = 4      # definitions kept for one kind (noun, verb…) of a word
PER_WORD = 9       # definitions kept for a word in all
BASES = 4          # base words kept for a form ("vit": vivre, voir)
LONG = 260         # a definition longer than this is cut at a word

# A reader of the Bible is most likely after these meanings: one of them is
# kept even when it comes late in a long entry.
SACRED = {"biblical", "Christianity", "religion", "Judaism", "theology", "Catholicism", "Protestantism", "ecclesiastical"}
SACRED_RE = re.compile(r"\b(Bible|bibli|bíbli|Testament|Évangile|Evangeli|Israel|Israël|Hebrew|Hébreu|hebreo|Jesus|Jésus|Jesús)", re.I)

# Meanings that are no help to a reader: "a surname", "a male given name".
NAME_ONLY = re.compile(r"\b(sur|given |first |family )name\b|^(Prénom|Nom de famille|Nombre de pila|Apellido)\b", re.I)
NAME_TITLES = {"Prénom", "Nom de famille"}

WORD = re.compile(r"[^\W\d_]+(?:['’\-‑][^\W\d_]+)*")
MARKUP = re.compile(r"<[^>]*>|\{[^}]*\}")


def norm(w):
    return unicodedata.normalize("NFC", w).replace("’", "'").replace("‑", "-")


def bible_words(lang):
    """Every word of the Bibles in a language, with the pieces of words joined
    by an apostrophe or a hyphen (l'Éternel, dit-il), in the cases the app
    looks them up in."""
    catalog = json.load(open(os.path.join(DATA, "catalog.json"), encoding="utf-8"))
    words = set()
    for tr in catalog["translations"]:
        if tr["lang"] != lang:
            continue
        bible = json.load(open(os.path.join(DATA, "bibles", tr["id"] + ".json"), encoding="utf-8"))
        for chapters in bible["books"].values():
            for chapter in chapters:
                for verse in chapter:
                    for m in WORD.finditer(MARKUP.sub(" ", verse)):
                        w = norm(m.group())
                        words.add(w)
                        words.update(p for p in re.split(r"['\-]", w) if p)
    out = set()
    for w in words:
        out.update((w, w.lower(), w.lower().capitalize()))
    return out


def clip(s):
    s = re.sub(r"\s+", " ", s).strip()
    if len(s) <= LONG:
        return s
    return s[:LONG].rsplit(" ", 1)[0].rstrip(",;:. ") + "…"


def gloss(sense, lang):
    # English keeps Wiktionary's labels, "(archaic) To know.": they matter in
    # an old Bible. The French and Spanish extracts give them as codes.
    g = (lang == "en" and sense.get("raw_glosses")) or sense.get("glosses") or []
    g = [x for x in g if x and x.strip()]
    if not g:
        return ""
    if len(g) > 1 and g[0].startswith("(") and g[0].endswith(")"):
        return clip(" ".join(g))
    # A meaning under a broader one: the last is the one meant.
    return clip(g[-1])


def sacred(sense, text):
    """A meaning from the Bible's world. Not one that is merely old, nor one
    whose label names a Bible ("(Tyndale Bible, obsolete) Charity")."""
    if {"obsolete", "archaic"} & set(sense.get("tags") or []):
        return False
    words = " ".join(sense.get("glosses") or [])
    return bool(SACRED & set(sense.get("topics") or [])) or bool(SACRED_RE.search(words))


def kind(entry, lang):
    if lang == "en":
        return POS_EN.get(entry["pos"], entry["pos"])
    return re.sub(r"\s*\d+$", "", entry.get("pos_title") or entry["pos"]).strip()


def how(text, lang):
    """How a form comes from its base word, shortened."""
    text = re.sub(r"\s*\([^)]*\)", "", text).strip()
    return clip(text)


def read(path, lang, wanted, bases_only=False):
    """The entries for the wanted words: definitions per kind, and base words.
    A form that has no entry of its own ("aïeux") is found in the list of
    forms of its base word ("aïeul")."""
    found, inflected = {}, {}
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            e = json.loads(line)
            w = norm(e.get("word") or "")
            if e.get("pos") not in POS or e.get("lang_code", lang) != lang:
                continue
            if not bases_only:
                for x in e.get("forms") or []:
                    form = norm(x.get("form") or "")
                    if form != w and form in wanted and len(inflected.setdefault(form, [])) < BASES and w not in inflected[form]:
                        inflected[form].append(w)
            if w not in wanted:
                continue
            if (e.get("pos_title") or "").strip() in NAME_TITLES:
                continue
            defs, holy, forms = [], [], []
            for s in e.get("senses") or []:
                text = gloss(s, lang)
                if not text:
                    continue
                base = s.get("form_of") or s.get("alt_of")
                if base:
                    for b in base:
                        if b.get("word") and norm(b["word"]) != w:
                            forms.append([norm(b["word"]), how(text, lang)])
                    continue
                if NAME_ONLY.search(text) or text in defs or text in holy:
                    continue
                # The Bible's meaning first ("publican": the tax collector,
                # before the landlord of a pub).
                (holy if sacred(s, text) else defs).append(text)
            defs = (holy + defs)[:PER_ENTRY]
            slot = found.setdefault(w, {"d": [], "f": []})
            if defs:
                # An entry with a meaning from the Bible goes before those without.
                at = sum(1 for d in slot["d"] if d[0] == "*") if holy else len(slot["d"])
                slot["d"].insert(at, (["*"] if holy else []) + [kind(e, lang)] + defs)
            if not bases_only:
                for b in forms:
                    if all(x[0] != b[0] for x in slot["f"]):
                        slot["f"].append(b)
    for form, bases in inflected.items():
        # Only for a word with no entry of its own: "cizaña" is a noun, not
        # just a form of the verb "cizañar".
        if found.get(form, {}).get("d"):
            continue
        slot = found.setdefault(form, {"d": [], "f": []})
        for b in bases:
            if all(x[0] != b for x in slot["f"]):
                slot["f"].append([b])
    return found


def trim(entry):
    left = PER_WORD
    kept = []
    for d in entry["d"]:
        if left <= 0:
            break
        if d[0] == "*":
            d = d[1:]
        kept.append(d[:1 + left])
        left -= len(kept[-1]) - 1
    out = {}
    if kept:
        out["d"] = kept
    if entry["f"]:
        out["f"] = entry["f"][:BASES]
    return out


def build(lang):
    path = os.path.join(SRC, lang + ".jsonl.gz")
    if not os.path.exists(path):
        sys.exit("Missing %s: run scripts/fetch_dict.sh first." % path)
    vocab = bible_words(lang)
    print("•", lang, len(vocab), "word shapes in the Bibles", file=sys.stderr)
    found = read(path, lang, vocab)
    # The base words of the forms found ("begat" → "beget") that the Bibles
    # don't spell out themselves.
    missing = {b[0] for e in found.values() for b in e["f"][:BASES]} - set(found)
    if missing:
        for w, e in read(path, lang, missing, bases_only=True).items():
            found[w] = e
    words = {}
    for w in sorted(found):
        e = trim(found[w])
        # A base word that has no definition of its own is no help.
        if "f" in e:
            e["f"] = [b for b in e["f"] if found.get(b[0], {}).get("d")]
            if not e["f"]:
                del e["f"]
        if e:
            words[w] = e
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, lang + ".json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"w": words}, f, ensure_ascii=False, separators=(",", ":"))
    print("  %d words, %.1f MB" % (len(words), os.path.getsize(out) / 1e6), file=sys.stderr)


if __name__ == "__main__":
    for lang in sys.argv[1:] or LANGS:
        build(lang)

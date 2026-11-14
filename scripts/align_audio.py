#!/usr/bin/env python3
"""Find where each word falls in a recorded audio Bible.

The app plays public-domain recordings one chapter at a time, straight from
where their publisher keeps them. For the highlight to follow the reader's
voice word by word, and for "read from this verse" to land on the verse, the
app needs to know when each word is said. This works that out once, here, and
writes small per-book files into public/audio-times/<voice>/ which are
committed; the app fetches a book's file only when someone listens to it.

How: each chapter is listened to by a small offline speech recogniser
(PocketSphinx, with its bundled English model) that is only allowed the words
of that chapter, and what it heard is lined up with the chapter's text. Words
it missed (a name it can't pronounce) are placed evenly between their
neighbours.

  pip install pocketsphinx regex        (and ffmpeg on the PATH)
  npm run data                          (the app's own Bible texts)
  python3 scripts/align_audio.py hays   (or souer, gilbert, david; hours each)

Words are split exactly as src/lib/follow.ts does, on the text exactly as
src/listen.tsx reads it, so word N here is word N in the app. If a Bible's
text changes, the app notices the word count of a verse no longer matches and
follows that verse as a whole instead; run this again to bring it back.
"""
import collections
import concurrent.futures
import difflib
import json
import math
import os
import subprocess
import sys
import tempfile
import urllib.request

import regex

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The recordings: where a chapter's file is, and whose text it reads. The same
# list, by id, is in src/lib/recordings.ts.
BASE = "https://openbible.com/audio/"
VOICES = {
    "hays": ("BSB", BASE + "hays/BSB_{n:02d}_{code}_{c:03d}_H.mp3"),
    "souer": ("BSB", BASE + "souer/BSB_{n:02d}_{code}_{c:03d}.mp3"),
    "gilbert": ("BSB", BASE + "gilbert/BSB_{n:02d}_{code}_{c:03d}_G.mp3"),
    "david": ("KJV", BASE + "kjv/KJV_{n:02d}_{code}_{c:03d}.mp3"),
}
# The app's book ids, in order, and the publisher's three-letter codes.
BOOKS = [
    ("Gen", "Gen"), ("Exod", "Exo"), ("Lev", "Lev"), ("Num", "Num"), ("Deut", "Deu"), ("Josh", "Jos"),
    ("Judg", "Jdg"), ("Ruth", "Rut"), ("1Sam", "1Sa"), ("2Sam", "2Sa"), ("1Kgs", "1Ki"), ("2Kgs", "2Ki"),
    ("1Chr", "1Ch"), ("2Chr", "2Ch"), ("Ezra", "Ezr"), ("Neh", "Neh"), ("Esth", "Est"), ("Job", "Job"),
    ("Ps", "Psa"), ("Prov", "Pro"), ("Eccl", "Ecc"), ("Song", "Sng"), ("Isa", "Isa"), ("Jer", "Jer"),
    ("Lam", "Lam"), ("Ezek", "Ezk"), ("Dan", "Dan"), ("Hos", "Hos"), ("Joel", "Jol"), ("Amos", "Amo"),
    ("Obad", "Oba"), ("Jonah", "Jon"), ("Mic", "Mic"), ("Nah", "Nam"), ("Hab", "Hab"), ("Zeph", "Zep"),
    ("Hag", "Hag"), ("Zech", "Zec"), ("Mal", "Mal"), ("Matt", "Mat"), ("Mark", "Mrk"), ("Luke", "Luk"),
    ("John", "Jhn"), ("Acts", "Act"), ("Rom", "Rom"), ("1Cor", "1Co"), ("2Cor", "2Co"), ("Gal", "Gal"),
    ("Eph", "Eph"), ("Phil", "Php"), ("Col", "Col"), ("1Thess", "1Th"), ("2Thess", "2Th"), ("1Tim", "1Ti"),
    ("2Tim", "2Ti"), ("Titus", "Tts"), ("Phlm", "Phm"), ("Heb", "Heb"), ("Jas", "Jas"), ("1Pet", "1Pe"),
    ("2Pet", "2Pe"), ("1John", "1Jn"), ("2John", "2Jn"), ("3John", "3Jn"), ("Jude", "Jud"), ("Rev", "Rev"),
]

# As in src/lib/follow.ts and src/lib/text.ts.
WORD = regex.compile(r"[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*")
TAG = regex.compile(r"\{([^{}|]*)\|([^{}]*)\}")


def spoken(verse):
    """A verse as the app reads it aloud."""
    return regex.sub(r"[\[\]¶*]", "", TAG.sub(r"\1", verse)).strip()


# What a narrator says that isn't in the verses: the chapter's name, a psalm's
# title. Allowed, so they're heard as themselves and not as verse words.
EXTRA = ("chapter psalm psalms a of the for to song songs david asaph solomon moses sons korah choirmaster "
         "music director maskil miktam prayer selah first second third one two three four five six seven "
         "eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty "
         "thirty forty fifty sixty seventy eighty ninety hundred and book gospel according letter epistle").split()

_dict = None


def pronunciations():
    global _dict
    if _dict is None:
        from pocketsphinx import get_model_path
        _dict = collections.defaultdict(list)
        with open(os.path.join(get_model_path(), "en-us", "cmudict-en-us.dict")) as f:
            for line in f:
                w, _, p = line.strip().partition(" ")
                _dict[regex.sub(r"\(\d+\)$", "", w)].append(p)
    return _dict


def sounds(word):
    """How a word is said, if it can be worked out: the dictionary's own, or
    an older ending on a word it knows (maketh, leadest, God's)."""
    d = pronunciations()
    if word in d:
        return d[word]
    for end, phones in (("'s", "Z"), ("eth", "AH TH"), ("est", "AH S T"), ("th", "TH"), ("st", "S T")):
        if word.endswith(end) and len(word) > len(end) + 1:
            stem = word[: -len(end)]
            for s in (stem, stem + "e", stem[:-1] if stem[-1:] == stem[-2:-1] else stem):
                if s in d:
                    return [p + " " + phones for p in d[s][:1]]
    return None


def key(word):
    """A word as the recogniser knows it: plain lower-case letters."""
    return regex.sub(r"[^a-z']", "", word.lower().replace("’", "'")).strip("'")


def line_up(said, heard):
    """Which word of the text each heard word is: pairs (text index, heard
    index), in order. Quick first; where a chapter repeats itself so much that
    the quick way loses its place (the offerings of Numbers 7), the longest
    run of words that both have in the same order, worked out in full."""
    sm = difflib.SequenceMatcher(None, said, heard, autojunk=False)
    pairs = [(b.a + k, b.b + k) for b in sm.get_matching_blocks() for k in range(b.size)]
    if len(pairs) >= 0.9 * len(said):
        return pairs
    n, m = len(said), len(heard)
    rows = [[0] * (m + 1)]
    for i in range(n):
        prev, w = rows[-1], said[i]
        row = [0] * (m + 1)
        for j in range(m):
            row[j + 1] = prev[j] + 1 if w == heard[j] else (prev[j + 1] if prev[j + 1] >= row[j] else row[j])
        rows.append(row)
    out, i, j = [], n, m
    while i and j:
        if said[i - 1] == heard[j - 1] and rows[i][j] == rows[i - 1][j - 1] + 1:
            out.append((i - 1, j - 1))
            i -= 1
            j -= 1
        elif rows[i - 1][j] >= rows[i][j - 1]:
            i -= 1
        else:
            j -= 1
    out.reverse()
    return out if len(out) > len(pairs) else pairs


def align(raw, verses, extra):
    """Each verse's word times in centiseconds: [start, gap, gap, ..., length
    of the last word]. Returns them with the share of words truly heard."""
    from pocketsphinx import Decoder
    text = [spoken(v) for v in verses]
    ref = [(key(m.group()), vi) for vi, t in enumerate(text) for m in WORD.finditer(t)]
    if not ref:
        return [[] for _ in verses], 1.0
    known = [w for w, _ in ref if w and sounds(w)]
    vocab = collections.Counter(known)
    for w in extra + EXTRA:
        if sounds(w):
            vocab[w] += 1
    pairs = collections.Counter(zip(["<s>"] + known, known + ["</s>"]))
    after = collections.Counter()
    for (a, _), c in pairs.items():
        after[a] += c
    vocab["<s>"] += 1
    vocab["</s>"] += 1
    total = sum(vocab.values())
    with tempfile.TemporaryDirectory() as tmp:
        lm, dic = os.path.join(tmp, "c.lm"), os.path.join(tmp, "c.dict")
        with open(lm, "w") as f:
            f.write("\\data\\\nngram 1=%d\nngram 2=%d\n\n\\1-grams:\n" % (len(vocab), len(pairs)))
            for w, c in vocab.items():
                f.write("%.4f %s %.4f\n" % (math.log10(c / total), w, math.log10(0.3)))
            f.write("\n\\2-grams:\n")
            for (a, b), c in pairs.items():
                f.write("%.4f %s %s\n" % (math.log10(0.7 * c / after[a]), a, b))
            f.write("\n\\end\\\n")
        with open(dic, "w") as f:
            for w in sorted(vocab):
                if w.startswith("<"):
                    continue
                for i, p in enumerate(sounds(w)):
                    f.write("%s%s %s\n" % (w, "" if i == 0 else "(%d)" % (i + 1), p))
        d = Decoder(samprate=16000, loglevel="FATAL", lm=lm, dict=dic, ds=2)
        d.start_utt()
        d.process_raw(raw, False, True)
        d.end_utt()
        heard = [(regex.sub(r"\(\d+\)$", "", s.word), s.start_frame, s.end_frame + 1) for s in d.seg()
                 if not s.word.startswith("<") and not s.word.startswith("[")]
    length = len(raw) // 320  # centiseconds
    times = [None] * len(ref)
    for i, j in line_up([w for w, _ in ref], [w for w, _, _ in heard]):
        times[i] = (heard[j][1], heard[j][2])
    hit = sum(1 for t in times if t)
    # Words not heard sit evenly, by their length, between the ones around them.
    i = 0
    while i < len(ref):
        if times[i]:
            i += 1
            continue
        j = i
        while j < len(ref) and not times[j]:
            j += 1
        lo = times[i - 1][1] if i else None
        hi = times[j][0] if j < len(ref) else None
        size = [max(2, len(ref[k][0])) * 7 for k in range(i, j)]  # about 70 ms a letter
        if lo is None and hi is None:
            lo, hi = 0, length
        elif lo is None:
            lo = max(0, hi - sum(size))
        elif hi is None:
            hi = min(length, lo + sum(size))
        hi = max(hi, lo)
        at, span = lo, hi - lo
        for n, k in enumerate(range(i, j)):
            w = span * size[n] / sum(size)
            times[k] = (round(at), round(at + w))
            at += w
        i = j
    out = [[] for _ in verses]
    prev = {}
    for (w, vi), (a, b) in zip(ref, times):
        row = out[vi]
        if not row:
            row.append(a)
        else:
            row[-1] = max(0, a - prev[vi])  # the gap from the word before
        row.append(max(1, b - a))
        prev[vi] = a
    return out, hit / len(ref)


def past_the_name(times):
    """A chapter's recording opens with its name ("John 3"), which the app
    skips. Now and then a word of the name is taken for the first word of the
    first verse ("the" in "the book of…"), so the verse seems to start within
    the first seconds, before a long gap. Put such early words right before
    the first word after that gap."""
    row = next((r for r in times if r), None)
    if not row or len(row) < 3 or row[0] >= 250:
        return
    gaps = row[1:-1][:6]
    k = max(range(len(gaps)), key=lambda i: gaps[i])
    if gaps[k] < 80:
        return
    start = row[0] + sum(gaps[: k + 1])  # where the word after the gap starts
    for i in range(k + 1):
        row[1 + i] = 25
    row[0] = max(0, start - 25 * (k + 1))


def chapter(job):
    voice, url, verses, extra = job
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "plain-bible-align"}), timeout=120) as r:
                mp3 = r.read()
            break
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                return None, 0.0, str(e)
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", "pipe:0", "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1"],
                         input=mp3, capture_output=True, check=True).stdout
    times, share = align(raw, verses, extra)
    past_the_name(times)
    return times, share, None


def main():
    voice = sys.argv[1]
    only = sys.argv[2:]  # book ids, to do just those
    version, pattern = VOICES[voice]
    bible = json.load(open(os.path.join(ROOT, "public", "data", "bibles", version + ".json")))["books"]
    out = os.path.join(ROOT, "public", "audio-times", voice)
    os.makedirs(out, exist_ok=True)
    # How much of each chapter was truly heard, kept beside the times (not shipped: see .gitignore).
    log = os.path.join(ROOT, "public", "audio-times", voice + ".report.json")
    report = json.load(open(log)) if os.path.exists(log) else {}
    with concurrent.futures.ProcessPoolExecutor(max_workers=os.cpu_count()) as pool:
        for n, (book, code) in enumerate(BOOKS, 1):
            path = os.path.join(out, book + ".json")
            if (only and book not in only) or (not only and os.path.exists(path)):
                continue
            names = regex.findall(r"[a-z]+", book.lower()) + [key(w) for w in code.split()]
            jobs = [(voice, pattern.format(n=n, code=code, c=c), verses, names)
                    for c, verses in enumerate(bible[book], 1)]
            done = list(pool.map(chapter, jobs))
            bad = [(c, err) for c, (_, _, err) in enumerate(done, 1) if err]
            if bad:
                print(book, "FAILED", bad, flush=True)
                continue
            json.dump({"v": 1, "c": [t for t, _, _ in done]}, open(path, "w"), separators=(",", ":"))
            shares = [s for _, s, _ in done]
            report[book] = [round(s, 3) for s in shares]
            json.dump(report, open(log, "w"))
            print(book, "chapters", len(done), "heard %.1f%%" % (100 * sum(shares) / len(shares)),
                  "worst %.0f%% (ch %d)" % (100 * min(shares), shares.index(min(shares)) + 1), flush=True)


if __name__ == "__main__":
    main()

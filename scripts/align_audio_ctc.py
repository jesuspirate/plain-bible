#!/usr/bin/env python3
"""Find where each word falls in a recorded audio Bible, for languages the
English PocketSphinx model of align_audio.py can't hear (French first).

Each chapter is heard by a wav2vec2 speech model for that language, which
writes down what it hears with the moment of each letter; what it heard is
lined up with the chapter's text the same way align_audio.py does it, and
words it missed (names, mostly) are placed evenly between their neighbours.
The output has the same shape as align_audio.py's: public/audio-times/<voice>/<Book>.json,
with "a" (where each chapter's announcement starts) filled in too.

  python3 -m venv al && al/bin/pip install torch transformers regex numpy
  npm run data                                       (the app's own Bible texts)
  al/bin/python scripts/align_audio_ctc.py tresor <folder of <Book>/<chapter>.mp3> [Book ...]

The recordings are read from a local folder (the same files that are served),
so this needs no network once the model is downloaded. About 5 minutes of
computer time per hour of audio on four cores.
"""
import json, os, subprocess, sys, unicodedata, difflib
import numpy as np
import regex

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOICES = {"tresor": ("LSG", "jonatasgrosman/wav2vec2-large-xlsr-53-french")}
BOOKS = ["Gen", "Exod", "Lev", "Num", "Deut", "Josh", "Judg", "Ruth", "1Sam", "2Sam", "1Kgs", "2Kgs", "1Chr", "2Chr",
         "Ezra", "Neh", "Esth", "Job", "Ps", "Prov", "Eccl", "Song", "Isa", "Jer", "Lam", "Ezek", "Dan", "Hos", "Joel",
         "Amos", "Obad", "Jonah", "Mic", "Nah", "Hab", "Zeph", "Hag", "Zech", "Mal", "Matt", "Mark", "Luke", "John",
         "Acts", "Rom", "1Cor", "2Cor", "Gal", "Eph", "Phil", "Col", "1Thess", "2Thess", "1Tim", "2Tim", "Titus",
         "Phlm", "Heb", "Jas", "1Pet", "2Pet", "1John", "2John", "3John", "Jude", "Rev"]

# As in src/lib/follow.ts and src/lib/text.ts.
WORD = regex.compile(r"[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*")
TAG = regex.compile(r"\{([^{}|]*)\|([^{}]*)\}")
RATE = 16000
FRAME = 320  # samples per model frame: 20 ms


def spoken(verse):
    return regex.sub(r"[\[\]¶*]", "", TAG.sub(r"\1", verse)).strip()


def key(word):
    """A word as heard, forgiving what French spelling doesn't say aloud:
    accents, doubled letters, silent endings (aimé, aimer, aimez)."""
    w = unicodedata.normalize("NFD", word.lower().replace("’", "'"))
    w = "".join(c for c in w if unicodedata.category(c) != "Mn")
    w = regex.sub(r"[^a-z']", "", w).strip("'")
    w = regex.sub(r"h", "", w)
    w = regex.sub(r"(.)\1+", r"\1", w)
    if len(w) > 3:
        w = regex.sub(r"(?:ent|[sxtzdre])+$", "", w) or w
    return w


class Ear:
    def __init__(self, name):
        import torch
        from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
        torch.set_num_threads(int(os.environ.get("THREADS", os.cpu_count())))
        self.torch = torch
        self.proc = Wav2Vec2Processor.from_pretrained(name)
        model = Wav2Vec2ForCTC.from_pretrained(name).eval()
        self.model = torch.ao.quantization.quantize_dynamic(model, {torch.nn.Linear}, dtype=torch.qint8)
        vocab = self.proc.tokenizer.get_vocab()
        self.chars = {i: c for c, i in vocab.items()}
        self.blank, self.space = vocab["<pad>"], vocab["|"]

    def hear(self, audio):
        """Every frame's most likely letter, the whole recording, heard in
        pieces of about 20 seconds cut where it's quietest."""
        out, at, n = [], 0, len(audio)
        while at < n:
            end = min(n, at + 20 * RATE)
            if end < n:  # cut in the quietest 50 ms of the last 4 seconds
                win = audio[end - 4 * RATE:end]
                e = np.convolve(win ** 2, np.ones(800), "valid")
                end = end - 4 * RATE + int(np.argmin(e[::160]) * 160) + 400
                end -= end % FRAME
            with self.torch.inference_mode():
                lg = self.model(self.torch.from_numpy(audio[at:end].copy())[None]).logits[0]
            ids = lg.argmax(-1).tolist()
            want = (end - at) // FRAME
            ids = (ids + [self.blank] * want)[:want]
            out += ids
            at = end
        return out

    def words(self, ids):
        """What was heard: (word, first frame, frame after the last)."""
        got, cur, start, last, prev = [], "", None, None, None
        for f, i in enumerate(ids):
            if i == prev:
                if i not in (self.blank, self.space) and cur:
                    last = f
                continue
            prev = i
            if i == self.blank:
                continue
            if i == self.space or self.chars[i] == "-":
                if cur:
                    got.append((cur, start, last + 1))
                cur = ""
                continue
            c = self.chars[i]
            if c.startswith("<"):
                continue
            if not cur:
                start = f
            cur += c
            last = f
        if cur:
            got.append((cur, start, last + 1))
        return got


def line_up(said, heard):
    """As in align_audio.py: quick first; where a chapter repeats itself so
    much that the quick way loses its place (the offerings of Numbers 7), the
    longest run of words both have in the same order, worked out in full."""
    sm = difflib.SequenceMatcher(None, said, heard, autojunk=False)
    pairs = [(b.a + k, b.b + k) for b in sm.get_matching_blocks() for k in range(b.size)]
    if len(pairs) >= 0.8 * len(said):
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


def align(ear, audio, verses):
    text = [spoken(v) for v in verses]
    ref = [(m.group(), vi) for vi, t in enumerate(text) for m in WORD.finditer(t)]
    ids = ear.hear(audio)
    heard = ear.words(ids)
    length = len(ids) * 2  # centiseconds
    first_sound = next((f for f, i in enumerate(ids) if i not in (ear.blank, ear.space)), 0) * 2
    if not ref:
        return [[] for _ in verses], 1.0, first_sound
    times = [None] * len(ref)
    for i, j in line_up([key(w) for w, _ in ref], [key(w) for w, _, _ in heard]):
        times[i] = (heard[j][1] * 2, heard[j][2] * 2)
    hit = sum(1 for t in times if t)
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
        size = [max(2, len(ref[k][0])) * 7 for k in range(i, j)]
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
    out, prev = [[] for _ in verses], {}
    for (w, vi), (a, b) in zip(ref, times):
        row = out[vi]
        if not row:
            row.append(a)
        else:
            row[-1] = max(0, a - prev[vi])
        row.append(max(1, b - a))
        prev[vi] = a
    return out, hit / len(ref), first_sound


def main():
    voice, folder, only = sys.argv[1], sys.argv[2], sys.argv[3:]
    version, model = VOICES[voice]
    bible = json.load(open(os.path.join(ROOT, "public", "data", "bibles", version + ".json")))["books"]
    out = os.path.join(ROOT, "public", "audio-times", voice)
    os.makedirs(out, exist_ok=True)
    log = os.path.join(ROOT, "public", "audio-times", voice + ".report.json")
    report = json.load(open(log)) if os.path.exists(log) else {}
    ear = Ear(model)
    for book in BOOKS:
        path = os.path.join(out, book + ".json")
        if (only and book not in only) or (not only and os.path.exists(path)):
            continue
        if not os.path.isdir(os.path.join(folder, book)):
            continue
        chapters, shares, starts = [], [], []
        for c, verses in enumerate(bible[book], 1):
            raw = subprocess.run(["ffmpeg", "-v", "error", "-i", os.path.join(folder, book, f"{c}.mp3"), "-ac", "1",
                                  "-ar", str(RATE), "-f", "f32le", "-"], capture_output=True, check=True).stdout
            times, share, first = align(ear, np.frombuffer(raw, np.float32), verses)
            chapters.append(times)
            shares.append(share)
            starts.append(max(0, first - 5))
        json.dump({"v": 1, "c": chapters, "a": starts}, open(path, "w"), separators=(",", ":"))
        report[book] = [round(s, 3) for s in shares]
        json.dump(report, open(log, "w"))
        print(book, "chapters", len(chapters), "heard %.1f%%" % (100 * sum(shares) / len(shares)),
              "worst %.0f%% (ch %d)" % (100 * min(shares), shares.index(min(shares)) + 1), flush=True)


if __name__ == "__main__":
    main()

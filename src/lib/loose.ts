// Forgiving search for plain words, the way people remember verses.
//
// A query of bare words (no quotes, operators, wildcards or Strong's
// numbers) is matched loosely: words are compared by their stem (weapons =
// weapon, formed = form, loveth = loves = loved), small words and pronouns
// are not required (me / thee / you), the words may be apart, and a verse
// that misses a word or two still counts when the rarer words are there.
// Verses are then ranked: the most of the rare words, in the order typed,
// close together, comes first. "Quotes" or any operator gives the exact
// search instead.
import { lex } from './query'

export interface LooseWord { word: string; key: string; content: boolean }
export interface LooseQuery { words: LooseWord[]; stems: string[]; need: number }

/** The plain words of a query, or undefined when it should be matched exactly. */
export function looseWords(q: string): string[] | undefined {
  const toks = lex(q, [])
  const words: string[] = []
  for (const t of toks) {
    if (t.k === 'in') continue
    if (t.k !== 'word' || /[*?]/.test(t.v) || /^(?:strong:)?[HGhg]0*\d{1,5}[a-z]?$/.test(t.v)) return undefined
    for (const w of t.v.match(/[\p{L}\p{M}\p{N}]+/gu) || []) words.push(w)
  }
  return words.length ? words : undefined
}

// ---------------------------------------------------------------------------
// Words. Everything here is lower case with accents removed.

export function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC')
}

const set = (s: string) => new Set(s.split(' '))

const EN_STOP = set('a an the and or but nor of to in on at by for with from into unto upon out up as so than then that this these those which who whom whose what when where there here thereof therein ' +
  'is are was were be been being am art it its it\'s shall will shalt wilt would should may might can could must have has hath hast had do does doth dost did ' +
  'not no nay yea also even all any every if lest because let o oh s t d ll ' +
  'i me my mine myself we us our ours ourselves thou thee thy thine thyself ye you your yours yourself yourselves he him his himself she her hers herself they them their theirs themselves')
const FR_STOP = set('le la les l un une des du de d et ou mais ni a au aux en dans par pour sur sous avec sans que qu qui quoi dont ou ne n pas point plus se s ce c cet cette ces ' +
  'est sont etait etaient sera seront etre ete ai as avons avez ont avait eu y car si comme lorsque quand aussi tout tous toute toutes ' +
  'je j me m moi mon ma mes tu te t toi ton ta tes il ils elle elles lui leur leurs son sa ses nous notre nos vous votre vos eux')

// Old and new forms that mean the same, and pronouns that a person
// remembering a verse swaps freely (me / thee / you).
const EN_SAME: Record<string, string> = {
  hath: 'have', has: 'have', hast: 'have', doth: 'do', does: 'do', dost: 'do', did: 'do', saith: 'say', says: 'say', said: 'say', sayest: 'say',
  shalt: 'shall', wilt: 'will', art: 'are', is: 'are', am: 'are', was: 'were', unto: 'to', upon: 'on', spake: 'speak', spoke: 'speak', spoken: 'speak',
  gave: 'give', given: 'give', came: 'come', went: 'go', gone: 'go', knew: 'know', known: 'know', saw: 'see', seen: 'see', took: 'take', taken: 'take',
  made: 'make', brought: 'bring', thought: 'think', sought: 'seek', taught: 'teach', wrought: 'work', slew: 'slay', slain: 'slay', arose: 'arise', rose: 'rise', risen: 'rise',
  children: 'child', men: 'man', women: 'woman', brethren: 'brother', feet: 'foot', teeth: 'tooth',
}
const EN_ME = set('i me my mine myself we us our ours ourselves thou thee thy thine thyself ye you your yours yourself yourselves')
const EN_HIM = set('he him his himself she her hers herself they them their theirs themselves')
const FR_ME = set('je j me m moi mon ma mes tu te t toi ton ta tes nous notre nos vous votre vos')
const FR_HIM = set('il ils elle elles lui leur leurs son sa ses eux')

const EST_KEEP = set('forest honest harvest interest earnest tempest conquest request manifest protest modest behest arrest suggest invest digest contest detest attest molest')
const VOWEL = /[aeiouy]/

function undouble(w: string) {
  return /([bgmnprt])\1$/.test(w) ? w.slice(0, -1) : w
}

function enStem(w: string): string {
  for (let pass = 0; pass < 4 && w.length > 3; pass++) {
    const before = w
    if (w.endsWith('ies') && w.length > 5) w = w.slice(0, -3) + 'y'
    else if (w.endsWith('ied') && w.length > 5) w = w.slice(0, -3) + 'y'
    else if (w.endsWith('ness') && w.length > 6) w = w.slice(0, -4)
    else if (w.endsWith('eth') && w.length > 5) w = w.slice(0, -3)
    else if (w.endsWith('est') && w.length > 5 && !EST_KEEP.has(w)) w = w.slice(0, -3)
    else if (w.endsWith('ing') && w.length > 5 && VOWEL.test(w.slice(0, -3))) w = undouble(w.slice(0, -3))
    else if (w.endsWith('ed') && w.length > 4 && VOWEL.test(w.slice(0, -2))) w = undouble(w.slice(0, -2))
    else if (/(?:[sxz]|ch|sh)es$/.test(w) && w.length > 4) w = w.slice(0, -2)
    else if (w.endsWith('s') && !/[siu]s$/.test(w) && w.length > 3) w = w.slice(0, -1)
    else if (w.endsWith('e') && w.length > 3) w = w.slice(0, -1)
    if (w === before) break
  }
  return w
}

const FR_ENDINGS = ['issements', 'issement', 'eraient', 'iraient', 'assent', 'erions', 'erons', 'eront', 'erent', 'aient', 'ement', 'ments', 'ment',
  'ions', 'iez', 'ons', 'ent', 'ait', 'ais', 'ant', 'era', 'ira', 'ees', 'ee', 'es', 'er', 'ez', 'e', 's', 'x']

function frStem(w: string): string {
  for (let pass = 0; pass < 2; pass++) {
    const end = FR_ENDINGS.find(e => w.endsWith(e) && w.length - e.length >= 3)
    if (!end) break
    w = w.slice(0, -end.length)
  }
  return w
}

export interface Lang { stop: Set<string>; key: (w: string) => string }

function makeLang(stop: Set<string>, same: Record<string, string>, me: Set<string>, him: Set<string>, stem: (w: string) => string): Lang {
  const memo = new Map<string, string>()
  return {
    stop,
    key: w => {
      let k = memo.get(w)
      if (k === undefined) {
        k = me.has(w) ? '§me' : him.has(w) ? '§him' : stem(same[w] ?? w)
        memo.set(w, k)
      }
      return k
    },
  }
}

const NONE = new Set<string>()
const LANGS: Record<string, Lang> = {}

/** Stemming and small words for a language (by code, e.g. "en", "fr"). Other
 *  languages match whole words, still loosely and ranked. */
export function lang(code = ''): Lang {
  const c = code.split('-')[0]
  return LANGS[c] ??= c === 'en' ? makeLang(EN_STOP, EN_SAME, EN_ME, EN_HIM, enStem)
    : c === 'fr' ? makeLang(FR_STOP, {}, FR_ME, FR_HIM, frStem)
    : makeLang(NONE, {}, NONE, NONE, w => w)
}

export function looseQuery(words: string[], l: Lang): LooseQuery {
  let ws = words.map(w => { const f = fold(w); return { word: f, key: l.key(f), content: !l.stop.has(f) } })
  // Only small words ("I am that I am"): then they all count.
  if (!ws.some(w => w.content)) ws = ws.map(w => ({ ...w, content: true }))
  const stems = [...new Set(ws.filter(w => w.content).map(w => w.key))]
  const k = stems.length
  return { words: ws, stems, need: k <= 2 ? k : Math.max(2, Math.ceil(k * 0.6)) }
}

// ---------------------------------------------------------------------------
// Index: for one edition, the verses each stem appears in.

export interface LooseIndex {
  lang: Lang
  /** verse ordinal → its text as " tok tok " (folded) */
  texts: string[]
  /** verse ordinal → caller's key for the verse */
  refs: Int32Array
  postings: Map<string, Int32Array>
  /** every word in the edition → its stem key, to fix typos against */
  vocab: Map<string, string>
}

export function buildIndex(verses: Iterable<[number, string]>, l: Lang): LooseIndex {
  const texts: string[] = [], refs: number[] = []
  const lists = new Map<string, number[]>()
  const vocab = new Map<string, string>()
  for (const [ref, text] of verses) {
    const n = texts.length
    texts.push(text); refs.push(ref)
    let last = ''
    for (const w of text.split(' ')) {
      if (!w) continue
      const k = l.key(w)
      vocab.set(w, k)
      if (k === last) continue
      const list = lists.get(k)
      if (!list) lists.set(k, [n])
      else if (list[list.length - 1] !== n) list.push(n)
      last = k
    }
  }
  const postings = new Map<string, Int32Array>()
  for (const [k, v] of lists) postings.set(k, Int32Array.from(v))
  return { lang: l, texts, refs: Int32Array.from(refs), postings, vocab }
}

/** The query with misspelt words swapped for the closest word this edition
 *  has (shepard → shepherd, rightousness → righteousness). Only when most
 *  of the query is in the edition's language, so French words aren't
 *  "corrected" into English ones. */
export function fixTypos(idx: LooseIndex, q: LooseQuery): LooseQuery {
  const odd = q.words.filter(w => w.content && w.word.length >= 4 && !idx.vocab.has(w.word))
  if (!odd.length) return q
  const known = q.words.filter(w => idx.vocab.has(w.word) || idx.lang.stop.has(w.word)).length
  if (known * 2 < q.words.length) return q
  const swap = new Map<string, string>()
  for (const w of odd) {
    if (swap.has(w.key)) continue
    // A word this Bible doesn't have whose stem it does have (strengthens,
    // or blesed → "ble") is only swapped for a word one letter away.
    const max = idx.postings.has(w.key) ? 1 : w.word.length >= 7 ? 2 : 1
    // Closest first; then a word that starts the same, and one that
    // is longer (a letter left out is the usual slip); then the commoner.
    let best: string | undefined, bestS = Infinity, bestDf = 0
    for (const [v, k] of idx.vocab) {
      const dl = v.length - w.word.length
      if (Math.abs(dl) > max) continue
      const d = distance(w.word, v, max)
      if (d > max) continue
      let same = 0
      while (same < 4 && v[same] === w.word[same]) same++
      const score = d + (same ? -0.1 * same : 0.5) + (dl < 0 ? 0.2 : 0) + Math.abs(dl) * 0.05
      const df = idx.postings.get(k)?.length ?? 0
      if (score < bestS || (score === bestS && df > bestDf)) { best = k; bestS = score; bestDf = df }
    }
    if (best) swap.set(w.key, best)
  }
  if (!swap.size) return q
  const words = q.words.map(w => swap.has(w.key) ? { ...w, key: swap.get(w.key)! } : w)
  return { ...q, words, stems: [...new Set(q.stems.map(s => swap.get(s) ?? s))] }
}

/** Edit distance (with swapped neighbours as one edit), giving up past `max`. */
function distance(a: string, b: string, max: number): number {
  const m = a.length, n = b.length
  let pp = new Array<number>(n + 1).fill(0), prev = Array.from({ length: n + 1 }, (_, j) => j), cur = new Array<number>(n + 1)
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    let low = i
    for (let j = 1; j <= n; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, pp[j - 2] + 1)
      cur[j] = v
      if (v < low) low = v
    }
    if (low > max) return max + 1
    ;[pp, prev, cur] = [prev, cur, pp]
  }
  return prev[n]
}

export interface LooseHit { ref: number; score: number }

/** Verses that loosely match, with a score (higher is better). */
export function looseSearch(idx: LooseIndex, query: LooseQuery, allow?: (ref: number) => boolean): LooseHit[] {
  const q = fixTypos(idx, query)
  const N = idx.texts.length
  if (!q.stems.length || !N) return []
  const idf = new Map<string, number>()
  let total = 0
  for (const s of q.stems) {
    const df = idx.postings.get(s)?.length ?? 0
    const w = Math.log(1 + N / (df + 1))
    idf.set(s, w); total += w
  }
  const count = new Uint8Array(N)
  for (const s of q.stems) for (const n of idx.postings.get(s) ?? []) count[n]++
  const seq = q.words.map(w => w.key)
  const exact = new Set(q.words.map(w => w.word))
  const out: LooseHit[] = []
  for (let n = 0; n < N; n++) {
    if (count[n] < q.need) continue
    const ref = idx.refs[n]
    if (allow && !allow(ref)) continue
    const toks = idx.texts[n].split(' ').filter(Boolean)
    const keys = toks.map(idx.lang.key)
    const have = new Set(keys)
    let cov = 0
    for (const s of q.stems) if (have.has(s)) cov += idf.get(s)!
    const order = lcs(seq, keys) / seq.length
    const exactShare = q.words.filter(w => toks.includes(w.word)).length / exact.size
    const tight = tightness(q.stems.filter(s => have.has(s)), keys)
    out.push({ ref, score: 10 * cov / total + 4 * order + 2 * tight + 0.5 * Math.min(1, exactShare) - toks.length / 1000 })
  }
  return out
}

function lcs(a: string[], b: string[]): number {
  let prev = new Uint16Array(b.length + 1), cur = new Uint16Array(b.length + 1)
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) cur[j + 1] = a[i] === b[j] ? prev[j] + 1 : Math.max(prev[j + 1], cur[j])
    ;[prev, cur] = [cur, prev]
  }
  return prev[b.length]
}

/** 1 when the matched words sit side by side, less the more spread out. */
function tightness(stems: string[], keys: string[]): number {
  if (stems.length < 2) return stems.length ? 1 : 0
  const want = new Set(stems)
  const seen = new Map<string, number>()
  let best = Infinity, start = 0
  for (let j = 0; j < keys.length; j++) {
    if (!want.has(keys[j])) continue
    seen.set(keys[j], (seen.get(keys[j]) ?? 0) + 1)
    while (seen.size === want.size) {
      best = Math.min(best, j - start + 1)
      const k = keys[start++]
      if (want.has(k)) { const c = seen.get(k)! - 1; c ? seen.set(k, c) : seen.delete(k) }
    }
  }
  return best === Infinity ? 0 : stems.length / best
}

/** Character ranges of the words in `plainText` that matched. */
export function looseRanges(plainText: string, q: LooseQuery, l: Lang): [number, number][] {
  const want = new Set(q.stems)
  const out: [number, number][] = []
  for (const m of plainText.matchAll(/[\p{L}\p{M}\p{N}]+/gu)) {
    if (want.has(l.key(fold(m[0])))) out.push([m.index!, m.index! + m[0].length])
  }
  return out
}

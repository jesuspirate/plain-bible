// Verse text helpers. Strong's-tagged editions mark words as {text|H430 H853}.

export interface Segment { text: string; strongs?: string[] }

const TAG_RE = /\{([^{}|]*)\|([^{}]*)\}/g

export function segments(verse: string): Segment[] {
  if (verse.indexOf('{') < 0) return [{ text: verse }]
  const out: Segment[] = []
  let last = 0
  for (const m of verse.matchAll(TAG_RE)) {
    if (m.index! > last) out.push({ text: verse.slice(last, m.index) })
    out.push({ text: m[1], strongs: m[2].split(' ').filter(Boolean) })
    last = m.index! + m[0].length
  }
  if (last < verse.length) out.push({ text: verse.slice(last) })
  return out
}

export function plain(verse: string): string {
  return verse.indexOf('{') < 0 ? verse : verse.replace(TAG_RE, '$1')
}

export function strongsOf(verse: string): string[] {
  const out: string[] = []
  if (verse.indexOf('{') < 0) return out
  for (const m of verse.matchAll(TAG_RE)) for (const s of m[2].split(' ')) if (s) out.push(s)
  return out
}

// Words as the build counts them for a Bible whose Strong's numbers come in a
// file of their own (scripts/lsg_strongs.py, WORD_LETTERS): runs of letters,
// a hyphenated word as one ("lui-même"), an elided word with its apostrophe
// ("l'"). Keep the two in step.
const LETTER_WORD = /[\p{L}\p{M}]+(?:-[\p{L}\p{M}]+)*['\u2019]?/gu

/** One verse with its Strong's numbers put in: tags is the verse's line in a
 *  <id>.strongs.json file, "1H7225 H430 H1254+H853": for each tagged word,
 *  how many words to skip since the last one, then its numbers. */
export function withTags(verse: string, tags: string): string {
  if (!tags || !verse || verse.indexOf('{') >= 0) return verse
  const words = [...verse.matchAll(LETTER_WORD)]
  let out = '', last = 0, at = -1
  for (const tag of tags.split(' ')) {
    const m = /^(\d*)(.+)$/.exec(tag)
    if (!m) continue
    at += 1 + (m[1] ? Number(m[1]) : 0)
    const w = words[at]
    if (!w) break
    out += verse.slice(last, w.index) + '{' + w[0] + '|' + m[2].replace(/\+/g, ' ') + '}'
    last = w.index! + w[0].length
  }
  return out + verse.slice(last)
}

export interface NormOptions { caseSensitive: boolean; accentSensitive: boolean }

const MARKS = /\p{M}/gu
// In the scripts of India and South-East Asia a vowel is written as a mark
// on its consonant: taking it off would make another word, not the same word
// without an accent ("राम" is not "रम"). Those marks stay.
const VOWEL_SIGN_SCRIPT = /[\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}]/u

/** Accents taken off, as for a search that ignores them. */
export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(MARKS, m => VOWEL_SIGN_SCRIPT.test(m) ? m : '').normalize('NFC')
}

export function normalize(s: string, o: NormOptions): string {
  if (!o.caseSensitive) s = s.toLowerCase().replace(/ς/g, 'σ')
  if (!o.accentSensitive) s = stripAccents(s)
  return s
}

// Words: runs of letters, marks and digits. Apostrophes split words, so
// "LORD's" yields "LORD" and "s".
const WORD_RE = /[\p{L}\p{M}\p{N}]+/gu

export interface Token { start: number; end: number; norm: string }

export function tokenize(text: string, o: NormOptions): Token[] {
  const out: Token[] = []
  for (const m of text.matchAll(WORD_RE)) out.push({ start: m.index!, end: m.index! + m[0].length, norm: normalize(m[0], o) })
  return out
}

// Scripts written without spaces between words: match terms as substrings.
export const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Myanmar}\p{Script=Lao}\p{Script=Khmer}]/u

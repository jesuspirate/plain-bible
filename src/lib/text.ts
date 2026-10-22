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

export interface NormOptions { caseSensitive: boolean; accentSensitive: boolean }

const MARKS = /\p{M}/gu

export function normalize(s: string, o: NormOptions): string {
  if (!o.caseSensitive) s = s.toLowerCase().replace(/ς/g, 'σ')
  if (!o.accentSensitive) s = s.normalize('NFD').replace(MARKS, '').normalize('NFC')
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

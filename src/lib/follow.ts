// Follow-along reading: the words of a verse, which one the voice is on, and
// how long to stay on each when the highlight moves by itself.

/** A word: letters, marks and digits, with an apostrophe inside it kept
 * ("LORD's", "l’Éternel" stay one word, as a voice says them). */
const WORD = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu

export type Span = [start: number, end: number]

export function words(text: string): Span[] {
  const out: Span[] = []
  for (const m of text.matchAll(WORD)) out.push([m.index!, m.index! + m[0].length])
  return out
}

/** The word a voice is on, from where it says it is in the text: the word at
 * that spot, or the next one when it points at a space or a comma. */
export function wordAt(spans: Span[], charIndex: number): number {
  for (let i = 0; i < spans.length; i++) if (charIndex < spans[i][1]) return i
  return spans.length - 1
}

/** How long to stay on a word, in milliseconds, at a speed (1 is normal):
 * longer words take longer, and the end of a phrase or a sentence gets a
 * breath. `voice` is the pace of a phone reading aloud (a little quicker);
 * otherwise it's a calm reading pace, about 140 words a minute. */
export function pace(text: string, span: Span, rate: number, voice = false): number {
  const letters = span[1] - span[0]
  const after = text.slice(span[1], span[1] + 3)
  const breath = /^\s*[.!?;:]/.test(after) ? (voice ? 350 : 450) : /^\s*[,—–)]/.test(after) ? (voice ? 150 : 200) : 0
  const ms = voice ? 110 + 55 * letters : 150 + 60 * letters
  return Math.round((ms + breath) / (rate > 0 ? rate : 1))
}

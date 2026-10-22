import { findBook, bookById } from './books'

export interface Ref { book: string; chapter: number; verse?: number; verseEnd?: number }

/** Parse "John 3:16", "jn 3", "1 Cor 13:4-7", "Psalm 23", "Jude 3" into a reference. */
export function parseRef(input: string): Ref | undefined {
  const m = input.trim().match(/^((?:[1-4]|i{1,3}|iv)?\s*[\p{L}][\p{L}. ]*?)\s*(\d+)?(?:\s*[:.]\s*(\d+)(?:\s*[-–]\s*(\d+))?)?$/iu)
  if (!m) return undefined
  const book = findBook(m[1])
  if (!book) return undefined
  if (!m[2]) return { book, chapter: 1 }
  const ref: Ref = { book, chapter: +m[2] }
  if (m[3]) ref.verse = +m[3]
  if (m[4]) ref.verseEnd = +m[4]
  return ref
}

export function formatRef(r: Ref, short = false): string {
  const b = bookById(r.book)
  const name = short ? b.abbr : b.name
  let s = `${name} ${r.chapter}`
  if (r.verse) s += `:${r.verse}`
  if (r.verseEnd && r.verseEnd !== r.verse) s += `–${r.verseEnd}`
  return s
}

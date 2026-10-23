// The verses a prayer is prayed over, and how they're named.
import { BOOK_INDEX, bookById } from './books'
import { verseRanges } from './refs'

/** Verses a prayer is tied to: one, or several from the same chapter. */
export interface PrayerVerse { book: string; chapter: number; verses: number[] }

/** "Psalm 34:17", "Philippians 4:6–7" */
export function verseLabel(v: PrayerVerse) {
  const name = v.book === 'Ps' ? 'Psalm' : bookById(v.book).name
  return `${name} ${v.chapter}:${verseRanges(v.verses)}`
}

/** A tied verse as it came back from storage or another device, or undefined. */
export function cleanVerse(v: unknown): PrayerVerse | undefined {
  const x = v as PrayerVerse | undefined
  if (!x || typeof x.book !== 'string' || !Number.isInteger(x.chapter) || !Array.isArray(x.verses)) return undefined
  const verses = [...new Set(x.verses.filter(n => Number.isInteger(n) && n > 0))].sort((a, b) => a - b).slice(0, 200)
  if (!verses.length) return undefined
  if (BOOK_INDEX[x.book] === undefined) return undefined
  return { book: x.book, chapter: x.chapter, verses }
}

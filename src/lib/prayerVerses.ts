// The verses a prayer is prayed using, and how they're named.
import { BOOK_INDEX, bookName } from './books'
import { t } from '../i18n'
import { verseRanges } from './refs'

/** Verses a prayer is tied to from one chapter: one, or several. A prayer
 *  can hold a few of these, from anywhere in the Bible (see versesOf). */
export interface PrayerVerse { book: string; chapter: number; verses: number[] }

/** "Psalm 34:17", "Philippians 4:6–7" */
export function verseLabel(v: PrayerVerse) {
  const name = v.book === 'Ps' ? t('Psalm') : bookName(v.book)
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

/** The most verse groups one prayer holds. */
export const MAX_TIED = 20

/** Every verse a prayer is tied to, in the order they were added. Prayers
 *  from before there could be several have only `verse`. */
export const versesOf = (p: { verse?: PrayerVerse; verses?: PrayerVerse[] } | undefined): PrayerVerse[] =>
  p?.verses ?? (p?.verse ? [p.verse] : [])

/** A list of tied verses as it came back from storage or another device. */
export function cleanVerses(v: unknown): PrayerVerse[] {
  if (!Array.isArray(v)) return []
  const out: PrayerVerse[] = []
  for (const x of v) {
    const c = cleanVerse(x)
    if (c && !out.some(o => o.book === c.book && o.chapter === c.chapter)) out.push(c)
  }
  return out.slice(0, MAX_TIED)
}

/** The list with verse `n` of a chapter tapped: added to that chapter's
 *  verses (or a new entry at the end), or taken off if it was there. */
export function toggleVerse(list: PrayerVerse[], book: string, chapter: number, n: number): PrayerVerse[] {
  const i = list.findIndex(x => x.book === book && x.chapter === chapter)
  if (i < 0) return list.length >= MAX_TIED ? list : [...list, { book, chapter, verses: [n] }]
  const had = list[i].verses
  const verses = had.includes(n) ? had.filter(x => x !== n) : [...had, n].sort((a, b) => a - b)
  return verses.length ? list.map((x, j) => j === i ? { ...x, verses } : x) : list.filter((_, j) => j !== i)
}

/** Two lists name the same verses in the same order. */
export const sameVerses = (a: PrayerVerse[], b: PrayerVerse[]) =>
  a.length === b.length && a.every((x, i) => x.book === b[i].book && x.chapter === b[i].chapter && x.verses.join() === b[i].verses.join())

// A verse that comes from someone else (shared in a circle, a prayer prayed
// using it, a link) is read in YOUR Bible, never in theirs. What crosses
// between people is the reference; the words are looked up here, in the
// Bible you're reading. Their words are kept only for when none of your
// Bibles has the passage (a book outside your canon, say), and then the
// version they came from is said. References travel in standard numbering
// (see versification.ts) and are turned into each reader's own.
import { Bible } from './data'
import { PrayerVerse } from './prayerVerses'
import { plain } from './text'
import { fromStandard, renumbered } from './versification'

/** The words of `v` in `b`, or undefined if that Bible lacks any of them. */
export function wordsIn(b: Bible | undefined, v: PrayerVerse) {
  const raw = v.verses.map(n => b?.books[v.book]?.[v.chapter - 1]?.[n - 1])
  if (!raw.every(Boolean)) return undefined
  return raw.length === 1 ? plain(raw[0]!) : raw.map((r, i) => `${v.verses[i]} ${plain(r!)}`).join(' ')
}

/** How many verses `b` has in that chapter (0 if none). */
export const chapterSize = (b: Bible | undefined, book: string, chapter: number) => b?.books[book]?.[chapter - 1]?.length ?? 0

/** The Bibles to look a passage up in, in order: the one you're reading now,
 *  the one the app opens in, then your other versions in the same language. */
export function readerVersions(s: { version: string; favorite?: string; myVersions: string[] }, langOf: (id: string) => string | undefined): string[] {
  const lang = langOf(s.version)
  const same = s.myVersions.filter(id => lang && langOf(id) === lang)
  return [...new Set([s.version, ...(s.favorite && langOf(s.favorite) === lang ? [s.favorite] : []), ...same])]
}

/** What to show for a passage. `yours` is false only when none of your
 *  Bibles has it and the words are the sender's, from `version`. `at` is
 *  the passage as that Bible numbers it. */
export interface Shown { text: string; version: string; yours: boolean; at: PrayerVerse }

/** `v` (standard numbering) in the first of `ids` that has all of it. Otherwise the words as they
 *  were shared (`theirs`), or undefined if there are none. `size` is the
 *  number of verses the sender's Bible has in that chapter: if yours numbers
 *  that chapter differently, the same verse numbers may not be the same
 *  words, so that Bible is passed over. */
export async function inYourBible(
  load: (id: string) => Promise<Bible>, ids: string[], v: PrayerVerse,
  theirs?: { text: string; version: string; size?: number },
): Promise<Shown | undefined> {
  for (const id of ids) {
    const b = await load(id).catch(() => undefined)
    if (!b) continue
    const at = fromStandard(b, v)
    const size = chapterSize(b, at.book, at.chapter)
    if (theirs?.size && !renumbered(b, v.book) && size && size !== theirs.size) continue
    const text = wordsIn(b, at)
    if (text) return { text, version: id, yours: true, at }
  }
  return theirs?.text ? { text: theirs.text, version: theirs.version, yours: false, at: v } : undefined
}

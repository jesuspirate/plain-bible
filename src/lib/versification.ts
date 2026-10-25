// Verse numbers that mean the same words in every Bible. Most Bibles here
// number the Psalms as the Hebrew and the KJV do. A few (Douay-Rheims, the
// Vulgate, the Russian Synodal) follow the Greek: they join Psalms 9–10 and
// 114–115, split 116 and 147, so most psalms are one lower, and they often
// count a psalm's title as its first verse. What passes between people is
// numbered as in the KJV ("standard"); each side turns it into, or out of,
// its own Bible's numbering.
import { Bible } from './data'
import { PrayerVerse } from './prayerVerses'

/** Verses in each psalm, as the KJV numbers them. */
const KJV_PS = [6, 12, 8, 8, 12, 10, 17, 9, 20, 18, 7, 8, 6, 7, 5, 11, 15, 50, 14, 9, 13, 31, 6, 10, 22, 12, 14, 9, 11, 12, 24, 11, 22, 22, 28, 12, 40, 22, 13, 17, 13, 11, 5, 26, 17, 11, 9, 14, 20, 23, 19, 9, 6, 7, 23, 13, 11, 11, 17, 12, 8, 12, 11, 10, 13, 20, 7, 35, 36, 5, 24, 20, 28, 23, 10, 12, 20, 72, 13, 19, 16, 8, 18, 12, 13, 17, 7, 18, 52, 17, 16, 15, 5, 23, 11, 13, 12, 9, 9, 5, 8, 28, 22, 35, 45, 48, 43, 13, 31, 7, 10, 10, 9, 8, 18, 19, 2, 29, 176, 7, 8, 9, 4, 8, 5, 6, 5, 6, 8, 8, 3, 18, 3, 3, 21, 26, 9, 8, 24, 13, 10, 7, 12, 15, 21, 10, 20, 14, 9, 6]

/** Does `b` number the Psalms the Greek way? (Its Psalm 9 holds 9 and 10.) */
export const greekPsalms = (b: Bible | undefined) => (b?.books.Ps?.[8]?.length ?? 0) > 30

/** Where a standard Psalm verse is in a Greek-numbered Bible. */
function toGreek(b: Bible, c: number, v: number): [number, number] {
  const len = (g: number) => b.books.Ps?.[g - 1]?.length ?? 0
  // Title verses at the start: how many more verses it has than the KJV.
  const titles = (g: number, kjv: number) => { const d = len(g) - kjv; return d > 0 && d < 4 ? d : 0 }
  if (c <= 8 || c >= 148) return [c, v + titles(c, KJV_PS[c - 1])]
  if (c === 9 || c === 10) { const t = titles(9, KJV_PS[8] + KJV_PS[9]); return [9, (c === 10 ? KJV_PS[8] : 0) + v + t] }
  if (c === 114 || c === 115) { const t = titles(113, KJV_PS[113] + KJV_PS[114]); return [113, (c === 115 ? KJV_PS[113] : 0) + v + t] }
  if (c === 116) return v <= 9 ? [114, v + titles(114, 9)] : [115, v - 9 + titles(115, 10)]
  if (c === 147) return v <= 11 ? [146, v + titles(146, 11)] : [147, v - 11 + titles(147, 9)]
  return [c - 1, v + titles(c - 1, KJV_PS[c - 1])]
}

/** Verses in `b`'s numbering, from standard numbering. */
export function fromStandard(b: Bible | undefined, v: PrayerVerse): PrayerVerse {
  if (v.book !== 'Ps' || !b || !greekPsalms(b)) return v
  const at = v.verses.map(n => toGreek(b, v.chapter, n))
  const chapter = at[0][0]
  return { book: v.book, chapter, verses: at.filter(x => x[0] === chapter).map(x => x[1]) }
}

/** Verses in standard numbering, from `b`'s. A psalm's title, which the
 *  standard numbering doesn't count, goes to the psalm's first verse. */
export function toStandard(b: Bible | undefined, v: PrayerVerse): PrayerVerse {
  if (v.book !== 'Ps' || !b || !greekPsalms(b)) return v
  const back = new Map<string, [number, number]>()
  for (let c = 1; c <= 150; c++) {
    for (let n = 1; n <= KJV_PS[c - 1]; n++) { const [gc, gv] = toGreek(b, c, n); back.set(`${gc}:${gv}`, [c, n]) }
  }
  const at = v.verses.map(n => back.get(`${v.chapter}:${n}`) ?? back.get(`${v.chapter}:${n + 1}`) ?? back.get(`${v.chapter}:${n + 2}`))
    .filter((x): x is [number, number] => !!x)
  if (!at.length) return v
  const chapter = at[0][0]
  return { book: v.book, chapter, verses: [...new Set(at.filter(x => x[0] === chapter).map(x => x[1]))] }
}

/** Does the Bible number this passage its own way (so its chapter sizes
 *  can't be compared with the standard)? */
export const renumbered = (b: Bible | undefined, book: string) => book === 'Ps' && greekPsalms(b)

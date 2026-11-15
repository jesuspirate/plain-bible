// The verse of the day on the iPhone Home Screen and Lock Screen
// (ios/QuietBibleHome/DailyVerse.swift). The widget can't open a Bible on its
// own, so the app hands it a month of days ahead: each day's verse, read in
// your Bible and named in the app's language, and your saved verses
// (highlights and bookmarks) for those who pick "My saved verses" on the
// widget. Only in the App Store app; loaded lazily, after the reader.

import type { Bible } from './data'
import type { Marks } from './marks'
import { verseLabel } from './prayerVerses'
import { readPath } from '../state'
import { plain } from './text'
import { tellNative } from './nativeNotify'

// Short verses that stand on their own, well loved and easy to carry
// through a day. One a day, in this order, then round again. References
// only (KJV numbering), so they hold for every Bible and language. Not a
// reading plan: no dates, no progress, nothing to keep up with.
const LIST = `
Ps 119:105|John 3:16|Isa 41:10|Phil 4:13|Prov 3:5|Matt 11:28|Ps 46:10|Rom 8:28
Josh 1:9|Ps 23:1|Jer 29:11|John 14:27|Ps 27:1|2Cor 5:17|Lam 3:22|Matt 6:33
Ps 37:4|Rom 5:8|Isa 40:31|John 8:12|Ps 118:24|Heb 13:8|Ps 34:8|1John 4:19
Prov 18:10|Matt 5:8|Ps 46:1|Zeph 3:17|Ps 121:2|John 10:11|Rom 15:13|Ps 55:22
1Pet 5:7|Isa 26:3|John 14:6|Ps 51:10|Rom 12:12|Num 6:24|Heb 11:1|Ps 16:11
Mic 6:8|Matt 5:14|Ps 103:12|2Tim 1:7|Deut 31:8|Ps 139:14|Jas 1:5|1Cor 16:14
Ps 91:1|John 11:25|Ps 62:1|Phil 4:4|Ps 145:18|Nah 1:7|Col 3:23|Ps 28:7
1John 1:9|Isa 40:8|Matt 7:7|Ps 56:3|Heb 4:16|Ps 30:5|Rom 10:13|Ps 19:14
Eph 4:32|Ps 4:8|Jer 33:3|John 16:33|Ps 90:12|Prov 16:3|Matt 5:16|Ps 100:5
Jas 4:8|Ps 136:1|1Cor 13:13|Exod 14:14|Ps 147:3|Luke 1:37|Ps 18:2|John 13:34
Prov 17:17|Ps 73:26|Rom 8:1|Ps 107:1|Matt 6:34|Isa 12:2|John 1:5|Ps 133:1
1John 4:8|Ps 150:6|Ps 84:11|John 15:5|Gal 6:9|Ps 32:8|Isa 30:15|1Thess 5:16
`.trim().split(/[|\n]/).map(r => {
  const [, book, chapter, verse] = /^(\S+) (\d+):(\d+)$/.exec(r)!
  return { book, chapter: +chapter, verse: +verse }
})
export const DAILY = LIST

/** Long verses crowd a small widget; past this one is passed over. */
const LONGEST = 240
/** How many days ahead, and how many saved verses, are handed over. */
const DAYS = 31
const SAVED = 31

export interface DayVerse { l: string; t: string; p: string }

/** Days since 1970 by the calendar here, the widget counts the same way. */
export const dayNumber = (d: Date) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000)

function verse(bible: Bible, version: string, book: string, chapter: number, n: number): DayVerse | undefined {
  const raw = bible.books[book]?.[chapter - 1]?.[n - 1]
  const text = raw && plain(raw).replace(/\s+/g, ' ').trim()
  if (!text || text.length > LONGEST) return undefined
  return { l: verseLabel({ book, chapter, verses: [n] }), t: text, p: readPath(version, book, chapter, n) }
}

/** The verse for day `day`: its place in the list, or the next one this
 *  Bible has (a New Testament alone has no Psalms) and that fits. */
export function verseForDay(bible: Bible, version: string, day: number): DayVerse | undefined {
  for (let i = 0; i < LIST.length; i++) {
    const r = LIST[(day + i) % LIST.length]
    const v = verse(bible, version, r.book, r.chapter, r.verse)
    if (v) return v
  }
}

/** Your highlighted and bookmarked verses, the latest first. */
export function savedVerses(bible: Bible, version: string, marks: Marks): DayVerse[] {
  const out: DayVerse[] = []
  const keys = Object.keys(marks).filter(k => marks[k].c || marks[k].b).sort((a, b) => marks[b].t - marks[a].t)
  for (const k of keys) {
    const m = /^(.+)\.(\d+)\.(\d+)$/.exec(k)
    const v = m && verse(bible, version, m[1], +m[2], +m[3])
    if (v) out.push(v)
    if (out.length >= SAVED) break
  }
  return out
}

/** What the widget is handed: a month of days, and your saved verses. */
export function dailyPayload(bible: Bible, version: string, marks: Marks, now = new Date()) {
  const today = dayNumber(now)
  const days: (DayVerse & { d: number })[] = []
  for (let d = today; d < today + DAYS; d++) {
    const v = verseForDay(bible, version, d)
    if (v) days.push({ d, ...v })
  }
  return { op: 'verses', days, saved: savedVerses(bible, version, marks) }
}

let last = ''
/** Hand the widget its verses, when anything in them changed. */
export async function sendDaily(bible: Promise<Bible>, version: string, marks: Marks) {
  const payload = dailyPayload(await bible, version, marks)
  const s = JSON.stringify(payload)
  if (s === last) return
  last = s
  tellNative(payload)
}

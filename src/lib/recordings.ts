// Recorded readings of whole Bibles, given to the public domain by their
// publisher (the Berean Bible, openbible.com), one file per chapter. The app
// plays a chapter straight from there, so nothing is added to the app itself;
// what the app carries is only when each word is said (public/audio-times,
// made by scripts/align_audio.py), fetched a book at a time and only when
// someone listens, so the highlight can follow the reader's voice.
import { BOOK_INDEX } from './books'

export interface Recording {
  /** Also the folder of its word times. */
  id: string
  /** The Bible it reads. */
  version: string
  /** The reader's name, as shown. */
  name: string
  /** A chapter's file: book number (01–66), the publisher's book code, chapter (001–150). */
  file: (n: string, code: string, c: string) => string
}

const BASE = 'https://openbible.com/audio/'

/** The first of a Bible's recordings is the one used until another is picked.
 * The Berean Bible has two more narrators there (souer/, gilbert/): to add
 * one, make its word times with scripts/align_audio.py and list it here. */
export const RECORDINGS: Recording[] = [
  { id: 'hays', version: 'BSB', name: 'Barry Hays', file: (n, code, c) => `${BASE}hays/BSB_${n}_${code}_${c}_H.mp3` },
  { id: 'david', version: 'KJV', name: 'David', file: (n, code, c) => `${BASE}kjv/KJV_${n}_${code}_${c}.mp3` },
]

// The publisher's code for each of the 66 books, in the Bible's order.
const CODES = ('Gen Exo Lev Num Deu Jos Jdg Rut 1Sa 2Sa 1Ki 2Ki 1Ch 2Ch Ezr Neh Est Job Psa Pro Ecc Sng Isa Jer Lam Ezk Dan '
  + 'Hos Jol Amo Oba Jon Mic Nam Hab Zep Hag Zec Mal Mat Mrk Luk Jhn Act Rom 1Co 2Co Gal Eph Php Col 1Th 2Th 1Ti 2Ti Tts '
  + 'Phm Heb Jas 1Pe 2Pe 1Jn 2Jn 3Jn Jud Rev').split(' ')

export const recordingsFor = (version: string) => RECORDINGS.filter(r => r.version === version)

/** Where a chapter's recording is, or nothing for a book it doesn't have. */
export function chapterUrl(rec: Recording, book: string, chapter: number): string | undefined {
  const i = BOOK_INDEX[book]
  if (i === undefined || i >= CODES.length) return
  return rec.file(String(i + 1).padStart(2, '0'), CODES[i], String(chapter).padStart(3, '0'))
}

/** A verse's words in a recording, in seconds from the start of its chapter:
 * when each word starts, and when the last one ends. */
export interface VerseTimes { starts: number[]; end: number }

/** A verse as stored: [start, gap, gap, …, length of the last word], in
 * hundredths of a second. Nothing for a verse with no words. */
export function verseTimes(row: number[] | undefined): VerseTimes | undefined {
  if (!row || row.length < 2) return
  const starts = [row[0] / 100]
  for (let i = 1; i < row.length - 1; i++) starts.push(starts[i - 1] + row[i] / 100)
  return { starts, end: starts[starts.length - 1] + row[row.length - 1] / 100 }
}

/** A chapter's verses (verse 1 first), each with its times or none; and
 * where the recording starts announcing the chapter ("John chapter 3"),
 * past anything said before that (the King James reading names itself first). */
export type ChapterTimes = (VerseTimes | undefined)[] & { opening?: number }

/** Where a recording is at a time: the verse (from 1) and its word (from 0).
 * Before the first verse (the chapter's name being said) there's no verse;
 * in the quiet after a verse it stays on that verse's last word. */
export function locate(chapter: ChapterTimes, time: number): { verse: number; word: number } | undefined {
  let at: number | undefined
  for (let i = 0; i < chapter.length; i++) {
    const v = chapter[i]
    if (!v) continue
    if (v.starts[0] > time) break
    at = i
  }
  if (at === undefined) return
  const starts = chapter[at]!.starts
  let word = 0
  while (word + 1 < starts.length && starts[word + 1] <= time) word++
  return { verse: at + 1, word }
}

/** The first verse from `verse` on that the recording has. */
export function nextTimed(chapter: ChapterTimes, verse: number): number | undefined {
  for (let v = Math.max(1, verse); v <= chapter.length; v++) if (chapter[v - 1]) return v
}

// A book's times, fetched once and kept while the app is open.
const books = new Map<string, ChapterTimes[] | Promise<ChapterTimes[] | undefined>>()

/** A book's times if they're already here. */
export function timesNow(rec: Recording, book: string): ChapterTimes[] | undefined {
  const b = books.get(rec.id + '/' + book)
  return Array.isArray(b) ? b : undefined
}

/** A book's times, fetched if need be; nothing when they can't be had. */
export function loadTimes(rec: Recording, book: string): Promise<ChapterTimes[] | undefined> {
  const key = rec.id + '/' + book
  const have = books.get(key)
  if (have) return Promise.resolve(have)
  const p = fetch(new URL(`audio-times/${rec.id}/${book}.json`, document.baseURI).href)
    .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
    .then((d: { c: number[][][]; a?: number[] }) => {
      const out = d.c.map((ch, i) => Object.assign(ch.map(verseTimes), { opening: (d.a?.[i] ?? 0) / 100 }))
      books.set(key, out)
      return out
    })
    .catch(() => { books.delete(key); return undefined })
  books.set(key, p)
  return p
}

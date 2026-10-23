// Reminders of your own notes, with no guessing: a note is linked to a
// passage only because you wrote that passage's reference in it ("see
// Jean 3:16"), and to other notes only by a #tag you gave them both.
import { exactBook } from './books'
import { FoundNote, Marks, notesOf, parseKey } from './marks'

/** A passage a note mentions: a chapter, or verses `from`–`to` in it. */
export interface Mention { book: string; chapter: number; from?: number; to?: number }

const NUM = /(\d{1,3})(?:\s*[:.]\s*(\d{1,3})|,(\d{1,3}))?(?:\s*[-–]\s*(\d{1,3}))?/g
const EDGE = /^[^\p{L}\d]+|[^\p{L}\d.]+$/gu

/** References written in a note: "Jean 3:16", "1 Cor 13.4-7", "Psaume 23",
 *  "Actes des apôtres 4,32". Only exact book names count, so "le 3 mars"
 *  is not Leviticus; a bare chapter needs a name of three letters or more (or "Ps"), since
 *  "le" and "de" are also short names for books. */
export function findMentions(text: string): Mention[] {
  const out: Mention[] = []
  for (const m of text.matchAll(NUM)) {
    const before = text.slice(Math.max(0, m.index! - 40), m.index).split(/\s+/)
    if (before[before.length - 1] !== '') continue // "Jean3" or "x12": not a reference
    const words = before.slice(0, -1).slice(-4).map(w => w.replace(EDGE, '')).filter(Boolean)
    let book: string | undefined, name = ''
    for (let i = 0; i < words.length && !book; i++) {
      name = words.slice(i).join(' ')
      // "1 Jean": a leading number belongs to the name, not to anything before.
      if (name) book = exactBook(name)
    }
    if (!book) continue
    const chapter = +m[1], v = m[2] ?? m[3]
    if (!chapter) continue
    if (v) out.push({ book, chapter, from: +v, to: m[4] ? Math.max(+v, +m[4]) : +v })
    else if (name.replace(/[\s\d.]/g, '').length >= 3 || /^ps\.?$/i.test(name)) out.push({ book, chapter })
  }
  return out
}

/** #tags in a note, lower case and without accents: "#Prière" is "#priere". */
export function findTags(text: string): string[] {
  const tags = new Set<string>()
  for (const m of text.matchAll(/(?:^|[^\p{L}\d&])#([\p{L}\d][\p{L}\d_-]*)/gu)) {
    if (!/^\d+$/.test(m[1])) tags.add(m[1].toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''))
  }
  return [...tags]
}

export interface LinkedNote extends FoundNote { book: string; chapter: number }
export interface NoteLinks {
  /** notes that mention a passage, by chapter ("John.3") */
  mentions: Map<string, { note: LinkedNote; at: Mention }[]>
  /** notes by tag */
  tags: Map<string, LinkedNote[]>
  /** each note's tags, by "key/id" */
  tagsOf: Map<string, string[]>
}

export const noteId = (x: { key: string; id: string }) => x.key + '/' + x.id

/** Reads every note once. Built when you open a chapter, after the page is
 *  on screen, and again only when your notes change. */
export function linkNotes(marks: Marks): NoteLinks {
  const links: NoteLinks = { mentions: new Map(), tags: new Map(), tagsOf: new Map() }
  for (const key in marks) {
    const m = marks[key]
    if (!m?.ns && m?.n === undefined) continue
    const { book, chapter, verse } = parseKey(key)
    for (const x of notesOf(m)) {
      const note: LinkedNote = { ...x, key, verse, verses: x.v ?? [verse], book, chapter }
      const seen = new Set<string>()
      for (const at of findMentions(x.n)) {
        const ch = `${at.book}.${at.chapter}`, k = `${ch}:${at.from ?? ''}-${at.to ?? ''}`
        // Its own verses don't count: a note on John 3:16 saying "John 3:16".
        if (seen.has(k) || (at.book === book && at.chapter === chapter && (!at.from || note.verses.some(v => v >= at.from! && v <= at.to!)))) continue
        seen.add(k)
        const list = links.mentions.get(ch) ?? []
        list.push({ note, at })
        links.mentions.set(ch, list)
      }
      const tags = findTags(x.n)
      if (!tags.length) continue
      links.tagsOf.set(noteId(note), tags)
      for (const t of tags) {
        const list = links.tags.get(t) ?? []
        list.push(note)
        links.tags.set(t, list)
      }
    }
  }
  return links
}

/** Your notes elsewhere that go with these: ones that mention these verses
 *  (any verse of the chapter when `verses` is left out), and ones sharing a
 *  #tag with `mine`. Each note once, oldest first, never one of `mine`. */
export function related(links: NoteLinks, book: string, chapter: number, mine: FoundNote[], verses?: number[]): (LinkedNote & { why: string })[] {
  const out = new Map<string, LinkedNote & { why: string }>()
  const skip = new Set(mine.map(noteId))
  for (const { note, at } of links.mentions.get(`${book}.${chapter}`) ?? []) {
    const id = noteId(note)
    if (skip.has(id) || out.has(id)) continue
    if (verses && at.from && !verses.some(v => v >= at.from! && v <= at.to!)) continue
    out.set(id, { ...note, why: 'mentions ' + (at.from ? `${chapter}:${at.from}${at.to !== at.from ? '–' + at.to : ''}` : `chapter ${chapter}`) })
  }
  for (const x of mine) {
    for (const t of links.tagsOf.get(noteId(x)) ?? []) {
      for (const note of links.tags.get(t) ?? []) {
        const id = noteId(note)
        if (skip.has(id) || out.has(id)) continue
        out.set(id, { ...note, why: '#' + t })
      }
    }
  }
  return [...out.values()].sort((a, b) => a.c - b.c)
}

/** Every note in a chapter, in verse order. */
export function chapterNotes(marks: Marks, book: string, chapter: number, verses: number): FoundNote[] {
  const out: FoundNote[] = []
  for (let v = 1; v <= verses; v++) {
    const key = `${book}.${chapter}.${v}`, m = marks[key]
    if (m) for (const x of notesOf(m)) out.push({ ...x, key, verse: v, verses: x.v ?? [v] })
  }
  return out
}

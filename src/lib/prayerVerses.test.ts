import { describe, expect, it } from 'vitest'
import { BOOK_INDEX } from './books'
import { COMFORT, pickComfort } from './comfort'
import { cleanVerse, cleanVerses, MAX_TIED, sameVerses, toggleVerse, verseLabel, versesOf } from './prayerVerses'

describe('prayer verses', () => {
  it('names verses the way people say them', () => {
    expect(verseLabel({ book: 'Ps', chapter: 34, verses: [17] })).toBe('Psalm 34:17')
    expect(verseLabel({ book: 'Phil', chapter: 4, verses: [6, 7] })).toBe('Philippians 4:6–7')
    expect(verseLabel({ book: 'John', chapter: 3, verses: [16, 18] })).toBe('John 3:16, 18')
  })
  it('only lists real books', () => {
    for (const c of COMFORT) expect(BOOK_INDEX[c.book]).toBeDefined()
  })
  it('keeps only a well-formed verse from another device', () => {
    expect(cleanVerse({ book: 'John', chapter: 3, verses: [17, 16, 16] })).toEqual({ book: 'John', chapter: 3, verses: [16, 17] })
    expect(cleanVerse({ book: 'Nope', chapter: 3, verses: [16] })).toBeUndefined()
    expect(cleanVerse({ book: 'John', chapter: 3, verses: [] })).toBeUndefined()
    expect(cleanVerse(null)).toBeUndefined()
  })
  it('adds tapped verses from any chapter or book, and takes them off again', () => {
    let list = toggleVerse([], 'Ps', 23, 4)
    list = toggleVerse(list, 'Ps', 23, 1)
    list = toggleVerse(list, 'John', 3, 16)
    expect(list).toEqual([{ book: 'Ps', chapter: 23, verses: [1, 4] }, { book: 'John', chapter: 3, verses: [16] }])
    list = toggleVerse(list, 'John', 3, 16)
    expect(list).toEqual([{ book: 'Ps', chapter: 23, verses: [1, 4] }])
    let full = list
    for (let c = 1; c <= MAX_TIED + 5; c++) full = toggleVerse(full, 'Prov', c, 1)
    expect(full.length).toBe(MAX_TIED)
  })
  it('reads verses from older prayers and from other devices', () => {
    expect(versesOf({ verse: { book: 'Ps', chapter: 34, verses: [17] } })).toEqual([{ book: 'Ps', chapter: 34, verses: [17] }])
    expect(versesOf({ verse: { book: 'Ps', chapter: 34, verses: [17] }, verses: [] })).toEqual([])
    expect(versesOf(undefined)).toEqual([])
    expect(cleanVerses([{ book: 'John', chapter: 3, verses: [16] }, { book: 'Nope', chapter: 1, verses: [1] }, { book: 'John', chapter: 3, verses: [17] }, 'x']))
      .toEqual([{ book: 'John', chapter: 3, verses: [16] }])
    expect(cleanVerses({ book: 'John' })).toEqual([])
    expect(sameVerses([{ book: 'John', chapter: 3, verses: [16] }], [{ book: 'John', chapter: 3, verses: [16] }])).toBe(true)
    expect(sameVerses([{ book: 'John', chapter: 3, verses: [16] }], [{ book: 'John', chapter: 3, verses: [17] }])).toBe(false)
  })
  it('never shows the same verse twice in a row', () => {
    const store = new Map<string, string>()
    globalThis.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } } as unknown as Storage
    let last = pickComfort(() => 0)
    for (const r of [0, .5, .99, 0, 0]) {
      const next = pickComfort(() => r)
      expect(next).not.toBe(last)
      last = next
    }
  })
})

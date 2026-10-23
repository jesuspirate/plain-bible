import { describe, expect, it } from 'vitest'
import { BOOK_INDEX } from './books'
import { COMFORT, pickComfort } from './comfort'
import { cleanVerse, verseLabel } from './prayerVerses'

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

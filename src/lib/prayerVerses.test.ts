import { describe, expect, it } from 'vitest'
import { cleanVerse, cleanVerses, holdsVerse, MAX_TIED, sameVerses, toggleVerse, verseLabel, versesOf, withVerse } from './prayerVerses'

describe('prayer verses', () => {
  it('adds the verse after Amen to the prayer, once, joined to its chapter', () => {
    const ps = { book: 'Ps', chapter: 145, verses: [18] }
    expect(withVerse([], ps)).toEqual([ps])
    const john = { book: 'John', chapter: 3, verses: [16] }
    expect(withVerse([john], ps)).toEqual([john, ps])
    const same = [john, ps]
    expect(withVerse(same, { ...ps })).toBe(same)
    expect(withVerse([{ book: 'Ps', chapter: 145, verses: [20, 1] }], ps)).toEqual([{ book: 'Ps', chapter: 145, verses: [1, 18, 20] }])
    const full = Array.from({ length: MAX_TIED }, (_, i) => ({ book: 'Ps', chapter: i + 1, verses: [1] }))
    expect(withVerse(full, ps)).toBe(full)
    expect(holdsVerse([john, ps], ps)).toBe(true)
    expect(holdsVerse([john], ps)).toBe(false)
    expect(holdsVerse([{ book: 'Phil', chapter: 4, verses: [6] }], { book: 'Phil', chapter: 4, verses: [6, 7] })).toBe(false)
  })
  it('names verses the way people say them', () => {
    expect(verseLabel({ book: 'Ps', chapter: 34, verses: [17] })).toBe('Psalm 34:17')
    expect(verseLabel({ book: 'Phil', chapter: 4, verses: [6, 7] })).toBe('Philippians 4:6–7')
    expect(verseLabel({ book: 'John', chapter: 3, verses: [16, 18] })).toBe('John 3:16, 18')
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
})

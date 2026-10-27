import { describe, expect, it } from 'vitest'
import { cleanShared, parseInviteLink } from './circles'

describe('cleanShared', () => {
  it('keeps a shared verse', () => {
    const v = { k: 'verse', verse: { book: 'John', chapter: 3, verses: [16] }, version: 'KJV', text: 'For God so loved the world', note: 'Tonight?' }
    expect(cleanShared(v)).toEqual(v)
  })
  it('keeps a shared prayer and its parts', () => {
    const p = cleanShared({ k: 'prayer', ms: 65000, parts: [{ ms: 60000, type: 'audio/mp4', size: 900 }, { ms: 5000, type: 'audio/mp4', size: 80 }] })
    expect(p).toEqual({ k: 'prayer', ms: 65000, parts: [{ ms: 60000, type: 'audio/mp4', size: 900 }, { ms: 5000, type: 'audio/mp4', size: 80 }], verse: undefined, note: undefined })
  })
  it('skips kinds it does not know, and broken ones', () => {
    expect(cleanShared({ k: 'read', book: 'John', chapter: 3 })).toBeUndefined()
  })
  it('keeps every verse a prayer was prayed using', () => {
    const parts = [{ ms: 9000, type: 'audio/mp4', size: 90 }]
    const verses = [{ book: 'Ps', chapter: 23, verses: [1] }, { book: 'John', chapter: 3, verses: [16, 17] }]
    expect(cleanShared({ k: 'prayer', ms: 9000, parts, verse: verses[0], verses })).toMatchObject({ verse: verses[0], verses })
    // One verse travels as `verse` alone, as before.
    expect(cleanShared({ k: 'prayer', ms: 9000, parts, verse: verses[0], verses: [verses[0]] })).not.toHaveProperty('verses')
    expect(cleanShared({ k: 'verse', verse: { book: 'Nope', chapter: 1, verses: [1] } })).toBeUndefined()
    expect(cleanShared({ k: 'prayer', ms: 1, parts: [] })).toBeUndefined()
    expect(cleanShared(null)).toBeUndefined()
  })
  it('caps long text', () => {
    const v = cleanShared({ k: 'verse', verse: { book: 'John', chapter: 3, verses: [16] }, version: 'KJV', text: 'x', note: 'y'.repeat(5000) })
    expect(v?.note?.length).toBe(2000)
  })
})

describe('notes and bookmarks', () => {
  const verse = { book: 'John', chapter: 3, verses: [16, 17] }
  it('keeps a shared note, and drops an empty one', () => {
    expect(cleanShared({ k: 'note', verse, version: 'KJV', text: 'For God so loved', note: 'Love first' }))
      .toEqual({ k: 'note', verse, version: 'KJV', text: 'For God so loved', note: 'Love first' })
    expect(cleanShared({ k: 'note', verse, version: 'KJV', text: 'x', note: '' })).toBeUndefined()
  })
  it('keeps a shared bookmark', () => {
    expect(cleanShared({ k: 'bookmark', verse, version: 'KJV', text: 'x' })?.k).toBe('bookmark')
  })
})

describe('parseInviteLink', () => {
  it('finds the invite in a pasted link or message', () => {
    expect(parseInviteLink('Come pray with us https://myquietbible.com/#/join?i=zKpMGqvt-JhAYZhj&k=Ab_cdEFghIJklMNopQRstu thanks'))
      .toEqual({ i: 'zKpMGqvt-JhAYZhj', k: 'Ab_cdEFghIJklMNopQRstu' })
  })
  it('says no to anything else', () => {
    expect(parseInviteLink('https://myquietbible.com/#/read/KJV/John/3')).toBeUndefined()
    expect(parseInviteLink('#/join?i=short&k=x')).toBeUndefined()
  })
})

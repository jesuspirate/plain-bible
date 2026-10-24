import { describe, expect, it } from 'vitest'
import { cleanShared } from './circles'

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
    expect(cleanShared({ k: 'verse', verse: { book: 'Nope', chapter: 1, verses: [1] } })).toBeUndefined()
    expect(cleanShared({ k: 'prayer', ms: 1, parts: [] })).toBeUndefined()
    expect(cleanShared(null)).toBeUndefined()
  })
  it('caps long text', () => {
    const v = cleanShared({ k: 'verse', verse: { book: 'John', chapter: 3, verses: [16] }, version: 'KJV', text: 'x', note: 'y'.repeat(5000) })
    expect(v?.note?.length).toBe(2000)
  })
})

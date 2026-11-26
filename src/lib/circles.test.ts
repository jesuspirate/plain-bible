import { describe, expect, it } from 'vitest'
import { askedOf, cleanShared, type Feed, type FeedItem, inviteMessage, parseInviteLink, waitingFor } from './circles'

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
  it('reads a link whose "&" came back as "&amp;"', () => {
    expect(parseInviteLink('https://myquietbible.com/#/join?i=zKpMGqvt-JhAYZhj&amp;k=Ab_cdEFghIJklMNopQRstu'))
      .toEqual({ i: 'zKpMGqvt-JhAYZhj', k: 'Ab_cdEFghIJklMNopQRstu' })
  })
  it('tells an Open door link (d=) from a one-time invite', () => {
    expect(parseInviteLink('Come pray with us: https://myquietbible.com/#/join?d=qsvoN6x6TfLVy6Bb&k=kz2hMh_AlL1cpKl4ovSdlg'))
      .toEqual({ i: 'qsvoN6x6TfLVy6Bb', k: 'kz2hMh_AlL1cpKl4ovSdlg', door: true })
  })
  it('says no to anything else', () => {
    expect(parseInviteLink('https://myquietbible.com/#/read/KJV/John/3')).toBeUndefined()
    expect(parseInviteLink('#/join?i=short&k=x')).toBeUndefined()
  })
})

describe('inviteMessage', () => {
  it('puts the link alone on the last line, after a blank line', () => {
    const link = 'https://myquietbible.com/#/join?i=zKpMGqvt-JhAYZhj&k=Ab_cdEFghIJklMNopQRstu'
    const m = inviteMessage(['Come pray with us.', 'Already have it? Paste this link in Circles.'], link)
    expect(m).toBe('Come pray with us.\n\nAlready have it? Paste this link in Circles.\n\n' + link)
    expect(parseInviteLink(m)).toEqual({ i: 'zKpMGqvt-JhAYZhj', k: 'Ab_cdEFghIJklMNopQRstu' })
  })
})

describe('prayer requests', () => {
  const ask = (by: string, amens: string[], at = Date.now()): FeedItem => ({ id: 'i' + by, by, at, body: { k: 'ask', note: 'Peace' }, chunks: 0, amens, replies: [] })
  const feed = (items: FeedItem[]): Feed => ({ me: 'a', members: [{ mid: 'a', name: 'A' }, { mid: 'b', name: 'B' }, { mid: 'c', name: 'C' }], items })
  it('keeps a request, and drops an empty one', () => {
    expect(cleanShared({ k: 'ask', note: 'For my brother' })).toEqual({ k: 'ask', note: 'For my brother' })
    expect(cleanShared({ k: 'ask', note: 'Again', again: true })).toEqual({ k: 'ask', note: 'Again', again: true })
    expect(cleanShared({ k: 'ask', note: '' })).toBeUndefined()
  })
  it('counts everyone but the one who asked', () => {
    const f = feed([])
    expect(askedOf(f, ask('b', ['a']))).toEqual({ others: ['a', 'c'], prayed: ['a'], all: false })
    expect(askedOf(f, ask('b', ['a', 'c', 'b'])).all).toBe(true)
  })
  it('waits for you only on others’ recent requests you haven’t prayed for', () => {
    const old = Date.now() - 20 * 86400_000
    const f = feed([ask('b', []), ask('c', ['a']), ask('a', []), ask('d', [], old)])
    expect(waitingFor(f).map(i => i.by)).toEqual(['b'])
  })
})

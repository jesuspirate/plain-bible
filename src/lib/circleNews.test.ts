import { beforeEach, describe, expect, it } from 'vitest'
import { circlesWithNews, hasNews, markSeen, noteLatest, seenAt } from './circleNews'
import { Feed, newsIn, cleanReacts } from './circles'

beforeEach(() => {
  const store = new Map<string, string>()
  ;(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) }
  ;(globalThis as any).dispatchEvent ??= () => true
})

describe('circle news', () => {
  it('starts quiet for a circle seen here the first time', () => {
    noteLatest([{ id: 'fam', latest: 500 }])
    expect(hasNews('fam')).toBe(false)
    expect(seenAt('fam')).toBe(500)
    expect(seenAt('other')).toBe(Infinity)
  })
  it('shows a dot when someone shares, and clears it once looked at', () => {
    noteLatest([{ id: 'fam', latest: 500 }, { id: 'tue', latest: 0 }])
    noteLatest([{ id: 'fam', latest: 900 }, { id: 'tue', latest: 0 }])
    expect(hasNews('fam')).toBe(true)
    expect(circlesWithNews()).toBe(1)
    markSeen('fam', 900)
    expect(hasNews('fam')).toBe(false)
  })
  it('clears on a fresh look even if the newest thing is not shown yet', () => {
    noteLatest([{ id: 'fam', latest: 500 }])
    noteLatest([{ id: 'fam', latest: 900 }])
    markSeen('fam', 700)
    expect(hasNews('fam')).toBe(true)
    markSeen('fam', 700, true)
    expect(hasNews('fam')).toBe(false)
  })
  it('forgets circles you left', () => {
    noteLatest([{ id: 'fam', latest: 500 }])
    noteLatest([])
    expect(seenAt('fam')).toBe(Infinity)
  })
})

describe('newsIn', () => {
  const v = { book: 'John', chapter: 3, verses: [16] }
  const feed: Feed = {
    me: 'me', members: [],
    items: [
      { id: 'a', by: 'mom', at: 300, body: { k: 'verse', verse: v, version: 'KJV', text: 't' }, chunks: 0, amens: [], replies: [] },
      { id: 'b', by: 'me', at: 100, body: { k: 'verse', verse: v, version: 'KJV', text: 't' }, chunks: 0, amens: ['mom', 'dad'], amenAt: { mom: 250, dad: 50 }, replies: [] },
      { id: 'c', by: 'dad', at: 80, body: { k: 'verse', verse: v, version: 'KJV', text: 't' }, chunks: 0, amens: ['me'], amenAt: { me: 400 },
        replies: [{ id: 'r1', by: 'me', at: 410, text: 'x' }, { id: 'r2', by: 'mom', at: 220, text: 'y' }] },
    ],
  }
  it('finds what others did since you last looked, not what you did', () => {
    const { items, latest } = newsIn(feed, 200)
    expect(latest).toBe(300)
    expect(items.get('a')?.item).toBe(true)
    expect([...items.get('b')!.amens]).toEqual(['mom'])
    expect([...items.get('c')!.replies]).toEqual(['r2'])
    expect(newsIn(feed, 300).items.size).toBe(0)
  })
  it('counts reactions on what you shared, only when someone else gave them', () => {
    const own = { id: 'd', by: 'me', at: 100, body: { k: 'verse' as const, verse: v, version: 'KJV', text: 't' }, chunks: 0, amens: [], replies: [],
      reacts: { mom: { at: 500, e: ['love' as const] }, me: { at: 600, e: ['cheer' as const] }, dad: { at: 150, e: ['strength' as const] } } }
    const theirs = { ...own, id: 'e', by: 'mom', at: 90, reacts: { dad: { at: 700, e: ['love' as const] } } }
    const { items, latest } = newsIn({ ...feed, items: [own, theirs] }, 200)
    expect([...items.get('d')!.reacts]).toEqual(['mom'])
    expect(items.has('e')).toBe(false)
    expect(latest).toBe(500)
  })
  it('keeps only reactions it knows, in order, once each', () => {
    expect(cleanReacts({ e: ['cheer', 'love', 'love', 'party', 3] })).toEqual(['love', 'cheer'])
    expect(cleanReacts('love')).toEqual([])
  })
})

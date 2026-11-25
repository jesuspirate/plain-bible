import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { checkPosts, hasLink, newYorkDate, parseVerse, postsLeft, xLength, type Post } from './socialPosts'

describe('daily posts', () => {
  it('social/posts.json is ready to post', () => {
    const posts = JSON.parse(readFileSync(new URL('../../social/posts.json', import.meta.url), 'utf8'))
    expect(checkPosts(posts)).toEqual([])
  })

  it('counts like X does', () => {
    expect(xLength('abc')).toBe(3)
    expect(xLength('“Be still” — Psalm 46:10')).toBe(24)
    expect(xLength('Reply 🙏')).toBe(8)
    expect(xLength('free: myquietbible.com')).toBe(6 + 23)
    expect(xLength('see https://myquietbible.com/?r=BSB/John/3/16 now')).toBe(4 + 23 + 4)
  })

  it('finds links', () => {
    expect(hasLink('link in bio')).toBe(false)
    expect(hasLink('go to myquietbible.com')).toBe(true)
    expect(hasLink('https://x.com')).toBe(true)
    expect(hasLink('Matthew 11:28. Rest.')).toBe(false)
  })

  it('reads verses', () => {
    expect(parseVerse('BSB/Heb/10/24-25')).toEqual({ version: 'BSB', book: 'Heb', chapter: 10, first: 24, last: 25 })
    for (const bad of ['', 'BSB/John/3', 'BSB/John/0/1', 'BSB/John/3/5-4', '../John/3/1']) expect(parseVerse(bad)).toBeUndefined()
  })

  it('says what is wrong', () => {
    const ok: Post = { date: '2026-12-01', verse: 'BSB/John/3/16', text: 'For God so loved the world.' }
    expect(checkPosts([ok])).toEqual([])
    expect(checkPosts([ok, ok])[0]).toMatch(/two posts on one day/)
    expect(checkPosts([{ ...ok, text: 'x'.repeat(281) }])[0]).toMatch(/281 characters/)
    expect(checkPosts([{ ...ok, text: 'see myquietbible.com' }])[0]).toMatch(/no links/)
    expect(checkPosts([{ ...ok, verse: 'John 3:16' }])[0]).toMatch(/verse must/)
    expect(checkPosts([{ ...ok, extra: 1 }])[0]).toMatch(/unknown field/)
  })

  it('goes by New York days', () => {
    expect(newYorkDate(new Date('2026-12-01T04:30:00Z'))).toBe('2026-11-30')
    expect(newYorkDate(new Date('2026-12-01T11:30:00Z'))).toBe('2026-12-01')
    const posts = [{ date: '2026-11-30' }, { date: '2026-12-01' }, { date: '2026-12-02' }] as Post[]
    expect(postsLeft(posts, '2026-12-01')).toBe(2)
  })
})

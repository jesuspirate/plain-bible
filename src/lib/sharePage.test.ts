import { describe, expect, it } from 'vitest'
import { answer, bookOf, parseShared, wordsOf } from '../../worker/src/share'

const bible = JSON.stringify({ id: 'KJV', books: {
  Gen: [['In the beginning God created the heaven and the earth.']],
  John: [['x'], ['y'], Array.from({ length: 18 }, (_, i) => i === 15 ? 'For God so {loved|G25} the world, that he gave his "only" Son.' : i === 16 ? 'For God sent not his Son.' : `verse ${i + 1} with "John":[ in it`)],
} })
const get = async (url: string) => url.endsWith('/KJV.json') ? new Response(bible)
  : url.endsWith('/catalog.json') ? Response.json({ translations: [{ id: 'KJV', lang: 'en' }, { id: 'LSG', lang: 'fr' }] }) : new Response('', { status: 404 })
const ask = (r: string, ua = 'facebookexternalhit/1.1') =>
  answer(new Request(`https://share.myquietbible.com/?r=${r}`, { headers: { 'User-Agent': ua } }), get)

describe('share page', () => {
  it('reads only safe passages', () => {
    expect(parseShared('KJV/John/3/16-17')).toEqual({ version: 'KJV', book: 'John', chapter: 3, first: 16, last: 17 })
    expect(parseShared('KJV/John/3/16')?.last).toBe(16)
    for (const bad of ['', 'KJV/John/3', 'KJV/../3/1', 'KJV/John/0/1', 'KJV/John/3/0', 'KJV/John/3/1/x', '<b>/John/3/1'])
      expect(parseShared(bad)).toBeUndefined()
  })

  it('finds one book and its verses, without markup', () => {
    const john = bookOf(bible, 'John')!
    expect(john).toHaveLength(3)
    expect(wordsOf(john, { version: 'KJV', book: 'John', chapter: 3, first: 16, last: 16 })).toBe('For God so loved the world, that he gave his "only" Son.')
    expect(wordsOf(john, { version: 'KJV', book: 'John', chapter: 3, first: 16, last: 17 })).toBe('16 For God so loved the world, that he gave his "only" Son. 17 For God sent not his Son.')
    expect(bookOf(bible, 'Rev')).toBeUndefined()
  })

  it('gives link previews the verse words as the title', async () => {
    const res = await ask('KJV/John/3/16')
    const html = await res.text()
    expect(html).toContain('<meta property="og:title" content="“For God so loved the world, that he gave his &#34;only&#34; Son.”">')
    expect(html).toContain('content="John 3:16 (KJV) · My Quiet Bible"')
    expect(html).toContain('<meta property="og:url" content="https://share.myquietbible.com/?r=KJV/John/3/16">')
    expect(html).toContain('https://myquietbible.com/share.png')
  })

  it('sends people straight on to the passage in the app', async () => {
    const res = await ask('KJV/John/3/16-17', 'Mozilla/5.0 (iPhone)')
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('https://myquietbible.com/?r=KJV/John/3/16-17')
    expect((await ask('nonsense', 'Mozilla')).headers.get('Location')).toBe('https://myquietbible.com/')
  })

  it('still names the passage if the Bible cannot be read', async () => {
    const html = await (await ask('LSG/John/3/16')).text()
    expect(html).toContain('<meta property="og:title" content="Jean 3:16 (LSG)">')
  })
})

import { describe, expect, it } from 'vitest'
import { cardLink, clip, facebookUrl, fromCardLink, whatsappUrl, xUrl } from './shareTo'

describe('share to apps', () => {
  it('gives Facebook a link without a #, that opens the passage', () => {
    const link = cardLink('https://myquietbible.com', 'KJV', 'John', 3, 16, 18)
    expect(link).toBe('https://myquietbible.com/?r=KJV/John/3/16-18')
    expect(link).not.toContain('#')
    expect(fromCardLink(new URL(link).searchParams.get('r')!)).toBe('read/KJV/John/3?v=16&e=18&shared=1')
    expect(fromCardLink('KJV/John/3/16')).toBe('read/KJV/John/3?v=16&shared=1')
    expect(fromCardLink('KJV/John')).toBeUndefined()
    expect(facebookUrl(link)).toBe('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(link))
  })

  it('gives X and WhatsApp the words, the reference and the link', () => {
    const x = new URL(xUrl('For God so loved the world', 'John 3:16 (KJV)', 'https://myquietbible.com/#/read'))
    expect(x.searchParams.get('text')).toBe('For God so loved the world\nJohn 3:16 (KJV)')
    expect(x.searchParams.get('url')).toBe('https://myquietbible.com/#/read')
    expect(x.searchParams.get('via')).toBe('myquietbible')
    const w = new URL(whatsappUrl('Jesus wept.', 'John 11:35 (KJV)', 'https://l'))
    expect(w.searchParams.get('text')).toBe('Jesus wept.\nJohn 11:35 (KJV)\nhttps://l')
  })

  it('cuts a long passage to fit X', () => {
    const long = 'word '.repeat(200).trim()
    const text = new URL(xUrl(long, 'Psalm 119:1-8 (KJV)', 'https://l')).searchParams.get('text')!
    expect(text.length).toBeLessThan(280 - 23 - 18)
    expect(text).toMatch(/word…\nPsalm/)
    expect(clip('短い'.repeat(200), 20).length).toBeLessThanOrEqual(11)
  })
})

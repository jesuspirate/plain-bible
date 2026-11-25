import { describe, expect, it } from 'vitest'
import { CARD_ID, cardId, isCard } from './card'

function png(w: number, h: number, extra = 100) {
  const b = new Uint8Array(33 + extra)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82])
  const v = new DataView(b.buffer); v.setUint32(16, w); v.setUint32(20, h)
  return b
}

describe('verse card pictures', () => {
  it('takes a PNG of the card size', () => expect(isCard(png(1200, 630))).toBe(true))
  it('refuses another size', () => expect(isCard(png(1080, 1350))).toBe(false))
  it('refuses what is not a PNG', () => {
    const b = png(1200, 630); b[1] = 0
    expect(isCard(b)).toBe(false)
  })
  it('refuses a picture too big', () => expect(isCard(png(1200, 630, 700_000))).toBe(false))
  it('names a picture by its fingerprint', async () => {
    const a = await cardId(png(1200, 630)), b = await cardId(png(1200, 630, 101))
    expect(a).toMatch(CARD_ID)
    expect(a).not.toBe(b)
    expect(await cardId(png(1200, 630))).toBe(a)
  })
})

import { describe, expect, it } from 'vitest'
import { litCountries, prayedIn } from './world'

const req = (country?: string) => Object.assign(new Request('https://x/hello'), { cf: country ? { country } : undefined })
const q = (s: string) => new URLSearchParams(s)

describe('prayer map', () => {
  it('counts a country only for a device that prayed and counts on the map', () => {
    expect(prayedIn(req('FR'), q('pw=1&pr=2'))).toBe('FR')
    expect(prayedIn(req('FR'), q('pr=2'))).toBeUndefined()
    expect(prayedIn(req('FR'), q('pw=1'))).toBeUndefined()
    expect(prayedIn(req(), q('pw=1&pr=1'))).toBeUndefined()
  })
  it('never counts Tor, the unknown country, or anything odd', () => {
    for (const c of ['T1', 'XX', 'fr', 'FRA', '1']) expect(prayedIn(req(c), q('pw=1&pr=1'))).toBeUndefined()
  })
  it('lights only countries with at least 5 praying devices, and says no numbers', () => {
    expect(litCountries([{ kind: 'prayedin:US', n: 12 }, { kind: 'prayedin:IS', n: 1 }, { kind: 'prayedin:CA', n: 5 }, { kind: 'prayedin:CI', n: 4 }]))
      .toEqual(['CA', 'US'])
  })
})

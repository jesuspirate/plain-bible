// Which addresses the sync service answers (worker/src/origins.ts).
import { describe, expect, it } from 'vitest'
import { originAllowed } from '../../worker/src/origins'

describe('originAllowed', () => {
  const live = ['https://myquietbible.com']
  const test = ['https://*.myquietbible-test.pages.dev']
  it('answers the listed address only', () => {
    expect(originAllowed(live, 'https://myquietbible.com')).toBe(true)
    expect(originAllowed(live, 'https://evil.com')).toBe(false)
    expect(originAllowed(live, 'https://pr-1.myquietbible.com')).toBe(false)
  })
  it('answers each pull request address under a *. entry', () => {
    expect(originAllowed(test, 'https://pr-12.myquietbible-test.pages.dev')).toBe(true)
    expect(originAllowed(test, 'https://a1b2c3.myquietbible-test.pages.dev')).toBe(true)
  })
  it('never answers look-alikes', () => {
    expect(originAllowed(test, 'https://myquietbible-test.pages.dev.evil.com')).toBe(false)
    expect(originAllowed(test, 'https://x.y.myquietbible-test.pages.dev')).toBe(false)
    expect(originAllowed(test, 'http://pr-1.myquietbible-test.pages.dev')).toBe(false)
    expect(originAllowed(test, 'https://evil-myquietbible-test.pages.dev')).toBe(false)
    expect(originAllowed(test, '')).toBe(false)
  })
})

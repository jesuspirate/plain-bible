// What a report may carry about an address, a step or an error (worker/src/scrub.ts).
import { describe, expect, it } from 'vitest'
import { screenOf, scrub, scrubLabel } from '../../worker/src/scrub'

const KEY43 = 'Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmE'
const ID22 = 'abcdefghijklmnopqrstuv'

describe('scrub', () => {
  it('cleans an in-app address anywhere in a line', () => {
    expect(scrub(`0:03 Screen #/join?i=${ID22}&k=${KEY43}`)).toBe('0:03 Screen #/join?i=…&k=…')
    expect(scrub('Screen #/search?q=my%20secret&v=KJV · 390×844')).toBe('Screen #/search?q=…&v=KJV · 390×844')
    expect(scrub(`App reloaded · #/move/${ID22}.${KEY43}`)).toBe('App reloaded · #/move/…')
  })
  it('keeps a web address\'s site and path, never its query or #', () => {
    const e = `SecurityError: A history state object with URL 'https://myquietbible.com/#/join?d=${ID22}&k=${KEY43}' cannot be created`
    expect(scrub(e)).toBe("SecurityError: A history state object with URL 'https://myquietbible.com/#/join?d=…&k=…' cannot be created")
    expect(scrub('Load failed https://sync.example/x?token=abc#frag')).toBe('Load failed https://sync.example/x?…#…')
    expect(scrub('Failed to fetch https://myquietbible.com/assets/index-B3k.js')).toBe('Failed to fetch https://myquietbible.com/assets/index-B3k.js')
  })
  it('hides a long key on its own, but not plain words or sizes', () => {
    expect(scrub(`key ${KEY43} and hex ${'ab12'.repeat(16)}`)).toBe('key … and hex …')
    expect(scrub('Started on #/read/KJV/John/3?v=16 · 1024×768 · theme sepia')).toBe('Started on #/read/KJV/John/3?v=16 · 1024×768 · theme sepia')
    expect(scrub('Could not load data/KJV/John.json (404) (data.ts:53)')).toBe('Could not load data/KJV/John.json (404) (data.ts:53)')
  })
  it('hides a one-time code shown on screen, not a verse', () => {
    expect(scrubLabel('4 8 1 5 9 2')).toBe('…')
    expect(scrubLabel('481 592')).toBe('…')
    expect(scrubLabel('John 3:16')).toBe('John 3:16')
  })
  it('screenOf keeps the plain path', () => {
    expect(screenOf('#/read/KJV/John/3?v=16&e=18')).toBe('#/read/KJV/John/3?v=16&e=18')
    expect(screenOf('#/circles/%E2%9C%9D')).toBe('#/circles/…')
  })
})

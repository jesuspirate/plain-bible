import { describe, expect, it } from 'vitest'
import { noteError, recentErrors } from './errors'

describe('recent errors', () => {
  it('keeps the last five, short, without repeats', () => {
    const errs = Array.from({ length: 7 }, (_, i) => new Error('boom ' + i))
    for (const e of errs) noteError(e)
    noteError(errs[6])
    noteError('x'.repeat(500))
    const e = recentErrors()
    expect(e.length).toBe(5)
    expect(e[0]).toMatch(/^boom 3/)
    expect(e[4].length).toBe(200)
  })
  it('never keeps a link\'s key an error quotes', () => {
    noteError(new Error("A history state object with URL 'https://myquietbible.com/#/join?i=abcdefghijklmnopqrstuv&k=Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmE' cannot be created"))
    expect(recentErrors().at(-1)).toMatch(/^A history state object with URL 'https:\/\/myquietbible\.com\/#\/join\?i=…&k=…' cannot be created/)
  })
})

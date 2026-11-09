import { describe, expect, it } from 'vitest'
import { pace, wordAt, words } from './follow'

describe('follow', () => {
  it('finds the words, apostrophes inside', () => {
    const t = 'The LORD’s word, l’Éternel [is] 3 times.'
    expect(words(t).map(([a, b]) => t.slice(a, b))).toEqual(['The', 'LORD’s', 'word', 'l’Éternel', 'is', '3', 'times'])
  })
  it('knows which word a voice is on', () => {
    const s = words('In the beginning, God')
    expect(wordAt(s, 0)).toBe(0)
    expect(wordAt(s, 2)).toBe(1) // the space before "the"
    expect(wordAt(s, 9)).toBe(2)
    expect(wordAt(s, 16)).toBe(3) // the comma
    expect(wordAt(s, 99)).toBe(3)
  })
  it('lingers on long words and at the end of a sentence', () => {
    const t = 'God created light. And'
    const s = words(t)
    expect(pace(t, s[1], 1)).toBeGreaterThan(pace(t, s[0], 1))
    expect(pace(t, s[2], 1)).toBeGreaterThan(pace(t, s[1], 1))
    expect(pace(t, s[0], 0.5)).toBe(pace(t, s[0], 1) * 2)
    expect(pace(t, s[0], 1, true)).toBeLessThan(pace(t, s[0], 1))
  })
})

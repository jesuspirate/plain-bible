import { describe, expect, it } from 'vitest'
import { addSpan, coversAll, toWords } from './stroke'

const text = 'For God so loved the world, that he gave'

describe('toWords', () => {
  it('takes whole words when the pen starts or stops mid-word', () => {
    const [a, b] = toWords(text, 6, 13) // "d so lo"
    expect(text.slice(a, b)).toBe('God so loved')
  })
  it('works drawn backwards', () => {
    const [a, b] = toWords(text, 13, 6)
    expect(text.slice(a, b)).toBe('God so loved')
  })
  it('leaves out the spaces at either end', () => {
    const [a, b] = toWords(text, 3, 8) // " God "
    expect(text.slice(a, b)).toBe('God')
  })
  it('keeps punctuation with its word', () => {
    const [a, b] = toWords(text, 22, 24)
    expect(text.slice(a, b)).toBe('world,')
  })
})

describe('addSpan', () => {
  it('joins spans that overlap or are a space apart', () => {
    const s = addSpan([[0, 3]], [4, 7], text)
    expect(s).toEqual([[0, 7]])
  })
  it('keeps separate phrases separate', () => {
    expect(addSpan([[0, 3]], [11, 16], text)).toEqual([[0, 3], [11, 16]])
  })
})

describe('coversAll', () => {
  it('knows when every word is taken', () => {
    expect(coversAll([[0, text.length]], text)).toBe(true)
    expect(coversAll([[0, 10]], text)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { normalize } from './text'

const loose = { caseSensitive: false, accentSensitive: false }

describe('normalize', () => {
  it('takes accents off Latin, Greek and Hebrew letters', () => {
    expect(normalize('Écoutez', loose)).toBe('ecoutez')
    expect(normalize('Ἰησοῦς', loose)).toBe('ιησουσ')
    expect(normalize('בְּרֵאשִׁית', loose)).toBe('בראשית')
  })

  it('keeps the vowel signs of Indian scripts, which make another word without them', () => {
    expect(normalize('राम', loose)).toBe('राम')
    expect(normalize('राम', loose)).not.toBe(normalize('रम', loose))
    expect(normalize('যীশু', loose)).toBe('যীশু')
    expect(normalize('இயேசு', loose)).toBe('இயேசு')
  })
})

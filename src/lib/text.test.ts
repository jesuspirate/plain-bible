import { describe, expect, it } from 'vitest'
import { normalize, withTags } from './text'

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

describe('withTags', () => {
  it('puts a Strong’s file’s numbers back on the right words', () => {
    expect(withTags('Au commencement, Dieu créa les cieux et la terre.', '1H7225 H430 H1254 H853 H8064 H853 1H776'))
      .toBe('Au {commencement|H7225}, {Dieu|H430} {créa|H1254} {les|H853} {cieux|H8064} {et|H853} la {terre|H776}.')
  })
  it('counts an elided word and a hyphenated word as one word each', () => {
    expect(withTags("de l'abîme, au-dessus des eaux", '2H8415 H5921 1H4325'))
      .toBe("de l'{abîme|H8415}, {au-dessus|H5921} des {eaux|H4325}")
    expect(withTags("c'est une puissance", '1G2076 1G1411')).toBe("c'{est|G2076} une {puissance|G1411}")
  })
  it('joins several numbers with a space', () => {
    expect(withTags('Jésus-Christ notre Seigneur', 'G2424+G5547 1G2962')).toBe('{Jésus-Christ|G2424 G5547} notre {Seigneur|G2962}')
  })
  it('leaves a verse alone with no tags, or one already tagged', () => {
    expect(withTags('Dieu dit', '')).toBe('Dieu dit')
    expect(withTags('{God|H430} said', 'H430')).toBe('{God|H430} said')
  })
})

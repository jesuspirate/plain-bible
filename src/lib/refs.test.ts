import { describe, expect, it } from 'vitest'
import { parseRef, spoken } from './refs'

describe('spoken references', () => {
  it.each([
    ['Exodus chapter 3 verse three', { book: 'Exod', chapter: 3, verse: 3 }],
    ['Exodus chapter 3 verse three.', { book: 'Exod', chapter: 3, verse: 3 }],
    ['Genesis chapter 4', { book: 'Gen', chapter: 4 }],
    ['John three sixteen', { book: 'John', chapter: 3, verse: 16 }], ['Psaume vingt et un', { book: 'Ps', chapter: 21 }], ['Psalm twenty three', { book: 'Ps', chapter: 23 }], ['Psaume soixante-douze', { book: 'Ps', chapter: 72 }],
    ['John chapter three verse sixteen', { book: 'John', chapter: 3, verse: 16 }],
    ['Psalm one hundred nineteen verse one hundred five', { book: 'Ps', chapter: 119, verse: 105 }],
    ['first Corinthians chapter thirteen verses four to seven', { book: '1Cor', chapter: 13, verse: 4, verseEnd: 7 }],
    ['Exode chapitre trois verset deux à cinq', { book: 'Exod', chapter: 3, verse: 2, verseEnd: 5 }],
    ['Genèse chapitre quatre', { book: 'Gen', chapter: 4 }],
    ['Psaume quatre-vingt-onze', { book: 'Ps', chapter: 91 }],
    ['Psaume cent dix-neuf verset cent cinq', { book: 'Ps', chapter: 119, verse: 105 }],
    ['premier Jean chapitre un', { book: '1John', chapter: 1 }],
    ['the book of Ruth chapter 1', { book: 'Ruth', chapter: 1 }],
    ['John 3:16', { book: 'John', chapter: 3, verse: 16 }],
  ])('%s', (q, want) => expect(parseRef(q)).toEqual(want))

  it('leaves ordinary words alone', () => {
    expect(parseRef('love one another')).toBeUndefined()
    expect(spoken('aucune arme')).toBe('aucune arme')
  })
})

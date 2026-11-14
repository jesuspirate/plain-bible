import { describe, expect, it } from 'vitest'
import { candidates, define, isWord, type Dict } from './dict'

const dict: Dict = { w: {
  beget: { d: [['verb', 'To father; to sire.']] },
  begat: { d: [['verb', '(nonstandard) To beget.']], f: [['beget', 'simple past of beget']] },
  Éternel: { d: [['Nom propre', 'Dieu, parfois nommé ainsi dans l’Ancien Testament.']] },
  aïeul: { d: [['Nom commun', 'Grand-parent.']] },
  aïeux: { f: [['aïeul']] },
  vit: { f: [['vivre', 'Troisième personne du singulier du présent de vivre.'], ['nowhere']] },
  vivre: { d: [['Verbe', 'Être en vie.']] },
  love: { d: [['noun', 'A deep caring for another.']] },
} }

describe('define', () => {
  it('finds a word as written, in small letters, or with a capital', () => {
    expect(define(dict, 'Love')?.word).toBe('love')
    expect(define(dict, 'ÉTERNEL')?.word).toBe('Éternel')
  })

  it('gives a form with the definitions of its base word', () => {
    const d = define(dict, 'begat')!
    expect(d.senses[0][1]).toContain('To beget')
    expect(d.bases).toEqual([{ word: 'beget', how: 'simple past of beget', senses: [['verb', 'To father; to sire.']] }])
    expect(define(dict, 'aïeux')!.bases[0].word).toBe('aïeul')
  })

  it('leaves out base words it has no definition for', () => {
    expect(define(dict, 'vit')!.bases.map(b => b.word)).toEqual(['vivre'])
  })

  it("looks past an apostrophe or a hyphen: l'Éternel, dit-il", () => {
    expect(define(dict, 'l’Éternel')?.word).toBe('Éternel')
    expect(candidates('dit-il')).toContain('dit')
  })

  it('takes the punctuation off a selected word', () => {
    expect(define(dict, '« Love,')?.word).toBe('love')
  })

  it('returns nothing for a word it does not know', () => {
    expect(define(dict, 'zzz')).toBeUndefined()
  })
})

describe('isWord', () => {
  it('is one word, not a phrase or a number', () => {
    expect(isWord('propitiation')).toBe(true)
    expect(isWord("l'Éternel;")).toBe(true)
    expect(isWord('In the beginning')).toBe(false)
    expect(isWord('3:16')).toBe(false)
  })
})

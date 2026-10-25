import { describe, expect, it } from 'vitest'
import { buildIndex, fold, lang, looseQuery, looseRanges, looseSearch, looseWords } from './loose'

const VERSES = [
  'No weapon that is formed against thee shall prosper; and every tongue that shall rise against thee in judgment thou shalt condemn.',
  'Wisdom is better than weapons of war: but one sinner destroyeth much good.',
  'And the LORD God formed man of the dust of the ground.',
  'Be still, and know that I am God: I will be exalted among the heathen.',
  'The LORD is my shepherd; I shall not want.',
  'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.',
]
const FR = [
  'Toute arme forgée contre toi sera sans effet; Et toute langue qui s’élèvera en justice contre toi, Tu la condamneras.',
  'Car Dieu a tant aimé le monde qu’il a donné son Fils unique.',
]

function run(q: string, verses = VERSES, code = 'en') {
  const l = lang(code)
  const idx = buildIndex(verses.map((v, i) => [i, ' ' + (fold(v).match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).join(' ') + ' '] as [number, string]), l)
  return looseSearch(idx, looseQuery(looseWords(q)!, l)).sort((a, b) => b.score - a.score).map(h => h.ref)
}

describe('forgiving search', () => {
  it('only takes plain words', () => {
    expect(looseWords('No weapons formed against me')).toEqual(['No', 'weapons', 'formed', 'against', 'me'])
    expect(looseWords('love in:john')).toEqual(['love'])
    expect(looseWords('"no weapon"')).toBeUndefined()
    expect(looseWords('mercy OR grace')).toBeUndefined()
    expect(looseWords('love -hate')).toBeUndefined()
    expect(looseWords('lov*')).toBeUndefined()
    expect(looseWords('H430')).toBeUndefined()
  })
  it('finds a verse from rough wording, best first', () => {
    expect(run('No weapons formed against me')[0]).toBe(0)
    expect(run('be still and know that I am the Lord')[0]).toBe(3)
    expect(run('the lord is my shepherd')[0]).toBe(4)
    expect(run('god loves the world so much he gave his son')[0]).toBe(5)
    expect(run('whoever believes in him will not perish')[0]).toBe(5)
  })
  it('forgives typos', () => {
    expect(run('the lord is my shepard')[0]).toBe(4)
    expect(run('No wepon formed aginst me')[0]).toBe(0)
    expect(run('for god so loved the wrold')[0]).toBe(5)
  })
  it('forgives accents', () => {
    expect(run('toute arme forgee contre toi', FR, 'fr')[0]).toBe(0)
  })
  it('matches word forms', () => {
    expect(run('weapons').sort()).toEqual([0, 1])
    expect(run('form').sort()).toEqual([0, 2])
  })
  it('works in French', () => {
    expect(run('aucune arme forgée contre moi', FR, 'fr')[0]).toBe(0)
    expect(run('Dieu aime le monde', FR, 'fr')[0]).toBe(1)
  })
  it('marks the matched words', () => {
    const l = lang('en'), text = VERSES[0]
    expect(looseRanges(text, looseQuery(['weapons', 'formed'], l), l).map(([a, b]) => text.slice(a, b))).toEqual(['weapon', 'formed'])
  })
})

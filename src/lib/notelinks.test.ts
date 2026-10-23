import { describe, expect, it } from 'vitest'
import { chapterNotes, findMentions, findTags, linkNotes, related } from './notelinks'
import { Marks } from './marks'

const at = (s: string) => findMentions(s).map(m => `${m.book} ${m.chapter}${m.from ? `:${m.from}-${m.to}` : ''}`)

describe('references written in notes', () => {
  it('finds them in English and French', () => {
    expect(at('See Jean 3:16 and 1 Cor 13.4-7, also (Psaume 23).')).toEqual(['John 3:16-16', '1Cor 13:4-7', 'Ps 23'])
    expect(at('Actes des apôtres 4,32 · Ésaïe 41:10 · Ps 91')).toEqual(['Acts 4:32-32', 'Isa 41:10-10', 'Ps 91'])
    expect(at('1 Jean 4:8 Dieu est amour')).toEqual(['1John 4:8-8'])
  })
  it('leaves ordinary writing alone', () => {
    expect(at('le 3 mars, de 9 à 10:30, page 12, ne 5 fois, Jean3')).toEqual([])
  })
})

describe('tags', () => {
  it('reads #tags without case or accents', () => {
    expect(findTags('#Prière et #foi, pas&#39; ni #12 ni mail#x')).toEqual(['priere', 'foi'])
  })
})

describe('related notes', () => {
  const marks: Marks = {
    'John.3.16': { t: 1, ns: { a: { n: 'Love #grace', c: 1, t: 1 } } },
    'Rom.5.8': { t: 2, ns: { b: { n: 'Same as Jean 3:16', c: 2, t: 2 } } },
    'Eph.2.8': { t: 3, ns: { c: { n: 'By #Grace you are saved', c: 3, t: 3 } } },
    'Gen.1.1': { t: 4, ns: { d: { n: 'Read with John 1 and John 3:1-2', c: 4, t: 4 } } },
    'John.3.17': { t: 5, ns: { e: { n: 'cf John 3:16', c: 5, t: 5 } } },
  }
  const links = linkNotes(marks)
  it('links by reference and by tag, never to itself', () => {
    const mine = chapterNotes(marks, 'John', 3, 36)
    expect(mine.map(x => x.id)).toEqual(['a', 'e'])
    const r = related(links, 'John', 3, mine)
    expect(r.map(x => `${x.id} ${x.why}`)).toEqual(['b mentions 3:16', 'c #grace', 'd mentions 3:1–2'])
  })
  it('narrows to the verses of one note', () => {
    const r = related(links, 'John', 3, [], [16])
    expect(r.map(x => x.id)).toEqual(['b', 'e'])
  })
})

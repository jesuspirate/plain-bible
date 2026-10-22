import { describe, expect, it } from 'vitest'
import { compile, highlight, makeCtx, parseQuery, SearchOptions } from './query'
import { plain } from './text'
import { parseRef } from './refs'

const O: SearchOptions = { caseSensitive: false, accentSensitive: false, partialWords: false }

function matches(q: string, verse: string, o = O) {
  const p = parseQuery(q)
  expect(p.errors).toEqual([])
  return compile(p.node!, o)(makeCtx(verse, plain(verse), o))
}

const GEN11 = '{In the beginning|H7225} {God|H430} {created|H853 H1254} {the heaven|H8064} {and|H853} {the earth|H776}.'
const JOHN316 = 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.'

describe('query matching', () => {
  it('matches whole words, case-insensitively', () => {
    expect(matches('god', JOHN316)).toBe(true)
    expect(matches('go', JOHN316)).toBe(false)
    expect(matches('go', JOHN316, { ...O, partialWords: true })).toBe(true)
  })
  it('supports wildcards', () => {
    expect(matches('lov*', JOHN316)).toBe(true)
    expect(matches('l?ved', JOHN316)).toBe(true)
    expect(matches('lov?', JOHN316)).toBe(false)
  })
  it('supports phrases, AND, OR, NOT', () => {
    expect(matches('"only begotten son"', JOHN316)).toBe(true)
    expect(matches('"begotten only"', JOHN316)).toBe(false)
    expect(matches('world AND life', JOHN316)).toBe(true)
    expect(matches('world grace', JOHN316)).toBe(false)
    expect(matches('grace OR life', JOHN316)).toBe(true)
    expect(matches('world -perish', JOHN316)).toBe(false)
    expect(matches('world NOT (grace | mercy)', JOHN316)).toBe(true)
  })
  it('supports NEAR', () => {
    expect(matches('god NEAR/3 world', JOHN316)).toBe(true)
    expect(matches('god NEAR/3 life', JOHN316)).toBe(false)
    expect(matches('god NEAR life', JOHN316, O)).toBe(false)
    expect(matches('god NEAR/30 life', JOHN316)).toBe(true)
  })
  it("matches Strong's numbers in tagged text", () => {
    expect(matches('H430', GEN11)).toBe(true)
    expect(matches('h0430', GEN11)).toBe(true)
    expect(matches('H1254 earth', GEN11)).toBe(true)
    expect(matches('G26', GEN11)).toBe(false)
    expect(matches('"the heaven and the earth"', GEN11)).toBe(true)
  })
  it('ignores accents and Hebrew points by default', () => {
    expect(matches('θεος', 'καὶ Θεὸς ἦν ὁ λόγος.')).toBe(true)
    expect(matches('λογος', 'καὶ Θεὸς ἦν ὁ λόγος.')).toBe(true)
    expect(matches('אלהים', 'בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים')).toBe(true)
    expect(matches('corazon', 'y con todo tu corazón')).toBe(true)
    expect(matches('corazon', 'y con todo tu corazón', { ...O, accentSensitive: true })).toBe(false)
  })
  it('matches substrings in scripts without spaces', () => {
    expect(matches('神愛世人', '「神愛世人，甚至將他的獨生子賜給他們')).toBe(true)
  })
  it('supports regex', () => {
    expect(matches('/believ(e|eth)/', JOHN316)).toBe(true)
  })
  it('reads book filters', () => {
    const p = parseQuery('love in:1john,gospels')
    expect(p.books!.has('1John')).toBe(true)
    expect(p.books!.has('Luke')).toBe(true)
    expect(p.books!.has('Rom')).toBe(false)
    expect(parseQuery('x in:gen-deut').books!.size).toBe(5)
    expect(parseQuery('x in:nt').books!.size).toBe(27)
  })
  it('reports problems', () => {
    expect(parseQuery('-love').errors.length).toBe(1)
    expect(parseQuery('love in:nowhere').errors.length).toBe(1)
  })
})

describe('highlight', () => {
  it('returns ranges in the plain text', () => {
    const p = parseQuery('"only begotten" lov*')
    const r = highlight(p.node!, JOHN316, JOHN316, O)
    expect(r.map(([a, b]) => JOHN316.slice(a, b))).toEqual(['loved', 'only begotten'])
  })
  it("highlights Strong's-tagged words", () => {
    const p = parseQuery('H430')
    const t = plain(GEN11)
    expect(highlight(p.node!, GEN11, t, O).map(([a, b]) => t.slice(a, b))).toEqual(['God'])
  })
})

describe('references', () => {
  it('parses common forms', () => {
    expect(parseRef('John 3:16')).toEqual({ book: 'John', chapter: 3, verse: 16 })
    expect(parseRef('jn 3')).toEqual({ book: 'John', chapter: 3 })
    expect(parseRef('1 Cor 13:4-7')).toEqual({ book: '1Cor', chapter: 13, verse: 4, verseEnd: 7 })
    expect(parseRef('1cor 13')).toEqual({ book: '1Cor', chapter: 13 })
    expect(parseRef('Psalm 23')).toEqual({ book: 'Ps', chapter: 23 })
    expect(parseRef('Song of Songs 2')).toEqual({ book: 'Song', chapter: 2 })
    expect(parseRef('Revelation')).toEqual({ book: 'Rev', chapter: 1 })
    expect(parseRef('love one another')).toBeUndefined()
    expect(parseRef('faith')).toBeUndefined()
  })
})

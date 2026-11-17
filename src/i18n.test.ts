import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LANGS, type Dict } from './i18n'
import { englishKeys, pluralPairs } from './i18n.keys'
import { BOOKS } from './lib/books'

// Every language the app speaks has every English sentence, with the same
// {placeholders}, and so do its welcome and support pages. The words are in
// public/i18n/<page>/<lang>.json, one file per language, fetched only by the
// people who read in it.
const read = (page: string, l: string) => JSON.parse(readFileSync(`public/i18n/${page}/${l}.json`, 'utf8'))
const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join()
const tags = (s: string) => [...s.matchAll(/<\/?([a-z0-9]+)/gi)].map(m => m[0].toLowerCase()).join()
const others = LANGS.filter(l => l.id !== 'en').map(l => l.id)

// Sentences the service builds with a number in them.
const EXTRA = new Set(['You can be in up to 20 circles', 'A circle can have up to 50 people', 'A circle can have up to 300 people', 'Something went wrong'])
const keys = englishKeys(), plurals = pluralPairs()

it('lists exactly the languages that have words', () => {
  for (const page of ['app', 'welcome', 'support']) {
    expect(readdirSync(`public/i18n/${page}`).map(f => f.replace(/\.json$/, '')).sort()).toEqual([...others].sort())
  }
})

describe.each(others)('%s', l => {
  const dict = read('app', l) as Dict
  const forms = (k: string): string[] => { const v = dict[k]; return typeof v === 'string' ? [v] : v ? Object.values(v) : [] }
  it('has every sentence', () => {
    expect(keys.filter(k => !forms(k).length || forms(k).some(s => typeof s !== 'string' || !s.trim()))).toEqual([])
  })
  it('keeps the placeholders', () => {
    expect(keys.filter(k => forms(k).some(s => holes(k) !== holes(s)))).toEqual([])
  })
  it('uses plural forms only where a count is', () => {
    const cats = new Set(new Intl.PluralRules(l.replace(/-(han[st])$/, (_, s: string) => '-' + s[0].toUpperCase() + s.slice(1))).resolvedOptions().pluralCategories)
    const bad = keys.filter(k => { const v = dict[k]; return v && typeof v === 'object' && (!plurals.has(k) || !('other' in v) || Object.keys(v).some(c => !cats.has(c as Intl.LDMLPluralRule))) })
    expect(bad).toEqual([])
  })
  it('has nothing left over', () => {
    const known = new Set(keys)
    expect(Object.keys(dict).filter(k => !known.has(k) && !EXTRA.has(k) && !k.startsWith('@'))).toEqual([])
  })
  it('never calls a gift tax-deductible', () => {
    expect(JSON.stringify([dict, read('support', l), read('welcome', l)])).not.toMatch(/tax[- ]deductible/i)
  })
  it.skipIf(l === 'fr' || l === 'es')('names every book', () => {
    expect(BOOKS.filter(b => !dict['@books']?.[b.id]).map(b => b.id)).toEqual([])
  })
  it.each(['welcome', 'support'])('has the %s page', page => {
    const fr = read(page, 'fr'), words = read(page, l)
    expect(Object.keys(fr).filter(k => k !== 'mock' && k !== 'closing' && !(k in words))).toEqual([])
    expect(Object.keys(words).filter(k => !(k in fr))).toEqual([])
    // The same {placeholders} and HTML tags as the French, which matches the English.
    expect(Object.keys(words).filter(k => typeof fr[k] === 'string' && (holes(fr[k]) !== holes(words[k]) || tags(fr[k]) !== tags(words[k])))).toEqual([])
  })
})

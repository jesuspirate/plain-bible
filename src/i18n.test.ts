import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import fr from './i18n/fr'
import es from './i18n/es'

// Every English sentence the app shows has its French and Spanish, with the
// same {placeholders}. The sentences are found where they're written: in
// t(), tn(), tj() and N_(), thrown as a SyncError, or sent by the sync
// service (worker/src/index.ts).
const files = (dir: string): string[] => readdirSync(dir).flatMap(f => {
  const p = join(dir, f)
  return statSync(p).isDirectory() ? (f === 'i18n' ? [] : files(p)) : /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [p] : []
})
const STR = String.raw`'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"`
const unquote = (m: RegExpExecArray, i = 1) => (m[i] ?? m[i + 1]).replace(/\\(.)/g, '$1')

export function englishKeys() {
  const keys = new Set<string>()
  const add = (re: RegExp, text: string, groups: number[]) => { for (const m of text.matchAll(re)) for (const g of groups) keys.add(unquote(m as RegExpExecArray, g)) }
  for (const f of files('src')) {
    const s = readFileSync(f, 'utf8')
    add(new RegExp(String.raw`\b(?:t|tj|N_)\(\s*(?:${STR})`, 'g'), s, [1])
    add(new RegExp(String.raw`\btn\([^,]+,\s*(?:${STR})\s*,\s*(?:${STR})`, 'g'), s, [1, 3])
    add(new RegExp(String.raw`new SyncError\(\s*(?:${STR})`, 'g'), s, [1])
  }
  const worker = readFileSync('worker/src/index.ts', 'utf8')
  add(new RegExp(String.raw`HttpError\(\d+,\s*(?:${STR})`, 'g'), worker, [1])
  for (const m of worker.matchAll(/const expired = '([^']*)'/g)) keys.add(m[1])
  keys.delete('Cancelled')
  return [...keys]
}

const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join()

describe.each([['fr', fr], ['es', es]] as const)('%s', (_, dict) => {
  const keys = englishKeys()
  it('has every sentence', () => {
    expect(keys.filter(k => !(k in dict))).toEqual([])
  })
  it('keeps the placeholders', () => {
    expect(keys.filter(k => k in dict && holes(k) !== holes(dict[k]))).toEqual([])
  })
  it('has nothing left over', () => {
    const known = new Set(keys)
    expect(Object.keys(dict).filter(k => !known.has(k) && !EXTRA.has(k))).toEqual([])
  })
})

// Sentences the service builds with a number in them.
const EXTRA = new Set(['You can be in up to 20 circles', 'A circle can have up to 50 people', 'Something went wrong'])

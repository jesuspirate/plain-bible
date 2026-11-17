import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Every English sentence the app shows, found where it's written: in t(),
// tn(), tj() and N_(), thrown as a SyncError, or sent by the sync service
// (worker/src/index.ts). For the tests and the translation tools only; the
// app never imports this.
const files = (dir: string): string[] => readdirSync(dir).flatMap(f => {
  const p = join(dir, f)
  return statSync(p).isDirectory() ? (f === 'i18n' ? [] : files(p)) : /\.tsx?$/.test(f) && !/\.test\.|i18n\.keys/.test(f) ? [p] : []
})
const STR = String.raw`'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"`
const unquote = (m: RegExpExecArray, i = 1) => (m[i] ?? m[i + 1]).replace(/\\(.)/g, '$1')

/** The English keys, and for each tn() pair its "other" (plural) key → its "one" key. */
export function englishKeys(): string[] { return [...scan().keys] }
export function pluralPairs(): Map<string, string> { return scan().plurals }

function scan() {
  const keys = new Set<string>(), plurals = new Map<string, string>()
  const add = (re: RegExp, text: string, groups: number[]) => { for (const m of text.matchAll(re)) for (const g of groups) keys.add(unquote(m as RegExpExecArray, g)) }
  for (const f of files('src')) {
    const s = readFileSync(f, 'utf8')
    add(new RegExp(String.raw`\b(?:t|tj|N_)\(\s*(?:${STR})`, 'g'), s, [1])
    const tn = new RegExp(String.raw`\btn\([^,]+,\s*(?:${STR})\s*,\s*(?:${STR})`, 'g')
    add(tn, s, [1, 3])
    for (const m of s.matchAll(tn)) plurals.set(unquote(m as RegExpExecArray, 3), unquote(m as RegExpExecArray, 1))
    add(new RegExp(String.raw`new SyncError\(\s*(?:${STR})`, 'g'), s, [1])
  }
  const worker = readFileSync('worker/src/index.ts', 'utf8')
  add(new RegExp(String.raw`HttpError\(\d+,\s*(?:${STR})`, 'g'), worker, [1])
  for (const m of worker.matchAll(/const expired = '([^']*)'/g)) keys.add(m[1])
  keys.delete('Cancelled')
  return { keys, plurals }
}

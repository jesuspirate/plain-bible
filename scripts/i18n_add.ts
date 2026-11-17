// Adds new sentences to every language file at once, and lists what's missing.
//
//   npx tsx scripts/i18n_add.ts            lists the English sentences each language lacks
//   npx tsx scripts/i18n_add.ts new.json   merges { "<lang>": { "<English>": "<words>" }, … }
//                                          into public/i18n/app/<lang>.json
//
// A new t('…') in the code needs its words in every language (src/i18n.test.ts
// checks). Keep the {placeholders}; for a tn() plural, the "other" sentence may
// be an object of Intl.PluralRules forms ({ "one": …, "few": …, "other": … }).
import { readFileSync, writeFileSync } from 'node:fs'
import { LANGS } from '../src/i18n'
import { englishKeys } from '../src/i18n.keys'

const file = (l: string) => `public/i18n/app/${l}.json`
const add = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) as Record<string, Record<string, unknown>> : {}
const keys = englishKeys()
for (const { id } of LANGS) {
  if (id === 'en') continue
  const dict = JSON.parse(readFileSync(file(id), 'utf8'))
  if (add[id]) { Object.assign(dict, add[id]); writeFileSync(file(id), JSON.stringify(dict, null, 1).replace(/^ /gm, '') + '\n') }
  const missing = keys.filter(k => !(k in dict))
  if (missing.length) console.log(`${id}: ${missing.length} missing\n  ` + missing.join('\n  '))
}

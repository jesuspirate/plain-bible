// Word definitions, from Wiktionary (CC BY-SA), in English, French and
// Spanish: one file per language with the words of that language's Bibles
// (scripts/build_dict.py). Nothing is downloaded until you first ask for a
// word; the file is then kept, like a saved Bible, and works offline.

export type DictLang = 'en' | 'fr' | 'es'
export const DICT_LANGS: DictLang[] = ['en', 'fr', 'es']

/** [kind ("noun", "Nom commun"), definition, definition…] */
export type Sense = string[]
/** [base word, how this word comes from it ("simple past of beget")] */
export type Base = [string] | [string, string]
export interface Entry { d?: Sense[]; f?: Base[] }
export interface Dict { w: Record<string, Entry> }

export interface Definition {
  /** the word as the dictionary has it ("Éternel" for "l'Éternel") */
  word: string
  senses: Sense[]
  /** the base words it is a form of, each with its own definitions */
  bases: { word: string; how?: string; senses: Sense[] }[]
}

export const dictUrl = (lang: DictLang, base = document.baseURI) => new URL(`dict/${lang}.json`, base).href

const loaded = new Map<DictLang, Promise<Dict>>()

export function loadDict(lang: DictLang): Promise<Dict> {
  let p = loaded.get(lang)
  if (!p) {
    p = fetch(dictUrl(lang)).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
    // Offline the first time: try again next time, not never.
    p.catch(() => loaded.delete(lang))
    loaded.set(lang, p)
  }
  return p
}

/** Whether the dictionary for a language is already on this device. */
export async function haveDict(lang: DictLang): Promise<boolean> {
  if (loaded.has(lang)) return true
  try { return !!(await (await caches.open('bible-data')).match(dictUrl(lang))) } catch { return false }
}

/** A word's letters, apostrophes and hyphens, as typed or selected. */
export function cleanWord(s: string): string {
  return s.normalize('NFC').replace(/[’ʼ]/g, "'").replace(/‑/g, '-')
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
}

/** One word, not a phrase: what "Define" is offered for. */
export const isWord = (s: string) => {
  const w = cleanWord(s)
  return w.length > 0 && w.length <= 40 && /^\p{L}+(?:['-]\p{L}+)*$/u.test(w)
}

/** The shapes to look a word up under, best first: as written, in small
 *  letters, with a capital; then the parts joined by an apostrophe or a
 *  hyphen, the longest first ("l'Éternel" → "Éternel", "dit-il" → "dit"). */
export function candidates(raw: string): string[] {
  const w = cleanWord(raw)
  const shapes = (x: string) => {
    const low = x.toLocaleLowerCase()
    return [x, low, low.charAt(0).toLocaleUpperCase() + low.slice(1)]
  }
  const parts = w.split(/['-]/).filter(p => p.length > 1).sort((a, b) => b.length - a.length)
  return [...new Set([...shapes(w), ...(/['-]/.test(w) ? parts.flatMap(shapes) : [])])]
}

export function define(dict: Dict, raw: string): Definition | undefined {
  for (const c of candidates(raw)) {
    const e = dict.w[c]
    if (!e) continue
    const bases = (e.f ?? []).map(([word, how]) => ({ word, how, senses: dict.w[word]?.d ?? [] })).filter(b => b.senses.length)
    if (e.d?.length || bases.length) return { word: c, senses: e.d ?? [], bases }
  }
}

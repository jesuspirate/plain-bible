import type { ComponentChildren } from 'preact'

// The app's words in the language you read it in. English is written in the
// code itself and doubles as the key: t('Done') is "Done", "OK" or "Listo".
// French and Spanish are each a small file of their own, loaded only by the
// people who use them (and saved offline with the app), so English costs
// nothing and the others cost one small file at startup.

export type Lang = 'en' | 'fr' | 'es'
export const LANGS: { id: Lang; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'fr', name: 'Français' },
  { id: 'es', name: 'Español' },
]
export type Dict = Record<string, string>

const LOAD: Record<Exclude<Lang, 'en'>, () => Promise<{ default: Dict }>> = {
  fr: () => import('./i18n/fr'),
  es: () => import('./i18n/es'),
}

let lang: Lang = 'en'
let dict: Dict = {}

export const currentLang = () => lang
const known = (l: string | undefined): l is Lang => l === 'en' || l === 'fr' || l === 'es'

/** The phone's (or browser's) own language, if it's one the app speaks. */
export function deviceLang(): Lang {
  const list = navigator.languages?.length ? navigator.languages : [navigator.language || 'en']
  for (const l of list) {
    const code = l.toLowerCase().split('-')[0]
    if (known(code)) return code
  }
  return 'en'
}

/** The language picked in Settings, or the device's when it's left on Automatic. */
export const pickLang = (setting?: string): Lang => known(setting) ? setting : deviceLang()

/** The language set in Settings on this device, read straight from storage
 *  (before the app starts, to load its words first). */
export function savedLang(): Lang {
  try { return pickLang(JSON.parse(localStorage.getItem('plain-bible:settings') || '{}').language ?? localStorage.getItem('plain-bible:welcome-lang') ?? undefined) }
  catch { return deviceLang() }
}

/** Switch the app's words. Resolves once they're in. */
export async function setLang(l: Lang) {
  const words = l === 'en' ? {} : (await LOAD[l]()).default
  lang = l; dict = words
  document.documentElement.lang = l
}

/** For dates and numbers: the device's own locale when it's in the same
 *  language (so a Canadian phone keeps its date order), else the language. */
export const locale = () => (navigator.languages ?? []).find(l => l.toLowerCase().split('-')[0] === lang) ?? lang

const fill = (s: string, vars?: Record<string, string | number>) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k) => k in vars ? (typeof vars[k] === 'number' ? (vars[k] as number).toLocaleString(locale()) : String(vars[k])) : m) : s

/** The words in the current language; {name} is filled in from vars. */
export function t(en: string, vars?: Record<string, string | number>): string {
  return fill((lang !== 'en' && dict[en]) || en, vars)
}

/** One or many: tn(3, '{n} verse', '{n} verses'). French counts 0 and 1 as one. */
export function tn(n: number, one: string, other: string, vars?: Record<string, string | number>): string {
  const single = lang === 'fr' ? n < 2 : n === 1
  return t(single ? one : other, { n, ...vars })
}

/** Like t, with parts that are elements: tj('Signed in as {email}', { email: <strong>…</strong> }). */
export function tj(en: string, parts: Record<string, ComponentChildren>): ComponentChildren[] {
  const s = (lang !== 'en' && dict[en]) || en
  return s.split(/(\{\w+\})/).map(p => {
    const k = p.match(/^\{(\w+)\}$/)?.[1]
    return k && k in parts ? parts[k] : p
  })
}

/** A language's name in the app's language ("French", "français" → "Français").
 *  English keeps the catalog's own names. */
export function languageName(code: string, english: string): string {
  if (lang === 'en') return english
  try {
    const n = new Intl.DisplayNames([lang], { type: 'language' }).of(code)
    if (n && n.toLowerCase() !== code.toLowerCase()) return n[0].toLocaleUpperCase(lang) + n.slice(1)
  } catch { /* an old browser, or a code it doesn't know */ }
  return english
}

/** Marks words for translation where they're written (a list of names, say)
 *  and translated where they're shown, with t(). */
export const N_ = (en: string) => en

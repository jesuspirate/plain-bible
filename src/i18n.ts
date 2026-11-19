import type { ComponentChildren } from 'preact'

// The app's words in the language you read it in. English is written in the
// code itself and doubles as the key: t('Done') is "Done", "OK" or "Listo".
// Every other language is a file of its own (public/i18n/app/<lang>.json),
// fetched only by the people who use it and kept offline once fetched
// (vite.config.ts), so English costs nothing and the others cost one file.

export type Lang = string
export interface LangInfo { id: Lang; name: string; rtl?: true }

/** Every language the app speaks, each named in itself. A language has one
 *  when at least one Bible in the app is in it, or when its readers asked
 *  (Sepedi, while its Bible waits on permission). */
export const LANGS: LangInfo[] = ([
  ['en', 'English'], ['fr', 'Français'], ['es', 'Español'],
  ['ar', 'العربية', 1], ['as', 'অসমীয়া'], ['bn', 'বাংলা'], ['ceb', 'Cebuano'], ['chr', 'ᏣᎳᎩ'], ['ckb', 'کوردی', 1],
  ['cs', 'Čeština'], ['da', 'Dansk'], ['de', 'Deutsch'], ['ee', 'Eʋegbe'], ['el', 'Ελληνικά'], ['eo', 'Esperanto'],
  ['fa', 'فارسی', 1], ['fi', 'Suomi'], ['gu', 'ગુજરાતી'], ['gv', 'Gaelg'], ['ha', 'Hausa'], ['haw', 'ʻŌlelo Hawaiʻi'],
  ['he', 'עברית', 1], ['hi', 'हिन्दी'], ['hr', 'Hrvatski'], ['ht', 'Kreyòl ayisyen'], ['hu', 'Magyar'], ['hy', 'Հայերեն'],
  ['id', 'Bahasa Indonesia'], ['ig', 'Igbo'], ['ilo', 'Ilokano'], ['it', 'Italiano'], ['ja', '日本語'], ['ki', 'Gĩkũyũ'],
  ['kn', 'ಕನ್ನಡ'], ['ko', '한국어'], ['lg', 'Luganda'], ['ln', 'Lingála'], ['luo', 'Dholuo'], ['lv', 'Latviešu'],
  ['mg', 'Malagasy'], ['ml', 'മലയാളം'], ['mr', 'मराठी'], ['my', 'မြန်မာ'], ['nb', 'Norsk bokmål'], ['nd', 'isiNdebele'],
  ['ne', 'नेपाली'], ['nl', 'Nederlands'], ['nn', 'Norsk nynorsk'], ['nso', 'Sepedi'], ['ny', 'Chichewa'], ['om', 'Afaan Oromoo'], ['or', 'ଓଡ଼ିଆ'],
  ['pa', 'ਪੰਜਾਬੀ'], ['pl', 'Polski'], ['pon', 'Lokaiahn Pohnpei'], ['pt', 'Português'], ['ru', 'Русский'], ['sl', 'Slovenščina'],
  ['sn', 'chiShona'], ['sq', 'Shqip'], ['sr', 'Српски'], ['sv', 'Svenska'], ['sw', 'Kiswahili'], ['ta', 'தமிழ்'],
  ['te', 'తెలుగు'], ['tl', 'Tagalog'], ['to', 'Lea faka-Tonga'], ['tw', 'Twi'], ['ug', 'ئۇيغۇرچە', 1], ['uk', 'Українська'],
  ['vi', 'Tiếng Việt'], ['yo', 'Yorùbá'], ['zh-hans', '简体中文'], ['zh-hant', '繁體中文'],
] as [Lang, string, 1?][]).map(([id, name, rtl]) => rtl ? { id, name, rtl: true } : { id, name })
const BY_ID = new Map(LANGS.map(l => [l.id, l]))

/** A count sentence's forms, for languages with more than one plural
 *  (Intl.PluralRules categories: one, two, few, many, other, zero). */
export type Forms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }
/** A language's words, keyed by the English. Book names ride along. */
export type Dict = Record<string, string | Forms | Record<string, string>> & { '@books'?: Record<string, string>; '@abbr'?: Record<string, string> }

let lang: Lang = 'en'
let dict: Dict = {}
const listeners = new Set<(l: Lang, d: Dict) => void>()

export const currentLang = () => lang
export const isRtl = (l: Lang = lang) => !!BY_ID.get(l)?.rtl
const known = (l: string | undefined): l is Lang => !!l && BY_ID.has(l)

/** The id the app uses for a device language tag ("pt-BR" → "pt",
 *  "zh-TW" → "zh-hant"), whether or not the app speaks it. */
export function langOf(tag: string): Lang {
  const t = tag.toLowerCase().replace(/_/g, '-')
  const [code, ...rest] = t.split('-')
  if (code === 'zh') return rest.includes('hant') || rest.some(r => ['tw', 'hk', 'mo'].includes(r)) ? 'zh-hant' : 'zh-hans'
  return ({ no: 'nb', iw: 'he', in: 'id', fil: 'tl', ji: 'yi' } as Record<string, string>)[code] ?? code
}

/** The phone's (or browser's) own language, if it's one the app speaks. */
export function deviceLang(): Lang {
  const list = navigator.languages?.length ? navigator.languages : [navigator.language || 'en']
  for (const l of list) {
    const id = langOf(l)
    if (known(id)) return id
  }
  return 'en'
}

/** The language picked in Settings, or the device's when it's left on Automatic. */
export const pickLang = (setting?: string): Lang => known(setting) ? setting : deviceLang()

/** A language the app speaks, by its id; undefined for one it doesn't. */
export const knownLang = (l: string | null | undefined): Lang | undefined => known(l ?? undefined) ? l! : undefined

/** The language set in Settings on this device, read straight from storage
 *  (before the app starts, to load its words first). */
export function savedLang(): Lang {
  try { return pickLang(JSON.parse(localStorage.getItem('plain-bible:settings') || '{}').language ?? localStorage.getItem('plain-bible:welcome-lang') ?? undefined) }
  catch { return deviceLang() }
}

/** Where a language's words are, next to the app. */
export const wordsUrl = (l: Lang) => new URL(`i18n/app/${l}.json`, document.baseURI).href

/** Switch the app's words. Resolves once they're in. */
export async function setLang(l: Lang) {
  let words: Dict = {}
  if (l !== 'en') {
    const r = await fetch(wordsUrl(l))
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    words = await r.json()
  }
  lang = l; dict = words
  document.documentElement.lang = l
  document.documentElement.dir = isRtl(l) ? 'rtl' : 'ltr'
  for (const f of listeners) f(l, dict)
}

/** Called with each new language's words (book names follow the language). */
export function onLang(f: (l: Lang, d: Dict) => void) { listeners.add(f); return () => { listeners.delete(f) } }

/** The BCP 47 tag for Intl: "zh-hant" → "zh-Hant". */
export const intlTag = (l: Lang = lang) => l.replace(/-(han[st])$/, (_, s: string) => '-' + s[0].toUpperCase() + s.slice(1))

/** For dates and numbers: the device's own locale when it's in the same
 *  language (so a Canadian phone keeps its date order), else the language. */
export const locale = () => (navigator.languages ?? []).find(l => langOf(l) === lang) ?? intlTag()

const fill = (s: string, vars?: Record<string, string | number>) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k) => k in vars ? (typeof vars[k] === 'number' ? (vars[k] as number).toLocaleString(locale()) : String(vars[k])) : m) : s

const word = (en: string): string => {
  if (lang === 'en') return en
  const w = dict[en]
  return typeof w === 'string' ? w : (w as Forms | undefined)?.other ?? en
}

/** The words in the current language; {name} is filled in from vars. */
export function t(en: string, vars?: Record<string, string | number>): string {
  return fill(word(en), vars)
}

let rules: Intl.PluralRules | undefined, rulesFor = ''
const plural = (n: number): Intl.LDMLPluralRule => {
  if (rulesFor !== lang) { try { rules = new Intl.PluralRules(intlTag()) } catch { rules = new Intl.PluralRules('en') } rulesFor = lang }
  return rules!.select(n)
}

/** One or many: tn(3, '{n} verse', '{n} verses'). Exactly one uses the first;
 *  otherwise the language's own plural rule picks the form (French counts 0
 *  as one, Russian has three forms, Chinese one). */
export function tn(n: number, one: string, other: string, vars?: Record<string, string | number>): string {
  const all = { n, ...vars }
  if (lang === 'en') return fill(n === 1 ? one : other, all)
  if (n === 1) return t(one, all)
  const cat = plural(n), w = dict[other]
  if (w && typeof w === 'object') return fill((w as Forms)[cat] ?? (w as Forms).other, all)
  // A one-form that spells the number out ("One circle…") only fits exactly one.
  return cat === 'one' && !/^One\b/.test(one) ? t(one, all) : t(other, all)
}

/** Like t, with parts that are elements: tj('Signed in as {email}', { email: <strong>…</strong> }). */
export function tj(en: string, parts: Record<string, ComponentChildren>): ComponentChildren[] {
  return word(en).split(/(\{\w+\})/).map(p => {
    const k = p.match(/^\{(\w+)\}$/)?.[1]
    return k && k in parts ? parts[k] : p
  })
}

/** A language's name in the app's language ("French", "français" → "Français").
 *  English keeps the catalog's own names. */
export function languageName(code: string, english: string): string {
  if (lang === 'en') return english
  try {
    const n = new Intl.DisplayNames([intlTag()], { type: 'language' }).of(intlTag(code))
    if (n && n.toLowerCase() !== code.toLowerCase()) return n[0].toLocaleUpperCase(intlTag()) + n.slice(1)
  } catch { /* an old browser, or a code it doesn't know */ }
  return english
}

/** Marks words for translation where they're written (a list of names, say)
 *  and translated where they're shown, with t(). */
export const N_ = (en: string) => en

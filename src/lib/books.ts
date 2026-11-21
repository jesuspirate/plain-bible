import { currentLang, N_, onLang } from '../i18n'

// Canonical book order and English names/abbreviations used for navigation and
// reference parsing. Book ids match the ids used in public/data.
import { BOOKS, ES, FR, type BookInfo, type Group } from './bookList'
export { BOOKS, type BookInfo, type Group } from './bookList'

export const BOOK_INDEX: Record<string, number> = Object.fromEntries(BOOKS.map((b, i) => [b.id, i]))
export const bookById = (id: string) => BOOKS[BOOK_INDEX[id]]
export const isOT = (id: string) => BOOK_INDEX[id] < 39
export const isNT = (id: string) => BOOK_INDEX[id] >= 39 && BOOK_INDEX[id] < 66

// Named scopes for search ("in:nt", "in:gospels", ...).
export const SCOPES: Record<string, { label: string; books: string[] }> = (() => {
  const by = (pred: (b: BookInfo, i: number) => boolean) => BOOKS.filter(pred).map(b => b.id)
  const g = (...groups: Group[]) => by(b => groups.includes(b.group))
  return {
    ot: { label: N_('Old Testament'), books: by((_, i) => i < 39) },
    nt: { label: N_('New Testament'), books: by((_, i) => i >= 39 && i < 66) },
    law: { label: N_('Law (Genesis–Deuteronomy)'), books: g('law') },
    history: { label: N_('History (Joshua–Esther)'), books: g('history') },
    wisdom: { label: N_('Wisdom & Poetry (Job–Song)'), books: g('wisdom') },
    prophets: { label: N_('Prophets (Isaiah–Malachi)'), books: g('major', 'minor') },
    major: { label: N_('Major Prophets'), books: g('major') },
    minor: { label: N_('Minor Prophets'), books: g('minor') },
    gospels: { label: N_('Gospels'), books: g('gospels') },
    epistles: { label: N_('Epistles (Romans–Jude)'), books: g('pauline', 'general') },
    pauline: { label: N_("Paul's letters"), books: g('pauline') },
    general: { label: N_('General letters (Hebrews–Jude)'), books: g('general') },
    deutero: { label: N_('Deuterocanon / Apocrypha'), books: g('deutero') },
    ethiopic: { label: N_('Ethiopian canon'), books: g('ethiopic', 'deutero').filter(id => ['Jub', '1Meq', '2Meq', '3Meq', '4Bar', '1En', 'Tob', 'Jdt', 'Wis', 'Sir', 'Bar', 'EpJer', '1Esd', '2Esd', 'PrMan', 'AddPs', '1Macc', '2Macc', '3Macc'].includes(id)) },
  }
})()
SCOPES.torah = SCOPES.law
SCOPES.poetry = SCOPES.wisdom
SCOPES.apocrypha = SCOPES.deutero
SCOPES.ethiopian = SCOPES.ethiopic

// The short forms printed Bibles use in each language, for narrow places
// (the book grid, a long name on a small phone). Other books shorten by cutting.
const BOOK_IDS_66 = 'Gen Exod Lev Num Deut Josh Judg Ruth 1Sam 2Sam 1Kgs 2Kgs 1Chr 2Chr Ezra Neh Esth Job Ps Prov Eccl Song Isa Jer Lam Ezek Dan Hos Joel Amos Obad Jonah Mic Nah Hab Zeph Hag Zech Mal Matt Mark Luke John Acts Rom 1Cor 2Cor Gal Eph Phil Col 1Thess 2Thess 1Tim 2Tim Titus Phlm Heb Jas 1Pet 2Pet 1John 2John 3John Jude Rev'.split(' ')
const ABBR: Record<string, Record<string, string | undefined>> = {
  fr: Object.fromEntries(BOOK_IDS_66.map((id, i) => [id, 'Gen|Ex|Lév|Nomb|Deut|Jos|Jug|Ruth|1 Sam|2 Sam|1 Rois|2 Rois|1 Chr|2 Chr|Esd|Néh|Est|Job|Ps|Prov|Ecc|Cant|És|Jér|Lam|Éz|Dan|Os|Joël|Am|Abd|Jon|Mich|Nah|Hab|Soph|Agg|Zach|Mal|Matt|Marc|Luc|Jean|Act|Rom|1 Cor|2 Cor|Gal|Éph|Phil|Col|1 Thes|2 Thes|1 Tim|2 Tim|Tite|Phm|Héb|Jacq|1 Pi|2 Pi|1 Jn|2 Jn|3 Jn|Jude|Apoc'.split('|')[i]])),
  es: Object.fromEntries(BOOK_IDS_66.map((id, i) => [id, 'Gén|Éx|Lev|Núm|Dt|Jos|Jue|Rut|1 Sam|2 Sam|1 Re|2 Re|1 Cr|2 Cr|Esd|Neh|Est|Job|Sal|Pr|Ec|Cant|Is|Jer|Lam|Ez|Dn|Os|Jl|Am|Abd|Jon|Miq|Nah|Hab|Sof|Hag|Zac|Mal|Mt|Mr|Lc|Jn|Hch|Ro|1 Co|2 Co|Gál|Ef|Fil|Col|1 Ts|2 Ts|1 Ti|2 Ti|Tit|Flm|Heb|Stg|1 P|2 P|1 Jn|2 Jn|3 Jn|Jud|Ap'.split('|')[i]])),
}
const NAMES = { fr: FR, es: ES } as Record<string, Record<string, string>>
for (const table of [FR, ES]) {
  for (const [id, name] of Object.entries(table)) {
    const b = BOOKS[BOOK_INDEX[id]]
    b.aliases.push(name.toLowerCase().replace('’', "'"))
  }
}
BOOKS[BOOK_INDEX.Ps].aliases.push('psaume', 'salmo')
BOOKS[BOOK_INDEX['1En']].aliases.push('hénoch', 'enoc')

/** A book's name in French ("Ésaïe"), if it has one. */
export const frenchName = (id: string) => FR[id]

/** A book's name in the app's language: "Isaiah", "Ésaïe" or "Isaías". */
export const bookName = (id: string, lang: string = currentLang()) => NAMES[lang]?.[id] || bookById(id).name
/** Its short form, for narrow places: "1 Thes", "Apoc". */
export function bookAbbr(id: string, lang: string = currentLang()) {
  const name = NAMES[lang]?.[id]
  if (!name) return bookById(id).abbr
  if (ABBR[lang]?.[id]) return ABBR[lang][id]
  const n = name.match(/^\d /)?.[0] ?? '', rest = name.slice(n.length)
  return rest.length > 6 ? n + rest.slice(0, 4).trim() : name
}
/** The name for a narrow spot: the full one when it's short enough. */
export const bookShort = (id: string) => { const n = bookName(id); return n.length > 10 ? bookAbbr(id) : n }

const normName = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\./g, '').replace(/^(first|1st)\s+/, '1 ')
  .replace(/^(second|2nd)\s+/, '2 ').replace(/^(third|3rd)\s+/, '3 ').replace(/\s+/g, ' ').trim()

const NAME_MAP = new Map<string, string>()
const known = (id: string, n: string, keep = false) => {
  const k = normName(n)
  if (!k) return
  for (const key of [k, k.replace(/ /g, '')]) if (!keep || !NAME_MAP.has(key)) NAME_MAP.set(key, id)
}
for (const b of BOOKS) for (const n of [b.id, b.name, b.abbr, ...b.aliases]) known(b.id, n)

// The other languages' names come with their words (public/i18n/app/<lang>.json):
// shown while the app is in that language, and understood in references
// from then on ("Johannes 3:16"), without taking a name another book has.
onLang((lang, words) => {
  if (lang === 'en' || lang === 'fr' || lang === 'es') return
  const names = words['@books'], abbr = words['@abbr']
  if (!names) return
  NAMES[lang] = names as Record<string, string>
  ABBR[lang] = (abbr ?? {}) as Record<string, string>
  for (const [id, n] of Object.entries(names)) if (BOOK_INDEX[id] !== undefined) known(id, n, true)
  for (const [id, n] of Object.entries(abbr ?? {})) if (BOOK_INDEX[id] !== undefined) known(id, n, true)
})

/** A book by its exact name, abbreviation or alias only (no guessing from
 *  a prefix), for spotting references inside ordinary writing. */
export function exactBook(input: string): string | undefined {
  const k = normName(input)
  return k ? NAME_MAP.get(k) ?? NAME_MAP.get(k.replace(/ /g, '')) : undefined
}

/** Resolve a book name or abbreviation ("1 cor", "Jn", "song of songs") to a book id. */
export function findBook(input: string): string | undefined {
  const k = normName(input)
  if (!k) return undefined
  const exact = NAME_MAP.get(k) ?? NAME_MAP.get(k.replace(/ /g, ''))
  if (exact) return exact
  // Unambiguous prefix of a full name ("revel", "phili" is ambiguous).
  const compact = k.replace(/ /g, '')
  if (compact.length < 2) return undefined
  const flat = (n: string) => normName(n).replace(/ /g, '')
  const hits = BOOKS.filter(b => flat(b.name).startsWith(compact) || flat(bookName(b.id)).startsWith(compact))
  return hits.length === 1 ? hits[0].id : undefined
}

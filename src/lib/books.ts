import { currentLang, N_ } from '../i18n'

// Canonical book order and English names/abbreviations used for navigation and
// reference parsing. Book ids match the ids used in public/data.

export interface BookInfo { id: string; name: string; abbr: string; aliases: string[]; group: Group }
export type Group = 'law' | 'history' | 'wisdom' | 'major' | 'minor' | 'gospels' | 'acts' | 'pauline' | 'general' | 'apocalypse' | 'deutero' | 'ethiopic'

const B = (id: string, name: string, abbr: string, group: Group, aliases: string[] = []): BookInfo =>
  ({ id, name, abbr, group, aliases })

export const BOOKS: BookInfo[] = [
  B('Gen', 'Genesis', 'Gen', 'law', ['gn', 'ge']),
  B('Exod', 'Exodus', 'Exod', 'law', ['ex', 'exo']),
  B('Lev', 'Leviticus', 'Lev', 'law', ['lv', 'le']),
  B('Num', 'Numbers', 'Num', 'law', ['nm', 'nu']),
  B('Deut', 'Deuteronomy', 'Deut', 'law', ['dt', 'de']),
  B('Josh', 'Joshua', 'Josh', 'history', ['jos', 'jsh']),
  B('Judg', 'Judges', 'Judg', 'history', ['jdg', 'jg', 'jdgs']),
  B('Ruth', 'Ruth', 'Ruth', 'history', ['rth', 'ru']),
  B('1Sam', '1 Samuel', '1 Sam', 'history', ['1sa', '1s', 'i samuel']),
  B('2Sam', '2 Samuel', '2 Sam', 'history', ['2sa', '2s', 'ii samuel']),
  B('1Kgs', '1 Kings', '1 Kgs', 'history', ['1ki', '1k', 'i kings']),
  B('2Kgs', '2 Kings', '2 Kgs', 'history', ['2ki', '2k', 'ii kings']),
  B('1Chr', '1 Chronicles', '1 Chr', 'history', ['1ch', 'i chronicles']),
  B('2Chr', '2 Chronicles', '2 Chr', 'history', ['2ch', 'ii chronicles']),
  B('Ezra', 'Ezra', 'Ezra', 'history', ['ezr']),
  B('Neh', 'Nehemiah', 'Neh', 'history', ['ne']),
  B('Esth', 'Esther', 'Esth', 'history', ['es', 'est']),
  B('Job', 'Job', 'Job', 'wisdom', ['jb']),
  B('Ps', 'Psalms', 'Ps', 'wisdom', ['psalm', 'psa', 'pss', 'psm']),
  B('Prov', 'Proverbs', 'Prov', 'wisdom', ['pr', 'prv', 'pro']),
  B('Eccl', 'Ecclesiastes', 'Eccl', 'wisdom', ['ec', 'ecc', 'qoh', 'qoheleth']),
  B('Song', 'Song of Solomon', 'Song', 'wisdom', ['so', 'sos', 'song of songs', 'canticles', 'sng']),
  B('Isa', 'Isaiah', 'Isa', 'major', ['is']),
  B('Jer', 'Jeremiah', 'Jer', 'major', ['je', 'jr']),
  B('Lam', 'Lamentations', 'Lam', 'major', ['la']),
  B('Ezek', 'Ezekiel', 'Ezek', 'major', ['eze', 'ezk']),
  B('Dan', 'Daniel', 'Dan', 'major', ['da', 'dn']),
  B('Hos', 'Hosea', 'Hos', 'minor', ['ho']),
  B('Joel', 'Joel', 'Joel', 'minor', ['jl']),
  B('Amos', 'Amos', 'Amos', 'minor', ['am']),
  B('Obad', 'Obadiah', 'Obad', 'minor', ['ob', 'oba']),
  B('Jonah', 'Jonah', 'Jonah', 'minor', ['jon', 'jnh']),
  B('Mic', 'Micah', 'Mic', 'minor', ['mi']),
  B('Nah', 'Nahum', 'Nah', 'minor', ['na']),
  B('Hab', 'Habakkuk', 'Hab', 'minor', ['hb']),
  B('Zeph', 'Zephaniah', 'Zeph', 'minor', ['zep', 'zp']),
  B('Hag', 'Haggai', 'Hag', 'minor', ['hg']),
  B('Zech', 'Zechariah', 'Zech', 'minor', ['zec', 'zc']),
  B('Mal', 'Malachi', 'Mal', 'minor', ['ml']),
  B('Matt', 'Matthew', 'Matt', 'gospels', ['mt', 'mat']),
  B('Mark', 'Mark', 'Mark', 'gospels', ['mk', 'mr', 'mrk']),
  B('Luke', 'Luke', 'Luke', 'gospels', ['lk', 'luk']),
  B('John', 'John', 'John', 'gospels', ['jn', 'jhn', 'joh']),
  B('Acts', 'Acts', 'Acts', 'acts', ['ac', 'act', 'actes des apotres', 'actes des apôtres']),
  B('Rom', 'Romans', 'Rom', 'pauline', ['ro', 'rm']),
  B('1Cor', '1 Corinthians', '1 Cor', 'pauline', ['1co', 'i corinthians']),
  B('2Cor', '2 Corinthians', '2 Cor', 'pauline', ['2co', 'ii corinthians']),
  B('Gal', 'Galatians', 'Gal', 'pauline', ['ga']),
  B('Eph', 'Ephesians', 'Eph', 'pauline', ['ephes']),
  B('Phil', 'Philippians', 'Phil', 'pauline', ['php', 'pp']),
  B('Col', 'Colossians', 'Col', 'pauline', ['co']),
  B('1Thess', '1 Thessalonians', '1 Thess', 'pauline', ['1th', '1thes', 'i thessalonians']),
  B('2Thess', '2 Thessalonians', '2 Thess', 'pauline', ['2th', '2thes', 'ii thessalonians']),
  B('1Tim', '1 Timothy', '1 Tim', 'pauline', ['1ti', 'i timothy']),
  B('2Tim', '2 Timothy', '2 Tim', 'pauline', ['2ti', 'ii timothy']),
  B('Titus', 'Titus', 'Titus', 'pauline', ['tit', 'ti']),
  B('Phlm', 'Philemon', 'Phlm', 'pauline', ['phm', 'philem']),
  B('Heb', 'Hebrews', 'Heb', 'general', []),
  B('Jas', 'James', 'Jas', 'general', ['jm', 'jam']),
  B('1Pet', '1 Peter', '1 Pet', 'general', ['1pe', '1pt', '1p', 'i peter']),
  B('2Pet', '2 Peter', '2 Pet', 'general', ['2pe', '2pt', '2p', 'ii peter']),
  B('1John', '1 John', '1 John', 'general', ['1jn', '1jo', '1jhn', 'i john']),
  B('2John', '2 John', '2 John', 'general', ['2jn', '2jo', '2jhn', 'ii john']),
  B('3John', '3 John', '3 John', 'general', ['3jn', '3jo', '3jhn', 'iii john']),
  B('Jude', 'Jude', 'Jude', 'general', ['jud', 'jd']),
  B('Rev', 'Revelation', 'Rev', 'apocalypse', ['re', 'rv', 'revelations', 'apocalypse']),
  B('Tob', 'Tobit', 'Tob', 'deutero', ['tb']),
  B('Jdt', 'Judith', 'Jdt', 'deutero', ['jth']),
  B('EsthGr', 'Esther (Greek)', 'Esth Gr', 'deutero', ['greek esther']),
  B('AddEsth', 'Additions to Esther', 'Add Esth', 'deutero', []),
  B('Wis', 'Wisdom', 'Wis', 'deutero', ['wisdom of solomon', 'ws']),
  B('Sir', 'Sirach', 'Sir', 'deutero', ['ecclesiasticus', 'ecclus']),
  B('Bar', 'Baruch', 'Bar', 'deutero', []),
  B('EpJer', 'Letter of Jeremiah', 'Ep Jer', 'deutero', ['epistle of jeremiah']),
  B('PrAzar', 'Prayer of Azariah', 'Pr Azar', 'deutero', []),
  B('Sus', 'Susanna', 'Sus', 'deutero', []),
  B('Bel', 'Bel and the Dragon', 'Bel', 'deutero', []),
  B('AddDan', 'Additions to Daniel', 'Add Dan', 'deutero', []),
  B('1Macc', '1 Maccabees', '1 Macc', 'deutero', ['1ma', '1mac', 'i maccabees']),
  B('2Macc', '2 Maccabees', '2 Macc', 'deutero', ['2ma', '2mac', 'ii maccabees']),
  B('3Macc', '3 Maccabees', '3 Macc', 'deutero', ['3ma', '3mac', 'iii maccabees']),
  B('4Macc', '4 Maccabees', '4 Macc', 'deutero', ['4ma', '4mac', 'iv maccabees']),
  B('1Esd', '1 Esdras', '1 Esd', 'deutero', ['i esdras']),
  B('2Esd', '2 Esdras', '2 Esd', 'deutero', ['ii esdras']),
  B('PrMan', 'Prayer of Manasseh', 'Pr Man', 'deutero', ['prayer of manasses']),
  B('AddPs', 'Psalm 151', 'Ps 151', 'deutero', []),
  B('PssSol', 'Psalms of Solomon', 'Pss Sol', 'deutero', []),
  B('Odes', 'Odes', 'Odes', 'deutero', []),
  B('1En', '1 Enoch', '1 En', 'ethiopic', ['enoch', 'henoch']),
  B('EpLao', 'Laodiceans', 'Laod', 'deutero', ['epistle to the laodiceans']),
  // Books kept by the Ethiopian Orthodox Tewahedo canon.
  B('Jub', 'Jubilees', 'Jub', 'ethiopic', ['book of jubilees', 'kufale', 'jubiles', 'livre des jubiles']),
  B('1Meq', '1 Meqabyan', '1 Meq', 'ethiopic', ['i meqabyan', 'ethiopian maccabees', '1 meqabyan']),
  B('2Meq', '2 Meqabyan', '2 Meq', 'ethiopic', ['ii meqabyan']),
  B('3Meq', '3 Meqabyan', '3 Meq', 'ethiopic', ['iii meqabyan']),
  B('4Bar', '4 Baruch', '4 Bar', 'ethiopic', ['iv baruch', 'rest of the words of baruch', 'paraleipomena jeremiou']),
]

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

// Names in French and Spanish: shown when the app is in that language, and
// understood in references whatever the language ("Jean 3:16", "Juan 3:16").
// A short form follows a name too long for a narrow button.
const FR: Record<string, string> = {
  Gen: 'Genèse', Exod: 'Exode', Lev: 'Lévitique', Num: 'Nombres', Deut: 'Deutéronome', Josh: 'Josué', Judg: 'Juges',
  Ruth: 'Ruth', '1Sam': '1 Samuel', '2Sam': '2 Samuel', '1Kgs': '1 Rois', '2Kgs': '2 Rois', '1Chr': '1 Chroniques',
  '2Chr': '2 Chroniques', Ezra: 'Esdras', Neh: 'Néhémie', Esth: 'Esther', Job: 'Job', Ps: 'Psaumes', Prov: 'Proverbes',
  Eccl: 'Ecclésiaste', Song: 'Cantique des cantiques', Isa: 'Ésaïe', Jer: 'Jérémie', Lam: 'Lamentations',
  Ezek: 'Ézéchiel', Dan: 'Daniel', Hos: 'Osée', Joel: 'Joël', Amos: 'Amos', Obad: 'Abdias', Jonah: 'Jonas', Mic: 'Michée',
  Nah: 'Nahum', Hab: 'Habacuc', Zeph: 'Sophonie', Hag: 'Aggée', Zech: 'Zacharie', Mal: 'Malachie', Matt: 'Matthieu',
  Mark: 'Marc', Luke: 'Luc', John: 'Jean', Acts: 'Actes', Rom: 'Romains', '1Cor': '1 Corinthiens',
  '2Cor': '2 Corinthiens', Gal: 'Galates', Eph: 'Éphésiens', Phil: 'Philippiens', Col: 'Colossiens',
  '1Thess': '1 Thessaloniciens', '2Thess': '2 Thessaloniciens', '1Tim': '1 Timothée', '2Tim': '2 Timothée',
  Titus: 'Tite', Phlm: 'Philémon', Heb: 'Hébreux', Jas: 'Jacques', '1Pet': '1 Pierre', '2Pet': '2 Pierre', '1John': '1 Jean',
  '2John': '2 Jean', '3John': '3 Jean', Jude: 'Jude', Rev: 'Apocalypse',
  // The books an Ethiopian or deuterocanonical edition adds.
  Tob: 'Tobie', Jdt: 'Judith', EsthGr: 'Esther (grec)', AddEsth: 'Additions à Esther', Wis: 'Sagesse',
  Sir: 'Siracide', Bar: 'Baruch', EpJer: 'Lettre de Jérémie', PrAzar: 'Prière d’Azarias', Sus: 'Suzanne',
  Bel: 'Bel et le dragon', AddDan: 'Additions à Daniel', '1Macc': '1 Maccabées', '2Macc': '2 Maccabées',
  '3Macc': '3 Maccabées', '4Macc': '4 Maccabées', '1Esd': '1 Esdras', '2Esd': '2 Esdras',
  PrMan: 'Prière de Manassé', AddPs: 'Psaume 151', PssSol: 'Psaumes de Salomon', Odes: 'Odes', '1En': 'Hénoch',
  EpLao: 'Laodicéens', Jub: 'Jubilés', '1Meq': '1 Meqabyan', '2Meq': '2 Meqabyan', '3Meq': '3 Meqabyan',
  '4Bar': '4 Baruch',
}
const ES: Record<string, string> = {
  Gen: 'Génesis', Exod: 'Éxodo', Lev: 'Levítico', Num: 'Números', Deut: 'Deuteronomio', Josh: 'Josué', Judg: 'Jueces',
  Ruth: 'Rut', '1Sam': '1 Samuel', '2Sam': '2 Samuel', '1Kgs': '1 Reyes', '2Kgs': '2 Reyes', '1Chr': '1 Crónicas',
  '2Chr': '2 Crónicas', Ezra: 'Esdras', Neh: 'Nehemías', Esth: 'Ester', Job: 'Job', Ps: 'Salmos', Prov: 'Proverbios',
  Eccl: 'Eclesiastés', Song: 'Cantares', Isa: 'Isaías', Jer: 'Jeremías', Lam: 'Lamentaciones', Ezek: 'Ezequiel',
  Dan: 'Daniel', Hos: 'Oseas', Joel: 'Joel', Amos: 'Amós', Obad: 'Abdías', Jonah: 'Jonás', Mic: 'Miqueas', Nah: 'Nahúm',
  Hab: 'Habacuc', Zeph: 'Sofonías', Hag: 'Hageo', Zech: 'Zacarías', Mal: 'Malaquías', Matt: 'Mateo', Mark: 'Marcos',
  Luke: 'Lucas', John: 'Juan', Acts: 'Hechos', Rom: 'Romanos', '1Cor': '1 Corintios', '2Cor': '2 Corintios', Gal: 'Gálatas',
  Eph: 'Efesios', Phil: 'Filipenses', Col: 'Colosenses', '1Thess': '1 Tesalonicenses', '2Thess': '2 Tesalonicenses',
  '1Tim': '1 Timoteo', '2Tim': '2 Timoteo', Titus: 'Tito', Phlm: 'Filemón', Heb: 'Hebreos', Jas: 'Santiago', '1Pet': '1 Pedro',
  '2Pet': '2 Pedro', '1John': '1 Juan', '2John': '2 Juan', '3John': '3 Juan', Jude: 'Judas', Rev: 'Apocalipsis',
  Tob: 'Tobías', Jdt: 'Judit', EsthGr: 'Ester (griego)', AddEsth: 'Adiciones a Ester', Wis: 'Sabiduría',
  Sir: 'Eclesiástico', Bar: 'Baruc', EpJer: 'Carta de Jeremías', PrAzar: 'Oración de Azarías',
  Sus: 'Susana', Bel: 'Bel y el dragón', AddDan: 'Adiciones a Daniel', '1Macc': '1 Macabeos', '2Macc': '2 Macabeos',
  '3Macc': '3 Macabeos', '4Macc': '4 Macabeos', '1Esd': '1 Esdras', '2Esd': '2 Esdras', PrMan: 'Oración de Manasés',
  AddPs: 'Salmo 151', PssSol: 'Salmos de Salomón', Odes: 'Odas', '1En': '1 Enoc', EpLao: 'Laodicenses',
  Jub: 'Jubileos', '1Meq': '1 Meqabyan', '2Meq': '2 Meqabyan', '3Meq': '3 Meqabyan', '4Bar': '4 Baruc',
}

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
  if (ABBR[lang][id]) return ABBR[lang][id]
  const n = name.match(/^\d /)?.[0] ?? '', rest = name.slice(n.length)
  return rest.length > 6 ? n + rest.slice(0, 4).trim() : name
}
/** The name for a narrow spot: the full one when it's short enough. */
export const bookShort = (id: string) => { const n = bookName(id); return n.length > 10 ? bookAbbr(id) : n }

const normName = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\./g, '').replace(/^(first|1st)\s+/, '1 ')
  .replace(/^(second|2nd)\s+/, '2 ').replace(/^(third|3rd)\s+/, '3 ').replace(/\s+/g, ' ').trim()

const NAME_MAP = new Map<string, string>()
for (const b of BOOKS) {
  for (const n of [b.id, b.name, b.abbr, ...b.aliases]) {
    const k = normName(n)
    NAME_MAP.set(k, b.id)
    NAME_MAP.set(k.replace(/ /g, ''), b.id)
  }
}

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

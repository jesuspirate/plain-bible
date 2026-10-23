// Canonical book order and English names/abbreviations used for navigation and
// reference parsing. Book ids match the ids used in public/data.

export interface BookInfo { id: string; name: string; abbr: string; aliases: string[]; group: Group }
export type Group = 'law' | 'history' | 'wisdom' | 'major' | 'minor' | 'gospels' | 'acts' | 'pauline' | 'general' | 'apocalypse' | 'deutero'

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
  B('1En', '1 Enoch', '1 En', 'deutero', ['enoch']),
  B('EpLao', 'Laodiceans', 'Laod', 'deutero', ['epistle to the laodiceans']),
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
    ot: { label: 'Old Testament', books: by((_, i) => i < 39) },
    nt: { label: 'New Testament', books: by((_, i) => i >= 39 && i < 66) },
    law: { label: 'Law (Genesis–Deuteronomy)', books: g('law') },
    history: { label: 'History (Joshua–Esther)', books: g('history') },
    wisdom: { label: 'Wisdom & Poetry (Job–Song)', books: g('wisdom') },
    prophets: { label: 'Prophets (Isaiah–Malachi)', books: g('major', 'minor') },
    major: { label: 'Major Prophets', books: g('major') },
    minor: { label: 'Minor Prophets', books: g('minor') },
    gospels: { label: 'Gospels', books: g('gospels') },
    epistles: { label: 'Epistles (Romans–Jude)', books: g('pauline', 'general') },
    pauline: { label: "Paul's letters", books: g('pauline') },
    general: { label: 'General letters (Hebrews–Jude)', books: g('general') },
    deutero: { label: 'Deuterocanon / Apocrypha', books: g('deutero') },
  }
})()
SCOPES.torah = SCOPES.law
SCOPES.poetry = SCOPES.wisdom
SCOPES.apocrypha = SCOPES.deutero

// French names, so "Jean 3:16" works as well as "John 3:16".
const FRENCH: Record<string, string> = {
  Gen: 'genèse', Exod: 'exode', Lev: 'lévitique', Num: 'nombres', Deut: 'deutéronome', Josh: 'josué', Judg: 'juges',
  '1Sam': '1 samuel', '2Sam': '2 samuel', '1Kgs': '1 rois', '2Kgs': '2 rois', '1Chr': '1 chroniques', '2Chr': '2 chroniques',
  Ezra: 'esdras', Neh: 'néhémie', Ps: 'psaumes', Prov: 'proverbes', Eccl: 'ecclésiaste', Song: 'cantique des cantiques',
  Isa: 'ésaïe', Jer: 'jérémie', Ezek: 'ézéchiel', Hos: 'osée', Obad: 'abdias', Jonah: 'jonas', Mic: 'michée',
  Hab: 'habacuc', Zeph: 'sophonie', Hag: 'aggée', Zech: 'zacharie', Mal: 'malachie', Matt: 'matthieu', Mark: 'marc',
  Luke: 'luc', John: 'jean', Acts: 'actes', Rom: 'romains', '1Cor': '1 corinthiens', '2Cor': '2 corinthiens',
  Gal: 'galates', Eph: 'éphésiens', Phil: 'philippiens', Col: 'colossiens', '1Thess': '1 thessaloniciens',
  '2Thess': '2 thessaloniciens', '1Tim': '1 timothée', '2Tim': '2 timothée', Titus: 'tite', Phlm: 'philémon',
  Heb: 'hébreux', Jas: 'jacques', '1Pet': '1 pierre', '2Pet': '2 pierre', '1John': '1 jean', '2John': '2 jean',
  '3John': '3 jean', Rev: 'apocalypse',
}
for (const [id, name] of Object.entries(FRENCH)) BOOKS[BOOKS.findIndex(b => b.id === id)].aliases.push(name)
BOOKS[BOOKS.findIndex(b => b.id === 'Ps')].aliases.push('psaume')

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
  const hits = BOOKS.filter(b => b.name.toLowerCase().replace(/ /g, '').startsWith(compact))
  return hits.length === 1 ? hits[0].id : undefined
}

import { findBook, bookAbbr, bookName } from './books'

export interface Ref { book: string; chapter: number; verse?: number; verseEnd?: number }

const NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11,
  douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20, vingts: 20, trente: 30, quarante: 40,
  cinquante: 50, soixante: 60, septante: 70, huitante: 80, octante: 80, nonante: 90,
}
const HUNDRED = new Set(['hundred', 'cent', 'cents'])
const ORDINAL: [RegExp, string][] = [
  [/^(first|1st|premier|premiere|1er|1re|1ere)\s+/, '1 '],
  [/^(second|2nd|deuxieme|seconde?|2e|2eme)\s+/, '2 '],
  [/^(third|3rd|troisieme|3e|3eme)\s+/, '3 '],
]

/** Turns a spoken or dictated reference into a written one:
 *  "Exodus chapter 3 verse three" → "exodus 3:3",
 *  "Exode chapitre trois verset deux à cinq" → "exode 3:2-5". */
export function spoken(input: string): string {
  let s = input.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[’']/g, ' ')
    .replace(/[.,;!?]+\s*$/, '').replace(/\s+/g, ' ').trim()
  s = s.replace(/^(the )?(book of|livre de|livre d|le livre de|le livre d) /, '')
  for (const [re, to] of ORDINAL) s = s.replace(re, to)
  // Number words to digits, whole runs at a time ("one hundred nineteen").
  const out: string[] = []
  let n: number | undefined
  const flush = () => { if (n !== undefined) out.push(String(n)); n = undefined }
  for (const w of s.split(/[\s-]+/)) {
    if (w in NUMBERS) {
      const v = NUMBERS[w], last = n === undefined ? -1 : n % 100
      if (n !== undefined && v === 20 && last === 4) n += 76 // quatre-vingt
      else if (n !== undefined && ((n > 0 && last === 0 && v < 100) || (last >= 10 && last % 10 === 0 && v < 10) || ((last === 60 || last === 80) && v < 20))) n += v
      else { flush(); n = v } // "three sixteen" is two numbers
      continue
    }
    if (HUNDRED.has(w)) { n = (n || 1) * 100; continue }
    if ((w === 'and' || w === 'et') && n !== undefined) continue
    flush(); out.push(w)
  }
  flush()
  s = out.join(' ')
  return s
    .replace(/\b(chapters?|chapitres?|chap|ch)\b/g, ' ')
    .replace(/\b(verses?|versets?|vv?)\b/g, ':')
    .replace(/(\d)\s*(to|through|thru|a|au|jusqu a|jusqu au)\s*(\d)/g, '$1-$3')
    .replace(/(\d)\s+:\s*/g, '$1:').replace(/\s+/g, ' ').trim()
    .replace(/(\d+) (\d+)$/, '$1:$2') // "john 3 16" 
}

/** Parse "John 3:16", "jn 3", "1 Cor 13:4-7", "Psalm 23", "Jude 3" into a
 *  reference; spoken forms like "John chapter three verse sixteen" too. */
export function parseRef(input: string): Ref | undefined {
  return parseWritten(input) ?? parseWritten(spoken(input))
}

function parseWritten(input: string): Ref | undefined {
  const m = input.trim().match(/^((?:[1-4]|i{1,3}|iv)?\s*[\p{L}][\p{L}. ]*?)\s*(\d+)?(?:\s*[:.]\s*(\d+)(?:\s*[-–]\s*(\d+))?)?$/iu)
  if (!m) return undefined
  const book = findBook(m[1])
  if (!book) return undefined
  if (!m[2]) return { book, chapter: 1 }
  const ref: Ref = { book, chapter: +m[2] }
  if (m[3]) ref.verse = +m[3]
  if (m[4]) ref.verseEnd = +m[4]
  return ref
}

export function formatRef(r: Ref, short = false): string {
  const name = short ? bookAbbr(r.book) : bookName(r.book)
  let s = `${name} ${r.chapter}`
  if (r.verse) s += `:${r.verse}`
  if (r.verseEnd && r.verseEnd !== r.verse) s += `–${r.verseEnd}`
  return s
}

/** "16–18, 20" for a sorted list of verse numbers. */
export function verseRanges(vs: number[]) {
  const out: string[] = []
  for (let i = 0; i < vs.length; i++) {
    let j = i
    while (j + 1 < vs.length && vs[j + 1] === vs[j] + 1) j++
    out.push(i === j ? `${vs[i]}` : `${vs[i]}–${vs[j]}`)
    i = j
  }
  return out.join(', ')
}

// One tap to the apps people share verses to. Each is a plain web address
// the app (or the phone) opens: no Facebook, X or WhatsApp code in the app.
//
// - Facebook takes only a link: since 2018 no app may type words into a
//   post. The post shows the link's card, so the words are also copied.
// - X and WhatsApp take the words, the reference and the link.

/** Where Facebook's link points: a small page that gives the card the verse
 *  words as its title, then sends people on (worker/src/share.ts). */
export const SHARE_ORIGIN = 'https://share.myquietbible.com'

/** The address Facebook gets: a query, not a #, since Facebook drops what
 *  follows a # (index.html turns ?r= back into the passage). */
export function cardLink(origin: string, version: string, book: string, chapter: number, first: number, last: number) {
  const vs = last > first ? `${first}-${last}` : `${first}`
  return `${origin}/?r=${[version, book, chapter, vs].map(s => encodeURIComponent(String(s))).join('/')}`
}

/** ?r=KJV/John/3/16-18 back into the shared passage (mirrors index.html). */
export function fromCardLink(r: string) {
  const [version, book, chapter, vs] = r.split('/').map(decodeURIComponent)
  const [v, e] = (vs ?? '').split('-').map(Number)
  if (!version || !book || !(+chapter > 0) || !(v > 0)) return undefined
  return `read/${version}/${book}/${+chapter}?v=${v}${e > v ? `&e=${e}` : ''}&shared=1`
}

export function facebookUrl(link: string) {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`
}

/** X counts a link as 23 and wide letters (Chinese, Japanese, Korean) as two,
 *  up to 280, and adds " via @myquietbible". Long passages are cut to fit. */
export function xUrl(words: string, ref: string, link: string) {
  const room = 280 - 23 - 18 - weight(ref) - 4
  return `https://x.com/intent/post?text=${encodeURIComponent(`${clip(words, room)}\n${ref}`)}&url=${encodeURIComponent(link)}&via=myquietbible`
}

export function whatsappUrl(words: string, ref: string, link: string) {
  return `https://wa.me/?text=${encodeURIComponent(`${words}\n${ref}\n${link}`)}`
}

const wide = (ch: string) => (ch.codePointAt(0) ?? 0) >= 0x1100 ? 2 : 1
const weight = (s: string) => [...s].reduce((n, ch) => n + wide(ch), 0)

/** Cut at a space (if there's one near the end), with an ellipsis. */
export function clip(s: string, room: number) {
  if (weight(s) <= room) return s
  let out = '', n = 0
  for (const ch of s) { if (n + wide(ch) > room - 1) break; out += ch; n += wide(ch) }
  const space = out.lastIndexOf(' ')
  return (space > out.length * .7 ? out.slice(0, space) : out).replace(/[\s,;:.]+$/, '') + '…'
}

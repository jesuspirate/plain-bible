// Verse pictures for shared links' cards. On a Mac or computer, the app draws
// the verse as a wide picture and sends it here once; the share page
// (share.ts) names it as the link's picture, so Facebook, X and WhatsApp show
// the verse itself. Nothing is drawn here: the free plan's few milliseconds
// per request are far too few to draw a picture, but plenty to keep one.
//
// A picture is named by its own fingerprint, so a link always shows the very
// picture its sharer sent: nobody can put another picture in its place.

export const CARD_W = 1200
export const CARD_H = 630
export const CARD_MAX = 600_000
export const CARD_ID = /^[a-f0-9]{32}$/

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** A PNG of exactly the card's size (read from its header), not too big. */
export function isCard(b: Uint8Array) {
  if (b.length < 33 || b.length > CARD_MAX) return false
  if (!SIG.every((x, i) => b[i] === x)) return false
  // The first chunk is IHDR: width and height, 4 bytes each.
  if (String.fromCharCode(...b.slice(12, 16)) !== 'IHDR') return false
  const v = new DataView(b.buffer, b.byteOffset)
  return v.getUint32(16) === CARD_W && v.getUint32(20) === CARD_H
}

/** The picture's name: the start of its SHA-256, in hex. */
export async function cardId(b: Uint8Array) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', b))
  return [...h.slice(0, 16)].map(x => x.toString(16).padStart(2, '0')).join('')
}

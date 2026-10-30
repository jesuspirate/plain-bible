// The little bar over words picked with a mouse: where it goes, and which
// verses the words are in.

export interface Box { top: number; bottom: number; left: number; width: number }

/** Just above the first line of the words, centred on it, kept on screen. If
 *  there's no room above (under the top bar) it goes just below the last line. */
export function placeBar(first: Box, last: Box, size: { w: number; h: number }, screen: { w: number; top: number }, gap = 10) {
  const x = Math.round(Math.min(Math.max(first.left + first.width / 2 - size.w / 2, 12), screen.w - size.w - 12))
  const above = first.top - size.h - gap
  return above >= screen.top + 8 ? { x, y: Math.round(above), below: false } : { x, y: Math.round(last.bottom + gap), below: true }
}

/** The verse numbers in element ids like "v16", in order, once each. */
export function versesOf(ids: string[]): number[] {
  const out = new Set<number>()
  for (const id of ids) { const m = /^v(\d+)$/.exec(id); if (m) out.add(+m[1]) }
  return [...out].sort((a, b) => a - b)
}

/** Picked text as a reader would quote it: one line, no doubled spaces. */
export function tidyWords(s: string) {
  return s.replace(/\s+/g, ' ').trim()
}

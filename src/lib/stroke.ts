// Highlighting with a pen (Apple Pencil, S Pen, a pen screen or a drawing
// tablet): the color follows the pen across the words, as slowly as you draw,
// and stays on just the words you crossed. Fingers and the mouse still scroll
// and tap as before.
//
// A highlight on part of a verse keeps the letters it covers, counted in the
// verse's text in the version it was made in (`r` on the mark, next to `v`).
// In another version the whole verse shows highlighted, as before.

export type Span = [number, number]

/** Grow a span out to whole words, so a pen that starts or stops in the
 *  middle of a word still takes the whole word. */
export function toWords(text: string, a: number, b: number): Span {
  if (a > b) [a, b] = [b, a]
  a = Math.max(0, Math.min(a, text.length)); b = Math.max(0, Math.min(b, text.length))
  const word = (ch: string | undefined) => !!ch && !/\s/.test(ch)
  // Skip the spaces the pen started or stopped on.
  while (a < b && !word(text[a])) a++
  while (b > a && !word(text[b - 1])) b--
  while (a > 0 && word(text[a - 1])) a--
  while (b < text.length && word(text[b])) b++
  return [a, b]
}

/** Add a span to the ones a verse has, joining any that touch or overlap
 *  (or are only a space apart). */
export function addSpan(spans: Span[] | undefined, s: Span, text: string): Span[] {
  const all = [...(spans ?? []), s].sort((x, y) => x[0] - y[0])
  const out: Span[] = []
  for (const x of all) {
    const last = out[out.length - 1]
    if (last && !/\S/.test(text.slice(last[1], x[0]))) last[1] = Math.max(last[1], x[1])
    else out.push([x[0], x[1]])
  }
  return out
}

/** Whether these spans cover every word of the verse (then it's just a
 *  highlighted verse). */
export function coversAll(spans: Span[], text: string): boolean {
  const first = text.search(/\S/), last = text.trimEnd().length
  return first < 0 || spans.some(([a, b]) => a <= first && b >= last)
}

/** The text a verse's words are counted in: every letter inside its `.vt`,
 *  leaving out Strong's numbers. */
export function textNodes(vt: Element): Text[] {
  const out: Text[] = []
  const walk = document.createTreeWalker(vt, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.parentElement?.closest('.sn') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n as Text)
  return out
}

/** Where a point in the page falls in a verse's words. */
export function offsetIn(vt: Element, node: Node, offset: number): number {
  let n = 0
  for (const t of textNodes(vt)) {
    if (t === node) return n + offset
    if (node.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING) return n
    n += t.length
  }
  return n
}

/** The letter under a point on the screen. */
export function caretAt(x: number, y: number): { node: Node; offset: number } | undefined {
  const d = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y)
    return p ? { node: p.offsetNode, offset: p.offset } : undefined
  }
  const r = document.caretRangeFromPoint?.(x, y)
  return r ? { node: r.startContainer, offset: r.startOffset } : undefined
}

/** A DOM range over these letters of a verse. */
export function rangeOf(vt: Element, a: number, b: number): Range {
  const r = document.createRange()
  let n = 0, started = false
  const nodes = textNodes(vt)
  r.selectNodeContents(vt)
  for (const t of nodes) {
    if (!started && a <= n + t.length) { r.setStart(t, Math.max(0, a - n)); started = true }
    if (b <= n + t.length) { r.setEnd(t, Math.max(0, b - n)); break }
    n += t.length
  }
  return r
}

// A highlight drawn in slowly, the way a hand draws a marker over the words:
// line by line, at the pace of careful reading, so the mind can follow the
// words as the color reaches them, with a pause between lines.
// It's only paint: the mark is saved the moment you pick the color, and the
// verse looks exactly as it always does once the pen is done.
//
// Each line gets a little strip of ink laid behind the words, the same size,
// color and corners as the highlight itself, and the strip is uncovered from
// the start of the line to its end. When the last strip is done they all go
// and the verse's own highlight takes over, so nothing moves or flickers.

/** Verses (mark keys) whose new highlight is waiting to be drawn. */
const waiting = new Set<string>()
/** Verses being drawn right now. */
const busy = new Set<string>()

/** Ask for these verses' new highlight to be drawn in. */
export function penDown(keys: string[]) { for (const k of keys) waiting.add(k) }
/** Whether this verse's highlight is still being drawn (or about to be). */
export const penOn = (key: string) => waiting.has(key) || busy.has(key)
/** The verses waiting, taken off the waiting list. */
export function takeWaiting(): string[] { const out = [...waiting]; waiting.clear(); penHold(out); return out }
/** Mark these verses as being drawn. */
export function penHold(keys: string[]) { for (const k of keys) busy.add(k) }
export function penUp(keys: string[]) { for (const k of keys) { busy.delete(k); waiting.delete(k) } }

/** Slow on purpose: about three words a second, the pace of reading aloud
 *  carefully (a word with its space is about 2.6 letters' height wide)… */
const PER_EM = 125 // ms for each em of line
/** …a pause as the eye goes back to the start of the next line… */
const LIFT = 380
/** …and a long passage still ends within a minute and a half. */
const LONGEST = 90000
const SHORTEST_LINE = 500
/** While reading aloud the eye is following the voice: a highlight is a
 *  quick swipe instead, the whole verse in under half a second. */
export const QUICK = 450

export type PenStyle = 'marker' | 'block' | 'text'

/** Draw in the highlight on these verse elements, one after another, inside
 *  `layer` (an element with position: relative that holds them). Each verse
 *  element should carry the class hl-draw, which hides its own highlight
 *  until the pen is done. Returns a function that stops it at once.
 *  `longest` caps the whole drawing, in milliseconds. */
export function draw(verses: HTMLElement[], style: PenStyle, layer: HTMLElement, done: () => void, longest = LONGEST): () => void {
  const box = layer.getBoundingClientRect()
  const strips: { el: HTMLElement; ems: number; rtl: boolean }[] = []  // ems: the length of line it covers
  for (const verse of verses) {
    const parts = style === 'block'
      ? (verse.matches('.pv') ? [verse] : [...verse.querySelectorAll<HTMLElement>('.cell')])
      : [...verse.querySelectorAll<HTMLElement>('.vt')]
    for (const part of parts) {
      const css = getComputedStyle(part), fs = parseFloat(css.fontSize) || 18
      const radius = style === 'text' ? '0' : css.borderTopLeftRadius
      const rtl = css.direction === 'rtl'
      const whole = style === 'block' && !part.matches('.pv')
      const rects = whole ? [part.getBoundingClientRect()] : [...part.getClientRects()]
      // A whole block is wiped across as slowly as its lines would be drawn.
      const lines = whole ? Math.max(1, Math.round(rects[0].height / (parseFloat(css.lineHeight) || fs * 1.6))) : 1
      for (const r of rects) {
        if (r.width < 2) continue
        const el = inkStrip(r, layer, box, verse.style.getPropertyValue('--hl'), style, fs, radius)
        strips.push({ el, ems: r.width * lines / fs, rtl })
      }
    }
  }
  if (!strips.length || typeof strips[0].el.animate !== 'function') { done(); return () => {} }

  const time = (ems: number) => Math.max(SHORTEST_LINE, ems * PER_EM)
  const total = strips.reduce((n, s) => n + time(s.ems) + LIFT, -LIFT)
  const k = Math.min(1, longest / total)
  let at = 0, finished = false
  const anims: Animation[] = []
  for (const s of strips) {
    layer.appendChild(s.el)
    const d = time(s.ems) * k
    // Uncovered from where the line starts to where it ends, with a rounded
    // front edge like the tip of a marker.
    const from = s.rtl ? 'inset(0 0 0 100% round .3em)' : 'inset(0 100% 0 0 round .3em)'
    anims.push(s.el.animate([{ clipPath: from }, { clipPath: 'inset(0 0 0 0 round .3em)' }],
      { duration: d, delay: at, easing: 'cubic-bezier(.35,0,.65,1)', fill: 'both' }))
    at += d + LIFT * k
  }
  const end = () => {
    if (finished) return
    finished = true
    for (const v of verses) v.classList.remove('hl-draw')
    for (const s of strips) s.el.remove()
    done()
  }
  anims[anims.length - 1].onfinish = end
  return () => { for (const a of anims) a.cancel(); end() }
}

/** A strip of ink over one line's rectangle, placed inside `layer` (whose
 *  bounding box is `box`), the same look as a highlight of that style. */
export function inkStrip(r: DOMRect, layer: HTMLElement, box: DOMRect, color: string, style: PenStyle, fs: number, radius = '.3em'): HTMLElement {
  const el = document.createElement('span')
  el.className = 'hl pen-ink' + (style === 'text' ? ' pen-line' : '')
  el.setAttribute('aria-hidden', 'true')
  el.style.setProperty('--hl', color)
  // The underline sits a little below the letters.
  const top = style === 'text' ? r.bottom - .05 * fs : r.top
  const height = style === 'text' ? .16 * fs : r.height
  Object.assign(el.style, {
    left: r.left - box.left - layer.clientLeft + 'px', top: top - box.top - layer.clientTop + 'px',
    width: r.width + 'px', height: height + 'px', borderRadius: style === 'text' ? '0' : radius,
  })
  return el
}

/** Whether to draw at all: the setting, unless the device asks for less motion. */
export const penAllowed = (on: boolean) => on && !matchMedia('(prefers-reduced-motion: reduce)').matches

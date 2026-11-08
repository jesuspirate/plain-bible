// A highlight drawn in slowly, the way a hand draws a marker over the words:
// line by line, at an easy pace, with a short lift of the pen between lines.
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
export function takeWaiting(): string[] { const out = [...waiting]; waiting.clear(); for (const k of out) busy.add(k); return out }
export function penUp(keys: string[]) { for (const k of keys) { busy.delete(k); waiting.delete(k) } }

/** A comfortable hand: about half a phone line a second… */
const SPEED = .45 // px per ms
/** …a short lift of the pen to the next line… */
const LIFT = 110
/** …and never so slow that a long passage keeps you waiting. */
const LONGEST = 6000
const SHORTEST_LINE = 260

export type PenStyle = 'marker' | 'block' | 'text'

/** Draw in the highlight on these verse elements, one after another, inside
 *  `layer` (an element with position: relative that holds them). Each verse
 *  element should carry the class hl-draw, which hides its own highlight
 *  until the pen is done. Returns a function that stops it at once. */
export function draw(verses: HTMLElement[], style: PenStyle, layer: HTMLElement, done: () => void): () => void {
  const box = layer.getBoundingClientRect()
  const strips: { el: HTMLElement; w: number; rtl: boolean }[] = []  // w: the length of line it covers
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
        const el = document.createElement('span')
        el.className = 'hl pen-ink' + (style === 'text' ? ' pen-line' : '')
        el.setAttribute('aria-hidden', 'true')
        el.style.setProperty('--hl', verse.style.getPropertyValue('--hl'))
        // The underline sits a little below the letters.
        const top = style === 'text' ? r.bottom - .05 * fs : r.top
        const height = style === 'text' ? .16 * fs : r.height
        Object.assign(el.style, {
          left: r.left - box.left - layer.clientLeft + 'px', top: top - box.top - layer.clientTop + 'px',
          width: r.width + 'px', height: height + 'px', borderRadius: radius,
        })
        strips.push({ el, w: r.width * lines, rtl })
      }
    }
  }
  if (!strips.length || typeof strips[0].el.animate !== 'function') { done(); return () => {} }

  const time = (w: number) => Math.max(SHORTEST_LINE, w / SPEED)
  const total = strips.reduce((n, s) => n + time(s.w) + LIFT, -LIFT)
  const k = Math.min(1, LONGEST / total)
  let at = 0, finished = false
  const anims: Animation[] = []
  for (const s of strips) {
    layer.appendChild(s.el)
    const d = time(s.w) * k
    // Uncovered from where the line starts to where it ends, with a rounded
    // front edge like the tip of a marker.
    const from = s.rtl ? 'inset(0 0 0 100% round .3em)' : 'inset(0 100% 0 0 round .3em)'
    anims.push(s.el.animate([{ clipPath: from }, { clipPath: 'inset(0 0 0 0 round .3em)' }],
      { duration: d, delay: at, easing: 'cubic-bezier(.3,.1,.55,1)', fill: 'both' }))
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

/** Whether to draw at all: the setting, unless the device asks for less motion. */
export const penAllowed = (on: boolean) => on && !matchMedia('(prefers-reduced-motion: reduce)').matches

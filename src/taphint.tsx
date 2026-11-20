// Tap hints: show a gesture instead of describing it, on the real thing.
// The tour's soft fingertip (Gesture, src/gesture.tsx; an arrow with a mouse)
// taps an element, with a short label beside it. One element after another:
// a verse, then the buttons on its bar. It never blocks the page: touches go
// straight through, so the person does the real gesture, and it all goes at
// their first touch anywhere (or once the steps are shown).
//
//   showTapHints([{ el: verse, label: t('Tap a verse'), times: 3 }])
//
// Used by Audio in Settings (Try it now).
import { render } from 'preact'
import { Gesture, GESTURE_MS, stillMotion } from './gesture'

export type TapStep = { el: Element; label: string; times?: number }

let stopCurrent: (() => void) | undefined

/** Where the fingertip lands: the middle of a button, or a little way into
 *  the first line of a block of words. */
function spot(el: Element) {
  const r = el.getBoundingClientRect()
  return r.height < 90
    ? { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    : { x: Math.min(r.left + Math.min(70, r.width / 2), innerWidth - 40), y: r.top + Math.min(18, r.height / 2) }
}

/** The label above the fingertip (below it near the top of the screen), kept
 *  on screen. */
function Label({ x, y, text }: { x: number; y: number; text: string }) {
  const below = y < 130
  return <span class="tap-label" role="status" ref={el => {
    if (!el) return
    const w = el.offsetWidth
    el.style.left = Math.max(12, Math.min(innerWidth - w - 12, x - w / 2)) + 'px'
  }} style={below ? { top: `${y + 34}px` } : { top: `${y - 34}px`, transform: 'translateY(-100%)' }}>{text}</span>
}

/** Show the steps one after another. Returns a function that ends them. */
export function showTapHints(steps: TapStep[]): () => void {
  stopCurrent?.()
  const box = document.createElement('div')
  box.className = 'tap-hint'
  document.body.appendChild(box)
  let i = 0, n = 0, timer = 0, alive = true
  const end = () => {
    if (!alive) return
    alive = false
    if (stopCurrent === end) stopCurrent = undefined
    clearTimeout(timer)
    removeEventListener('pointerdown', end, true)
    removeEventListener('wheel', end, true)
    box.classList.add('going')
    setTimeout(() => { render(null, box); box.remove() }, 250)
  }
  const next = () => {
    if (!alive) return
    const step = steps[i]
    if (!step || !step.el.isConnected) { end(); return }
    const { x, y } = spot(step.el)
    render(<><Gesture key={`${i}-${n}`} kind="tap" x={x} y={y} /><Label x={x} y={y} text={step.label} /></>, box)
    if (++n >= (step.times ?? 1)) { i++; n = 0 }
    timer = window.setTimeout(next, stillMotion() ? 2600 : GESTURE_MS)
  }
  stopCurrent = end
  next()
  // A moment's grace, so the tap that asked for the hint doesn't end it.
  setTimeout(() => { if (alive) { addEventListener('pointerdown', end, true); addEventListener('wheel', end, true) } }, 300)
  return end
}

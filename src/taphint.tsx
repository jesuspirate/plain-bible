// TapHint: show a gesture instead of describing it. A finger taps a spot on
// the page (a verse, a button) and a short label says what to do, e.g.
// « Toucher un verset ». It never blocks the page: touches go straight
// through, so the person does the real gesture on the real thing, and the
// hint goes at their first touch anywhere (or after a while).
//
//   const hide = showTapHint(el, t('Tap a verse'))
//
// Used by Audio in Settings (Try it now); made to be reused by the tour.
import { render } from 'preact'

/** A pointing finger, as on the Audio page's first step and in the hint. */
export const FingerIcon = ({ size = 24, class: c }: { size?: number; class?: string }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} class={c} aria-hidden="true">
    <path d="M9 11.5V4.6a1.6 1.6 0 0 1 3.2 0v5.6m0-1.2a1.6 1.6 0 0 1 3.2 0v1.8m0-.6a1.6 1.6 0 0 1 3.2 0v4.6c0 3.6-2.5 6.7-6.2 6.7h-.7c-2 0-3.4-.8-4.5-2.3l-3-4.1a1.6 1.6 0 0 1 2.4-2.1L9 15.4"
      fill="var(--surface, #fff)" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
)

let current: (() => void) | undefined

/** Show the tapping finger on `el` (near the start of its first line) with
 *  `label` beside it. Returns a function that takes it away. One at a time. */
export function showTapHint(el: Element, label: string, ms = 8000): () => void {
  current?.()
  const r = el.getBoundingClientRect()
  const box = document.createElement('div')
  box.className = 'tap-hint'
  // The finger's tip lands a little way into the first line.
  const x = Math.min(r.left + Math.min(70, r.width / 2), innerWidth - 40), y = r.top + Math.min(18, r.height / 2)
  box.style.left = x + 'px'
  box.style.top = y + 'px'
  // The label sits above the finger, or below it near the top of the screen.
  if (y < 120) box.classList.add('below')
  document.body.appendChild(box)
  render(<>
    <span class="tap-ring" /><span class="tap-ring late" />
    <FingerIcon size={34} class="tap-finger" />
    <span class="tap-label" role="status">{label}</span>
  </>, box)
  let timer = 0
  const hide = () => {
    if (current !== hide) return
    current = undefined
    clearTimeout(timer)
    removeEventListener('pointerdown', hide, true)
    removeEventListener('scroll', hide, true)
    box.classList.add('going')
    setTimeout(() => { render(null, box); box.remove() }, 200)
  }
  current = hide
  timer = window.setTimeout(hide, ms)
  // A moment's grace, so the tap that asked for the hint doesn't end it.
  setTimeout(() => { if (current === hide) { addEventListener('pointerdown', hide, true); addEventListener('scroll', hide, true) } }, 300)
  return hide
}

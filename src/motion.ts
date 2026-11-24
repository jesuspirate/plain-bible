// Quiet motion: one way for things to come and go.
//
// Opening is plain CSS (the `quiet-in` animation in styles.css). Closing needs
// one small trick, because Preact takes an element away at once: just before it
// goes, a copy of it is left in its place, which fades out on its own and is
// then removed. The app itself has already moved on, so no tap ever waits for
// it, and the copy can't be touched. Nothing here runs at startup.
import { useCallback, useRef } from 'preact/hooks'
import type { Ref } from 'preact'

export const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** Set on a card that has already slid itself away (Settings, prayer, Circles:
 *  see slideAway). It leaves no fading copy: it is gone already. */
export const AWAY_ATTR = 'data-away'

/** Leave a fading copy of `el` where it is now. `fade` only fades (for things
 *  that fill the screen); otherwise it also sinks a little, as it came. */
export function ghostOut(el: Element | null | undefined, how: 'fade' | 'sink' = 'sink', dim?: string) {
  if (!(el instanceof HTMLElement) || !el.isConnected || still() || el.hasAttribute(AWAY_ATTR)) return
  const r = el.getBoundingClientRect()
  // Already gone or slid off screen (Settings slides itself away): nothing to fade.
  if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return
  const z = getComputedStyle(el).zIndex
  const c = el.cloneNode(true) as HTMLElement
  for (const n of [c, ...c.querySelectorAll('[id]')]) n.removeAttribute('id')
  // A card inside that slid itself away stays away in the copy too.
  for (const n of c.querySelectorAll<HTMLElement>(`[${AWAY_ATTR}]`)) n.style.visibility = 'hidden'
  c.setAttribute('aria-hidden', 'true')
  c.setAttribute('inert', '')
  if (c instanceof HTMLDialogElement) c.setAttribute('open', '')
  const s = c.style
  s.position = 'fixed'; s.left = r.left + 'px'; s.top = r.top + 'px'; s.right = 'auto'; s.bottom = 'auto'
  s.width = r.width + 'px'; s.height = r.height + 'px'; s.maxWidth = 'none'; s.maxHeight = 'none'
  s.margin = '0'; s.transform = 'none'; s.pointerEvents = 'none'
  s.zIndex = c instanceof HTMLDialogElement ? '1000' : z === 'auto' ? '50' : z
  c.classList.add('ghost-out', how === 'fade' ? 'ghost-fade' : 'ghost-sink')
  const shade = dim ? document.createElement('div') : null
  if (shade) { shade.className = 'ghost-out ghost-fade ghost-dim'; shade.style.background = dim!; document.body.appendChild(shade) }
  document.body.appendChild(c)
  // Keep what was scrolled into view (a long card, the Settings page).
  if (el.scrollTop) c.scrollTop = el.scrollTop
  const from = el.querySelectorAll('*'), to = c.querySelectorAll('*')
  for (let i = 0; i < from.length; i++) if (from[i].scrollTop) to[i].scrollTop = from[i].scrollTop
  let gone = false
  const done = () => { if (gone) return; gone = true; c.remove(); shade?.remove() }
  c.addEventListener('animationend', e => { if (e.target === c) done() })
  setTimeout(done, 700)
}

/** A ref that leaves a fading copy behind when its element is taken away.
 *  Pass the element's own ref (if it has one) to keep it working. The ref
 *  keeps one identity, so Preact hands it null only when the element goes. */
export function useLeave<T extends HTMLElement>(inner?: Ref<T> | null, how: 'fade' | 'sink' = 'sink') {
  const cur = useRef<T | null>(null)
  return useCallback((el: T | null) => {
    if (typeof inner === 'function') inner(el)
    else if (inner) (inner as { current: T | null }).current = el
    if (!el) ghostOut(cur.current, how)
    cur.current = el
  }, [])
}

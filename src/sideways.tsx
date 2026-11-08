import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { overlayOpen } from './lib/overlay'
import { t } from './i18n'

/** What can slide away while you read with the phone on its side. */
export type Away = 'top' | 'search' | 'pray'
export const AWAY: Away[] = ['top', 'search', 'pray']

/** A phone on its side: short and wide, with a finger, not a mouse. iPads
 *  and computers are never this short, so they keep their bars. */
export const SIDEWAYS = '(orientation: landscape) and (max-height: 500px) and (hover: none)'

/** How far you scroll before the bars go or come back. Down a little hides
 *  them; back up a bit more brings them back, so a small nudge to reread a
 *  line doesn't. */
const DOWN = 24, UP = 70

/** Decide, from one step of scrolling, whether the bars should be away.
 *  `moved` is how far you've gone in the same direction so far. */
export function step(away: boolean, y: number, dy: number, moved: number, view: number, page: number): { away: boolean; moved: number } {
  // A jump (a new chapter, a search result, a link) isn't you reading on.
  if (Math.abs(dy) > view * .8) return { away, moved: 0 }
  moved = dy === 0 ? moved : Math.sign(dy) === Math.sign(moved) ? moved + dy : dy
  // At the end of the chapter they come back, with Next and search.
  if (y + view >= page - 4) return { away: false, moved }
  if (moved > DOWN && y > 40) return { away: true, moved }
  if (moved < -UP) return { away: false, moved }
  return { away, moved }
}

/** On the reader with the phone on its side, the bars you picked in Settings
 *  slide away as you read on, so the words fill the screen. Scrolling back
 *  up, or a tap on the top edge (or on the top bar, if it stays), brings
 *  them back. */
export function useSideways(reading: boolean, hide: Away[]) {
  const [sideways, setSideways] = useState(() => matchMedia(SIDEWAYS).matches)
  const [away, setAwayState] = useState(false)
  const now = useRef(false)
  const setAway = (a: boolean) => { if (a !== now.current) { now.current = a; setAwayState(a) } }
  useEffect(() => {
    const mq = matchMedia(SIDEWAYS)
    const on = () => setSideways(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const active = reading && sideways && hide.length > 0

  useEffect(() => {
    if (!active) { setAway(false); return }
    let last = scrollY, moved = 0, still = 0
    const onScroll = () => {
      const y = scrollY, dy = y - last
      last = y
      // While something is open over the page, or just after a jump, the
      // scrolling isn't yours.
      if (Date.now() < still || overlayOpen() || document.body.classList.contains('selecting')) { moved = 0; return }
      const r = step(now.current, y, dy, moved, innerHeight, document.documentElement.scrollHeight)
      moved = r.moved
      setAway(r.away)
    }
    const jumped = () => { still = Date.now() + 600; moved = 0 }
    // With the top bar kept, a tap on it brings the rest back.
    const tapTop = (e: Event) => { if ((e.target as Element).closest?.('header.top')) setAway(false) }
    addEventListener('scroll', onScroll, { passive: true })
    addEventListener('hashchange', jumped)
    addEventListener('pointerdown', tapTop, { passive: true })
    return () => { removeEventListener('scroll', onScroll); removeEventListener('hashchange', jumped); removeEventListener('pointerdown', tapTop); setAway(false) }
  }, [active])

  // Before the paint, so the bars move in the same frame as the decision.
  useLayoutEffect(() => {
    const root = document.documentElement
    for (const a of AWAY) root.classList.toggle('away-' + a, active && away && hide.includes(a))
  }, [active, away, hide.join()])

  // Nothing to tap when the top bar stays or nothing is away.
  return active && away && hide.includes('top') ? <AwayEdge onShow={() => setAway(false)} /> : null
}

// The top edge, where the bar was: a faint line shows where to tap.
function AwayEdge({ onShow }: { onShow: () => void }) {
  return <button type="button" class="away-edge" aria-label={t('Show the bars')} onClick={onShow}><span aria-hidden="true" /></button>
}

// A soft hint of a gesture: a faint fingertip (or, with a mouse, the arrow)
// that taps, taps twice, holds, swipes or pulls once over the real thing,
// then fades away. Calm on purpose: slow, small, no bounce. With reduced
// motion it just rests where the gesture goes. Used by the guided tour.
import './gesture.css'

export type Kind = 'tap' | 'double' | 'triple' | 'hold' | 'swipe' | 'swipe2' | 'pull'

/** A mouse or trackpad, not a finger: click, not tap. */
export const fine = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches
export const stillMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** How long one showing of a gesture lasts, in ms (the CSS keeps to it). */
export const GESTURE_MS = 3200

const Arrow = () => (
  <svg class="g-arrow" width="26" height="30" viewBox="0 0 26 30" aria-hidden="true">
    <path d="M3 2.5v22l5.6-5.2 3.9 8.6 3.6-1.6-3.9-8.4h7.6z" fill="#fff" stroke="#111" stroke-width="1.8" stroke-linejoin="round" />
  </svg>
)

/** One gesture at (x, y) on the page. dx: how far a swipe goes (to the left);
 *  dy: how far a pull goes (down). */
export function Gesture({ kind, x, y, dx = 160, dy = 70 }: { kind: Kind; x: number; y: number; dx?: number; dy?: number }) {
  const pointer = fine && kind !== 'swipe' && kind !== 'swipe2' && kind !== 'pull'
  const rings = kind === 'double' ? 2 : kind === 'triple' ? 3 : 1
  return (
    <div class={`gesture g-${kind}${pointer ? ' g-pointer' : ''}`} aria-hidden="true"
      style={{ left: `${x}px`, top: `${y}px`, '--dx': `${-dx}px`, '--dy': `${dy}px` }}>
      {Array.from({ length: rings }, (_, i) => <span class={'g-ring g-ring' + i} />)}
      {kind === 'swipe2' ? <><span class="g-dot g-two" /><span class="g-dot g-two g-two-b" /></> : pointer ? <Arrow /> : <span class="g-dot" />}
    </div>
  )
}

/** The same gestures, drawn small and still, to sit beside a line of words. */
export function Glyph({ kind }: { kind: Kind }) {
  const ring = (r: number, w = 1.6) => <circle cx="14" cy="14" r={r} fill="none" stroke="currentColor" stroke-width={w} opacity=".55" />
  return (
    <svg class="g-glyph" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      {fine && (kind === 'tap' || kind === 'double' || kind === 'triple' || kind === 'hold')
        ? <>
            <path d="M9 5v15l3.8-3.5 2.7 5.9 2.5-1.1-2.7-5.8h5.2z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
            {kind === 'triple' && <path d="M5 4.5l-2-2M3.5 9H1M8 2.5V0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />}
          </>
        : <>
            {kind === 'pull'
              ? <><circle cx="14" cy="9" r="5" fill="currentColor" /><path d="M14 16v9m-4-4 4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></>
              : kind === 'swipe' || kind === 'swipe2'
                ? <><circle cx="19" cy="14" r="5" fill="currentColor" /><path d="M11 14H2m4-4-4 4 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></>
                : <><circle cx="14" cy="14" r="5" fill="currentColor" />
                    {kind === 'hold' ? ring(10, 3) : ring(9)}
                    {kind === 'double' && ring(12.5)}</>}
          </>}
    </svg>
  )
}

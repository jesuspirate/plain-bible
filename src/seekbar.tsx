import { useEffect, useRef, useState } from 'preact/hooks'
import { duration } from './lib/prayers'
import { t } from './i18n'
import './seekbar.css'

/** Where you are in a recording: drag anywhere along it to go there.
 *  Time gone on the left, time left on the right.
 *  `live`, while it plays: where the sound is right now, so the knob glides
 *  instead of stepping (only while playing and on screen; the browser stops
 *  the frames when the app is in the background or the screen is off). */
export function SeekBar({ pos, total, onSeek, live }: { pos: number; total: number; onSeek: (ms: number) => void; live?: () => number }) {
  // While a finger is on it, the bar follows the finger, not the sound.
  const heldRef = useRef<number>()
  const [, redraw] = useState(0)
  const setHeld = (v?: number) => { heldRef.current = v; redraw(n => n + 1) }
  const held = heldRef.current
  const input = useRef<HTMLInputElement>(null)
  const at = Math.max(0, Math.min(total, held ?? pos))
  const fill = total ? (at / total) * 100 : 0
  useEffect(() => {
    if (!live || !total) return
    let frame = 0
    const step = () => {
      const el = input.current
      if (el && heldRef.current === undefined) {
        const now = Math.max(0, Math.min(total, live()))
        el.value = String(now)
        el.style.setProperty('--fill', `${(now / total) * 100}%`)
      }
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [live, total])
  // Listened to directly, not with onInput/onChange: once preact/compat is
  // loaded, onChange on an input means every move, and the two raced, leaving
  // the bar held where the finger let go while the sound went on.
  const seekRef = useRef(onSeek)
  seekRef.current = onSeek
  useEffect(() => {
    const el = input.current
    if (!el) return
    const move = () => setHeld(+el.value)
    const done = () => { const v = +el.value; setHeld(undefined); seekRef.current(v) }
    el.addEventListener('input', move)
    el.addEventListener('change', done)
    return () => { el.removeEventListener('input', move); el.removeEventListener('change', done) }
  }, [])
  return (
    <div class="seek">
      <input ref={input} type="range" min={0} max={Math.max(1, Math.round(total))} step="any" value={at}
        style={{ '--fill': `${fill}%` }}
        aria-label={t('Prayer')} aria-valuetext={`${duration(at)} / ${duration(total)}`}
        onKeyDown={e => {
          // Arrow keys: 5 seconds a press.
          const by = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 5000 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -5000 : 0
          if (by) { e.preventDefault(); onSeek(Math.max(0, Math.min(total, at + by))) }
        }} />
      <span class="seek-times" aria-hidden="true"><span>{duration(at)}</span><span>−{duration(total - at)}</span></span>
    </div>
  )
}

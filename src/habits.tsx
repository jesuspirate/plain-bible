// The first part of the guided tour: read, pray, share, repeat, without a
// word to read. Each step dims the page and lights one real button of the
// bottom bar, with a soft fingertip tapping it; you tap it yourself to go on,
// so the thumb learns the move. Then the three go round together: repeat.
// A ✓ ends it, and a small "More" opens the full tour (tour.tsx) for readers.
import { useEffect, useLayoutEffect, useState } from 'preact/hooks'
import { t } from './i18n'
import { CheckIcon, CircleIcon, CloseIcon } from './icons'
import { loadSettings, markTourSeen as markSeen } from './state'
import { Gesture, GESTURE_MS, stillMotion } from './gesture'
import { useLeave } from './motion'
import './habits.css'

type Box = { top: number; left: number; width: number; height: number }

/** The bottom bar's buttons the habits are about, in their order, as shown. */
export const STOPS = [
  { sel: '.sb-pray', label: 'Pray', icon: () => <span class="hb-emoji">{'🙏' + loadSettings().prayTone}</span> },
  { sel: '.sb-circles', label: 'Circles', icon: () => <CircleIcon size={38} /> },
]
const shown = (sel: string) => {
  const r = document.querySelector(sel)?.getBoundingClientRect()
  return r && r.width > 0 && r.bottom > 0 && r.top < innerHeight ? r : undefined
}
/** The habit steps that can show now (the search bar can be hidden). */
export const habitStops = () => STOPS.filter(s => shown(s.sel))

/** How long the fingertip spends on each button when it goes round all three. */
const ROUND_MS = GESTURE_MS * .55

export function Habits({ onClose, onMore }: { onClose: () => void; onMore: () => void }) {
  const leave = useLeave(undefined, 'fade')
  const [stops] = useState(habitStops)
  const [i, setI] = useState(0)
  const [boxes, setBoxes] = useState<Box[]>([])
  const [bar, setBar] = useState<Box>()
  const [tick, setTick] = useState(0)
  const repeat = i === stops.length
  const close = () => { markSeen(); onClose() }
  const forward = () => repeat ? close() : setI(i + 1)

  useEffect(() => { markSeen() }, [])
  // Where the buttons are, kept up as the phone turns. Each gets a round window.
  useLayoutEffect(() => {
    const measure = () => {
      const pad = 8
      setBoxes(stops.map(s => {
        const r = shown(s.sel)
        if (!r) return { top: -999, left: -999, width: 0, height: 0 }
        const side = Math.max(r.width, r.height) + pad * 2
        return { top: r.top + r.height / 2 - side / 2, left: r.left + r.width / 2 - side / 2, width: side, height: side }
      }))
      const b = shown('.sb-bar')
      setBar(b && { top: b.top - pad, left: b.left - pad, width: b.width + pad * 2, height: b.height + pad * 2 })
    }
    measure()
    addEventListener('resize', measure)
    return () => removeEventListener('resize', measure)
  }, [])
  // The fingertip taps the lit button again and again; on the last step it
  // goes round all three, in order. Held still with reduced motion.
  useEffect(() => {
    setTick(0)
    if (stillMotion()) return
    let n = 0, timer = 0
    const go = () => { n++; setTick(n); timer = window.setTimeout(go, repeat ? ROUND_MS : GESTURE_MS) }
    timer = window.setTimeout(go, 450)
    return () => clearTimeout(timer)
  }, [i])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close() }
      else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); forward() }
      else if (e.key === 'ArrowLeft' && i) setI(i - 1)
    }
    addEventListener('keydown', key, true)
    return () => removeEventListener('keydown', key, true)
  })

  const box = repeat ? bar : boxes[i]
  const tapAt = repeat ? boxes[(Math.max(tick, 1) - 1) % boxes.length] : boxes[i]
  const lift = box ? innerHeight - box.top + 18 : 120
  const head = document.querySelector('header.top')?.getBoundingClientRect().bottom ?? 60
  return (
    <div ref={leave} class="tour hb" role="dialog" aria-modal="true" aria-label={t('Take the tour')}>
      {/* Takes every tap, so nothing behind is pressed by mistake. */}
      <div class="tour-block" onClick={e => e.stopPropagation()} />
      {box && <div class={'tour-hole' + (repeat ? '' : ' hb-round')} style={{ top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px` }} aria-hidden="true" />}
      {/* The lit button itself is what you tap to go on. */}
      {box && !repeat && <button class="hb-target" key={i} aria-label={t(stops[i].label)} onClick={forward}
        style={{ top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px` }} />}
      {tapAt && (tick || stillMotion()) ? <Gesture key={`${i}-${tick}`} kind="tap" x={tapAt.left + tapAt.width / 2} y={tapAt.top + tapAt.height / 2} /> : null}
      <button class="close-btn hb-close" aria-label={t('End the tour')} title={t('End the tour')} onClick={close}><CloseIcon size={26} /></button>
      <div class="hb-dots" aria-hidden="true" style={{ top: `${head + 14}px` }}>
        {[...stops, null].map((_, n) => <span class={n === i ? 'on' : n < i ? 'done' : ''} />)}
      </div>
      {repeat && <div class="hb-loop" style={{ bottom: `${lift}px` }}>
        <div class={'hb-ring hb-n' + stops.length} aria-hidden="true">
          {stops.map((s, n) => <span class={'hb-ic hb-ic' + n} style={{ animationDelay: `${n * ROUND_MS}ms`, animationDuration: `${stops.length * ROUND_MS}ms` }}>{s.icon()}</span>)}
          <svg class="hb-cycle" viewBox="0 0 120 120"><circle cx="60" cy="60" r="46" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="14 10" stroke-linecap="round" /></svg>
        </div>
        <button class="hb-go" aria-label={t('Done')} title={t('Done')} onClick={close} ref={b => b?.focus({ preventScroll: true })}><CheckIcon size={30} /></button>
        <button class="hb-more" onClick={() => { markSeen(); onMore() }}>{t('More')}</button>
      </div>}
    </div>
  )
}

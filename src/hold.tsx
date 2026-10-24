// Press and hold a button for a small row of choices above it, as on the
// iPhone emoji keyboard: slide along and let go on one, or let go and tap
// one. A plain tap still does the button's usual thing. Used by 🙏 (skin
// tones) and the theme button (Light, Sepia, Dark, Auto).
import { ComponentChildren } from 'preact'
import { createPortal } from 'preact/compat'
import { useEffect, useRef, useState } from 'preact/hooks'
import { holdTap } from './lib/native'

export interface HoldOption { value: string; label: string; body: ComponentChildren }

export function useHoldPick({ options, value, onPick, onTap, label, cls, cell }: {
  options: HoldOption[]; value: string; onPick: (v: string) => void; onTap: () => void
  /** names the row for screen readers */ label: string
  /** extra class on the row */ cls: string
  /** width of one choice, for keeping the row on screen */ cell: number
}) {
  const [at, setAt] = useState<DOMRect | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const timer = useRef(0)
  const start = useRef<{ x: number; y: number } | null>(null)
  const held = useRef(false)
  const slid = useRef(false)
  const caught = useRef(false)
  const row = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const choose = (v: string) => { onPick(v); setAt(null); setHover(null) }
  // Like the iPhone keyboard: while you slide, the choice is the one in line
  // with your finger, wherever it is up or down, so a finger that covers the
  // row or drifts a little still lands on the one you mean.
  const optionAt = (x: number) => {
    const cells = [...(row.current?.children ?? [])] as HTMLElement[]
    if (!cells.length) return null
    const i = cells.findIndex(c => x < c.getBoundingClientRect().right)
    return cells[i < 0 ? cells.length - 1 : i].dataset.value ?? null
  }
  const down = (e: PointerEvent) => {
    if (e.button) return
    held.current = false
    slid.current = false
    start.current = { x: e.clientX, y: e.clientY }
    const el = e.currentTarget as HTMLElement
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { held.current = true; getSelection()?.removeAllRanges(); holdTap(); setAt(el.getBoundingClientRect()) }, 450)
  }
  const move = (e: PointerEvent) => {
    if (!start.current) return
    if (held.current) {
      // Settle first: the jitter of a held finger doesn't count as a slide.
      if (!slid.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) < 12) return
      slid.current = true
      setHover(optionAt(e.clientX))
      return
    }
    if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) { clearTimeout(timer.current); start.current = null }
  }
  const up = (e: PointerEvent) => {
    clearTimeout(timer.current)
    if (held.current && start.current) {
      // Slid onto one: that's the one. Just let go: stay open for a tap.
      const v = slid.current ? optionAt(e.clientX) : null
      if (v !== null) choose(v)
    } else if (start.current && e.button === 0) {
      // A plain tap. Touches never send a click (see below), so it acts here.
      onTap()
    }
    start.current = null
  }
  // On iPhone a held finger otherwise selects the nearest verse and brings
  // up Copy / Look Up / Translate. Stopping the touch itself stops all of
  // that; the pointer events above still come through.
  useEffect(() => {
    const el = btn.current
    if (!el) return
    const stop = (e: TouchEvent) => { if (e.cancelable) e.preventDefault() }
    el.addEventListener('touchstart', stop, { passive: false })
    return () => el.removeEventListener('touchstart', stop)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    if (!at) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setAt(null) }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [at])

  const button = {
    ref: btn,
    onPointerDown: down, onPointerMove: move, onPointerUp: up,
    onPointerCancel: () => { clearTimeout(timer.current); start.current = null },
    onContextMenu: (e: Event) => e.preventDefault(),
    // Keyboard only; taps act on pointerup.
    onClick: (e: MouseEvent) => { if (e.detail === 0) onTap() },
  }
  // Above the button (below it near the top of the screen), kept on screen.
  const w = options.length * (cell + 2) + 12
  const left = at ? Math.max(8, Math.min(innerWidth - w - 8, at.left + at.width / 2 - w / 2)) : 0
  const place = !at ? {} : at.top < 140 ? { left, top: at.bottom + 10 } : { left, bottom: innerHeight - at.top + 10 }
  // On the page itself: the bar's blur and slide would carry it along.
  const picker = at && createPortal(<>
    {/* Only a tap that starts here closes it, not letting go of the hold. */}
    <div class="hold-catch" onPointerDown={() => { caught.current = true }} onClick={() => { if (caught.current) setAt(null); caught.current = false }} />
    <div ref={row} class={`hold-pick ${cls}`} role="radiogroup" aria-label={label} style={place}>
      {options.map(o => (
        <button type="button" role="radio" data-value={o.value} aria-checked={value === o.value} aria-label={o.label}
          class={(hover ?? value) === o.value ? 'on' : ''} onClick={() => choose(o.value)}>{o.body}</button>
      ))}
    </div>
  </>, document.body)
  return { button, picker }
}

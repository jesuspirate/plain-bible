// Report a problem → Show what happens: while the person uses the app as
// usual, each step is written down in a few plain words (a tap and what it
// was on, a scroll, a new screen, the screen turning, an error) so the
// report can say how to get to the problem. Nothing typed is kept, only that
// something was typed, and no picture is taken. The steps stay on the device
// until the person sends the report (and can read them first); they survive
// the app reloading, since that can be the very problem.

const KEY = 'plain-bible:report-steps'
const MAX = 120
/** A recording older than this isn't picked up again after a reload. */
const STALE = 30 * 60_000

type Saved = { on: boolean; t0: number; steps: string[]; dropped: number }
let rec: Saved = { on: false, t0: 0, steps: [], dropped: 0 }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(rec)) } catch { /* private mode */ } }
const listeners = new Set<() => void>()
const changed = () => { save(); listeners.forEach(f => f()) }
export const onStepsChange = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f) } }

const clock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

let lastWhat = ''
export function addStep(what: string, now = Date.now()) {
  if (!rec.on) return
  // The same thing twice in a row (a held key, a second scroll) is one step.
  if (what === lastWhat) return
  lastWhat = what
  const line = `${clock(now - rec.t0)} ${what}`.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 240)
  rec.steps.push(line)
  if (rec.steps.length > MAX) { rec.steps.splice(1, 1); rec.dropped++ }
  changed()
}

export const recording = () => rec.on
/** The steps as they'll be sent, the first and last kept when there were many. */
export const recordedSteps = (): string[] => (rec.dropped
  ? [rec.steps[0], `… ${rec.dropped} earlier steps not kept`, ...rec.steps.slice(1)]
  : [...rec.steps]
// Steps kept by an older version wrote the whole address: clean them too.
).map(s => s.replace(/#\/\S*/g, screenOf))
export function clearSteps() { rec = { on: false, t0: 0, steps: [], dropped: 0 }; try { localStorage.removeItem(KEY) } catch { /* */ } listeners.forEach(f => f()) }

/** The screen, for a report: where in the app, never what it carries. A
 *  link can hold a secret in the address (a circle invite's key, a device
 *  link's key) and a search holds the typed words, so only the path and a few
 *  plain numbers are kept; anything else is shown as … */
const KEEP = new Set(['v', 'e', 'at', 'p', 'b', 's'])
const TOKEN = /[A-Za-z0-9_-]{20,}/
export function screenOf(hash: string): string {
  const [path, query] = hash.replace(/^#\/?/, '').split('?', 2)
  const parts = path.split('/').filter(Boolean)
  // A device link is nothing but its secret.
  const kept = parts[0] === 'move' ? ['move', '…'] : parts.map(p => TOKEN.test(p) ? '…' : p)
  const params = [...new URLSearchParams(query ?? '')].map(([k, v]) =>
    KEEP.has(k) && /^[\w,.:-]{0,40}$/.test(v) && !TOKEN.test(v) ? `${k}=${v}` : `${k.replace(/[^\w-]/g, '').slice(0, 12)}=…`)
  return ('#/' + kept.join('/') + (params.length ? '?' + params.join('&') : '')).slice(0, 120)
}
const screen = () => screenOf(location.hash)

// ---------------------------------------------------------------------------
// What a tap was on, in words.

/** The thing's own short name: its label, or the words on a button or link. Never other text on the page. */
function nameOf(el: Element | null): string {
  for (let n: Element | null = el, i = 0; n && n !== document.body && i < 8; n = n.parentElement, i++) {
    const aria = n.getAttribute('aria-label') ?? n.getAttribute('title')
    if (aria) return aria
    if (/^(BUTTON|A|LABEL|SUMMARY|H[1-6]|OPTION)$/.test(n.tagName) || n.getAttribute('role') === 'button' || n.getAttribute('role') === 'radio' || n.getAttribute('role') === 'tab') {
      return (n.textContent ?? '').replace(/\s+/g, ' ').trim()
    }
  }
  return ''
}

/** Where a thing sits in the page, as a short path of its parents. */
export function pathOf(el: Element | null): string {
  const parts: string[] = []
  for (let n: Element | null = el, i = 0; n && n !== document.body && i < 8 && parts.length < 4; n = n.parentElement, i++) {
    const cls = typeof n.className === 'string' ? n.className.trim().split(/\s+/)[0] : ''
    parts.unshift(n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (cls ? '.' + cls : ''))
  }
  return parts.join(' > ')
}

/** A few plain words for the thing at a spot: its name, where it sits, and where on the screen. */
export function describeSpot(el: Element | null, x: number, y: number, w: number, h: number): string {
  let label = nameOf(el)
  if (label.length > 60) label = label.slice(0, 59) + '…'
  return `${label ? `“${label}” ` : ''}[${pathOf(el)}] at ${Math.round(x / w * 100)}% across, ${Math.round(y / h * 100)}% down`
}

// ---------------------------------------------------------------------------
// Watching, only while recording.

const mine = (el: EventTarget | null) => el instanceof Element && !!el.closest('.steps-pill')
let stop: (() => void) | null = null

function watch() {
  if (stop) return
  const off: (() => void)[] = []
  const on = <K extends keyof WindowEventMap>(type: K, f: (e: WindowEventMap[K]) => void, opts: AddEventListenerOptions = { capture: true, passive: true }) => {
    addEventListener(type, f, opts); off.push(() => removeEventListener(type, f, opts))
  }
  on('pointerdown', e => {
    if (mine(e.target)) return
    addStep('Tap ' + describeSpot(e.target as Element, e.clientX, e.clientY, innerWidth, innerHeight))
  })
  // A scroll is written once it settles, with which way and how far.
  const scrolls = new Map<EventTarget, { from: number; timer: number }>()
  on('scroll', e => {
    const t = e.target === document ? document.scrollingElement : e.target as Element
    if (!t || mine(t)) return
    const s = scrolls.get(t) ?? { from: t.scrollTop, timer: 0 }
    clearTimeout(s.timer)
    s.timer = window.setTimeout(() => {
      scrolls.delete(t)
      const by = t.scrollTop - s.from
      if (Math.abs(by) < 8) return
      const room = t.scrollHeight - t.clientHeight
      addStep(`Scrolled ${by > 0 ? 'down' : 'up'} in [${t === document.scrollingElement ? 'page' : pathOf(t)}] to ${room > 0 ? Math.round(t.scrollTop / room * 100) : 0}%`)
    }, 500)
    scrolls.set(t, s)
  })
  // Typing: only where, never the words.
  let typedIn: Element | null = null
  on('input', e => {
    const t = e.target as Element
    if (t === typedIn) return
    typedIn = t
    addStep(`Typed in [${pathOf(t)}]`)
  })
  on('keydown', e => {
    if (/^(Enter|Escape|Tab|Backspace|Delete|Arrow\w+|Page\w+|Home|End| )$/.test(e.key) && !(e.key === 'Backspace' && typedIn === e.target)) {
      addStep(`Key ${e.key === ' ' ? 'Space' : e.key}${e.metaKey ? ' with ⌘' : e.ctrlKey ? ' with Ctrl' : ''}`)
    } else if ((e.metaKey || e.ctrlKey) && e.key.length === 1) addStep(`Key ${e.metaKey ? '⌘' : 'Ctrl'}+${e.key.toUpperCase()}`)
  })
  on('focusin', e => { if (e.target !== typedIn) typedIn = null })
  on('hashchange', () => addStep(`Screen ${screen()}`))
  let size = `${innerWidth}×${innerHeight}`, sized = 0
  on('resize', () => {
    clearTimeout(sized)
    sized = window.setTimeout(() => { const now = `${innerWidth}×${innerHeight}`; if (now !== size) addStep(`Screen size ${size = now}`) }, 400)
  })
  const seen = () => addStep(document.hidden ? 'Left the app' : 'Back in the app')
  document.addEventListener('visibilitychange', seen); off.push(() => document.removeEventListener('visibilitychange', seen))
  on('error', e => addStep('Error: ' + String(e.error?.message ?? e.message ?? '').slice(0, 160)))
  on('unhandledrejection', e => addStep('Error: ' + String((e.reason as Error)?.message ?? e.reason ?? '').slice(0, 160)))
  stop = () => { off.forEach(f => f()); scrolls.forEach(s => clearTimeout(s.timer)); clearTimeout(sized); stop = null }
}

export function startSteps(now = Date.now()) {
  lastWhat = ''
  rec = { on: true, t0: now, steps: [], dropped: 0 }
  addStep(`Started on ${screen()} · ${innerWidth}×${innerHeight} · theme ${document.documentElement.dataset.theme ?? '?'}`, now)
  watch()
}

export function stopSteps(now = Date.now()) {
  if (!rec.on) return
  addStep('Stopped', now)
  rec.on = false
  stop?.()
  changed()
}

/** At launch: a recording that was going when the app reloaded carries on. */
export function resumeSteps(): boolean {
  try {
    const was = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null
    if (!was || !Array.isArray(was.steps)) return false
    rec = was
    if (!was.on) return false
    if (Date.now() - was.t0 > STALE) { stopSteps(); return false }
  } catch { return false }
  addStep(`App reloaded · ${screen()}`)
  watch()
  return true
}

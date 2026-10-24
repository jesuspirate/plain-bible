// Streaks: how many days in a row you've read the word and prayed. Each day
// is a pair of bits under its date on this device's clock, kept here and
// synced with your other devices (merged by keeping every bit). Nothing
// reminds you, and nothing is shared unless you turn it on for a circle.
//
// A reading day is about a minute with the Bible open and moving: the time
// between one scroll, tap or chapter turn and the next counts, up to a
// limit, so a page left open on the table doesn't. A prayer day is any
// prayer recorded.
//
// Grace: today never ends a streak (it can still be done), and one missed
// day in any seven is forgiven. Missed days don't add to the count.

export const READ = 1, PRAY = 2
export type Days = Record<string, number>

const KEY = 'plain-bible:days'
export const DAYS_EVENT = 'plain-bible:days'

/** A date on this device's clock, as 2026-10-24. */
export function dayOf(t: number | Date = Date.now()) {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** The day `n` days before `day` (or after, for negative `n`). */
export function dayBefore(day: string, n = 1) {
  const [y, m, d] = day.split('-').map(Number)
  return dayOf(new Date(y, m - 1, d - n, 12))
}
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export function loadDays(): Days {
  try { return cleanDays(JSON.parse(localStorage.getItem(KEY) || '{}')) } catch { return {} }
}
function saveDays(d: Days) {
  try { localStorage.setItem(KEY, JSON.stringify(d)) } catch { /* private mode */ }
  dispatchEvent(new Event(DAYS_EVENT))
}
export function cleanDays(v: unknown): Days {
  const out: Days = {}
  if (!v || typeof v !== 'object') return out
  for (const [k, b] of Object.entries(v)) if (DAY_RE.test(k) && typeof b === 'number' && b & 3) out[k] = b & 3
  return out
}
/** Both sets of days together: a day done anywhere is done. */
export function mergeDays(a: Days | undefined, b: Days | undefined): Days {
  const out: Days = { ...cleanDays(a) }
  for (const [k, v] of Object.entries(cleanDays(b))) out[k] = (out[k] ?? 0) | v
  return out
}
/** Days that came from elsewhere (a sync) joined to the ones here. */
export function addDays(more: Days | undefined) {
  const cur = loadDays(), next = mergeDays(cur, more)
  if (Object.keys(next).some(k => next[k] !== cur[k])) saveDays(next)
}

/** Mark `day` as done for `what` (READ or PRAY). */
export function markDay(what: number, day = dayOf()) {
  const d = loadDays()
  if ((d[day] ?? 0) & what) return
  d[day] = (d[day] ?? 0) | what
  saveDays(d)
}

/** How many days in a row `what` was done, as of `today`, and the day the
 *  run began. */
export function run(days: Days, what: number, today = dayOf()) {
  const done = (d: string) => !!((days[d] ?? 0) & what)
  let d = done(today) ? today : dayBefore(today)
  let count = 0, from = today, forgiven: string | undefined
  for (let i = 0; i < 20000; i++) {
    if (done(d)) { count++; from = d; d = dayBefore(d); continue }
    // A missed day: forgiven if the day before it was done and no other
    // day was forgiven in the week after it.
    const prev = dayBefore(d)
    if (!done(prev) || (forgiven && forgiven <= dayBefore(d, -6))) break
    forgiven = d
    d = prev
  }
  return { count, from }
}
export const streak = (days: Days, what: number, today = dayOf()) => run(days, what, today).count

export interface Streaks { read: number; pray: number; readToday: boolean; prayToday: boolean }
export function streaks(days: Days, today = dayOf()): Streaks {
  return { read: streak(days, READ, today), pray: streak(days, PRAY, today), readToday: !!((days[today] ?? 0) & READ), prayToday: !!((days[today] ?? 0) & PRAY) }
}

// ---- sharing with a circle ---------------------------------------------------
// What a circle sees: the last day, and one digit per day going back (1 read,
// 2 prayed, 3 both), only as far back as the streaks reach. Their app works
// the counts out on their own day, with the same rules.

export interface Shared { end: string; d: string }
export function shareable(days: Days, today = dayOf()): Shared {
  const r = run(days, READ, today), p = run(days, PRAY, today)
  const from = [r, p].filter(x => x.count).map(x => x.from).sort()[0] ?? today
  let out = ''
  for (let d = today; d >= from && out.length < 4000; d = dayBefore(d)) out += String(days[d] ?? 0)
  return { end: today, d: out.replace(/0+$/, '') }
}
export function fromShared(v: unknown): Days {
  const x = v as Shared | null
  if (!x || typeof x.end !== 'string' || !DAY_RE.test(x.end) || typeof x.d !== 'string') return {}
  const out: Days = {}
  let d = x.end
  for (const c of x.d.slice(0, 4000)) { if (c > '0' && c <= '3') out[d] = +c; d = dayBefore(d) }
  return out
}

// ---- reading time ------------------------------------------------------------

const READING = 'plain-bible:reading'
/** Seconds of reading that make a day. */
export const READ_SECONDS = 60
/** Longest gap between two movements that still counts as reading. */
const GAP_MS = 90_000

/** Count reading while the Bible is open. Listens only until today's reading
 *  is done, and does nothing but a little arithmetic on each movement. */
export function watchReading(): () => void {
  let today = dayOf()
  let ms = 0, last = 0, moved = false
  try {
    const kept = JSON.parse(localStorage.getItem(READING) || 'null')
    if (kept?.day === today) { ms = +kept.ms || 0; moved = !!kept.moved }
  } catch { /* ignore */ }
  const keep = () => { try { localStorage.setItem(READING, JSON.stringify({ day: today, ms, moved })) } catch { /* ignore */ } }
  const opts = { passive: true, capture: true } as const
  const stop = () => {
    removeEventListener('scroll', move, opts)
    removeEventListener('pointerdown', move, opts)
    removeEventListener('keydown', move, opts)
    removeEventListener(TURN_EVENT, move)
    document.removeEventListener('visibilitychange', vis)
  }
  function move(e?: Event) {
    const now = Date.now()
    if (dayOf(now) !== today) { today = dayOf(now); ms = 0; moved = false; last = 0 }
    if (loadDays()[today] & READ) { stop(); return }
    if (e) moved = true
    if (last) ms += Math.min(now - last, GAP_MS)
    last = now
    if (moved && ms >= READ_SECONDS * 1000) { markDay(READ, today); keep(); stop() }
  }
  // Hidden time doesn't count; coming back starts afresh.
  function vis() { if (document.visibilityState === 'visible') last = Date.now(); else { if (last) move(); last = 0; keep() } }
  if (loadDays()[today] & READ) return () => {}
  addEventListener('scroll', move, opts)
  addEventListener('pointerdown', move, opts)
  addEventListener('keydown', move, opts)
  addEventListener(TURN_EVENT, move)
  document.addEventListener('visibilitychange', vis)
  if (document.visibilityState === 'visible') last = Date.now()
  return () => { if (last) { move(); keep() } stop() }
}
/** The reader sends this when the chapter changes. */
export const TURN_EVENT = 'plain-bible:turn'

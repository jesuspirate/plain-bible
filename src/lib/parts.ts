/** One prayer, played on one player: its parts in turn (a prayer picked up again
 *  after the phone locked is several recordings), with pause and a place to jump
 *  to anywhere in the whole prayer. The player is the one a tap made, since an
 *  iPhone only lets that one carry on by itself.
 *
 *  With a `spot` name, where you are is kept on this device: leave the app (or
 *  it reloads) and the prayer carries on from there next time. Played to the
 *  end, the spot is forgotten. */
export interface PartsPlayer { pause(): void; resume(): void; seek(ms: number): void; stop(): void
  /** Where it is right now, in ms of the whole prayer (for a bar that glides). */
  at(): number }

const SPOTS = 'plain-bible:prayer-spots'
const KEEP = 40
type Spots = Record<string, [number, number]>
const readSpots = (): Spots => { try { return JSON.parse(localStorage.getItem(SPOTS) || '{}') } catch { return {} } }
const writeSpots = (s: Spots) => { try { localStorage.setItem(SPOTS, JSON.stringify(s)) } catch { /* private window: not kept */ } }
/** Every prayer left partway, by name: where, in ms. */
export const allSpots = (): Record<string, number> => Object.fromEntries(Object.entries(readSpots()).map(([k, v]) => [k, v[0]]))
/** Where a prayer was left, in ms, if it was. */
export const spotOf = (name: string): number | undefined => readSpots()[name]?.[0]
/** Keep (or with no `ms`, forget) where a prayer was left. Only the latest few are kept. */
export function keepSpot(name: string, ms?: number) {
  const s = readSpots()
  if (ms === undefined || ms < 1000) { if (!(name in s)) return; delete s[name] } else {
    s[name] = [Math.round(ms), Date.now()]
    const names = Object.keys(s)
    if (names.length > KEEP) names.sort((a, b) => s[a][1] - s[b][1]).slice(0, names.length - KEEP).forEach(n => delete s[n])
  }
  writeSpots(s)
}

export function playParts(el: HTMLAudioElement, urls: string[], ms: number[], on: {
  time: (ms: number) => void
  playing: (on: boolean) => void
  end: () => void
  fail: () => void
}, opts: { spot?: string; from?: number } = {}): PartsPlayer {
  // Where each part starts in the whole prayer.
  const starts = ms.map((_, i) => ms.slice(0, i).reduce((a, b) => a + (b || 0), 0))
  const total = starts.length ? starts[starts.length - 1] + (ms[ms.length - 1] || 0) : 0
  let i = 0, now = 0, keptAt = 0
  // A jump into a part not loaded yet waits for it to open.
  let want: number | undefined
  const keep = () => { if (opts.spot) { keptAt = Date.now(); keepSpot(opts.spot, now) } }
  const play = () => { el.play().catch(on.fail) }
  const tell = (to: number) => {
    now = to; on.time(to)
    // Every few seconds while it plays, in case the app is closed mid-prayer.
    if (Date.now() - keptAt > 4000) keep()
  }
  el.ontimeupdate = () => tell(starts[i] + el.currentTime * 1000)
  el.onplay = () => on.playing(true)
  // The end of a part isn't a pause: the next part follows.
  el.onpause = () => { if (!el.ended) { keep(); on.playing(false) } }
  el.onloadedmetadata = () => {
    if (want === undefined) return
    const at = want
    want = undefined
    if (Math.abs(el.currentTime - at) > .25) el.currentTime = at
  }
  el.onended = () => {
    if (++i >= urls.length) { if (opts.spot) keepSpot(opts.spot); opts.spot = undefined; on.end(); return }
    el.src = urls[i]; play()
  }
  const seek = (to: number, start = false) => {
    to = Math.max(0, Math.min(total, to))
    let j = 0
    while (j + 1 < starts.length && starts[j + 1] <= to) j++
    let at = (to - starts[j]) / 1000
    if (Number.isFinite(el.duration) && j === i) at = Math.min(at, Math.max(0, el.duration - .05))
    now = to; on.time(to)
    if (j !== i || start) {
      const going = !el.paused || start
      i = j; want = at; el.src = urls[j]
      try { el.currentTime = at } catch { /* applied once it opens */ }
      if (going) play()
    } else {
      if (el.readyState < 1) want = at
      el.currentTime = at
    }
    if (el.paused && !start) keep()
  }
  if (opts.from && opts.from < total - 500) seek(opts.from, true)
  else { el.src = urls[0]; play() }
  return {
    pause: () => el.pause(),
    at: () => want !== undefined ? now : starts[i] + el.currentTime * 1000,
    resume: play,
    seek: to => seek(to),
    // Done with: nothing it says afterwards (a late pause) reaches the page.
    stop() {
      el.ontimeupdate = el.onplay = el.onpause = el.onloadedmetadata = el.onended = null
      if (!el.ended) keep()
      el.pause()
    },
  }
}

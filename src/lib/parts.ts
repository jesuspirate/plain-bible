/** One prayer, played on one player: its parts in turn (a prayer picked up again
 *  after the phone locked is several recordings), with pause and a place to jump
 *  to anywhere in the whole prayer. The player is the one a tap made, since an
 *  iPhone only lets that one carry on by itself. */
export interface PartsPlayer { pause(): void; resume(): void; seek(ms: number): void; stop(): void }

export function playParts(el: HTMLAudioElement, urls: string[], ms: number[], on: {
  time: (ms: number) => void
  playing: (on: boolean) => void
  end: () => void
  fail: () => void
}): PartsPlayer {
  // Where each part starts in the whole prayer.
  const starts = ms.map((_, i) => ms.slice(0, i).reduce((a, b) => a + (b || 0), 0))
  const total = starts.length ? starts[starts.length - 1] + (ms[ms.length - 1] || 0) : 0
  let i = 0
  // A jump into a part not loaded yet waits for it to open.
  let want: number | undefined
  const play = () => { el.play().catch(on.fail) }
  el.ontimeupdate = () => on.time(starts[i] + el.currentTime * 1000)
  el.onplay = () => on.playing(true)
  // The end of a part isn't a pause: the next part follows.
  el.onpause = () => { if (!el.ended) on.playing(false) }
  el.onloadedmetadata = () => {
    if (want === undefined) return
    const at = want
    want = undefined
    if (Math.abs(el.currentTime - at) > .25) el.currentTime = at
  }
  el.onended = () => {
    if (++i >= urls.length) { on.end(); return }
    el.src = urls[i]; play()
  }
  el.src = urls[0]
  play()
  return {
    pause: () => el.pause(),
    // Done with: nothing it says afterwards (a late pause) reaches the page.
    stop() {
      el.ontimeupdate = el.onplay = el.onpause = el.onloadedmetadata = el.onended = null
      el.pause()
    },
    resume: play,
    seek(to) {
      to = Math.max(0, Math.min(total, to))
      let j = 0
      while (j + 1 < starts.length && starts[j + 1] <= to) j++
      let at = (to - starts[j]) / 1000
      if (Number.isFinite(el.duration) && j === i) at = Math.min(at, Math.max(0, el.duration - .05))
      on.time(to)
      if (j !== i) {
        const going = !el.paused
        i = j; want = at; el.src = urls[j]
        try { el.currentTime = at } catch { /* applied once it opens */ }
        if (going) play()
      } else el.currentTime = at
    },
  }
}

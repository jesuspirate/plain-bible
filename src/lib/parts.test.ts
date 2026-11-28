import { describe, expect, it, vi } from 'vitest'
import { allSpots, keepSpot, playParts, spotOf } from './parts'

const store: Record<string, string> = {}
vi.stubGlobal('localStorage', { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v } })

// A stand-in for the audio player: enough to follow where it is and what it plays.
function fakeAudio() {
  const el: any = {
    src: '', currentTime: 0, duration: NaN, paused: true, ended: false, readyState: 0,
    play() { el.paused = false; el.onplay?.(); return Promise.resolve() },
    pause() { el.paused = true; el.onpause?.() },
  }
  return el as HTMLAudioElement & { paused: boolean }
}

describe('playParts', () => {
  it('plays the parts in turn, with time counted across the whole prayer', () => {
    const el = fakeAudio(), times: number[] = []
    let ended = false
    playParts(el, ['a', 'b'], [3000, 2000], { time: ms => times.push(ms), playing: () => {}, end: () => { ended = true }, fail: () => {} })
    expect(el.src).toBe('a')
    el.currentTime = 1; el.ontimeupdate!(new Event('timeupdate'))
    el.onended!(new Event('ended'))
    expect(el.src).toBe('b')
    el.currentTime = 1; el.ontimeupdate!(new Event('timeupdate'))
    expect(times).toEqual([1000, 4000])
    el.onended!(new Event('ended'))
    expect(ended).toBe(true)
  })

  it('jumps into another part, and keeps a pause a pause', () => {
    const el = fakeAudio()
    let playing = true
    const p = playParts(el, ['a', 'b'], [3000, 2000], { time: () => {}, playing: on => { playing = on }, end: () => {}, fail: () => {} })
    p.pause()
    expect(playing).toBe(false)
    p.seek(4500)
    expect(el.src).toBe('b')
    expect(el.currentTime).toBe(1.5)
    expect(el.paused).toBe(true)
    p.seek(500)
    expect(el.src).toBe('a')
    expect(el.currentTime).toBe(.5)
    p.resume()
    expect(playing).toBe(true)
  })

  it('says nothing more once stopped', () => {
    const el = fakeAudio()
    let calls = 0
    const p = playParts(el, ['a'], [1000], { time: () => {}, playing: () => { calls++ }, end: () => {}, fail: () => {} })
    calls = 0
    p.stop()
    expect(calls).toBe(0)
    expect(el.onpause).toBe(null)
  })

  it('keeps where a prayer was paused, carries on from there, and forgets it at the end', () => {
    const el = fakeAudio()
    const p = playParts(el, ['a', 'b'], [3000, 2000], { time: () => {}, playing: () => {}, end: () => {}, fail: () => {} }, { spot: 'p:x' })
    el.currentTime = 1.5; el.onended!(new Event('ended')); el.currentTime = 1; el.ontimeupdate!(new Event('timeupdate'))
    p.pause()
    expect(spotOf('p:x')).toBe(4000)
    p.stop()
    // The app comes back: it starts again in the second part, a second in.
    const again = fakeAudio()
    playParts(again, ['a', 'b'], [3000, 2000], { time: () => {}, playing: () => {}, end: () => {}, fail: () => {} }, { spot: 'p:x', from: spotOf('p:x') })
    expect(again.src).toBe('b')
    expect(again.currentTime).toBe(1)
    expect(again.paused).toBe(false)
    again.onended!(new Event('ended'))
    expect(spotOf('p:x')).toBeUndefined()
  })

  it('keeps only the latest spots', () => {
    for (let i = 0; i < 45; i++) keepSpot(`p:${i}`, 5000)
    expect(Object.keys(allSpots()).length).toBe(40)
    keepSpot('p:44')
    expect(spotOf('p:44')).toBeUndefined()
  })
})

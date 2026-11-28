import { describe, expect, it } from 'vitest'
import { playParts } from './parts'

// A stand-in for the audio player: enough to follow where it is and what it plays.
function fakeAudio() {
  const el: any = {
    src: '', currentTime: 0, duration: NaN, paused: true, ended: false,
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
})

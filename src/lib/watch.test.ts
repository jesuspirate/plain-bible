import { describe, expect, it } from 'vitest'
import { takeWatchPrayers, watchBridge, WatchPrayer } from './watch'
import type { Prayer } from './prayers'

const b64 = (s: string) => btoa(s)
function setup(waiting: unknown[], have: Prayer[] = []) {
  const kept = new Map(have.map(p => [p.id, p])), done: string[] = []
  const bridge = {
    next: async () => waiting[0] ?? null,
    done: async (id: string) => { done.push(id); if ((waiting[0] as WatchPrayer)?.id === id) waiting.shift() },
  }
  const store = { get: async (id: string) => kept.get(id), put: async (p: Prayer) => { kept.set(p.id, p) } }
  return { bridge, store, kept, done }
}
const p = (id: string, at: number): WatchPrayer => ({ id, at, ms: 5000, type: 'audio/mp4', audio: b64('abc') })

describe('prayers from the watch', () => {
  it('keeps each one, then lets the iPhone app delete its copy', async () => {
    const s = setup([p('a1', 100), p('b2', 200)])
    expect(await takeWatchPrayers(s.bridge, s.store)).toEqual([100, 200])
    expect(s.done).toEqual(['a1', 'b2'])
    const a = s.kept.get('a1')!
    expect([a.at, a.ms, a.type]).toEqual([100, 5000, 'audio/mp4'])
    expect(new TextDecoder().decode(a.audio)).toBe('abc')
  })
  it('does not keep one twice, or overwrite what is here', async () => {
    const here: Prayer = { id: 'a1', at: 100, ms: 5000, type: 'audio/mp4', audio: new ArrayBuffer(3), name: 'Mine' }
    const s = setup([p('a1', 100)], [here])
    expect(await takeWatchPrayers(s.bridge, s.store)).toEqual([])
    expect(s.kept.get('a1')).toBe(here)
    expect(s.done).toEqual(['a1'])
  })
  it('keeps nothing over there when keeping here fails', async () => {
    const s = setup([p('a1', 100)])
    s.store.put = async () => { throw new Error('full') }
    await expect(takeWatchPrayers(s.bridge, s.store)).rejects.toThrow('full')
    expect(s.done).toEqual([])
  })
  it('stops at anything odd, and never loops on one that stays', async () => {
    expect(await takeWatchPrayers(...pair(setup([{ id: '../x', at: 1, ms: 1, type: 'a', audio: 'YQ==' }])))).toEqual([])
    const s = setup([p('a1', 100)])
    s.bridge.done = async () => {}
    expect(await takeWatchPrayers(s.bridge, s.store)).toEqual([100])
  })
  it('lets go of audio it cannot read', async () => {
    const s = setup([{ ...p('a1', 100), audio: '***' }, p('b2', 200)])
    expect(await takeWatchPrayers(s.bridge, s.store)).toEqual([200])
    expect(s.done).toEqual(['a1', 'b2'])
  })
  it('talks to the iPhone app only where there is one', async () => {
    expect(watchBridge(undefined)).toBeUndefined()
    const sent: unknown[] = []
    const br = watchBridge({ postMessage: async m => { sent.push(m); return null } })!
    await br.next(); await br.done('a1')
    expect(sent).toEqual([{ op: 'next' }, { op: 'done', id: 'a1' }])
  })
})
const pair = (s: ReturnType<typeof setup>) => [s.bridge, s.store] as const

import { describe, expect, it } from 'vitest'
import { mergeLocal, mergeMarkText, mergeSettingsText, pack, parseMoveLink, unpack } from './move'

const bytes = (...n: number[]) => new Uint8Array(n).buffer

describe('move', () => {
  it('packs and unpacks prayers with every part', () => {
    const list = [
      { id: 'abcd1', at: 1, ms: 300, type: 'audio/mp4', audio: bytes(1, 2, 3), more: [{ ms: 100, type: 'audio/mp4', audio: bytes(4, 5) }], verse: undefined },
      { id: 'abcd2', at: 2, ms: 50, type: 'audio/webm', audio: bytes(9) },
    ]
    const packed = pack({ v: 1, from: 'https://bible.chama.community', at: 5, local: { 'plain-bible:settings': '{"theme":"sepia"}' }, prayerKey: 'k' }, list)
    const { bundle, prayers } = unpack(packed)
    expect(bundle.local['plain-bible:settings']).toBe('{"theme":"sepia"}')
    expect(bundle.prayerKey).toBe('k')
    expect(prayers.map(p => [p.id, [...new Uint8Array(p.audio)], p.more?.map(m => [...new Uint8Array(m.audio)])])).toEqual([
      ['abcd1', [1, 2, 3], [[4, 5]]],
      ['abcd2', [9], undefined],
    ])
    expect(prayers[0].ms).toBe(300)
  })

  it('reads a move link, whole or as the hash', () => {
    const id = 'A'.repeat(22), key = 'b'.repeat(43)
    expect(parseMoveLink(`https://myquietbible.com/#/move/${id}.${key}`)).toEqual({ id, key })
    expect(parseMoveLink(`  #/move/${id}.${key}\n`)).toEqual({ id, key })
    expect(parseMoveLink(`#/move/${id}.${key.slice(1)}`)).toBeUndefined()
    expect(parseMoveLink('hello')).toBeUndefined()
  })

  it('joins highlights from both sides', () => {
    const here = JSON.stringify({ 'JHN.3.16': { c: 'yellow', t: 1 } })
    const came = JSON.stringify({ 'GEN.1.1': { c: 'green', t: 2 }, 'JHN.3.16': { c: 'blue', t: 5 } })
    const out = JSON.parse(mergeMarkText(here, came))
    expect(Object.keys(out).sort()).toEqual(['GEN.1.1', 'JHN.3.16'])
    expect(out['JHN.3.16'].c).toBe('blue')
  })

  it('keeps the newest change to each setting, and takes over first-start defaults', () => {
    const here = { s: JSON.stringify({ theme: 'dark', version: 'LSG', fontSize: 22 }), t: JSON.stringify({ theme: 50, version: 10 }) }
    const came = { s: JSON.stringify({ theme: 'sepia', version: 'KJV', fontSize: 26, font: 'inter' }), t: JSON.stringify({ theme: 20, version: 30, fontSize: 5 }) }
    const m = mergeSettingsText(here, came)
    expect(JSON.parse(m.settings)).toEqual({ theme: 'dark', version: 'KJV', fontSize: 26, font: 'inter' })
    expect(JSON.parse(m.settingsT)).toEqual({ theme: 50, version: 30, fontSize: 5 })
  })

  it('replaces nothing on a device that is already set up', () => {
    const here: Record<string, string> = {
      'plain-bible:account': '{"token":"mine","rev":7}',
      'plain-bible:prayer-sync': 'mine',
      'plain-bible:history': '{"items":[1]}',
      'plain-bible:days': '{"2026-10-24":1}',
    }
    const came = {
      'plain-bible:account': '{"token":"theirs","rev":0}',
      'plain-bible:prayer-sync': 'theirs',
      'plain-bible:history': '{"items":[2]}',
      'plain-bible:days': '{"2026-10-24":2,"2026-10-20":1}',
      'plain-bible:last': 'GEN.1',
      'plain-bible:circles': '[1]',
    }
    const get = (k: string) => here[k] ?? null
    const same = mergeLocal(get, came, true, true)
    expect(same['plain-bible:account']).toBeUndefined()
    expect(same['plain-bible:prayer-sync']).toBeUndefined()
    expect(same['plain-bible:history']).toBeUndefined()
    expect(JSON.parse(same['plain-bible:days'])).toEqual({ '2026-10-24': 3, '2026-10-20': 1 })
    expect(same['plain-bible:last']).toBe('GEN.1')
    expect(same['plain-bible:circles']).toBe('[1]')
    // Another account: nothing tied to it comes in.
    const other = mergeLocal(get, came, true, false)
    expect(other['plain-bible:circles']).toBeUndefined()
    expect(other['plain-bible:last']).toBe('GEN.1')
  })

  it('takes everything on a fresh device', () => {
    const came = { 'plain-bible:account': '{"token":"t","rev":0}', 'plain-bible:prayer-sync': 'x', 'plain-bible:settings': '{"theme":"sepia"}' }
    const out = mergeLocal(() => null, came, false, true)
    expect(out['plain-bible:account']).toBe(came['plain-bible:account'])
    expect(out['plain-bible:prayer-sync']).toBe('x')
    expect(JSON.parse(out['plain-bible:settings'])).toEqual({ theme: 'sepia' })
  })
})

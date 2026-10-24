import { describe, expect, it } from 'vitest'
import { mergeMarkText, pack, parseMoveLink, unpack } from './move'

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
})

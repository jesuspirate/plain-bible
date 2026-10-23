import { describe, expect, it } from 'vitest'
import { duration, partsOf, Prayer, recordingType, withPart } from './prayers'

describe('prayers', () => {
  it('records AAC on iPhone and Opus elsewhere', () => {
    expect(recordingType(t => t === 'audio/mp4' || t.startsWith('audio/webm'))).toBe('audio/mp4')
    expect(recordingType(t => t.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus')
    expect(recordingType(() => false)).toBe('')
    expect(recordingType(() => { throw new Error('no') })).toBe('')
  })
  it('shows minutes and seconds', () => {
    expect(duration(0)).toBe('0:00')
    expect(duration(65_400)).toBe('1:05')
    expect(duration(750_000)).toBe('12:30')
  })
  it('picks a prayer up again after the phone locked', () => {
    const a = new ArrayBuffer(1), b = new ArrayBuffer(2), c = new ArrayBuffer(3)
    let p: Prayer = { id: 'x', at: 1, ms: 5000, type: 'audio/mp4', audio: a }
    expect(partsOf(p).map(x => x.ms)).toEqual([5000])
    p = withPart(p, { ms: 3000, type: 'audio/mp4', audio: b })
    p = withPart(p, { ms: 2000, type: 'audio/mp4', audio: c })
    expect(p.ms).toBe(10_000)
    expect(partsOf(p).map(x => [x.ms, x.audio.byteLength])).toEqual([[5000, 1], [3000, 2], [2000, 3]])
  })
})

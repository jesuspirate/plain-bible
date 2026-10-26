import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { defragment, lengthMs, playable } from './mp4'

// Recorded the way an iPhone records a prayer: a fragment every second,
// with every duration in the header left at 0.
const file = readFileSync('src/lib/fixtures/fragmented.m4a')
const fragmented = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer

type Box = { type: string; start: number; end: number }
function boxes(b: Uint8Array, start = 0, end = b.length): Box[] {
  const v = new DataView(b.buffer, b.byteOffset), out: Box[] = []
  for (let o = start; o < end; o += v.getUint32(o)) out.push({ type: String.fromCharCode(...b.subarray(o + 4, o + 8)), start: o, end: o + v.getUint32(o) })
  return out
}
const find = (b: Uint8Array, path: string[]) => {
  let at: Box | undefined = { type: '', start: -8, end: b.length }
  for (const p of path) at = boxes(b, at!.start + 8, at!.end).find(x => x.type === p)
  return at
}
const u32 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset).getUint32(o)
const seconds = (b: Uint8Array) => {
  const mdhd = find(b, ['moov', 'trak', 'mdia', 'mdhd'])!
  return u32(b, mdhd.start + 24) / u32(b, mdhd.start + 20)
}

describe('defragment', () => {
  it('turns an iPhone-style recording into one plain file with its full length', () => {
    const before = new Uint8Array(fragmented)
    expect(boxes(before).filter(x => x.type === 'moof').length).toBeGreaterThan(3)
    expect(seconds(before)).toBe(0)

    const after = new Uint8Array(defragment(fragmented))
    expect(boxes(after).map(x => x.type)).toEqual(['ftyp', 'moov', 'mdat'])
    expect(find(after, ['moov', 'mvex'])).toBeUndefined()
    expect(seconds(after)).toBeCloseTo(4, 1)
    const mvhd = find(after, ['moov', 'mvhd'])!
    expect(u32(after, mvhd.start + 24) / u32(after, mvhd.start + 20)).toBeCloseTo(4, 1)
  })

  it('keeps every byte of audio, in order, where the tables say it is', () => {
    const before = new Uint8Array(fragmented), after = new Uint8Array(defragment(fragmented))
    const stsz = find(after, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsz'])!
    const count = u32(after, stsz.start + 16)
    const sizes = Array.from({ length: count }, (_, i) => u32(after, stsz.start + 20 + i * 4))
    const mdat = boxes(after).find(x => x.type === 'mdat')!
    const stco = find(after, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stco'])!
    expect(u32(after, stco.start + 16)).toBe(mdat.start + 8)
    expect(sizes.reduce((n, s) => n + s, 0)).toBe(mdat.end - mdat.start - 8)
    // The same audio as all the fragments' mdat boxes put together.
    const pieces = boxes(before).filter(x => x.type === 'mdat').map(x => before.subarray(x.start + 8, x.end))
    const joined = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0))
    pieces.reduce((o, p) => { joined.set(p, o); return o + p.length }, 0)
    expect(after.subarray(mdat.start + 8, mdat.end)).toEqual(joined)
  })

  it('joins two whole files back to back, as some iPhones may write', () => {
    const two = new Uint8Array(fragmented.byteLength * 2)
    two.set(new Uint8Array(fragmented)); two.set(new Uint8Array(fragmented), fragmented.byteLength)
    expect(seconds(new Uint8Array(defragment(two.buffer)))).toBeCloseTo(8, 0)
  })

  it('leaves plain files, other formats and damaged files as they were', () => {
    const plain = defragment(fragmented)
    expect(defragment(plain)).toBe(plain)
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]).buffer
    expect(playable(webm, 'audio/webm;codecs=opus')).toBe(webm)
    expect(defragment(webm)).toBe(webm)
    const cut = fragmented.slice(0, fragmented.byteLength - 500)
    expect(defragment(cut)).toBe(cut)
  })
})

describe('lengthMs', () => {
  it('tells how much sound a recording holds, fragmented or not', () => {
    expect(lengthMs(fragmented, 'audio/mp4')).toBeCloseTo(4040, -2)
    expect(lengthMs(defragment(fragmented), 'audio/mp4')).toBeCloseTo(4040, -2)
  })
  it('a recording cut short says so, whatever the clock said', () => {
    // The first fragments only: what a microphone that went quiet leaves.
    const b = new Uint8Array(fragmented), moofs = boxes(b).filter(x => x.type === 'moof')
    const cut = fragmented.slice(0, moofs[2].start)
    expect(lengthMs(cut, 'audio/mp4')!).toBeLessThan(2500)
  })
  it('stays quiet about other formats and junk', () => {
    expect(lengthMs(fragmented, 'audio/webm')).toBeUndefined()
    expect(lengthMs(new ArrayBuffer(10), 'audio/mp4')).toBeUndefined()
  })
})

// iPhones record prayers as "fragmented" MP4: a new piece every second,
// with no length written anywhere (we ask for the audio every second, so an
// interruption loses little). iPhone playback can give up after the first
// pieces of such a file, so a 1-minute prayer stopped after a second or two.
// Before playing, the pieces are joined back into one plain MP4 with its
// length and every sample listed, which every player handles. The audio
// itself is copied as it is, never decoded again.

type Box = { type: string; start: number; end: number; body: number }

function boxes(b: Uint8Array, v: DataView, start: number, end: number): Box[] {
  const out: Box[] = []
  for (let o = start; o + 8 <= end;) {
    let size = v.getUint32(o), body = o + 8
    const type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7])
    if (size === 1) { size = Number(v.getBigUint64(o + 8)); body = o + 16 } else if (size === 0) size = end - o
    if (size < body - o || o + size > end) throw new Error('Bad box')
    out.push({ type, start: o, end: o + size, body })
    o += size
  }
  return out
}

const child = (b: Uint8Array, v: DataView, box: Box, type: string) => boxes(b, v, box.body, box.end).find(x => x.type === type)

function box(type: string, ...parts: Uint8Array[]) {
  const size = 8 + parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(size), v = new DataView(out.buffer)
  v.setUint32(0, size)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  let o = 8
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

const u32s = (...n: number[]) => { const out = new Uint8Array(n.length * 4), v = new DataView(out.buffer); n.forEach((x, i) => v.setUint32(i * 4, x)); return out }

/** One plain MP4 from a fragmented one. Anything else (or anything it can't
 *  read) comes back as it was. */
export function defragment(input: ArrayBuffer): ArrayBuffer {
  try { return join(input) ?? input } catch { return input }
}

function join(input: ArrayBuffer): ArrayBuffer | undefined {
  const b = new Uint8Array(input), v = new DataView(input)
  const top = boxes(b, v, 0, b.length)
  const ftyp = top.find(x => x.type === 'ftyp'), moov = top.find(x => x.type === 'moov')
  if (!ftyp || !moov || !top.some(x => x.type === 'moof')) return
  const traks = boxes(b, v, moov.body, moov.end).filter(x => x.type === 'trak')
  if (traks.length !== 1) return
  const trak = traks[0]
  const mdia = child(b, v, trak, 'mdia')!, mdhd = child(b, v, mdia, 'mdhd')!
  const stbl = child(b, v, child(b, v, mdia, 'minf')!, 'stbl')!, stsd = child(b, v, stbl, 'stsd')!
  const mvhd = child(b, v, moov, 'mvhd')!
  const trex = (() => { const mvex = child(b, v, moov, 'mvex'); return mvex && child(b, v, mvex, 'trex') })()
  const def = { dur: trex ? v.getUint32(trex.body + 12) : 0, size: trex ? v.getUint32(trex.body + 16) : 0 }

  // Every sample, in order: where it is, how big, how long.
  const sizes: number[] = [], durs: number[] = [], at: number[] = []
  let file = 0
  for (const t of top) {
    if (t.type === 'ftyp') file = t.start // a second file glued on the end
    if (t.type !== 'moof') continue
    for (const traf of boxes(b, v, t.body, t.end).filter(x => x.type === 'traf')) {
      const tfhd = child(b, v, traf, 'tfhd')!
      const tf = v.getUint32(tfhd.body) & 0xffffff
      let o = tfhd.body + 8
      let base = t.start
      if (tf & 0x1) { base = file + Number(v.getBigUint64(o)); o += 8 }
      if (tf & 0x2) o += 4
      const dDur = tf & 0x8 ? v.getUint32(o) : def.dur; if (tf & 0x8) o += 4
      const dSize = tf & 0x10 ? v.getUint32(o) : def.size
      let next = base
      for (const trun of boxes(b, v, traf.body, traf.end).filter(x => x.type === 'trun')) {
        const f = v.getUint32(trun.body) & 0xffffff, n = v.getUint32(trun.body + 4)
        let p = trun.body + 8
        if (f & 0x1) { next = base + v.getInt32(p); p += 4 }
        if (f & 0x4) p += 4
        for (let i = 0; i < n; i++) {
          const d = f & 0x100 ? v.getUint32(p) : dDur; if (f & 0x100) p += 4
          const s = f & 0x200 ? v.getUint32(p) : dSize; if (f & 0x200) p += 4
          if (f & 0x400) p += 4
          if (f & 0x800) p += 4
          if (next + s > b.length) throw new Error('Sample past the end')
          sizes.push(s); durs.push(d); at.push(next)
          next += s
        }
      }
    }
  }
  if (!sizes.length) return

  const media = durs.reduce((n, d) => n + d, 0)
  const mediaScale = v.getUint32(mdhd.body + (b[mdhd.body] === 1 ? 20 : 12))
  const movieScale = v.getUint32(mvhd.body + (b[mvhd.body] === 1 ? 20 : 12))
  const movie = Math.round(media * movieScale / mediaScale)
  // A copy of a header box with its duration filled in.
  const timed = (x: Box, v0: number, v1: number, d: number) => {
    const out = b.slice(x.start, x.end), w = new DataView(out.buffer), h = x.body - x.start
    if (out[h] === 1) w.setBigUint64(h + v1, BigInt(d)); else w.setUint32(h + v0, d)
    return out
  }

  const stts: number[] = []
  for (const d of durs) {
    if (stts.length && stts[stts.length - 1] === d) stts[stts.length - 2]++
    else stts.push(1, d)
  }
  const head = b.slice(ftyp.start, ftyp.end)
  const build = (mdatAt: number) => {
    const table = box('stbl', b.slice(stsd.start, stsd.end),
      box('stts', u32s(0, stts.length / 2, ...stts)),
      box('stsc', u32s(0, 1, 1, sizes.length, 1)),
      box('stsz', u32s(0, 0, sizes.length, ...sizes)),
      box('stco', u32s(0, 1, mdatAt)))
    const minf = child(b, v, mdia, 'minf')!
    const minfOut = box('minf', ...boxes(b, v, minf.body, minf.end).map(x => x.type === 'stbl' ? table : b.slice(x.start, x.end)))
    const mdiaOut = box('mdia', ...boxes(b, v, mdia.body, mdia.end).map(x =>
      x.type === 'mdhd' ? timed(x, 16, 24, media) : x.type === 'minf' ? minfOut : b.slice(x.start, x.end)))
    const trakOut = box('trak', ...boxes(b, v, trak.body, trak.end).filter(x => x.type !== 'edts').map(x =>
      x.type === 'tkhd' ? timed(x, 20, 28, movie) : x.type === 'mdia' ? mdiaOut : b.slice(x.start, x.end)))
    return box('moov', ...boxes(b, v, moov.body, moov.end).filter(x => x.type !== 'mvex').map(x =>
      x.type === 'mvhd' ? timed(x, 16, 24, movie) : x.type === 'trak' ? trakOut : b.slice(x.start, x.end)))
  }
  // The moov's size doesn't depend on where the audio starts.
  const moovOut = build(head.length + build(0).length + 8)
  const total = sizes.reduce((n, s) => n + s, 0)
  const out = new Uint8Array(head.length + moovOut.length + 8 + total)
  out.set(head); out.set(moovOut, head.length)
  let o = head.length + moovOut.length
  new DataView(out.buffer).setUint32(o, 8 + total); out.set([0x6d, 0x64, 0x61, 0x74], o + 4); o += 8
  for (let i = 0; i < sizes.length; i++) { out.set(b.subarray(at[i], at[i] + sizes[i]), o); o += sizes[i] }
  return out.buffer
}

/** A recording, ready for any player. */
export const playable = (audio: ArrayBuffer, type: string) => /mp4|m4a|aac/i.test(type) ? defragment(audio) : audio

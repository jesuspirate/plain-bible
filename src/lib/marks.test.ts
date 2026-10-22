import { describe, expect, it } from 'vitest'
import { htmlToText, Mark, mergeImport, mergeMark, noteCovering, parseNotes, parseRefList, setNote } from './marks'

// Same shape as a typical Bible app export.
const HIGHLIGHTS = `<!DOCTYPE html><html><head><style>body {margin: 2em;}</style></head>
<body>Genesis 2:4 NIV  #b3e487<br>Genèse 2:17 LBS21  #ffadaf<br>Esaïe 41:10 LBS21  #b3e487<br>Psalm 51:1 AMP  #fff193<br>Actes des apôtres 4:32 LBS21  #b3e487<br>1 Corinthiens 13:4 LBS21  #b3e487<br>Apocalypse 3:7 LBS21  #fff193<br>Nowhere 1:1 X  #ffffff<br>
</body></html>`
const SAVES = '<html><body>Genesis 22:2<br>Isaiah 41:10<br>Matthew 26:17<br>Acts 4:32<br></body></html>'

describe('reference list import', () => {
  it('reads highlights with colors and versions', () => {
    const r = parseRefList(htmlToText(HIGHLIGHTS))
    expect(r.items.map(i => `${i.book}.${i.chapter}.${i.verse} ${i.color} ${i.version}`)).toEqual([
      'Gen.2.4 #b3e487 NIV', 'Gen.2.17 #ffadaf LBS21', 'Isa.41.10 #b3e487 LBS21', 'Ps.51.1 #fff193 AMP',
      'Acts.4.32 #b3e487 LBS21', '1Cor.13.4 #b3e487 LBS21', 'Rev.3.7 #fff193 LBS21',
    ])
    expect(r.items.every(i => !i.bookmark)).toBe(true)
    expect(r.skipped).toEqual(['Nowhere 1:1 X #ffffff'])
  })
  it('reads saved verses as bookmarks', () => {
    const r = parseRefList(htmlToText(SAVES))
    expect(r.items.map(i => `${i.book}.${i.chapter}.${i.verse}`)).toEqual(['Gen.22.2', 'Isa.41.10', 'Matt.26.17', 'Acts.4.32'])
    expect(r.items.every(i => i.bookmark)).toBe(true)
  })
  it('merges into existing marks', () => {
    const a = mergeImport({}, parseRefList(htmlToText(HIGHLIGHTS)).items, 1)
    const b = mergeImport(a.marks, parseRefList(htmlToText(SAVES)).items, 2)
    expect(b.marks['Isa.41.10']).toEqual({ c: '#b3e487', v: 'LBS21', b: 1, t: 2 })
    expect(a.highlights).toBe(7)
    expect(b.bookmarks).toBe(4)
  })
  it('expands verse ranges', () => {
    expect(parseRefList('John 3:16-18').items.length).toBe(3)
  })
})

describe('notes', () => {
  it('sets, edits and deletes a note, keeping a record of the deletion', () => {
    let m = setNote({ 'John.3.16': { c: '#fff193', t: 1 } }, 'John.3.16', '  For God so loved  ', 5)
    expect(m['John.3.16']).toEqual({ c: '#fff193', n: 'For God so loved', t: 5, nt: 5 })
    m = setNote(m, 'John.3.16', '', 6)
    expect(m['John.3.16']).toEqual({ c: '#fff193', t: 6, nt: 6 })
    m = setNote({}, 'Gen.1.1', 'x', 7)
    expect(setNote(m, 'Gen.1.1', '', 8)['Gen.1.1']).toEqual({ t: 8, nt: 8 })
  })
  it('merges notes separately from highlights', () => {
    // Note written on one device, highlight added later on another.
    const a: Mark = { n: 'mine', nt: 10, t: 10 }
    const b: Mark = { c: '#b3e487', t: 20 }
    expect(mergeMark(a, b)).toEqual({ c: '#b3e487', n: 'mine', nt: 10, t: 20 })
    expect(mergeMark(b, a)).toEqual({ c: '#b3e487', n: 'mine', nt: 10, t: 20 })
    // A later deletion wins over the older note.
    expect(mergeMark({ c: '#b3e487', t: 20, nt: 30 }, a)).toEqual({ c: '#b3e487', t: 20, nt: 30 })
  })
  it('reads a notes export', () => {
    const html = `<html><head><style>h3{}</style></head><body>
      <h3>Trust</h3>Isaiah 41:10 NIV<blockquote>So do not fear, for I am with you</blockquote>Read this when anxious.<br>Second line<hr>
      <h3>Love</h3>1 Corinthiens 13:4-7 LBS21<br>Patience first<hr>Nowhere 1:1<br>text</body></html>`
    const r = parseNotes(html)
    expect(r.items).toEqual([
      { book: 'Isa', chapter: 41, verse: 10, note: 'Trust\nRead this when anxious.\nSecond line' },
      { book: '1Cor', chapter: 13, verse: 4, note: 'Love\nPatience first' },
    ])
    const merged = mergeImport({ 'Isa.41.10': { n: 'old', nt: 1, t: 1 } }, r.items, 9)
    expect(merged.notes).toBe(2)
    expect(merged.marks['Isa.41.10'].n).toBe('old\n\nTrust\nRead this when anxious.\nSecond line')
  })
})

describe('note merge', () => {
  it('keeps a note both sides already share (every sync after writing one)', () => {
    const a: Mark = { n: 'x', nt: 5, t: 5 }
    expect(mergeMark(a, { ...a })).toEqual(a)
    expect(mergeMark({ c: '#fff193', t: 9 }, { n: 'x', nt: 9, t: 9 })).toMatchObject({ n: 'x', nt: 9 })
  })
})

describe('passage notes', () => {
  it('keeps the verses a note covers and finds it from any of them', () => {
    const m = setNote({}, 'John.3.16', 'For God so loved', 5, [16, 17, 18])
    expect(m['John.3.16']).toEqual({ n: 'For God so loved', nt: 5, t: 5, nv: [16, 17, 18] })
    expect(noteCovering(m, 'John', 3, 17)).toBe(16)
    expect(noteCovering(m, 'John', 3, 19)).toBeUndefined()
    expect(setNote(m, 'John.3.16', 'Just this one', 6)['John.3.16'].nv).toBeUndefined()
  })
  it('merges the verses along with the note, and keeps a note both sides share', () => {
    const a: Mark = { n: 'x', nt: 5, t: 5, nv: [1, 2] }
    expect(mergeMark(a, { c: '#fff193', t: 9 })).toEqual({ c: '#fff193', t: 9, n: 'x', nt: 5, nv: [1, 2] })
    expect(mergeMark(a, { ...a })).toEqual(a)
  })
})

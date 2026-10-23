import { describe, expect, it } from 'vitest'
import { htmlToText, loadMarks, Mark, mergeImport, mergeMark, notesCovering, notesOf, parseNotes, parseRefList, setNote, upgrade } from './marks'

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
    let m = setNote({ 'John.3.16': { c: '#fff193', t: 1 } }, 'John.3.16', 'a', '  For God so loved  ', 5)
    expect(m['John.3.16']).toEqual({ c: '#fff193', t: 1, ns: { a: { n: 'For God so loved', c: 5, t: 5 } } })
    m = setNote(m, 'John.3.16', 'a', 'Edited', 6)
    expect(m['John.3.16'].ns!.a).toEqual({ n: 'Edited', c: 5, t: 6 })
    m = setNote(m, 'John.3.16', 'a', '', 7)
    expect(m['John.3.16']).toEqual({ c: '#fff193', t: 1, ns: { a: { c: 5, t: 7 } } })
    m = setNote({}, 'Gen.1.1', 'x', 'x', 7)
    expect(setNote(m, 'Gen.1.1', 'x', '', 8)['Gen.1.1']).toEqual({ t: 7, ns: { x: { c: 7, t: 8 } } })
    // Clearing a note that was never written changes nothing.
    expect(setNote({}, 'Gen.1.1', 'y', '  ', 9)).toEqual({})
  })
  it('keeps several notes on one verse, oldest first', () => {
    let m = setNote({}, 'Ps.23.1', 'b', 'Prayer', 20)
    m = setNote(m, 'Ps.23.1', 'a', 'Study', 10)
    m = setNote(m, 'Ps.23.1', 'b', 'Prayer, answered', 30)
    expect(notesOf(m['Ps.23.1']).map(x => x.n)).toEqual(['Study', 'Prayer, answered'])
    m = setNote(m, 'Ps.23.1', 'a', '', 40)
    expect(notesOf(m['Ps.23.1']).map(x => x.id)).toEqual(['b'])
  })
  it('merges each note on its own, and separately from highlights', () => {
    // Different notes written on two devices: both are kept.
    const a: Mark = { t: 10, ns: { x: { n: 'study', c: 10, t: 10 } } }
    const b: Mark = { c: '#b3e487', t: 20, ns: { y: { n: 'prayer', c: 15, t: 15 } } }
    const ab = mergeMark(a, b)!, ba = mergeMark(b, a)!
    expect(ab).toEqual(ba)
    expect(ab.c).toBe('#b3e487')
    expect(notesOf(ab).map(x => x.n)).toEqual(['study', 'prayer'])
    // The same note edited on both: the later edit wins.
    const e1: Mark = { t: 1, ns: { x: { n: 'v1', c: 1, t: 50 } } }
    expect(notesOf(mergeMark(a, e1)).map(x => x.n)).toEqual(['v1'])
    // A later deletion wins over the older note; the other note stays.
    const del: Mark = { t: 1, ns: { x: { c: 10, t: 60 } } }
    expect(notesOf(mergeMark(ab, del)).map(x => x.n)).toEqual(['prayer'])
    // A tie goes to the deletion, either way round.
    const tie: Mark = { t: 1, ns: { x: { c: 10, t: 10 } } }
    expect(notesOf(mergeMark(a, tie))).toEqual([])
    expect(notesOf(mergeMark(tie, a))).toEqual([])
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
    // The imported note sits next to the one already there.
    expect(notesOf(merged.marks['Isa.41.10']).map(x => x.n)).toEqual(['old', 'Trust\nRead this when anxious.\nSecond line'])
    // Importing again doesn't double it.
    expect(notesOf(mergeImport(merged.marks, r.items, 10).marks['Isa.41.10']).length).toBe(2)
  })
})

describe('older single notes', () => {
  it('move into the notes list without being lost', () => {
    expect(upgrade({ c: '#fff193', n: 'mine', nt: 5, t: 9 })).toEqual({ c: '#fff193', t: 9, ns: { '0': { n: 'mine', c: 5, t: 5 } } })
    expect(upgrade({ n: 'p', nv: [1, 2, 3], nt: 5, t: 5 }).ns!['0']).toEqual({ n: 'p', v: [1, 2, 3], c: 5, t: 5 })
    // A deleted one stays deleted.
    expect(upgrade({ t: 8, nt: 8 })).toEqual({ t: 8, ns: { '0': { c: 8, t: 8 } } })
    expect(upgrade({ c: '#fff193', t: 1 })).toEqual({ c: '#fff193', t: 1 })
  })
  it('are moved when loading', () => {
    const saved = JSON.stringify({ 'Exod.2.1': { n: 'Moses', nv: [1, 2, 3, 4], nt: 3, t: 3 } })
    ;(globalThis as any).localStorage = { getItem: () => saved }
    const m = loadMarks()
    delete (globalThis as any).localStorage
    expect(notesCovering(m, 'Exod', 2, 3).map(x => [x.n, x.key, x.verses])).toEqual([['Moses', 'Exod.2.1', [1, 2, 3, 4]]])
  })
  it('merge with a device that already moved them, without doubling', () => {
    const old: Mark = { n: 'x', nt: 5, t: 5 }
    const moved = upgrade(old)
    expect(mergeMark(old, moved)).toEqual(moved)
    expect(mergeMark(moved, old)).toEqual(moved)
    // An old device's later edit still counts.
    expect(notesOf(mergeMark(moved, { n: 'x2', nt: 9, t: 9 })).map(x => x.n)).toEqual(['x2'])
  })
})

describe('passage notes', () => {
  it('keeps the verses a note covers and finds it from any of them', () => {
    let m = setNote({}, 'John.3.16', 'a', 'For God so loved', 5, [16, 17, 18])
    expect(m['John.3.16'].ns!.a).toEqual({ n: 'For God so loved', c: 5, t: 5, v: [16, 17, 18] })
    m = setNote(m, 'John.3.17', 'b', 'Not to condemn', 6)
    m = setNote(m, 'John.3.16', 'c', 'A prayer on the same verses', 7, [16, 17, 18])
    expect(notesCovering(m, 'John', 3, 17).map(x => x.id)).toEqual(['a', 'b', 'c'])
    expect(notesCovering(m, 'John', 3, 16).map(x => x.id)).toEqual(['a', 'c'])
    expect(notesCovering(m, 'John', 3, 19)).toEqual([])
  })
})

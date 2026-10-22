import { describe, expect, it } from 'vitest'
import { htmlToText, mergeImport, parseRefList } from './marks'

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

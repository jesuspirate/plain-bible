import { describe, expect, it } from 'vitest'
import { docKey, mergeDocs, SyncDoc } from './sync'

const doc = (marks: SyncDoc['marks'], settingsT = 0, settings = {}): SyncDoc => ({ v: 1, marks, settings, settingsT })

describe('mergeDocs', () => {
  it('keeps the newest mark per verse, including removals', () => {
    const a = doc({ 'John.3.16': { c: '#fff193', t: 10 }, 'Gen.1.1': { b: 1, t: 5 } })
    const b = doc({ 'John.3.16': { t: 20 }, 'Gen.1.1': { b: 1, c: '#b3e487', t: 1 }, 'Ps.23.1': { c: '#cae1fe', t: 3 } })
    const m = mergeDocs(a, b).marks
    expect(m['John.3.16']).toEqual({ t: 20 })
    expect(m['Gen.1.1']).toEqual({ b: 1, t: 5 })
    expect(m['Ps.23.1'].c).toBe('#cae1fe')
  })
  it('keeps the newest value of each setting', () => {
    const a = { v: 1 as const, marks: {}, settings: { favorite: 'LSG', theme: 'dark' }, settingsT: { favorite: 50, theme: 10 } }
    const b = { v: 1 as const, marks: {}, settings: { favorite: 'KJV', theme: 'sepia' }, settingsT: { favorite: 5, theme: 90 } }
    expect(mergeDocs(a, b).settings).toEqual({ favorite: 'LSG', theme: 'sepia' })
    expect(mergeDocs(b, a).settings).toEqual({ favorite: 'LSG', theme: 'sepia' })
  })
  it('treats an old single timestamp as applying to every setting', () => {
    expect(mergeDocs(doc({}, 5, { theme: 'dark' }), doc({}, 9, { theme: 'sepia' })).settings).toEqual({ theme: 'sepia' })
    expect(mergeDocs(doc({}, 9, { theme: 'dark' }), doc({}, 5, { theme: 'sepia' })).settings).toEqual({ theme: 'dark' })
  })
  it('handles an empty remote', () => {
    const a = doc({ 'John.1.1': { c: '#fff193', t: 1 } }, 3)
    expect(mergeDocs(a, null)).toBe(a)
  })
  it('compares documents regardless of key order', () => {
    expect(docKey(doc({ a: { t: 1 }, b: { t: 2, b: 1 } }))).toBe(docKey(doc({ b: { b: 1, t: 2 }, a: { t: 1 } })))
  })
})

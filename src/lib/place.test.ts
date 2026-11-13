import { describe, expect, it } from 'vitest'
import { deviceKind, newerPlace, parsePlace, parseSynced, stamp, withoutVerse, worthOffering, type SyncedPlace } from './place'
import { docKey, mergeDocs, type SyncDoc } from './sync'

describe('reading place', () => {
  it('reads the saved verse', () => {
    expect(parsePlace('{"book":"John","chapter":3,"verse":16}')).toEqual({ book: 'John', chapter: 3, verse: 16 })
  })
  it('reads the older book-and-chapter format as verse 1', () => {
    expect(parsePlace('["Ps",23]')).toEqual({ book: 'Ps', chapter: 23, verse: 1 })
  })
  it('ignores nothing or garbage', () => {
    expect(parsePlace(null)).toBeUndefined()
    expect(parsePlace('not json')).toBeUndefined()
    expect(parsePlace('{"chapter":3}')).toBeUndefined()
  })
  it('drops the jump-to verse from an address', () => {
    expect(withoutVerse('#/read/KJV/John/3?v=16')).toBe('#/read/KJV/John/3')
    expect(withoutVerse('#/read/KJV/John/3?v=16&p=BSB')).toBe('#/read/KJV/John/3?p=BSB')
    expect(withoutVerse('#/read/KJV/John/3?p=BSB')).toBe('#/read/KJV/John/3?p=BSB')
    expect(withoutVerse('#/read/KJV/John/3?at=7&p=BSB')).toBe('#/read/KJV/John/3?p=BSB')
    expect(withoutVerse('#/read/KJV/John/3?p=BSB&v=16')).toBe('#/read/KJV/John/3?p=BSB')
  })
})

describe('the place that travels with the account', () => {
  const phone: SyncedPlace = { book: 'Rom', chapter: 8, verse: 14, t: 2000, dev: 'a', on: 'iphone' }
  const mac: SyncedPlace = { book: 'Gen', chapter: 1, verse: 1, t: 1000, dev: 'b', on: 'mac' }
  const doc = (place?: SyncedPlace): SyncDoc => ({ v: 1, marks: {}, settings: {}, settingsT: {}, ...(place ? { place } : {}) })

  it('stamps a place only when you moved there yourself', () => {
    const last = { book: 'Gen', chapter: 1, verse: 3, t: 50, version: 'KJV' }
    // The page settling as the app opens: not you.
    expect(stamp({ book: 'Gen', chapter: 1, verse: 4 }, last, false, 99).t).toBe(50)
    // The same verse saved again: nothing new.
    expect(stamp({ book: 'Gen', chapter: 1, verse: 3 }, last, true, 99).t).toBe(50)
    expect(stamp({ book: 'Gen', chapter: 1, verse: 9 }, last, true, 99)).toEqual({ book: 'Gen', chapter: 1, verse: 9, version: 'KJV', t: 99 })
    // A place from before this existed has no time, and gets none by itself.
    expect(stamp({ book: 'Gen', chapter: 1, verse: 1 }, { book: 'Gen', chapter: 1, verse: 1 }, false, 99).t).toBeUndefined()
    // Another chapter doesn't inherit the version.
    expect(stamp({ book: 'Exod', chapter: 2, verse: 1 }, last, true, 99).version).toBeUndefined()
  })
  it('keeps the newest place when documents merge, either way round', () => {
    expect(mergeDocs(doc(mac), doc(phone)).place).toEqual(phone)
    expect(mergeDocs(doc(phone), doc(mac)).place).toEqual(phone)
    expect(mergeDocs(doc(), doc(phone)).place).toEqual(phone)
    expect(mergeDocs(doc(mac), doc()).place).toEqual(mac)
    expect('place' in mergeDocs(doc(), doc())).toBe(false)
    expect(newerPlace(mac, { ...mac, dev: 'c' })).toBe(mac)
  })
  it('tells documents apart by their place', () => {
    expect(docKey(doc(phone))).not.toBe(docKey(doc(mac)))
    expect(docKey(doc(phone))).not.toBe(docKey(doc({ ...phone, s: { q: 'riche', base: 'LSG', at: 6 } })))
    expect(docKey(doc())).toBe(docKey({ v: 1, marks: {}, settings: {}, settingsT: {} }))
  })
  it('drops anything that is not a place', () => {
    expect(parseSynced(null)).toBeUndefined()
    expect(parseSynced({ book: 'Rom', chapter: 8 })).toBeUndefined()
    expect(parseSynced({ ...phone, on: 'toaster', extra: 1, s: { q: 'x'.repeat(500), base: 'KJV', at: 0 } })).toEqual({ ...phone, on: 'computer' })
    expect(parseSynced({ ...phone, s: { q: 'riche', base: 'LSG', picked: ['LSG', 'KJV'], at: 6, scroll: 40 } })?.s).toEqual({ q: 'riche', base: 'LSG', picked: ['LSG', 'KJV'], at: 6 })
  })
  it('offers only a later place, somewhere else, not yet answered', () => {
    expect(worthOffering(phone, mac, 0)).toBe(true)
    expect(worthOffering(phone, { book: 'Gen', chapter: 1, verse: 1 }, 0)).toBe(true)
    expect(worthOffering(phone, undefined, 0)).toBe(true)
    expect(worthOffering(mac, phone, 0)).toBe(false)
    expect(worthOffering(phone, mac, 2000)).toBe(false)
    expect(worthOffering(phone, { ...phone, t: 10, verse: 2 }, 0)).toBe(false)
    expect(worthOffering({ ...phone, s: { q: 'riche', base: 'LSG', at: 6 } }, { ...phone, t: 10 }, 0)).toBe(true)
    expect(worthOffering(undefined, mac, 0)).toBe(false)
  })
  it('names the kind of device', () => {
    expect(deviceKind('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5)).toBe('iphone')
    expect(deviceKind('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe('ipad')
    expect(deviceKind('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe('mac')
    expect(deviceKind('Mozilla/5.0 (Linux; Android 14; Pixel 8)', 5)).toBe('android')
    expect(deviceKind('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0)).toBe('computer')
  })
})

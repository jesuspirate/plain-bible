import { describe, expect, it } from 'vitest'
import { parsePlace, withoutVerse } from './place'

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
  })
})

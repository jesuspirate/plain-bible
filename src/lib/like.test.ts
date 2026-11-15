import { describe, expect, it } from 'vitest'
import { LIKE, likeMatches } from './like'

describe('likeMatches', () => {
  it('finds the free version for a well-known name', () => {
    expect(likeMatches('BSB', 'niv')).toBe(true)
    expect(likeMatches('UKJV', 'nkjv')).toBe(true)
    expect(likeMatches('LSG', 'segond 21')).toBe(true)
    expect(likeMatches('SpaRV', 'rvr1960')).toBe(true)
    expect(likeMatches('BSB', 'nasb')).toBe(true)
  })
  it('does not match short or unrelated text', () => {
    expect(likeMatches('BSB', 'n')).toBe(false)
    expect(likeMatches('BSB', 'nkjv')).toBe(false)
    expect(likeMatches('KJV', 'niv')).toBe(false)
    expect(likeMatches('BSB', '')).toBe(false)
  })
  it('names only versions the app has a hint for', () => {
    expect(Object.keys(LIKE).sort()).toEqual(['BBE', 'BSB', 'LSG', 'SpaRV', 'UKJV'])
  })
})

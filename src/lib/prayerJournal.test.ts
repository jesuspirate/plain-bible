import { describe, expect, it } from 'vitest'
import { byMonth, cleanJournal, finds, longDuration, sameJournal, topicsOf } from './prayerJournal'

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime()

describe('prayer journal', () => {
  it('keeps only what is set', () => {
    expect(cleanJournal(undefined)).toEqual({})
    expect(cleanJournal({ fav: false, name: '  ', topic: 3, answered: 'x' })).toEqual({})
    expect(cleanJournal({ fav: true, name: ' For the children ', topic: 'Family', answered: 5, other: 1 })).toEqual({ fav: true, name: 'For the children', topic: 'Family', answered: 5 })
    expect(cleanJournal({ name: 'x'.repeat(200) }).name).toHaveLength(80)
    expect(sameJournal({ fav: false }, {})).toBe(true)
    expect(sameJournal({ fav: true }, {})).toBe(false)
  })
  it('lists this month by day and folds earlier months', () => {
    const list = [at(2026, 11, 10, 11), at(2026, 11, 10, 3), at(2026, 11, 9), at(2026, 10, 29), at(2026, 10, 3), at(2025, 12, 25)].map(at => ({ at }))
    const { days, months } = byMonth(list, at(2026, 11, 10, 12))
    expect(days.map(d => [d.day, d.list.length])).toEqual([['2026-11-10', 2], ['2026-11-09', 1]])
    expect(months.map(m => [m.month, m.list.length])).toEqual([['2026-10', 2], ['2025-12', 1]])
    expect(byMonth([], at(2026, 11, 10))).toEqual({ days: [], months: [] })
  })
  it('finds by verse, date or name, whatever the accents', () => {
    const shown = ['Éphésiens 6:18', 'samedi 7 novembre 2026', 'Pour les enfants']
    expect(finds('eph 6', shown)).toBe(true)
    expect(finds('Éphésiens 6:18', shown)).toBe(true)
    expect(finds('7 nov', shown)).toBe(true)
    expect(finds('enfants', shown)).toBe(true)
    expect(finds('psaume', shown)).toBe(false)
    expect(finds('hesiens', shown)).toBe(false)
    expect(finds('', shown)).toBe(true)
  })
  it('says how long a group lasts', () => {
    expect(longDuration(20_000)).toBe('1 min')
    expect(longDuration(54 * 60_000)).toBe('54 min')
    expect(longDuration(89 * 60_000)).toBe('1 h 29')
  })
  it('offers its topics, then yours in the order you made them', () => {
    expect(topicsOf([])).toEqual(['Thanks', 'Family', 'Healing', 'Guidance', 'Church'])
    expect(topicsOf([{ topic: 'Work' }, {}, { topic: 'Family' }, { topic: 'Neighbors' }, { topic: 'Work' }]).slice(5)).toEqual(['Work', 'Neighbors'])
  })
})

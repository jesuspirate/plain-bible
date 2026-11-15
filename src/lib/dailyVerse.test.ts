import { describe, expect, it } from 'vitest'
import { BOOK_INDEX } from './books'
import { DAILY, dailyPayload, dayNumber, savedVerses, verseForDay } from './dailyVerse'
import type { Bible } from './data'

// A tiny Bible: John 3:16 and Psalm 119:105 only, and one very long verse.
const bible: Bible = {
  id: 'KJV',
  books: {
    John: [[], [], Array.from({ length: 16 }, (_, i) => i === 15 ? 'For God so {loved|G25} the world.' : 'x'.repeat(300))],
    Ps: Array.from({ length: 119 }, (_, c) => c === 118 ? Array.from({ length: 105 }, (_, i) => i === 104 ? 'Thy word is a lamp.' : 'y') : []),
  },
}

describe('verse of the day', () => {
  it('names only books the app knows, once each', () => {
    for (const r of DAILY) expect(BOOK_INDEX[r.book], r.book).toBeDefined()
    const keys = DAILY.map(r => `${r.book} ${r.chapter}:${r.verse}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('counts days by the calendar here', () => {
    expect(dayNumber(new Date(1970, 0, 1, 23, 59))).toBe(0)
    expect(dayNumber(new Date(2026, 10, 15, 0, 1))).toBe(dayNumber(new Date(2026, 10, 15, 23, 59)))
    expect(dayNumber(new Date(2026, 10, 16))).toBe(dayNumber(new Date(2026, 10, 15)) + 1)
  })

  it('reads the day’s verse in your Bible, skipping ones it lacks', () => {
    // Day 0 is Psalm 119:105, day 1 John 3:16; day 2 onward has none here and goes round.
    expect(verseForDay(bible, 'KJV', 0)).toEqual({ l: 'Psalm 119:105', t: 'Thy word is a lamp.', p: 'read/KJV/Ps/119?v=105' })
    expect(verseForDay(bible, 'KJV', 1)).toEqual({ l: 'John 3:16', t: 'For God so loved the world.', p: 'read/KJV/John/3?v=16' })
    expect(verseForDay(bible, 'KJV', 2)?.p).toBe('read/KJV/Ps/119?v=105')
    expect(verseForDay({ id: 'X', books: {} }, 'X', 0)).toBeUndefined()
  })

  it('hands over your highlights and bookmarks, latest first, leaving out the rest', () => {
    const saved = savedVerses(bible, 'KJV', {
      'John.3.16': { b: 1, t: 1 },
      'Ps.119.105': { c: '#fff193', t: 2 },
      'John.3.1': { c: '#fff193', t: 3 }, // too long for a widget
      'Ps.119.1': { t: 4 }, // taken off
    })
    expect(saved.map(v => v.l)).toEqual(['Psalm 119:105', 'John 3:16'])
  })

  it('gives a month of days', () => {
    const p = dailyPayload(bible, 'KJV', {}, new Date(2026, 10, 15))
    expect(p.days).toHaveLength(31)
    expect(p.days[0].d).toBe(dayNumber(new Date(2026, 10, 15)))
    expect(p.saved).toEqual([])
  })
})

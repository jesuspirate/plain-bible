import { describe, expect, it } from 'vitest'
import { chapterUrl, locate, nextTimed, recordingsFor, verseTimes, RECORDINGS } from './recordings'

describe('recorded readings', () => {
  it('knows which Bibles have one', () => {
    expect(recordingsFor('BSB').map(r => r.id)).toEqual(['hays'])
    expect(recordingsFor('LSG')).toEqual([])
  })

  it('finds a chapter’s file as its publisher names it', () => {
    const [hays] = recordingsFor('BSB')
    expect(chapterUrl(hays, 'Gen', 1)).toBe('https://openbible.com/audio/hays/BSB_01_Gen_001_H.mp3')
    expect(chapterUrl(hays, 'Ps', 119)).toBe('https://openbible.com/audio/hays/BSB_19_Psa_119_H.mp3')
    expect(chapterUrl(hays, 'Rev', 22)).toBe('https://openbible.com/audio/hays/BSB_66_Rev_022_H.mp3')
  })

  it('has no file for a book outside the 66', () => {
    expect(chapterUrl(RECORDINGS[0], '1En', 1)).toBeUndefined()
    expect(chapterUrl(RECORDINGS[0], 'Nope', 1)).toBeUndefined()
  })

  it('reads a verse’s word times', () => {
    // Starts at 3.98 s; the next words 0.17 s and 0.13 s later; the last one is 0.23 s long.
    const v = verseTimes([398, 17, 13, 23])!
    expect(v.starts.map(x => +x.toFixed(2))).toEqual([3.98, 4.15, 4.28])
    expect(+v.end.toFixed(2)).toBe(4.51)
    expect(verseTimes([])).toBeUndefined()
    expect(verseTimes(undefined)).toBeUndefined()
  })

  const chapter = [verseTimes([400, 50, 50, 30]), undefined, verseTimes([1000, 100, 40])]

  it('tells which verse and word a moment is in', () => {
    expect(locate(chapter, 1)).toBeUndefined() // the chapter's name
    expect(locate(chapter, 4)).toEqual({ verse: 1, word: 0 })
    expect(locate(chapter, 4.6)).toEqual({ verse: 1, word: 1 })
    expect(locate(chapter, 7)).toEqual({ verse: 1, word: 2 }) // the quiet after a verse
    expect(locate(chapter, 10)).toEqual({ verse: 3, word: 0 })
    expect(locate(chapter, 99)).toEqual({ verse: 3, word: 1 })
  })

  it('skips a verse the recording has nothing for', () => {
    expect(nextTimed(chapter, 1)).toBe(1)
    expect(nextTimed(chapter, 2)).toBe(3)
    expect(nextTimed(chapter, 4)).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import { Bible } from './data'
import { inYourBible, readerVersions, wordsIn } from './passage'

const bibles: Record<string, Bible> = {
  KJV: { id: 'KJV', books: { John: [[], [], Array.from({ length: 36 }, (_, i) => i === 15 ? 'For God so loved the world' : i === 16 ? 'For God sent not his Son' : 'x')] } },
  LSG: { id: 'LSG', books: { John: [[], [], Array.from({ length: 36 }, (_, i) => i === 15 ? 'Car Dieu a tant aimé le monde' : 'y')] } },
  // a Bible that numbers John 3 differently
  ODD: { id: 'ODD', books: { John: [[], [], Array.from({ length: 37 }, () => 'z')] } },
  NT: { id: 'NT', books: {} },
}
const load = async (id: string) => { if (!bibles[id]) throw new Error('offline'); return bibles[id] }
const john = (...verses: number[]) => ({ book: 'John', chapter: 3, verses })
const theirs = { text: 'For God so loved the world', version: 'KJV', size: 36 }

describe('a shared verse, in the reader’s Bible', () => {
  it('reads it in yours, not the sender’s', async () => {
    expect(await inYourBible(load, ['LSG'], john(16), theirs)).toEqual({ text: 'Car Dieu a tant aimé le monde', version: 'LSG', yours: true, at: john(16) })
  })
  it('the other way round too', async () => {
    expect(await inYourBible(load, ['KJV'], john(16), { text: 'Car Dieu a tant aimé le monde', version: 'LSG', size: 36 }))
      .toEqual({ text: 'For God so loved the world', version: 'KJV', yours: true, at: john(16) })
  })
  it('numbers verses when there are several', () => {
    expect(wordsIn(bibles.KJV, john(16, 17))).toBe('16 For God so loved the world 17 For God sent not his Son')
  })
  it('tries your next Bible when one lacks the passage or can’t load', async () => {
    expect((await inYourBible(load, ['NT', 'GONE', 'LSG'], john(16), theirs))?.version).toBe('LSG')
  })
  it('passes over a Bible that numbers the chapter differently', async () => {
    expect((await inYourBible(load, ['ODD', 'LSG'], john(16), theirs))?.version).toBe('LSG')
  })
  it('falls back to their words, marked as theirs, only when none of yours has it', async () => {
    expect(await inYourBible(load, ['NT'], john(16), theirs)).toEqual({ text: 'For God so loved the world', version: 'KJV', yours: false, at: john(16) })
    expect(await inYourBible(load, ['NT'], john(16))).toBeUndefined()
  })
})

describe('Bibles that number the Psalms the Greek way', () => {
  // Psalm 9 holds 9 and 10 (and its title); 22 is the KJV's 23.
  const ps = (n: number, words = (i: number) => `v${i + 1}`) => Array.from({ length: n }, (_, i) => words(i))
  const drc: Bible = { id: 'DRC', books: { Ps: Array.from({ length: 150 }, (_, c) => c === 8 ? ps(39) : c === 21 ? ps(6, i => i ? 'x' : 'The Lord ruleth me') : ps(30)) } }
  const kjv: Bible = { id: 'KJV', books: { Ps: Array.from({ length: 150 }, (_, c) => c === 22 ? ps(6, i => i ? 'x' : 'The LORD is my shepherd') : ps(30)) } }
  const both = async (id: string) => id === 'DRC' ? drc : kjv
  it('shows the KJV’s Psalm 23 as their Psalm 22, and back', async () => {
    const s = await inYourBible(both, ['DRC'], { book: 'Ps', chapter: 23, verses: [1] }, { text: 'The LORD is my shepherd', version: 'KJV', size: 6 })
    expect(s).toMatchObject({ text: 'The Lord ruleth me', version: 'DRC', at: { chapter: 22, verses: [1] } })
    expect((await inYourBible(both, ['KJV'], { book: 'Ps', chapter: 23, verses: [1] }))?.text).toBe('The LORD is my shepherd')
  })
})

describe('readerVersions', () => {
  const lang: Record<string, string> = { KJV: 'en', BSB: 'en', LSG: 'fr', EthFr: 'fr' }
  it('starts with the Bible you read, then yours in the same language', () => {
    expect(readerVersions({ version: 'LSG', favorite: 'LSG', myVersions: ['KJV', 'BSB', 'LSG', 'EthFr'] }, id => lang[id])).toEqual(['LSG', 'EthFr'])
    expect(readerVersions({ version: 'BSB', favorite: 'KJV', myVersions: ['KJV', 'BSB', 'LSG'] }, id => lang[id])).toEqual(['BSB', 'KJV'])
  })
})

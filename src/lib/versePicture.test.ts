import { describe, expect, it } from 'vitest'
import { fit, pictureName, wrap } from './versePicture'

const mono: (s: string) => number = s => [...s].length * 10

describe('verse picture', () => {
  it('wraps at spaces', () => {
    expect(wrap(mono, 'Be still and know that I am God', 100)).toEqual(['Be still', 'and know', 'that I am', 'God'])
  })
  it('breaks words with no spaces (Chinese)', () => {
    expect(wrap(mono, '神爱世人甚至将他的独生子赐给他们', 50)).toEqual(['神爱世人甚', '至将他的独', '生子赐给他', '们'])
  })
  it('picks the biggest size that fits', () => {
    const at = (size: number) => (s: string) => [...s].length * size * .5
    const short = fit(at, 'Jesus wept.', 800, () => 900)
    expect(short.size).toBe(120)
    const long = fit(at, 'word '.repeat(200), 800, () => 900)
    expect(long.size).toBeLessThan(60)
  })
  it('cuts a passage too long even at the smallest size', () => {
    const at = (size: number) => (s: string) => [...s].length * size * .5
    const r = fit(at, 'word '.repeat(5000), 800, () => 900)
    expect(r.size).toBe(30)
    expect(r.lines.length).toBe(Math.floor(900 / (30 * 1.42)))
    expect(r.lines.at(-1)!.endsWith('…')).toBe(true)
  })
  it('names the file after the reference', () => {
    expect(pictureName('John 3:16 (KJV)')).toBe('John-3-16-KJV.png')
    expect(pictureName('1 Corinthians 13:4–7 (BSB)')).toBe('1-Corinthians-13-4-7-BSB.png')
    expect(pictureName('Jean 3:16 (LSG)')).toBe('Jean-3-16-LSG.png')
  })
  it('keeps to the wide card\'s own sizes', () => {
    const at = (size: number) => (s: string) => [...s].length * size * .5
    expect(fit(at, 'Jesus wept.', 1000, () => 400, 80, 22).size).toBe(80)
    expect(fit(at, 'word '.repeat(5000), 1000, () => 400, 80, 22).size).toBe(22)
  })
})

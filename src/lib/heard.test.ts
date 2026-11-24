import { beforeEach, describe, expect, it } from 'vitest'
import { heard, heardSince, unheard } from './heard'

const store = new Map<string, string>()
;(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) }

describe('heard', () => {
  beforeEach(() => store.clear())
  it('keeps which kinds of listening, once each', () => {
    heard('along', 'tresor', 'LSG', 'fr')
    heard('along', 'tresor', 'LSG', 'fr')
    heard('listen', 'voice', 'BSB', 'en')
    expect(heardSince()).toEqual({ m: ['along', 'listen'], s: ['tresor', 'voice'], b: ['LSG', 'BSB'], l: ['fr', 'en'] })
  })
  it('starts again once told, keeping what came after', () => {
    heard('along', 'hays', 'BSB', 'en')
    const sent = heardSince()
    heard('listen', 'hays', 'BSB', 'en')
    unheard(sent)
    expect(heardSince()).toEqual({ m: ['listen'] })
  })
})

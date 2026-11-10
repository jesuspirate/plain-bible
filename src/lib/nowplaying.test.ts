import { afterEach, describe, expect, it, vi } from 'vitest'
import { nowPlaying } from './nowplaying'

describe('nowPlaying', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('does nothing where the phone has no lock screen player', () => {
    expect(() => nowPlaying('John 3')).not.toThrow()
  })

  it('names the chapter and the full-square app icon', () => {
    const session: { metadata?: any } = {}
    vi.stubGlobal('navigator', { mediaSession: session })
    vi.stubGlobal('document', { baseURI: 'https://example.org/app/#/EthFr/PHP/2' })
    vi.stubGlobal('MediaMetadata', class { constructor(init: object) { Object.assign(this, init) } })
    nowPlaying('Philippians 2', 'EthFr')
    expect(session.metadata.title).toBe('Philippians 2')
    expect(session.metadata.artist).toBe('My Quiet Bible')
    expect(session.metadata.artwork[0]).toEqual({ src: 'https://example.org/app/icon-512.png', sizes: '512x512', type: 'image/png' })
    // The same chapter again leaves the lock screen alone.
    const first = session.metadata
    nowPlaying('Philippians 2', 'EthFr')
    expect(session.metadata).toBe(first)
  })
})

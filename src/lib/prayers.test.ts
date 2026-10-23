import { describe, expect, it } from 'vitest'
import { duration, recordingType } from './prayers'

describe('prayers', () => {
  it('records AAC on iPhone and Opus elsewhere', () => {
    expect(recordingType(t => t === 'audio/mp4' || t.startsWith('audio/webm'))).toBe('audio/mp4')
    expect(recordingType(t => t.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus')
    expect(recordingType(() => false)).toBe('')
    expect(recordingType(() => { throw new Error('no') })).toBe('')
  })
  it('shows minutes and seconds', () => {
    expect(duration(0)).toBe('0:00')
    expect(duration(65_400)).toBe('1:05')
    expect(duration(750_000)).toBe('12:30')
  })
})

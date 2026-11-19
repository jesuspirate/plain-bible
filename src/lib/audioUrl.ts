import { inMacApp } from './install'
import type { playable } from './mp4'

/** An address the player can play `audio` from.
 *  In the Mac app (an iPad app running on a Mac) the player never starts on
 *  a recording handed over from memory (a blob: address): it sits at
 *  "loading" forever, though a tiny file works. The same bytes written into
 *  the address itself (data:) play. Everywhere else, the lighter blob. */
export function audioUrl(audio: ReturnType<typeof playable>, type: string): string {
  if (!inMacApp()) return URL.createObjectURL(new Blob([audio], { type }))
  const bytes = audio instanceof Uint8Array ? audio : new Uint8Array(audio)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${type};base64,${btoa(bin)}`
}

/** Lets go of an address from audioUrl. */
export const dropAudioUrl = (url: string) => { if (url.startsWith('blob:')) URL.revokeObjectURL(url) }

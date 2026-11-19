// Checking a Nostr sign-in: an event the person's Nostr key signed in Fedi
// (NIP-07), holding the one-time challenge the service gave. NIP-01 says how
// the event's id is made; the signature is BIP-340 Schnorr over that id.
import { schnorr } from '@noble/curves/secp256k1.js'

/** The prayer key's copy sealed by a Nostr key is kept as a passkey's is,
 *  under "nostr:<pubkey>" (see the /prayers/wrap route). */
export const NOSTR_WRAP = 'nostr:'
/** NIP-98's kind, HTTP auth, so the signature can't stand in for a post. */
export const NOSTR_KIND = 27235
const HEX64 = /^[0-9a-f]{64}$/
const HEX128 = /^[0-9a-f]{128}$/
// The phone's clock may be off; the challenge itself lives five minutes.
const SKEW_S = 10 * 60

const hex = (s: string) => Uint8Array.from(s.match(/../g)!, b => parseInt(b, 16))
const toHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')

export async function nostrEventId(e: { pubkey: string; created_at: number; kind: number; tags: string[][]; content: string }) {
  const text = JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content])
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
}

/** The signer's public key (hex) when `event` is a fresh, well-signed answer
 *  to `challenge`; otherwise null. */
export async function checkNostrEvent(event: unknown, challenge: string, now: number): Promise<string | null> {
  const e = event as Record<string, unknown> | null
  if (!e || typeof e !== 'object') return null
  const { id, pubkey, sig, kind, created_at, tags, content } = e
  if (typeof id !== 'string' || !HEX64.test(id) || typeof pubkey !== 'string' || !HEX64.test(pubkey)) return null
  if (typeof sig !== 'string' || !HEX128.test(sig) || kind !== NOSTR_KIND || typeof content !== 'string') return null
  if (typeof created_at !== 'number' || !Number.isInteger(created_at) || Math.abs(created_at - now / 1000) > SKEW_S) return null
  if (!Array.isArray(tags) || !tags.every(t => Array.isArray(t) && t.every(v => typeof v === 'string'))) return null
  if (!tags.some(t => t[0] === 'challenge' && t[1] === challenge)) return null
  if (await nostrEventId({ pubkey, created_at, kind, tags, content }) !== id) return null
  try { return schnorr.verify(hex(sig), hex(id), hex(pubkey)) ? pubkey : null } catch { return null }
}

// Sign-in with a Nostr key, offered only inside Fedi. Fedi's mini apps get
// the person's Nostr key as window.nostr (NIP-07) and Fedi's own window.fedi,
// but no passkeys, and a code by email is clumsy there. Elsewhere it stays
// hidden: other browsers' Nostr extensions don't bring it up. Nothing here
// is loaded by anything else, and no Nostr library is: Fedi signs.
import { api, claim, setNoPasskey, SYNC_URL, SyncError } from './sync'

export interface NostrEvent { id: string; pubkey: string; sig: string; kind: number; created_at: number; tags: string[][]; content: string }
interface Nip07 {
  getPublicKey(): Promise<string>
  signEvent(e: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>): Promise<NostrEvent>
  nip44?: { encrypt(pubkey: string, text: string): Promise<string>; decrypt(pubkey: string, text: string): Promise<string> }
}
const w = () => (typeof window === 'undefined' ? {} : window) as { nostr?: Nip07; fedi?: unknown }
const nostr = () => w().nostr

/** Inside Fedi, with its Nostr key there to sign. */
export const inFedi = () => !!w().fedi && typeof w().fedi === 'object' && typeof nostr()?.signEvent === 'function'

/** The Nostr key this account signs in with here, once it has. */
const KEY = 'plain-bible:nostr'
export const nostrPubkey = () => { try { return localStorage.getItem(KEY) } catch { return null } }
const setPubkey = (pk: string) => { try { localStorage.setItem(KEY, pk) } catch { /* ignore */ } }

/** Fedi's NIP-44, to seal the account key to the person's own Nostr key. */
export function nip44() {
  const n = nostr(), pk = nostrPubkey()
  return inFedi() && pk && n?.nip44 ? { pubkey: pk, ...n.nip44 } : null
}

/** Sign in (or make an account) with Fedi's Nostr key; with a token, add the
 *  key to that account. The account key is then unlocked with it too. */
export async function nostrSignIn(token?: string): Promise<{ token?: string; added?: boolean }> {
  const n = nostr()
  if (!n || !inFedi()) throw new SyncError('Cancelled')
  const { challengeId, challenge } = await api<{ challengeId: string; challenge: string }>('/auth/nostr/options', { method: 'POST', body: {} })
  let event: NostrEvent
  try {
    event = await n.signEvent({
      // NIP-98's kind (HTTP auth), so this can't be passed off as a post.
      kind: 27235, created_at: Math.floor(Date.now() / 1000), content: '',
      tags: [['u', SYNC_URL + '/auth/nostr/verify'], ['method', 'POST'], ['challenge', challenge]],
    })
  } catch { throw new SyncError('Cancelled') }
  if (!event?.sig) throw new SyncError('Cancelled')
  const r = await api<{ token?: string; added?: boolean; passkeys?: number; pubkey: string }>('/auth/nostr/verify', { method: 'POST', token, body: { challengeId, event } })
  if (r.token) { await claim(r.token); setNoPasskey(!r.passkeys) }
  setPubkey(r.pubkey)
  const signedIn = r.token ?? token
  if (signedIn) await import('./prayerSync').then(m => m.nostrSignedIn(signedIn)).catch(() => {})
  return r
}

/** The one-time "Welcome in!" card: first open inside Fedi, signed out. */
const WELCOMED = 'plain-bible:fedi-welcome'
export function fediWelcomeDue() {
  try { return inFedi() && !localStorage.getItem('plain-bible:account') && !localStorage.getItem(WELCOMED) } catch { return false }
}
export const fediWelcomed = () => { try { localStorage.setItem(WELCOMED, '1') } catch { /* ignore */ } }

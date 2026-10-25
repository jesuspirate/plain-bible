// What signing out (or another account signing in) clears from this device.
// Everything tied to the account goes: the sign-in, the account and prayer
// keys, circles and their keys, a request to be let in, push. Otherwise the
// next account signed in here would quietly pick them up: open the old
// account's circles, offer its key, take its highlights into its own sync.
// Loaded only when needed.
import { meta, prayers } from './prayers'

const P = 'plain-bible:'
/** Tied to the account: the sign-in itself, its keys and its circles. */
const ACCOUNT = ['account', 'owner', 'prayer-sync', 'no-passkey', 'key-saved', 'streak-sent', 'push-circles', 'push-checked'].map(k => P + k)
const accountBound = (k: string) => ACCOUNT.includes(k) || k.startsWith(P + 'circle') || k.startsWith(P + 'share-circle')
/** Yours, and synced with the account: highlights, notes and bookmarks,
 *  reading days, when each setting changed (the settings themselves stay,
 *  like the theme, but no longer win over the next account's), and where
 *  you've been. */
const PERSONAL = ['marks', 'days', 'reading', 'settings-t', 'history', 'recent'].map(k => P + k)
const META_BOUND = (k: string) => ['key', 'acct', 'approve', 'deleted', 'circle-keys', 'circles'].includes(k) || k.startsWith('circle:') || k.startsWith('circle-audio:')

/** `personal`: also what syncs (see PERSONAL), safe in the account.
 *  `prayers`: also the prayers here, only when they're all in the account. */
export async function forgetAccount({ personal = false, prayers: dropPrayers = false } = {}) {
  try {
    for (const k of Object.keys(localStorage)) {
      if (accountBound(k) || (personal && PERSONAL.includes(k))) localStorage.removeItem(k)
    }
  } catch { /* ignore */ }
  if (typeof indexedDB !== 'undefined') {
    for (const k of await meta.keys().catch(() => [])) if (typeof k === 'string' && META_BOUND(k)) await meta.set(k, undefined)
    if (dropPrayers) for (const p of await prayers.list().catch(() => [])) await prayers.delete(p.id)
  }
  // The circles' names, kept for notifications.
  if (typeof caches !== 'undefined') await caches.delete('quiet-bible-push').catch(() => {})
}

/** Prayers recorded here that aren't in the account. */
export async function prayersOnlyHere(syncing: boolean) {
  if (syncing || typeof indexedDB === 'undefined') return 0
  return (await prayers.list().catch(() => [])).length
}

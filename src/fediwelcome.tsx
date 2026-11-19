// Inside Fedi, the first time the app opens: one tap signs in with the
// person's Nostr key, so their prayers are kept in their account (Fedi may
// not keep a mini app's storage). Never by itself: an account only for those
// who tap. Shown once; Not now, or the close button, and it doesn't return
// (Settings → Account still has the button). Loaded only when it shows.
import { useState } from 'preact/hooks'
import { Sheet } from './ui'
import { useApp } from './state'
import { fediWelcomed, nostrSignIn } from './lib/nostr'
import { t } from './i18n'

export function FediWelcome({ onClose }: { onClose: () => void }) {
  const { sync } = useApp()
  const [working, setWorking] = useState(false)
  const [msg, setMsg] = useState('')
  const close = () => { fediWelcomed(); onClose() }
  const go = async () => {
    setWorking(true); setMsg('')
    try {
      const r = await nostrSignIn()
      if (r.token) {
        sync.signedIn(r.token)
        setTimeout(() => import('./lib/prayerSync').then(m => m.syncPrayers()).catch(() => {}), 0)
      }
      close()
    } catch (e) {
      const m = (e as Error).message
      setMsg(m === 'Cancelled' ? t('Fedi didn’t sign in. Tap to try again.') : m)
    } finally { setWorking(false) }
  }
  return (
    <Sheet title={t('Welcome in!')} onClose={close}>
      <div class="fedi-welcome">
        <p>{t('Sign in, and your prayers and highlights stay safe in your account, even if Fedi clears its storage.')}</p>
        <button class="primary big" disabled={working} onClick={go}>{working ? t('Waiting for Fedi…') : t('Sign in with Nostr')}</button>
        <button class="big" disabled={working} onClick={close}>{t('Not now')}</button>
        <p class="muted small">{t('Fedi signs you in with your Nostr key. No email, no password. New here? It makes your account.')}</p>
        {msg && <p class="note">{msg}</p>}
      </div>
    </Sheet>
  )
}

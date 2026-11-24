// The Download everything button: Settings → Your data, and the Sign out
// and Delete account cards. The .zip is made only when tapped.
import { useState } from 'preact/hooks'
import { isIOS } from './lib/native'
import { useApp } from './state'
import { t, tn } from './i18n'

export function DownloadEverything({ class: cls = '' }: { class?: string }) {
  const { marks, settings, data } = useApp()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [fetching, setFetching] = useState(false)
  // On iPhone the share sheet has to open from a tap, and making the .zip
  // takes a moment: so a second tap hands it over.
  const [ready, setReady] = useState<{ name: string; zip: Uint8Array }>()
  const make = async () => {
    setBusy(true); setMsg('')
    try {
      // Prayers kept in the account but not on this device yet come down
      // first, so the .zip holds them too. Offline or signed out, it holds
      // what's here.
      let missing = 0, syncing = false
      if (navigator.onLine !== false) {
        try {
          const s = await import('./lib/prayerSync')
          syncing = s.prayerSyncOn()
          if (syncing) { setFetching(true); await s.syncPrayers().catch(() => {}) }
          missing = (await s.prayerCheck()).notHere
        } catch { /* the account couldn't be asked */ }
        finally { setFetching(false) }
      }
      const m = await import('./lib/export')
      const r = await m.buildExport({ marks, settings, data, version: settings?.version })
      const name = m.exportName()
      const done = tn(r.prayers, 'Your highlights, notes, bookmarks and {n} prayer are in {file}.', 'Your highlights, notes, bookmarks and {n} prayers are in {file}.', { file: name })
        + (missing ? ' ' + tn(missing, 'One prayer in your account isn’t on this device yet, so it isn’t in the .zip.', '{n} prayers in your account aren’t on this device yet, so they aren’t in the .zip.')
          + (syncing ? '' : ' ' + t('Open Your prayers and tap Sync my prayers, then download again.')) : '')
      if (isIOS) setReady({ name, zip: r.zip })
      else m.saveFile(name, r.zip, 'application/zip', false)
      setMsg(done)
    } catch (e) { setMsg(t('Couldn’t make the download: {error}', { error: (e as Error).message })) }
    finally { setBusy(false) }
  }
  const save = () => import('./lib/export').then(m => m.saveFile(ready!.name, ready!.zip, 'application/zip', true))
  return <>
    {ready
      ? <button class={cls + ' primary'} onClick={save}>{t('Save the .zip')}</button>
      : <button class={cls} disabled={busy} onClick={make}>{fetching ? t('Getting your prayers…') : busy ? t('Making the .zip…') : t('Download everything')}</button>}
    {msg && <p class="muted small export-note">{msg}</p>}
  </>
}

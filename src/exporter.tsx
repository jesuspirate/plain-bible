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
  // On iPhone the share sheet has to open from a tap, and making the .zip
  // takes a moment: so a second tap hands it over.
  const [ready, setReady] = useState<{ name: string; zip: Uint8Array }>()
  const make = async () => {
    setBusy(true); setMsg('')
    try {
      const m = await import('./lib/export')
      const r = await m.buildExport({ marks, settings, data, version: settings?.version })
      const name = m.exportName()
      const done = tn(r.prayers, 'Your highlights, notes, bookmarks and {n} prayer are in {file}.', 'Your highlights, notes, bookmarks and {n} prayers are in {file}.', { file: name })
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
      : <button class={cls} disabled={busy} onClick={make}>{busy ? t('Making the .zip…') : t('Download everything')}</button>}
    {msg && <p class="muted small export-note">{msg}</p>}
  </>
}

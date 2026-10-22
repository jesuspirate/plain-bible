// Settings → Your data: import highlights and saved verses from other apps,
// and back up / restore this app's own data.
import { unzipSync, strFromU8 } from 'fflate'
import { useState } from 'preact/hooks'
import { Backup, htmlToText, ImportItem, isBackup, mergeImport, parseRefList } from './lib/marks'
import { useApp } from './state'

interface Preview { items: ImportItem[]; skipped: string[]; files: string[]; backup?: Backup }

async function readImport(file: File): Promise<Preview> {
  const files: { name: string; text: string }[] = []
  if (/\.zip$/i.test(file.name)) {
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
    for (const [name, bytes] of Object.entries(entries)) {
      if (/(^|\/)(__MACOSX|\.)/.test(name) || !/\.(html?|txt|json)$/i.test(name)) continue
      files.push({ name, text: strFromU8(bytes) })
    }
  } else files.push({ name: file.name, text: await file.text() })

  const out: Preview = { items: [], skipped: [], files: [] }
  for (const f of files) {
    if (/\.json$/i.test(f.name)) {
      try { const j = JSON.parse(f.text); if (isBackup(j)) { out.backup = j; out.files.push(f.name) } } catch { /* not ours */ }
      continue
    }
    const base = f.name.split('/').pop()!.toLowerCase()
    const kind = /highlight/.test(base) ? 'highlight' : /save|bookmark|favou?rite/.test(base) ? 'bookmark' : 'auto'
    const r = parseRefList(/\.html?$/i.test(f.name) ? htmlToText(f.text) : f.text, kind)
    if (r.items.length) out.files.push(f.name.split('/').pop()!)
    out.items.push(...r.items)
    out.skipped.push(...r.skipped)
  }
  return out
}

function download(name: string, text: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function DataTools() {
  const { marks, setMarks, settings, update } = useApp()
  const [preview, setPreview] = useState<Preview>()
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const count = Object.values(marks)
  const hl = count.filter(m => m.c).length, bm = count.filter(m => m.b).length

  const pick = async (e: Event) => {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    setBusy(true); setMsg(''); setPreview(undefined)
    try {
      const p = await readImport(file)
      if (!p.items.length && !p.backup) setMsg(`Nothing to import was found in ${file.name}.`)
      else setPreview(p)
    } catch (err) { setMsg(`Could not read ${file.name}: ${(err as Error).message}`) }
    finally { setBusy(false) }
  }

  const hlCount = preview ? preview.items.filter(i => i.color).length + (preview.backup ? Object.values(preview.backup.marks).filter(x => x.c).length : 0) : 0
  const bmCount = preview ? preview.items.filter(i => i.bookmark).length + (preview.backup ? Object.values(preview.backup.marks).filter(x => x.b).length : 0) : 0

  const apply = () => {
    if (!preview) return
    setMarks(m => mergeImport(preview.backup ? { ...m, ...preview.backup.marks } : m, preview.items).marks)
    if (preview.backup?.settings && typeof preview.backup.settings === 'object') update(preview.backup.settings as Partial<typeof settings>)
    setMsg(`Imported ${hlCount} highlights and ${bmCount} bookmarks.`)
    setPreview(undefined)
  }

  const backup = () => {
    const data: Backup = { app: 'plain-bible', version: 1, exported: new Date().toISOString(), marks, settings }
    download(`plain-bible-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 1))
  }


  return (
    <div class="datatools">
      <p class="muted">You have <strong>{hl}</strong> highlighted verses and <strong>{bm}</strong> bookmarks on this device.</p>
      <div class="row wrap">
        <label class={'button primary' + (busy ? ' disabled' : '')}>
          {busy ? 'Reading…' : 'Import highlights…'}
          <input type="file" accept=".zip,.html,.htm,.txt,.json,application/zip,text/html" onChange={pick} hidden />
        </label>
        <button onClick={backup}>Back up my data</button>
      </div>
      <p class="muted small">Import highlights and bookmarks exported from another Bible app (a .zip, .html or .txt export with one reference per line), or a Plain Bible backup.
        Highlights belong to the verse, so they appear in every version.</p>
      {preview && (
        <div class="import-preview">
          <p>Found <strong>{hlCount}</strong> highlights and <strong>{bmCount}</strong> bookmarks in {preview.files.join(', ')}.
            {preview.skipped.length > 0 && <> {preview.skipped.length} lines were not recognized.</>}</p>
          {preview.skipped.length > 0 && <details class="small"><summary>Show unrecognized lines</summary><pre>{preview.skipped.slice(0, 50).join('\n')}</pre></details>}
          <div class="row">
            <button class="primary" onClick={apply}>Import</button>
            <button onClick={() => setPreview(undefined)}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <p class="note">{msg}</p>}
    </div>
  )
}

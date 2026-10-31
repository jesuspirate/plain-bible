// Settings → Your data: import highlights and saved verses from other apps,
// and download / restore everything of this app's own (lib/export).
import { unzipSync, strFromU8 } from 'fflate'
import { useState } from 'preact/hooks'
import { Backup, BACKUP_FILE, BackupPrayer, htmlToText, ImportItem, isBackup, mergeImport, mergeMark, Marks, notesOf, parseNotes, parseRefList } from './lib/marks'
import { Part, Prayer, prayers, withPart } from './lib/prayers'
import { cleanVerses } from './lib/prayerVerses'
import { DownloadEverything } from './exporter'
import { useApp } from './state'
import { t, tj, tn } from './i18n'

/** `audio`: a .zip's prayer recordings, by file name. `newPrayers`: the
 *  backup's prayers not on this device yet. */
interface Preview { items: ImportItem[]; skipped: string[]; files: string[]; backup?: Backup; audio?: Record<string, Uint8Array>; newPrayers?: number }

async function readImport(file: File): Promise<Preview> {
  const files: { name: string; text: string }[] = []
  const audio: Record<string, Uint8Array> = {}
  if (/\.zip$/i.test(file.name)) {
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
    for (const [name, bytes] of Object.entries(entries)) {
      if (/(^|\/)(__MACOSX|\.)/.test(name)) continue
      if (/(^|\/)prayers\/[^/]+$/.test(name)) audio[name.replace(/^.*?(prayers\/)/, '$1')] = bytes
      else if (/\.(html?|txt|json)$/i.test(name)) files.push({ name, text: strFromU8(bytes) })
    }
  } else files.push({ name: file.name, text: await file.text() })

  // Download everything from this app: the backup holds it all; its page
  // is only for reading.
  const ours = files.find(f => f.name.split('/').pop() === BACKUP_FILE)
  if (ours) {
    files.length = 0
    files.push(ours)
  }

  const out: Preview = { items: [], skipped: [], files: [] }
  for (const f of files) {
    if (/\.json$/i.test(f.name)) {
      try { const j = JSON.parse(f.text); if (isBackup(j)) { out.backup = j; out.files.push(f.name) } } catch { /* not ours */ }
      continue
    }
    const base = f.name.split('/').pop()!.toLowerCase()
    if (/note/.test(base)) {
      const r = parseNotes(/\.html?$/i.test(f.name) ? f.text : f.text.replace(/\n\s*\n/g, '<hr>').replace(/\n/g, '<br>'))
      if (r.items.length) out.files.push(f.name.split('/').pop()!)
      out.items.push(...r.items)
      out.skipped.push(...r.skipped)
      continue
    }
    const kind = /highlight/.test(base) ? 'highlight' : /save|bookmark|favou?rite/.test(base) ? 'bookmark' : 'auto'
    const r = parseRefList(/\.html?$/i.test(f.name) ? htmlToText(f.text) : f.text, kind)
    if (r.items.length) out.files.push(f.name.split('/').pop()!)
    out.items.push(...r.items)
    out.skipped.push(...r.skipped)
  }
  if (out.backup?.prayers?.length) {
    const here = new Set((await prayers.list().catch(() => [])).map(p => p.id))
    out.audio = audio
    out.newPrayers = restorable(out.backup.prayers, audio).filter(p => !here.has(p.id)).length
  }
  return out
}

/** The backup's prayers whose every recording is in the .zip. */
const restorable = (list: BackupPrayer[], audio: Record<string, Uint8Array>) =>
  list.filter(p => typeof p?.id === 'string' && Number.isFinite(p.at) && p.parts?.length && p.parts.every(x => audio[x.file]))

/** Put back the prayers this device doesn't have; returns how many. */
async function restorePrayers(list: BackupPrayer[], audio: Record<string, Uint8Array>) {
  const here = new Set((await prayers.list()).map(p => p.id))
  let n = 0
  for (const b of restorable(list, audio)) {
    if (here.has(b.id)) continue
    const parts: Part[] = b.parts.map(x => { const a = audio[x.file]; return { ms: x.ms, type: x.type, audio: a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength) as ArrayBuffer } })
    const verses = cleanVerses(b.verses ?? [])
    const p: Prayer = { id: b.id, at: b.at, ...parts[0], ...(verses.length ? { verse: verses[0], verses } : {}) }
    await prayers.put(parts.slice(1).reduce(withPart, p))
    n++
  }
  return n
}

export function DataTools() {
  const { marks, setMarks, settings, update } = useApp()
  const [preview, setPreview] = useState<Preview>()
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const count = Object.values(marks)
  const hl = count.filter(m => m.c).length, bm = count.filter(m => m.b).length, nt = count.reduce((n, m) => n + notesOf(m).length, 0)

  const pick = async (e: Event) => {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    setBusy(true); setMsg(''); setPreview(undefined)
    try {
      const p = await readImport(file)
      if (!p.items.length && !p.backup) setMsg(t('Nothing to import was found in {file}.', { file: file.name }))
      else setPreview(p)
    } catch (err) { setMsg(t('Could not read {file}: {error}', { file: file.name, error: (err as Error).message })) }
    finally { setBusy(false) }
  }

  const hlCount = preview ? preview.items.filter(i => i.color).length + (preview.backup ? Object.values(preview.backup.marks).filter(x => x.c).length : 0) : 0
  const bmCount = preview ? preview.items.filter(i => i.bookmark).length + (preview.backup ? Object.values(preview.backup.marks).filter(x => x.b).length : 0) : 0
  const ntCount = preview ? preview.items.filter(i => i.note).length + (preview.backup ? Object.values(preview.backup.marks).reduce((n, x) => n + notesOf(x).length, 0) : 0) : 0

  const apply = async () => {
    if (!preview) return
    setMarks(m => mergeImport(preview.backup ? mergeBackup(m, preview.backup.marks) : m, preview.items).marks)
    if (preview.backup?.settings && typeof preview.backup.settings === 'object') update(preview.backup.settings as Partial<typeof settings>)
    let said = t('Imported {h} highlights, {b} bookmarks and {n} notes.', { h: hlCount, b: bmCount, n: ntCount })
    if (preview.backup?.prayers && preview.audio && preview.newPrayers) {
      setBusy(true)
      try {
        const n = await restorePrayers(preview.backup.prayers, preview.audio)
        said += ' ' + tn(n, '{n} prayer is back on this device.', '{n} prayers are back on this device.')
      } catch (e) { said += ' ' + t('The prayers couldn’t be put back: {error}', { error: (e as Error).message }) }
      finally { setBusy(false) }
    }
    setMsg(said)
    setPreview(undefined)
  }


  return (
    <div class="datatools">
      <p class="muted">{tj('You have {h} highlighted verses, {b} bookmarks and {n} notes on this device.', { h: <strong>{hl}</strong>, b: <strong>{bm}</strong>, n: <strong>{nt}</strong> })}</p>
      <div class="row wrap">
        <label class={'button primary' + (busy ? ' disabled' : '')}>
          {busy ? t('Reading…') : t('Import highlights and notes…')}
          <input type="file" accept=".zip,.html,.htm,.txt,.json,application/zip,text/html" onChange={pick} hidden />
        </label>
        <DownloadEverything />
      </div>
      <p class="muted small">{t('Import highlights, bookmarks and notes exported from another Bible app (a .zip, .html or .txt export), or a backup made with this app.')}{' '}
        {t('They belong to the verse, so they appear in every version.')}</p>
      {preview && (
        <div class="import-preview">
          <p>{tj('Found {h} highlights, {b} bookmarks and {n} notes in {files}.', { h: <strong>{hlCount}</strong>, b: <strong>{bmCount}</strong>, n: <strong>{ntCount}</strong>, files: preview.files.join(', ') })}
            {preview.skipped.length > 0 && <> {tn(preview.skipped.length, '{n} line was not recognized.', '{n} lines were not recognized.')}</>}
            {!!preview.newPrayers && <> {tn(preview.newPrayers, 'Also {n} prayer that isn’t on this device.', 'Also {n} prayers that aren’t on this device.')}</>}</p>
          {preview.skipped.length > 0 && <details class="small"><summary>{t('Show unrecognized lines')}</summary><pre>{preview.skipped.slice(0, 50).join('\n')}</pre></details>}
          <div class="row">
            <button class="primary" disabled={busy} onClick={apply}>{t('Import')}</button>
            <button onClick={() => setPreview(undefined)}>{t('Cancel')}</button>
          </div>
        </div>
      )}
      {msg && <p class="note">{msg}</p>}
    </div>
  )
}

/** A backup joins what's here: each verse keeps its newest highlight and
 *  bookmark, and every note from both sides. */
function mergeBackup(mine: Marks, theirs: Marks): Marks {
  const out = { ...mine }
  for (const [k, m] of Object.entries(theirs)) out[k] = mergeMark(out[k], m)!
  return out
}

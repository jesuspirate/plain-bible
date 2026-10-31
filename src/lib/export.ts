// Download everything: one .zip with all that's yours on this device. It
// holds a backup this app can restore (Settings → Your data → Import), a
// page anyone can open in a browser, and each prayer as an audio file that
// plays anywhere. Loaded only when asked for.
import { strToU8, zipSync, Zippable } from 'fflate'
import { Backup, BACKUP_FILE, BackupPrayer, compareKeys, Marks, notesOf, PALETTE, parseKey } from './marks'
import { partsOf, prayers } from './prayers'
import { playable } from './mp4'
import { bookName } from './books'
import { verseRanges } from './refs'
import { verseLabel } from './prayerVerses'
import type { DataSource } from './data'
import { locale, t } from '../i18n'

const ext = (type: string) => /mp4|m4a|aac/i.test(type) ? 'm4a' : /webm/i.test(type) ? 'webm' : /ogg/i.test(type) ? 'ogg' : 'audio'
const pad = (n: number) => String(n).padStart(2, '0')
/** 2026-10-30_14-05, readable and in order in any file list. */
const stamp = (at: number) => { const d = new Date(at); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}` }
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** The .zip, and how many prayers went in. */
export async function buildExport({ marks, settings, data, version }: { marks: Marks; settings: unknown; data?: DataSource; version?: string }) {
  const files: Zippable = {}
  const list: BackupPrayer[] = []
  for (const info of await prayers.list().catch(() => [])) {
    const p = await prayers.get(info.id)
    if (!p) continue
    const parts = partsOf(p).map((part, i) => {
      const file = `prayers/${stamp(p.at)}_${p.id.slice(0, 6)}${i ? `_${i + 1}` : ''}.${ext(part.type)}`
      // Already compressed: stored as it is.
      files[file] = [new Uint8Array(playable(part.audio, part.type)), { level: 0 }]
      return { file, ms: part.ms, type: part.type }
    })
    list.push({ id: p.id, at: p.at, verses: p.verses ?? (p.verse ? [p.verse] : undefined), parts })
  }
  const backup: Backup = { app: 'plain-bible', version: 1, exported: new Date().toISOString(), marks, settings, prayers: list }
  files[BACKUP_FILE] = strToU8(JSON.stringify(backup))
  files['my-quiet-bible.html'] = strToU8(await page(marks, list, data, version))
  return { zip: zipSync(files, { level: 6 }), prayers: list.length }
}

/** Everything as one page that opens in any browser, verse text included
 *  where your Bible is on this device. */
async function page(marks: Marks, list: BackupPrayer[], data?: DataSource, version?: string) {
  const bible = data && version ? await data.bible(version).catch(() => undefined) : undefined
  const text = (book: string, chapter: number, verses: number[]) =>
    bible ? verses.map(v => bible.books[book]?.[chapter - 1]?.[v - 1]).filter(Boolean).join(' ') : ''
  const color = (c: string) => t(PALETTE.find(p => p.color === c)?.name ?? '') || c
  const when = (at: number) => new Date(at).toLocaleString(locale(), { dateStyle: 'long', timeStyle: 'short' })
  const ref = (book: string, chapter: number, verses: number[]) => verseLabel({ book, chapter, verses })

  const rows: string[] = []
  for (const key of Object.keys(marks).sort(compareKeys)) {
    const m = marks[key], { book, chapter, verse } = parseKey(key)
    const notes = notesOf(m)
    if (!m.c && !m.b && !notes.length) continue
    const tags = [m.c && `<span class="hl" style="background:${esc(m.c)}">${esc(color(m.c))}</span>`, m.b && `🔖 ${esc(t('Bookmark'))}`].filter(Boolean).join(' ')
    rows.push(`<section><h3>${esc(ref(book, chapter, [verse]))} ${tags}</h3>`
      + (text(book, chapter, [verse]) ? `<blockquote>${esc(text(book, chapter, [verse]))}</blockquote>` : '')
      + notes.map(n => `<div class="note">${n.v && n.v.length > 1 ? `<b>${esc(`${bookName(book)} ${chapter}:${verseRanges(n.v)}`)}</b><br>` : ''}${esc(n.n).replace(/\n/g, '<br>')}</div>`).join('')
      + `</section>`)
  }
  const said = list.map(p => `<section><h3>🙏 ${esc(when(p.at))}</h3>`
    + (p.verses ?? []).map(v => `<p><b>${esc(verseLabel(v))}</b>${text(v.book, v.chapter, v.verses) ? ` ${esc(text(v.book, v.chapter, v.verses))}` : ''}</p>`).join('')
    + p.parts.map(x => `<p><audio controls preload="none" src="${esc(x.file)}"></audio> <a href="${esc(x.file)}">${esc(x.file.split('/').pop()!)}</a></p>`).join('')
    + `</section>`).join('')

  return `<!doctype html><html lang="${esc(locale())}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t('My Quiet Bible'))}</title><style>
body{font:17px/1.55 Georgia,serif;max-width:720px;margin:0 auto;padding:24px 16px;background:#f7f0e3;color:#3b2f22}
h1{margin:0}h2{margin-top:40px;border-bottom:2px solid #d9c9ad}h3{margin:0 0 6px;font-size:18px}
section{padding:14px 0;border-bottom:1px solid #e4d7bf}blockquote{margin:6px 0;font-style:italic}
.note{margin:8px 0;padding:10px 12px;background:#fffaf0;border-radius:10px}.hl{font:600 13px system-ui;padding:2px 8px;border-radius:99px;color:#3b2f22}
audio{vertical-align:middle;max-width:100%}.muted{color:#7a6a55}
</style></head><body>
<h1>${esc(t('My Quiet Bible'))}</h1>
<p class="muted">${esc(t('Saved {date}. To bring it all back, open My Quiet Bible → Settings → Your data → Import, and pick this .zip.', { date: when(Date.now()) }))}</p>
<h2>${esc(t('Highlights, bookmarks and notes'))}</h2>${rows.join('') || `<p class="muted">${esc(t('None yet.'))}</p>`}
<h2>${esc(t('Prayers'))}</h2>${said || `<p class="muted">${esc(t('None on this device.'))}</p>`}
</body></html>`
}

/** Hand a file to the person: the share sheet on iPhone (a home-screen app
 *  opens a downloaded file full screen with no way back), a download
 *  elsewhere. */
export function saveFile(name: string, body: Uint8Array | string, type: string, ios: boolean) {
  const file = new File([body as BlobPart], name, { type })
  if (ios && navigator.canShare?.({ files: [file] })) { navigator.share({ files: [file] }).catch(() => {}); return }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** my-quiet-bible-2026-10-31.zip */
export const exportName = () => { const d = new Date(); return `my-quiet-bible-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.zip` }

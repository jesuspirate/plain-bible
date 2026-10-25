import { N_, t } from './i18n'
// Talks to the search worker. One worker is shared by the whole app.
import SearchWorker from './search.worker?worker'

let worker: Worker | undefined
let seq = 0
const pending = new Map<number, { resolve: (r: any) => void; reject: (e: Error) => void; progress?: (m: string) => void }>()

/** Starts the worker (ahead of the first search, or for it). */
export function warmSearch() {
  if (!worker) {
    worker = new SearchWorker()
    worker.onmessage = e => {
      const r = e.data, p = pending.get(r.seq)
      if (!p) return
      if (r.type === 'progress') return p.progress?.(r.message)
      pending.delete(r.seq)
      if (r.type === 'error') p.reject(new Error(r.message))
      else p.resolve(r)
    }
  }
}

export function call<T>(msg: object, progress?: (m: string) => void): Promise<T> {
  warmSearch()
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, progress })
    worker!.postMessage({ ...msg, seq: id })
  })
}


// The parser's own messages, in English there (the worker reads them).
N_('Nothing to search for'); N_('Invalid regular expression'); N_('Add at least one word to look for, not only words to exclude')

/** A message from the search worker (or the query parser), in your language. */
export function searchText(m: string): string {
  const quoted = m.match(/^(Ignored|Unknown book or section) "(.*)"$/)
  if (quoted) return quoted[1] === 'Ignored' ? t('Ignored “{word}”', { word: quoted[2] }) : t('Unknown book or section “{word}”', { word: quoted[2] })
  const searching = m.match(/^Searching (.+)…$/)
  if (searching) return t('Searching {version}…', { version: searching[1] })
  return t(m)
}

// Talks to the search worker. One worker is shared by the whole app.
import SearchWorker from './search.worker?worker'

let worker: Worker | undefined
let seq = 0
const pending = new Map<number, { resolve: (r: any) => void; reject: (e: Error) => void; progress?: (m: string) => void }>()

export function call<T>(msg: object, progress?: (m: string) => void): Promise<T> {
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
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, progress })
    worker!.postMessage({ ...msg, seq: id })
  })
}


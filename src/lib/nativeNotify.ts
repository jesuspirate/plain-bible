// The App Store iPhone app's side of circle notifications and its Home
// Screen widget (ios/QuietBible/Notify.swift). Older versions of the app
// have no such bridge, so everything here quietly does nothing there, as on
// the website. Tiny, so circle news can use it from the main bundle.

type Handler = { postMessage(m: unknown): Promise<unknown> }

/** The bridge, only in an iPhone app new enough to have it. */
export const nativeNotify = (): Handler | undefined =>
  (globalThis as { webkit?: { messageHandlers?: { notify?: Handler } } }).webkit?.messageHandlers?.notify

/** Ask the app; an older app or a refusal resolves undefined. */
export async function askNative<T>(m: Record<string, unknown>, h = nativeNotify()): Promise<T | undefined> {
  if (!h) return undefined
  try { return await h.postMessage(m) as T } catch { return undefined }
}

/** Fire and forget. */
export const tellNative = (m: Record<string, unknown>, h = nativeNotify()) => { askNative(m, h).catch(() => {}) }

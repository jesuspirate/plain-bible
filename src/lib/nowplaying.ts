// What the phone's lock screen shows while the app reads aloud or plays a
// prayer. Left to itself an iPhone borrows the browser-tab icon, whose
// rounded corners come out as white tips on the lock screen's own rounded
// square. The app icon that is already saved for offline fills the whole
// square, so it's named here: nothing more to download.
let shown = ''

export function nowPlaying(title: string, detail = '') {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return
  const key = title + '\n' + detail
  if (key === shown) return
  shown = key
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist: 'My Quiet Bible',
      album: detail,
      artwork: [
        { src: new URL('icon-512.png', document.baseURI).href, sizes: '512x512', type: 'image/png' },
        { src: new URL('icon-192.png', document.baseURI).href, sizes: '192x192', type: 'image/png' },
      ],
    })
  } catch { /* an older phone: its own picture stays */ }
}

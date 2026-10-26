import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import preact from '@preact/preset-vite'
import { VitePWA } from 'vite-plugin-pwa'

// Shown in Settings, so you can tell which version you have: the day it was
// built and its commit.
const sha = (process.env.GITHUB_SHA || '').slice(0, 7)
const BUILD = new Date().toISOString().slice(0, 10) + (sha ? ' · ' + sha : '')

const manifest = {
  name: 'My Quiet Bible',
  short_name: 'My Quiet Bible',
  description: 'Just the Bible, in many versions and languages, with thorough search.',
  theme_color: '#2b2a28',
  background_color: '#f4ecd8',
  display: 'standalone' as const,
  start_url: './',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}

// How many versions and languages there are, for the pages' own words, from
// the catalog the data build writes (CI builds the data before the app).
// Without it (a quick local build), the count when this was last changed.
function catalogCounts() {
  try {
    const { translations } = JSON.parse(readFileSync(new URL('./public/data/catalog.json', import.meta.url), 'utf8')) as { translations: { lang: string }[] }
    return { versions: translations.length, languages: new Set(translations.map(t => t.lang)).size }
  } catch { return { versions: 120, languages: 49 } }
}
const counts = catalogCounts()

// One copy of the manifest per theme. Android paints the installed app's
// window in its background colour, and that shows for a moment behind the
// keyboard as it slides up or down; a cream window flashed white in Dark.
// The app points at the copy for the theme in use (src/app.tsx), so the
// home-screen app takes the colour of the theme it was installed in.
const THEMES = { light: '#faf8f3', sepia: '#f4ecd8', dark: '#16161a' }
const themedManifests: Plugin = {
  name: 'themed-manifests',
  enforce: 'post',
  generateBundle() {
    for (const [id, bg] of Object.entries(THEMES)) {
      this.emitFile({ type: 'asset', fileName: `manifest-${id}.webmanifest`, source: JSON.stringify({ ...manifest, background_color: bg }) })
    }
  },
  // The PWA plugin links the manifest from every page as ./manifest.webmanifest,
  // which from /welcome/ points at nothing. The welcome page links the root's
  // (sepia, the default; welcome/welcome.ts switches with the theme).
  transformIndexHtml: {
    order: 'post',
    handler(html, ctx) {
      html = html.replaceAll('{{versions}}', String(counts.versions)).replaceAll('{{languages}}', String(counts.languages))
      return ctx.path.startsWith('/welcome/') ? html.replace('href="./manifest.webmanifest"', 'href="../manifest-sepia.webmanifest"') : html
    },
  },
}

export default defineConfig({
  define: { __BUILD__: JSON.stringify(BUILD) },
  // Relative base works on a custom domain and on a GitHub Pages project path.
  base: './',
  // Two pages: the Bible at the root, and the welcome page at /welcome/
  // (what My Quiet Bible is, and how to put it on a Home Screen). Built
  // together, so the welcome page shares the app's fonts and is saved
  // offline with it.
  build: { rollupOptions: { input: { main: 'index.html', welcome: 'welcome/index.html' } } },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest,
      workbox: {
        // A new version waits until the app switches to it (src/lib/update.ts),
        // so a page never runs half old and half new.
        skipWaiting: false,
        clientsClaim: false,
        // Notifications for circles (public/push-sw.js).
        importScripts: ['push-sw.js'],
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        // /welcome without the slash is the site's redirect to /welcome/, not a page the app should answer for.
        navigateFallbackDenylist: [/\/welcome$/],
        runtimeCaching: [
          {
            // Bibles you open, or save from the Versions page, stay available offline.
            urlPattern: ({ url }) => /\/data\/(bibles\/|strongs-)/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'bible-data', cacheableResponse: { statuses: [0, 200] } },
          },
          {
            // Fonts: only the scripts and styles actually used get downloaded.
            urlPattern: ({ url }) => url.pathname.endsWith('.woff2'),
            handler: 'CacheFirst',
            options: { cacheName: 'fonts' },
          },
          {
            // The list of versions: always fresh when online, so new versions appear right away.
            urlPattern: ({ url }) => url.pathname.endsWith('/data/catalog.json'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'bible-catalog', networkTimeoutSeconds: 4,
              // An error page (say a 404 while the site is mid-update) counts as
              // offline, so the saved copy is used instead.
              plugins: [{ fetchDidSucceed: async ({ response }) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response } }],
            },
          },
        ],
      },
    }),
    themedManifests,
  ],
  worker: { format: 'es' },
})

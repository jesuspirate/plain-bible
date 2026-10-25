import { defineConfig, type Plugin } from 'vite'
import preact from '@preact/preset-vite'
import { VitePWA } from 'vite-plugin-pwa'

// Shown in Settings, so you can tell which version you have: the day it was
// built and its commit.
const sha = (process.env.GITHUB_SHA || '').slice(0, 7)
const BUILD = new Date().toISOString().slice(0, 10) + (sha ? ' · ' + sha : '')

const manifest = {
  name: 'Quiet Bible',
  short_name: 'Quiet Bible',
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

// One copy of the manifest per theme. Android paints the installed app's
// window in its background colour, and that shows for a moment behind the
// keyboard as it slides up or down; a cream window flashed white in Dark.
// The app points at the copy for the theme in use (src/app.tsx), so the
// home-screen app takes the colour of the theme it was installed in.
const THEMES = { light: '#faf8f3', sepia: '#f4ecd8', dark: '#16161a' }
const themedManifests: Plugin = {
  name: 'themed-manifests',
  generateBundle() {
    for (const [id, bg] of Object.entries(THEMES)) {
      this.emitFile({ type: 'asset', fileName: `manifest-${id}.webmanifest`, source: JSON.stringify({ ...manifest, background_color: bg }) })
    }
  },
}

export default defineConfig({
  define: { __BUILD__: JSON.stringify(BUILD) },
  // Relative base works on a custom domain and on a GitHub Pages project path.
  base: './',
  plugins: [
    preact(),
    themedManifests,
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
        globPatterns: ['**/*.{js,css,html,svg,png}'],
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
  ],
  worker: { format: 'es' },
})

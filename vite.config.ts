import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Relative base works on a custom domain and on a GitHub Pages project path.
  base: './',
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Plain Bible',
        short_name: 'Bible',
        description: 'Just the Bible, in many versions and languages, with thorough search.',
        theme_color: '#2b2a28',
        background_color: '#faf8f3',
        display: 'standalone',
        start_url: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
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

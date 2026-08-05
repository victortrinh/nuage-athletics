// @ts-check
import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import sitemap from '@astrojs/sitemap'
import cloudflare from '@astrojs/cloudflare'
import tailwindcss from '@tailwindcss/vite'

// FR is the default locale and lives at the site root.
// This is deliberate: Quebec's Charter of the French Language requires the
// French version to be available on terms at least as favourable as any other
// language. Putting FR behind /fr while EN owns / would not satisfy that.
export default defineConfig({
  site: 'https://nuageathletics.com',
  output: 'static',
  adapter: cloudflare({ imageService: 'compile' }),
  i18n: {
    defaultLocale: 'fr-CA',
    locales: ['fr-CA', 'en-CA'],
    routing: { prefixDefaultLocale: false, redirectToDefaultLocale: false },
  },
  integrations: [
    react(),
    sitemap({
      i18n: {
        defaultLocale: 'fr-CA',
        locales: { 'fr-CA': 'fr-CA', 'en-CA': 'en-CA' },
      },
    }),
  ],
  vite: { plugins: [tailwindcss()] },
})

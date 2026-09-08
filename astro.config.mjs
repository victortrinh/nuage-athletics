// @ts-check
import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import sitemap from '@astrojs/sitemap'
import cloudflare from '@astrojs/cloudflare'
import tailwindcss from '@tailwindcss/vite'
import { INDEXABLE_PATHS } from './src/i18n/utils.ts'

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
      // Astro hands the integration every route it knows about, which is all
      // sixteen — including the two gate screens that 404 once the site
      // unlocks, and the eleven other pages that render `noindex`. A sitemap
      // is a list of pages you are asking to have indexed, so it gets the
      // same table `Seo.astro` reads. See INDEXABLE in src/i18n/utils.ts.
      filter: (page) => INDEXABLE_PATHS.includes(new URL(page).pathname),
      i18n: {
        defaultLocale: 'fr-CA',
        // These keys are matched against the first URL path segment, NOT
        // against Astro's own locale names — see parse-i18n-url.js in
        // @astrojs/sitemap. English lives at /en/, so keying it 'en-CA'
        // matched nothing, no page ever grouped with another, and the
        // integration emitted zero xhtml:link alternates while looking
        // correctly configured. The default locale has no segment of its own
        // and is what a non-matching path falls back to, so it keeps its
        // Astro name here.
        locales: { 'fr-CA': 'fr-CA', en: 'en-CA' },
      },
    }),
  ],
  vite: { plugins: [tailwindcss()] },
})

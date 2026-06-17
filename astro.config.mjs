import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://imadeitapps.github.io',

  integrations: [
    sitemap({
      changefreq: 'weekly',
      priority: 0.7,
      lastmod: new Date(),
    }),
  ],

  build: {
    assets: '_assets',
  },

  compressHTML: true,

  vite: {
    build: {
      cssMinify: true,
    },
  },
});

import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://imadeitapps.github.io',

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

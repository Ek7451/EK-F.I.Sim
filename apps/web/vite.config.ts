import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    VitePWA({
      // Prompt-to-update: never reload in the middle of an edit (plan 14.3).
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,json,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: 'Longview Planner',
        short_name: 'Longview',
        description: 'Personal finance scenario modeling. For personal educational planning only.',
        theme_color: '#4f5dd5',
        background_color: '#f4f6fa',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/echarts') || id.includes('node_modules/zrender')) return 'charts';
          // pdf-lib and the key-derivation code split by themselves at their dynamic imports; naming them here
          // pulled shared helpers into those chunks and made the first page download them.
          return undefined;
        },
      },
    },
  },
  server: { port: 5173, strictPort: true },
});

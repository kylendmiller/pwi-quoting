import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const BUILD = process.env.COMMIT_REF?.slice(0, 12) || String(Date.now());
export default defineConfig(({ command }) => ({
  root: 'app',
  base: './',   // relative asset paths: the app works at its own site root and at pwiinventory.netlify.app/quotes/ (proxied)
  plugins: [react(), { name: 'version-json', generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD }) }); } }],
  define: { __BUILD_ID__: JSON.stringify(command === 'build' ? BUILD : 'dev') },
  build: { outDir: '../dist/app', emptyOutDir: true },
  test: { root: '.', include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'] },
}));

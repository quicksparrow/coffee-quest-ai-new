import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Relative base so the built game works from any host path (Vercel, Netlify, or a preview link).
  base: './',
  resolve: {
    alias: [
      // Load Rapier's WebAssembly as a separate, streamable .wasm file (see src/core/rapier-wasm.js).
      { find: /^\.\/rapier_wasm3d$/, replacement: fileURLToPath(new URL('./src/core/rapier-wasm.js', import.meta.url)) },
    ],
  },
  optimizeDeps: { exclude: ['@dimforge/rapier3d'] },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 700, // three.js + loaders is ~640 kB minified; that is expected
    rolldownOptions: {
      output: {
        // Keep three.js in its own long-lived file so game updates don't re-download it.
        advancedChunks: { groups: [{ name: 'three', test: /node_modules[\\/]three/ }] },
      },
    },
  },
});

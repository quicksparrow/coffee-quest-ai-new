import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

// `virtual:model/<name>` exports public/models/<name>.glb as a base64 string. Only the
// preview-link build (VITE_MODELS=embed) imports these; regular builds download the .glb files.
const embeddedModels = {
  name: 'embedded-models',
  resolveId: (id) => (id.startsWith('virtual:model/') ? '\0' + id : null),
  load(id) {
    if (!id.startsWith('\0virtual:model/')) return null;
    const file = new URL(`./public/models/${id.slice('\0virtual:model/'.length)}.glb`, import.meta.url);
    return `export default ${JSON.stringify(readFileSync(file).toString('base64'))};`;
  },
};

export default defineConfig({
  // Relative base so the built game works from any host path (Vercel, Netlify, or a preview link).
  base: './',
  plugins: [embeddedModels],
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

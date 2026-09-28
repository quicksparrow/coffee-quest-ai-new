import { defineConfig } from 'vite';

// Relative base so the built game works from any host path (Vercel, Netlify, or a preview link).
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 6000 },
});

import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('./demo', import.meta.url)),
  base: './',
  publicDir: false,
  plugins: [react(), tailwindcss()],
  css: { postcss: { plugins: [] } },
  build: { outDir: '../demo-dist', emptyOutDir: true },
});

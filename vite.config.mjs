import { defineConfig } from 'vite';
export default defineConfig({
  publicDir: false,
  build: { outDir: 'dist', emptyOutDir: false, target: 'es2022', sourcemap: false },
});

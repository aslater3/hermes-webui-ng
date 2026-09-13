import { defineConfig } from 'vite';
export default defineConfig({
  publicDir: false,
  // The root tsconfig is Node-only. Select the React automatic runtime explicitly;
  // typechecking tsconfig.web.json does not configure Vite's JSX transform.
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  build: { outDir: 'dist', emptyOutDir: false, target: 'es2022', sourcemap: false },
});

import { defineConfig } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
// Module graph for the bundle contract (tests/contract/bundle-split.test.ts). It is written under
// build/, never dist/: dist is the served static root and build/ is not copied into the runtime image.
function moduleGraph() {
  let root = process.cwd();
  let graph;
  return {
    name: 'hermes-module-graph',
    configResolved(config) { root = config.root; },
    generateBundle(_options, bundle) {
      graph = {};
      for (const [file, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk') continue;
        graph[file] = {
          isEntry: chunk.isEntry,
          imports: chunk.imports,
          dynamicImports: chunk.dynamicImports,
          modules: chunk.moduleIds.map((id) => relative(root, id).split(sep).join('/')),
        };
      }
    },
    writeBundle() {
      if (!graph) return;
      mkdirSync(join(root, 'build'), { recursive: true });
      writeFileSync(join(root, 'build', 'vite-module-graph.json'), `${JSON.stringify(graph, null, 2)}\n`);
    },
  };
}
export default defineConfig({
  publicDir: false,
  // The root tsconfig is Node-only. Select the React automatic runtime explicitly;
  // typechecking tsconfig.web.json does not configure Vite's JSX transform.
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  plugins: [moduleGraph()],
  build: { outDir: 'dist', emptyOutDir: false, target: 'es2022', sourcemap: false },
});

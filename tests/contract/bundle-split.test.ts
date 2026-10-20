import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Performance acceptance (docs/13): the chat shell's initial JavaScript must not carry the editor,
// Markdown renderer, Management or workspace UI. Those load on demand. The check reads the Vite
// module graph written by vite.config.mjs (build/, never served) and the entry script that
// dist/index.html actually loads, then walks only the STATIC import closure of that entry.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const forbidden: Record<string, RegExp> = {
  codemirror: /node_modules\/(?:@codemirror|@lezer|codemirror)\//,
  markdown: /node_modules\/(?:react-markdown|remark-|rehype-|micromark|mdast-util-|hast-util-|unified|vfile)/,
  // Mermaid is not a dependency today; the pattern guards a future addition, so it is not required to be present.
  mermaid: /node_modules\/mermaid\//,
  management: /^client\/Management\.tsx?$/,
  workspaceEditor: /^client\/workspace\/(?:Workspace|CodePreview|EditText|MutationDialog)\.tsx?$/,
};
type Chunk = { isEntry: boolean; imports: string[]; dynamicImports: string[]; modules: string[] };
const graph = JSON.parse(readFileSync(new URL('build/vite-module-graph.json', `file://${root}/`), 'utf8')) as Record<string, Chunk>;
const html = readFileSync(new URL('dist/index.html', `file://${root}/`), 'utf8');

test('the chat entry statically loads no editor, Markdown, Management or workspace-editor module', () => {
  const entries = [...html.matchAll(/<script[^>]*type="module"[^>]*src="\/([^"]+)"/g)].map(match => match[1]!);
  assert.equal(entries.length, 1, 'index.html must load exactly one module entry');
  const entry = entries[0]!;
  assert.equal(graph[entry]?.isEntry, true, `${entry} is the Vite entry chunk`);
  // Static closure only: a dynamic import is a lazy chunk by definition and is allowed to hold these modules.
  const closure = new Set<string>(); const pending = [entry];
  while (pending.length) {
    const file = pending.pop()!;
    if (closure.has(file)) continue;
    const chunk = graph[file];
    assert.ok(chunk, `static import ${file} exists in the module graph`);
    closure.add(file); pending.push(...chunk.imports);
  }
  for (const [name, pattern] of Object.entries(forbidden)) {
    const hits = [...closure].flatMap(file => graph[file]!.modules.filter(module => pattern.test(module)).map(module => `${file} <- ${module}`));
    assert.deepEqual(hits, [], `initial chunk must not contain ${name}`);
  }
  // Non-vacuous: each forbidden family is really bundled, and only into lazy chunks.
  const lazy = Object.entries(graph).filter(([file]) => !closure.has(file));
  for (const [name, pattern] of Object.entries(forbidden).filter(([name]) => name !== 'mermaid')) {
    assert.ok(lazy.some(([, chunk]) => chunk.modules.some(module => pattern.test(module))), `${name} is present in a lazy chunk`);
  }
});

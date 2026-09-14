import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname);
const source = resolve(root, 'src');
const output = resolve(root, 'dist');
const checkOnly = process.argv.includes('--check');

const required = [
  'index.html',
  'styles.css',
  'site.js',
  'screenshots/conversation.svg',
  'screenshots/approval.svg',
  'screenshots/mobile.svg',
];

for (const path of required) {
  const file = resolve(source, path);
  const content = await readFile(file, 'utf8');
  if (!content.trim()) throw new Error(`Website source is empty: ${path}`);
}

const htmlPath = resolve(source, 'index.html');
const html = await readFile(htmlPath, 'utf8');
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicateIds.length) throw new Error(`Duplicate HTML id(s): ${[...new Set(duplicateIds)].join(', ')}`);

const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map(match => match[1]);
const missingAnchors = anchors.filter(anchor => !ids.includes(anchor));
if (missingAnchors.length) throw new Error(`Missing anchor target(s): ${[...new Set(missingAnchors)].join(', ')}`);

if (checkOnly) {
  console.log(`Website checks passed (${required.length} source files, ${ids.length} ids).`);
  process.exit(0);
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });

const sha = (process.env.GITHUB_SHA || 'local').slice(0, 7);
const built = new Date().toISOString();
const rendered = html
  .replaceAll('__BUILD_SHA__', sha)
  .replaceAll('__BUILD_DATE__', built);
await writeFile(resolve(output, 'index.html'), rendered);
await writeFile(resolve(output, '.nojekyll'), '');
await writeFile(resolve(output, 'robots.txt'), 'User-agent: *\nAllow: /\n');
console.log(`Built HermesUI NG website to ${output} (${sha}).`);

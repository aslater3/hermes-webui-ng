import { renderIcons } from '../pwa/render-icons.mjs';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function buildPwa(root = 'dist') {
  await mkdir(`${root}/pwa`, { recursive: true });
  await renderIcons(root);
  await writeFile(`${root}/manifest.webmanifest`, await readFile('pwa/manifest.webmanifest'));
  const paths = ['/', '/manifest.webmanifest', ...[180,192,512].map(size => `/pwa/icon-${size}.png`),
    ...(await readdir(`${root}/assets`)).filter(name => /^[A-Za-z0-9_-]+\.(js|css|svg)$/.test(name)).map(name => `/assets/${name}`)];
  const policy = await readFile('pwa/service-worker.js', 'utf8');
  const hash = createHash('sha256').update(policy);
  for (const path of paths) hash.update(path).update(await readFile(`${root}/${path === '/' ? 'index.html' : path.slice(1)}`));
  const version = hash.digest('hex').slice(0, 20);
  await writeFile(`${root}/sw.js`, policy.replace('__BUILD_ID__', version).replace('__PRECACHE__', JSON.stringify(paths)));
  await writeFile(`${root}/pwa/build.json`, JSON.stringify({ version, cachedPaths: paths }));
}

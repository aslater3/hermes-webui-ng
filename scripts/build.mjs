import { cp, rm, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
await Promise.all([rm('build', { recursive: true, force: true }), rm('dist', { recursive: true, force: true })]);
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc'], { stdio: 'inherit' });
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.web.json'], { stdio: 'inherit' });
// Retain the old diagnostic on an explicit route during migration; never make it the landing page.
await cp('public', 'dist', { recursive: true });
await rename('dist/index.html', 'dist/diagnostic.html');
await cp('build/src', 'dist', { recursive: true });
execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { stdio: 'inherit' });

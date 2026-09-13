import { cp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
await Promise.all([
  rm('build', { recursive: true, force: true }),
  rm('dist', { recursive: true, force: true }),
]);
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc'], { stdio: 'inherit' });
await cp('public', 'dist', { recursive: true });
await cp('build/src', 'dist', { recursive: true });

import { access, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
export async function buildWorkspaceNative() {
  if (process.platform !== 'linux') return; // Linux project mounts are the supported boundary.
  const include = resolve(dirname(process.execPath), '../include/node');
  await access(resolve(include, 'node_api.h'));
  await mkdir('build/server/workspace', { recursive: true });
  execFileSync('cc', ['-std=c11', '-O2', '-fPIC', '-shared', '-Wall', '-Wextra', '-Werror',
    '-fstack-protector-strong', '-D_FORTIFY_SOURCE=2', '-Wl,-z,relro,-z,now', '-I', include,
    'server/workspace/native-boundary.c', '-o', 'build/server/workspace/workspace-boundary.node'], { stdio: 'inherit' });
}

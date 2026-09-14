import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Page } from '@playwright/test';
import { createApp } from '../../server/app.js';
import { loadConfig } from '../../server/config.js';
import { startFixture } from '../fixtures/dashboard.js';
export async function workspaceFixture(page: Page, local = false, writable = false) {
  const base = await mkdtemp(join(tmpdir(), 'workspace-ui-')), project = join(base, 'project');
  await mkdir(project); await mkdir(join(project, 'src'));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-C', project, ...args], { stdio: 'pipe' });
  await writeFile(join(project, 'hello.ts'), 'export const message = "Original project";\n');
  await writeFile(join(project, 'src/settings.json'), '{"workspace": "fixture only"}\n');
  await writeFile(join(project, '.env'), 'PRIVATE_WORKSPACE_CANARY');
  git('init', '-b', 'main'); git('add', '.'); git('commit', '-m', 'Fixture only');
  await writeFile(join(project, 'hello.ts'), 'export const message = "Staged project";\n'); git('add', 'hello.ts');
  await writeFile(join(project, 'hello.ts'), 'export const message = "Working project";\n');
  await writeFile(join(project, 'new.txt'), 'Untracked project file\n');
  await writeFile(join(project, 'image.svg'), '<svg onload="window.WORKSPACE_XSS=true"><text>Inert SVG source</text></svg>');
  await writeFile(join(project, 'binary.bin'), Buffer.from([0, 1, 255]));
  await writeFile(join(project, 'large.txt'), 'a'.repeat(262145));
  // This unsupported link is only browsed in Files; Git inspections precede adding it below.
  const upstream = await startFixture(0, local ? { sessionToken: 'TEST_ONLY_WORKSPACE_TOKEN' } : {});
  const config = loadConfig({ HERMES_DASHBOARD_URL: upstream.origin, PUBLIC_ORIGIN: `${writable ? 'https' : 'http'}://127.0.0.1:1`, ...(writable ? { WORKSPACE_WRITE_ENABLED: 'true', WORKSPACE_WRITABLE_ROOTS: 'workspace', WEBUI_TLS_CERT: resolve('.local/tls/server/server.crt'), WEBUI_TLS_KEY: resolve('.local/tls/server/server.key') } : {}), WORKSPACE_ROOTS: project, GIT_ENABLED: 'true',
    ...(local ? { HERMES_AUTH_MODE: 'trusted-local', HERMES_DASHBOARD_SESSION_TOKEN: 'TEST_ONLY_WORKSPACE_TOKEN' } : {}) });
  const app = createApp(config, () => {});
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address(); assert.ok(address && typeof address !== 'string');
  config.publicOrigin = new URL(`${writable ? 'https' : 'http'}://127.0.0.1:${address.port}`);
  const index = await readFile(join(project, '.git/index'));
  return { origin: config.publicOrigin.origin, metrics: upstream.metrics, project,
    addLink: () => symlink('/etc/passwd', join(project, 'blocked-link')),
    unchanged: async () => assert.deepEqual(await readFile(join(project, '.git/index')), index),
    close: async () => { await page.goto('about:blank').catch(() => {}); await app.close(); await upstream.close(); await rm(base, { recursive: true, force: true }); },
  };
}

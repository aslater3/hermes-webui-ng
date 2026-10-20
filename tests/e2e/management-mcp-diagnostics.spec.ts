import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { login, idle } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });
// Synthetic gated fixture (not vanilla-Hermes evidence). The fixture seeds MCP URL passwords, query tokens, Authorization
// headers, env and args, and host paths, ports, PIDs, hostnames and install IDs. None of them may reach the DOM.

const SECRETS = ['FIXTURE_MCP_URL_PASSWORD', 'FIXTURE_MCP_QUERY_TOKEN', 'FIXTURE_MCP_HEADER_SECRET', 'FIXTURE_MCP_ENV_SECRET',
  'FIXTURE_MCP_ARG_SECRET', 'FIXTURE_MCP_OAUTH_TOKEN', 'mcp.example.test', '/home/fixture/private', '/srv/hermes', 'fixture-host.internal',
  'FIXTURE_INSTALL_ID', '48211', '9119', 'deadbeefcafe'];

async function openManageDialog(page: Page) {
  const narrow = (page.viewportSize()?.width ?? 1280) <= 850;
  if (narrow) {
    await page.getByRole('button', { name: 'Open conversations', exact: true }).click();
    await page.getByRole('dialog', { name: 'Conversations' }).getByRole('button', { name: 'Manage Hermes', exact: true }).click();
  } else await page.getByRole('button', { name: 'Manage Hermes', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Manage' })).toBeVisible();
}
const manage = (page: Page) => page.getByRole('dialog', { name: 'Manage' });
async function openTab(page: Page, name: 'MCP' | 'Diagnostics' | 'Hermes Dashboard') {
  await openManageDialog(page);
  await manage(page).getByRole('tab', { name, exact: true }).click();
}
const axe = (page: Page) => new AxeBuilder({ page }).include('dialog.modal-management').analyze();

test('MCP tab lists configured servers with transport, auth label, tool count and plugin, and no secret-bearing field', async ({ page }) => {
  await login(page);
  await openTab(page, 'MCP');
  await expect(manage(page).getByText('github', { exact: true })).toBeVisible();
  await expect(manage(page).getByText('filesystem', { exact: true })).toBeVisible();
  await expect(manage(page).getByText('Header token', { exact: false })).toBeVisible();
  await expect(manage(page).getByText('2 tools selected', { exact: false })).toBeVisible();
  await expect(manage(page).getByText('Disabled in Hermes', { exact: false })).toBeVisible();
  await expect(manage(page).getByText('Plugin calendar-plugin', { exact: false })).toBeVisible();
  await expect(manage(page).getByText('Connection status and last errors are not reported by this Hermes version.')).toBeVisible();
  await expect(manage(page).getByText('default profile · read-only', { exact: false })).toBeVisible();
  const text = await manage(page).innerText();
  for (const secret of SECRETS) expect(text).not.toContain(secret);
  expect((await axe(page)).violations).toEqual([]);
});

test('MCP tab: a refresh failure keeps the last loaded servers and says so', async ({ page }) => {
  await login(page);
  await openTab(page, 'MCP');
  await expect(manage(page).getByText('github', { exact: true })).toBeVisible();
  await page.route('**/__hermes/api/mcp/servers*', route => route.fulfill({ status: 500, json: { detail: 'upstream failed' } }));
  await manage(page).getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(manage(page).getByText('Refresh failed. Showing the last loaded servers.', { exact: false })).toBeVisible();
  await expect(manage(page).getByText('github', { exact: true })).toBeVisible();
  await page.unroute('**/__hermes/api/mcp/servers*');
});

test('MCP tab follows the profile: switching profile replaces the server list', async ({ page }) => {
  await login(page);
  await openTab(page, 'MCP');
  await expect(manage(page).getByText('github', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Profile: default', exact: true }).click();
  await page.getByRole('button', { name: 'New conversation with Work', exact: true }).click();
  await idle(page);
  await expect(page.getByRole('button', { name: 'Profile: work', exact: true })).toBeVisible();
  await openTab(page, 'MCP');
  await expect(manage(page).getByText('work-docs', { exact: true })).toBeVisible();
  await expect(manage(page).getByText('github', { exact: true })).toHaveCount(0);
  await expect(manage(page).getByText('work profile · read-only', { exact: false })).toBeVisible();
});

test('Diagnostics shows Hermes version, gateway and system facts, the NG facts, and no host identity', async ({ page }) => {
  await login(page);
  await openTab(page, 'Diagnostics');
  const hermes = manage(page).getByRole('region', { name: 'Hermes' });
  await expect(hermes.getByText('0.13.2', { exact: false })).toBeVisible();
  await expect(hermes.getByText('Running · running')).toBeVisible();
  await expect(hermes.getByText('Overall health')).toBeVisible();
  await expect(manage(page).getByRole('region', { name: 'HermesUI NG' }).getByText('Native Gateway')).toBeVisible();
  await expect(manage(page).getByRole('region', { name: 'Host' }).getByText('Linux', { exact: false })).toBeVisible();
  await expect(manage(page).getByRole('region', { name: 'Health' }).getByText('Responding')).toBeVisible();
  await expect(manage(page).getByText('Settings, under Diagnostics', { exact: false })).toBeVisible();
  const text = await manage(page).innerText();
  for (const secret of SECRETS) expect(text).not.toContain(secret);
  expect((await axe(page)).violations).toEqual([]);
});

test('Diagnostics hands the support report to Settings instead of duplicating it', async ({ page }) => {
  await login(page);
  await openTab(page, 'Diagnostics');
  await manage(page).getByRole('button', { name: 'Open Settings diagnostics', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible();
  await settings.getByRole('tab', { name: 'Diagnostics', exact: true }).click();
  await expect(settings.getByRole('button', { name: 'Copy report', exact: true })).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
});

test('Hermes Dashboard guidance names the niche areas as text, with no links to a Dashboard URL', async ({ page }) => {
  await login(page);
  await openTab(page, 'Hermes Dashboard');
  for (const area of ['Config', 'Providers', 'Memory setup', 'Cron editing', 'MCP management'])
    await expect(manage(page).getByText(area, { exact: true })).toBeVisible();
  await expect(manage(page).getByRole('link')).toHaveCount(0);
  expect((await axe(page)).violations).toEqual([]);
});

test('unsupported Hermes: MCP, Diagnostics and Dashboard tabs appear only for advertised routes', async ({ page }) => {
  await page.route('**/__hermes/openapi.json', route => route.fulfill({ json: { openapi: '3.1.0', paths: {
    '/api/sessions': { get: {} }, '/api/skills': { get: {} } } } }));
  await login(page);
  await openManageDialog(page);
  await expect(manage(page).getByRole('tab', { name: 'Skills', exact: true })).toBeVisible();
  await expect(manage(page).getByRole('tab', { name: 'MCP', exact: true })).toHaveCount(0);
  await expect(manage(page).getByRole('tab', { name: 'Diagnostics', exact: true })).toHaveCount(0);
  // Skills is Hermes-backed, so the guidance tab is offered alongside it.
  await expect(manage(page).getByRole('tab', { name: 'Hermes Dashboard', exact: true })).toBeVisible();
  await page.unroute('**/__hermes/openapi.json');
});

test('MCP advertised without health: MCP and Dashboard guidance show, Diagnostics does not', async ({ page }) => {
  await page.route('**/__hermes/openapi.json', route => route.fulfill({ json: { openapi: '3.1.0', paths: {
    '/api/sessions': { get: {} }, '/api/mcp/servers': { get: {} } } } }));
  await login(page);
  await openManageDialog(page);
  await expect(manage(page).getByRole('tab', { name: 'MCP', exact: true })).toBeVisible();
  await expect(manage(page).getByRole('tab', { name: 'Diagnostics', exact: true })).toHaveCount(0);
  await expect(manage(page).getByRole('tab', { name: 'Hermes Dashboard', exact: true })).toBeVisible();
  await page.unroute('**/__hermes/openapi.json');
});

test('touch targets, no horizontal overflow and axe for the new tabs', async ({ page }) => {
  await login(page);
  await openManageDialog(page);
  for (const tab of ['MCP', 'Diagnostics', 'Hermes Dashboard']) {
    const box = await manage(page).getByRole('tab', { name: tab, exact: true }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await manage(page).getByRole('tab', { name: tab, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect((await axe(page)).violations).toEqual([]);
  }
  await manage(page).getByRole('tab', { name: 'Diagnostics', exact: true }).click();
  const support = await manage(page).getByRole('button', { name: 'Open Settings diagnostics', exact: true }).boundingBox();
  expect(support?.height ?? 0).toBeGreaterThanOrEqual(44);
});

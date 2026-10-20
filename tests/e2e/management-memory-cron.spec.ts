import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { login, idle } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });
// Synthetic gated fixture (not vanilla-Hermes evidence). Cron actions are exercised here in gated mode only;
// trusted-local hides them by policy and is covered by contract tests.

async function openManageDialog(page: Page) {
  const narrow = (page.viewportSize()?.width ?? 1280) <= 850;
  if (narrow) {
    await page.getByRole('button', { name: 'Open conversations', exact: true }).click();
    await page.getByRole('dialog', { name: 'Conversations' }).getByRole('button', { name: 'Manage Hermes', exact: true }).click();
  } else await page.getByRole('button', { name: 'Manage Hermes', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Manage' })).toBeVisible();
}
const manage = (page: Page) => page.getByRole('dialog', { name: 'Manage' });
async function openTab(page: Page, name: 'Memory' | 'Cron') {
  await openManageDialog(page);
  await manage(page).getByRole('tab', { name, exact: true }).click();
}
const jobRow = (page: Page, name: string) => manage(page).getByRole('button', { name: new RegExp(`^${name}`) });
const detailFor = (page: Page, name: string) => manage(page).getByRole('region', { name: `Cron job: ${name}` });
const actionButton = (page: Page, job: string, name: string) => detailFor(page, job).getByRole('group', { name: 'Job actions' }).getByRole('button', { name, exact: true });
const statusWith = (page: Page, text: string) => manage(page).getByRole('status').filter({ hasText: text });

test('memory tab shows the active provider, file sizes and provider status without any secret values', async ({ page }) => {
  await login(page);
  await openTab(page, 'Memory');
  await expect(manage(page).getByText('honcho', { exact: true })).toBeVisible();
  await expect(manage(page).getByText('2.0 KB')).toBeVisible();
  await expect(manage(page).getByText('Needs configuration', { exact: false })).toBeVisible();
  await expect(manage(page).getByText('default profile · read-only', { exact: false })).toBeVisible();
  const text = await manage(page).innerText();
  for (const secret of ['FIXTURE_PROVIDER_SECRET_VALUE', 'HONCHO_API_KEY', 'MEM0_API_KEY']) expect(text).not.toContain(secret);
  expect((await new AxeBuilder({ page }).include('dialog.modal-management').analyze()).violations).toEqual([]);
});

test('cron tab lists jobs, opens a failing job with its error and runs, and never renders the raw error secret', async ({ page }) => {
  await login(page);
  await openTab(page, 'Cron');
  await expect(jobRow(page, 'morning-digest')).toBeVisible();
  await expect(jobRow(page, 'weekly-report')).toContainText('Paused');
  await jobRow(page, 'backup-check').click();
  const detail = detailFor(page, 'backup-check');
  await expect(detail.getByRole('heading', { name: 'backup-check', level: 3 })).toBeVisible();
  await expect(detail.getByText('Last error: Delivery failed: api_key=[redacted]')).toBeVisible();
  await expect(detail.getByText('FAILED · Delivery failed')).toBeVisible();
  await expect(detail.getByText('FIXTURE_JOB_KEY_VALUE')).toHaveCount(0);
  await expect(detail.getByText('Failures in a row')).toBeVisible();
  expect((await new AxeBuilder({ page }).include('dialog.modal-management').analyze()).violations).toEqual([]);
});

test('pause asks first: cancel changes nothing, confirm pauses and re-reads the job', async ({ page }) => {
  await login(page);
  await openTab(page, 'Cron');
  await jobRow(page, 'morning-digest').click();
  const detail = detailFor(page, 'morning-digest');
  await actionButton(page, 'morning-digest', 'Pause').click();
  const confirm = page.getByRole('dialog', { name: 'Pause job?' });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText('Hermes will not run “morning-digest” on schedule until it is resumed.')).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(detail.locator('dd', { hasText: 'Scheduled' })).toBeVisible();
  await actionButton(page, 'morning-digest', 'Pause').click();
  await page.getByRole('dialog', { name: 'Pause job?' }).getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(statusWith(page, 'Paused.')).toBeVisible();
  await expect(detail.locator('dd', { hasText: 'Paused' })).toBeVisible();
  await expect(actionButton(page, 'morning-digest', 'Resume')).toBeVisible();
  // Narrow layouts hide the list while a job is open; the detail is the source of truth for the state here.
  await expect(detail.getByText('Paused by operator').or(detail.getByText('Paused from the dashboard'))).toBeVisible();
});

test('resume and run-now are confirmed, and run-now holds every action disabled while in flight', async ({ page }) => {
  await login(page);
  await openTab(page, 'Cron');
  await jobRow(page, 'weekly-report').click();
  await actionButton(page, 'weekly-report', 'Resume').click();
  await page.getByRole('dialog', { name: 'Resume job?' }).getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(statusWith(page, 'Resumed.')).toBeVisible();
  await actionButton(page, 'weekly-report', 'Run now').click();
  const confirm = page.getByRole('dialog', { name: 'Run now job?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Run now', exact: true }).click();
  await expect(actionButton(page, 'weekly-report', 'Pause')).toBeDisabled();
  await expect(actionButton(page, 'weekly-report', 'Run now')).toBeDisabled();
  await expect(manage(page).getByText('Working… Hermes is applying this change.')).toBeVisible();
  await expect(statusWith(page, 'Run started')).toBeVisible({ timeout: 10_000 });
  await expect(actionButton(page, 'weekly-report', 'Run now')).toBeEnabled();
});

test('an unknown action outcome is shown honestly, is not retried, and offers a refresh', async ({ page }) => {
  let posts = 0;
  await page.route(url => url.pathname.endsWith('/0f1e2d3c4b5a/trigger'), route => { posts++; return route.abort(); });
  await login(page);
  await openTab(page, 'Cron');
  await jobRow(page, 'backup-check').click();
  await actionButton(page, 'backup-check', 'Run now').click();
  await page.getByRole('dialog', { name: 'Run now job?' }).getByRole('button', { name: 'Run now', exact: true }).click();
  await expect(manage(page).getByRole('alert').filter({ hasText: 'The outcome is unknown' })).toBeVisible();
  await expect(manage(page).getByRole('alert').filter({ hasText: 'Nothing was retried' })).toBeVisible();
  expect(posts).toBe(1);
  await expect(actionButton(page, 'backup-check', 'Run now')).toBeEnabled();
  await page.unroute(url => url.pathname.endsWith('/0f1e2d3c4b5a/trigger'));
});

test('a documented 409 from run-now is reported as not run, with no alarm about an unknown outcome', async ({ page }) => {
  await page.route(url => url.pathname.endsWith('/a1b2c3d4e5f6/trigger'), route => route.fulfill({ status: 409, contentType: 'application/json', body: '{"detail":"busy"}' }));
  await login(page);
  await openTab(page, 'Cron');
  await jobRow(page, 'morning-digest').click();
  await actionButton(page, 'morning-digest', 'Run now').click();
  await page.getByRole('dialog', { name: 'Run now job?' }).getByRole('button', { name: 'Run now', exact: true }).click();
  await expect(manage(page).getByRole('alert').filter({ hasText: 'already running' })).toBeVisible();
  await expect(manage(page).getByText('outcome is unknown')).toHaveCount(0);
  await page.unroute(url => url.pathname.endsWith('/a1b2c3d4e5f6/trigger'));
});

test('profile switch replaces the cron jobs and closes the open job for the new profile', async ({ page }) => {
  await login(page);
  await openTab(page, 'Cron');
  await jobRow(page, 'morning-digest').click();
  await expect(detailFor(page, 'morning-digest')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Profile: default', exact: true }).click();
  await page.getByRole('button', { name: 'New conversation with Work', exact: true }).click();
  await idle(page);
  await expect(page.getByRole('button', { name: 'Profile: work', exact: true })).toBeVisible();
  await openTab(page, 'Cron');
  await expect(manage(page).getByText(/work profile/)).toBeVisible();
  await expect(jobRow(page, 'work-sync')).toBeVisible();
  await expect(jobRow(page, 'morning-digest')).toHaveCount(0);
  await expect(manage(page).getByRole('region', { name: /Cron job:/ })).toHaveCount(0);
});

test('unsupported Hermes: tabs appear only for advertised capabilities and cron actions are not offered without POST routes', async ({ page }) => {
  await page.route('**/__hermes/openapi.json', route => route.fulfill({ json: { openapi: '3.1.0', paths: {
    '/api/sessions': { get: {} }, '/api/skills': { get: {} }, '/api/skills/content': { get: {} }, '/api/memory': { get: {} } } } }));
  await login(page);
  await openManageDialog(page);
  await expect(manage(page).getByRole('tab', { name: 'Skills', exact: true })).toBeVisible();
  await expect(manage(page).getByRole('tab', { name: 'Memory', exact: true })).toBeVisible();
  await expect(manage(page).getByRole('tab', { name: 'Cron', exact: true })).toHaveCount(0);
  await page.unroute('**/__hermes/openapi.json');
});

test('nothing advertised: Manage explains that the Hermes version does not support these views', async ({ page }) => {
  await page.route('**/__hermes/openapi.json', route => route.fulfill({ json: { openapi: '3.1.0', paths: { '/api/sessions': { get: {} } } } }));
  await login(page);
  await openManageDialog(page);
  await expect(manage(page).getByRole('tab')).toHaveCount(0);
  await expect(manage(page).getByText('Not supported by this Hermes version.')).toBeVisible();
  await page.unroute('**/__hermes/openapi.json');
});

test('touch targets, no horizontal overflow and axe on the cron confirmation dialog', async ({ page }) => {
  await login(page);
  await openTab(page, 'Cron');
  for (const tab of ['Skills', 'Memory', 'Cron']) {
    const box = await manage(page).getByRole('tab', { name: tab, exact: true }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  const row = await jobRow(page, 'weekly-report').boundingBox();
  expect(row?.height ?? 0).toBeGreaterThanOrEqual(44);
  await jobRow(page, 'morning-digest').click();
  await actionButton(page, 'morning-digest', 'Pause').click();
  const confirm = page.getByRole('dialog', { name: 'Pause job?' });
  const box = await confirm.getByRole('button', { name: 'Pause', exact: true }).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect((await new AxeBuilder({ page }).include('dialog.modal-management-confirm').analyze()).violations).toEqual([]);
  const width = page.viewportSize()?.width ?? 0;
  const dialog = await confirm.boundingBox();
  expect(dialog?.width ?? 0).toBeLessThanOrEqual(width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
});

import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { login, idle } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });
// Synthetic gated fixture (not vanilla-Hermes evidence). Skills are read-only; this spec never writes.

/** Mobile layouts reach Manage through the conversations drawer; desktop uses the sidebar footer. */
async function openManageDialog(page: Page) {
  const narrow = (page.viewportSize()?.width ?? 1280) <= 850;
  if (narrow) {
    await page.getByRole('button', { name: 'Open conversations', exact: true }).click();
    await page.getByRole('dialog', { name: 'Conversations' }).getByRole('button', { name: 'Manage Hermes', exact: true }).click();
  } else await page.getByRole('button', { name: 'Manage Hermes', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Manage' })).toBeVisible();
}
async function openManage(page: Page) {
  await openManageDialog(page);
  await expect(manage(page).getByRole('tab', { name: 'Skills', exact: true })).toBeVisible();
  await expect(manage(page).getByRole('button', { name: /^arxiv/ })).toBeVisible();
}
const manage = (page: Page) => page.getByRole('dialog', { name: 'Manage' });

test('desktop and mobile: open Manage, search, read a skill, and see stale data kept on a failed refresh', async ({ page }) => {
  await login(page);
  await openManage(page);
  // Skills, Memory and Cron are all advertised by the fixture; each tab renders only because Hermes offers it.
  await expect(manage(page).getByRole('tab')).toHaveCount(3);
  await expect(manage(page).getByText('default profile · read-only', { exact: false })).toBeVisible();
  await expect(manage(page).getByRole('button', { name: /axolotl/ })).toBeVisible();
  await manage(page).getByRole('searchbox', { name: 'Search skills' }).fill('axol');
  await expect(manage(page).getByRole('button', { name: /axolotl/ })).toBeVisible();
  await expect(manage(page).getByRole('button', { name: /^arxiv/ })).toHaveCount(0);
  await manage(page).getByRole('button', { name: /axolotl/ }).click();
  await expect(manage(page).getByRole('region', { name: 'Skill: axolotl' }).getByRole('heading', { name: 'axolotl', level: 3 })).toBeVisible();
  await expect(manage(page).getByText('Use this skill for axolotl tasks.')).toBeVisible();
  await expect(manage(page).getByRole('link', { name: /Open in Hermes Dashboard/ })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).include('dialog.modal-management').analyze()).violations).toEqual([]);
  await manage(page).getByRole('searchbox', { name: 'Search skills' }).fill('');
  // Narrow layouts show one pane at a time: return to the list before checking the cached rows.
  if ((page.viewportSize()?.width ?? 1280) < 760) await manage(page).getByRole('button', { name: 'All skills', exact: true }).click();
  // A failed refresh keeps the cached list as stale instead of reporting an empty catalogue.
  await page.route(url => url.pathname === '/__hermes/api/skills', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"boom"}' }));
  await manage(page).getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(manage(page).getByRole('alert')).toContainText('Showing the last loaded skills');
  await expect(manage(page).getByRole('button', { name: /arxiv/ })).toBeVisible();
  await expect(manage(page).getByText('No skills are installed')).toHaveCount(0);
  await page.unroute(url => url.pathname === '/__hermes/api/skills');
  await page.keyboard.press('Escape');
  await expect(manage(page)).toHaveCount(0);
});

test('profile switch clears the previous profile skills and reloads for the new profile', async ({ page }) => {
  await login(page);
  await openManage(page);
  await expect(manage(page).getByRole('button', { name: /axolotl/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Profile: default', exact: true }).click();
  await page.getByRole('button', { name: 'New conversation with Work', exact: true }).click();
  await idle(page);
  await expect(page.getByRole('button', { name: 'Profile: work', exact: true })).toBeVisible();
  await openManage(page);
  await expect(manage(page).getByText('work profile · read-only')).toBeVisible();
  await expect(manage(page).getByRole('button', { name: /axolotl/ })).toHaveCount(0);
  await expect(manage(page).getByRole('button', { name: /^arxiv/ })).toBeVisible();
});

test('unsupported Hermes: Manage explains the missing skills capability instead of showing fake availability', async ({ page }) => {
  await page.route('**/__hermes/openapi.json', route => route.fulfill({ json: { openapi: '3.1.0', paths: { '/api/sessions': { get: {} } } } }));
  await login(page);
  await openManageDialog(page);
  await expect(manage(page).getByText('Not supported by this Hermes version.')).toBeVisible();
  await expect(manage(page).getByRole('button', { name: /arxiv/ })).toHaveCount(0);
  await expect(manage(page).getByRole('searchbox', { name: 'Search skills' })).toHaveCount(0);
});

test('touch targets and 320px layout keep Manage and skill rows usable', async ({ page }) => {
  await login(page);
  await openManage(page);
  for (const control of [manage(page).getByRole('tab', { name: 'Skills' }), manage(page).getByRole('button', { name: 'Refresh', exact: true })]) {
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  const row = await manage(page).getByRole('button', { name: /arxiv/ }).boundingBox();
  expect(row?.height ?? 0).toBeGreaterThanOrEqual(44);
  const width = page.viewportSize()?.width ?? 0;
  const dialog = await manage(page).boundingBox();
  expect(dialog?.width ?? 0).toBeLessThanOrEqual(width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  // Keyboard: the search field is reachable and Escape closes the dialog (no hover-only controls).
  await manage(page).getByRole('searchbox', { name: 'Search skills' }).focus();
  await page.keyboard.press('Escape');
  await expect(manage(page)).toHaveCount(0);
});

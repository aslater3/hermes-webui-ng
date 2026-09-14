import { test, expect, type Page } from '@playwright/test';
import { login, send, idle, settings } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787', serviceWorkers: 'allow' });
const appSettings = async (page: Page) => { await settings(page); await page.getByRole('tab',{name:'App',exact:true}).click(); };

test('PWA cache holds only static shell; offline relaunch has no transcript or send queue', async ({page,context}) => {
  await login(page); await send(page,'PRIVATE_OFFLINE_CANARY'); await idle(page);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const keys = await page.evaluate(async()=> (await Promise.all((await caches.keys()).map(async name => {
    const cache=await caches.open(name);return (await cache.keys()).map(req=>new URL(req.url).pathname);
  }))).flat());
  expect(keys.length).toBeGreaterThan(5);expect(keys.every(path=>path==='/' || path==='/manifest.webmanifest' || path.startsWith('/assets/') || /^\/pwa\/icon-\d+\.png$/.test(path))).toBe(true);
  const cached = await page.evaluate(async()=> {const name=(await caches.keys())[0]!;const cache=await caches.open(name);return Promise.all((await cache.keys()).filter(req=>!req.url.endsWith('.png')).map(async req=>(await cache.match(req))!.text()));});
  expect(cached.join('')).not.toContain('PRIVATE_OFFLINE_CANARY');
  await context.setOffline(true); await page.reload();
  await expect(page.getByRole('heading',{name:'You’re offline.'})).toBeVisible();
  await expect(page.locator('body')).not.toContainText('PRIVATE_OFFLINE_CANARY');
  await context.setOffline(false); await expect(page.locator('#shell-prompt')).toBeEnabled();
  await expect(page.locator('[data-role="user"]')).toContainText('PRIVATE_OFFLINE_CANARY');
  await expect(page.locator('[data-role="user"]')).toHaveCount(1);
});

test('install settings are accessible and checking for updates preserves an unsent draft', async ({page},info) => {
  await login(page);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.locator('#shell-prompt').fill('Unsaved draft survives update check');
  await appSettings(page);await expect(page.getByTestId('pwa-state')).toHaveText('ready');
  await page.getByRole('button',{name:'Check for updates'}).click();
  await expect(page.getByText('Update check complete.',{exact:true})).toBeVisible();
  await expect(page.getByText('Only public app files are cached.',{exact:false})).toBeVisible();
  await page.screenshot({path:info.outputPath('install-and-updates.png')});
  await page.getByRole('button',{name:'Close settings',exact:true}).click();
  await expect(page.locator('#shell-prompt')).toHaveValue('Unsaved draft survives update check');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('SW failure explains certificate trust without preventing ordinary chat', async ({page}) => {
  await page.addInitScript(()=> { navigator.serviceWorker.register = async()=> {throw new DOMException('Untrusted test certificate', 'SecurityError');}; });
  await login(page); await appSettings(page);
  await expect(page.getByTestId('pwa-state')).toHaveText('failed');
  await expect(page.getByText('Offline setup failed.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Close settings',exact:true}).click();await send(page,'Chat survives a PWA setup error');await idle(page);
});

test('cookie expiry with a real active worker clears the private view, not just a routed mock', async ({page, context}) => {
  await login(page); await send(page, 'PRIVATE_BEFORE_COOKIE_EXPIRY'); await idle(page);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.clearCookies();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')));
  await expect(page.getByLabel('Username', { exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('PRIVATE_BEFORE_COOKIE_EXPIRY');
  expect(new URL(page.url()).hash).toBe('');
});

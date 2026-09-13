import { test, expect, type Page } from '@playwright/test';
async function signIn(page: Page) {
  await page.goto('/'); await expect(page.locator('#auth-state')).toHaveText('auth-required');
  await page.getByLabel('Username', { exact: true }).fill('fixture');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
async function chat(page: Page) {
  await signIn(page); await expect(page.locator('#gateway-state')).toHaveText('ready');
  await page.getByRole('button', { name: 'New session' }).click(); await expect(page.locator('#session-state')).toHaveText('idle');
  await page.getByLabel('Prompt', { exact: true }).fill('private-foundation-prompt');
  await page.getByRole('button', { name: 'Send prompt' }).click();
  await expect(page.getByLabel('Conversation')).toContainText('SYNTHETIC_RESPONSE'); await expect(page.locator('#session-state')).toHaveText('idle');
}
async function lifecycle(page: Page) { await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow'))); }

test('REST healthy remains distinct from waiting for Gateway readiness', async ({ page }) => {
  let release: (() => void) | undefined;
  await page.routeWebSocket('**/__hermes/api/ws', (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      if (message.toString().includes('gateway.ready')) release = () => socket.send(message);
      else socket.send(message);
    });
  });
  await signIn(page); await expect(page.locator('#rest-state')).toHaveText('healthy');
  await expect(page.locator('#gateway-state')).toHaveText('connecting');
  await expect(page.locator('#connection-banner')).toContainText('Waiting for the native Gateway');
  await expect(page.getByRole('button', { name: 'New session' })).toBeDisabled();
  await expect.poll(() => !!release).toBe(true); release!();
  await expect(page.locator('#gateway-state')).toHaveText('ready');
});
test('auth expiry on resume clears private state and requires explicit sign-in', async ({ page }) => {
  await chat(page); let tickets = 0;
  page.on('request', (request) => { if (request.url().endsWith('/api/auth/ws-ticket')) tickets++; });
  await page.route('**/__hermes/api/auth/me', (route) => route.fulfill({ status: 401, json: { error: 'session_expired' } }));
  await lifecycle(page); await expect(page.locator('#auth-state')).toHaveText('auth-required');
  await expect(page.locator('#gateway-state')).toHaveText('auth-required');
  await expect(page.getByLabel('Conversation')).not.toContainText('private-foundation-prompt');
  await expect(page.locator('#session-key')).toHaveValue(''); await expect(page.locator('#prompt')).toHaveValue('');
  expect(new URL(page.url()).hash).toBe(''); await lifecycle(page); expect(tickets).toBe(0);
  await page.unroute('**/__hermes/api/auth/me');
  await page.getByLabel('Username', { exact: true }).fill('fixture');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#gateway-state')).toHaveText('ready'); await expect(page.locator('#session-state')).toHaveText('empty');
});
test('verified sign-out clears scoped cookies and does not reconnect on resume', async ({ page, context }) => {
  await chat(page); await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('#auth-state')).toHaveText('signed-out'); await expect(page.locator('#connection-banner')).toContainText('Signed out of Hermes');
  await expect(page.getByLabel('Conversation')).not.toContainText('private-foundation-prompt');
  expect((await context.cookies()).some((cookie) => cookie.name === 'fixture_auth' && cookie.value)).toBe(false);
  await lifecycle(page); await expect(page.locator('#gateway-state')).toHaveText('disconnected');
  await page.reload(); await expect(page.locator('#auth-state')).toHaveText('auth-required');
});
test('support export is useful, bounded and free of credentials or conversation content', async ({ page }) => {
  await chat(page); await page.locator('#diagnostics-panel summary').click(); await expect(page.locator('#cap-sessionsList')).toContainText('available');
  const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download diagnostics' }).click();
  const download = await downloadEvent; const stream = await download.createReadStream(); const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString(); const data = JSON.parse(text);
  expect(data.connection.gateway).toBe('ready'); expect(data.events.length).toBeLessThanOrEqual(500);
  expect(data.events.some((event: { event: string }) => event.event === 'gateway.ready')).toBe(true);
  for (const secret of ['private-foundation-prompt', 'fixture-password', 'fixture_auth', 'must-not-export', 'SYNTHETIC_RESPONSE', 'hermes-gateway-ticket.']) expect(text).not.toContain(secret);
  await page.getByRole('button', { name: 'Clear diagnostics' }).click(); await expect(page.locator('#diagnostic-report')).toHaveValue('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const button = await page.getByRole('button', { name: 'Copy diagnostics' }).boundingBox(); expect(button?.height).toBeGreaterThanOrEqual(44);
});
test('optional schema missing and forbidden states do not disable the valid Gateway', async ({ page }) => {
  await page.route('**/__hermes/openapi.json', (route) => route.fulfill({ status: 404, json: {} }));
  await signIn(page); await expect(page.locator('#gateway-state')).toHaveText('ready');
  await page.locator('#diagnostics-panel summary').click(); await expect(page.locator('#cap-sessionsList')).toContainText('unknown');
  await page.unroute('**/__hermes/openapi.json'); await page.route('**/__hermes/openapi.json', (route) => route.fulfill({ status: 403, json: {} }));
  await page.getByRole('button', { name: 'Refresh capabilities' }).click(); await expect(page.locator('#cap-sessionsList')).toContainText('forbidden');
  await expect(page.locator('#gateway-state')).toHaveText('ready');
});
test('offline and resume recover upstream history but deliberate disconnect remains stopped', async ({ page, context }) => {
  await chat(page); await context.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.locator('#connection-banner')).toContainText('Offline'); await expect(page.getByRole('button', { name: 'Send prompt' })).toBeDisabled();
  await context.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('#gateway-state')).toHaveText('ready'); await expect(page.locator('#session-state')).toHaveText('idle');
  await expect(page.getByLabel('Conversation')).toContainText('private-foundation-prompt');
  await page.getByRole('button', { name: 'Disconnect transport' }).click(); await lifecycle(page);
  await expect(page.locator('#gateway-state')).toHaveText('disconnected'); await expect(page.locator('#auth-state')).toHaveText('signed-in');
});

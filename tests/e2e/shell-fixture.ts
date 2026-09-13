import { expect, type Page } from '@playwright/test';
export const MARKDOWN = `## A safer network migration

Keep the change small, observable and reversible. Here is a practical starting point.

| Stage | Action | Check |
| --- | --- | --- |
| Prepare | Capture the current configuration | Baseline saved |
| Validate | Check routes and neighbour state | No unexpected changes |
| Roll out | Migrate one segment at a time | Monitor after each step |

### Automate the pre-checks

\`\`\`python
from pathlib import Path

def capture_baseline(device: str) -> None:
    destination = Path("baselines") / f"{device}.txt"
    print(f"Saving baseline for {device} to {destination}")

capture_baseline("edge-router-01")
\`\`\`

**Before the change:** agree the rollback trigger and keep a second management path available.

- [x] Establish the baseline
- [ ] Validate the rollback procedure

[Reference](https://example.com/reference)

![Do not load automatically](https://tracker.invalid/pixel.png)

[Unsafe](javascript:alert(1))
<script>window.shellInjected = true</script>
<img src=x onerror="window.shellInjected=true">
`;
// Test-only presentation fixture on the synthetic Dashboard stream, not a vanilla-Hermes claim.
export async function richFixture(page: Page) {
  await page.routeWebSocket('**/__hermes/api/ws', socket => {
    const server = socket.connectToServer();
    server.onMessage(message => socket.send(message.toString().replaceAll('SYNTHETIC_RESPONSE', JSON.stringify(MARKDOWN).slice(1, -1))));
  });
}
export async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Username', { exact: true }).fill('fixture');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connection status: Connected', exact: true })).toBeVisible();
  await expect(page.locator('#shell-prompt')).toBeEnabled();
}
export async function send(page: Page, text: string) {
  await expect(page.locator('#shell-prompt')).toBeEnabled();
  await page.locator('#shell-prompt').fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('[data-role="user"]').last()).toContainText(text.trim());
}
export async function idle(page: Page) { await expect(page.locator('#shell-prompt')).toBeEnabled(); await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0); }
export async function conversations(page: Page) {
  const open = page.getByRole('button', { name: 'Open conversations', exact: true });
  if (await open.isVisible()) await open.click();
}
export async function closeConversations(page: Page) {
  const close = page.getByRole('button', { name: 'Close conversations', exact: true });
  if (await close.isVisible()) await close.click();
}
export async function newChat(page: Page) { await conversations(page); await page.getByRole('button', { name: 'New conversation', exact: true }).click(); await idle(page); }
export async function settings(page: Page) { await page.locator('.connection-pill').click(); await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible(); }

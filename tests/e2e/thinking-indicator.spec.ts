import { test, expect } from '@playwright/test';
import { login } from './shell-fixture.js';

test.use({ baseURL: 'http://127.0.0.1:8787' });

test('Hermes working dots bounce as a staggered wave and respect reduced motion', async ({ page }) => {
  await login(page);
  await page.evaluate(() => {
    const indicator = document.createElement('div');
    indicator.className = 'thinking-indicator';
    indicator.dataset.testWave = 'true';
    indicator.innerHTML = '<span></span><span></span><span></span>Hermes is working';
    document.querySelector('.conversation-content')?.append(indicator);
  });

  const dots = page.locator('.thinking-indicator[data-test-wave="true"] span');
  await expect(dots).toHaveCount(3);
  const motion = await dots.evaluateAll(nodes => nodes.map(node => {
    const style = getComputedStyle(node);
    return { name: style.animationName, delay: style.animationDelay, duration: style.animationDuration };
  }));
  expect(motion).toEqual([
    { name: 'thinking-dot-wave', delay: '0s', duration: '1s' },
    { name: 'thinking-dot-wave', delay: '0.14s', duration: '1s' },
    { name: 'thinking-dot-wave', delay: '0.28s', duration: '1s' },
  ]);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await dots.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).animationName));
  expect(reduced).toEqual(['none', 'none', 'none']);
});

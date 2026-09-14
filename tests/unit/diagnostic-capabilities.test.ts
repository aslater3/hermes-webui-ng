import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CapabilitiesStore } from '../../src/hermes/capabilities.js';

test('every capability has a diagnostic target so a new flag cannot abort chat rendering', async () => {
  const html = await readFile('public/index.html', 'utf8');
  for (const name of Object.keys(new CapabilitiesStore().snapshot())) {
    assert.ok(html.includes(`id="cap-${name}"`), `Missing diagnostic capability row: ${name}`);
  }
});

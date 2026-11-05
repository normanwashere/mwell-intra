import assert from 'node:assert/strict';
import test from 'node:test';
import config from '../apps/shell/next.config.mjs';

test('Warehouse Reports stays local; existing cross-module aliases remain unchanged', async () => {
  const redirects = await config.redirects();
  assert.equal(redirects.some(route => route.source === '/warehouse/reports'), false);
  assert.deepEqual(redirects, [
    { source: '/warehouse/events', destination: '/events', permanent: false },
    { source: '/warehouse/data', destination: '/insights/warehouse', permanent: false },
    { source: '/warehouse/quality-control', destination: '/warehouse/quality', permanent: false },
  ]);
});

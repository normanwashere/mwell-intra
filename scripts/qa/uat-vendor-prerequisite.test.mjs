import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileCiVendorPrerequisite } from './uat-vendor-prerequisite.mjs';

function harness(overrides = {}) {
  const calls = [];
  let row;
  const input = {
    appEnv: 'uat', identityScope: 'desktop-1440',
    persona: { kind: 'vendor', role: 'vendor_representative', email: 'intra.ci.desktop-1440.vendor@mwell.com.ph' },
    userId: 'vendor-user', vendorId: 'vendor-org',
    request: async (endpoint, options = {}) => {
      calls.push({ endpoint, options });
      if (options.method === 'POST') { row = JSON.parse(options.body); return null; }
      return row ? [row] : [];
    },
    ...overrides,
  };
  return { input, calls };
}

test('isolated vendor prerequisite is explicit synthetic state, not email evidence', async () => {
  const h = harness();
  await reconcileCiVendorPrerequisite(h.input);
  const write = h.calls.find(call => call.options.method === 'POST');
  const row = JSON.parse(write.options.body);
  assert.equal(row.auth_user_id, 'vendor-user');
  assert.equal(row.status, 'accepted');
  assert.equal(row.accepted_generation, row.link_generation);
  assert.equal(row.profile.synthetic, true);
  assert.equal(row.profile.email_delivery_certified, false);
  assert.equal(row.delivered_at, undefined);
  assert.equal(row.case_id, undefined);
  assert.equal(write.options.headers['Content-Profile'], 'legal');
  await reconcileCiVendorPrerequisite(h.input);
  assert.equal(h.calls.filter(call => call.options.method === 'POST').length, 1);
});

test('never fabricates acceptance for shared testers or production', async () => {
  for (const overrides of [{ appEnv: 'production' }, { identityScope: '' },
    { persona: { kind: 'vendor', role: 'vendor_representative', email: 'intra.test.vendor@mwell.com.ph' } }]) {
    const h = harness(overrides);
    await assert.rejects(reconcileCiVendorPrerequisite(h.input), /isolated UAT vendor/);
    assert.equal(h.calls.length, 0);
  }
});

test('fails closed if the synthetic prerequisite is overwritten or not persisted', async () => {
  const h = harness({ request: async () => [] });
  await assert.rejects(reconcileCiVendorPrerequisite(h.input), /readback/);
});

test('does not overwrite an unrelated invitation with a colliding id', async () => {
  const h = harness({ request: async () => [{ id: 'collision', profile: {}, auth_user_id: 'another-user' }] });
  await assert.rejects(reconcileCiVendorPrerequisite(h.input), /ownership/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = file => readFileSync(new URL('../../' + file, import.meta.url), 'utf8');

test('shared hierarchy covers internal and vendor shells while retaining specialized working screens', () => {
  for (const file of ['apps/shell/components/AppShell.tsx', 'modules/warehouse/src/components/AppShell.tsx', 'modules/legal/src/LegalApp.tsx', 'modules/procurement/src/components/VendorPurchaseOrderAcknowledgements.tsx', 'apps/shell/app/vendor/onboarding/page.tsx']) {
    assert.match(read(file), /workspace-hierarchy/);
  }
  for (const file of ['modules/work/src/WorkApp.tsx', 'modules/warehouse/src/pages/FulfillmentPage.tsx', 'modules/procurement/src/pages/PODetailPage.tsx']) {
    assert.match(read(file), /hierarchy-preview/);
  }
  const css = read('apps/shell/app/hierarchy-preview.css');
  assert.match(css, /\.workspace-hierarchy \.page-header-band/);
  assert.match(css, /\.workspace-hierarchy \.section-heading-band/);
  assert.match(css, /\.dark/);
  assert.match(css, /focus-visible/);
  assert.doesNotMatch(css, /!important/);
});

test('fulfillment guidance collapses without removing the department handoff', () => {
  const source = read('modules/warehouse/src/pages/FulfillmentPage.tsx');
  assert.match(source, /<details className="hp-guidance">\s*<summary[^>]*>Department handoff<\/summary>\s*<HandoffRail/);
  assert.match(source, /Queue tools/);
  assert.match(source, /Export current view/);
  assert.match(source, /Import existing/);
});

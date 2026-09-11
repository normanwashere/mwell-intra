import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = file => readFileSync(new URL('../../' + file, import.meta.url), 'utf8');

test('visual pilot is scoped to the three approved working screens', () => {
  for (const file of ['modules/work/src/WorkApp.tsx', 'modules/warehouse/src/pages/FulfillmentPage.tsx', 'modules/procurement/src/pages/PODetailPage.tsx']) {
    assert.match(read(file), /hierarchy-preview/);
  }
  const css = read('apps/shell/app/hierarchy-preview.css');
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

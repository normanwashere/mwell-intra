import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Home keeps scoped destinations and readiness in an unframed compact directory', () => {
  const home = source('../page.tsx');
  assert.match(home, /dashboardAreas\(/);
  assert.match(home, /href=\{c.href\}/);
  assert.match(home, /<OnboardingStatusBand \/>/);
  assert.match(home, /<TaskStartLoader \/>/);
  assert.match(home, /<section\s+id="workspace-areas"/);
  assert.match(home, /lg:grid-cols-2 lg:gap-x-6/);
  assert.doesNotMatch(home, /<Card|min-h-36|max-w-md grid-cols-1/);
});

test('Admin launchers remain named links with visible status and mobile row layout', () => {
  const admin = source('./page.tsx');
  assert.match(admin, /href=\{area.href\}/);
  assert.match(admin, /aria-label=\{`Open \$\{area.title\}`\}/);
  assert.match(admin, /\{area.status\}/);
  assert.match(admin, /divide-y divide-line/);
  assert.match(admin, /sm:col-start-3 sm:row-start-1/);
  assert.doesNotMatch(admin, /<Card|btn-outline mt-3 w-full/);
});

test('DOA coverage exposes full department labels and keeps revision and activation actions', () => {
  const doa = source('./doa/page.tsx');
  assert.match(doa, /divide-y divide-line border-y border-line/);
  assert.match(doa, /<h3 className="break-words font-semibold text-ink">/);
  assert.match(doa, /onClick=\{\(\) => void createRevision\(matrix\)\}/);
  assert.match(doa, /onClick=\{\(\) => void activate\(matrix\)\}/);
  assert.doesNotMatch(doa, /<Card/);
});

test('Role management uses unframed module disclosure rows and wraps identity labels', () => {
  const users = source('./users/page.tsx');
  assert.match(users, /divide-y divide-line border-y border-line/);
  assert.match(users, /open=\{openModules.has\(moduleName\)\}/);
  assert.match(users, /break-words text-sm text-muted \[overflow-wrap:anywhere\]">\{profile.email\}/);
  assert.doesNotMatch(users, /min-h-20 cursor-pointer|bg-surface shadow-e1/);
});

test('Policy source comparison uses distinct reference rails without enclosing cards', () => {
  const policy = source('./doa/PolicyProfileSection.tsx');
  assert.match(policy, /border-l-2 border-line pl-3/);
  assert.match(policy, /border-l-2 border-brand-500 pl-3/);
  assert.match(policy, /aria-label="Draft controlled revision"/);
  assert.doesNotMatch(policy, /<Card/);
});

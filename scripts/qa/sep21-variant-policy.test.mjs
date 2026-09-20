import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('event variant guidance retains Product ownership without changing custody or date controls', async () => {
  for (const file of [
    'docs/TECHNICAL_AND_FUNCTIONAL_SPECIFICATION.md',
    'docs/USER_TRAINING_AND_OPERATIONS_MANUAL.md',
    'docs/releases/2026-09-20-EXPERIENCE-REMEDIATION-CANDIDATE.md',
    'apps/shell/lib/knowledge/workflows.ts',
  ]) {
    const source = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8');
    assert.match(source, /Reusable event watch variants stay active; Product decides when to retire them\./, file);
    assert.match(source, /(?:Product-approved recovery recipe|approved Product recipe)/, file);
  }
  const release = await readFile(new URL('../../docs/releases/2026-09-20-EXPERIENCE-REMEDIATION-CANDIDATE.md', import.meta.url), 'utf8');
  assert.match(release, /Post-event corrections remain undecided/);
  assert.match(release, /strict assignment dates/);
  assert.doesNotMatch(release, /variant SKU retirement remain undecided/);
});

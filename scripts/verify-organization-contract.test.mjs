import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const verifier = fileURLToPath(
  new URL('./verify-organization-contract.mjs', import.meta.url),
);

test('organization migration satisfies the extensibility and authorization contract', () => {
  const result = spawnSync(process.execPath, [verifier], {
    encoding: 'utf8',
  });

  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr].filter(Boolean).join('\n'),
  );
  assert.match(result.stdout, /organization contract passed/i);
});

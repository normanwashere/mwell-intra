import { expect, it } from 'vitest';
import { readReadinessIndependently } from './readinessReads';
it('keeps a valid PO readiness when a different historical record fails', async () => {
  const result = await readReadinessIndependently([{ id: 'old' }, { id: 'current' }], async record => {
    if (record.id === 'old') throw new Error('RPC contract error');
    return { id: record.id, ready: false };
  });
  expect(result.rows).toEqual([{ id: 'current', ready: false }]);
  expect(Object.keys(result.errors)).toEqual(['old']);
  expect(result.errors.old).not.toContain('RPC contract');
});
it('clears errors after a successful retry without synthesizing a passing decision', async () => {
  const result = await readReadinessIndependently([{ id: 'old' }], async () => ({ ready: false, blockers: ['Missing evidence'] }));
  expect(result.errors).toEqual({});
  expect(result.rows[0]?.ready).toBe(false);
});

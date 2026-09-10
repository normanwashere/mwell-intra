import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it.each(['indexedDB', 'memory'])('returns metadata-only legacy counts and keeps unsafe entries out of actor queues (%s)', async (storage) => {
  vi.stubGlobal('indexedDB', storage === 'indexedDB' ? new IDBFactory() : undefined);
  const queue = await import('./outbox');
  await queue.enqueue('transfer', { actor: 'alice', idempotencyKey: 'a' });
  const conflict = await queue.enqueue('transfer', { actor: 'alice', idempotencyKey: 'c' });
  await queue.markConflict(conflict.id, 'Alice private error');
  await queue.enqueue('transfer', { actor: 'bob', idempotencyKey: 'b', secret: 'foreign payload' });
  await queue.enqueue('transfer', { secret: 'legacy payload' });
  const unkeyed = await queue.enqueue('transfer', { actor: 'bob' });
  await queue.markConflict(unkeyed.id, 'Legacy private error');
  await queue.enqueue('transfer', { actor: 'alice', idempotencyKey: '  ' });
  const committed = await queue.enqueue('transfer', {});
  await queue.markCommitted(committed.id);
  const before = [...await queue.allPending(), ...await queue.allConflicts()];
  expect(await queue.readOutboxCounts('alice')).toEqual({ pendingCount: 1, conflictCount: 1, unresolvedLegacyCount: 3 });
  expect(await queue.readOutboxCounts('bob')).toEqual({ pendingCount: 1, conflictCount: 0, unresolvedLegacyCount: 3 });
  expect(await queue.allPending('alice')).toHaveLength(1);
  expect(await queue.allConflicts('bob')).toEqual([]);
  expect([...await queue.allPending(), ...await queue.allConflicts()]).toEqual(before);
});

it.each(['indexedDB', 'memory'])('checks discard scope immediately before deleting (%s)', async (storage) => {
  vi.stubGlobal('indexedDB', storage === 'indexedDB' ? new IDBFactory() : undefined);
  const queue = await import('./outbox');
  const entry = await queue.enqueue('transfer', { actor: 'alice', idempotencyKey: 'discard' });
  await queue.markConflict(entry.id, 'Private conflict');
  await queue.removeEntry(entry.id, () => false);
  expect(await queue.allConflicts('alice')).toEqual([expect.objectContaining({ id: entry.id })]);
  await queue.removeEntry(entry.id, () => true);
  expect(await queue.allConflicts('alice')).toEqual([]);
});

it('scopes pending counts and conflict details to the original actor without deleting other work', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const queue = await import('./outbox');
  const a = await queue.enqueue('transfer', { actor: 'operator-a', idempotencyKey: 'a' });
  const b = await queue.enqueue('transfer', { actor: 'operator-b', idempotencyKey: 'b' });
  await queue.enqueue('transfer', { idempotencyKey: 'legacy' });
  expect(await queue.pendingCount('operator-a')).toBe(1);
  expect(await queue.allPending('operator-b')).toEqual([b]);
  await queue.markConflict(a.id, 'Private operator A failure');
  await queue.markConflict(b.id, 'Private operator B failure');
  expect((await queue.allConflicts('operator-a')).map(e => e.id)).toEqual([a.id]);
  expect((await queue.allConflicts('operator-b')).map(e => e.id)).toEqual([b.id]);
  expect(await queue.allConflicts('unrelated')).toEqual([]);
  expect(await queue.allPending('unrelated')).toEqual([]);
  expect(await queue.pendingCount()).toBe(1);
  expect(await queue.allConflicts()).toHaveLength(2);
});

it('retains the same intent, command key, and committed receipt across module restarts', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const first = await import('./outbox');
  const draft = { actor: 'operator', quantity: 4 };
  const intent = first.intentIdentity('transfer', draft);
  const entry = await first.enqueue('transfer', { ...draft, idempotencyKey: 'persistent-key-0001' }, undefined, intent);
  vi.resetModules();
  const restarted = await import('./outbox');
  expect(await restarted.findIntent(intent)).toEqual(entry);
  await restarted.markCommitted(entry.id);
  expect(await restarted.pendingCount()).toBe(0);
  vi.resetModules();
  const again = await import('./outbox');
  expect(await again.findIntent(intent)).toMatchObject({ status: 'committed', input: { idempotencyKey: 'persistent-key-0001' } });
});

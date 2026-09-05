import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

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

import { useEffect, useRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { _resetMemoryQueue, allPending, allConflicts, enqueue, markConflict, replayEntry } from '@intra/data-kit';
import * as dataKit from '@intra/data-kit';
import { ToastProvider } from '@/components/ui';
import { makeRepo } from '@/test/renderWithProviders';
import { InMemoryRepository } from '@/data/inMemoryRepository';
import { useWarehouse, WarehouseProvider } from './store';

function IdentityProbe({
  onResult,
}: {
  onResult: (result: { requestedBy?: string; decisionCommitted: boolean }) => void;
}) {
  const started = useRef(false);
  const { recordCycleCount, submitCycleCount, decideStockChange } = useWarehouse();

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      await recordCycleCount({
        locationId: 'loc-main',
        lines: [{ productId: 'shirt-l', expected: 120, counted: 119 }],
      });
      const count = (await repo.getData()).cycleCounts.at(-1)!;
      await submitCycleCount({
        idempotencyKey: 'provider-profile-submit',
        cycleCountId: count.id,
        reason: 'Provider identity separation',
      });
      const request = (await repo.listStockChangeRequests({})).rows.at(-1)!;
      const decisionCommitted = await decideStockChange({
        idempotencyKey: 'provider-profile-self-denial',
        requestId: request.id,
        decision: 'approved',
      });
      onResult({ requestedBy: request.requestedBy, decisionCommitted });
    })();
  }, [decideStockChange, onResult, recordCycleCount, submitCycleCount]);

  return null;
}

const repo = makeRepo();

function QueuePrivacyProbe({ foreignId }: { foreignId: string }) {
  const warehouse = useWarehouse();
  return <>
    <output aria-label="Queue conflicts">{warehouse.conflicts.map(e => e.error).join(',')}</output>
    <button onClick={() => void warehouse.discardConflict(foreignId)}>Discard foreign conflict</button>
  </>;
}

function QueueScopeProbe({ onQueue }: { onQueue: (queue: ReturnType<typeof useWarehouse>) => void }) {
  const queue = useWarehouse();
  useEffect(() => { onQueue(queue); });
  return <output aria-label="Unresolved legacy count">{queue.unresolvedLegacyCount}</output>;
}

it.each(['switch', 'unmount', 'switch-back'] as const)('stops queued replay after %s while the first command is in flight', async (change) => {
  _resetMemoryQueue();
  await enqueue('transfer', { actor: 'alice', idempotencyKey: 'first-scope' });
  const second = await enqueue('transfer', { actor: 'alice', idempotencyKey: 'second-scope' });
  const repo = makeRepo();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const transfer = vi.spyOn(repo, 'transfer').mockImplementation(async () => { await held; return []; });
  let queue!: ReturnType<typeof useWarehouse>;
  const onQueue = (next: typeof queue) => { queue = next; };
  const view = (actor: string) => <ToastProvider><WarehouseProvider repo={repo} source="memory" actor={actor}>
    <QueueScopeProbe onQueue={onQueue} />
  </WarehouseProvider></ToastProvider>;
  const rendered = render(view('alice'));
  let replay!: Promise<void>;
  await act(async () => { replay = queue.syncNow(); });
  await waitFor(() => expect(transfer).toHaveBeenCalledOnce());
  if (change === 'unmount') rendered.unmount();
  else {
    rendered.rerender(view('bob'));
    if (change === 'switch-back') rendered.rerender(view('alice'));
  }
  await act(async () => { release(); await replay; });
  expect(transfer).toHaveBeenCalledOnce();
  expect(await allPending('alice')).toEqual([second]);
  rendered.unmount();
  _resetMemoryQueue();
});

it.each(['repository', 'source'] as const)('invalidates the replay scope on %s replacement', async (change) => {
  _resetMemoryQueue();
  await enqueue('transfer', { actor: 'alice', idempotencyKey: 'environment-first' });
  const second = await enqueue('transfer', { actor: 'alice', idempotencyKey: 'environment-second' });
  const original = makeRepo();
  const replacement = makeRepo();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const transfer = vi.spyOn(original, 'transfer').mockImplementation(async () => { await held; return []; });
  const nextTransfer = vi.spyOn(replacement, 'transfer').mockResolvedValue([]);
  let queue!: ReturnType<typeof useWarehouse>;
  const view = (repo: typeof original, source: 'memory' | 'supabase') => <ToastProvider>
    <WarehouseProvider repo={repo} source={source} actor="alice">
      <QueueScopeProbe onQueue={next => { queue = next; }} />
    </WarehouseProvider>
  </ToastProvider>;
  const rendered = render(view(original, change === 'source' ? 'supabase' : 'memory'));
  let replay: Promise<void> | undefined;
  if (change === 'repository') await act(async () => { replay = queue.syncNow(); });
  await waitFor(() => expect(transfer).toHaveBeenCalledOnce());
  const stale = queue;
  rendered.rerender(view(change === 'repository' ? replacement : original, 'memory'));
  await act(async () => { release(); await replay; await stale.syncNow(); });
  await waitFor(async () => expect(await allPending('alice')).toEqual([second]));
  expect(transfer).toHaveBeenCalledOnce();
  expect(queue.source).toBe('memory');
  if (change === 'repository') {
    await act(async () => { await queue.syncNow(); });
    expect(nextTransfer).toHaveBeenCalledOnce();
    expect(transfer).toHaveBeenCalledOnce();
  }
  rendered.unmount();
  _resetMemoryQueue();
});

it.each(['switch', 'unmount'] as const)('ignores an outbox read that resolves after %s', async (change) => {
  _resetMemoryQueue();
  const entry = await enqueue('transfer', { actor: 'alice', idempotencyKey: 'delayed-read' });
  const repo = makeRepo();
  const transfer = vi.spyOn(repo, 'transfer').mockResolvedValue([]);
  let queue!: ReturnType<typeof useWarehouse>;
  const onQueue = (next: typeof queue) => { queue = next; };
  const view = (actor: string) => <ToastProvider><WarehouseProvider repo={repo} source="memory" actor={actor}>
    <QueueScopeProbe onQueue={onQueue} />
  </WarehouseProvider></ToastProvider>;
  const rendered = render(view('alice'));
  let release!: (entries: typeof entry[]) => void;
  const pending = vi.spyOn(dataKit, 'allPending').mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  let replay!: Promise<void>;
  await act(async () => { replay = queue.syncNow(); });
  if (change === 'unmount') rendered.unmount();
  else rendered.rerender(view('bob'));
  await act(async () => { release([entry]); await replay; });
  expect(transfer).not.toHaveBeenCalled();
  pending.mockRestore();
  expect(await allPending('alice')).toEqual([entry]);
  rendered.unmount();
  _resetMemoryQueue();
});

it('rejects stale replay and discard callbacks after a same-actor profile change or unmount', async () => {
  _resetMemoryQueue();
  const pending = await enqueue('transfer', { actor: 'alice', idempotencyKey: 'profile-pending' });
  const conflict = await enqueue('transfer', { actor: 'alice', idempotencyKey: 'profile-conflict' });
  await markConflict(conflict.id, 'Private conflict');
  const repo = makeRepo();
  const transfer = vi.spyOn(repo, 'transfer').mockResolvedValue([]);
  let queue!: ReturnType<typeof useWarehouse>;
  const view = (identityId: string) => <ToastProvider><WarehouseProvider repo={repo} source="memory" actor="alice" identityId={identityId}>
    <QueueScopeProbe onQueue={next => { queue = next; }} />
  </WarehouseProvider></ToastProvider>;
  const rendered = render(view('profile-a'));
  const stale = queue;
  rendered.rerender(view('profile-b'));
  await act(async () => { await stale.syncNow(); await stale.discardConflict(conflict.id); });
  const current = queue;
  rendered.unmount();
  await act(async () => { await current.syncNow(); await current.discardConflict(conflict.id); });
  expect(transfer).not.toHaveBeenCalled();
  expect(await allPending('alice')).toEqual([pending]);
  expect(await allConflicts('alice')).toEqual([conflict]);
  _resetMemoryQueue();
});

it('reports legacy counts and recovery guidance without exposing or discarding unsafe payloads', async () => {
  _resetMemoryQueue();
  const unowned = await enqueue('transfer', { secret: 'unowned secret' });
  const unkeyed = await enqueue('transfer', { actor: 'alice', secret: 'unkeyed secret' });
  await markConflict(unkeyed.id, 'legacy private failure');
  const foreign = await enqueue('transfer', { actor: 'bob', idempotencyKey: 'foreign', secret: 'Bob secret' });
  await markConflict(foreign.id, 'Bob private failure');
  let queue!: ReturnType<typeof useWarehouse>;
  const repo = makeRepo();
  const transfer = vi.spyOn(repo, 'transfer');
  const rendered = render(<ToastProvider><WarehouseProvider repo={repo} source="memory" actor="alice">
    <QueueScopeProbe onQueue={next => { queue = next; }} />
  </WarehouseProvider></ToastProvider>);
  await waitFor(() => expect(screen.getByLabelText('Unresolved legacy count')).toHaveTextContent('2'));
  expect(document.body).not.toHaveTextContent(/unowned secret|unkeyed secret|legacy private failure|Bob secret|Bob private failure/);
  expect(queue.conflicts).toEqual([]);
  expect(queue.pendingSync).toBe(0);
  await act(async () => {
    await queue.syncNow();
    await queue.discardConflict(unowned.id);
    await queue.discardConflict(unkeyed.id);
    await queue.discardConflict(foreign.id);
  });
  expect(transfer).not.toHaveBeenCalled();
  expect(await allPending()).toEqual([unowned]);
  expect(await allConflicts()).toEqual([unkeyed, foreign]);
  rendered.unmount();
  _resetMemoryQueue();
});

it('does not expose or discard another actor conflict after switching account', async () => {
  _resetMemoryQueue();
  const a = await enqueue('transfer', { actor: 'alice', idempotencyKey: 'qa' });
  const b = await enqueue('transfer', { actor: 'bob', idempotencyKey: 'qb' });
  await markConflict(a.id, 'Alice private conflict');
  await markConflict(b.id, 'Bob private conflict');
  const view = (actor: string) => <ToastProvider><WarehouseProvider repo={makeRepo()} source="memory" actor={actor}>
    <QueuePrivacyProbe foreignId={a.id} />
  </WarehouseProvider></ToastProvider>;
  const rendered = render(view('alice'));
  await waitFor(() => expect(screen.getByLabelText('Queue conflicts')).toHaveTextContent('Alice private conflict'));
  rendered.rerender(view('bob'));
  expect(screen.getByLabelText('Queue conflicts')).not.toHaveTextContent('Alice');
  await waitFor(() => expect(screen.getByLabelText('Queue conflicts')).toHaveTextContent('Bob private conflict'));
  fireEvent.click(screen.getByText('Discard foreign conflict'));
  await waitFor(async () => expect(await allConflicts('alice')).toHaveLength(1));
  rendered.unmount();
  _resetMemoryQueue();
});

function OfflineProbe({ onResult }: { onResult: (value: unknown) => void }) {
  const warehouse = useWarehouse();
  return <>
    <output aria-label="Action status">{warehouse.lastActionStatus ?? 'idle'}</output>
    <button onClick={() => void (async () => {
      const committed = await warehouse.receiveStock({ locationId: 'loc-main', lines: [{ productId: 'shirt-l', quantity: 1 }] });
      onResult({ committed, status: warehouse.lastActionStatus });
    })()}>Receive draft</button>
    <button onClick={() => void warehouse.syncNow()}>Replay draft</button>
  </>;
}

function ReturnLineageProbe() {
  const warehouse = useWarehouse();
  return <button onClick={() => void warehouse.recordReturn({ source: 'event', eventId: 'event-1',
    lines: [{ allocationId: 'allocation-1', productId: 'shirt-l', quantity: 2, locationId: 'loc-main', reason: 'Unused' }],
  })}>Return linked draft</button>;
}

it('preserves line allocation identity in an offline return and its replay', async () => {
  _resetMemoryQueue();
  const returnRepo = makeRepo();
  const recordReturn = vi.spyOn(returnRepo, 'recordReturn').mockRejectedValue(new Error('Failed to fetch'));
  render(<ToastProvider><WarehouseProvider repo={returnRepo} source="supabase" actor="operator"
    capabilities={['manage_returns']}><ReturnLineageProbe /></WarehouseProvider></ToastProvider>);
  fireEvent.click(screen.getByText('Return linked draft'));
  await waitFor(() => expect(recordReturn).toHaveBeenCalledTimes(1));
  await waitFor(async () => expect(await allPending()).toHaveLength(1));
  const queued = (await allPending())[0]!;
  expect(queued.method).toBe('recordReturn');
  expect(queued.input.lines).toEqual(recordReturn.mock.calls[0]![0].lines);
  expect(recordReturn.mock.calls[0]![0].lines[0]!.allocationId).toBe('allocation-1');
  recordReturn.mockResolvedValue({ id: 'returned' } as never);
  expect(await replayEntry({ repo: returnRepo, actor: 'operator' }, queued)).toBe(true);
  expect(recordReturn.mock.calls[1]![0].lines).toEqual(queued.input.lines);
  expect(recordReturn.mock.calls[1]![0].idempotencyKey).toBe(queued.input.idempotencyKey);
  _resetMemoryQueue();
});

it('exposes queued status after await, retains the draft key, and completes only after replay', async () => {
  _resetMemoryQueue();
  const offlineRepo = makeRepo();
  const receive = vi.spyOn(offlineRepo, 'receiveStock').mockRejectedValueOnce(new Error('Failed to fetch'));
  const result = vi.fn();
  render(<ToastProvider><WarehouseProvider repo={offlineRepo} source="supabase" actor="operator"
    capabilities={['receive_stock']}><OfflineProbe onResult={result} /></WarehouseProvider></ToastProvider>);
  fireEvent.click(screen.getByText('Receive draft'));
  await waitFor(() => expect(result).toHaveBeenLastCalledWith({ committed: false, status: 'queued' }));
  fireEvent.click(screen.getByText('Receive draft'));
  await waitFor(() => expect(result).toHaveBeenCalledTimes(2));
  expect(receive).toHaveBeenCalledTimes(1);
  const key = receive.mock.calls[0]![0].idempotencyKey;
  expect(key).toBeTruthy();
  receive.mockResolvedValue({ id: 'confirmed' } as never);
  fireEvent.click(screen.getByText('Replay draft'));
  await waitFor(() => expect(receive).toHaveBeenCalledTimes(2));
  expect(receive.mock.calls[1]![0].idempotencyKey).toBe(key);
  fireEvent.click(screen.getByText('Receive draft'));
  await waitFor(() => expect(result).toHaveBeenLastCalledWith({ committed: true, status: 'committed' }));
  expect(receive).toHaveBeenCalledTimes(2);
  _resetMemoryQueue();
});

class TimeoutThenSuccessRepository extends InMemoryRepository {
  attempts = 0;

  override async getData() {
    this.attempts += 1;
    if (this.attempts === 1) {
      return new Promise<never>(() => undefined);
    }
    return super.getData();
  }
}

function ReadinessProbe() {
  const { data, error, loading, refresh } = useWarehouse();
  return (
    <div>
      <output aria-label="Warehouse readiness">
        {loading ? 'loading' : error ? error : data ? 'ready' : 'empty'}
      </output>
      <button type="button" onClick={() => void refresh()}>
        Retry warehouse data
      </button>
    </div>
  );
}

describe('WarehouseProvider identity authority', () => {
  it('persists immutable profile id and denies the same profile despite a different email', async () => {
    let result: { requestedBy?: string; decisionCommitted: boolean } | undefined;
    render(
      <ToastProvider>
        <WarehouseProvider
          repo={repo}
          source="memory"
          initialRole="warehouse_supervisor"
          roleCode="warehouse_supervisor"
          actor="supervisor.display@mwell.com.ph"
          identityId="profile-supervisor-001"
        >
          <IdentityProbe onResult={(next) => { result = next; }} />
        </WarehouseProvider>
      </ToastProvider>,
    );

    await waitFor(() => expect(result).toEqual({
      requestedBy: 'profile-supervisor-001',
      decisionCommitted: false,
    }));
    expect((await repo.listStockChangeRequests({})).rows.at(-1)?.status)
      .toBe('pending_supervisor');
  });

  it('bounds an unresolved initial read and allows a clean retry', async () => {
    const boundedRepo = new TimeoutThenSuccessRepository();

    render(
      <ToastProvider>
        <WarehouseProvider
          repo={boundedRepo}
          source="memory"
          loadTimeoutMs={25}
        >
          <ReadinessProbe />
        </WarehouseProvider>
      </ToastProvider>,
    );

    expect(screen.getByLabelText('Warehouse readiness')).toHaveTextContent(
      'loading',
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Warehouse readiness')).toHaveTextContent(
        /taking longer than expected/i,
      ),
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Retry warehouse data' }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText('Warehouse readiness')).toHaveTextContent(
        'ready',
      ),
    );
    expect(boundedRepo.attempts).toBe(2);
  });
});

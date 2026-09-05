import { useEffect, useRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { _resetMemoryQueue, allPending, replayEntry } from '@intra/data-kit';
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

import { useEffect, useRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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

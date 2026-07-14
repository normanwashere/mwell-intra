import { useEffect, useRef } from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToastProvider } from '@/components/ui';
import { makeRepo } from '@/test/renderWithProviders';
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
});

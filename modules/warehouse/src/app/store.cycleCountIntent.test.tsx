import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { CycleCountOutcome } from '@intra/data-kit';
import { useWarehouse } from './store';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';
import { cycleCountIntentKey, retainCycleCountIntent, type CycleCountCommand } from '@/domain/cycleCountIntent';

function Probe({ counted, done }: { counted: number; done: (outcome: CycleCountOutcome) => void }) {
  const warehouse = useWarehouse();
  return <button disabled={!warehouse.data} onClick={() => {
    const command: CycleCountCommand = {
      cycleCountId: 'cc-immutable-store-test', idempotencyKey: 'atomic-count-store-test',
      actor: warehouse.actor, requesterId: warehouse.identityId,
      locationId: 'loc-wh', category: 'merchandise',
      lines: [{ productId: 'shirt-l', expected: 120, counted }],
      reason: 'Scheduled cycle count', evidenceUrls: ['evidence/count.jpg'],
    };
    retainCycleCountIntent(cycleCountIntentKey(warehouse.source, warehouse.identityId), {
      ...command, lines: [{ productId: 'shirt-l', expected: 120, counted: 100 }],
    });
    void warehouse.submitNewCycleCount(command).then(done);
  }}>Send saved count</button>;
}

it('rejects a changed payload under a retained count key before the repository is called', async () => {
  const repo = makeRepo();
  const send = vi.spyOn(repo, 'createAndSubmitCycleCount').mockResolvedValue([]);
  const done = vi.fn();
  renderWithProviders(<Probe counted={99} done={done} />, { repo, role: 'warehouse_operator' });
  await waitFor(() => expect(screen.getByText('Send saved count')).toBeEnabled());
  fireEvent.click(screen.getByText('Send saved count'));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(done).toHaveBeenCalledWith({ status: 'unknown', message: expect.any(String) });
  expect(send).not.toHaveBeenCalled();
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui';
import { makeRepo } from '@/test/renderWithProviders';
import { useWarehouse, WarehouseProvider } from './store';

function Probe({ result }: { result: (value: unknown) => void }) {
  const warehouse = useWarehouse();
  return <button disabled={warehouse.loading} onClick={() => {
    void warehouse.getCycleCount('older-source').then(result, result);
  }}>Load count</button>;
}

it('delegates exact-ID reads outside the bounded snapshot and preserves errors', async () => {
  const repo = makeRepo();
  const lookup = vi.spyOn(repo, 'getCycleCount').mockResolvedValue(null);
  const snapshot = vi.spyOn(repo, 'getData');
  const result = vi.fn();
  render(<ToastProvider><WarehouseProvider repo={repo} source="memory"><Probe result={result} /></WarehouseProvider></ToastProvider>);
  await waitFor(() => expect(screen.getByText('Load count')).not.toBeDisabled());
  snapshot.mockClear();
  fireEvent.click(screen.getByText('Load count'));
  await waitFor(() => expect(result).toHaveBeenLastCalledWith(null));
  expect(lookup).toHaveBeenCalledWith('older-source');
  const error = new Error('Read unavailable');
  lookup.mockRejectedValueOnce(error);
  fireEvent.click(screen.getByText('Load count'));
  await waitFor(() => expect(result).toHaveBeenLastCalledWith(error));
  expect(snapshot).not.toHaveBeenCalled();
});

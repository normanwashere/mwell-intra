import { useState } from 'react';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { buildSeed, enqueue, intentIdentity, markCommitted, markConflict, removeEntry } from '@intra/data-kit';
import { useWarehouse } from '@/app/store';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';
import { RelocationSheet } from './RelocationSheet';

function Harness({ onActor }: { onActor: (actor: string) => void }) {
  const { data, actor } = useWarehouse();
  const [open, setOpen] = useState(true);
  onActor(actor);
  return data && <RelocationSheet product={data.products.find(p => p.id === 'shirt-l')!}
    data={data} initialLocationId="loc-wh" open={open} onOpenChange={setOpen} />;
}

describe('relocation recovery and selected identity', () => {
  it.each(['committed', 'pending', 'conflict'] as const)('reconciles an actor-owned %s command before depleted stock checks', async status => {
    const seed = buildSeed();
    seed.stockLevels = seed.stockLevels.map(row => row.productId === 'shirt-l' ? { ...row, quantity: 0 } : row);
    const repo = makeRepo(seed);
    const move = vi.spyOn(repo, 'relocate');
    const holds = vi.spyOn(repo, 'listHolds');
    let actor = '';
    renderWithProviders(<Harness onActor={value => { actor = value; }} />, { repo, source: 'supabase', capabilities: ['transfer_stock', 'inspect_quality'] });
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('To bin'), 'bin-pasig-a1');
    const input = { productId: 'shirt-l', locationId: 'loc-wh', toBinId: 'bin-pasig-a1', quantity: 1, actor };
    const receipt = await enqueue('relocate', { ...input, idempotencyKey: 'retained-move' }, undefined, intentIdentity('relocate', input));
    try {
      if (status === 'committed') await markCommitted(receipt.id);
      if (status === 'conflict') await markConflict(receipt.id, 'Source changed; review this command.');
      await user.click(screen.getByRole('button', { name: 'Move stock' }));
      if (status === 'committed') {
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(screen.getByText(/previously submitted move.*confirmed/i)).toBeVisible();
        expect(Object.keys(localStorage).filter(key => key.startsWith('intra.warehouse-relocation'))).toHaveLength(0);
      } else {
        expect(await screen.findByRole('alert')).toHaveTextContent(status === 'pending' ? /pending.*sync/i : /Source changed/);
        expect(screen.getByLabelText('To bin')).toHaveValue('bin-pasig-a1');
      }
      expect(holds).not.toHaveBeenCalled();
      expect(move).not.toHaveBeenCalled();
      expect(screen.queryByText(/Only 0 units/)).not.toBeInTheDocument();
      if (status === 'pending') {
        await markCommitted(receipt.id);
        await user.click(screen.getByRole('button', { name: 'Move stock' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(move).not.toHaveBeenCalled();
        expect(holds).not.toHaveBeenCalled();
      }
    } finally {
      await act(() => removeEntry(receipt.id));
    }
  });

  it('does not accept another actor receipt as completion or bypass the stock check', async () => {
    const seed = buildSeed();
    seed.stockLevels = seed.stockLevels.map(row => row.productId === 'shirt-l' ? { ...row, quantity: 0 } : row);
    const repo = makeRepo(seed);
    const move = vi.spyOn(repo, 'relocate');
    renderWithProviders(<Harness onActor={() => {}} />, { repo, source: 'supabase', capabilities: ['transfer_stock', 'inspect_quality'] });
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('To bin'), 'bin-pasig-a1');
    const input = { productId: 'shirt-l', locationId: 'loc-wh', toBinId: 'bin-pasig-a1', quantity: 1, actor: 'another-operator' };
    const receipt = await enqueue('relocate', { ...input, idempotencyKey: 'someone-else' }, undefined, intentIdentity('relocate', input));
    await markCommitted(receipt.id);
    try {
      await user.click(screen.getByRole('button', { name: 'Move stock' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Only 0 units');
      expect(move).not.toHaveBeenCalled();
    } finally { await act(() => removeEntry(receipt.id)); }
  });

  it('describes the full selected warehouse and bin outside the native select and updates it', async () => {
    const seed = buildSeed();
    const first = seed.storageAreas.find(bin => bin.id === 'bin-pasig-a1')!;
    first.code = 'LONG-SHARED-PREFIX-RECEIVING-DESTINATION-A';
    first.label = 'North warehouse quarantine receiving shelf';
    seed.storageAreas.push({ ...first, id: 'other-bin', code: 'LONG-SHARED-PREFIX-RECEIVING-DESTINATION-B' });
    renderWithProviders(<Harness onActor={() => {}} />, { repo: makeRepo(seed) });
    const user = userEvent.setup();
    const select = await screen.findByLabelText('To bin');
    await user.selectOptions(select, first.id);
    expect(select).toHaveAccessibleDescription(new RegExp(`${seed.locations.find(l => l.id === first.locationId)!.name}.*${first.code}.*${first.label}`));
    const description = document.getElementById(select.getAttribute('aria-describedby')!)!;
    expect(description.tagName).toBe('P');
    expect(description).toHaveClass('[overflow-wrap:anywhere]');
    await user.selectOptions(select, 'other-bin');
    expect(select).toHaveAccessibleDescription(/DESTINATION-B/);
    expect(select).not.toHaveAccessibleDescription(/DESTINATION-A/);
  });
});

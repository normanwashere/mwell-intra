import { beforeEach, describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PurchaseOrdersPage } from './PurchaseOrdersPage';
import { renderWithProviders } from '@/test/renderWithProviders';
import { PROCUREMENT_PO_KEY } from '@/data/procurementBridge';
import { InMemoryRepository } from '@/data/inMemoryRepository';
import type { ReceiveProcurementPOInput } from '@intra/data-kit';

class LiveProcurementRepository extends InMemoryRepository {
  receivedInputs: ReceiveProcurementPOInput[] = [];

  override async getReceivableProcurementPOs() {
    return [{
      id: 'live-po-1', poNumber: 'PO-LIVE-001', vendorName: 'Live Medical Vendor',
      status: 'issued' as const,
      lines: [{
        id: 'live-line-1', productId: 'smart-watch', description: 'Smart watches',
        quantity: 2, receivedQuantity: 0,
      }],
    }];
  }

  override async receiveProcurementPO(input: ReceiveProcurementPOInput) {
    this.receivedInputs.push(input);
    return super.receiveProcurementPO(input);
  }
}

describe('PurchaseOrdersPage', () => {
  it('does not expose PO authoring or cancellation to the Operator', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrdersPage />, { role: 'operations' });
    const list = await screen.findByLabelText('Purchase orders');
    expect(screen.queryByRole('button', { name: /new po/i })).not.toBeInTheDocument();
    await user.click(within(list).getAllByRole('button')[0]!);
    expect(screen.queryByRole('button', { name: /cancel po/i })).not.toBeInTheDocument();
  });

  beforeEach(() => {
    window.localStorage.clear();
  });

  it('lists seeded purchase orders with human PO numbers', async () => {
    renderWithProviders(<PurchaseOrdersPage />, { role: 'operations' });
    const list = await screen.findByLabelText('Purchase orders');
    expect(within(list).getAllByText(/mWellness Wearables/i).length).toBeGreaterThan(0);
    expect(within(list).getByText(/MetroPrint Apparel/i)).toBeInTheDocument();
    // No raw ids as labels (WH-26) — stable PO-#### numbers instead.
    expect(within(list).queryByText(/po-wearables/i)).not.toBeInTheDocument();
    expect(within(list).getAllByText(/PO-\d{4}/).length).toBeGreaterThan(0);
  });

  it('filters purchase orders by status', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrdersPage />, { role: 'procurement' });
    await screen.findByLabelText('Purchase orders');

    await user.click(screen.getByRole('tab', { name: /^closed$/i }));
    const list = screen.getByLabelText('Purchase orders');
    expect(within(list).getByText(/GiftWorks/i)).toBeInTheDocument();
    expect(within(list).queryByText(/mWellness Wearables/i)).not.toBeInTheDocument();
  });

  it('creates a new purchase order', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrdersPage />, { role: 'procurement' });
    await screen.findByLabelText('Purchase orders');

    await user.click(screen.getByRole('button', { name: /new po/i }));
    const dialog = await screen.findByRole('dialog', { name: /new purchase order/i });
    await user.selectOptions(within(dialog).getByLabelText('Product'), 'smart-watch');
    await user.click(within(dialog).getByRole('button', { name: /add line/i }));
    expect(within(dialog).getByLabelText('Draft lines')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /create po/i }));

    await waitFor(() => {
      expect(screen.getByText(/purchase order created/i)).toBeInTheDocument();
    });
  });

  it('receives stock via the PO detail sheet (row is the target)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrdersPage />, { role: 'operations' });
    const list = await screen.findByLabelText('Purchase orders');

    // Open the ordered wearables PO from its row.
    await user.click(
      within(list).getAllByRole('button', { name: /mWellness Wearables/i })[0]!,
    );
    const detail = await screen.findByRole('dialog', { name: /mWellness Wearables/i });
    await user.click(within(detail).getByRole('button', { name: /^receive and inspect$/i }));

    const dialog = await screen.findByRole('dialog', { name: /receive against po/i });
    expect(within(dialog).getByText(/inspection required/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /confirm receipt/i }));

    await waitFor(() => {
      expect(screen.getByText(/received against po into inspection staging/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /open quality queue/i })).toBeInTheDocument();
  });

  it('does not offer Receive on a draft PO (WH-25)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrdersPage />, { role: 'operations' });
    const list = await screen.findByLabelText('Purchase orders');

    // The seeded draft PO (sleep rings + OTG bags from mWellness Wearables).
    const draftRow = within(list)
      .getAllByRole('button')
      .find((b) => /draft/i.test(b.textContent ?? ''));
    expect(draftRow).toBeDefined();
    await user.click(draftRow!);
    const detail = await screen.findByRole('dialog', { name: /mWellness Wearables/i });
    expect(
      within(detail).queryByRole('button', { name: /^receive$/i }),
    ).not.toBeInTheDocument();
    expect(within(detail).getByText(/not yet ordered/i)).toBeInTheDocument();
  });

  it('cancels an open purchase order after an explicit confirm', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrdersPage />, { role: 'procurement' });
    const list = await screen.findByLabelText('Purchase orders');

    await user.click(
      within(list).getAllByRole('button', { name: /MetroPrint Apparel/i })[0]!,
    );
    const detail = await screen.findByRole('dialog', { name: /MetroPrint Apparel/i });
    await user.click(within(detail).getByRole('button', { name: /cancel po/i }));
    await user.click(within(detail).getByRole('button', { name: /confirm cancel/i }));

    await waitFor(() => {
      expect(screen.getByText(/purchase order cancelled/i)).toBeInTheDocument();
    });
  });

  it('surfaces procurement-issued POs with a From Procurement badge and deep link', async () => {
    window.localStorage.setItem(
      PROCUREMENT_PO_KEY,
      JSON.stringify([
        {
          id: 'ppo-9',
          poNumber: 'PO-2026-0003',
          vendorId: 'ven-acme',
          vendorName: 'Acme Medical Supplies',
          status: 'issued',
          origin: 'request',
          lines: [
            {
              id: 'l1',
              description: 'Barcode scanners',
              quantity: 4,
              unitPrice: 650000,
              receivedQuantity: 0,
            },
          ],
          createdAt: '2026-07-05T10:00:00.000Z',
          updatedAt: '2026-07-05T10:00:00.000Z',
          total: 2600000,
        },
      ]),
    );
    renderWithProviders(<PurchaseOrdersPage />, { role: 'operations' });
    const list = await screen.findByLabelText('Purchase orders');

    expect(within(list).getByText('From Procurement')).toBeInTheDocument();
    const link = within(list).getByRole('link', { name: 'PO-2026-0003' });
    expect(link).toHaveAttribute('href', '/procurement/purchase-orders/ppo-9');
    expect(
      within(list).getByRole('button', { name: /^receive and inspect$/i }),
    ).toBeInTheDocument();
    expect(within(list).getByText(/Acme Medical Supplies/i)).toBeInTheDocument();
  });

  it('uses the live handoff in Supabase mode and ignores local cached POs', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(PROCUREMENT_PO_KEY, JSON.stringify([{
      id: 'cached-po', poNumber: 'PO-CACHED', vendorName: 'Cached Vendor', status: 'issued',
      lines: [], createdAt: '2026-07-01T00:00:00Z',
    }]));
    const repo = new LiveProcurementRepository();
    renderWithProviders(<PurchaseOrdersPage />, {
      role: 'logistics_supervisor', repo, source: 'supabase',
    });

    const list = await screen.findByLabelText('Purchase orders');
    expect(within(list).getByText('PO-LIVE-001')).toBeInTheDocument();
    expect(within(list).queryByText('PO-CACHED')).not.toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: /^receive and inspect$/i }));
    const dialog = await screen.findByRole('dialog', { name: /receive approved procurement po/i });
    await user.type(within(dialog).getByLabelText(/delivery evidence url/i), 'evidence/live.jpg');
    await user.click(within(dialog).getByRole('button', { name: /confirm governed receipt/i }));

    await waitFor(() => expect(repo.receivedInputs).toHaveLength(1));
    expect(repo.receivedInputs[0]).toMatchObject({ poId: 'live-po-1', locationId: 'loc-wh' });
  });
});

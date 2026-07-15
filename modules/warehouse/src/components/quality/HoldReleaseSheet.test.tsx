import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { HoldReleaseSheet } from './HoldReleaseSheet';

it('offers an evidence-backed atomic rejection to vendor return', async () => {
  const user = userEvent.setup();
  const onRejectToVendor = vi.fn().mockResolvedValue(true);
  render(<HoldReleaseSheet
    hold={{ id: 'hold-1', inspectionId: 'qi-1', productId: 'product-1', locationId: 'loc-1',
      quantity: 2, status: 'active', reason: 'Damaged cartons', createdBy: 'operator-1',
      createdAt: '2026-07-15T01:00:00Z' }}
    actor="supervisor-1" productName="Diagnostic kit" mode="release"
    suppliers={[{ id: 'supplier-1', name: 'Vendor One', leadTimeDays: 7 }]}
    defaultSupplierId="supplier-1" onOpenChange={vi.fn()} onRelease={vi.fn()}
    onCreateVendorReturn={vi.fn()} onRejectToVendor={onRejectToVendor}
  />);

  const dialog = screen.getByRole('dialog', { name: /review inventory hold/i });
  await user.click(within(dialog).getByRole('tab', { name: /reject to vendor/i }));
  await user.type(within(dialog).getByLabelText(/vendor return reference/i), 'RMA-2026-100');
  await user.type(within(dialog).getByLabelText(/vendor return reason/i), 'Rejected after controlled review');
  await user.type(within(dialog).getByLabelText(/vendor return evidence url/i), 'evidence/rejection.pdf');
  await user.click(within(dialog).getByRole('button', { name: /reject and create vendor return/i }));

  expect(onRejectToVendor).toHaveBeenCalledWith(expect.objectContaining({
    holdId: 'hold-1', supplierId: 'supplier-1', reference: 'RMA-2026-100',
  }));
});

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FulfillmentPage } from './FulfillmentPage';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';

describe('Fulfillment sufficient-bin picking', () => {
  it.each([
    { serialized: true, alternate: false, pickerOnly: false },
    { serialized: false, alternate: false, pickerOnly: false },
    { serialized: true, alternate: true, pickerOnly: false },
    { serialized: true, alternate: false, pickerOnly: true },
  ])('picks sufficient B with exact custody ($serialized / alternative=$alternate / pickerOnly=$pickerOnly)', async ({ serialized, alternate, pickerOnly }) => {
    const seed = makeRepo();
    const productId = serialized ? 'smart-watch' : 'shirt-l';
    const order = await seed.createFulfillmentOrder({
      source: serialized ? 'ecommerce' : 'department_request', externalReference: 'QA1-SUFFICIENT-BIN', sourceLocationId: 'loc-wh',
      lines: [{ productId, quantity: 2 }], actor: 'requester',
    });
    const data = await seed.getData();
    data.fulfillmentOrders = [{ ...order, status: 'picking', deliveryMethod: 'shipment' }];
    data.fulfillmentReservations = [];
    data.storageAreas = [
      { id: 'a', locationId: 'loc-wh', code: 'A-01', active: true },
      { id: 'b', locationId: 'loc-wh', code: 'B-01', active: true },
    ];
    data.units = serialized ? [
      { id: 'a1', productId, serialNumber: 'A-ONE', locationId: 'loc-wh', binId: 'a', status: 'in_stock' },
      { id: 'b1', productId, serialNumber: 'B-ONE', locationId: 'loc-wh', binId: 'b', status: 'in_stock' },
      { id: 'b2', productId, serialNumber: 'B-TWO', locationId: 'loc-wh', binId: 'b', status: 'in_stock' },
    ] : [];
    data.stockLevels = [
      { productId, locationId: 'loc-wh', binId: 'a', quantity: 1 },
      { productId, locationId: 'loc-wh', binId: 'b', quantity: 2 },
    ];
    if (alternate) {
      data.units.unshift({ ...data.units[0]!, id: 'a0', serialNumber: 'A-ZERO' });
      data.stockLevels[0]!.quantity = 2;
    }
    const repo = makeRepo(data);
    const advance = vi.spyOn(repo, 'advanceFulfillmentOrder');
    const privateHolds = vi.spyOn(repo, 'listHolds').mockRejectedValue(new Error('Private holds are not authorized'));
    if (pickerOnly) vi.spyOn(repo, 'listInventoryPositions').mockRejectedValue(new Error('Optional projection unavailable'));
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, { repo, role: 'warehouse_operator',
      source: pickerOnly ? 'supabase' : 'memory', capabilities: pickerOnly ? ['view_inventory', 'issue_items'] : undefined });
    await user.click(await screen.findByRole('button', { name: 'Confirm scanned pick' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Scanned bin code for/), 'B-01{Enter}');
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    if (serialized) {
      await user.type(within(dialog).getByLabelText(/^Enter serial for/), 'B-ONE{Enter}');
      await user.type(within(dialog).getByLabelText(/^Enter serial for/), 'B-TWO{Enter}');
    } else {
      await user.type(within(dialog).getByLabelText(/^Product barcode for/), `${data.products.find(product => product.id === productId)!.sku}{Enter}`);
      await user.type(within(dialog).getByLabelText(/^Picked quantity for/), '2');
    }
    await user.click(within(dialog).getByRole('button', { name: /^Confirm pick$/ }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(advance).toHaveBeenCalledOnce();
    expect(advance.mock.calls[0]![0].pickedLines).toEqual([expect.objectContaining({
      productId, quantity: 2, binId: 'b', serialNumbers: serialized ? ['B-ONE', 'B-TWO'] : [],
    })]);
    const saved = await repo.getData();
    expect(saved.fulfillmentOrders[0]!.lines[0]!.pickBinId).toBe('b');
    expect(saved.fulfillmentOrders[0]!.status).toBe('packing');
    expect(saved.stockLevels).toEqual(data.stockLevels);
    expect(privateHolds).not.toHaveBeenCalled();
  });
});

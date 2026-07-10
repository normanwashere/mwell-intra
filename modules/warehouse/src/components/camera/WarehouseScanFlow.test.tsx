import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WarehouseScanFlow, resolveWarehouseScan } from './WarehouseScanFlow';
import { makeRepo } from '@/test/renderWithProviders';

describe('resolveWarehouseScan', () => {
  it('distinguishes unknown, duplicate, mismatch, and invalid lifecycle states', async () => {
    const data = await makeRepo().getData();
    expect(resolveWarehouseScan({ data, context: 'lookup', code: 'MISSING' })).toMatchObject({ ok: false, errorCode: 'unknown' });
    expect(resolveWarehouseScan({ data, context: 'issue', code: 'SMART-WATCH-SN0001', expectedProductId: 'ecg-ring-6' })).toMatchObject({ ok: false, errorCode: 'mismatch' });
    expect(resolveWarehouseScan({ data, context: 'return', code: 'SMART-WATCH-SN0001' })).toMatchObject({ ok: false, errorCode: 'invalid_state' });
    expect(resolveWarehouseScan({ data, context: 'issue', code: 'SMART-WATCH-SN0001', scannedCodes: ['smart-watch-sn0001'] })).toMatchObject({ ok: false, errorCode: 'duplicate' });
  });

  it('blocks already-returned, wrong-bin, and non-countable units with actionable errors', async () => {
    const data = await makeRepo().getData();
    const unit = data.units.find((row) => row.serialNumber === 'SMART-WATCH-SN0001')!;
    unit.status = 'returned';
    expect(resolveWarehouseScan({ data, context: 'return', code: unit.serialNumber })).toMatchObject({
      ok: false,
      message: 'This device was already returned.',
    });
    unit.status = 'in_stock';
    expect(resolveWarehouseScan({
      data,
      context: 'putaway',
      code: unit.serialNumber,
      expectedLocationId: 'loc-wh',
      expectedBinId: 'bin-pasig-a1',
    })).toMatchObject({ ok: false, errorCode: 'mismatch' });
    unit.status = 'issued';
    expect(resolveWarehouseScan({ data, context: 'count', code: unit.serialNumber })).toMatchObject({
      ok: false,
      errorCode: 'invalid_state',
    });
  });
});

describe('WarehouseScanFlow', () => {
  it('announces valid scans, retains them after an error, and supports cancellation', async () => {
    const user = userEvent.setup();
    const data = await makeRepo().getData();
    const onResolved = vi.fn();
    const onCancel = vi.fn();
    render(<WarehouseScanFlow data={data} context="issue" expectedProductId="smart-watch" onResolved={onResolved} onCancel={onCancel} />);

    const input = screen.getByLabelText('Enter barcode manually');
    await user.type(input, 'SMART-WATCH-SN0001');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('status')).toHaveTextContent(/scan accepted/i);
    expect(screen.getByLabelText('Accepted scans')).toHaveTextContent('SMART-WATCH-SN0001');
    await user.type(input, 'UNKNOWN-CODE');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/not recognized/i);
    expect(screen.getByLabelText('Accepted scans')).toHaveTextContent('SMART-WATCH-SN0001');
    await user.click(screen.getByRole('button', { name: 'Cancel scanning' }));
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

import { expect, it } from 'vitest';
import { attachmentSizeLabel, receiptQuantityLabel, governedReceivedQuantity, quantityLabel, poReceiptSummary } from './evidencePresentation';
it('keeps unknown receipt counts explicit in aggregate PO metrics', () => {
  for (const value of [undefined, null, NaN, Infinity, -1]) expect(quantityLabel(value)).toBe('Unknown');
  expect(quantityLabel(0)).toBe('0');
  expect(poReceiptSummary([{ quantity: 1, receivedQuantity: 1 }, { quantity: 2, receivedQuantity: NaN }])).toBe('2 · Unknown / 3 received');
  expect(poReceiptSummary([{ quantity: 2, receivedQuantity: 0 }])).toBe('1 · 0 / 2 received');
  expect(poReceiptSummary([])).toBe('0 · Unknown / Unknown received');
});
it('uses only the exact normalized PO line for physical receipt counts', () => {
  const rows = [
    { id: 'line1', purchase_order_id: 'other', received_quantity: 999 },
    { id: 'line1', purchase_order_id: 'po1', received_quantity: '100' },
  ];
  expect(governedReceivedQuantity('po1', 'line1', rows)).toBe(100);
  expect(governedReceivedQuantity('po1', 'line2', rows)).toBeNaN();
  for (const value of [null, undefined, '', 'bad', -1, Infinity]) {
    expect(governedReceivedQuantity('po1', 'line1', [{ id: 'line1', purchase_order_id: 'po1', received_quantity: value }])).toBeNaN();
  }
  expect(governedReceivedQuantity('po1', 'line1', [{ id: 'line1', purchase_order_id: 'po1', received_quantity: 0 }])).toBe(0);
});
it('distinguishes missing receipt values from zero and keeps valid values', () => {
  for (const value of [undefined, null, NaN, Infinity, -1]) expect(receiptQuantityLabel(value, 1)).toBe('Unknown / 1');
  expect(receiptQuantityLabel(0, 1)).toBe('0 / 1');
  expect(receiptQuantityLabel(1, 1)).toBe('1 / 1');
});
it('never displays NaN metadata', () => {
  for (const value of [undefined, null, NaN, Infinity, -1]) expect(attachmentSizeLabel(value)).toBe('Size unavailable');
  expect(attachmentSizeLabel(1024)).toBe('1.0 KB');
});

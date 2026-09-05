import { expect, it } from 'vitest';
import { attachmentSizeLabel, receiptQuantityLabel } from './evidencePresentation';
it('distinguishes missing receipt values from zero and keeps valid values', () => {
  for (const value of [undefined, null, NaN, Infinity, -1]) expect(receiptQuantityLabel(value, 1)).toBe('Unknown / 1');
  expect(receiptQuantityLabel(0, 1)).toBe('0 / 1');
  expect(receiptQuantityLabel(1, 1)).toBe('1 / 1');
});
it('never displays NaN metadata', () => {
  for (const value of [undefined, null, NaN, Infinity, -1]) expect(attachmentSizeLabel(value)).toBe('Size unavailable');
  expect(attachmentSizeLabel(1024)).toBe('1.0 KB');
});

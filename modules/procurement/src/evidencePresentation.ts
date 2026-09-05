export function receiptQuantityLabel(received: unknown, ordered: unknown): string {
  const quantity = typeof received === 'number' && Number.isFinite(received) && received >= 0 ? received : 'Unknown';
  const total = typeof ordered === 'number' && Number.isFinite(ordered) ? ordered : 'Unknown';
  return `${quantity} / ${total}`;
}

export function attachmentSizeLabel(bytes: unknown): string {
  return typeof bytes === 'number' && Number.isFinite(bytes) && bytes >= 0
    ? `${(bytes / 1024).toFixed(1)} KB` : 'Size unavailable';
}

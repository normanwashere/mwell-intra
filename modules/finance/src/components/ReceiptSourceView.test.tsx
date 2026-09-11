// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReceiptSourceView } from './ReceiptSourceView';
let root: Root; let host: HTMLDivElement;
const source = { type: 'warehouse_receipt' as const, id: 'r1', module: 'warehouse', reference: 'RCPT-001', party: 'Vendor', amount: 100, occurred_at: '2026-09-11', href: '/warehouse/receiving?receipt=r1' };
beforeEach(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('reauthorizes the exact receipt and shows a read-only source without a receiving link', async () => {
  const searchSources = vi.fn().mockResolvedValue([source]);
  await act(async () => root.render(createElement(ReceiptSourceView, { id: 'r1', searchSources, loadEvidenceOptions: vi.fn().mockResolvedValue([{ id: 'r1', type: 'warehouse_receipt', label: 'Receipt QC evidence' }]), entries: [], openEvidence: vi.fn() })));
  expect(searchSources).toHaveBeenCalledWith('', 'warehouse_receipt', 'r1');
  expect(host.textContent).toContain('RCPT-001');
  expect(host.textContent).toContain('Receipt QC evidence');
  expect(host.querySelector('a[href^="/warehouse/receiving"]')).toBeNull();
  expect(host.querySelector('a')?.getAttribute('href')).toBe('/finance?close_source_type=warehouse_receipt&close_source_id=r1');
  expect(host.querySelector('input,textarea,select')).toBeNull();
});
it('does not disclose a different receipt and supports retry after a rejected read', async () => {
  const searchSources = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([source]);
  await act(async () => root.render(createElement(ReceiptSourceView, { id: 'wrong', searchSources, entries: [], openEvidence: vi.fn() })));
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  await act(async () => (host.querySelector('button') as HTMLButtonElement).click());
  expect(host.textContent).not.toContain('RCPT-001');
  expect(host.textContent).not.toContain('No registered evidence');
});

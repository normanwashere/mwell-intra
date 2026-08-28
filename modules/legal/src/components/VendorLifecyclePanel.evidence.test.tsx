// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LifecycleReviewEvidence } from './VendorLifecyclePanel';

type Props = ComponentProps<typeof LifecycleReviewEvidence>;
let root: Root;
let container: HTMLDivElement;
const reference = 'vendor-A/case-A/review.pdf';
const url = 'https://storage.test/review?token=authorized';
const doc = { id: 'doc-A', vendorId: 'vendor-A', storagePath: reference, filename: 'review.pdf' };
const access = vi.fn();
function props(overrides: Partial<Props> = {}): Props {
  return { vendorId: 'vendor-A', actorId: 'reviewer-A', reference,
    docs: { rows: [doc], loading: false, prepareAccess: access } as unknown as Props['docs'], ...overrides };
}
async function render(value = props()) { await act(async () => root.render(createElement(LifecycleReviewEvidence, value))); }
async function open() {
  const button = container.querySelector<HTMLButtonElement>('button[aria-label="Open evidence"]');
  expect(button).not.toBeNull();
  await act(async () => button!.click());
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  access.mockReset().mockResolvedValue(url);
  vi.spyOn(window, 'open').mockReturnValue(null);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('opens saved selected or uploaded lifecycle evidence through the matching vendor document', async () => {
  await render();
  expect(container.querySelector('input')).toBeNull();
  expect(container.textContent).toContain('review.pdf');
  await open();
  expect(access).toHaveBeenCalledWith(doc);
  expect(window.open).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer');
  expect(container.querySelector('a')?.getAttribute('href')).toBe(url);
});
it('denies a stored path registered only to another vendor without calling access', async () => {
  await render(props({ docs: { rows: [{ ...doc, vendorId: 'vendor-B' }], loading: false, prepareAccess: access } as unknown as Props['docs'] }));
  await open();
  expect(access).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('not registered');
  expect(container.querySelector('a')).toBeNull();
});
it('retries after documents finish loading and surfaces authorization denial', async () => {
  await render(props({ docs: { rows: [], loading: true, prepareAccess: access } as unknown as Props['docs'] }));
  await open();
  expect(container.textContent).toContain('still loading');
  access.mockRejectedValue(new Error('No longer authorized'));
  await render();
  await open();
  expect(access).toHaveBeenCalledWith(doc);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('No longer authorized');
});
it('discards a late saved-document preview after the actor changes', async () => {
  let resolve!: (url: string) => void;
  access.mockReturnValue(new Promise<string>((yes) => { resolve = yes; }));
  await render(); await open();
  await render(props({ actorId: 'reviewer-B' }));
  await act(async () => resolve(url));
  expect(window.open).not.toHaveBeenCalled();
  expect(container.querySelector('a')).toBeNull();
});
it('retains permanent links but blocks saved public or expiring storage URLs', async () => {
  await render(props({ reference: 'https://vendor.test/permanent' }));
  await open();
  expect(container.querySelector('a')?.getAttribute('href')).toBe('https://vendor.test/permanent');
  await render(props({ reference: 'https://storage.test/storage/v1/object/public/documents/review.pdf' }));
  expect(container.querySelector<HTMLButtonElement>('button[aria-label="Open evidence"]')?.disabled).toBe(true);
  expect(container.querySelector('a')).toBeNull();
  expect(access).not.toHaveBeenCalled();
});

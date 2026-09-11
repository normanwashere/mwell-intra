// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useReadQuery } from './useReadQuery';

let root: Root;
let host: HTMLDivElement;
let latest: ReturnType<typeof useReadQuery<string>>;
const scope = {};
function Probe({ read, identity = 'queue' }: { read: () => Promise<string[]>; identity?: string }) {
  latest = useReadQuery(scope, identity, read);
  return createElement('p', { role: latest[3] ? 'alert' : 'status' }, latest[1] ? 'Loading' : latest[3] ?? (latest[0].join(',') || 'Empty'));
}
beforeEach(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('keeps failure distinct from empty and recovers with an explicit retry', async () => {
  const read = vi.fn().mockRejectedValueOnce(new Error('private database detail')).mockResolvedValueOnce([]);
  await act(async () => root.render(createElement(Probe, { read })));
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  expect(host.textContent).not.toContain('Empty');
  expect(host.textContent).not.toContain('private database detail');
  await act(async () => { await latest[2](); });
  expect(host.textContent).toBe('Empty');
  expect(read).toHaveBeenCalledTimes(2);
});
it('does not let an older read overwrite the retry result', async () => {
  let resolve!: (rows: string[]) => void;
  const read = vi.fn().mockImplementationOnce(() => new Promise<string[]>(done => { resolve = done; })).mockResolvedValueOnce(['current']);
  await act(async () => root.render(createElement(Probe, { read })));
  await act(async () => { await latest[2](); });
  await act(async () => resolve(['old']));
  expect(host.textContent).toBe('current');
});
it('clears prior rows on scope change and does not restore them after a denied read', async () => {
  const read = vi.fn().mockResolvedValueOnce(['private-old']).mockRejectedValueOnce(new Error('denied'));
  await act(async () => root.render(createElement(Probe, { read, identity: 'actor-a' })));
  await act(async () => root.render(createElement(Probe, { read, identity: 'actor-b' })));
  expect(host.textContent).not.toContain('private-old');
  expect(host.querySelector('[role=alert]')).not.toBeNull();
});

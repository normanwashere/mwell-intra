// @vitest-environment jsdom
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { directoryUrl, parseDirectoryState, useDirectoryState } from '../app/admin/users/directoryState';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const container = document.createElement('div');
document.body.append(container);
let root: ReturnType<typeof createRoot>;
let state: ReturnType<typeof useDirectoryState>;
function Harness({ guard = () => true }: { guard?: () => boolean }) { state = useDirectoryState(guard); return <p>{JSON.stringify(state)}</p>; }

async function traverseHistory(direction: 'back' | 'forward') {
  await React.act(async () => {
    const changed = new Promise<void>(resolve => {
      window.addEventListener('popstate', () => resolve(), { once: true });
    });
    window.history[direction]();
    await changed;
  });
}
afterEach(async () => { await React.act(() => root?.unmount()); });
it('validates filters, bounds pages and keeps user selectors separate from drafts', () => {
  expect(parseDirectoryState('?kind=bad&status=bad&page=-1')).toMatchObject({ kind: 'all', status: 'active', page: 1 });
  expect(directoryUrl('?kind=vendor&q=a%26b&page=3&next=%2Fwork', { user: 'user-1' })).toBe('/admin/users?kind=vendor&q=a%26b&page=3&next=%2Fwork&user=user-1');
  expect(directoryUrl('?kind=vendor&q=a%26b&page=3&user=x', { user: null })).toBe('/admin/users?kind=vendor&q=a%26b&page=3');
});
it('hydrates copied URLs and restores selection, query, filters and page on history navigation', async () => {
  window.history.replaceState({}, '', '/admin/users?q=ops&status=all&kind=employee&page=2&user=abc');
  root = createRoot(container);
  await React.act(() => root.render(<Harness />));
  expect(state!).toMatchObject({ query: 'ops', status: 'all', kind: 'employee', page: 2, user: 'abc', ready: true });
  await React.act(() => state.update({ user: null }));
  expect(state!.user).toBeNull();
  await traverseHistory('back');
  expect(state!).toMatchObject({ page: 2, user: 'abc', query: 'ops' });
  await traverseHistory('forward');
  expect(state!.user).toBeNull();
});
it('a canceled discard retains the draft context and does not update the URL', async () => {
  window.history.replaceState({}, '', '/admin/users?user=abc');
  const guard = vi.fn(() => false);
  root = createRoot(container);
  await React.act(() => root.render(<Harness guard={guard} />));
  await React.act(() => state.update({ user: null }));
  expect(guard).toHaveBeenCalledOnce();
  expect(window.location.search).toBe('?user=abc');
  expect(state!.user).toBe('abc');
});

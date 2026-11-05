// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ profile: null as null | { id: string }, purge: vi.fn() }));
vi.mock('@intra/auth', () => ({ useSession: () => ({ profile: state.profile }) }));
vi.mock('@shell/lib/publicCachePolicy', () => ({ purgePrivateResponseCaches: state.purge }));
import { SessionCacheBoundary } from './SessionCacheBoundary';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); state.profile = null; });
it('purges response caches on startup, sign-in, sign-out and actor switch without clearing other stores', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const storage = {};
  vi.stubGlobal('caches', storage);
  state.purge.mockReset().mockResolvedValue(undefined);
  const root = createRoot(document.createElement('div'));
  localStorage.setItem('actor-outbox-sentinel', 'keep');
  try {
    await act(async () => root.render(<SessionCacheBoundary />));
    state.profile = { id: 'actor-A' };
    await act(async () => root.render(<SessionCacheBoundary />));
    state.profile = null;
    await act(async () => root.render(<SessionCacheBoundary />));
    state.profile = { id: 'actor-B' };
    await act(async () => root.render(<SessionCacheBoundary />));
    expect(state.purge).toHaveBeenCalledTimes(4);
    expect(state.purge).toHaveBeenLastCalledWith(storage, location.origin);
    expect(localStorage.getItem('actor-outbox-sentinel')).toBe('keep');
  } finally {
    await act(async () => root.unmount());
    localStorage.removeItem('actor-outbox-sentinel');
  }
});

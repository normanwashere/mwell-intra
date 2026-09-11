// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NotificationBell } from './NotificationBell';

const backend = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@intra/auth', () => ({ useSession: () => ({ profile: { id: 'poll-user' }, mode: 'supabase', supabaseClient: backend }) }));
vi.mock('@shell/lib/supabase/env', () => ({ ENABLE_NOTIFICATIONS: true }));
let root: Root;
let container: HTMLDivElement;
let hidden = false;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('React', React);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  hidden = false;
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => hidden ? 'hidden' : 'visible');
  backend.from.mockImplementation(() => ({ select: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks();
});
it('pauses in hidden tabs and refreshes on return without restarting the page', async () => {
  await act(async () => root.render(<NotificationBell />));
  expect(backend.from).toHaveBeenCalledTimes(1);
  hidden = true;
  await act(async () => vi.advanceTimersByTimeAsync(180000));
  expect(backend.from).toHaveBeenCalledTimes(1);
  hidden = false;
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(backend.from).toHaveBeenCalledTimes(2);
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(backend.from).toHaveBeenCalledTimes(3);
});
it('does not overlap slow requests or publish results after unmount', async () => {
  let resolve!: (value: { data: never[]; error: null }) => void;
  backend.from.mockImplementation(() => ({ select: () => ({ order: () => ({ limit: () => new Promise(r => { resolve = r; }) }) }) }));
  await act(async () => root.render(<NotificationBell />));
  await act(async () => vi.advanceTimersByTimeAsync(180000));
  expect(backend.from).toHaveBeenCalledTimes(1);
  await act(async () => root.render(null));
  await act(async () => resolve({ data: [], error: null }));
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(container.textContent).toBe('');
  expect(backend.from).toHaveBeenCalledTimes(1);
});

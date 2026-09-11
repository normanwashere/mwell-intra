// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationBell } from './NotificationBell';

const backend = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('@intra/auth', () => ({ useSession: () => ({ profile: { id: 'test-notifications' }, mode: 'supabase', supabaseClient: backend }) }));
vi.mock('@shell/lib/supabase/env', () => ({ ENABLE_NOTIFICATIONS: true }));

describe('Notification panel interactions with simulated backend', () => {
  let root: Root;
  let container: HTMLDivElement;
  const recent = { id: 'new-read', kind: 'accreditation_expired', entity_type: 'vendor', entity_id: 'VENDOR-11', read_at: '2026-09-11T00:00:00Z', created_at: '2026-09-11T00:00:00Z' };
  const pending = { ...recent, id: 'older-unread', kind: 'approval_pending', entity_type: 'purchase_request', entity_id: 'REQUEST-11', read_at: null, created_at: '2026-09-10T00:00:00Z' };
  const button = (text: string) => [...document.querySelectorAll('button')].find(element => element.textContent?.trim() === text)!;
  beforeEach(async () => {
    vi.stubGlobal('React', React);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    backend.from.mockImplementation(() => ({ select: () => ({ order: () => ({ limit: async () => ({ data: [recent, pending], error: null }) }) }) }));
    backend.rpc.mockResolvedValue({ error: null });
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    await act(async () => root.render(<NotificationBell />));
    await act(async () => container.querySelector('button')!.click());
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
  it('opens an accessible dialog, filters unread, changes sort and only writes on explicit mark read', async () => {
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Older notifications are not included');
    expect(backend.rpc).not.toHaveBeenCalled();
    let items = [...document.querySelectorAll('[role="dialog"] ul li')];
    expect(items[0]?.textContent).toContain('REQUEST-11');
    await act(async () => { const select = document.querySelector('select')!; select.value = 'newest'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    items = [...document.querySelectorAll('[role="dialog"] ul li')];
    expect(items[0]?.textContent).toContain('VENDOR-11');
    await act(async () => button('Unread').click());
    expect(document.querySelectorAll('[role="dialog"] ul li')).toHaveLength(1);
    expect(backend.rpc).not.toHaveBeenCalled();
    await act(async () => button('Mark read').click());
    expect(backend.rpc).toHaveBeenCalledExactlyOnceWith('mark_notification_read', { payload: { notification_id: 'older-unread' } });
    expect(button('Mark read')).toBeUndefined();
  });
  it('keeps unread recovery visible after a failed write and allows retry', async () => {
    backend.rpc.mockResolvedValueOnce({ error: { message: 'network failed' } });
    await act(async () => button('Mark read').click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('We could not confirm');
    expect(button('Mark read').disabled).toBe(false);
    await act(async () => button('Mark read').click());
    expect(backend.rpc).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});

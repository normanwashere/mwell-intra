// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ToastProvider } from '@intra/ui';
import { useSession } from '@intra/auth';
import AdminUsersPage from '../app/admin/users/page';

vi.mock('@intra/auth', () => ({ Guard: ({ children }: { children: React.ReactNode }) => children, useSession: vi.fn() }));
const target = { id: '11111111-1111-4111-8111-111111111111', email: 'fixture@example.test', full_name: 'Fixture Person', title: null, kind: 'employee', vendor_id: null, status: 'active' };
const roles = [{ user_id: target.id, module: 'core', role: 'staff' }];
let container: HTMLDivElement;
let root: Root;
let rpc: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal('React', React);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.history.replaceState({}, '', `/admin/users?user=${target.id}&q=fixture&kind=employee`);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  rpc = vi.fn(async (name: string) => ({ data: name === 'platform_user_directory' ? { rows: [target], roles, total: 1 } :
    [{ module: 'core', role: 'staff', label: 'Staff', description: 'Basic access', is_active: true, is_protected: false, updated_at: '2026-09-01', capabilities: [], assignment_count: 1 }], error: null }));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount(self = false) {
  const core = { rpc, from: () => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: target, error: null }),
      then: (resolve: (value: { data: typeof roles; error: null }) => unknown) => Promise.resolve({ data: roles, error: null }).then(resolve) };
    return query;
  } };
  vi.mocked(useSession).mockReturnValue({ mode: 'supabase', profile: { id: self ? target.id : 'another-admin' }, supabaseClient: { schema: () => core } } as unknown as ReturnType<typeof useSession>);
  await act(async () => root.render(<ToastProvider><AdminUsersPage /></ToastProvider>));
}
it('keeps Space/click intent behind evidence confirmation and supports canceled discard without mutation', async () => {
  await mount();
  const checkbox = document.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  expect(checkbox.checked).toBe(true);
  await act(async () => checkbox.click());
  expect(document.body.textContent).toContain('Revoke governed access');
  expect(checkbox.checked).toBe(true);
  const confirm = [...document.querySelectorAll('button')].find(button => button.textContent === 'Revoke access')!;
  await act(async () => confirm.click());
  expect(rpc.mock.calls.map(call => call[0])).not.toContain('revoke_user_role');
  expect(document.querySelector('#role-change-approval')).not.toBeNull();
  expect(window.location.search).not.toContain('approval');
  const discard = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const close = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label="Close"]')].at(-1)!;
  await act(async () => close.click());
  expect(discard).toHaveBeenCalledOnce();
  expect(document.body.textContent).toContain('Revoke governed access');
  discard.mockReturnValue(true);
  await act(async () => close.click());
  expect(document.body.textContent).not.toContain('Revoke governed access');
  expect(new URLSearchParams(window.location.search).get('user')).toBe(target.id);
  expect(rpc.mock.calls.map(call => call[0])).not.toContain('revoke_user_role');
});
it('keeps self-role checkboxes disabled on a copied detail URL', async () => {
  await mount(true);
  expect(document.querySelector<HTMLInputElement>('input[type=checkbox]')?.disabled).toBe(true);
});

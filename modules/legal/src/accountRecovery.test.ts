import { expect, it, vi } from 'vitest';
import { switchVendorAccount } from './accountRecovery';

it('does not navigate until explicit sign-out resolves and preserves the vendor destination', async () => {
  let finish!: () => void;
  const signOut = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const navigate = vi.fn();
  const switching = switchVendorAccount(signOut, '/vendor/cases/case-1?filter=waiting_on_vendor', navigate);
  expect(signOut).toHaveBeenCalledOnce();
  expect(navigate).not.toHaveBeenCalled();
  finish();
  await switching;
  expect(new URL(navigate.mock.calls[0]![0], 'http://local').searchParams.get('redirect')).toBe('/vendor/cases/case-1?filter=waiting_on_vendor');
});
it('does not navigate after a failed sign-out', async () => {
  const navigate = vi.fn();
  await expect(switchVendorAccount(() => Promise.reject(new Error('offline')), '/vendor', navigate)).rejects.toThrow('offline');
  expect(navigate).not.toHaveBeenCalled();
});

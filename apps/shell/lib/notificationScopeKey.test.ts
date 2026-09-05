import { describe, expect, it } from 'vitest';
import { notificationScopeKey } from './notificationScopeKey';

describe('notification read scope key', () => {
  const own = { mode: 'supabase' as const, principalId: 'A', roleCapabilities: {} };
  it('distinguishes direct actor changes, signed-out boundaries and backend modes', () => {
    const keys = [own, { ...own, principalId: null }, { ...own, principalId: 'B' }, { ...own, mode: 'memory' as const }].map(notificationScopeKey);
    expect(new Set(keys).size).toBe(4);
  });
  it('tracks manage_notifications from any module and stays stable for unrelated grants or ordering', () => {
    const admin = notificationScopeKey({ ...own, roleCapabilities: { core: ['manage_notifications'] } });
    expect(admin).not.toBe(notificationScopeKey(own));
    expect(notificationScopeKey({ ...own, roleCapabilities: { warehouse: ['manage_notifications'], core: ['view_audit'] } })).toBe(admin);
    expect(notificationScopeKey({ ...own, roleCapabilities: { core: ['view_audit', 'manage_notifications', 'manage_notifications'] } })).toBe(admin);
    expect(notificationScopeKey({ ...own, roleCapabilities: { core: ['view_audit'] } })).toBe(notificationScopeKey(own));
    expect(notificationScopeKey({ ...own, roleCapabilities: undefined })).toBe(notificationScopeKey(own));
    expect(notificationScopeKey({ ...own, principalId: null, roleCapabilities: { core: ['manage_notifications'] } })).toBe(notificationScopeKey({ ...own, principalId: null }));
  });
});

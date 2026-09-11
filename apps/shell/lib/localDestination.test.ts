import { describe, expect, it } from 'vitest';
import { localDestination } from './localDestination';
import { authorizedPostLoginPath, dashboardAreas, memoryAccess } from './navigation';

describe('context-preserving local destinations', () => {
  it.each([
    '/knowledge?article=feature-admin-users',
    '/onboarding?task=inspect-audit-history&next=%2Fadmin%2Faudit',
    '/knowledge?article=feature-my-work#handoff',
  ])('preserves the requested shared destination: %s', destination => {
    expect(authorizedPostLoginPath(destination, memoryAccess({core:['staff']}), 'employee')).toBe(destination);
  });
  it.each(['https://evil.test', '//evil.test', '/\\evil.test', '/%5cevil.test', '/%2fevil.test', '/\nevil.test', '/%00evil', '/%ZZ'])('rejects unsafe path %s', input => {
    expect(localDestination(input)).toBe('/');
  });
  it('normalizes before checking module authority and preserves allowed queries only', () => {
    const access = memoryAccess({core:['staff']});
    expect(authorizedPostLoginPath('/knowledge/../admin/users?user=a', access, 'employee')).toBe('/');
    expect(authorizedPostLoginPath('/admin?article=/knowledge', access, 'employee')).toBe('/');
    expect(authorizedPostLoginPath('/vendor?application=a', access, 'employee')).toBe('/');
    expect(authorizedPostLoginPath('/onboarding?task=a', access, 'vendor')).toBe('/');
    expect(localDestination('/warehouse?tab=requests')).toBe('/warehouse/?tab=requests');
  });
  it('admits a scoped Legal approval queue without general Procurement or stale-role access', () => {
    const access = {mode:'supabase' as const,userRoles:{legal:['legal_reviewer' as const]},userCapabilities:{legal:['view_dashboard' as const]}};
    expect(authorizedPostLoginPath('/procurement/approvals?request=abc',access,'employee')).toBe('/procurement/approvals?request=abc');
    expect(dashboardAreas(access,'employee').some(x=>x.href==='/procurement/approvals')).toBe(true);
    for(const url of ['/procurement','/procurement/requests/new','/procurement/purchase-orders']) expect(authorizedPostLoginPath(url,access,'employee')).toBe('/');
    expect(authorizedPostLoginPath('/procurement/approvals', {...access,userCapabilities:{}},'employee')).toBe('/');
  });
});

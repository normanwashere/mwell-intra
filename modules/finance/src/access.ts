import { can, type UserRoles } from '@intra/rbac';

export function canAccessFinanceRoles(userRoles: Partial<UserRoles>): boolean {
  return (
    can(userRoles, 'warehouse', 'view_finance') ||
    can(userRoles, 'procurement', 'view_finance')
  );
}

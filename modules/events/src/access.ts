import { can, type UserRoles } from '@intra/rbac';

export function canAccessEvents(userRoles: Partial<UserRoles>): boolean {
  return can(userRoles, 'events', 'view_events');
}

export function canCreateEvents(userRoles: Partial<UserRoles>): boolean {
  return can(userRoles, 'events', 'create_event');
}

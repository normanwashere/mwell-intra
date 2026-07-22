import { can, type UserRoles } from '@intra/rbac';

export function canAccessEvents(userRoles: Partial<UserRoles>): boolean {
  return can(userRoles, 'events', 'view_events');
}

export function canCreateEvents(userRoles: Partial<UserRoles>): boolean {
  return can(userRoles, 'events', 'create_event');
}

export function canManageEvents(userRoles: Partial<UserRoles>): boolean {
  return can(userRoles, 'events', 'manage_events');
}

export function canCloseEvents(userRoles: Partial<UserRoles>): boolean {
  return can(userRoles, 'events', 'close_event');
}

export function canRequestEventFulfillment(userRoles: Partial<UserRoles>): boolean {
  return can(userRoles, 'events', 'request_fulfillment');
}

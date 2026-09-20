import { expect, it } from 'vitest';
import { eventsModule } from '@intra/rbac';
import { parseUserRolesFromClaims, parseUserCapabilitiesFromClaims, parseKindFromClaims } from '@intra/auth';
it('gives event sellers only scoped custody reads and their own outcomes, never broad event or Warehouse authority', () => {
  expect((eventsModule.roles as Record<string, { capabilities: readonly string[] }>).seller?.capabilities)
    .toEqual(['view_event_custody', 'record_event_outcome']);
  expect(eventsModule.roles.admin.capabilities).not.toContain('record_event_outcome');
  expect(eventsModule.roles.coordinator.capabilities).not.toContain('record_event_outcome');
});
it('retains a named seller-only employee claim without requiring or inventing core staff', () => {
  const claims = { app_metadata: { kind: 'employee', roles: { events: ['seller'] }, capabilities: { events: ['view_event_custody'] } } };
  expect(parseUserRolesFromClaims(claims)).toEqual({ events: ['seller'] });
  expect(parseUserCapabilitiesFromClaims(claims)).toEqual({ events: ['view_event_custody'] });
  expect(parseKindFromClaims(claims)).toBe('employee');
});

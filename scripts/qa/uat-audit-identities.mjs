import { CURRENT_LIVE_ROLES } from './live-e2e-scenarios.mjs';

export const AUDIT_IDENTITY_SCOPES = Object.freeze([
  'critical', 'desktop-1440', 'desktop-1280', 'tablet-768',
  'mobile-390', 'mobile-360', 'mobile-320',
  'checkpoint-v1',
]);

export function auditIdentityPrefix(scope = '') {
  if (!scope) return 'intra.test.';
  if (!AUDIT_IDENTITY_SCOPES.includes(scope)) throw new Error(`Unsupported audit identity scope: ${scope}`);
  return `intra.ci.${scope}.`;
}

export function auditPersonas(scope = '') {
  const prefix = auditIdentityPrefix(scope);
  return CURRENT_LIVE_ROLES.map(persona => ({
    ...persona,
    email: persona.email.replace(/^intra\.test\./, prefix),
    assignments: structuredClone(persona.assignments),
  }));
}

export function assertAuditIdentityScope(scope, appEnv, phase) {
  auditIdentityPrefix(scope);
  if (scope && (appEnv !== 'uat' || !['routes', 'critical', 'onboarding', 'provision'].includes(phase))) {
    throw new Error('Isolated audit identities are restricted to UAT route, critical, onboarding, and provisioning checks.');
  }
}

// Keep the smoke gate distinct from the full route/visual certification.
export function criticalRoutes(routes) {
  const selected = routes.filter(route => ['/tasks', '/knowledge', '/onboarding'].includes(route.path));
  const primary = routes.find(route => route.expectedAccess === 'allowed' && route.path !== '/' && !selected.includes(route));
  const denial = routes.find(route => route.expectedAccess === 'denied');
  for (const route of [primary, denial]) if (route && !selected.includes(route)) selected.push(route);
  const receiving = routes.find(route => route.path === '/warehouse/receiving' && route.expectedAccess === 'allowed');
  if (receiving && !selected.includes(receiving)) selected.push(receiving);
  if (!primary || !denial || !selected.some(route => route.path === '/knowledge')) {
    throw new Error('Critical route gate requires a primary workspace, knowledge, and an access-denial probe.');
  }
  return selected;
}

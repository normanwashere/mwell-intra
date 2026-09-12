import test from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_LIVE_ROLES } from './live-e2e-scenarios.mjs';
import { AUDIT_IDENTITY_SCOPES, auditIdentityPrefix, auditPersonas, assertAuditIdentityScope, criticalRoutes } from './uat-audit-identities.mjs';

test('all viewport and critical accounts are disjoint and preserve exact persona authority', () => {
  const emails = new Set(CURRENT_LIVE_ROLES.map(p => p.email));
  for (const scope of AUDIT_IDENTITY_SCOPES) {
    const personas = auditPersonas(scope);
    assert.equal(personas.length, 11);
    personas.forEach((persona, index) => {
      assert.equal(emails.has(persona.email), false);
      emails.add(persona.email);
      assert.equal(persona.email.startsWith('intra.test.'), false);
      assert.deepEqual({ ...persona, email: CURRENT_LIVE_ROLES[index].email }, CURRENT_LIVE_ROLES[index]);
    });
  }
  assert.equal(emails.size, 88);
  assert.deepEqual(auditPersonas(), CURRENT_LIVE_ROLES);
});

test('identity scope refuses arbitrary prefixes, production, and transactional use', () => {
  for (const scope of ['anything', 'desktop-1440.', '../', 'intra.test']) assert.throws(() => auditIdentityPrefix(scope));
  assert.throws(() => assertAuditIdentityScope('desktop-1440', 'production', 'routes'));
  assert.throws(() => assertAuditIdentityScope('desktop-1440', 'uat', 'transactions'));
  assert.throws(() => assertAuditIdentityScope('desktop-1440', 'uat', 'all'));
  assert.doesNotThrow(() => assertAuditIdentityScope('desktop-1440', 'uat', 'routes'));
});

test('critical gate preserves allowed and denied expectations without replacing full coverage', () => {
  const routes = [
    { path: '/knowledge', expectedAccess: 'allowed' },
    { path: '/onboarding', expectedAccess: 'allowed' },
    { path: '/tasks', expectedAccess: 'allowed' },
    { path: '/warehouse/receiving', expectedAccess: 'allowed' },
    { path: '/admin', expectedAccess: 'denied' },
    { path: '/warehouse/inventory', expectedAccess: 'allowed' },
  ];
  assert.deepEqual(criticalRoutes(routes), routes.slice(0, 5));
  assert.equal(routes.length, 6);
  assert.throws(() => criticalRoutes(routes.filter(r => r.expectedAccess !== 'denied')));
});

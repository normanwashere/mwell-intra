// Specs for the vendor-ownership guard (F1.1) and the demo login bridge
// (F1.3): matchesVendor / shouldBlockVendorAccess / visibleCasesForVendor.

import { describe, expect, it } from 'vitest';
import {
  matchesVendor,
  shouldBlockVendorAccess,
  visibleCasesForVendor,
  type VendorLoginAlias,
  type VendorScopeProfile,
} from './vendorAccess';

const acmeVendor: VendorScopeProfile = {
  kind: 'vendor',
  vendorId: 'ven-acme',
  email: 'vendor@acme.demo',
};
const reviewer: VendorScopeProfile = {
  kind: 'employee',
  email: 'legal@mwell.demo',
};

const acmeCase = { vendorId: 'ven-acme', contactEmail: 'ops@acme.com' };
const thamesCase = {
  vendorId: 'ven-inv_1',
  contactEmail: 'hello@thames.co.uk',
};

const aliases: VendorLoginAlias[] = [
  {
    email: 'hello@thames.co.uk',
    vendorId: 'ven-inv_1',
    companyName: 'Thames Digital Systems Ltd.',
    createdAt: '2026-07-01T00:00:00.000Z',
  },
];

describe('matchesVendor', () => {
  it('matches on vendorId equality', () => {
    expect(matchesVendor(acmeVendor, acmeCase)).toBe(true);
  });

  it('rejects a vendor session against another vendor\u2019s case', () => {
    expect(matchesVendor(acmeVendor, thamesCase)).toBe(false);
  });

  it('always matches internal (employee) sessions', () => {
    expect(matchesVendor(reviewer, thamesCase)).toBe(true);
    expect(matchesVendor(reviewer, acmeCase)).toBe(true);
  });

  it('bridges on the invite contact email (case-insensitive)', () => {
    const invited: VendorScopeProfile = {
      kind: 'vendor',
      email: 'Hello@Thames.co.UK',
    };
    expect(matchesVendor(invited, thamesCase)).toBe(true);
  });

  it('bridges via a persisted vendor login alias', () => {
    const invited: VendorScopeProfile = {
      kind: 'vendor',
      email: 'hello@thames.co.uk',
    };
    // Case whose contactEmail diverged but whose vendorId the alias maps.
    const renamedContact = { vendorId: 'ven-inv_1', contactEmail: 'new@thames.co.uk' };
    expect(matchesVendor(invited, renamedContact, aliases)).toBe(true);
  });

  it('returns false for a null profile', () => {
    expect(matchesVendor(null, acmeCase)).toBe(false);
  });
});

describe('shouldBlockVendorAccess (redirect guard)', () => {
  it('blocks a vendor deep-linking another vendor\u2019s case', () => {
    expect(shouldBlockVendorAccess(acmeVendor, thamesCase)).toBe(true);
  });

  it('never blocks internal reviewers or the owning vendor', () => {
    expect(shouldBlockVendorAccess(reviewer, thamesCase)).toBe(false);
    expect(shouldBlockVendorAccess(acmeVendor, acmeCase)).toBe(false);
  });

  it('does not block signed-out sessions (RBAC handles those upstream)', () => {
    expect(shouldBlockVendorAccess(null, thamesCase)).toBe(false);
  });
});

describe('visibleCasesForVendor', () => {
  it('scopes vendor sessions to owned + bridged cases only', () => {
    const rows = visibleCasesForVendor(acmeVendor, [acmeCase, thamesCase]);
    expect(rows).toEqual([acmeCase]);
  });

  it('gives internal sessions the full list', () => {
    expect(visibleCasesForVendor(reviewer, [acmeCase, thamesCase])).toHaveLength(2);
  });

  it('includes alias-bridged cases for invited vendors', () => {
    const invited: VendorScopeProfile = {
      kind: 'vendor',
      email: 'hello@thames.co.uk',
    };
    const rows = visibleCasesForVendor(invited, [acmeCase, thamesCase], aliases);
    expect(rows).toEqual([thamesCase]);
  });
});

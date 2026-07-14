import { describe, expect, it } from 'vitest';
import type { User } from '@supabase/supabase-js';
import {
  parseKindFromClaims,
  parseUserCapabilitiesFromClaims,
  parseUserRolesFromClaims,
  profileFromUser,
} from './claims';

describe('parseUserCapabilitiesFromClaims', () => {
  it('parses known module capability snapshots from trusted app metadata', () => {
    expect(
      parseUserCapabilitiesFromClaims({
        app_metadata: {
          capabilities: {
            core: ['view_directory'],
            warehouse: ['receive_stock', ' receive_stock ', 'inspect_quality'],
            procurement: ['view_dashboard'],
          },
        },
      }),
    ).toEqual({
      core: ['view_directory'],
      warehouse: ['receive_stock', 'inspect_quality'],
      procurement: ['view_dashboard'],
    });
  });

  it('accepts an RPC capability object and drops unknown or invalid values', () => {
    expect(
      parseUserCapabilitiesFromClaims({
        warehouse: ['receive_stock', null, 42],
        insights: 'view_warehouse',
        finance: ['approve_payment'],
      }),
    ).toEqual({
      warehouse: ['receive_stock'],
      insights: ['view_warehouse'],
    });
  });

  it.each([null, 'warehouse', [], { capabilities: [] }, { warehouse: [42] }])(
    'fails closed for malformed capability claims: %j',
    (claims) => {
      expect(parseUserCapabilitiesFromClaims(claims)).toEqual({});
    },
  );
});

describe('parseUserRolesFromClaims', () => {
  it('parses the full scoped roles snapshot from app_metadata (spec §5)', () => {
    const claims = {
      app_metadata: {
        roles: {
          warehouse: ['logistics_supervisor'],
          procurement: ['approver'],
          legal: ['legal_reviewer'],
          events: ['coordinator'],
          insights: ['analyst'],
        },
        kind: 'employee',
      },
    };
    expect(parseUserRolesFromClaims(claims)).toEqual({
      warehouse: ['logistics_supervisor'],
      procurement: ['approver'],
      legal: ['legal_reviewer'],
      events: ['coordinator'],
      insights: ['analyst'],
    });
  });

  it('accepts the app_metadata object directly (roles at top level)', () => {
    expect(
      parseUserRolesFromClaims({ roles: { warehouse: ['operations'] } }),
    ).toEqual({ warehouse: ['operations'] });
  });

  it('is tolerant of partial JWTs — only present modules are included', () => {
    const result = parseUserRolesFromClaims({
      roles: { warehouse: ['finance'] },
    });
    expect(result).toEqual({ warehouse: ['finance'] });
    expect(result.procurement).toBeUndefined();
    expect(result.legal).toBeUndefined();
    expect(result.events).toBeUndefined();
    expect(result.insights).toBeUndefined();
  });

  it('accepts the Events and Insights role namespaces', () => {
    expect(
      parseUserRolesFromClaims({
        roles: {
          events: ['requester', 'viewer'],
          insights: ['manager', 'executive'],
        },
      }),
    ).toEqual({
      events: ['requester', 'viewer'],
      insights: ['manager', 'executive'],
    });
  });

  it('drops unknown module keys', () => {
    expect(
      parseUserRolesFromClaims({
        roles: { warehouse: ['finance'], marketing: ['whatever'] },
      }),
    ).toEqual({ warehouse: ['finance'] });
  });

  it('coerces a single string role into a one-element array', () => {
    expect(parseUserRolesFromClaims({ roles: { warehouse: 'finance' } })).toEqual(
      { warehouse: ['finance'] },
    );
  });

  it('filters non-string entries, trims, and de-duplicates', () => {
    expect(
      parseUserRolesFromClaims({
        roles: {
          warehouse: ['finance', 42, null, ' finance ', 'operations', {}],
        },
      }),
    ).toEqual({ warehouse: ['finance', 'operations'] });
  });

  it('omits modules whose role list resolves to empty', () => {
    expect(
      parseUserRolesFromClaims({ roles: { warehouse: [], legal: [123] } }),
    ).toEqual({});
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'nope'],
    ['a number', 7],
    ['an array', ['warehouse']],
    ['roles as an array', { roles: ['warehouse'] }],
    ['roles as a string', { roles: 'warehouse' }],
    ['missing roles', { app_metadata: { kind: 'employee' } }],
  ])('returns {} for garbage input: %s', (_label, input) => {
    expect(parseUserRolesFromClaims(input)).toEqual({});
  });
});

describe('parseKindFromClaims', () => {
  it('reads vendor from app_metadata', () => {
    expect(parseKindFromClaims({ app_metadata: { kind: 'vendor' } })).toBe(
      'vendor',
    );
  });

  it('reads kind at the top level too', () => {
    expect(parseKindFromClaims({ kind: 'vendor' })).toBe('vendor');
  });

  it('defaults to employee for missing/garbage/unknown kind', () => {
    expect(parseKindFromClaims({})).toBe('employee');
    expect(parseKindFromClaims(null)).toBe('employee');
    expect(parseKindFromClaims({ kind: 'root' })).toBe('employee');
    expect(parseKindFromClaims('vendor')).toBe('employee');
  });
});

describe('profileFromUser', () => {
  const baseUser = {
    id: 'user-1',
    email: 'sam@mwell.test',
    app_metadata: {
      kind: 'vendor',
      vendor_id: 'vendor-9',
      roles: { legal: ['vendor_contact'] },
    },
    user_metadata: { name: 'Sam Vendor', title: 'Owner' },
  } as unknown as User;

  it('projects identity/tier from app_metadata and display fields from user_metadata', () => {
    expect(profileFromUser(baseUser)).toEqual({
      id: 'user-1',
      email: 'sam@mwell.test',
      kind: 'vendor',
      name: 'Sam Vendor',
      title: 'Owner',
      vendorId: 'vendor-9',
    });
  });

  it('falls back gracefully when metadata is sparse', () => {
    const sparse = { id: 'u2', app_metadata: {}, user_metadata: {} } as unknown as User;
    expect(profileFromUser(sparse)).toEqual({
      id: 'u2',
      email: '',
      kind: 'employee',
      name: undefined,
      title: undefined,
      vendorId: undefined,
    });
  });

  it('uses full_name when name is absent', () => {
    const user = {
      id: 'u3',
      email: 'a@b.test',
      app_metadata: {},
      user_metadata: { full_name: 'Full Name' },
    } as unknown as User;
    expect(profileFromUser(user).name).toBe('Full Name');
  });
});

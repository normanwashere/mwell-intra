import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CompactSign, createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { createReportingAuthorizer, type CurrentGrant } from './auth';

const now = 1_800_000_000;
const issuer = 'https://identity.example.test/';
const audience = 'https://reporting-uat.example.test';
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let otherKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let resolver: ReturnType<typeof createLocalJWKSet>;
const grant: CurrentGrant = {
  principal_id: 'data-team', issuer, client_id: 'client-1', environment: 'uat', active: true,
  permanently_denied: false, scope_epoch: 'scope-1', disclosure_epoch: 'disclosure-1',
  bundle_version: 'bundle-1', dataset_ids: ['warehouse.products'], consumer_ids: ['data-team-primary'],
};
const claims: JWTPayload = { iss: issuer, aud: audience, sub: 'machine-1', client_id: 'client-1', iat: now - 10, nbf: now - 10, exp: now + 590, jti: 'token-1' };
const request = (token: string) => new Request(audience + '/api/reporting/v1/catalog', { headers: { Authorization: `Bearer ${token}` } });
const token = (patch: JWTPayload = {}, header: Record<string, unknown> = {}) => new SignJWT({ ...claims, ...patch }).setProtectedHeader({ alg: 'RS256', typ: 'at+jwt', kid: 'key-1', ...header }).sign(keys.privateKey);
function authorize(readGrant = vi.fn(async () => grant), extra = {}) {
  return createReportingAuthorizer({ issuer, audience, environment: 'uat', algorithms: ['RS256'], getKey: resolver, readGrant, now: () => now, ...extra });
}
beforeAll(async () => {
  keys = await generateKeyPair('RS256');
  otherKeys = await generateKeyPair('RS256');
  resolver = createLocalJWKSet({ keys: [{ ...await exportJWK(keys.publicKey), alg: 'RS256', kid: 'key-1' }] });
});

describe('reporting machine identity', () => {
  it('uses signed identity and fresh server-side grants, never JWT scope', async () => {
    const read = vi.fn(async () => grant);
    const principal = await authorize(read)(request(await token({ scope: 'admin:*', dataset_ids: ['auth.users'] })));
    expect(principal.datasetIds).toEqual(['warehouse.products']);
    expect(principal.id).toBe('data-team');
    expect(principal.authorizationValidUntil).toBe(now + 1800);
    expect(read).toHaveBeenCalledWith({ issuer, clientId: 'client-1', environment: 'uat' }, expect.any(AbortSignal));
    expect(Object.isFrozen(principal.datasetIds)).toBe(true);
  });
  it.each([
    { iss: 'https://other.example.test/' }, { aud: 'production' }, { aud: [audience, 'another'] },
    { exp: now - 61 }, { nbf: now + 61 }, { iat: now + 61 }, { exp: now + 601 },
    { exp: now - 10 }, { exp: undefined }, { iat: undefined }, { nbf: undefined }, { client_id: undefined },
    { sub: undefined }, { jti: undefined }, { iat: 1.5 }, { client_id: '' },
  ])('rejects invalid claims before reading grants: %j', async patch => {
    const read = vi.fn(async () => grant);
    await expect(authorize(read)(request(await token(patch)))).rejects.toMatchObject({ code: 'unauthorized' });
    expect(read).not.toHaveBeenCalled();
  });
  it.each([
    { typ: 'JWT' }, { typ: 'id+jwt' }, { kid: 'missing' },
    { jku: 'https://attacker.example.test/keys' }, { x5u: 'https://attacker.example.test/cert' },
    { jwk: { kty: 'oct', k: 'SECRET' } },
  ])('rejects token-supplied keys and unsupported headers: %j', async header => {
    await expect(authorize()(request(await token({}, header)))).rejects.toMatchObject({ code: 'unauthorized' });
  });
  it('rejects unsigned, symmetric, forged and duplicate-claim tokens', async () => {
    const base64 = (s: string) => Buffer.from(s).toString('base64url');
    const unsigned = `${base64('{"alg":"none","typ":"at+jwt"}')}.${base64(JSON.stringify(claims))}.`;
    const symmetric = await new SignJWT(claims).setProtectedHeader({ alg: 'HS256', typ: 'at+jwt', kid: 'key-1' }).sign(new Uint8Array(32));
    const forged = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', typ: 'at+jwt', kid: 'key-1' }).sign(otherKeys.privateKey);
    const duplicate = await new CompactSign(Buffer.from(JSON.stringify(claims).replace('"client_id":"client-1"', '"client_id":"bad","client_id":"client-1"'))).setProtectedHeader({ alg: 'RS256', typ: 'at+jwt', kid: 'key-1' }).sign(keys.privateKey);
    for (const value of [unsigned, symmetric, forged, duplicate, 'x'.repeat(17000)]) {
      await expect(authorize()(request(value))).rejects.toMatchObject({ code: 'unauthorized' });
    }
  });
  it('does not cache grants, including permanent denial across key rotation', async () => {
    let current = { ...grant };
    const read = vi.fn(async () => current);
    const auth = authorize(read);
    const bearer = await token();
    await auth(request(bearer));
    current = { ...current, active: false };
    await expect(auth(request(bearer))).rejects.toMatchObject({ code: 'forbidden' });
    current = { ...current, active: true, permanently_denied: true };
    await expect(auth(request(await token({ jti: 'after-rotation' })))).rejects.toMatchObject({ code: 'forbidden' });
    expect(read).toHaveBeenCalledTimes(3);
  });
  it.each([
    { issuer: 'https://wrong.example.test/' }, { client_id: 'other' }, { environment: 'production' },
    { dataset_ids: ['auth.users'] }, { dataset_ids: ['warehouse.products', 'warehouse.products'] },
    { consumer_ids: [] }, { dataset_ids: [] }, { scope_epoch: '' },
  ])('rejects mismatched or malformed authority: %j', async patch => {
    await expect(authorize(vi.fn(async () => ({ ...grant, ...patch }) as CurrentGrant))(request(await token()))).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('fails closed on missing authority, outages and deadlines without exposing errors', async () => {
    const bearer = await token();
    const missing = createReportingAuthorizer({ issuer, audience, environment: 'uat', algorithms: ['RS256'], getKey: resolver, readGrant: async () => null, now: () => now });
    await expect(missing(request(bearer))).rejects.toMatchObject({ code: 'forbidden' });
    await expect(authorize(vi.fn(async () => { throw new Error('postgres://SECRET'); }))(request(bearer))).rejects.toMatchObject({ code: 'unavailable', message: 'Reporting is temporarily unavailable.' });
    let aborted = false;
    const auth = createReportingAuthorizer({ issuer, audience, environment: 'uat', algorithms: ['RS256'], getKey: resolver, now: () => now, grantTimeoutMs: 10, readGrant: async (_key, signal) => {
      signal.addEventListener('abort', () => { aborted = true; });
      return new Promise(() => {});
    } });
    await expect(auth(request(bearer))).rejects.toMatchObject({ code: 'unavailable' });
    expect(aborted).toBe(true);
  });
  it('rejects insecure transport and combined credentials', async () => {
    const bearer = await token();
    for (const req of [new Request('http://reporting.example.test', { headers: { Authorization: `Bearer ${bearer}` } }), new Request(audience, { headers: { Authorization: `Bearer ${bearer}, Bearer ${bearer}` } }), new Request(audience)]) {
      await expect(authorize()(req)).rejects.toMatchObject({ code: 'unauthorized' });
    }
  });
  it('accepts reviewed key rotation but rejects the unregistered key', async () => {
    const rotation = createLocalJWKSet({ keys: [
      { ...await exportJWK(keys.publicKey), alg: 'RS256', kid: 'key-1' },
      { ...await exportJWK(otherKeys.publicKey), alg: 'RS256', kid: 'key-2' },
    ] });
    const next = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', typ: 'at+jwt', kid: 'key-2' }).sign(otherKeys.privateKey);
    await expect(authorize()(request(next))).rejects.toMatchObject({ code: 'unauthorized' });
    expect((await authorize(undefined, { getKey: rotation })(request(next))).id).toBe('data-team');
  });
  it('keeps grant-backed authorization validity separate from the bearer lifetime', async () => {
    const short = await authorize()(request(await token({ exp: now + 60 })));
    const normal = await authorize()(request(await token()));
    expect(short.authorizationValidUntil).toBe(now + 1800);
    expect(normal.authorizationValidUntil).toBe(short.authorizationValidUntil);
    expect(short).toMatchObject({ tokenExpiresAt: now + 60 });
    await expect(authorize()(request(await token({ exp: now })))).rejects.toMatchObject({ code: 'unauthorized' });
  });
});

import { jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { datasetIdSchema, opaqueIdSchema } from './contracts';
import type { DatasetId } from './catalog';
import { ReportingError } from './errors';
import { parseStrictJson } from './json';

const issuerSchema = z.url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
});
const identitySchema = z.string().min(1).max(256).regex(/^[\x21-\x7e]+$/);
const unique = (values: string[]) => new Set(values).size === values.length;
const grantSchema = z.strictObject({
  principal_id: opaqueIdSchema, issuer: issuerSchema, client_id: identitySchema, environment: opaqueIdSchema,
  active: z.boolean(), permanently_denied: z.boolean(), scope_epoch: opaqueIdSchema,
  disclosure_epoch: opaqueIdSchema, bundle_version: opaqueIdSchema,
  dataset_ids: z.array(datasetIdSchema).min(1).max(30).refine(unique),
  consumer_ids: z.array(opaqueIdSchema).min(1).max(100).refine(unique),
});
export type CurrentGrant = z.infer<typeof grantSchema>;
const seconds = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const claimSchema = z.object({
  iss: issuerSchema, aud: identitySchema, sub: identitySchema, client_id: identitySchema,
  iat: seconds, nbf: seconds, exp: seconds, jti: identitySchema,
});
const headerSchema = z.strictObject({ alg: z.enum(['RS256', 'PS256', 'ES256', 'EdDSA']), typ: z.literal('at+jwt'), kid: identitySchema });

export type ReportingPrincipal = Readonly<{
  id: string; environment: string; scopeEpoch: string; disclosureEpoch: string; bundleVersion: string;
  datasetIds: readonly DatasetId[]; consumerIds: readonly string[]; authorizationValidUntil: number; tokenExpiresAt: number;
}>;
type GrantKey = { issuer: string; clientId: string; environment: string };
type Config = {
  issuer: string; audience: string; environment: string; algorithms: string[];
  // Resolver comes only from trusted server configuration, never JWT headers or discovery input.
  getKey: JWTVerifyGetKey;
  // Must query authoritative state on every call, without a positive cache. SQL/IAM adapter is pending.
  readGrant: (key: GrantKey, signal: AbortSignal) => Promise<unknown>;
  now?: () => number; grantTimeoutMs?: number;
};

async function currentGrant(read: Config['readGrant'], key: GrantKey, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => read(key, controller.signal)),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new ReportingError('unavailable')); }, timeoutMs);
      }),
    ]);
  } catch {
    throw new ReportingError('unavailable');
  } finally {
    clearTimeout(timer);
  }
}

function decodePart(value: string): unknown {
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) throw new ReportingError('unauthorized');
  return parseStrictJson(bytes, 8192);
}

export function createReportingAuthorizer(config: Config) {
  const { issuer, audience, environment, getKey, readGrant } = config;
  const algorithms = [...config.algorithms];
  const now = config.now ?? (() => Math.floor(Date.now() / 1000));
  const grantTimeoutMs = config.grantTimeoutMs ?? 2000;
  if (!issuerSchema.safeParse(issuer).success || !identitySchema.safeParse(audience).success || !opaqueIdSchema.safeParse(environment).success || !algorithms.length || algorithms.some(alg => !headerSchema.shape.alg.safeParse(alg).success) || !Number.isInteger(grantTimeoutMs) || grantTimeoutMs < 1 || grantTimeoutMs > 5000) throw new ReportingError('unavailable');

  return async (request: Request): Promise<ReportingPrincipal> => {
    let claims: z.infer<typeof claimSchema>;
    let time: number;
    try {
      if (new URL(request.url).protocol !== 'https:') throw new Error();
      const authorization = request.headers.get('authorization') ?? '';
      if (authorization.length > 16384 || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(authorization)) throw new Error();
      const token = authorization.slice(7);
      const [headerPart, payloadPart] = token.split('.');
      const header = headerSchema.parse(decodePart(headerPart!));
      claims = claimSchema.parse(decodePart(payloadPart!));
      time = now();
      if (!Number.isSafeInteger(time) || !algorithms.includes(header.alg) || claims.iss !== issuer || claims.aud !== audience || claims.exp <= claims.iat || claims.exp - claims.iat > 600 || claims.exp <= time || claims.nbf >= claims.exp || claims.iat > time + 60) throw new Error();
      await jwtVerify(token, getKey, {
        issuer, audience, algorithms, typ: 'at+jwt', currentDate: new Date(time * 1000),
        clockTolerance: 60, maxTokenAge: 600,
        requiredClaims: ['iss', 'aud', 'sub', 'client_id', 'iat', 'nbf', 'exp', 'jti'],
      });
    } catch {
      throw new ReportingError('unauthorized');
    }
    const raw = await currentGrant(readGrant, { issuer, clientId: claims.client_id, environment }, grantTimeoutMs);
    if (raw === null) throw new ReportingError('forbidden');
    const checked = grantSchema.safeParse(raw);
    if (!checked.success || checked.data.issuer !== issuer || checked.data.client_id !== claims.client_id || checked.data.environment !== environment) throw new ReportingError('unavailable');
    const grant = checked.data;
    if (!grant.active || grant.permanently_denied) throw new ReportingError('forbidden');
    if (claims.exp <= now()) throw new ReportingError('unauthorized');
    return Object.freeze({
      id: grant.principal_id, environment, scopeEpoch: grant.scope_epoch,
      disclosureEpoch: grant.disclosure_epoch, bundleVersion: grant.bundle_version,
      datasetIds: Object.freeze([...grant.dataset_ids]), consumerIds: Object.freeze([...grant.consumer_ids]),
      // Recipient stale-serving deadline, not permission to reuse an expired bearer on an API call.
      authorizationValidUntil: time + 1800, tokenExpiresAt: claims.exp,
    });
  };
}

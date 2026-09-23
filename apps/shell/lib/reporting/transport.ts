import type { z } from 'zod';
import { cursorSchema, opaqueIdSchema } from './contracts';
import { getDataset } from './catalog';
import { ReportingError, ReportingHttpError, reportingHttpFailure } from './errors';
import { MAX_BODY_BYTES, MAX_PAGE_BYTES, parseStrictJson } from './json';

const BASE = '/api/reporting/v1';
const TIMEOUT_MS = 30_000;
const jsonType = (value: string | null) => /^application\/json(?:\s*;\s*charset=(?:utf-8|"utf-8"))?$/i.test(value ?? '');

export function parsePageQuery(params: URLSearchParams): { limit: number; cursor: string | null } {
  if (Buffer.byteLength(params.toString()) > 8192) throw new ReportingError('invalid_request');
  for (const key of params.keys()) {
    if (!['limit', 'cursor'].includes(key) || params.getAll(key).length !== 1) throw new ReportingError('invalid_request');
  }
  const rawLimit = params.get('limit');
  if (rawLimit !== null && (!/^[1-9]\d{0,3}$/.test(rawLimit) || Number(rawLimit) > 1000)) throw new ReportingError('invalid_request');
  const cursor = params.get('cursor');
  if (cursor !== null && !cursorSchema.safeParse(cursor).success) throw new ReportingError('invalid_request');
  return { limit: rawLimit === null ? 500 : Number(rawLimit), cursor };
}

export function safeReportingUrl(origin: string, path: string): URL {
  try {
    const base = new URL(origin);
    if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash || origin !== base.origin) throw new Error();
    if (Buffer.byteLength(path) > 8192 || !path.startsWith(BASE + '/') || /[\s\\#]/.test(path)) throw new Error();
    const rawPath = path.split('?')[0]!;
    if (rawPath.includes('%') || rawPath.split('/').some(part => part === '.' || part === '..')) throw new Error();
    const url = new URL(path, base);
    if (url.origin !== base.origin || url.pathname !== rawPath || url.username || url.password) throw new Error();
    const parts = rawPath.slice(BASE.length + 1).split('/');
    const id = (value: string | undefined) => opaqueIdSchema.safeParse(value).success;
    const plain = parts.length === 1 && ['connection', 'catalog', 'status'].includes(parts[0]!);
    const changes = parts.length === 1 && parts[0] === 'changes';
    const snapshot = parts.length === 2 && parts[0] === 'snapshots' && id(parts[1]);
    const page = parts.length === 4 && parts[0] === 'snapshots' && id(parts[1]) && parts[2] === 'datasets' && getDataset(parts[3]!) !== undefined;
    const manifest = parts.length === 4 && parts[0] === 'streams' && id(parts[1]) && parts[2] === 'generations' && id(parts[3]);
    if (!plain && !changes && !snapshot && !page && !manifest) throw new Error();
    if (changes || page) parsePageQuery(url.searchParams);
    else if (url.search) throw new Error();
    return url;
  } catch {
    throw new ReportingError('invalid_request');
  }
}

async function readBounded(body: ReadableStream<Uint8Array> | null, headers: Headers, maximum: number): Promise<Uint8Array> {
  if (!body) throw new ReportingError('invalid_data');
  const length = headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) throw new ReportingError('invalid_request');
  if (length !== null && Number(length) > maximum) { void body.cancel().catch(() => {}); throw new ReportingError('too_large'); }
  const reader = body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ReportingError('unavailable')), TIMEOUT_MS);
  });
  const buffer = Buffer.allocUnsafe(maximum);
  const expiresAt = performance.now() + TIMEOUT_MS;
  let bytes = 0;
  let complete = false;
  // One bounded buffer and one deadline race. Per-chunk races retain promise reactions until timeout.
  const consume = async () => {
    while (true) {
      if (performance.now() >= expiresAt) throw new ReportingError('unavailable');
      const next = await reader.read();
      if (next.done) { complete = true; break; }
      if (bytes + next.value.byteLength > maximum) throw new ReportingError('too_large');
      buffer.set(next.value, bytes);
      bytes += next.value.byteLength;
    }
    return buffer.subarray(0, bytes);
  };
  try {
    return await Promise.race([consume(), deadline]);
  } finally {
    clearTimeout(timer);
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function readJsonRequest<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (request.method !== 'POST') throw new ReportingError('method_not_allowed');
  if (!jsonType(request.headers.get('content-type')) || request.headers.has('content-encoding')) throw new ReportingError('unsupported_media');
  const value = parseStrictJson(await readBounded(request.body, request.headers, MAX_BODY_BYTES));
  const result = schema.safeParse(value);
  if (!result.success) throw new ReportingError('invalid_request');
  return result.data;
}

// GET-only transport primitive, not a sync engine. The caller supplies a reviewed strict response schema.
export async function fetchReportingJson<T>(origin: string, path: string, token: string, schema: z.ZodType<T>, fetcher: typeof fetch = fetch): Promise<T> {
  const url = safeReportingUrl(origin, path);
  if (!/^[A-Za-z0-9_.-]{1,16384}$/.test(token)) throw new ReportingError('unauthorized');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response | undefined;
  try {
    response = await fetcher(url.href, {
      method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (response.redirected || (response.url && response.url !== url.href)) throw new Error();
    if (!response.ok) throw reportingHttpFailure(response.status, response.headers.get('retry-after')) ?? new ReportingError('invalid_response');
    if (!jsonType(response.headers.get('content-type'))) throw new Error();
    const result = schema.safeParse(parseStrictJson(await readBounded(response.body, response.headers, MAX_PAGE_BYTES), MAX_PAGE_BYTES));
    if (!result.success) throw new Error();
    return result.data;
  } catch (error) {
    if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
    if (error instanceof ReportingHttpError) throw error;
    throw new ReportingError('invalid_response');
  } finally {
    clearTimeout(timer);
  }
}

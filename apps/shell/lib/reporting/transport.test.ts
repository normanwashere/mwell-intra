import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { snapshotRequestSchema } from './contracts';
import { ReportingError, ReportingHttpError, reportingErrorResponse } from './errors';
import { fetchReportingJson, parsePageQuery, readJsonRequest, safeReportingUrl } from './transport';

const origin = 'https://reporting.example.test';
const path = '/api/reporting/v1/changes?cursor=abc.def&limit=500';
const body = (value: string, headers = {}, method = 'POST') => new Request(origin + '/api/reporting/v1/snapshots', { method, body: value, headers: { 'Content-Type': 'application/json', ...headers } });

describe('bounded reporting request contract', () => {
  it('reads strict UTF-8 JSON and validates declared fields', async () => {
    expect(await readJsonRequest(body('{"consumer_id":"data-team"}'), snapshotRequestSchema)).toEqual({ consumer_id: 'data-team' });
  });
  it.each([
    ['{"consumer_id":"a","consumer_id":"b"}', {}, 'invalid_data'],
    ['{"consumer_id":"a","sql":"select *"}', {}, 'invalid_request'],
    ['{"consumer_id":"a"}', { 'Content-Type': 'text/plain' }, 'unsupported_media'],
    ['{}', { 'Content-Type': 'application/json; charset=iso-8859-1' }, 'unsupported_media'],
    ['{}', { 'Content-Encoding': 'gzip' }, 'unsupported_media'],
    ['{}', { 'Content-Length': '20000' }, 'too_large'],
    ['{"consumer_id":"' + 'x'.repeat(17000) + '"}', { 'Content-Length': '2' }, 'too_large'],
  ])('rejects invalid bodies or transport metadata', async (value, headers, code) => {
    await expect(readJsonRequest(body(value as string, headers as Record<string, string>), snapshotRequestSchema)).rejects.toMatchObject({ code });
  });
  it('rejects unsupported methods before consuming their body', async () => {
    await expect(readJsonRequest(body('{}', {}, 'PUT'), snapshotRequestSchema)).rejects.toMatchObject({ status: 405 });
  });
  it.each(['limit=0', 'limit=1001', 'limit=2&limit=3', 'cursor=a&cursor=b', 'limit=1e2', 'cursor=../path', 'sql=select', 'cursor=' + 'x'.repeat(4097), 'limit=0005'])('rejects unsafe query %s', query => {
    expect(() => parsePageQuery(new URLSearchParams(query))).toThrow();
  });
  it('has a bounded default and accepts max limit', () => {
    expect(parsePageQuery(new URLSearchParams())).toEqual({ limit: 500, cursor: null });
    expect(parsePageQuery(new URLSearchParams('limit=1000&cursor=a.b'))).toEqual({ limit: 1000, cursor: 'a.b' });
  });
});

describe('no credential forwarding outside reviewed reporting paths', () => {
  it('accepts only same-origin reporting paths', () => {
    expect(safeReportingUrl(origin, path).href).toBe(origin + path);
    expect(safeReportingUrl(origin, '/api/reporting/v1/snapshots/s-1/datasets/warehouse.products').pathname).toContain('warehouse.products');
    expect(safeReportingUrl(origin, '/api/reporting/v1/streams/s-1/generations/g-1').pathname).toContain('g-1');
  });
  it.each([
    'https://attacker.example.test/api/reporting/v1/changes', '//attacker.example.test/api/reporting/v1/changes',
    'https://reporting.example.test/api/reporting/v1/changes', '/api/reporting/v1/../../warehouse',
    '/api/reporting/v1/%2e%2e/warehouse', '/api/reporting/v1/%252e%252e/warehouse',
    '/api/reporting/v1/changes#secret', '/api/reporting/v1/changes\\attacker',
    '/api/reporting/v1/changes?access_token=SECRET', '/api/warehouse',
    '/api/reporting/v1/snapshots/s-1/datasets/auth.users', '/api/reporting/v1/snapshots/s-1?cursor=oops',
    '/api/reporting/v1/changes?limit=500&limit=1000', '/api/reporting/v1/changes\n',
  ])('rejects a poisoned continuation %s', value => {
    expect(() => safeReportingUrl(origin, value)).toThrow('Invalid reporting request.');
  });
  it('rejects insecure or credential-bearing configured origins', () => {
    for (const base of ['http://reporting.example.test', 'https://user:password@reporting.example.test', origin + '/unexpected', origin + '?x=1']) {
      expect(() => safeReportingUrl(base, path)).toThrow();
    }
  });
  it('omits ambient credentials and refuses redirects and cache reuse', async () => {
    const fetcher = vi.fn(async () => Response.json({ state: 'caught_up' }));
    const result = await fetchReportingJson(origin, path, 'test-token', z.strictObject({ state: z.literal('caught_up') }), fetcher);
    expect(result).toEqual({ state: 'caught_up' });
    expect(fetcher).toHaveBeenCalledWith(origin + path, expect.objectContaining({ redirect: 'error', credentials: 'omit', cache: 'no-store', method: 'GET', headers: { Authorization: 'Bearer test-token', Accept: 'application/json' } }));
  });
  it.each([
    () => new Response(null, { status: 302, headers: { Location: 'https://attacker.example.test' } }),
    () => new Response('<html>PRIVATE</html>', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response('{"state":"ok","state":"caught_up"}', { headers: { 'Content-Type': 'application/json' } }),
    () => Response.json({ secret: 'PRIVATE' }),
    () => new Response('"' + 'x'.repeat(5 * 1024 * 1024) + '"', { headers: { 'Content-Type': 'application/json' } }),
    () => Response.json({ state: 'caught_up' }, { headers: { 'Content-Length': '999999999' } }),
    () => { throw new Error('SECRET token=abc'); },
  ])('rejects unverified responses without exposing payloads or URLs', async response => {
    await expect(fetchReportingJson(origin, path, 'test-token', z.strictObject({ state: z.literal('caught_up') }), async () => response())).rejects.toMatchObject({ code: 'invalid_response', message: 'The reporting response could not be verified.' });
  });
  it('does not send a request for malformed credentials', async () => {
    const fetcher = vi.fn();
    await expect(fetchReportingJson(origin, path, 'SECRET\r\nInjected: value', z.unknown(), fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('sanitizes public errors and forbids caching', async () => {
    for (const error of [new Error('postgres://SECRET'), new ReportingError('forbidden')]) {
      const response = reportingErrorResponse(error);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(await response.text()).not.toContain('SECRET');
    }
  });
  it('does not serialize a modified error instance message or status', async () => {
    const error = new ReportingError('forbidden');
    error.message = 'SECRET database detail';
    Object.assign(error, { status: 200 });
    const response = reportingErrorResponse(error);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: 'forbidden', message: 'Reporting access is not available.' } });
  });
  it.each([
    [400, 'invalid_request'], [401, 'unauthorized'], [403, 'forbidden'],
    [404, 'not_found'], [409, 'conflict'], [410, 'expired'], [429, 'rate_limited'], [503, 'unavailable'],
  ])('preserves actionable HTTP %i without reflecting the upstream body', async (status, code) => {
    const failure = fetchReportingJson(origin, path, 'test-token', z.unknown(), async () => new Response('SECRET access_token=private', { status }));
    await expect(failure).rejects.toMatchObject({ status, code });
    await failure.catch(error => { expect(JSON.stringify(error)).not.toContain('SECRET'); expect(error.message).not.toContain('private'); });
  });
  it('preserves only valid bounded Retry-After metadata for throttling/outages', async () => {
    for (const [value, expected] of [['120', 120], ['0', 0], ['9999999999', null], ['bad', null], ['1.5', null]] as const) {
      await expect(fetchReportingJson(origin, path, 'test-token', z.unknown(), async () => new Response('SECRET', { status: 429, headers: { 'Retry-After': value } }))).rejects.toMatchObject({ retryAfterSeconds: expected });
    }
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T00:00:00Z'));
    try {
      await expect(fetchReportingJson(origin, path, 'test-token', z.unknown(), async () => new Response(null, { status: 503, headers: { 'Retry-After': 'Wed, 23 Sep 2026 00:02:00 GMT' } }))).rejects.toMatchObject({ retryAfterSeconds: 120 });
    } finally { vi.useRealTimers(); }
  });
  it('cancels a stalled response body at the read deadline', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    try {
      const body = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}), cancel });
      const result = fetchReportingJson(origin, path, 'test-token', z.unknown(), async () => new Response(body, { headers: { 'Content-Type': 'application/json' } }));
      const assertion = expect(result).rejects.toMatchObject({ code: 'invalid_response' });
      await vi.advanceTimersByTimeAsync(30001);
      await assertion;
      expect(cancel).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it('sanitizes Retry-After again when serializing public errors', () => {
    const error = new ReportingHttpError('rate_limited', 120);
    expect(reportingErrorResponse(error).headers.get('Retry-After')).toBe('120');
    Object.assign(error, { retryAfterSeconds: 'SECRET\r\nInjected: 1' });
    expect(reportingErrorResponse(error).headers.has('Retry-After')).toBe(false);
    expect(new ReportingHttpError('forbidden', 120).retryAfterSeconds).toBeNull();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { isPublicCacheUrl, purgePrivateResponseCaches } from './publicCachePolicy';

const origin = 'https://intra.test';
describe('public-only offline cache', () => {
  it.each(['/~offline', '/~offline?__WB_REVISION__=build1', '/_next/static/chunks/app.js', '/icons/icon.svg', '/mwell-wordmark.png', '/manifest.webmanifest'])('allows public asset %s', path => {
    expect(isPublicCacheUrl(new URL(path, origin), origin)).toBe(true);
  });
  it.each(['/api/admin/audit', '/api/health', '/warehouse', '/login', '/knowledge?article=private', '/_next/image?url=/api/evidence', '/api/private.png', '/rest/v1/items', '/~offline?_rsc=private', 'https://db.supabase.co/storage/v1/object/sign/evidence/image.png?token=private', 'https://other.test/_next/static/app.js'])('never caches private or unrecognized URL %s', path => {
    expect(isPublicCacheUrl(new URL(path, origin), origin)).toBe(false);
  });
  it('purges old private pages/API responses without deleting public assets or unrelated browser stores', async () => {
    const requests = ['/api/admin/audit', '/warehouse?_rsc=abc', '/_next/static/app.js', '/mwell-wordmark.png'].map(path => new Request(origin + path));
    const removed: string[] = [];
    const cache = {
      keys: vi.fn(async () => requests),
      match: vi.fn(async (request: Request) => new Response('test', { headers: { 'cache-control': request.url.endsWith('.png') ? 'private, no-store' : 'public' } })),
      delete: vi.fn(async (request: Request) => { removed.push(request.url); return true; }),
    };
    const storage = { keys: vi.fn(async () => ['apis', 'old-pages']), open: vi.fn(async () => cache) } as unknown as CacheStorage;
    await purgePrivateResponseCaches(storage, origin);
    expect([...new Set(removed)]).toEqual([origin + '/api/admin/audit', origin + '/warehouse?_rsc=abc', origin + '/mwell-wordmark.png']);
    expect(removed).not.toContain(origin + '/_next/static/app.js');
  });
});

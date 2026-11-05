const PUBLIC_FILES = new Set(['/~offline', '/mwell-wordmark.png', '/manifest.webmanifest', '/favicon.ico']);

export function isPublicCacheUrl(url: URL, origin: string): boolean {
  if (url.origin !== origin) return false;
  if ([...url.searchParams.keys()].some(key => key !== '__WB_REVISION__')) return false;
  return PUBLIC_FILES.has(url.pathname)
    || url.pathname.startsWith('/_next/static/')
    || /^\/icons\/[a-z0-9-]+\.(?:svg|png|ico)$/i.test(url.pathname);
}

export function isPublicCacheResponse(response: Response): boolean {
  return response.status === 200
    && !response.redirected
    && !/\b(?:private|no-store)\b/i.test(response.headers.get('cache-control') ?? '')
    && !response.headers.has('set-cookie');
}

// CacheStorage held legacy API/page responses. Do not touch IndexedDB: it owns
// actor-scoped queued commands and must survive offline recovery and sign-out.
export async function purgePrivateResponseCaches(storage: CacheStorage, origin: string): Promise<void> {
  for (const name of await storage.keys()) {
    const cache = await storage.open(name);
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      if (!isPublicCacheUrl(new URL(request.url), origin) || !response || !isPublicCacheResponse(response)) {
        await cache.delete(request);
      }
    }
  }
}

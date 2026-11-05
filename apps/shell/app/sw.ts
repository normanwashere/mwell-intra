/// <reference lib="esnext" />
/// <reference lib="webworker" />

import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { CacheFirst, ExpirationPlugin, NetworkOnly, Serwist } from 'serwist';
import { isPublicCacheResponse, isPublicCacheUrl, purgePrivateResponseCaches } from '../lib/publicCachePolicy';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: (self.__SW_MANIFEST ?? []).filter(entry =>
    isPublicCacheUrl(new URL(typeof entry === 'string' ? entry : entry.url, self.location.origin), self.location.origin)),
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ url, request }) => !request.headers.has('authorization') && isPublicCacheUrl(url, self.location.origin),
      handler: new CacheFirst({
        cacheName: 'intra-public-assets-v1',
        plugins: [
          { cacheWillUpdate: async ({ response }) => isPublicCacheResponse(response) ? response : null },
          new ExpirationPlugin({ maxEntries: 256, maxAgeSeconds: 30 * 24 * 60 * 60 }),
        ],
      }),
    },
    {
      matcher: () => true,
      handler: new NetworkOnly({ fetchOptions: { cache: 'no-store' } }),
    },
  ],
  fallbacks: {
    entries: [
      {
        url: '/~offline',
        matcher({ request }) {
          return request.destination === 'document';
        },
      },
    ],
  },
});

self.addEventListener('activate', event => {
  event.waitUntil(purgePrivateResponseCaches(caches, self.location.origin));
});

serwist.addEventListeners();

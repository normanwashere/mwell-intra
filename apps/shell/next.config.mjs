import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withSerwist } from '@serwist/turbopack';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const warehouseSrc = path.join(__dirname, '../../modules/warehouse/src');
const isDev = process.env.NODE_ENV !== 'production';
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA:
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
      process.env.VERCEL_GIT_COMMIT_SHA ??
      "",
  },
  // The workspace packages ship raw TS/TSX (their `main`/`exports` point at
  // ./src). Next must compile them through its own pipeline (spec §2, ADR-003).
  transpilePackages: [
    '@intra/ui',
    '@intra/auth',
    '@intra/rbac',
    '@intra/data-kit',
    '@intra/events',
    '@intra/finance',
    '@intra/insights',
    '@intra/core-data',
    '@intra/warehouse',
    '@intra/procurement',
    '@intra/legal',
    '@intra/work',
  ],
  turbopack: {
    root: path.join(__dirname, '../..'),
    // Warehouse module keeps Vite-era `@/*` → `src/*`; the shell resolves it
    // to the warehouse `src` so the ported code compiles unmodified. `@warehouse`
    // is the explicit alias future callers / other modules should prefer so a
    // second module doesn't collide on the bare `@`.
    // See modules/warehouse/tsconfig.json (`@/*` → `src/*`) — Turbopack has no
    // access to that tsconfig so the shell must mirror both aliases here.
    resolveAlias: {
      '@': warehouseSrc,
      '@warehouse': warehouseSrc,
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(), microphone=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      { source: '/warehouse/events', destination: '/events', permanent: false },
      { source: '/warehouse/data', destination: '/insights/warehouse', permanent: false },
      { source: '/warehouse/quality-control', destination: '/warehouse/quality', permanent: false },
      { source: '/warehouse/reports', destination: '/insights/warehouse', permanent: false },
    ];
  },
};

export default withSerwist(nextConfig);

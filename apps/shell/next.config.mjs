import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withSerwist } from '@serwist/turbopack';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const warehouseSrc = path.join(__dirname, '../../modules/warehouse/src');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The workspace packages ship raw TS/TSX (their `main`/`exports` point at
  // ./src). Next must compile them through its own pipeline (spec §2, ADR-003).
  transpilePackages: [
    '@intra/ui',
    '@intra/auth',
    '@intra/rbac',
    '@intra/data-kit',
    '@intra/core-data',
    '@intra/warehouse',
    '@intra/procurement',
    '@intra/legal',
  ],
  turbopack: {
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
};

export default withSerwist(nextConfig);

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
  ],
};

export default nextConfig;

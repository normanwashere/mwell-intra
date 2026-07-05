# Mwell Intra

One internal operating system with department modules (Warehouse, Procurement,
Legal) on a single Supabase project. Monorepo: **pnpm + Turborepo + Next.js 16**.

> Canonical spec: `Documents/Mwell Intra/MWELL-INTRA-PLATFORM-SPEC.md`
> (ADR-001 topology, ADR-002 module decisions, ADR-003 rebuild stack).
> Warehouse architecture reference: `mwell-intra-warehouse/docs/LLD.md`.

## Layout

```
apps/
  shell/            @intra/shell   — Next.js 16 App Router: auth, nav, layout, hosts modules as routes
modules/
  warehouse/        @intra/warehouse — pure domain + routes, offline PWA (full parity port)
packages/
  ui/               @intra/ui        — design tokens + primitives
  auth/             @intra/auth      — SessionProvider, JWT, <Guard>
  rbac/             @intra/rbac      — scoped capability RBAC
  data-kit/         @intra/data-kit  — repository port, adapters, outbox, runAction
  core-data/        @intra/core-data — vendor/document/approval/audit ports
  config/           @intra/config    — tsconfig/eslint/tailwind presets
supabase/
  migrations/       core → domain, ordered & idempotent
  seed/             fresh seed
```

## Getting started

```bash
pnpm install
cp .env.example .env      # fill Supabase creds (M-Intra project)
pnpm dev                  # runs the shell (and module dev servers)
```

## Deploy (Vercel)

Monorepo root is the repo; the Vercel project **Root Directory** must be `apps/shell`.

1. Import the GitHub repo in Vercel (or `pnpm dlx vercel link` from `apps/shell`).
2. Set environment variables from `.env.example` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, optional `NEXT_PUBLIC_DATA_SOURCE=memory` for demo).
3. Deploy — `apps/shell/vercel.json` runs `pnpm install` and `turbo build --filter=@intra/shell` from the monorepo root.

## Suite invariants (see spec §6)

1. UI → store → repository port. No direct Supabase calls in pages/components.
2. Server is authoritative: every write via a capability-gated `SECURITY DEFINER` RPC.
3. Ledger/log every material change.
4. snake↔camel only at the mapper boundary.
5. Adapters stay behavior-identical (offline + tests parity).
6. RBAC defined once in `@intra/rbac`, mirrored in `core.role_capabilities`.

## Build order (ADR-003, sequential steps; parallel tasks within a step)

0. Repo bootstrap · 1. Foundation (`@intra/*` + `core` schema + shell) ·
2. Warehouse port (full parity + offline) · 3. Procurement + Legal + `/vendor`.

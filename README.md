# mWell Intra

The full Intra monorepo: a Next.js shell, department modules, shared packages and
Supabase PostgreSQL/Auth/Storage. This is not the older standalone Warehouse app.

## Start With the Handoff

- [Technical team](docs/handoffs/2026-09-22/technical.md): architecture, setup, operations and remaining acceptance work.
- [Bitbucket/source transfer](docs/handoffs/2026-09-22/PORTABILITY.md): exact-source verification, hosting, configuration, migration mapping and recipient checks.
- [Data team](docs/handoffs/2026-09-22/data.md): reporting foundation, draft dictionary and connection prerequisites.
- [Testers](docs/handoffs/2026-09-22/testers.md): role-based cases, evidence and cross-team handoffs.
- [Release status](docs/handoffs/2026-09-22/release-status.json): exact UAT application/deployment, dated CI results and open items.
- [Offline handoff build](docs/handoffs/2026-09-22/README.md): generate searchable, collapsible HTML and PDF checks without the original developer's directories.

Current work is released through `codex/uat-launch-blockers`. Match the immutable
application/transfer commits in Release Status and Source Review, not a branch name
alone. **Do not use legacy `main` as this release:** it has a separate automatic
production deployment path. This delivery authorizes UAT only, not production.

## Repository Layout

```text
apps/shell/          Next.js app, shared navigation and HTTP endpoints
modules/            Warehouse, Procurement, Legal, Events, Product, Finance,
                    Insights, Learning and Work
packages/           Shared UI, auth, RBAC, data adapters and configuration
supabase/migrations/ Reviewed migration history; not a fresh-install guarantee
scripts/qa/         Guarded UAT checks and certification
docs/               Maintained specifications, runbooks and audience handoffs
tools/handoff/      Separately locked offline-documentation toolchain
```

## Local Setup

Use Node **24** and pnpm **10.23.0**, matching this release. Install the entire
monorepo from the lockfile:

```sh
pnpm install --frozen-lockfile
pnpm --filter @intra/shell dev --port 3022
```

Before starting the shell, obtain approved UAT configuration through the team's
secret manager and configure `apps/shell/.env.local`. See the value-free checklist
in the portability guide. A root QA `.env` file is not automatically the shell's
configuration. Never commit credentials or reuse production secrets for testing.
Use another free port if 3022 is occupied.

Real UAT uses the approved Supabase backend, not memory/demo fallback. Check
`/api/health` for the expected environment, backend and exact build. A healthy
response is availability evidence, not workflow, email or security certification.

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Live certification scripts can provision or mutate synthetic UAT records. Read
their guards and cleanup requirements first. A source-only copy also needs the
original Git objects for historical screenshot-provenance assertions; do not
delete those checks to make a copied repository appear certified.

## Deployment and Database Changes

Vercel uses the full repository with project root `apps/shell`; its configuration
installs with `--frozen-lockfile`. Select the exact approved target project and
commit. On another host, use a Node server and the recipient-owned release pipeline;
Bitbucket stores source and can run CI but does not supply the app server or backend.

**Do not blindly push every migration or run old seeds.** Source filenames and
installed UAT migration identifiers are not uniformly identical. Reconcile the
recorded mappings and effective database definitions, then apply only approved
changes. A fresh production backend requires its own rehearsed bootstrap,
Auth/Storage configuration, recovery proof and business approval.

The Reporting API is **not connectable yet**. Its private authority schema is
empty and disconnected, and all 30 proposed datasets remain unavailable. No
machine credentials, extraction worker or recipient connector are delivered.
See [reporting readiness](docs/integrations/reporting-api/RELEASE-READINESS.md).
Never share a Supabase service-role key as a shortcut for the Data team.

SMTP/email delivery remains explicitly excluded. Receiving-team setup, real-user
acceptance and production go/no-go remain separate from automated UAT results.

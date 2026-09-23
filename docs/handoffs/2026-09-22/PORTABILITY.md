## Bitbucket or Source Copy

**Bitbucket is the source repository and can run CI; it does not replace the application server, database, Auth or private file storage.** The production host and backend ownership are not yet confirmed. Moving source alone does not move these services or their data.

**Do not copy the default `main` branch as this release.** Use the exact application and transfer commits in this pack's Release Status and Source Review, or the source ZIP's `source-manifest.json`. The current work is maintained on `codex/reporting-security-foundation` and released through `codex/uat-launch-blockers`; branch names can move. A documentation-only successor must have only documentation differences from the recorded application commit. `main` was intentionally not updated because its workflow can deploy automatically to a separately configured production target.

| Transfer route | Required delivery | Receiving-team check |
| --- | --- | --- |
| Git repository import | Full Intra monorepo, agreed release commit and retained history; import into a private destination | Match the release commit before modifying it. Configure branch protection, reviewers and destination-owned credentials |
| Source-only ZIP | Commit-labelled archive, SHA-256 receipt and per-file source manifest; no `.git` required for the app | Obtain the archive hash through the agreed channel, verify it, then verify every source file before installation |
| Documentation | Audience HTML files plus maintained Markdown, builder and locked documentation toolchain | Read offline; regenerate from the delivered source and compare the document manifest |
| Runtime/backend | Separately approved hosting, Supabase services, configuration and database/object migration plan | Complete a recipient-led setup and restore rehearsal; a source-copy test is not a fresh-backend test |

Copy the entire monorepo, not only `apps/shell`. Workspace packages contain TypeScript source that Next.js compiles. Keep `pnpm-lock.yaml`, `pnpm-workspace.yaml`, package manifests, configuration, migrations, scripts and public assets together. Do not distribute `.env` files other than blank examples, `.vercel`, local project links, private keys, test sessions, `node_modules`, build caches, operational data exports or producer scratch directories. An archive is not an authorization to disclose real data.

An internal Git import should preserve history. A source-only recipient can initialize a new repository, but must retain the original release manifest because their new commit ID will differ. GitHub links are provenance references, not a requirement for running the application. Evidence retained only in expiring GitHub artifacts must be copied to an approved recipient-controlled location before expiry.

The app installs and builds from a source copy, but two historical screenshot-provenance assertions require original Git commit objects. A clean-source run exposed that dependency; the entire affected 32-test file passed when the original history was supplied. Preserve history for full certification. Do not delete or relax those assertions to get a green result from a ZIP-only copy.

## Build and Runtime Contract

Use **Node 24** for the current release, matching UAT certification, and **pnpm 10.23.0**. The app manifest permits Node 22+, but this is not proof that every supported version was retested. Use the lockfile; do not upgrade packages during transfer.

The repository's `.node-version` and deployment workflow now also select Node 24. Select it explicitly in the receiving build/test runner and keep pnpm 10.23.0. Before installing a source ZIP, verify its delivered checksum and run `node scripts/docs/export-handoff-source.mjs --verify .` from the extracted source root.

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm exec turbo run test --concurrency=1 -- --maxWorkers=2
pnpm build
pnpm --filter @intra/shell start --hostname 0.0.0.0 --port 3000
```

The application needs a Node server, not a static HTML host. Port 3000 is an example behind the receiving team's HTTPS reverse proxy. The default `next start` deployment needs the complete workspace and installed production/runtime dependencies; no Docker image or standalone-output bundle is certified in this delivery. Multi-instance cache coordination, proxy buffering, limits, health checks and process restart policies must be reviewed for the chosen host. Browser camera use requires HTTPS outside localhost.

The test command above matches the current CI's bounded workspace/worker concurrency. It runs the same tests without competing nested worker pools; it does not skip failures or alter assertions. Full certification also includes the separate SQL, browser, cleanup and evidence commands in the reviewed workflow.

Build runners need approved registry access and, with the current `next/font/google` configuration, access to Google's font download endpoints. Restricted-network builds need an independently reviewed font-vendoring change; do not silently replace fonts or bypass TLS checks. Provide dependency/license inventories and third-party notices with the release. mWell must confirm recipient rights for branding and other supplied assets; source possession alone is not a license determination.

The reporting helpers and private authority foundation do not implement the Reporting API or capture worker. Do not create a scheduler for a proposed worker or advertise working `/api/reporting/v1` endpoints from these plans.

## Value-Free Configuration Checklist

For local Next.js development, configure the shell in `apps/shell/.env.local`. For hosted builds, use the host's build/runtime secret settings. A root QA `.env` file is not automatically the shell configuration. Values below are categories or flags, not credentials.

| Name | Timing / visibility | Required handling and check |
| --- | --- | --- |
| `APP_ENV` | Server runtime | Set the correct environment; current target is `uat`. Verify `/api/health` |
| `SUPABASE_PROJECT_REF` | Server/QA | Must match the project in the public URL. Do not reuse the UAT ref for a new production backend |
| `NEXT_PUBLIC_SUPABASE_URL` | Build time; browser-visible | Approved backend endpoint. Rebuild when changed |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Build time; browser-visible | Public client key only. RLS and guarded functions must remain active |
| `NEXT_PUBLIC_DATA_SOURCE` | Build time; browser-visible | `supabase` for real sessions; memory/demo is not live acceptance |
| `NEXT_PUBLIC_ALLOW_DEMO_IN_PROD` | Build time; browser-visible | `false`; do not use demo fallback to hide an invalid backend |
| `APP_URL` | Server runtime | Canonical HTTPS app origin. Also reconcile Auth redirects and Edge Function origin allowlists |
| `SUPABASE_SECRET_KEY` | Server runtime; secret vault | Required for the current private Legal document access route and server administration paths. Legacy `SUPABASE_SERVICE_ROLE_KEY` is an alternative, not a browser setting. Never supply either to the Data team |
| `NEXT_PUBLIC_ENABLE_NOTIFICATIONS` | Build time; browser-visible | `true` for the current tested notification surface; check health and the actual bell |
| `NEXT_PUBLIC_ENABLE_SW` | Build time; browser-visible | Keep the approved release setting; check updates, refresh and offline recovery after changing it |
| `DEPLOYMENT_COMMIT_SHA` | Server runtime | Provider-neutral release identity accepted by health; populate from the verified release manifest |
| `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` | Build time; browser-visible | Existing client build-identity name, also needed outside Vercel. Populate with the same verified release SHA; this name does not require Vercel hosting |
| `VERCEL_GIT_COMMIT_SHA` | Existing Vercel build/runtime only | Takes precedence in server health. Remove stale imported values on another host rather than allowing two conflicting release IDs |
| `PRODUCTION_SUPABASE_PROJECT_REF` | QA only | Production mutation deny-list; never remove it to run UAT tests against production |
| `AUDIT_PASSWORD`, service QA credentials and mutation flags | Isolated UAT test job only | Never include in the runtime image, source package or handoff. Production must not run the UAT mutating harness |
| `INVITE_REDIRECT_ORIGINS` | Supabase invitation Edge Function secret/configuration | Must include a newly approved origin before future email acceptance. SMTP/invitation/reset delivery remains excluded from this UAT release |

Infra owns vault delivery, access review and rotation. Engineering verifies consumers after rotation. Build-time public values are embedded in JavaScript; changing a runtime variable alone cannot update them. Never prefix a secret with `NEXT_PUBLIC_`.

Keeping managed Supabase is different from self-hosting it. The current CSP and QA guards assume approved `*.supabase.co` endpoints. A custom/self-hosted backend requires reviewed CSP, host validation, Auth, Storage, Realtime and operational changes, then a separate certification. Do not broadly allow arbitrary origins.

## Database Upgrade Versus Fresh Install

**Do not run a blind migration push.** UAT's historical migration versions do not all match the repository filenames. Some changes were recorded under different historical IDs. The September 22 release reconciled UAT history and applied only its two reviewed migrations. The September 23 reporting follow-up separately installed the exact reviewed private-authority SQL. Neither release rewrote historical migration records or ran old seeds.

| Existing UAT upgrade | Fresh receiving environment |
| --- | --- |
| Verify project identity and exact installed history | Choose managed or self-hosted Supabase and establish PostgreSQL/Auth/Storage/Realtime first |
| Compare effective functions, owners, grants and policies, not only filenames | Reconcile a reviewed schema baseline and ordered migration manifest before applying anything |
| Save affected function definitions/ACLs and an approved recovery reference | Rehearse the baseline in a disposable empty environment; resolve legacy order/dependency issues there |
| Stage only reviewed unapplied migrations; inspect dry-run | Configure required extensions and exposed schemas, RLS, guarded RPCs and private bucket policies |
| Apply forward changes and read back history/runtime authority | Provision the first named platform administrators using an approved identity process, then assign business scopes separately |
| Retest authenticated actions and denied actions | Configure departments, master data, approved DOA and learning publication through the governed processes |
| Preserve pending decisions, policies, signed evidence and stock | Complete actual first-user onboarding and independent maker/checker journeys; do not copy UAT certificates or approval history |

The two release migrations are `20260922111953_procurement_doa_tier_guard.sql` and `20260922123940_procurement_final_approval_doa_authority.sql`. They depend on the existing effective Procurement/core/learning schema. They are not a bootstrap script.

The additional private-authority source is `20260923025605_reporting_private_authority_foundation.sql`.
UAT's managed migration service recorded it as `20260923032017_reporting_private_authority_foundation`.
The SQL SHA-256 is `8bbc47627fbfb4dcd2f97ce0f3efdfbd73ab066d6835bf12f4ffc158378b6d98`.
Preserve this explicit mapping; do not replay the source simply because its filename timestamp differs.
The four tables are empty, three roles are NOLOGIN and no app account has schema access. The bundled
authority ledger includes prerequisites, ACL checks and the remaining PUBLIC-RPC isolation limitation.
Do not grant a reporting runtime login or expose this schema through PostgREST during transfer.

Database migrations alone do not transfer Auth service configuration, secret keys, object bytes, Storage policies outside the reviewed baseline, Edge Function deployments, redirect allowlists or independently approved learning content. The CI database bootstrap excludes some managed services and is not evidence of a complete fresh production install. **Recipient fresh-backend readiness remains open until the full rehearsal passes.**

## CI and Release Controls on Another Host

Do not assume GitHub Actions files execute in Bitbucket. The receiving team must port the actual commands and evidence checks, not just the job names. Preserve frozen dependency installation, both production and all-dependency vulnerability gates, lint/type checks, unit tests, hash vectors, SQL/real-PostgreSQL authorization tests, build, exact-release health check, six route widths, two transaction widths, independent cleanup and the final evidence gate. Run the private-authority PostgreSQL gate sequentially after the existing DOA gate in the disposable marked PG17 service. Keep SMTP explicitly excluded unless separately commissioned.

The existing `deploy-vercel.yml` at the application baseline automatically deploys on a push to `main` and does not wait for separate UAT certification. **Do not enable or transplant this legacy production path as an approved release process.** Keep automatic production deployment disabled until the recipient has configured protected approvals, explicit target project, reviewed migration readiness and successful certification for the exact artifact. The current task releases UAT only, not production.

Record both the original tested application release and the recipient build ID. A copied repository's new Git SHA must not be presented as having passed the original CI. Any code, dependency, backend, configuration or hosting change requires the corresponding retest.

## Recovery and Recipient Acceptance

Before production: name the incident commander, app operator, database/Storage operator, Security contact and business owners. Choose the actual monitoring/alert destination and prove an alert reaches an owner. The source contains an unconfigured Sentry wrapper; it is not evidence that monitoring is active.

The receiving team must demonstrate a restore into an isolated environment: database plus private object bytes, Auth/configuration and key recovery; then reconcile object references, approvals, movements and balances. Record measured RPO/RTO, retention, a compatible prior application artifact and safe write-containment instructions. There is no certified one-click write-freeze or rollback drill in this handoff. Do not delete transactions or rewrite signed evidence as a rollback shortcut.

Archive sanitized evidence with hashes in recipient-controlled storage, separate from credentials and real personal data. GitHub certification artifacts expire after their configured retention period. Obtain a named, dated acceptance for source receipt, clean setup, deployment, recovery and support ownership. UAT automation, documentation QA and a successful source build are separate evidence, not production approval.

Reference procedures: [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting), [Bitbucket repository import](https://support.atlassian.com/bitbucket-cloud/docs/import-a-repository/) and [Supabase migration CLI](https://supabase.com/docs/reference/cli/supabase-db-push). These explain provider mechanics; the release-specific checks and remaining gaps above still apply.

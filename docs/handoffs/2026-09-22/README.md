# Handoff Maintenance

This directory owns the Data, Technical and Tester handoffs. The generated HTML files work offline with embedded diagrams, search, collapsible sections and downloads. Keep the four HTML files together for cross-pack navigation.

## Source and Evidence

Use the full Intra monorepo, not the older standalone Warehouse repository. `release-status.json` records the immutable application commit, separately verified UAT commit, deployment, observation time and test evidence. Documentation revisions can follow the application release without changing its runtime identity. Never describe a documentation build as a passed app test.

The documentation sources, builder, reporting design inputs and locked documentation toolchain must be committed with the full app. Nothing requires a Codex installation or the original developer's directory layout. SMTP remains excluded. Never include credentials, signed download URLs, user sessions or database connection strings.

## Rebuild

Use Node 24 and pnpm 10.23.0. From the full monorepo root:

```sh
pnpm install --frozen-lockfile
npm ci --prefix tools/handoff --ignore-scripts
npm exec --prefix tools/handoff -- playwright install chromium
node scripts/docs/build-handoffs-20260922.mjs
node scripts/docs/build-handoffs-20260922.mjs --verify
```

The builder resolves app packages from this repository and document-only packages from `tools/handoff/node_modules`. Browser rendering and PDF inspection use installed packages, not a global PDF utility. Optional `HANDOFF_SOURCE_ROOT`, `HANDOFF_RUNTIME_MODULES` and `HANDOFF_BROWSER_EXECUTABLE` overrides are local paths, never secrets.

Source review uses `git show` at `release-status.json.sourceCommit`, not a dirty working tree. A source-only distribution may instead supply a verified `source-manifest.json` with the same application commit and per-file SHA-256 hashes. The exporter verifies any newer source revision changes documentation only. The manifest verifies copy integrity; it is not a digital signature or a substitute for a trusted delivery channel.

Build output is `outputs/handoffs-20260922`. `--verify` checks input hashes, local links, ZIP contents, offline navigation, search, keyboard disclosure, downloads, five viewport widths and print completeness. It saves screenshots and A4 PDFs under `qa`. Those are document checks, not live application certification. Inspect screenshots as well as assertions.

After changing status or content, rebuild and verify again. Editing a distributed JSON file does not change HTML already generated. The recipient documentation ZIP contains only its manifest-listed files; source code and QA captures are separate packages.

## Copying Source

Prefer a full Git import to Bitbucket and preserve history. Build a source-only package from committed files with:

```sh
node scripts/docs/export-handoff-source.mjs --ref <documentation-commit> --application-ref <live-application-commit> --out <new-output-directory>
```

Install the documentation toolchain first. The exporter creates a fresh source directory, ZIP, file-hash manifest and ZIP checksum. It excludes local environments, caches, linked-project metadata, scratch work and generated output. Distribute through an approved access-controlled channel. Do not recursively ZIP a working directory.

A plain source ZIP can build the app. Two historical screenshot-provenance checks additionally need the original Git commit objects. Keep those checks strict: import history or provide an approved archive of that history. Do not delete the assertions to make a source-only copy appear fully certified.

## Recipient Acceptance

- Data: the API is design only. Runtime, database, network, disclosure and ownership still need confirmation.
- Technical: reproduce clean setup, configure the receiving host/backend and pipeline, verify migrations and recovery, and name support owners.
- Testers: allocate current fixtures, identities, required learning and next actors. Starter checklist rows intentionally begin Not run; historical automation does not populate a recipient's results.
- Production: requires a separate go/no-go, actual business acceptance and the receiving environment's own verification.

Maintain the open-work register and preserve failed or incomplete evidence. A green UAT pipeline alone is not production acceptance.

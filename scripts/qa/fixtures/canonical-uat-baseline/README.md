# Canonical Empty Database Baseline

This is a **CI-only rebuild input**, not a production installation procedure and not a claim that the entire UAT migration history has been replayed identically.

## Provenance

The 22 SQL files are read-only copies of the recorded migrations from UAT project `kkoitlvydytdhlpxhuah`: 21 legacy Public/Warehouse prerequisites followed by `20260717175559_baseline_live_intra_cutover_without_operational_fixtures`. They contain the actual schema, helpers, grants and RLS, not permissive test replacements. Line endings are normalized for checksum comparison; execution uses the checked-in bytes.

The July 6 prototype schemas in the source history use UUID workflow keys. The canonical July cutover uses text workflow keys. Concatenating both creates a database that UAT never had and fails on incompatible foreign keys. We preserve those source files rather than rewriting UAT history or changing live keys.

## Rebuild Contract

- `../../canonical-replay-manifest.json` accounts for every baseline and repository migration with a SHA-256 checksum. The preparation script also pins the complete manifest checksum.
- The baseline is executed first under ordered, CI-only version filenames. Original provenance remains in the output `replay-audit.json`.
- All 231 classified forward-source migrations execute unchanged in repository order, including source/applied-history variants. This tests the candidate source; it is not an exact replay of all recorded UAT SQL.
- Exactly 35 original files remain in the repository but are not replayed: 32 incompatible prototype/pre-cutover files, the replaced cutover variant, and two operational seed files tied to named UAT accounts. Each exclusion has its own checksum and reason in the manifest.
- Missing, new, changed, unclassified, duplicated, or symlinked SQL is rejected before the disposable workspace is created. Adding a migration requires updating and reviewing the manifest and its checksum.
- No linked project configuration, credentials, auth users, tester records or operational seed data is copied into the isolated workspace. The existing governed orientation bootstrap and applied-authority tests run afterwards as separate, required steps.

All native PostgreSQL, source, coverage, build, accessibility and browser release gates remain required. Packaging tests alone do not establish that the SQL executed successfully. This change does not migrate UAT or authorize deployment.

## Forward Source Syntax Correction

Two forward sources (`20260714175318_single_po_receipt_authority.sql` and `20260717143000_task3_receipt_authority_forward_convergence.sql`) required a syntax-only correction before packaging: schema-qualified `pg_catalog.substring` must use comma arguments, not the special unqualified `FROM ... FOR` grammar. Both actual source expressions failed with SQLSTATE 42601 before the correction. The regression checks valid PNG decoding and rejection of invalid/truncated PNG headers. The manifest pins the corrected candidate bytes. No existing UAT migration is reapplied and signature-policy checks are unchanged.

The organization source `20260714175057_core_organization_extensibility.sql` also rejected its own `legal_compliance` and `people_culture` seed codes. Its first-segment character class now allows underscores, matching the recorded applied constraint and later convergence. Negative cases still reject uppercase, spaces, leading digits, empty segments and empty codes. These five exact line corrections were independently checked against applied/converged SQL before updating the historical source-verifier checksum. All other historical authority remains pinned.

## Remaining Scope

The source/applied-history differences require separate installation and upgrade planning before a copied-source production deployment. This fixture must not be used to silently repair or rebaseline an existing database. SMTP, business workflows and existing UAT records are outside this packaging change.

# Canonical Department Authority Remediation

**Released:** August 23, 2026  
**Application behavior baseline:** `32170e425e125c63597ea8e05c6287a7cd256f5b`

## What changed

- UAT DOA matrices were normalized from display names to active `core.departments.code` values, including the legacy Legal label.
- The DOA editor now uses the controlled active department directory and displays both the human-readable department name and stable code.
- Database triggers reject unknown or inactive matrix departments and synchronize every assignment to its parent matrix.
- Procurement certification fixtures now use the same canonical department identity as request cost-center validation.
- Route certification retries once only when all route, layout, accessibility, and authorization checks passed and every recorded console failure is a recognized transient Supabase transport error. HTTP failures, JavaScript errors, and a failed second attempt remain release failures.

## Verification

- UAT schema verification found zero unmapped matrices and zero matrix/assignment department mismatches.
- `operations` with cost center `CC-1100` resolves to an active Operations DOA.
- Resolver checks map both the Operations code and display name to `operations`, and Legal & Compliance to `legal_compliance`.
- Focused live-contract, shell type, lint, and source checks passed before release packaging.

## Operator action

Platform Admin and Legal must select departments from the directory when creating a DOA revision. Do not enter or import a department label as free text. A separate authorized checker still performs activation.

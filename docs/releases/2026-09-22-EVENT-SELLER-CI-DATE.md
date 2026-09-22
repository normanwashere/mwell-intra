# Event Seller CI Date Correction

## Why Run 203 Stopped

The named-seller ledger test created its event using PostgreSQL `current_date`, which follows the database session timezone. Seller access correctly evaluates event dates in Asia/Manila. Run 203 reached the check at 17:10 UTC on September 20, already September 21 in Manila. Its synthetic September 20 event was therefore expired, and the real predicate correctly rejected it with `Not authorized: event custody read`.

The same access failure was reproduced locally by running the unchanged fixture under Pacific/Honolulu while Manila was on the next date. The normal UTC run passed earlier in the UTC day, explaining the time-dependent result.

## What Changed

Only the isolated SQL test fixture and regression coverage changed. Fixture start/end dates now explicitly use the same Manila business date as the existing seller predicate. Regressions cover UTC, a negative-offset timezone and a positive-offset timezone; exact opening/closing midnight boundaries; assignment revocation, expiry and future validity; inactive profiles; expired roles; own-entry filtering; and cross-event denial.

No application code, live database function, migration, role assignment, event date, stock, onboarding completion or SMTP setting changes. Actual event expiry remains enforced. Historical September 20/21 test events are not extended or backdated by this correction. The deterministic boundary test substitutes a clock only inside its disposable PGlite database; production SQL is unchanged.

## Verification and Release Limit

The failing reproduction was observed before changing the fixture date expression. On September 22, the focused suite passed 15/15 tests. The complete 11-file event-custody/access CI command then passed 151/151 tests, with zero failures, cancellations or skips, using Node 24 and isolated test processes. This larger result includes the focused suite; the counts must not be added together. JavaScript syntax and whitespace checks also passed.

A passing local gate is not full hosted certification. A new exact-commit hosted run must still complete preparation, six route viewports, governed transactions, independent cleanup and the evidence bundle before full certification can be claimed.

The handbook was regenerated with this release note registered. Its 90 catalog, guide and generator regressions pass with zero failures or skips using the repository's original LF source bytes, matching the hosted checkout. The documentation-currentness check also passes. No screenshot was recaptured or newly certified by these source tests.

This test-only correction does not change operating instructions, so no new user training or KB behavior is introduced. The Data, Technical and Tester handoff packs remain drafts while the user-prioritized CI repair is completed.

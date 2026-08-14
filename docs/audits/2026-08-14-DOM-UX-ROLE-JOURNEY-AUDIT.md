# Mwell Intra Post-Remediation Role and UX Audit

**Date:** 2026-08-14
**Target:** local production build at `http://127.0.0.1:3016`
**Backend mode:** deterministic memory mode
**Viewports:** 1440 x 900 desktop and 390 x 844 mobile
**Accounts:** 19 seeded identities, including every seeded multi-role combination

## Verdict

All six accepted findings from the preceding DOM and UX audit are fixed. The final browser suite passed, the production build and lint checks are clean, and the expanded DOM crawl found no accepted P0, P1, P2, or P3 visual issue after screenshot and DOM-evidence triage.

The build is ready for the next UAT gate. This run does not certify live Supabase writes, RLS, storage, email delivery, or cross-session persistence because it intentionally used the deterministic memory backend.

## Remediated Findings

| Finding | Resolution | Verification |
| --- | --- | --- |
| Duplicate shared orientation for multi-role users | Added a canonical completion identity, deduplicated equivalent assignments in the center, status band, and resolver, and converged equivalent completion state in the repository | Unit coverage plus zero onboarding pages with more than one `Role orientation` heading across 19 accounts and two viewports |
| Hidden prerequisite name after deduplication | Locked-step guidance resolves titles from the complete assigned curriculum | Multi-role unit regression verifies `Complete Warehouse safety orientation first` |
| Department matrix not keyboard reachable | Scroll region now has `tabIndex=0`, a named region, and visible focus treatment | Desktop and mobile Playwright keyboard test |
| Duplicate Minimize label at 200% | Removed the duplicate rendered label | Component regression and desktop 200% reflow test |
| Small Procurement approval links | Expanded authoritative record links to a 44px minimum hit area | Mobile 390px geometry regression |
| Small Finance activity links | Applied the same 44px minimum hit area to PO activity links | Mobile 390px geometry regression |
| Small vendor logo link | Expanded the vendor home target without enlarging the artwork | Mobile 390px geometry regression |

## Final Coverage

- 74 Playwright checks executed: 70 passed and 4 intentionally skipped on inapplicable viewports
- 53 Learning tests passed
- 7 Finance tests passed
- 4 affected packages linted with no errors
- Next.js production build completed, including TypeScript and 20 generated routes
- 38 account/viewport journeys
- 268 routed page states
- 334 screenshots
- 0 fatal pages
- 0 duplicate shared-orientation pages
- 0 accepted visual or interaction findings after evidence triage

## Account Matrix

| Account | Role coverage | Multi-role |
| --- | --- | --- |
| Mika Reyes | Warehouse Operator / Operations Associate | No |
| Bea Santos | Warehouse Supervisor, Logistics Supervisor, Procurement Approver, Product Operations Partner | Yes |
| Marco Reyes | General Employee, Warehouse Business Unit, Procurement Requester, Events Requester, Product Contributor | Yes |
| Liza Cruz | Procurement Officer, Procurement Admin, Warehouse Procurement | Yes |
| Marta Ramos | Department / Procurement Approver | No |
| Elena Torres | Procurement Finance | No |
| Diego Ang | CFO / Procurement Admin | No |
| Andre Villanueva | Legal Reviewer, Compliance, Legal Admin | Yes |
| Rina Domingo | Warehouse Finance, Procurement Finance, Event Finance Reviewer | Yes |
| Jules Aquino | Warehouse BI Analyst, Insights Analyst, Insights Manager, Executive | Yes |
| Kai Mendoza | Warehouse Marketing, Events Coordinator, Events Admin | Yes |
| Nina Flores | Business Unit, Procurement Requester, Events Requester, Product Contributor | Yes |
| Sam Bautista | Events Viewer | No |
| Maya Tan | Insights Manager | No |
| Rafael Ong | Executive | No |
| Pia Salcedo | Product Owner, Events Viewer | Yes |
| Alex Rivera | Warehouse Administrator | No |
| Patricia Lim | Platform Administrator | No |
| Acme Medical Supplies | Vendor Representative | No |

## Transaction Results

The final two-viewport suite verified:

- Memory sign-in persistence and role restoration
- Least-privilege denial for Platform Admin, Finance, requesters, and vendors
- Admin and Legal DOA boundaries
- Personalized onboarding, shared requirement deduplication, policy progression, assessment lockout, certification recovery, keyboard control, pause/resume, explicit completion, focus return, and 200% reflow
- Procurement request, approval, PO, vendor, and Finance handoffs
- Unified dual-scope Finance and Procurement-only Finance views
- Event validation, creation, opening, handoff, and read-only access
- My Work filtering and authoritative-source navigation
- Warehouse role authorization, serialized putaway with reload persistence, return serial validation, cycle-count presence, and unexpected-serial rejection
- Mobile target sizing for Procurement, Finance, and vendor navigation
- Desktop and mobile layout stability for all audited routes

## Visual Review

The final contact sheets and selected full-resolution screenshots were reviewed manually. Accepted results:

- No incoherent overlap, page-level horizontal overflow, blank page, or trapped modal
- No fixed mobile navigation covering a working control
- Readable desktop and mobile hierarchy across Warehouse, Procurement, Finance, Legal, Events, Product, Insights, Admin, My Work, onboarding, and vendor surfaces
- Dialogs become usable mobile sheets and remain bounded on desktop
- Multi-role users receive one shared orientation and explicit persona-specific practices
- Keyboard users return to the next enabled governed action when training completes
- Empty, denied, validation, and read-only states explain the next safe action

## Raw Heuristic Triage

The crawler emitted 49 raw P1 and 2 raw P2 flags. None survived inspection:

- 39 hit-test flags were descendants of the intentionally collapsed Knowledge Base `Guide actions` menu or controls below the current viewport that are reachable by normal scrolling.
- 10 clipping flags were native select option text, hidden desktop navigation labels, or compact tab labels whose visible rendered controls fit.
- 2 target-size flags were 1 x 1 hidden form inputs controlled by visible 44px labels; they are not direct user targets.

These raw records remain in `results.json` for transparency. The accepted-finding count is zero.

## Remaining Release Gate

Repeat the transaction matrix against UAT using vaulted Supabase credentials. For each governed write, verify submit, readback, second-role handoff, reload persistence, audit record, RLS denial, and cleanup. Add live invitation email receipt, expiry, replay, and password-setup checks before production certification.

## Evidence

- `outputs/ux-dom-crawl-2026-08-14-all-accounts/contact-sheet-desktop-1440.png`
- `outputs/ux-dom-crawl-2026-08-14-all-accounts/contact-sheet-mobile-390.png`
- `outputs/ux-dom-crawl-2026-08-14-all-accounts/results.json`
- `outputs/ux-dom-crawl-2026-08-14-all-accounts/summary.json`
- `apps/shell/tests/e2e/role-ux-regressions.spec.ts`

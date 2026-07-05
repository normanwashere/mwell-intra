# UX & Data-Scoping Review — Vendor Portal + Legal Accreditation

Date: 2026-07-05 · Scope: `/vendor/*`, `/legal/*` (mobile 390px + desktop 1366px) ·
Evidence: live browser walk (demo mode), source review of `modules/legal/src/**`,
localStorage inspection of the running demo.

---

## Part 1 — Functional findings

### F1 · CRITICAL — Vendor portal shows another vendor's case

**Observed:** Signed in as `vendor@acme.demo` (Acme Medical Supplies), the portal
lists **Thames Digital Systems Ltd.** — a different vendor — including its
approved status and expiry.

**Root cause (two layers):**

1. **Stale demo data, not a filter bug.** The list filter
   (`AccreditationCasesPage.tsx:113-116`) correctly scopes vendors to
   `r.vendorId === profile.vendorId`. But the Thames case row in localStorage
   carries `vendorId: 'ven-acme'` — it was created during an automated E2E walk
   that bound the new case to the only existing vendor login so the vendor
   journey could be exercised. The filter did its job against corrupted data.
2. **The deeper product gap that caused the corruption:** the invite flow mints
   `vendorId = 'ven-<inviteId>'` with **no linked login identity**. In demo mode
   there is no way for a newly invited vendor to ever sign in, so any end-to-end
   test (or demo run) is forced to reuse `ven-acme` — recreating this leak.

**Additional client-side gap found while investigating:**
`CaseDetailPage.tsx:140` performs **no vendor-ownership check** — any vendor who
guesses/receives another case's URL (`/vendor/cases/<id>`) renders it fully.
Same for `SignInstrumentPage`. In live mode RLS blocks the *data* fetch, but in
demo mode nothing blocks it, and the client should never render another
vendor's case shell regardless.

**Fix spec:**

| # | Change | File | Effort |
|---|--------|------|--------|
| 1 | Vendor-ownership guard on case detail + sign page: `if (isVendor && kase.vendorId !== profile?.vendorId) → <Navigate to="/" replace>` | `CaseDetailPage.tsx`, `SignInstrumentPage.tsx` | XS |
| 2 | One-time demo-data hygiene: on store read, drop/flag cases whose `vendorId` belongs to a different vendor than their invite; provide a "Reset demo data" action in the account menu (clears `intra.legal.*`, `intra.procurement.*` keys) | `localStore.ts`, `UserMenu.tsx` | S |
| 3 | Demo vendor identity: when an invite is created in demo mode, register an ephemeral memory profile (`<email> → vendorId ven-<inviteId>`) so the invited vendor is sign-in-able and E2E walks never rebind to `ven-acme` | `localStore.ts` + shell providers | M |
| 4 | Keep RLS as the live boundary (already correct: own-vendor SELECT policies) — no change | — | — |

**Acceptance:** Acme sees exactly one case (its own); deep-linking another case
id as a vendor redirects to the portal home; a fresh invite is walkable
end-to-end without touching Acme's identity.

### F2 · HIGH — "Previous attachments" are kept but effectively invisible to reviewers

**Observed behavior today:** every uploaded version *is* persisted
(`localStore.ts:491-505` auto-increments `version`) and every doc attached to a
checklist item renders inline in that row (`CaseDetailPage.tsx:974-1034`) with a
`v{n}` badge and an Open link. Nothing is deleted.

**Why reviewers still can't find them:**

1. Versions render as a **flat unordered list inside each checklist row** — a
   v3 re-upload sits visually identical to the rejected v1 above it. There is
   no "current vs superseded" distinction, no reverse-chronological order
   guarantee, and no uploader/date columns.
2. There is **no case-level document view**. To audit "everything this vendor
   ever sent," a reviewer must expand all 20+ checklist rows one by one.
3. On **renewal cases** the tailored checklist reseeds fresh item ids; documents
   from the previous accreditation cycle remain keyed to the old case and are
   unreachable from the new one — exactly the "previous attachments" a reviewer
   needs when re-accrediting.

**Fix spec:**

| # | Change | Effort |
|---|--------|--------|
| 1 | Per-row version chain: newest doc rendered as "current" (full row), older versions collapsed under "· 2 previous versions" disclosure, each with status, uploader, date, Open | S |
| 2 | Case-level **Documents tab/panel**: aggregated table of every doc on the case (requirement, filename, version, status, uploaded by, date, expiry, Open), sortable, visible to internal reviewers only | M |
| 3 | Renewal continuity: when a case is created for a vendor with a prior case, link `previousCaseId` and surface a read-only "Previous cycle documents" section | M |

**Acceptance:** a reviewer can answer "what did this vendor submit for BIR 2303,
including rejected versions, and what did they submit last cycle?" in ≤2 clicks.

---

## Part 2 — Layout & hierarchy review

Method: every surface reviewed at 390px and 1366px. Grading notes reference the
screenshot the product owner supplied plus live snapshots.

### 2.1 Vendor portal home (`/vendor`)

**What renders today (top→bottom):** chrome strip (avatar + "Mwell Intra ·
Vendor portal" + company + Sign out) → navy hero (eyebrow "Vendor portal," +
company name h1 + two-line boilerplate) → "Your accreditation" h2 + one-line
boilerplate → DataTable mobile card (STATUS / CATEGORY / SUBMITTED / EXPIRES
label-value pairs).

**Problems:**

- **P1 · Identity stated three times** (chrome, hero eyebrow, hero title)
  before any information appears. On 390px the hero consumes ~40% of the
  viewport to say the vendor's own name back to them.
- **P1 · The single most important fact — application status — is below the
  fold on mobile** and rendered as a generic table row, not a status. A vendor
  visits this page to answer exactly one question: *"where is my application
  and what do I need to do next?"* Neither is answered above the fold.
- **P2 · The list shape is wrong for n=1.** Vendors almost always have exactly
  one case. A "list of cases" presentation (with a heading claiming *"Documents
  and status for your organization only"*) is internal-tool framing leaked to
  an external audience — and it's precisely where F1's cross-vendor leak became
  user-visible.
- **P2 · Boilerplate copy** ("Submit accreditation documents and track your
  review status. Every action is scoped to your vendor record." / "Documents
  and status for your organization only.") is instructional text occupying
  prime real estate on every visit. First-visit information, not every-visit
  information.
- **P3 · ALL-CAPS dt labels** (STATUS/CATEGORY/…) at 0.65rem read as database
  fields; fine internally, cold externally.

**Recommendation — replace the list with a status-first "application card":**

```
┌─────────────────────────────────────────────┐
│ ● Under review                    (i)       │  ← status dot + plain-language label,
│ Your accreditation application              │    tooltip carries the explainer copy
│ ────────────────────────────────            │
│ ◔ 9 of 16 requirements approved             │  ← progress ring/bar (already computed)
│ ▸ You still owe 3 documents                 │  ← THE next action, one tap
│ ▸ 1 agreement awaiting your signature       │
│ ────────────────────────────────            │
│ Submitted Jul 5 · Medical devices · PH      │  ← meta demoted to one muted line
│ [ Continue application → ]                  │  ← single primary CTA
└─────────────────────────────────────────────┘
```

- Hero shrinks to a compact strip (eyebrow + company only, no description);
  the description moves into an `(i)` tooltip on the card.
- If the vendor ever has >1 case (renewals), the card shows the active case and
  prior cycles collapse into a "Past accreditations" disclosure below.
- Desktop: same card, max-width ~560px, centered; whitespace does the work.

### 2.2 Case detail (`/vendor/cases/:id` and `/legal/cases/:id`)

**Today:** hero (eyebrow + vendor-name h1 + status accessory) → meta tile grid →
role-specific banners ("You still owe…"/"Waiting on vendor…") → grouped
checklist (group header + progress bar + N cards, each card: title + badges +
description + "Why we need this" expander + reviewer note + action buttons +
inline docs) → Activity timeline.

**What already works:** grouping with per-group progress, expiring badges,
signature artifacts in the timeline, "Why we need this" as an expander (right
instinct — keep moving this class of copy behind disclosure).

**Problems:**

- **P1 · No persistent orientation.** The page is long (20+ cards). Once the
  user scrolls, status/progress/next-action scroll away. Mobile especially:
  the decision buttons (Legal) live in a `SectionTitle` action slot mid-page
  and wrap awkwardly at 390px.
- **P2 · Uniform card weight = no scent.** All requirement cards render at
  identical visual weight whether pending, rejected (needs attention), or
  approved (done). A reviewer scans for "what needs me"; a vendor scans for
  "what's left" — neither is differentiated.
- **P2 · Repeated identical buttons.** Eight+ `Review` buttons (internal) or
  `Upload` buttons (vendor) with no differentiation add clutter without
  information. The row itself should be the tap target opening one consistent
  review/upload sheet.
- **P3 · Meta tile grid** (Vendor/Category/Status/…) duplicates hero facts and
  pushes the checklist down a full viewport on mobile.
- **P3 · Description + why + note + docs all expanded** inflates card height;
  approved items rarely need any of it visible.

**Recommendations:**

1. **Sticky progress header** (both roles): compact bar under the app chrome
   with status chip, progress (n/m), and the single next action ("3 to review" /
   "2 to upload"). Appears after scrolling past the hero. Effort M.
2. **Collapse solved groups by default** — groups where all required items are
   approved render collapsed with a ✓ summary row; auto-expand groups
   containing rejected/pending items. Effort S.
3. **Row-as-target:** whole requirement card opens the review sheet (internal)
   or upload/sign sheet (vendor); the per-row buttons reduce to a chevron +
   status. Sheet already exists — reuse. Effort M.
4. **Demote meta grid** to a single muted line under the hero title (Category ·
   Jurisdiction · Submitted date), with the full record behind an `(i)`
   popover. Effort S.
5. **Rejected-first sort inside groups** (rejected → pending → submitted →
   approved). Effort XS.
6. Keep hero h1 = vendor name (correct: the case IS the vendor), but the
   eyebrow should carry status for instant orientation: "Accreditation case ·
   Under review".

### 2.3 Legal inbox (`/legal`)

**Problem — the same numbers render three times:** hero accessory ("Active
cases / Waiting on you"), then four StatCards (Waiting on vendor / Waiting on
Legal / Ready / Renewals), then five filter chips with counts (All/…). Three
stacked layers of counting before the actual list. On 390px that's ~1.5
viewports of KPIs before row one.

**Recommendations:**

1. StatCards become the **only** count surface and act as the filter (they
   already call `applyFilter` — good); delete the chip row, render the active
   filter as a dismissible chip above the table. Effort S.
2. Hero accessory keeps a single number: "Waiting on you: N" (the only KPI a
   reviewer opens the page for). Effort XS.
3. Table columns for internal users: add "Waiting on / next action" column
   (the bucket) — currently the bucket is only discoverable via filtering.
   Effort S.

### 2.4 Invite wizard + sign page

Both are recent and largely sound (stepper, disclosure fields, signature
gating). Two refinements:

- Wizard step 3 preview: collapse each requirement group to its count line by
  default ("Tax & Revenue · 6 requirements, 4 required"); expanding shows rows.
  At 390px the current full preview is a very long scroll before Submit. Effort S.
- Sign page: on 390px the template body precedes the pad — after signing, the
  Confirm button can sit below the fold; make the Confirm bar sticky at the
  bottom once a signature is present. Effort S.

### 2.5 Chrome & navigation (vendor)

- Vendor chrome + hero double-brand (2.1). Collapse to one strip: avatar +
  company + "Vendor portal" caption + Sign out; hero eyebrow drops "Vendor
  portal,".
- The vendor has no navigation (single surface) — correct; don't add tabs for
  one destination.

---

## Part 3 — Cross-cutting design rules (to keep it clean permanently)

1. **Tooltip primitive.** `@intra/ui` has no Tooltip/Popover. Add one
   (Radix-style behavior: hover/focus on desktop, tap-toggle on touch,
   `aria-describedby`, dismiss on scroll). Then adopt the rule: *headings carry
   nouns; explanations live behind `(i)`*. Candidates already identified: all
   ModuleHero descriptions, SectionTitle subtitles that explain rather than
   inform ("Documents and status for your organization only", "Every action is
   scoped…", "Tap a row to review"), meta tiles, RETENTION-style compliance
   notes. Effort M (primitive) + S (adoption sweep).
2. **One KPI surface per page.** Hero accessory OR StatCards, never both plus
   chips. Counts that filter should be the filter.
3. **Card = record.** Reserve cards for records/actions; explanatory copy is
   never a card. (The current empty states follow this — keep.)
4. **Above-the-fold contract per page:** status + progress + next action must
   be visible without scrolling at 390px on: vendor home, case detail,
   approval inbox, request detail. Add a Playwright viewport assertion for
   each (fail if the primary CTA's bounding box top > 780px at 390×844).
5. **Disclosure over deletion.** Anything removed from the surface (meta grids,
   version history, explainer copy) moves behind one consistent affordance —
   `(i)` tooltip for copy, chevron disclosure for data — never deleted.
6. **External vs internal tone.** Vendor-facing surfaces use plain language
   ("We're reviewing your documents") instead of pipeline vocabulary
   ("submitted · under_review"); map statuses through a vendor-facing label
   table. Effort S.

---

## Part 4 — Prioritized plan

| Priority | Item | Refs | Effort |
|----------|------|------|--------|
| P0 | Vendor ownership guard on case detail + sign page | F1.1 | XS |
| P0 | Demo-data hygiene + reset action | F1.2 | S |
| P1 | Status-first vendor application card (replaces list) | 2.1 | M |
| P1 | Doc version chains + case-level Documents panel | F2.1-2 | M |
| P1 | Sticky progress header on case detail | 2.2.1 | M |
| P1 | Tooltip primitive + copy-to-tooltip sweep | 3.1 | M |
| P2 | Collapse solved groups, rejected-first sort, row-as-target | 2.2.2-5 | M |
| P2 | Legal inbox: single KPI surface, bucket column | 2.3 | S |
| P2 | Vendor-facing status language table | 3.6 | S |
| P2 | Demo vendor identity provisioning for invites | F1.3 | M |
| P3 | Wizard preview collapse, sticky sign confirm, chrome dedupe | 2.4-5 | S |
| P3 | Renewal-cycle document continuity | F2.3 | M |
| P3 | Above-the-fold Playwright assertions | 3.4 | S |

Suggested batches: **Batch 1** = P0 (ship immediately, fixes the leak the
product owner screenshotted). **Batch 2** = P1 (the visible UX transformation).
**Batch 3** = P2/P3 polish + guardrails.

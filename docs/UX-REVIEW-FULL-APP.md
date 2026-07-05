# UX / Layout / Information-Hierarchy Review — Full App

Date: 2026-07-05 · Scope: entire Mwell Intra suite (shell, warehouse, procurement, legal, vendor, admin) ·
Method: live browser walk of every route at **390×844 (mobile)** and **1366×900 (desktop)**, demo mode,
all personas, plus source verification of every finding (file:line cited where relevant).
Companion doc: [`UX-REVIEW-VENDOR-LEGAL.md`](./UX-REVIEW-VENDOR-LEGAL.md) — its findings are
**referenced, not repeated**; its cross-cutting rules (one KPI surface, tooltips over inline copy,
card = record, above-the-fold contract, disclosure over deletion) are applied app-wide here.

Severity: P0 = broken journey/data · P1 = materially hurts daily use · P2 = friction/inconsistency ·
P3 = polish. Effort: XS < ½ day, S ≈ 1 day, M ≈ 2–3 days, L ≈ 1 wk, XL > 1 wk.

---

## 1. Executive summary — the 5 highest-ROI changes

1. **Unblock the procurement Legal tier (P0).** Requests ≥ the legal-review threshold route to a
   "Legal" ladder step that **no persona can act on**: `resolveTiers`
   (`modules/procurement/src/pages/ApprovalInboxPage.tsx:43-81`) grants the tier to
   `legal:legal_reviewer` and `core:platform_admin`, but the module gate
   (`ProcurementApp.tsx:35`, `can(userRoles,'procurement','view_dashboard')`) bounces both to
   "No procurement access". Every high-value request dead-ends at step 3. Fix the gate
   (allow tier-eligible roles into `/procurement/approvals` only) or map `procurement:admin`
   onto the legal tier. Effort S.
2. **One KPI surface per page, everywhere (P1).** The triple-count anti-pattern the vendor/legal
   review flagged is the house style: procurement requests (hero accessory + 4 StatCards + 5 tabs),
   approval inbox (hero + 4 StatCards), warehouse dashboards (hero accessory duplicates the first
   StatCard on all 3 role variants), admin users (hero repeats 2 of the 4 StatCards), finance
   (hero button duplicates row buttons). On 390px the procurement request list shows **zero actual
   requests** above the fold. Adopt the rule once in `@intra/ui` guidance and sweep. Effort M.
3. **Stop the fixed bottom nav from eating primary CTAs (P1).** At 390×844 the shell's fixed mobile
   nav (`apps/shell/components/AppShell.tsx:185`) sat directly on top of the tap target three times
   during this walk: the category radio in the request wizard, **Approve** on the first
   approval-inbox card, and **Author purchase order** on the request detail. Content needs
   `padding-bottom` ≥ nav height + safe-area on every module scroll container (and
   `scroll-margin-bottom` on focusables). Effort XS–S.
4. **One vocabulary: human labels, one date format, one sign convention (P1).** Raw enum slugs
   render as user copy across modules (`under_review`, `submitted`, `cycle_count`, `issue`,
   `renewal_due` in the vendor picker); dates appear as `6/5/2026` (US), `2026-06-10` (ISO),
   `24d ago`, and `Jul 5, 2026` — twice **in the same ladder row** (`7/5/2026, 10:08:11 PM` next to
   `Jul 5, 2026, 10:07 PM`); warehouse movement quantities show `issue … +40` (an outflow rendered
   as a gain). Add `formatStatus()` / `formatDate()` (en-PH, `d MMM yyyy`) / signed-quantity
   helpers to `@intra/ui` and sweep. Effort M.
5. **Give approvers a decision, not a signature box (P1).** The sign-&-approve sheet
   (`ApprovalInboxPage.tsx` decision sheet) contains a note field and the SignaturePad — **no
   amount, no line items, no justification**. An approver acting from the sheet signs
   ₱2.6M sight-unseen or must leave, read the detail page, and come back. Embed a compact
   summary (total, top lines, need/risk excerpts, requester) above the pad. Effort S–M.

Honourable mention (P0 from the prior review, **still reproducible today**): the vendor portal as
Acme still lists Thames Digital Systems Ltd.'s case. The fix plan already exists in
`UX-REVIEW-VENDOR-LEGAL.md` F1 — ship it first.

---

## 2. Journey walkthroughs

### J1 — Vendor accreditation → procurement award → warehouse receipt

Walked as: Andre (invite), Acme (vendor), Andre (approve), Liza/Diego (PO), Bea (warehouse).

| Step | What happens | Friction |
|---|---|---|
| 1. Legal invites vendor (`/legal/invites/new`) | 3-step wizard, tailored checklist | **J1-1.** Invite mints a vendor with no login identity → the invited vendor can never sign in in demo; every E2E rebinds to Acme (documented as F1.3 in the vendor/legal review — still open). **J1-2.** "Preview build: no email is actually sent…" is permanent on-surface dev copy. |
| 2. Vendor uploads + signs + submits (`/vendor`) | Works for Acme | **J1-3.** Cross-vendor leak (prior review F1) still live: Acme's portal lists Thames' case. |
| 3. Legal approves (`/legal/cases/:id`) | Decision + signature | Covered by prior review (sticky decision actions, uniform card weight). Nothing new. |
| 4. Procurement selects vendor (`/procurement/requests/new` §7) | Picker lists vendors | **J1-4.** Non-approved vendors annotated with raw slugs: `BrightPath Print & Signage · (renewal_due)`, `MediConsult · (submitted)`. No explanation of *why* selection is inadvisable, no link to the case, and nothing stops selecting them. Approved vendors carry no positive marker. |
| 5. PO award (`/procurement/purchase-orders/:id`) | Accreditation tile: `ok · approved · exp 1/31/2027` | **Good** — accreditation is surfaced at award time. **J1-5.** But it's a dead end: no link to the legal case, no "what happens at expiry" affordance. |
| 6. Warehouse receives | — | **J1-6 (biggest seam).** The two PO worlds never touch. Procurement POs live in `intra.procurement.v2.purchase_orders`; warehouse POs in `mwell-intra-warehouse:data:v1`. PO-2026-0003 never appears in `/warehouse/purchase-orders`, and procurement's one-tap "Receive 4" changes **no inventory anywhere**. Warehouse receiving (`/warehouse/receiving`) cannot reference a procurement PO. Context is fully lost at the module boundary. |

**Verdict:** steps 1–5 hold together (accreditation genuinely gates awards). The journey breaks at
the warehouse hand-off: "receive" means two unrelated things in two modules.

### J2 — Request → 5-tier ladder → PO → receive

Walked end-to-end with a ₱2,600,000 Goods request ("UX review — barcode scanners for warehouse").

Click budget (mobile, excluding persona switches): **create** ≈ 25 field interactions + submit on a
**4,433px-tall single page** (5.3 viewports); **each approval** = 4 taps (Approvals → Approve →
Type tab → Sign) × 5 tiers; **PO** = 1 tap to author + 3 to award + 1 to issue + 1 to receive.

Friction points, in order:

1. **J2-1 (P1).** The wizard is a monolith. Legal solves the same problem with a 3-step stepper
   (~1,200px); procurement should adopt it. The approval preview + live sourcing suggestion +
   required-documents preview are excellent and must survive the split.
2. **J2-2 (P0).** Ladder step 3 "Legal" is unactionable (see Executive #1). This walk only
   completed because a synthetic session with both `legal_reviewer` + a procurement role was
   crafted via sessionStorage — no real persona can do it.
3. **J2-3 (P2).** Liza (requester) approved her own request at the Procurement-Head tier with no
   self-approval warning. Even in demo, a "You raised this request" banner in the sheet is cheap
   insurance.
4. **J2-4 (P1).** The decision sheet has no decision context (Executive #5), and the drawn
   signature canvas is ~84px tall at 390px — cramped for a finger. ≥120px, and honour the
   prefilled name: today a **prefilled** "Full legal name" doesn't enable "Sign & approve" until
   the field is re-typed (the typed signature only commits on an `input` event) — a user happy
   with the default taps a dead button with no explanation.
5. **J2-5 (P1).** "Required documents" (5 items required for RFP) is decorative: the request
   sailed through all 5 tiers with **zero attachments** and no missing-document state anywhere.
   Either enforce ("submit blocked until spec + budget evidence attached") or visibly mark items
   `missing` on the detail so approvers see the gap.
6. **J2-6 (P2).** State visibility is decent inside the module (ladder with e-signature artifacts,
   "In flight (other tiers)" section, "View PO" link on the request) but the request's Activity
   feed stops at final approval — PO authored/awarded/issued/received never post back. The
   requester also gets no signal anywhere (shell bell is disabled in demo; home badge counts *all*
   in-flight requests, not "waiting on you" — see Shell findings).
7. **J2-7 (P1).** PO receive is one tap, no confirmation, no partial quantity, no location, no
   evidence — it closed a ₱2.6M PO instantly. Compare warehouse receiving, which does this
   properly (location, bin, serials, photo evidence). Reuse that flow or at minimum confirm +
   allow partials.

### J3 — Day-1 new employee (Marco, operations)

Sign-in → land → find work: **login (2 taps: tile + Sign in) → home (1 tap on Warehouse card) →
dashboard**. Time-to-first-action is genuinely good: the ops dashboard variant leads with
*Pending reservations (2)* — his actual queue — and event cards. Friction:

1. **J3-1 (P2).** The home hero spends ~45% of the 390px viewport on identity + vanity stats
   ("ACCESS 1 module · SCOPED ROLES 2"). For 1-module users the card is the only choice —
   the hero could carry the module's live badge and a direct CTA instead.
2. **J3-2 (P2).** "Events" — the core noun of Marco's role — is not in his bottom nav
   (Dashboard · Inventory · Allocations · Returns · More); it's buried in the More sheet.
   Swap Inventory → Events for `operations`/`marketing` roles.
3. **J3-3 (P3).** Warehouse hero greets by role, not name ("Welcome back, Logistics Supervisor" /
   "eCommerce / Operations") while shell home greets "Welcome back, Marco". Day-1 users see two
   different apps greeting them differently within 3 taps.

---

## 3. Per-surface findings

### 3.1 Shell

#### `/login`
**Good:** compact hero, one h1, demo profiles behind a collapsed disclosure, tile-tap prefills, honest placeholder copy ("any value in demo mode").

| # | Sev | Viewport | Evidence | Recommendation | Effort |
|---|-----|----------|----------|----------------|--------|
| SH-1 | P3 | both | Demo tiles show name + title but not the email the subtitle tells you to use ("pick a profile below or use its email") | Add the email as the tile's second line (it's the actual credential) | XS |
| SH-2 | P3 | mobile | Expanded-state chevron on "Demo profiles" points left instead of down (rotation class) | Rotate to `chevron-down` when open | XS |

#### `/` home (all personas)
**Good:** module cards carry live badges (procurement/legal/vendor), per-persona card sets are correct, page fits one viewport, bottom nav present.

| # | Sev | Viewport | Evidence | Recommendation | Effort |
|---|-----|----------|----------|----------------|--------|
| SH-3 | P2 | mobile | Hero (≈45% of viewport) shows "ACCESS 1 module / SCOPED ROLES 2" — numbers with no action attached, for every persona (`apps/shell/app/page.tsx`) | Drop the two stat blocks; surface the busiest module's live badge in the hero, or deep-link 1-module users' hero CTA straight into the module | S |
| SH-4 | P2 | both | Badge label lies for non-actors: Liza (requester) and Diego both see "1 request awaiting approval" even when the pending tier is Department Head (`apps/shell/lib/moduleBadges.ts:59-71` counts all in-flight for any procurement role) | Tier-scope the count with the same `resolveTiers` logic as the inbox; label "waiting on you" vs "in review" accurately | S |
| SH-5 | P2 | both | Warehouse module card never gets a badge — no warehouse branch in `moduleBadges.ts` — while procurement/legal/vendor do | Add low-stock/pending-reservation count for warehouse roles | S |
| SH-6 | P3 | both | "Jump into a surface" section title is product-team jargon | "Your modules" / "Your workspace" | XS |

#### Top bar / chrome (shell-wide)
| # | Sev | Viewport | Evidence | Recommendation | Effort |
|---|-----|----------|----------|----------------|--------|
| SH-7 | P2 | both | Bell is disabled in shell ("Notifications unavailable in demo mode") but **enabled with 5 live alerts** inside warehouse — same icon, same position, opposite behaviour | Either surface warehouse-style local notifications in the shell bell, or brand the warehouse one differently ("Module alerts") | S |
| SH-8 | P2 | both | Theme does not sync: shell persists `intra-theme` (`apps/shell/lib/theme.ts:6`), warehouse persists `mwell-intra-warehouse:theme` (`modules/warehouse/src/app/theme.tsx:12`). Toggling light in warehouse leaves the shell dark and vice versa — verified live | One storage key (+ storage-event listener); warehouse reads/writes the shell key | S |
| SH-9 | P3 | both | Account menu contains only "Sign out"; warehouse hides "Reset demo data" inside its More sheet instead | Consolidate: account menu = profile, theme, reset demo data, sign out (matches prior review F1.2 plan) | S |

#### `/admin/users` (Patricia)
**Good:** demo-mode banner is explicit; mobile collapses the matrix into per-user cards with role chips; StatCards row is informative.

| # | Sev | Viewport | Evidence | Recommendation | Effort |
|---|-----|----------|----------|----------------|--------|
| AD-1 | P1 | desktop | Whole page scrolls horizontally: `document.scrollWidth` = **3580px** at a 1366px viewport — the 19-column checkbox matrix stretches the page; hero/StatCards/banner all clip | Contain the matrix in its own `overflow-x-auto` card with a sticky USER column; page itself must never h-scroll | S |
| AD-2 | P2 | both | Hero accessory (PROFILES 12 / SCOPED GRANTS 23) repeats the first two StatCards verbatim | One KPI surface: keep StatCards, drop the hero accessory | XS |
| AD-3 | P3 | both | Hero copy: "Writes go through core.assign_user_role / core.revoke_user_role." — RPC names as UI copy | Tooltip candidate (see §4); hero keeps "Assign scoped module roles per user." | XS |
| AD-4 | P3 | desktop | Column headers are raw uppercase slugs (`CORE:PLATFORM_ADMIN`, `WAREHOUSE:LOGISTICS_SUPERVISOR`) | Use `moduleDefinition.roles[x].label` with the module as a grouped header row | S |
| AD-5 | P3 | both | Hero says "Scoped grants 23", matrix subtitle says "19 scoped roles" — different nouns, different numbers, no reconciliation | Label one "role columns (19)" and the other "grants (23)", or show only grants | XS |

#### Signed-out deep links (`/procurement` etc.)
**Good:** `SignInPrompt` (`packages/ui/src/SignInPrompt.tsx`) with lock icon, promise "you'll land right back here", and a working `?redirect=` round-trip. No findings.

---

### 3.2 Warehouse module

*Personas actually available: Bea (logistics), Marco (ops), Rina (finance), Jules (BI), Kai (marketing). The brief assumed Bea sees finance/pricing/data/events — she does not; RBAC scopes them away (verified: `/warehouse/events` as Bea → access-denied page).*

#### Module-wide
| # | Sev | Viewport | Evidence | Recommendation | Effort |
|---|-----|----------|----------|----------------|--------|
| WH-1 | P1 | desktop | **Two h1s on every warehouse page**: the sidebar brand "Intra \| Warehouse" is an `<h1>` (`modules/warehouse/src/components/AppShell.tsx:108`) plus each page's own h1 | Demote the brand to a `<p>`/`<div>` | XS |
| WH-2 | P1 | both | Demo persona gap: `/warehouse/pricing` (needs `view_pricing`), `/warehouse/procurement` and `/warehouse/suppliers` (need `view_procurement`) are **unreachable by every demo profile** — no persona holds `warehouse:pricing` or `warehouse:procurement` (`apps/shell/lib/demoProfiles.ts`) | Add the two roles to an existing persona (e.g. Rina += pricing, Bea += procurement) or add a persona; otherwise 3 routes are dead code in every demo | XS |
| WH-3 | P2 | both | Vocabulary leaks: movement types render as `issue`, `receipt`, `cycle_count` (dashboard activity, product detail, finance audit trail); actors as raw/truncated emails (`mktg@mwell`) | Label map for movement types; resolve actor display names | S |
| WH-4 | P2 | both | Sign convention: `issue … +40` — outbound stock displayed as a positive gain, everywhere quantities appear; only `cycle_count` shows a minus | Sign by direction (issue −, receipt +, return +) or show direction icons | S |
| WH-5 | P2 | both | Three date formats in one module: `6/5/2026` (PO list), `2026-06-10` (events), `24d ago` (relative). US M/D/YYYY in a PH-locale app | en-PH `d MMM yyyy` + relative only under 7 days (shared helper) | S |
| WH-6 | P2 | mobile | "Reset demo data" (More sheet / sidebar) wipes and reseeds the module **with no confirmation and no success feedback** — verified: sheet closes silently | Confirm dialog + toast | XS |
| WH-7 | P3 | both | Hero greets by role ("Welcome back, Logistics Supervisor") vs shell's "Welcome back, Bea"; the role string then repeats as h1, sidebar caption, and "Logistics Supervisor overview" h2 — 3–4 occurrences above the fold | Greet by first name; "Overview" as the h2 | XS |

#### Dashboard (`/warehouse/`, all 3 role variants checked)
**Good:** role-specific KPI sets (logistics: low-stock; ops: pending reservations; BI: value/return-rate) with drill-in StatCards; skeleton on load; the ops variant puts the user's actual queue first.

| # | Sev | Viewport | Evidence | Recommendation | Effort |
|---|-----|----------|----------|----------------|--------|
| WH-8 | P2 | both | Hero accessory duplicates the first StatCard on every variant (LOW-STOCK 3 ×2; PENDING RESERVATIONS 2 ×2; INVENTORY VALUE ×2) | Hero keeps the sparkline only; counts live in StatCards | XS |
| WH-9 | P3 | both | Hero description = the RBAC role description ("Receiving, tagging, serialized tracking…") — explains the role, not the day | Tooltip candidate; replace with a live one-liner ("3 SKUs need reorder · 1 variance open") | S |
| WH-10 | P3 | both | "Export data" is the hero's only action on a dashboard whose primary verbs are receive/scan | Hero CTA = Quick scan / Receive for logistics; Export moves to Data page or overflow | XS |

#### Receiving (`/warehouse/receiving`)
**Good:** serialized-vs-bulk adaptation (picking a serialized product swaps qty stepper for per-serial scan), ₱ unit-cost placeholder, put-away bin select, receipt lines edit in place, "Receive N item(s)" stays disabled until valid, recent receipts show actor + supplier.

| # | Sev | Viewport | Evidence | Recommendation | Effort |
|---|-----|----------|----------|----------------|--------|
| WH-11 | P1 | mobile | The page is scan-first by design ("Scan & tag incoming inventory") but **Scan to receive is below the fold** at 390px — the fold is spent on Receive into / Supplier / Put away selects | Scan CTA + manual barcode field first; context selects collapse into a "Receiving into: Pasig · General area ▾" summary chip | M |
| WH-12 | P2 | mobile | Numeric inputs (`Quantity`, `Unit cost (₱)`) lack `inputmode="decimal"` — full keyboard on mobile (verified: `inputmode=null` on both) | Add `inputmode`/`pattern` across all module forms | XS |
| WH-13 | P3 | both | "Item context" is jargon for "Product" | Rename | XS |
| WH-14 | note | — | Camera scanner opened with a live viewfinder + Stop button (permission was granted in this environment) — the denial path could not be exercised; the inline viewfinder + manual-entry fallback next to it is the right degraded shape | Verify the denied-permission copy shows the manual fallback prominently | — |

#### Allocations (`/warehouse/allocations`) + Events (`/warehouse/events`, `:id`)
**Good:** Return/Issue bottom sheet is the best sheet in the app — backdrop blur, drag handle, qty stepper clamped to max (increase disabled at limit), disposition/restock-into selects, 44px CTA visible without scrolling at 390×844. Event detail has clean Reserved/Issued/Returned/Consumed stats.

| # | Sev | Viewport | Evidence | Recommendation | Effort |
|---|-----|----------|----------|----------------|--------|
| WH-15 | P2 | mobile | Events not in ops/marketing bottom nav (More-sheet only) despite being the role's core noun | Role-aware nav slot swap (Inventory → Events) | XS |
| WH-16 | P3 | both | Events list shows `₱88,700 consumed` (money); event detail "Consumed 142" (units) — same word, different meanings | "₱88,700 spent" vs "142 units consumed" | XS |
| WH-17 | P3 | both | Event eyebrow `corporate · 2026-06-10` — lowercase slug + ISO date | Title-case type + formatted date | XS |

#### Cycle counts (`/warehouse/cycle-counts`)
**Good:** location/category/bin scoping with "count one bin at a time" hint, Blind-count and Variances-only toggles, live variance chips, per-group progress, **sticky Submit bar** above the bottom nav (verified `position: sticky`), search within sheet.

| # | Sev | Viewport | Evidence | Recommendation | Effort |
|---|-----|----------|----------|----------------|--------|
| WH-18 | P1 | both | Counted inputs are **prefilled with the expected quantity** (Doctor Token: Counted=80 with Expected 80 shown beside it) and the card badge reads "balanced" before anyone counts. One tap submits a perfect count. The "0/9 counted" tracker only counts touched rows — but Submit is enabled at 1/9 with 8 rows silently at expected | Default counted to empty; "balanced" only after a row is touched; Submit confirms "8 rows not counted — submit anyway?" | S |
| WH-19 | P3 | mobile | Unlabelled "0" chip top-right of each row (it's the variance) | Label "±0" or hide until touched | XS |

#### Returns (`/warehouse/returns`)
**Good:** disposition explains itself ("What happens to the returned stock"), restock-into select, disabled CTA until a product is chosen, recent returns show reason + disposition chips.

| # | Sev | Viewport | Evidence | Recommendation | Effort |
|---|-----|----------|----------|----------------|--------|
| WH-20 | P3 | both | Reason options are lowercase fragments (`defective`, `wrong size`, `unused / surplus`) — inconsistent with Title Case everywhere else | Title-case the option labels | XS |

#### Storage areas (`/warehouse/storage`) + Locations (`/warehouse/locations`)
**Good:** Scan-a-bin entry point, warehouse picker, per-bin category + occupancy state.

| # | Sev | Viewport | Evidence | Recommendation | Effort |
|---|-----|----------|----------|----------------|--------|
| WH-21 | P2 | both | Every row carries its own Edit + Delete buttons (4× each on storage, 5× on locations) — the repeated-identical-buttons clutter rule; Delete is permanently visible next to "Pasig Main Warehouse" | Row opens an edit sheet; Delete lives inside the sheet behind a confirm | S |
| WH-22 | P3 | both | Locations list prints raw ids as the secondary line (`loc-wh`, `loc-event-makati`) | Show type ("Warehouse" / "Event site") instead; id behind (i) | XS |

#### Inventory (`/warehouse/inventory`) + Product detail (`/inventory/:id`)
**Good:** family grouping with expandable sizes, search across name/SKU/barcode, Low-stock-only toggle, category tabs; product detail has stock-by-location and Transfer/Relocate/Adjust actions.

| # | Sev | Viewport | Evidence | Recommendation | Effort |
|---|-----|----------|----------|----------------|--------|
| WH-23 | P3 | both | Mixed stock nouns: serialized/promo rows say "available", sized families say "in stock" — unexplained distinction | Pick one, or legend via (i) | XS |
| WH-24 | P3 | both | Product movement history repeats WH-3/WH-4 (raw `issue +60`, `cycle_count · cycle count adjustment`, truncated actor emails) | Covered by WH-3/WH-4 sweep | — |

#### Purchase orders (`/warehouse/purchase-orders`)
**Good:** received-progress bars per PO (`150 / 400 · 38%`), open-value summary ("3 open • ₱494,200 on order"), Open/Closed tabs.

| # | Sev | Viewport | Evidence | Recommendation | Effort |
|---|-----|----------|----------|----------------|--------|
| WH-25 | P2 | both | A **draft** PO row exposes the same "Receive" button as ordered POs (`po-wearables · 24d ago · draft · Receive`) | Hide/disable Receive until status ≥ ordered | XS |
| WH-26 | P3 | both | Two different POs both display the id `po-wearables`; ids double as user-facing labels | Human PO numbers (the procurement module already does `PO-2026-0003`) | S |
| WH-27 | P2 | both | Repeated per-row "Receive" buttons; row itself is not tappable | Row → PO detail/receive sheet; button only in the sheet | S |

#### Finance (`/warehouse/finance`, Rina)
**Good:** valuation by category, reconciliation queue with per-row post-adjustment, serialized asset register with holder + event, audit trail with actor + timestamp.

| # | Sev | Viewport | Evidence | Recommendation | Effort |
|---|-----|----------|----------|----------------|--------|
| WH-28 | P2 | both | Duplicate CTA: hero "Post adjustment" + per-row "Post adjustment" in Reconciliation | Keep the row action only | XS |
| WH-29 | P3 | mobile | Asset register = 15 identical flat cards (one per serial) — a long undifferentiated scroll | Group by product with count + disclosure | S |

#### Data & Reports (`/warehouse/data`, Jules)
**Good:** CSV exports, data dictionary, metric definitions with formulas — a genuinely useful reference page; enum documentation here is the *right* place for slugs. No findings.

#### Access-denied + skeletons
**Good:** guarded routes render a branded "You don't have access to this page" card with a Back-to-dashboard CTA; route transitions show hero/stats/list skeletons (`App.tsx:153-160`). No blank screens observed anywhere in the module.

---

### 3.3 Procurement module

#### Requests list (`/procurement/`)
**Good:** StatCards drill into filtered views, request cards carry status/vendor/total/needed-by, "New request" is prominent, skeleton on load.

| # | Sev | Viewport | Evidence | Recommendation | Effort |
|---|-----|----------|----------|----------------|--------|
| PR-1 | P1 | mobile | Triple KPI stack: hero accessory (Awaiting review 1 of 3 · Approved 2) + 4 StatCards + 5 count tabs before row one — **zero requests visible above the fold at 390px** | StatCards = the only counts and the filter (they already drill); tabs become the StatCards' active state; hero accessory drops to one number or none (same fix as prior review §2.3) | S |
| PR-2 | P2 | both | Raw status slug as copy: "Status **under_review**" on cards | Status label map + Badge tone (shared with PR-14) | XS |
| PR-3 | P2 | both | Card = `<button>` wrapping a nested `<a>` with the same title (`RequestsPage.tsx` rows) — duplicate tab stops, double announcement | One interactive element per row | S |
| PR-4 | P3 | both | Drafts StatCard uses a map-pin icon | `clipboard`/`edit` icon | XS |
| PR-5 | P3 | both | Section subtitle "Every draft you save appears here (persisted locally in this preview)." — dev-meta copy on every visit | Tooltip/delete (see §4) | XS |
| PR-6 | P3 | mobile | Tab bar item "Purchase orders" wraps to two lines at 390px | "POs" on mobile or tighter padding | XS |

#### Create request wizard (`/procurement/requests/new`)
**Good:** numbered sections; category cards with high-risk chips; **live approval-ladder preview that updates as category/amount change** (verified: adding Legal at IT/₱2.6M); sourcing method auto-suggests from amount (flipped RFQ→RFP at ₱2.6M); per-path required-documents preview; policy § references; date input is a real date field.

| # | Sev | Viewport | Evidence | Recommendation | Effort |
|---|-----|----------|----------|----------------|--------|
| PR-7 | P1 | mobile | **4,433px tall single page** (5.3 viewports); submit at y=4268 with no sticky footer; legal's invite wizard solves the identical shape in 3 steps of ~1,200px | Stepper: 1 What/Who → 2 Why + lines → 3 Sourcing/vendor/attachments + ladder preview; sticky Continue/Submit | L |
| PR-8 | P1 | mobile | Fixed bottom nav intercepts taps on form controls at load (category radio "IT / Software" — click landed on the nav's Home link; reproduced on inbox Approve and request-detail CTA) | Bottom padding ≥ nav height + safe-area on module containers (Executive #3) | XS |
| PR-9 | P2 | mobile | Number inputs (qty, unit price) have no `inputmode` | `inputmode="decimal"` | XS |
| PR-10 | P2 | both | 11 category radio cards ≈ 2 viewports before anything else | Grid of compact chips at 390px; descriptions behind (i) | S |

#### Approval inbox (`/procurement/approvals`)
**Good:** tier-scoped "Waiting on you" vs "In flight (other tiers)" vs "Recently decided" is exactly the right mental model; inbox-zero empty state; total-value StatCard.

| # | Sev | Viewport | Evidence | Recommendation | Effort |
|---|-----|----------|----------|----------------|--------|
| PR-11 | **P0** | both | Legal-tier deadlock (Executive #1). Verified live: Andre → "No procurement access"; Patricia → same; Diego (procurement admin) sees the request under "In flight (other tiers) — Waiting on Legal" with no action | Gate fix or tier remap + a demo persona that can act | S |
| PR-12 | P1 | both | Decision sheet contains note + SignaturePad only — no amount/lines/justification (Executive #5) | Compact request summary in the sheet | S–M |
| PR-13 | P2 | both | Hero accessory (Waiting on you / In flight) + 4 StatCards double-count | One KPI surface | XS |
| PR-14 | P2 | both | Row exposes 3 actions (Review link + Reject + Approve); Approve at 390px sits in the nav-occlusion band (PR-8) | Row opens detail/sheet; Reject/Approve inside the decision sheet | S |
| PR-15 | P2 | both | Prefilled typed-signature name doesn't arm the Sign button until re-typed (J2-4) | Commit typed signature from the initial value | XS |
| PR-16 | P2 | mobile | Drawn-signature canvas ~315×84px | ≥120px tall pad | XS |
| PR-17 | P2 | both | Self-approval unflagged (J2-3) | "You raised this request" banner in the sheet | XS |
| PR-18 | P3 | mobile | Sheet title "Sign & approve — UX review — barcode scanners for warehouse" — double em-dash pile-up | Title "Sign & approve"; request title as a second line | XS |

#### Request detail (`/procurement/requests/:id`)
**Good:** ladder renders each step with e-signature artifact ("e-signed by Marta Ramos · typed"), status per step, "View PO" cross-link after authoring, required-documents checklist per sourcing path, justification card.

| # | Sev | Viewport | Evidence | Recommendation | Effort |
|---|-----|----------|----------|----------------|--------|
| PR-19 | P1 | both | Required-documents checklist is decorative — no attached/missing state, no enforcement (J2-5) | Mark each item attached/missing from actual attachments; block submit or flag prominently | M |
| PR-20 | P2 | mobile | 10 meta tiles (Status → Needed by) push justification/ladder a full viewport down — same meta-grid pattern the prior review demoted on case detail (§2.2.4) | One muted meta line + (i) popover; status chip joins the h1 eyebrow | S |
| PR-21 | P2 | both | Two timestamp formats in one ladder row: "7/5/2026, 10:08:11 PM" (approval) + "Jul 5, 2026, 10:07 PM" (signature) | One formatter, minute precision | XS |
| PR-22 | P2 | both | Activity feed ordering is mixed: Draft → Submitted (oldest-first) then approvals newest-first | Single chronological order (newest-first including creation) | XS |
| PR-23 | P3 | both | "Step 1 . Department Head" — stray space before the period; status slug "submitted" lowercase in meta tile | Format `Step 1 · Department Head`; status label map | XS |

#### Purchase orders (`/procurement/purchase-orders`, `/:id`)
**Good:** one-click PO authoring from an approved request; accreditation tile with status + expiry **at award time**; award/issue/receive status progression; "Source request" back-link; award-signature block with RA 8792 note.

| # | Sev | Viewport | Evidence | Recommendation | Effort |
|---|-----|----------|----------|----------------|--------|
| PR-24 | P1 | both | One-tap "Receive 4" fully received and **closed** a ₱2.6M PO — no confirm, no partial quantity, no location, no evidence (J2-7); and it moves no warehouse stock (J1-6) | Receive sheet with per-line quantities + confirm; long-term: hand off to warehouse receiving | M |
| PR-25 | P2 | both | Award-signature block prints the **entire user-agent string** ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 … \| tzOffset=-480") inline (`PODetailPage.tsx:351-353`) | Collapse behind "Signature evidence" disclosure; show method + time only | XS |
| PR-26 | P2 | both | Vendor picker + PO surface raw accreditation slugs (`· (renewal_due)`, `· (submitted)`); accreditation tile has no link to the legal case (J1-4/J1-5) | Human labels ("accreditation expiring", "under review") + link to `/legal/cases/:id` for internal users | S |
| PR-27 | P3 | both | Hero description literal "No notes on this PO."; hero primary action is "Back to POs" (navigation) while real actions sit below | Omit description when empty; hero CTA = current lifecycle action (Approve award / Issue / Receive) | XS |
| PR-28 | P3 | both | "REQUESTED BY cfo@mwell.demo" on a PO authored by Diego from Liza's request — provenance conflates author and requester | "Authored by Diego Ang · from request by Liza Cruz" | XS |
| PR-29 | P3 | both | Signer line renders "Diego Ang&lt;cfo@mwell.demo&gt;" without a space | `{name} <{email}>` | XS |

#### Module architecture note
| # | Sev | Evidence | Recommendation | Effort |
|---|-----|----------|----------------|--------|
| PR-30 | P2 | Procurement resolves access from **session-supplied roles** (a hand-crafted `intra.memory-session.v1` with extra roles was honoured), while warehouse resolves from the **profile's canonical roles** (the same trick was rejected). Demo-only, but two trust models in one app | Pick one resolution path in `@intra/auth` for memory mode | S |

---

### 3.4 Legal + Vendor (delta on top of UX-REVIEW-VENDOR-LEGAL.md)

The prior review's findings all still stand as written — including **F1 (cross-vendor leak), which
is still reproducible today** (Acme's portal lists Thames Digital Systems Ltd.). Apply its plan
(Part 4) as-is. New findings only:

| # | Sev | Viewport | Evidence | Recommendation | Effort |
|---|-----|----------|----------|----------------|--------|
| LG-1 | P2 | both | `/legal` shows "Invite vendor" twice: module tab bar + list-section action button | Keep the tab-bar entry; drop the section button (or vice-versa) | XS |
| LG-2 | P3 | both | Invite wizard footer: "Preview build: no email is actually sent. In production the invite lands in the vendor's inbox…" — permanent dev-meta copy | Tooltip/demote to the Demo chip's explainer | XS |
| LG-3 | P2 | both | Statuses on the case list are raw slugs ("submitted", "approved" lowercase) — same vocabulary sweep as PR-2/WH-3 | Shared status label map | — |
| LG-4 | praise | — | The 3-step invite stepper (~1,200px/step, live tailored checklist) is the **house pattern the procurement wizard should adopt** (PR-7) | — | — |

---

## 4. Tooltip candidate inventory (app-wide)

Extends the prior review's list (§3.1) beyond vendor/legal. Disposition: **(i)** = move behind
tooltip/popover once the Tooltip primitive lands · **del** = delete outright · **keep** = leave.

| Surface | Exact current text | Disposition |
|---|---|---|
| `/admin/users` hero | "Assign scoped module roles per user. Writes go through core.assign_user_role / core.revoke_user_role." | Keep first sentence; **(i)** for the RPC sentence |
| `/admin/users` banner | "The shell couldn't find Supabase env, so this screen shows the static demo profiles below and every control is disabled. Configure NEXT_PUBLIC_SUPABASE_URL and…" | Keep 1-line banner; **(i)** for env-var detail |
| Shell home hero | "ACCESS — 1 module · SCOPED ROLES — 2" | **del** (replace with live badge) |
| Warehouse hero (all roles) | "Receiving, tagging, serialized tracking, cycle counts & returns." (role description as description) | **del**; replace with live status line |
| Warehouse More sheet rows | Per-tool descriptions ("Browse SKUs by category, size, serial, batch and location. Create & edit products with the manage-products tools.") — truncated with … at 390px anyway | **(i)** or truncate to 4 words |
| `/warehouse/cycle-counts` | "Count one bin at a time for accurate per-bin quantities." | keep (instructional at the decision point) |
| `/procurement/` hero | "Raise, route and track purchase requests before PO authoring. Awards are gated on vendor accreditation." | **(i)** |
| `/procurement/` list subtitle | "Every draft you save appears here (persisted locally in this preview)." | **del** |
| Wizard §1 subtitle | "Category drives sourcing path, approvers, and required documents." | keep (one line, decision-relevant) |
| Wizard §3 subtitle | "Structured justification per policy §9 (Award Recommendation). Approvers read "need" and "risk if not procured" first." | **(i)** — keep "Approvers read need + risk first." |
| Wizard §6 subtitle | "Derived from category, amount, and sourcing path (policy §3 + §9). Ladder is created on submit." | **(i)** |
| Wizard §8 subtitle | "JPEG, PNG, WebP, or PDF up to 10 MB each. Same guards as Legal accreditation uploads." | keep formats; **del** "Same guards…" |
| `/procurement/approvals` hero | "Only requests waiting on your tier appear here. Approving forwards to the next tier; rejecting sends the request back to the requester." | **(i)** — first-visit info |
| Approval sheet legal note | "By signing you agree this is your electronic signature and it will be logged on the approval audit trail (RA 8792, DocuSign-equivalent intent)." | keep (legal necessity), reduce to 1 line + **(i)** |
| Request detail section subtitles | "Policy §9 — Award Recommendation basis." / "Multi-tier routing derived from category + amount + sourcing (policy §3, §9)." / "Everything that has happened on this request." | **(i)** / **(i)** / **del** |
| PO award signature block | Full user-agent + tzOffset string | **(i)** disclosure ("Signature evidence") |
| `/legal/invites/new` footer | "Preview build: no email is actually sent. In production the invite lands in the vendor's inbox with a magic-link…" | **(i)** on the Demo chip |
| Vendor/legal items from prior review | (see UX-REVIEW-VENDOR-LEGAL.md §3.1) | as specced there |

---

## 5. Consistency matrix

Pattern × module. ✔ = follows the best-in-app version · ~ = partial/deviating · ✖ = missing/conflicting.

| Pattern | Shell/Admin | Warehouse | Procurement | Legal | Vendor |
|---|---|---|---|---|---|
| **Detail hero** | — | ~ page h1 + subtitle, no ModuleHero on inner pages (leanest in app) | ~ ModuleHero on detail pages, filler text when empty ("No notes on this PO.") | ~ hero + meta grid (prior review: demote) | ✖ triple identity (prior review 2.1) |
| **Status badges** | ✔ Employee/Vendor chips | ~ mixed: chips on POs, raw slugs in activity | ✖ raw slugs (`under_review`, `submitted`) | ✖ raw slugs | ✖ raw slugs (prior review: vendor-language table) |
| **KPI surface** | ✖ hero + StatCards duplicate (admin) | ✖ hero accessory duplicates first StatCard (all dashboards) | ✖ hero + StatCards + tabs (requests); hero + StatCards (inbox) | ✖ hero + StatCards + chips (prior review 2.3) | ✔ n/a (single card) |
| **Tabs / filters** | — | ✔ tabs filter lists (allocations, inventory, POs) | ~ tabs duplicate StatCard counts | ~ chips duplicate StatCards | — |
| **Empty states** | ✔ SignInPrompt | ✔ branded EmptyState ("Nothing scanned yet") | ✔ inbox zero state | ✔ (per prior review) | ✔ |
| **Skeletons** | ✔ | ✔ hero+stats+list | ✔ stats+list | ✔ | ✔ (loading shimmer noted) |
| **Timelines** | — | ~ activity: raw slugs, +40 sign issue | ~ ladder ✔ (best in app, e-sign artifacts) but activity has mixed ordering + seconds precision | ✔ timeline w/ signature artifacts | ✔ |
| **Signature artifacts** | — | — | ✔ ladder chips + PO award block (but raw UA inline) | ✔ instrument signing | ✔ attestation |
| **Drill-in cards** | ✔ module cards + live badges (not warehouse) | ✔ StatCards drill | ✔ StatCards drill; ✖ rows = button+link nested | ~ rows tappable, buttons repeated (prior review) | ~ |
| **Date format** | `7/5/2026` | `6/5/2026` + `2026-06-10` + `24d ago` | `7/5/2026, 10:04:25 PM` + `Jul 5, 2026, 10:07 PM` | `7/5/2026` | `7/5/2026` |
| **Theme** | `intra-theme` | **separate** `mwell-intra-warehouse:theme` (does not sync) | inherits shell ✔ | ✔ | ✔ |
| **Bottom nav (mobile)** | ✔ Home + modules | ~ own nav, role-aware ✔, but "Cycle" label truncated, Events missing for ops | ✔ shell nav + module tab bar | ✔ | n/a |
| **h1 discipline** | ✔ one per page | ✖ two (sidebar brand h1) | ✔ | ✔ | ✔ |
| **Notifications bell** | ✖ disabled | ✔ live local alerts (5) | ✖ disabled (shell) | ✖ disabled | ✖ none |
| **Reset demo data** | ✖ absent (planned in account menu) | ~ present, but in nav sheet, no confirm | ✖ absent | ✖ absent | ✖ absent |
| **Long-form intake** | — | — | ✖ 4,433px monolith | ✔ 3-step stepper (house pattern) | — |
| **Wizard/see-through previews** | — | — | ✔ live ladder + sourcing + required docs (best in app) | ✔ tailored checklist preview | — |

---

## 6. Prioritized backlog

Excludes everything already planned in `UX-REVIEW-VENDOR-LEGAL.md` Part 4 (vendor ownership guard,
demo-data hygiene, status-first vendor card, sticky case-detail header, Tooltip primitive build,
legal-inbox KPI collapse, etc.) — those ship on their own track; items below assume the Tooltip
primitive from that plan exists by Batch 3.

| Rank | Item | Refs | Sev | Effort |
|---|---|---|---|---|
| 1 | Unblock procurement Legal tier (gate or tier-map fix + persona) | PR-11 | P0 | S |
| 2 | Bottom-nav clearance padding on all module scroll containers | PR-8 / Exec #3 | P1 | XS |
| 3 | Admin matrix: contain horizontal scroll inside the card | AD-1 | P1 | S |
| 4 | Decision sheet: embed request summary (total, lines, need/risk) | PR-12 | P1 | S–M |
| 5 | Typed-signature prefill arms the button; pad ≥120px | PR-15, PR-16 | P2 | XS |
| 6 | PO receive: confirm + partial quantities (stop 1-tap close) | PR-24 | P1 | M |
| 7 | Cycle counts: empty counted inputs + un-counted-rows confirm | WH-18 | P1 | S |
| 8 | Status/date/sign-convention formatters in `@intra/ui` + sweep | Exec #4, WH-3/4/5, PR-2/21/22, LG-3 | P1 | M |
| 9 | KPI-surface dedupe sweep (requests, inbox, dashboards, admin, finance) | PR-1, PR-13, WH-8, AD-2, WH-28 | P1 | M |
| 10 | Required-documents checklist reflects real attachments (missing state) | PR-19 | P1 | M |
| 11 | Receiving: scan-first layout at 390px | WH-11 | P1 | M |
| 12 | Warehouse sidebar brand h1 → div (one h1 per page) | WH-1 | P1 | XS |
| 13 | Demo persona coverage: pricing / warehouse-procurement / suppliers routes | WH-2 | P1 | XS |
| 14 | Home module badges: tier-scoped counts + warehouse badge | SH-4, SH-5 | P2 | S |
| 15 | Theme key unification (shell ↔ warehouse) | SH-8 | P2 | S |
| 16 | Self-approval banner in decision sheet | PR-17 | P2 | XS |
| 17 | Vendor accreditation: human labels + case link from procurement | PR-26 | P2 | S |
| 18 | Reset demo data: confirm + toast + move to account menu (all modules) | WH-6, SH-9 | P2 | S |
| 19 | Row-as-target sweep (POs, storage, locations, request rows, inbox rows) | WH-21/27, PR-3/14 | P2 | M |
| 20 | Request wizard → 3-step stepper (port legal pattern) | PR-7, PR-10 | P1 | L |
| 21 | Request detail meta grid → one meta line + (i) | PR-20 | P2 | S |
| 22 | UA string behind "Signature evidence" disclosure | PR-25 | P2 | XS |
| 23 | Draft-PO Receive hidden; human PO numbers in warehouse | WH-25, WH-26 | P2 | S |
| 24 | Ops/marketing bottom nav gets Events; "Cycle" → "Counts" | WH-15 | P2 | XS |
| 25 | Bell strategy: one behaviour across shell + modules | SH-7 | P2 | S |
| 26 | Memory-mode role resolution unified (session vs profile) | PR-30 | P2 | S |
| 27 | Tooltip adoption sweep per §4 inventory | §4 | P2 | S |
| 28 | Copy polish batch (labels, casing, icons, spacing bugs) | SH-1/2/6, PR-4/6/18/23/27/28/29, WH-13/16/17/19/20/22/23, AD-3/4/5, WH-29, LG-1/2 | P3 | S |
| 29 | PO/receipt events post back to request activity; requester signal | J2-6 | P2 | S |
| 30 | Procurement PO ↔ warehouse receiving integration (single PO source) | J1-6 | P2 | XL |

**Suggested batches:**
- **Batch A — unblock & safety (1–7):** the journey-breaking and money-risk items; everything ≤ M.
- **Batch B — vocabulary & hierarchy (8–13, 20–22):** formatters, KPI dedupe, wizard stepper —
  the visible quality jump.
- **Batch C — consistency & polish (14–19, 23–29):** navigation, badges, row-as-target, copy batch.
- **Batch D — architecture (30):** unify the PO pipeline across modules; schedule with the
  Supabase cutover since it touches both data stores.

---

## Appendix — what is genuinely good (do not regress)

- **Allocation Return/Issue sheet** (warehouse): clamped stepper, disposition select, sticky-visible 44px CTA — the reference bottom sheet.
- **Cycle-count toolkit**: blind count, variances-only, per-bin scoping, sticky submit.
- **Serialized receiving adaptation** and photo-evidence capture with inline viewfinder + manual fallback.
- **Live approval-ladder preview + sourcing auto-suggestion + required-docs preview** in the request wizard.
- **"Waiting on you / In flight (other tiers) / Recently decided"** partition of the approval inbox.
- **E-signature artifacts** on ladder steps, PO awards, and legal instruments, with RA 8792 language.
- **Accreditation gate visible at PO award time.**
- **Role-adaptive dashboards and bottom navs** in warehouse.
- **Branded empty/denied/skeleton states** on every route checked — no blank screens anywhere.
- **Legal 3-step invite wizard** — the intake pattern the rest of the app should copy.

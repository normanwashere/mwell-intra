# Mwell Intra Standalone Handbook: Tabbed Experience Design

**Status:** Proposed for implementation
**Date:** August 22, 2026
**Applies to:** `docs/manual/index.html` and `scripts/docs/build-app-documentation.mjs`

## Objective

Restructure the standalone Mwell Intra handbook into an audience-aware, searchable, collapsible, and flow-first reference that remains usable offline. Users must be able to identify the correct section, understand a process, and reach a specific instruction without reading an unrelated document or losing their place.

The handbook remains one self-contained HTML file generated from maintained source documents. It does not depend on the application runtime, a server, or external JavaScript and stylesheet requests.

## Experience principles

1. **Choose an audience before choosing a document.** The primary navigation describes what users need to understand, not how source files are stored.
2. **Show the flow before the prose.** Workflow articles begin with an overview diagram and completion criteria.
3. **Reveal detail progressively.** Summaries remain visible while procedures, exceptions, controls, and technical detail can be collapsed.
4. **Preserve context.** Tabs, searches, expanded sections, selected articles, and scroll position survive navigation and refresh where browser storage permits.
5. **Make every state linkable.** A copied URL or file hash restores the selected tab, article, and heading.
6. **Keep search forgiving and explainable.** Search handles titles, headings, body text, roles, routes, modules, policies, and source filenames and shows why a result matched.
7. **Treat mobile as a reading and field-reference surface.** Controls stay reachable, diagrams can be panned or fitted, and navigation never covers content.
8. **Keep governance visible without making it dominant.** Source ownership, revision, and checksum remain available in article metadata rather than competing with instructions.

## Information architecture

The handbook has seven top-level tabs. A source document has one primary tab and may appear as a related result in other tabs without duplicating its rendered article.

### 1. Start Here

- Handbook orientation
- Mwell Intra product and module map
- Audience shortcuts: employee, operator, approver, trainer, developer, infrastructure, security, auditor
- Frequently used workflows
- How to search, navigate, print, and share a section
- Current release identity and handbook coverage

### 2. Workflows

- Procurement-to-payment
- Vendor accreditation and renewal
- Warehouse receiving, inspection, and putaway
- Ecommerce order intake, picking, packing, dispatch, and delivery
- Returns, replacement, refund, and supplier RMA
- Inventory release and allocation
- Event custody and reconciliation
- Inventory integrity, replenishment, and Finance close
- Import templates used by the workflows

### 3. Roles & Training

- Role catalogue and module access
- Responsibilities, authority, prohibited actions, and handoffs
- First-login onboarding
- Role-specific guided simulations
- Happy path, correction path, denial check, and recovery path
- Trainer materials and completion evidence

### 4. Architecture

- System context diagram
- Next.js shell and module boundaries
- Supabase Auth and authorization resolution
- PostgreSQL schemas, RLS, functions, and audit records
- Integration and event/data movement
- Warehouse ERD and data dictionary
- Requirements traceability

### 5. Infrastructure

- UAT and production topology
- Vercel projects, aliases, environments, and deployment flow
- Supabase projects and connection model
- Environment variables and secret ownership
- Email delivery dependencies
- Observability, backup, restore, business continuity, and incident response
- Migration, cutover, rollback, and hypercare

### 6. Security & Governance

- Authentication and session controls
- RBAC, RLS, least privilege, and separation of duties
- Auditability and evidence retention
- Privacy and data retention
- Department DOA administration
- Procurement policy controls
- Vendor accreditation evidence and MNDA requirements
- Reference ownership, revision, suspension, and supersession

### 7. Release & QA

- UAT and issue-management procedure
- Live certification design
- Functional, negative, edge-case, regression, visual, and accessibility coverage
- Release evidence and known limitations
- Release notes
- Documentation synchronization and artifact checks

## Governing procurement source and alignment

The handbook must include a maintained operating extract of the following supplied source:

- `MPIC Procurement Policy February2025.docx`
- Supplied location: `Downloads/MWELL PROCUREMENT POLICY/MPIC Procurement Policy February2025.docx`
- Source organization: Metro Pacific Investments Corporation (MPIC)
- Source period: February 2025

The binary original remains the authoritative supplied artifact. The handbook extract must identify the exact filename, distinguish direct policy requirements from Mwell implementation mappings, and link every mapped control to the relevant workflow stage. It must not silently replace MPIC roles such as HR Admin, HR Head, Group Controller, or CFO with Mwell roles without an approved ownership mapping.

### Policy relationship

The existing Mwell procurement document states that it draws from the MPIC policy but currently combines solicitation type and bidding tier. The February 2025 MPIC policy instead distinguishes the type of requirement:

- Services use a Request for Proposal.
- Materials use a Request for Quotation.
- Competitive bidding is the default procurement mode for both goods and services.
- Amount, complexity, technical risk, strategic importance, and data sensitivity determine approval, control depth, evaluation, and timing; they do not by themselves convert a material requirement into a service RFP.

The implementation must therefore use three independent policy dimensions:

| Dimension | Values | Primary decision basis |
|---|---|---|
| Solicitation document | RFQ, RFP, or none for an approved exception | Materials versus services and the information needed from vendors |
| Procurement mode | Competitive bidding, sole sourcing, repeat order, emergency purchase, petty cash, or other approved exception | Default competition or documented policy exception |
| Governance tier | Standard, formal bid, high-risk/special control, and current DOA route | Amount, risk, complexity, data sensitivity, category, and effective DOA |

The existing PHP 1,000,000 rule remains relevant to formal-bid governance under the Mwell operating policy, but it must no longer be the sole switch between RFQ and RFP. A high-value material purchase can use an RFQ under formal competitive-bid controls. A low-value service requirement still uses an RFP, scaled to the service's risk and complexity.

### Source precedence and activation

1. The supplied MPIC policy is recorded as a parent governance source.
2. The approved Mwell procurement policy is the local operating policy.
3. The active department DOA controls approval authority and must remain effective-dated and editable by authorized Admin or Legal users.
4. Where the parent and local policy differ, the system must show the conflict and require a versioned policy-owner decision. It must not resolve the conflict through an undocumented code constant.
5. Numeric limits and named MPIC approvers are not copied into live Mwell authority unless activated in the effective policy profile.
6. The handbook shows which rules are active, inherited, locally adapted, or awaiting formal owner confirmation.

### MPIC controls to represent

| Control area | February 2025 source requirement | Required Mwell representation |
|---|---|---|
| Requisition | Goods and services begin with an approved requirement and budget | Structured request, budget evidence, cost center, requester, specification/scope, acceptance criteria, and required date |
| RFP | Services use an RFP after budget approval | Service requests default to RFP unless a governed exception is approved |
| RFQ | Materials use an RFQ with complete description, quantity, UOM, delivery, payment, shipping, validity, deadline, and attachments | Material requests default to RFQ and require the policy fields before issue |
| Vendor communication | Vendors receive equal information and clarifications | Versioned solicitation package, common clarification log, recipient and timestamp evidence |
| Vendor eligibility | Purchases and competitive invitations use accredited vendors | Current accreditation or approved scoped temporary clearance before invitation, award, and PO issue |
| Competition | Select three to four accredited vendors | Invitation target of three to four; identities and delivery status retained |
| Bid window | Standard response window is at least seven working days; extension is no more than seven days and all invitees are notified | Business-day deadline validation, controlled extension, and equal-notice evidence |
| Vendor response | RFQ receipt confirmation within 24 hours and clarification exceptions within 48 hours | Acknowledgment and clarification timestamps with overdue indicators |
| Bid opening | Sealed bids require at least three competitive quotations before opening | Opening blocker unless three usable responses exist or an approved insufficient-bids path applies |
| Failed bid | Fewer than three quotations, non-compliant submission, all technically non-compliant, or implausible pricing may trigger failed bidding | Explicit failed-bid state with reason, extension/requote path, or approved evaluation-with-fewer-than-three exception |
| Tabulation | HR Admin tabulates bids within 48 hours | Procurement-owned comparison record and SLA timer |
| Technical evaluation | Requester returns technical comments within five working days | Assigned technical reviewer, due date, score/evidence, comments, and escalation |
| Best value | Technical compliance, quality, lead time, total cost, warranty, support, price, payment, and training are considered | Configurable technical/commercial matrix; lowest price cannot be treated automatically as best bid |
| Differing recommendation | Requester departure from the procurement evaluation needs written justification and Department Head approval, followed by Controller decision | Recorded variance rationale and independent approval path |
| Repeat order | Same price, terms, vendor, and considerations; prior abstract no older than one year; original route competitively bid; amount no more than PHP 250,000 | Eligibility checks against the prior sourcing record and an effective policy parameter |
| Emergency | Life, safety, environment, or serious operational disruption; verbal commitment minimized; PO documented as soon as possible | Emergency basis, authority, time-limited commitment, retrospective PO deadline, and audit trail |
| Sole source | Only acceptable source, compatibility, specialization, capability, manufacturer, or authorized distributor | Evidence-backed sole-source basis, price reasonableness, Procurement review, and DOA approval |
| Petty cash | Competitive bidding exception at PHP 2,000 and below under the source policy | Finance eligibility, non-split/non-recurring attestation, receipt/liquidation evidence, and effective policy parameter |
| PO | Accredited vendor, approved PO, supporting bid tabulation, quote, RFQ/RFP, and approved requisition | Commitment blocker until the complete pack and approvals are present |
| PO acknowledgment | Vendor acknowledges the PO within 48 hours | Delivery state and overdue escalation |
| PO monitoring | Outstanding POs reviewed weekly, including partial/late delivery and missing/unposted receiving reports | Weekly exception queue, owner, due date, and notification evidence |
| Quality/warranty | Non-conforming deliveries are rejected/replaced; warranty issues use merchandise-return notice | Receipt/QC exception, vendor notice, replacement/RMA, payment-hold linkage, and closure |
| Vendor accreditation | Commercial/financial and technical review, documented inspection, certification, rejection notice, and supplier-set update | Legal/VMO case, technical reviewer, decision evidence, effective dates, and procurement eligibility projection |
| Vendor probation | Six-month probation with delivery, quality, document-timeliness, and PO-win measures | Effective policy profile, scorecard, review date, pass/revoke decision, and notice |
| Samples | Samples are accepted only for a real need; requested test samples are purchased under a PO | Sample request, test purpose, custody, evaluation, and PO link where Mwell requested the sample |
| Payment support | Itemized legible invoice/receipt; PO for invoices at or above PHP 50,000 under the source policy; invoice reconciles with PO; tax and foreign-vendor evidence where applicable | Three-way evidence checks, active threshold parameter, discrepancy queue, and Finance decision |

All monetary values above are exact source-policy values and must be labeled as such until an authorized Mwell policy profile activates or overrides them.

### Required procurement workflow

The handbook and application must present this flow in the same order:

1. Requester records need, category, goods/services classification, scope/specification, budget, cost center, required date, and acceptance criteria.
2. Procurement confirms the solicitation document, procurement mode, governance tier, invited-vendor target, and reasons.
3. The system validates the active policy profile, DOA, accreditation requirement, special-risk controls, and complete source package.
4. Procurement issues one versioned solicitation package to accredited vendors and records acknowledgments, clarifications, deadlines, and equal notices.
5. The system evaluates response quorum and routes a failed bid, extension/requote, or controlled insufficient-bids exception when required.
6. Procurement records commercial tabulation; the requester or technical reviewer records technical evaluation.
7. The system calculates no automatic winner. Procurement records the best-value recommendation and supporting rationale.
8. Any recommendation variance follows the independent justification and approval path.
9. Current Mwell DOA and separation-of-duty controls approve the award.
10. Procurement creates the PO or agreement only after vendor, sourcing, approval, and protection controls pass.
11. The vendor acknowledges the commitment; outstanding delivery and acceptance obligations enter monitored queues.
12. Warehouse or the service owner records receipt and acceptance. Quality issues route to rejection, replacement, warranty, or RMA.
13. Procurement prepares the payment-readiness pack; Finance validates invoice, PO/agreement, receipt/acceptance, tax, and variance evidence.
14. The procurement file closes only after payment readiness, delivery closure, open-issue resolution, and retained evidence are complete.

### Current implementation gaps

The implementation plan must remediate these discovered mismatches:

| Severity | Current behavior | Required correction |
|---|---|---|
| P0 | `RFP_THRESHOLD` changes both goods and services to RFP at PHP 1,000,000 | Separate solicitation document, procurement mode, and governance tier |
| P0 | Risk flags force all affected requests to RFP, including materials | Keep material RFQ where appropriate while adding formal/high-risk controls |
| P0 | Evaluation UI says policy has no fixed quote count | Show the three-to-four invite target and three-response sealed-bid rule with the failed-bid/exception path |
| P0 | Database route enforcement repeats the amount-based RFQ/RFP switch | Add effective-dated policy configuration and server-side validation for the separated model |
| P1 | Required documents vary mainly by RFQ/RFP and omit several MPIC package elements | Require requisition, solicitation, quotes/proposals, tabulation, technical evaluation, variance justification, accreditation, and award evidence as applicable |
| P1 | Timelines are guidance rather than governed event deadlines | Record and monitor acknowledgment, clarification, bid window, tabulation, technical evaluation, PO acknowledgment, and weekly review SLAs |
| P1 | Repeat, emergency, petty-cash, and sole-source controls do not validate every source condition | Add parameterized eligibility and evidence checks |
| P1 | Vendor probation and source-policy performance measures are absent from the procurement eligibility flow | Add policy-profiled probation and performance review state |
| P1 | Payment readiness does not visibly explain the source-policy invoice/PO/tax support rules | Add explicit evidence mapping and effective threshold display |

### Procurement alignment tests

At minimum, certification covers:

1. Low-value material RFQ under standard governance.
2. High-value material RFQ under formal bidding and DOA controls.
3. Low-value service RFP.
4. Complex, high-risk, or data-sensitive service RFP with additional controls.
5. Three to four accredited invitees and at least three usable sealed-bid responses.
6. Fewer than three responses causing failed bid and blocked opening.
7. Approved insufficient-bids justification with retained evidence.
8. Equal clarification and deadline-extension notice to all invitees.
9. Tabulation and technical-evaluation SLA success and overdue escalation.
10. Best-value award and requester recommendation variance.
11. Valid and invalid sole-source paths.
12. Eligible and ineligible repeat orders, including age, amount, and changed-term failures.
13. Valid emergency purchase and missing retrospective PO.
14. Valid petty cash and rejected split, recurring, or over-limit use.
15. Accredited, provisional, expired, suspended, and temporarily cleared vendors.
16. PO package, acknowledgment, partial delivery, late delivery, and missing receiving report.
17. Quality rejection, warranty replacement, and vendor notice.
18. Payment pack below and above the active PO-support threshold, invoice mismatch, and foreign-vendor tax evidence.

## Desktop layout

The desktop layout uses four stable regions:

1. **Global header:** brand, global search, theme, and print.
2. **Primary tab rail:** seven top-level tabs below the header. It remains visible while scrolling.
3. **Tab contents rail:** article groups and documents for the active tab, with collapsible groups and result counts.
4. **Reading canvas:** article content with an optional right-side table of contents and related material rail on wide screens.

The reading canvas uses a maximum readable line length. Diagrams and tables may expand beyond the prose width inside their own controlled viewport. Content must not create page-level horizontal scrolling.

## Mobile layout

- The global header uses a compact search button and a clearly labeled contents button.
- The top-level tabs become a horizontally scrollable, sticky tab strip with the active tab kept in view.
- A tab switch does not return the reader to the handbook top. It restores the last article and scroll position used in that tab.
- Tab contents open in a full-height drawer with a visible close control, current-tab label, search result count, and grouped article links.
- “On this page” becomes a collapsible control immediately below the article header.
- Diagram controls provide **Fit**, **100%**, zoom out, and zoom in. The diagram viewport pans independently.
- Touch targets are at least 44 by 44 CSS pixels and remain separated from browser edges and other actions.

## Navigation behavior

### Tab navigation

- Tabs use the ARIA tabs pattern with arrow-key navigation, `Home`, and `End` support.
- Selecting a tab filters the contents rail and reading canvas to that information domain.
- The active tab, article, and heading are represented in the hash using a stable format such as `#tab=architecture&article=technical-and-functional-specification&section=runtime-architecture`.
- Browser Back and Forward restore prior handbook states without a full reload.
- The handbook records the last article and scroll position independently for every tab.

### Article navigation

- Selecting an article updates the reading canvas in place and focuses the article heading.
- The left rail highlights the current article.
- The right rail highlights the current heading using an intersection observer.
- Previous and next article controls are based on the active tab's reading order.
- Related articles are shown by purpose, not only by shared category.

### Collapsible content

- Article-level sections can be expanded and collapsed using accessible disclosure controls.
- Flow overview, completion criteria, and first required action remain expanded by default.
- Detailed controls, exceptions, field dictionaries, technical notes, and reference extracts may default to collapsed.
- “Expand all” and “Collapse details” operate only within the current article.
- Search temporarily opens matching collapsed sections and marks them as search-expanded. Clearing search returns them to their prior state.
- Disclosure state is saved per article in local storage.

## Search design

### Search modes

The search control supports two scopes:

- **Current tab:** default; searches the active information domain.
- **Entire handbook:** searches all seven tabs.

The scope is always visible and can be changed without clearing the query.

### Searchable fields

- Article title and summary
- Section headings
- Body text
- Role and department names
- Module and route names
- Workflow names and statuses
- Governing document names
- Source filenames and controlled terms

### Results

- Results appear in a dedicated panel rather than hiding unrelated articles in the full reading canvas.
- Each result shows tab, title, matching heading, a short highlighted excerpt, and content type.
- Results are keyboard navigable and announce the result count.
- Selecting a result activates the correct tab, opens the article and disclosure, scrolls to the matching heading, and highlights the matching text briefly.
- An empty result state suggests removing filters, searching the entire handbook, or using a related controlled term.
- Search query and scope are encoded in the hash so a result view can be shared.

## Workflow presentation

Every implemented workflow uses a consistent page pattern:

1. **Workflow title and outcome**
2. **Overview diagram**
3. **Completion criteria**
4. **Roles and authority**
5. **Step-by-step execution with current application screenshots**
6. **Decision and exception paths**
7. **System handoffs and persisted state**
8. **Required evidence and controls**
9. **Recovery and escalation**
10. **Governing references and related procedures**

### Diagram hierarchy

Complex workflows provide three views:

- **Overview:** a short end-to-end path with major handoffs.
- **Role view:** swimlane-style subgraphs grouped by role or department.
- **Decision view:** detailed branches, rejection states, retries, and terminal outcomes.

Only one view is shown at a time. The selected view is retained for that workflow.

### Diagram visual language

- Rounded rectangles: user or system actions
- Diamonds: decisions with labeled outgoing branches
- Capsules: start and terminal states
- Document shapes or clearly labeled nodes: evidence and governed records
- Dashed connectors: asynchronous notifications or external handoffs
- Solid connectors: required sequence
- Consistent colors distinguish user action, system action, approval, exception, and completion

Diagrams must not rely on color alone. Labels and shapes carry the same meaning in print and dark mode.

## Content model and generator changes

The generator gains an explicit metadata registry rather than inferring the complete experience from filenames. Each source declares:

- stable ID
- title
- primary tab
- related tabs
- content type
- audience
- summary
- keywords
- sort order
- collapsible-section policy
- related sources

The registry is validated during generation. Unknown documents may fall back to Release & QA but cause a warning so new content is deliberately classified.

The generated HTML embeds:

- the metadata index
- normalized source text
- screenshots as data URLs
- the Mermaid runtime
- search and navigation code
- presentation styles

No external request is required to read or interact with the handbook.

## Visual direction

The handbook uses a quiet technical-operations aesthetic derived from Mwell rather than a generic documentation template:

- **Mwell navy:** `#10233F` for hierarchy and navigation
- **Mwell blue:** `#0875BD` for active navigation and links
- **Signal cyan:** `#27B7E7` for flow and system emphasis
- **Control green:** `#16866D` for validated completion and controls
- **Exception red:** `#C2394B` for blocked and exception states
- **Canvas:** `#F4F8FC` and white for reading surfaces

Typography remains locally available and offline-safe. Display headings use a strong geometric system face; body copy prioritizes legibility; source IDs, routes, and field names use a monospace utility stack.

The distinctive element is the **process ribbon**: a compact horizontal sequence directly below a workflow title that shows the major lifecycle stages and follows the reader's selected diagram view. It provides orientation without duplicating the complete diagram.

## Accessibility

- WCAG 2.2 AA color contrast
- Semantic landmarks, headings, tables, figures, and captions
- Correct ARIA tab and disclosure patterns
- Visible keyboard focus
- Search and result-count announcements through a polite live region
- No keyboard traps in drawers, diagrams, or search results
- Reduced-motion support
- Diagram text remains selectable and zoomable
- Printed diagrams retain labels and decision meaning without color

## State and recovery

The handbook must restore:

- active tab
- current article and heading
- search query and scope
- expanded sections
- selected diagram view and zoom level
- per-tab scroll position
- theme preference

Invalid or outdated hashes fall back to Start Here and show a non-blocking message with a route to search. No interaction triggers a full-page reload.

## Print and export

- Printing the current article prints only the article, its expanded workflow views, and source metadata.
- “Print tab” prints the active tab in defined reading order.
- “Print complete handbook” remains available but is a secondary action.
- Navigation, drawers, search results, and interactive controls are removed from print.
- Collapsed sections required for the selected print scope are expanded in the print layout without changing the on-screen state.

## Testing and acceptance criteria

### Functional

- All seven tabs can be selected by mouse, touch, keyboard, hash, Back, and Forward.
- Every maintained source is classified and reachable.
- Search returns the correct tab, article, heading, and excerpt.
- Clearing search restores disclosure state.
- Collapse, expand-all, related links, previous/next, and print scopes work without reload.
- State restoration works after refresh and tab switching.

### Visual and responsive

- Test at 1440, 1280, 1024, 768, 430, 390, 360, and 320 CSS pixels.
- No page-level horizontal overflow.
- No overlapping sticky regions, drawers, tabs, search controls, diagrams, tables, or text.
- Active navigation remains visible at every viewport.
- Diagrams have readable default framing and independent pan/zoom.
- Light, dark, and print presentations are reviewed using screenshots.

### Accessibility

- Automated accessibility scan has no critical or serious violations.
- Complete keyboard-only journey covers tabs, contents, search, results, disclosures, diagram view controls, and print.
- Screen-reader labels and result announcements are verified.

### Content integrity

- Six or more maintained Mermaid diagrams render without errors.
- No Mermaid source fence is shown to readers.
- All screenshots resolve to embedded data URLs and have useful alternative text.
- Governing references retain exact source filenames, ownership, and revision guidance.
- The generated HTML is byte-stable across Windows and Linux.
- Release documentation and launch-artifact verification pass.

## Delivery boundaries

This change reorganizes and improves the existing maintained content. It does not invent unimplemented application functions, duplicate source documents, or turn historical audit material into current operating instructions. Historical evidence remains in Release & QA and is visibly labeled as evidence.

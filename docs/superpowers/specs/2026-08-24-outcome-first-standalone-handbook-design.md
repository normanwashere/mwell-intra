# Outcome-First Standalone Handbook Design

**Status:** Proposed for implementation  
**Date:** August 24, 2026  
**Applies to:** `docs/manual/index.html` and its source-controlled generator, catalog, runtime, styles, and validation suite

## Purpose

Rebuild the standalone Mwell Intra handbook as an outcome-first help center. A first-time employee must be able to find the task they need, confirm who performs each step, follow the actual application screens, understand every decision and exception, and identify completion evidence without interpreting source-document structure or release metadata.

The handbook remains one searchable, printable, offline-capable HTML file generated from maintained source documents. It remains a standalone handover artifact and does not depend on the application runtime, the in-app Knowledge Base, an external content service, or a network connection.

## Audit Findings

The current handbook is comprehensive but presents its internal documentation model to the reader:

1. The first screen emphasizes maintained-source counts and article filenames rather than common user outcomes.
2. Seven top-level tabs mix operating guidance, training, architecture, infrastructure, security, release evidence, and QA.
3. The primary manual duplicates workflow content also found in the process reference library and role/training sources.
4. Desktop uses four persistent regions: global controls, a tab rail, a document rail, the reading canvas, and an additional page outline. These regions compete for attention and reduce the useful reading width.
5. Mobile places four utility controls, search scope, a horizontal seven-tab strip, source paths, checksums, and expand/collapse controls before the first task instruction.
6. Search results identify source documents rather than direct answers, steps, roles, application routes, or decision points.
7. Screenshots are separated from the instructions they are intended to explain and do not consistently identify the exact interaction target.
8. Checksums, commit identities, environment baselines, and release authority are necessary controls but currently dominate user-facing guidance.
9. Stale environment or certification text can remain visible inside a source article after the generated release evidence has advanced.
10. The maintained-source count and catalog records can diverge because unknown sources silently fall back to Release evidence instead of failing classification.
11. Role labels differ between the responsibility matrix, role procedures, application personas, and capability names, making it unclear whether two labels describe one assignment or separate roles.

## Design Principles

1. **Begin with intent.** The first question is “What do you need to do?”
2. **Show work, not documents.** Navigation uses tasks, roles, and system responsibilities rather than source filenames.
3. **Flow before detail.** A task opens with its end-to-end flow and completion state.
4. **One decision at a time.** Each procedure step shows only the instruction, screen, decision, evidence, and handoff relevant to that stage.
5. **Progressive disclosure.** Policy basis, source lineage, checksums, release identity, and technical detail remain available but collapsed by default.
6. **Actual screens are evidence.** Screenshots must come from the certified application and must identify the control or region used in the accompanying step.
7. **Preserve reader context.** Selected mode, item, subsection, disclosure state, search, and reading position survive navigation and refresh.
8. **One canonical explanation.** A workflow or role procedure has one primary rendered guide. Related source material links to it instead of reproducing it.
9. **Plain language first.** Acronyms and policy terms are expanded at first use and remain searchable as synonyms.

## Information Architecture

The handbook has four primary modes.

### Home

Home is a task-discovery surface, not an article list. Its first viewport contains:

- A single global search field labelled “What do you need help with?”
- A “Start a task” section containing the most common implemented outcomes
- A “Learn my role” role selector
- A “Manage or support Mwell Intra” entry for administrators, trainers, developers, infrastructure, security, audit, and release users
- Recently viewed items when local storage is available

Home does not display source counts, filenames, hashes, commit IDs, or document ownership.

### Tasks

Tasks contain implemented end-to-end operational journeys. Initial primary task guides are:

1. Create and approve a procurement request
2. Accredit or renew a vendor
3. Create warehouse locations and bins
4. Receive, inspect, and put away stock
5. Import or create ecommerce orders
6. Pick, pack, dispatch, and confirm delivery
7. Process a return, replacement, refund, or supplier RMA
8. Request and release department inventory
9. Transfer, use, return, and reconcile event stock
10. Count inventory and resolve a variance
11. Configure and activate a department DOA matrix
12. Review cross-module Finance readiness and evidence
13. Submit and decide Product readiness, pricing, and go-live

Each task guide is a first-class catalog entity and may reference one or more maintained source documents.

Task guides use verb-first titles and structured records with these required fields: stable ID, outcome, summary, participating roles, module, start condition, required access, inputs and evidence, ordered steps, decision points, denial checks, recovery, handoff, completion criteria, completion evidence, governing sources, related tasks, keywords, owner, effective date, last reviewed date, applicable build, and status.

### Roles

Roles explain the exact available UAT/business personas and their effective capabilities. Each role guide includes:

- Purpose and department
- Modules and landing routes
- Work the role may perform
- Decisions the role may make
- Actions the role must not perform
- Inputs received from other roles
- Outputs and next-role handoffs
- Daily or recurring queues
- Guided practice scenario
- Negative and recovery scenario
- Completion evidence
- Escalation path
- Related tasks

Role names must match the current role catalog and application UI. Technical capability codes may appear only in the collapsed control details.

Role guides use structured records with these required fields: stable ID, canonical name, displayed aliases, purpose, department and scope, assignment owner, required access, work queue or start conditions, linked tasks, permitted actions, prohibited actions, authority limits, handoffs, denial checks, escalation and recovery, evidence responsibilities, training readiness, governing sources, owner, effective date, last reviewed date, applicable build, and status.

### System

System contains specialist material grouped by audience, not as equal-weight global tabs:

- Administration and configuration
- Training and operational readiness
- Architecture and data design
- Infrastructure and continuity
- Security, privacy, governance, and retention
- Release, QA, traceability, and evidence
- Governed reference documents and source register

System content is fully searchable but does not appear in ordinary task browsing unless it is directly relevant.

## Task Guide Contract

Every task guide renders sections in this order:

1. **Outcome:** One sentence describing what is complete when the task finishes.
2. **Flow:** The complete overview flowchart, including decision nodes and terminal outcomes.
3. **Who is involved:** The initiating role, every handoff role, and the accountable closer.
4. **Before you start:** Required access, data, records, documents, stock, and dependencies.
5. **Steps:** Numbered stages. Each stage includes:
   - role performing the action;
   - application module and route;
   - plain-language instruction;
   - actual certified application screenshot;
   - numbered or visually highlighted interaction target;
   - expected visible result;
   - data written or read;
   - evidence retained;
   - next handoff.
6. **Decisions and exceptions:** Decision trees for validation failures, rejection, correction, cancellation, expiry, insufficient evidence, duplicate submission, stale data, least-privilege denial, partial completion, and recovery.
7. **Completion checklist:** Observable application state, retained evidence, downstream owner, and prohibited unfinished states.
8. **Related tasks:** Only direct prerequisites, continuations, or recovery guides.
9. **Why this rule exists:** Collapsed policy and control mapping.
10. **Document controls:** Collapsed source filename, owner, version, checksum, release identity, and review date.

Screenshots that do not identify the relevant target or state are not accepted as procedural evidence. Generic full-page screenshots may be used only for orientation.

## Role Guide Contract

Every role guide renders sections in this order:

1. Role purpose and department
2. “Your workspace” module and route map
3. Work queue and priorities
4. Permitted actions
5. Decisions and approval authority
6. Prohibited actions and separation-of-duty boundaries
7. Handoffs received and sent
8. Guided simulation with direct task links
9. Negative and recovery scenario
10. Escalation and support
11. Completion evidence and training sign-off
12. Collapsed capability codes and document controls

## Desktop Experience

Desktop uses no more than three stable regions:

1. **Header:** Mwell Intra handbook brand, global search, current mode, theme, and overflow actions for print and document controls.
2. **Navigation rail:** One contextual rail showing Home, Tasks, Roles, and System plus the current mode’s groups. It can collapse to preserve reading width.
3. **Reading canvas:** The active home, task, role, or system guide. “On this page” is a collapsible drawer or compact sticky control, never a fourth permanent column.

The reading canvas uses a readable prose width. Flowcharts and tables may expand inside their own bounded viewport. The current task, role, stage, and completion state remain visible without repeating source metadata.

## Mobile Experience

Mobile prioritizes field use:

- The first row contains the Mwell brand, search, and one menu button.
- Home immediately shows task search and common tasks.
- Primary modes appear inside the menu rather than a seven-item horizontal tab strip.
- A task guide shows its outcome and flow before metadata or document controls.
- “Steps” and “In this guide” use reachable sticky controls that do not cover content.
- Each screenshot can open full-screen and its callout remains legible at 320 CSS pixels.
- Previous/next stage controls are explicit and maintain the reader’s position.
- Utility actions such as theme and print move into an overflow menu.
- No file path, checksum, commit ID, or source count appears before the procedure.
- At 320 by 720 CSS pixels, persistent handbook chrome consumes no more than 180 pixels before the active task, result, or first action begins.

## Search and Discovery

Global search indexes tasks, role names, modules, routes, actions, statuses, errors, decisions, acronyms, synonyms, policy terms, and source titles.

Search results display:

- direct answer title;
- result type: Task, Step, Decision, Role, Troubleshooting, or System reference;
- applicable role and module;
- short action-oriented excerpt;
- why the result matched;
- direct link to the exact stage or heading.

The default scope is all user-facing tasks and roles. System references are included when the query is technical, governance-oriented, or explicitly filtered. Searches such as `receive stock`, `pick and pack`, `invalid login`, `access denied`, `vendor renewal`, `DOA`, `RFQ`, `refund`, `lost event stock`, and `cycle count variance` must return an actionable result in the first three items.

Operational tasks and troubleshooting always rank above release notes, audit evidence, schemas, and raw source files for ordinary user queries. Near-identical matches are deduplicated. Empty results suggest controlled synonyms, common tasks, and the System filter instead of leaving a blank result panel.

## State and Linking

The URL hash represents the selected mode, guide, view, and heading using stable semantic identifiers. Existing `tab` and `article` links are translated to the nearest canonical destination and show a non-blocking notice when a legacy source has moved.

Browser Back and Forward restore the previous handbook state. Refresh restores the selected guide and heading and must not return the reader to Home or the top of the document. Local storage may restore recent items, disclosure state, and reading position, but a copied URL remains sufficient to reproduce the selected guide without storage.

## Source and Release Controls

Maintained Markdown, CSV, and reference extracts remain the authoritative source set. The generator separates source provenance from presentation:

- One source may contribute to multiple task or role guide sections.
- A guide may aggregate multiple sources without duplicating rendered prose.
- Every source fragment has exactly one presentation purpose: canonical guide body, governed reference, role summary, downloadable resource, or system record.
- Canonical task steps appear only in the task guide body. Role, policy, training, and system material links to the canonical task rather than restating it.
- Source lineage remains visible under collapsed document controls.
- Release manifests and checksums are generated from the current build and cannot be copied from stale article prose.
- Environment links are explicitly labelled UAT, Production, or Reference and must not silently point to another environment.
- Superseded or pending policy text is labelled at the rule it affects.

## Accessibility and Interaction

- All functionality is available by keyboard.
- Navigation, drawers, search results, disclosures, diagrams, screenshot viewers, and stage controls expose correct names, roles, states, and focus behavior.
- Focus returns to the invoking control when a drawer, menu, or screenshot viewer closes.
- Opening a guide focuses its level-one heading. Selecting a search result, stage, or page-outline entry focuses the exact destination heading and positions it below sticky chrome.
- Touch targets are at least 44 by 44 CSS pixels.
- Text and controls meet WCAG 2.2 AA contrast requirements.
- Reduced-motion preferences disable non-essential transitions.
- Flowcharts provide a text equivalent listing stages, decisions, branches, and terminal outcomes.
- Search status and no-result recovery are announced without moving focus unexpectedly.

## Technical Boundaries

The handbook remains:

- a single self-contained generated HTML file;
- offline-capable with embedded CSS, JavaScript, Mermaid, screenshots, and search index;
- free of application authentication and private live data;
- deterministic from source-controlled inputs;
- printable by current guide, current mode, or full handbook;
- compatible with the existing release-documentation verification and certification bundle.

The generator must separate these responsibilities into explicit interfaces:

1. Source catalog and provenance
2. User-facing guide catalog
3. Guide composition and rendering
4. Search indexing and ranking
5. Route/state serialization and legacy-link translation
6. Responsive presentation and interaction runtime
7. Integrity, accessibility, and release validation

The implementation uses an additive presentation model:

- `SourceMeta`: authoritative source identity, provenance, checksum, and legacy article ID
- `GuideMeta`: Home, Task, Role, or System identity and discovery metadata
- `GuideSection`: stable section ID and exact source-heading selector
- `SearchRecord`: Task, Step, Decision, Role, Troubleshooting, or System result
- `LegacyRoute`: previous tab/article/heading mapped to canonical mode/guide/heading

The source registry remains independent from user navigation. A separate guide catalog declares the four modes and canonical guides. Public generator entry points remain stable while internal responsibilities are separated into source loading, model resolution, guide composition, search indexing, and shell rendering.

## Migration

1. Repair the existing source catalog so every maintained source is explicitly classified and current baseline tests pass.
2. Introduce the additive Home/Tasks/Roles/System guide catalog without removing the source registry, renderer, Mermaid integration, image embedding, or existing runtime hooks.
3. Map existing source documents and headings to canonical task, role, and system entities using exact selectors that fail generation when missing or ambiguous.
4. Make an unclassified, missing, or duplicate source/guide mapping a build failure; remove the silent Release fallback.
5. Normalize role IDs and aliases against the current application persona and capability catalog.
6. Preserve every current article and heading through an exhaustive legacy route map.
7. Introduce canonical route state `{modeId, guideId, headingId, view, query, scope}` while continuing to parse previous tab/article/heading hashes.
8. Migrate local state from `v2` to `v3`, storing per-guide reading position, recent guides, disclosures, diagram state, theme, query, and scope. A copied URL always takes precedence over stored state.
9. Replace the document-list homepage with the outcome-first Home and three-region desktop shell.
10. Move source metadata into collapsed document controls generated from the current build.
11. Convert the primary task journeys and current role catalog into first-class guides one guide at a time.
12. Bind certified screenshots to individual procedure stages and reject unmapped evidence.
13. Upgrade search from document ranking to guide, stage, decision, role, troubleshooting, and system ranking.
14. Generalize print from article/tab/all to guide/mode/all while retaining compatibility aliases until browser coverage passes.
15. Retain System specialist content and print completeness.
16. Remove duplicate primary explanations and legacy presentation aliases only after canonical links, search coverage, accessibility, and responsive tests pass.

## Validation

### First-time usability

A representative new user must be able to locate the correct guide for each of these prompts without knowing a source filename:

1. Receive and inspect a delivery.
2. Pick and pack an ecommerce order.
3. Submit a vendor accreditation application.
4. Create a purchase request.
5. Process an unknown returned serial.
6. Resolve an inventory variance.
7. Learn what an Operations Associate may do.
8. Find the current infrastructure and recovery guidance.

The correct destination must be reachable from Home or search in no more than three deliberate interactions.

Search certification includes at least `receive stock`, `approve request`, `report damaged item`, `renew vendor`, `cycle count`, `reset password`, `three-way match`, and `DOA`. Each query separately asserts result type, title, role/module context, excerpt, ranking, direct destination, refresh restoration, and accessibility state.

### Responsive and visual

Validate at 1440, 1280, 768, 390, 360, and 320 CSS pixels. There must be no page-level horizontal overflow, overlapping sticky controls, obscured content, clipped diagrams, unreadable screenshot callouts, trapped drawers, or competing permanent navigation regions.

### Functional

- Home, Tasks, Roles, and System navigation
- Search ranking, explanation, filters, synonyms, and no-result recovery
- Task flow, stage navigation, decision views, screenshots, and completion checklists
- Role guide capability and handoff mapping
- Deep links, legacy links, Back/Forward, refresh, and per-guide position
- Collapsed policy and document controls
- Diagram fit, zoom, pan, text equivalent, and print
- Screenshot full-screen view and focus return
- Offline loading with no external requests
- Current release manifest and source-integrity verification

### Acceptance Threshold

The redesign is ready when:

1. Every implemented primary workflow has one canonical task guide.
2. Every current role has one canonical role guide.
3. Every task step identifies its role, route, action, expected result, persisted/read data, evidence, and handoff.
4. Every decision branch terminates in completion, correction, rejection, escalation, cancellation, or controlled hold.
5. Every procedural screenshot is current, mapped to a step, and visually identifies the interaction target.
6. The eight first-time usability prompts meet the three-interaction discovery limit on desktop and mobile.
7. Automated handbook, accessibility, responsive, deep-link, search, offline, print, and documentation-release tests pass.
8. No user-facing first viewport exposes source filenames, hashes, commit IDs, or release evidence unless the user entered System or opened document controls.
9. Maintained-source count, catalog classification, guide mapping, role aliases, environment labels, review dates, and generated release identity pass deterministic integrity checks.
10. Current-commit visual evidence is reviewed at every configured handbook viewport; screenshots are test evidence only when paired with assertions for hierarchy, overflow, overlap, clipping, target readability, and sticky-control coverage.

## Non-Goals

- Replacing the in-app Knowledge Base
- Adding a content-management service
- Requiring authentication to open the standalone handbook
- Embedding live production data or credentials
- Rewriting governing policy source documents
- Documenting unimplemented product features as if they are available
- Removing technical, security, infrastructure, QA, or source material from the handover artifact

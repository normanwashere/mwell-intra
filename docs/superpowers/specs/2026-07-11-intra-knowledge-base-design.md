# Mwell Intra Knowledge Base Design

## Purpose

Create a searchable, interactive, authenticated Knowledge Base inside Mwell Intra. It replaces the disconnected static manual as the primary source for product guidance while retaining version-controlled documentation artifacts for audit and offline reference.

The Knowledge Base is visible to every authenticated user. Role filters personalize discovery but do not hide departmental documentation.

## Success Criteria

- A signed-in user can reach the Knowledge Base from desktop navigation, the mobile More menu, and the command palette.
- Search returns relevant functions, workflows, roles, troubleshooting steps, policy guidance, and glossary terms.
- Every current user type has a complete flowchart with responsibilities, handoffs, database outcomes, exception paths, and completion criteria.
- Flowcharts and procedures are usable with keyboard, screen reader, desktop pointer, and mobile touch input.
- Content links users directly to relevant live Intra routes when their current account has access.
- Documentation renders without horizontal overflow at 320, 390, 768, 1280, and 1440 pixel widths.
- The Markdown manual and interactive in-app Knowledge Base remain aligned from one structured source model or a tested generated representation.

## Access Model

- Route: `/knowledge`
- Authentication: required through the existing shell session.
- Visibility: universal for authenticated users, including employee and vendor accounts.
- Authorization: documentation visibility does not grant access to linked operational routes. Existing RBAC continues to enforce live screens and actions.
- Sensitive content: no passwords, tokens, private keys, personal data, or confidential vendor documents may be embedded.

## Information Architecture

1. Start Here
2. Role Guides
3. Procurement
4. Legal and Vendor Accreditation
5. Warehouse
6. Administration and Delegation of Authority
7. End-to-End Flowcharts
8. Troubleshooting and Recovery
9. Security and Data Handling
10. Glossary
11. Future Recommended Features

## User Types Covered

The initial release covers all current production-test personas:

- Core staff
- Platform administrator
- Vendor portal user
- Warehouse logistics supervisor
- Warehouse operations
- Warehouse finance
- Warehouse BI analyst
- Warehouse business unit
- Warehouse marketing
- Warehouse procurement
- Warehouse pricing
- Warehouse administrator
- Procurement requester
- Procurement officer
- Procurement approver
- Procurement finance
- Procurement administrator
- Legal reviewer
- Legal compliance
- Legal administrator

Related Warehouse flows may share a base process, but each role retains a dedicated guide identifying its actions, decisions, data access, and handoffs.

## Content Model

Documentation is stored as typed, repository-backed data. The implementation separates content from rendering so a database-managed publishing system can replace the source later.

Each article contains:

- Stable ID and slug
- Title and short summary
- Module and category
- Applicable roles
- Search keywords and aliases
- Prerequisites
- Ordered procedure steps
- Expected system and database outcomes
- Negative paths and recovery actions
- Related live routes
- Related articles
- Policy references
- Screenshot references where useful
- Last-reviewed date and content owner

Each flow contains:

- Stable flow ID
- Participating roles and departments
- Start and completion states
- Nodes representing actions, decisions, handoffs, system operations, and terminal outcomes
- Edges with labels for conditions and exceptions
- Deep links from nodes to detailed procedures
- Database effects written as plain-language outcomes rather than implementation secrets

## Primary Experiences

### Knowledge Home

- Compact page header with global search as the primary control.
- Recent or recommended content based on the signed-in user’s roles.
- Module and role filters.
- Direct entry points for common tasks, troubleshooting, flowcharts, and glossary.
- No marketing hero or decorative dashboard cards.

### Search

- Client-side indexed search for the initial repository-backed release.
- Search title, summary, keywords, roles, module, procedure text, error phrases, and glossary aliases.
- Results grouped by article, workflow, troubleshooting, and glossary.
- Keyboard navigation, clear-result control, empty state, and query highlighting.
- Search state reflected in the URL so results can be bookmarked and shared.

### Article Reader

- Desktop: constrained reading column with sticky section navigation.
- Mobile: single-column reader with collapsible section index.
- Step lists expose prerequisites, owner, expected result, exception, and next handoff.
- Live-route links state when access depends on the user’s role.
- Related content appears after the procedure, not inside nested cards.

### Interactive Flowcharts

- Responsive HTML/CSS diagram representation; no canvas-only interaction.
- Desktop supports a two-dimensional overview with selectable nodes.
- Mobile presents the same graph as an ordered, expandable journey to preserve legibility.
- Selecting a node opens a detail panel showing owner, action, prerequisite, system outcome, exception path, and linked procedure.
- Keyboard arrow/tab navigation and visible focus are required.
- Color is supplemented by icons, labels, and node types.

## Comprehensive Process Coverage

The flow library includes:

- Sign-in, role resolution, and access recovery
- Procurement request through sourcing, approval, PO, receipt, acceptance, and payment readiness
- Vendor invitation through application, evidence, Legal review, instruments, accreditation decision, and renewal
- Warehouse setup: locations, storage areas, and bins
- Receiving through inspection, hold, putaway, inventory availability, and vendor return
- Allocation, issue, event consumption, return, and reconciliation
- Cycle count, variance review, approval, and stock adjustment
- Pricing and landed-cost review
- Warehouse exceptions, stock approvals, imports, exports, and reporting
- DOA draft, revision, activation, supersession, and approval routing
- User and role administration

Every process documents happy path, validation failures, authorization denial, missing evidence, rejected decisions, duplicate/idempotent requests, stale data, connectivity recovery, and escalation owner where applicable.

## Future Recommended Features

The roadmap section is explicitly separated from current capabilities. Initial recommendations include:

- Admin-authored article drafts, review, approval, and publishing
- Content version history and effective dates
- In-app contextual help launched from operational screens
- Search analytics and unsuccessful-query reporting
- Article feedback and correction requests
- Department content ownership and review reminders
- Policy-to-procedure traceability dashboard
- Guided interactive walkthroughs with sandbox data
- Multilingual content support
- Offline Knowledge Base precaching
- Role onboarding curricula and completion tracking
- Release-note generation linked to changed workflows

Items must be labeled proposed, planned, in progress, or released. Proposed features must never be described as currently available.

## Architecture

- Next.js route and client components live under the shell application.
- Typed Knowledge Base content lives in focused data modules rather than one large page file.
- Search index is created from the typed content at build/runtime initialization and remains client-side for this release.
- Flow rendering is a reusable component with desktop graph and mobile journey presentations.
- Existing `@intra/ui` primitives provide fields, buttons, badges, tabs, dialogs, and icons.
- Navigation integration uses the existing central navigation model and command palette.
- Existing screenshots are reused only after verifying they still match production. Outdated error screenshots are replaced.
- The Markdown manual is updated to match the in-app content and links to the live Knowledge Base.

## Error And Empty States

- No search results: show spelling/query suggestions, module filters, and a path back to all content.
- Unknown article or flow: render the normal not-found experience with links to search and Knowledge Home.
- Broken operational deep link: route authorization remains authoritative; the Knowledge Base explains that access is role-dependent.
- Missing screenshot: omit the media block rather than render a broken placeholder.
- Content validation failure during development/build: fail the verification script with the content ID and invalid field.

## Accessibility And Ergonomics

- Search receives focus when invoked from the command palette or a dedicated search action.
- Minimum 44px touch targets.
- No horizontally scrolling flowchart is required to understand a process on mobile.
- Headings follow a valid hierarchy.
- Flow nodes use buttons with descriptive accessible names.
- Search status and result count use a polite live region.
- Dialogs and detail panels use the shared adaptive dialog pattern.
- Reduced motion removes nonessential transitions.
- Text and controls meet WCAG AA contrast targets.

## Verification

### Content Validation

- Unique IDs and slugs
- Valid role/module references
- Valid internal article and flow links
- Valid operational route format
- Every role has at least one guide and one flow
- Every flow has a start, completion state, and reachable terminal path
- Future features include a lifecycle status

### Automated Tests

- Search ranking and aliases
- Role and module filters
- URL-backed query state
- Flow reachability and node-detail behavior
- Keyboard interaction
- Unknown article/flow handling
- Navigation visibility for authenticated users

### Browser Verification

- Desktop: 1440 and 1280 pixels
- Tablet: 768 pixels
- Mobile: 390, 360, and 320 pixels
- Search, filters, article navigation, flow selection, dialogs, links, focus, overflow, overlap, and empty states
- Representative checks for all 20 personas

### Production Verification

- Vercel build and deployment health
- Authenticated access to `/knowledge`
- Operational links remain RBAC-protected
- No secrets or test credentials appear in rendered content or static assets

## Migration And Maintenance

- The existing `docs/manual/MWELL_INTRA_USER_MANUAL.md` remains the printable/offline reference.
- `docs/manual/index.html` is updated or generated as a standalone interactive companion where practical.
- In-app content is the primary user-facing experience.
- Every article records owner and review date.
- A future CMS must preserve stable IDs, slugs, links, roles, and flow contracts so the renderer and search experience remain unchanged.

## Out Of Scope For Initial Release

- Public anonymous documentation
- WYSIWYG authoring
- Database-backed content publishing
- User comments or social discussion
- AI-generated answers
- Replacing existing RBAC or policy enforcement

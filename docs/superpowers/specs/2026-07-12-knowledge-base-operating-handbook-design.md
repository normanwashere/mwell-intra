# Mwell Intra Knowledge Base Operating Handbook Design

## Objective

Transform the Knowledge Base from a shallow article directory into the complete operating handbook for Mwell Intra. It must explain every available workflow, role, page, feature, control, status, validation, handoff, exception, and administrator responsibility in plain language. It serves everyday users and administrators. Technical implementation details are included only where administrators need them to configure, govern, troubleshoot, or audit the system.

## Success Criteria

- A user can enter by task, role, feature, problem, policy, or terminology.
- Every live application route and capability maps to detailed guidance.
- Every current role has an accurate operational profile; planned roles are marked `coming soon`.
- Every end-to-end process starts with an interactive flow containing its real decision branches.
- Every executable step includes an actual application screenshot with an accurate interaction hotspot.
- No process branch ends without completion, revision, rejection, cancellation, or escalation guidance.
- Desktop, tablet, and mobile presentations remain legible, reachable, and free from overlap.
- Automated validation detects undocumented features, invalid role claims, broken links, missing evidence, and dead-end decision branches.

## Audience

### Everyday users

Users need task-first instructions, role boundaries, prerequisites, screenshots, expected outcomes, status explanations, handoffs, and recovery guidance.

### Administrators

Administrators additionally need access-management guidance, DOA and department configuration, policy controls, warehouse setup, evidence rules, audit responsibilities, troubleshooting, and release-impact information.

Technical support runbooks and internal database implementation documentation remain outside the primary handbook unless the information is required for an administrator-facing diagnostic or recovery action.

## Information Architecture

### Start Here

- Role-aware orientation
- Application and module map
- Principal end-to-end operating flow
- Search and terminology guidance
- Recommended first tasks based on role

### End-to-End Flows

- Purchase request through approval, sourcing, award, PO, receipt, acceptance, and payment readiness
- Vendor invitation, application, accreditation, remediation, approval, renewal, suspension, and rejection
- Warehouse receiving, inspection, quality disposition, putaway, transfer, allocation, issue, return, reconciliation, and adjustment
- Event creation, reservation, fulfillment, return, and closure
- Inventory setup, products, locations, storage areas, bins, cycle counts, exceptions, and reporting
- User, role, department, DOA, policy, and operational-route administration

### Roles And Authority

Each current and planned role receives a consistent operational profile:

- Availability: live, limited, or coming soon
- Purpose and accountable outcomes
- Accessible modules and pages
- Granted capabilities and actions
- Approval or decision authority
- Actions the role cannot perform
- Segregation-of-duties restrictions
- Upstream inputs and downstream handoffs
- Common daily tasks
- Exceptions and escalation path
- Relevant workflows, policies, and screenshots

Current roles must be generated from or validated against the RBAC source of truth. Planned roadmap roles are clearly marked `coming soon`, describe intended responsibilities and dependencies, and never link to instructions that imply the feature is usable.

### Feature Library

Every application page and function receives a reference article covering its purpose, audience, entry points, controls, fields, validation rules, statuses, reads and writes, notifications, permissions, errors, completion criteria, and related workflows.

### Administrator Guide

- Users and role assignment
- Departments and editable DOA ladders
- Procurement thresholds and policy configuration
- Vendor and legal checklist configuration
- Warehouses, locations, storage areas, and bins
- Receiving and inspection routes
- Evidence requirements and exception handling
- Audit review and operational monitoring

### Exceptions And Troubleshooting

Guidance is organized by observable problem and includes likely cause, safe recovery, data impact, escalation owner, and actions users must not take. Empty states and search misses recommend adjacent tasks instead of ending the journey.

### Governance And Controls

Explain the procurement policy, vendor accreditation requirements, legal review, DOA, segregation of duties, required evidence, audit records, security responsibilities, and retention expectations in operational language. Source documents and policy owners are linked where applicable.

### Roadmap, Release Notes, And Glossary

The roadmap separates live, limited, and coming-soon capabilities. Release notes identify changed workflows and affected roles. The glossary defines application, procurement, legal, warehouse, finance, audit, and status terminology and links definitions back to the relevant task guidance.

## Front-End Experience

### Landing Page

The first viewport presents the principal process map, a global task-oriented search field, and role-aware recommended guides. It does not use a marketing hero. The interface feels like a focused operating workspace.

Three primary entry paths remain visible:

1. Do a task
2. Understand a role
3. Explore a feature

Search spans workflows, roles, features, controls, statuses, problems, policies, and glossary terms. Results disclose their content type, availability, relevant role, and destination context.

### Article Experience

Workflow articles use four coordinated views without leaving the article:

- Flow
- Step-by-step
- Roles involved
- Exceptions

The flow appears first. Selecting a node focuses the corresponding detailed step, responsible role, prerequisites, evidence, screenshot, and expected result. Cross-links update history state without causing a full session restoration or losing reading position.

### Decision Trees

Decision trees are functional navigation, not decorative images.

- Decisions use explicit plain-language questions.
- Branches support yes/no and named multi-route outcomes.
- Each decision identifies the responsible role and governing policy or DOA rule.
- Each branch states required evidence and status effects.
- Exception, insufficient-evidence, rejection, revision, cancellation, and escalation routes are represented.
- Branches may rejoin the principal flow at explicit merge points.
- Every terminal node declares a valid process outcome.
- The active branch and current step remain visually distinct.
- Keyboard users can traverse nodes and branches in logical order.

On mobile, large diagrams become guided branch navigation with a visible breadcrumb and backtrack control. The system does not compress a desktop flowchart into unreadable text.

### Screenshots And Hotspots

Every executable step uses an actual screenshot of the relevant application state. Screenshots must match the documented viewport and role. Numbered hotspots identify the exact control or region. Captions explain the action and expected result; screenshots do not replace written instructions.

Screenshot metadata includes route, viewport, role, theme, landmark, hotspot coordinates, capture date, and app commit. Validation rejects missing files, invalid coordinates, and hotspots outside the image.

### Responsive Behavior

- Desktop uses a persistent content navigator, central article, and contextual role/authority panel.
- Tablet preserves the article hierarchy while collapsing secondary context below the main content.
- Mobile uses thumb-reachable tabs, guided decision branches, stacked instructions, and full-width screenshots.
- Search, filters, tabs, flow nodes, screenshot hotspots, and article controls meet a 44px minimum target.
- Reading position and selected article view survive reload and history navigation.

## Content Model

Content is structured data, not scattered page-specific JSX. Shared interfaces cover:

- `availability`: live, limited, coming soon
- `contentType`: workflow, role, feature, troubleshooting, policy, glossary, release
- owners and last-reviewed dates
- applicable roles, departments, capabilities, and routes
- prerequisites and required evidence
- ordered steps and decision nodes
- status transitions and persistence effects
- screenshots and hotspots
- handoffs and completion criteria
- prohibited actions and segregation-of-duties controls
- exceptions and escalation
- related content and policy sources

Indexes are derived from the content registry for search, filters, role pages, feature pages, related-content links, and validation reports. Content owners do not duplicate the same authority statement in several files.

## Coverage Contract

The Knowledge Base registry is compared with application sources of truth:

- Shell and module routes
- RBAC modules, roles, and capabilities
- Workflow and status definitions
- Administrator configuration surfaces
- Searchable commands and navigation destinations
- Screenshot evidence inventory

The validator reports missing documentation, orphaned content, invalid role-to-capability claims, links to unavailable routes, duplicate identifiers, stale screenshots, missing owners, and dead-end decisions. Live coverage gaps fail CI. Coming-soon gaps are reported separately and cannot satisfy live-feature coverage.

## Error And Empty States

- A missing article presents related tasks, role guides, and a search action.
- A role without access sees the reason, required role or capability, and administrator escalation path.
- A missing screenshot falls back to complete text guidance and is flagged for remediation; broken media never leaves an empty frame.
- Search with no exact match suggests corrected terminology, adjacent features, and glossary entries.
- Invalid deep links retain the Knowledge Base shell and offer recovery navigation.

## Governance

Every article has a content owner and last-reviewed date. Changes to routes, capabilities, statuses, policies, or workflow definitions require an associated documentation update or an explicit coverage exception reviewed by the product owner. Release notes identify affected articles and roles. Policy guidance cites its governing source and does not silently reinterpret approved policy.

## Verification

### Automated content checks

- Schema and identifier validation
- Cross-link and route validation
- RBAC-to-role-guide comparison
- Route and feature coverage
- Decision-tree reachability and valid terminal outcomes
- Missing, stale, and invalid screenshot evidence
- Search indexing and availability filtering

### Functional tests

- Search by task, role, feature, status, and problem
- Role and availability filters
- Flow-node-to-step synchronization
- Decision branching, backtracking, merge points, and terminal outcomes
- History, reload, and scroll restoration
- Screenshot hotspot selection and captions
- Access-aware content behavior

### Accessibility and visual checks

- Keyboard and screen-reader semantics
- Focus order and visible focus
- Color contrast and reduced motion
- No overlap, clipping, horizontal page overflow, or intercepted controls
- Hotspot accuracy and legibility
- 44px minimum targets

Viewport matrix:

- Desktop: 1440x900 and 1280x800
- Tablet: 768x1024
- Mobile: 390x844, 360x800, and 320x720

## Delivery Boundaries

The first implementation covers the complete content platform, all currently implemented roles and routes, principal end-to-end workflows, administrator guidance, decision-tree interactions, and a validated screenshot evidence set. Roadmap roles and features are included as coming-soon reference entries. A CMS, user comments, AI-authored answers, public documentation export, and technical support runbook are not required for this release.

## Acceptance

The enhancement is ready when the coverage validator reports no live gaps, all defined decision branches terminate correctly, all current roles match RBAC, all required screenshots pass evidence validation, responsive functional and visual suites pass, and a representative user can complete each principal workflow using the handbook without relying on undocumented knowledge.

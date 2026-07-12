# Mwell Intra Immersive Knowledge Base Design

## Purpose

Redesign the authenticated Mwell Intra Knowledge Base as a workflow learning
environment. Users must understand the complete governed process first, then
learn each step through current screenshots of the actual application.

The redesign must preserve every existing role guide, procedure, workflow,
glossary entry, troubleshooting item, policy reference, and future-feature
recommendation. It must not turn the Knowledge Base into a separate application
or weaken operational route authorization.

## Product Direction

The experience uses a guided workflow workspace:

1. Show the complete workflow and governed decision tree.
2. Let the user select an action, decision, handoff, exception, or outcome node.
3. Synchronize the selected node with a focused learning workspace.
4. Teach the step with a current application screenshot and numbered hotspots.
5. Explain owner, prerequisites, action, evidence, outcome, database effect, and
   exception recovery beside the screenshot.
6. Link to the authorized operational route without implying that documentation
   grants access.

This structure combines the clarity of structured step documentation with the
context of synchronized visual walkthroughs. It is designed for longer,
policy-governed workflows rather than transient onboarding tours.

## Information Architecture

### Knowledge Base Home

The first viewport answers: "What do you need to complete?"

- A role-aware workflow gallery is the primary content.
- Recommended workflows use the signed-in user's assigned modules and roles.
- Search remains visible but is secondary to workflow discovery.
- Continue-learning state may show the last opened workflow and step, stored
  locally; it must never imply operational transaction progress.
- Role guides, task procedures, reference material, troubleshooting, and future
  recommendations follow the workflow gallery.

### Content Layers

1. **Workflows:** governed end-to-end journeys and decision trees.
2. **Role guides:** responsibilities, queues, permissions, handoffs, and
   escalation paths for all supported user types.
3. **Task procedures:** focused instructions linked to workflow nodes.
4. **Reference:** glossary, policy context, troubleshooting, controls, and future
   recommendations.

Search indexes all four layers, including workflow node titles, branch labels,
hotspot instructions, role aliases, acronyms, exceptions, and expected outcomes.

## Workflow Model

### Node Types

- **Start:** workflow entry state.
- **Action:** work performed by one or more accountable roles.
- **Decision:** governed choice that changes status, owner, evidence, or allowed
  next action.
- **Handoff:** explicit transfer between roles or modules.
- **System:** automatic state or ledger update.
- **Exception:** controlled non-happy path with recovery or terminal disposition.
- **Terminal:** successful, rejected, cancelled, returned, or otherwise final
  outcome.

### Branching Rules

The overview shows governed branches only. A branch belongs in the decision tree
when it changes at least one of:

- workflow status;
- responsible owner;
- required evidence;
- segregation-of-duties control;
- next allowed action;
- terminal outcome.

Field validation, stale-state recovery, network failure, unavailable attachments,
and permission errors remain in the selected step workspace unless they alter the
governed process.

Every decision edge has an explicit label such as Yes, No, Approve, Reject,
Return for clarification, Accept, Hold, or Return to vendor. Every exception
either rejoins a named node or ends at a named terminal state. The renderer must
not infer sequence from array order.

## Workflow Experience

### Overview

- The workflow title, purpose, participating roles, estimated step count, and
  policy context appear before the diagram.
- The complete decision tree is visible before detailed instructions.
- A legend explains node shapes and states.
- Selecting a node updates the URL with the flow and step identifiers.
- The active path is emphasized without hiding alternate governed outcomes.
- Dense branches can collapse, but decisions and terminal outcomes remain
  discoverable and keyboard accessible.

### Step Workspace

The selected node opens a synchronized workspace containing:

- step number and node type;
- accountable and supporting roles;
- prerequisites;
- exact action;
- evidence requirements;
- expected application status;
- expected database effect;
- success result;
- exception and recovery guidance;
- current screenshot with numbered hotspots;
- Previous, Next, return-to-overview, and Open live screen controls.

Previous and Next follow the selected branch. At decisions, the user selects a
named outcome before Next can continue. This branch selection is instructional
only and never mutates production data.

### Completion

A terminal node explains:

- the final application status;
- records and evidence that should now exist;
- the next responsible role, when applicable;
- related workflows;
- how to restart or return to the workflow library.

## Screenshot Evidence Contract

Screenshots are critical product content, not decorative assets. Every evidence
record contains:

- stable evidence identifier;
- workflow and node identifiers;
- desktop image;
- mobile image when layout or controls materially differ;
- source route;
- capture viewport;
- role used for capture;
- required fixture or record state;
- capture date and review date;
- production or approved documentation-environment provenance;
- alt text;
- numbered hotspots with normalized coordinates and instructions;
- sensitive-data review status;
- expected screen heading or landmark;
- expected database state after the documented action.

### Capture Rules

- Use realistic, clearly labeled documentation records.
- Never expose passwords, tokens, private keys, personal data, confidential
  documents, or uncontrolled production transactions.
- Wait for loading skeletons, animations, and transient notifications to settle.
- Reject screenshots containing errors, blank regions, clipping, overlays,
  developer indicators, stale controls, or contradictory data.
- Re-capture evidence after material UI or workflow changes.
- Display a designed unavailable state instead of silently showing stale or
  missing evidence.

### Hotspots

- Numbered markers preserve the context of the original screenshot.
- Selecting a marker highlights its matching instruction; selecting an
  instruction highlights the marker.
- Coordinates are normalized to image dimensions.
- Hotspots have keyboard focus, accessible names, and non-color numbering.
- Users can zoom and pan without losing the instruction panel.
- Instructions are not overlaid across small mobile controls.

## Visual System

The Knowledge Base remains recognizably Mwell Intra: white and pale-blue work
surfaces, strong navy text, restrained Mwell blue guidance, cyan for system
states, green for successful outcomes, amber for decisions, and rose for
exceptions. Color supplements shape, labels, and icons.

The design avoids a collection of decorative cards. Workflow nodes, repeated
workflow summaries, and screenshot frames are functional surfaces. Page sections
remain unframed and use spacing, rules, and restrained background bands for
hierarchy.

Node shapes are stable:

- rounded terminal for start and terminal states;
- rectangular action and handoff nodes;
- distinct decision geometry or clearly labeled decision treatment;
- system nodes with system icon and cyan treatment;
- exception nodes with warning icon and rose treatment.

Motion is limited to path emphasis, workspace transitions, and hotspot focus.
Reduced-motion mode removes animated movement and uses immediate state changes.

## Responsive Design

### Desktop

- A wide decision-tree canvas precedes the step workspace.
- The workspace uses a large screenshot region and a persistent instruction
  panel.
- The step navigator remains synchronized with the diagram and selected node.
- The screenshot supports fit, actual-size, and zoom controls.

### Tablet

- The diagram uses controlled horizontal panning when necessary.
- The workspace may stack the instruction panel below the screenshot.
- Branch labels and node text never shrink below readable body sizes.

### Mobile

- Show a compact path summary before the expanded branch view.
- Decision branches expand on demand; the current and alternate outcomes remain
  named.
- Screenshots are pannable and zoomable with the active hotspot centered.
- Numbered instructions render below the screenshot.
- Previous, Next, and Open live screen remain reachable above bottom navigation.
- The desktop diagram is not scaled into an unreadable miniature.
- No workflow or screenshot requires page-level horizontal scrolling.

## States And Recovery

The following states require designed UI:

- content loading;
- screenshot loading;
- screenshot unavailable or outdated;
- workflow content validation failure;
- broken operational route;
- insufficient route permission;
- no search results;
- no role-specific recommendations;
- unsupported branch or incomplete decision metadata;
- offline access with uncached evidence;
- long labels, many owners, and dense branches.

Documentation must distinguish instructional branch selection from actual
transaction state. It never writes operational records.

## Accessibility

- Diagram nodes use semantic controls and expose node type, owner, position, and
  outgoing branch labels.
- Keyboard order follows the workflow and then the step workspace.
- Focus is moved intentionally when the selected step changes.
- Branches, outcomes, and states are not communicated by color alone.
- Hotspots and zoom controls have accessible names and visible focus states.
- Screenshot alt text describes the screen; hotspot labels describe actions.
- The diagram has a structured list fallback for screen readers and constrained
  displays.
- Text and controls meet production contrast and target-size requirements.

## Content Coverage

The migration validator must prove that every current Knowledge Base item remains
reachable:

- all 20 existing user types;
- all existing workflows and their related procedures;
- all articles and article sections;
- all glossary entries and aliases;
- all troubleshooting and control guidance;
- all policy references;
- all future-feature recommendations.

Launch-critical workflow nodes require current desktop evidence. A mobile image
is mandatory when navigation, information order, controls, modals, or responsive
behavior differs materially from desktop.

## Component Boundaries

- `WorkflowLibrary`: role-aware discovery, filtering, and continuation links.
- `WorkflowCanvas`: accessible graph layout, branch controls, and node selection.
- `WorkflowNode`: stable visual and semantic representation of a node.
- `WorkflowNavigator`: ordered/branched textual fallback and progress control.
- `StepWorkspace`: coordinates selected node guidance and evidence.
- `EvidenceViewer`: screenshot loading, zoom, pan, hotspots, and unavailable state.
- `HotspotInstructions`: synchronized numbered instruction list.
- `WorkflowCompletion`: terminal state, database expectations, and related flows.
- `knowledge schema`: typed content, graph edges, evidence metadata, and
  validation rules.

Operational modules remain dependencies only through stable routes and approved
documentation screenshots. The Knowledge Base does not import module page
components or bypass role checks.

## Verification And Acceptance

The redesign is accepted only when:

1. Every existing Knowledge Base item is reachable through navigation or search.
2. Every workflow branch has an explicit label and valid destination.
3. Every non-terminal node can reach at least one terminal outcome.
4. Every launch-critical node has current desktop evidence.
5. Every materially different mobile state has mobile evidence.
6. Hotspots align at 1440, 1280, 390, and 320 pixel viewports.
7. Desktop and mobile have no overlap, clipping, dead end, unlabeled control,
   keyboard trap, broken route, or page-level horizontal overflow.
8. Search finds workflow nodes, branch labels, hotspot instructions, exceptions,
   and expected outcomes.
9. Screenshot captures fail when the expected heading is absent, loading remains,
   browser errors occur, or sensitive-data checks fail.
10. Live Supabase verification confirms documented statuses and database effects
    match actual application behavior.
11. Node selection, branch selection, deep links, browser navigation, zoom, pan,
    hotspot synchronization, and reduced motion work on desktop and mobile.
12. Production build, type checks, content validation, accessibility checks, and
    visual regression screenshots pass before deployment.

## Delivery Sequence

1. Extend and validate the workflow and evidence schemas.
2. Build the workflow-first home and accessible decision-tree canvas.
3. Build the synchronized step workspace and evidence viewer.
4. Migrate every current Knowledge Base item without content loss.
5. Capture and audit the complete desktop/mobile evidence matrix.
6. Run strict local visual, accessibility, route, and content audits.
7. Deploy to Vercel and repeat the audit with live Supabase identities.

## Explicit Non-Goals

- The Knowledge Base does not execute or simulate production transactions.
- It does not replace operational authorization or audit trails.
- It does not introduce a documentation CMS in this delivery.
- It does not use generated images as substitutes for actual application
  screenshots.
- It does not document every field-level validation as a top-level graph branch.

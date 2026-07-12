import { KNOWLEDGE_ROLES } from "./roles";
import { KNOWLEDGE_FLOWS } from "./workflows";
import { KNOWLEDGE_EVIDENCE } from "./evidence";
import type {
  KnowledgeArticle,
  KnowledgeContent,
  KnowledgeModule,
} from "./types";

const moduleRoute: Record<KnowledgeModule, string> = {
  core: "/",
  admin: "/admin/users",
  vendor: "/vendor",
  warehouse: "/warehouse",
  procurement: "/procurement",
  legal: "/legal",
};

const SCREENSHOTS: Record<
  string,
  Array<{ src: string; alt: string; caption: string }>
> = {
  "sign-in-and-access": [
    {
      src: "/knowledge/screenshots/sign-in-desktop.png",
      alt: "Mwell Intra sign-in screen",
      caption: "Enter the assigned Mwell identity, then select Sign in once.",
    },
  ],
  "purchase-request": [
    {
      src: "/knowledge/screenshots/procurement-request-mobile.png",
      alt: "Procurement request form on mobile",
      caption:
        "The request wizard captures category, line items, justification, route, and evidence.",
    },
  ],
  "procurement-approval": [
    {
      src: "/knowledge/screenshots/procurement-list-desktop.png",
      alt: "Procurement request queue",
      caption:
        "Open the governed request from the queue before making a decision.",
    },
  ],
  "vendor-invitation": [
    {
      src: "/knowledge/screenshots/legal-invite-mobile.png",
      alt: "Legal vendor invitation form",
      caption:
        "Legal records company, contact, category, jurisdiction, and risk facts.",
    },
  ],
  "legal-accreditation-review": [
    {
      src: "/knowledge/screenshots/legal-cases-desktop.png",
      alt: "Legal accreditation case queue",
      caption:
        "Use the case queue to open evidence, checklist, instruments, and decision history.",
    },
  ],
  "warehouse-configuration": [
    {
      src: "/knowledge/screenshots/warehouse-storage-desktop.png",
      alt: "Warehouse storage areas and bins",
      caption:
        "Create storage areas and scannable bins before receiving production stock.",
    },
  ],
  "warehouse-receiving": [
    {
      src: "/knowledge/screenshots/warehouse-receiving-desktop.png",
      alt: "Warehouse receiving workflow",
      caption:
        "Select a receivable PO, product, quantity, traceability, and destination.",
    },
  ],
};

const roleArticles: KnowledgeArticle[] = KNOWLEDGE_ROLES.map((role) => ({
  id: `role-${role.id}`,
  slug: `roles/${role.id}`,
  title: `${role.label} guide`,
  summary: role.purpose,
  module: role.module,
  roles: [role.id],
  keywords: [
    role.label,
    role.module,
    "responsibilities",
    "handoff",
    "daily work",
  ],
  sections: [
    {
      id: "responsibility",
      title: "Your responsibility",
      body: role.purpose,
    },
    {
      id: "working-method",
      title: "Working method",
      body: "Start from your assigned queue or module. Verify the record, complete only actions within your role, record evidence and reasons, and hand off through the system rather than chat or offline instructions.",
      steps: [
        {
          title: "Open your work queue",
          ownerRoleIds: [role.id],
          instruction:
            "Use the module dashboard, task list, or approval inbox relevant to the process.",
          expectedOutcome: "The active record and required action are visible.",
          exception:
            "If access is denied, use the Identity and access flow and contact the platform administrator.",
        },
        {
          title: "Validate before action",
          ownerRoleIds: [role.id],
          instruction:
            "Check status, ownership, required evidence, quantities/amounts, and prior activity.",
          expectedOutcome:
            "The action is based on the current governed record.",
          exception: "Refresh stale records; do not repeat a completed action.",
        },
        {
          title: "Complete and hand off",
          ownerRoleIds: [role.id],
          instruction:
            "Submit the action with evidence and a clear reason where requested.",
          expectedOutcome:
            "The next role receives a system-visible task or status.",
        },
      ],
    },
  ],
  relatedArticleIds: [],
  flowIds: KNOWLEDGE_FLOWS.filter((flow) => flow.roles.includes(role.id)).map(
    (flow) => flow.id,
  ),
  liveRoutes: [moduleRoute[role.module]],
  owner:
    role.module === "vendor"
      ? "Legal"
      : role.module === "core"
        ? "Platform"
        : role.module,
  reviewedAt: "2026-07-11",
}));

const processArticle = (
  id: string,
  title: string,
  summary: string,
  module: KnowledgeModule,
  roles: string[],
  route: string,
  flowId: string,
  steps: Array<[string, string, string?, string?]>,
): KnowledgeArticle => ({
  id,
  slug: `procedures/${id}`,
  title,
  summary,
  module,
  roles,
  keywords: title
    .toLowerCase()
    .split(/\s+/)
    .concat(["procedure", "workflow", "how to"]),
  sections: [
    { id: "purpose", title: "Purpose", body: summary },
    {
      id: "procedure",
      title: "Procedure",
      body: "Follow the governed sequence. Status, evidence, and handoffs must remain in Intra.",
      steps: steps.map(
        ([
          stepTitle,
          instruction,
          expectedOutcome = "The record advances to the next governed state.",
          exception,
        ]) => ({
          title: stepTitle,
          ownerRoleIds: roles,
          instruction,
          expectedOutcome,
          exception,
        }),
      ),
    },
    {
      id: "control",
      title: "Control points",
      body: "Never bypass required evidence, segregation of duties, named approval, accreditation, inspection, or reconciliation controls. Refresh before retrying a transaction.",
    },
  ],
  relatedArticleIds: roles.map((role) => `role-${role}`),
  flowIds: [flowId],
  liveRoutes: [route],
  owner: (
    {
      core: "Platform",
      admin: "Platform",
      vendor: "Legal",
      warehouse: "Warehouse",
      procurement: "Procurement",
      legal: "Legal",
    } satisfies Record<KnowledgeModule, string>
  )[module],
  reviewedAt: "2026-07-11",
  screenshots: SCREENSHOTS[id],
});

const procedureArticles: KnowledgeArticle[] = [
  processArticle(
    "sign-in-and-access",
    "Sign in and recover access",
    "Restore a secure session, understand visible modules, and resolve denied access.",
    "core",
    ["core_staff_only", "platform_admin", "vendor_portal"],
    "/login",
    "identity-and-access",
    [
      ["Sign in", "Use your approved Mwell identity."],
      ["Verify workspace", "Confirm the expected module and task are visible."],
      [
        "Escalate incorrect access",
        "Provide the route and expected responsibility to the platform administrator.",
        "The role assignment is reviewed without sharing passwords.",
      ],
    ],
  ),
  processArticle(
    "user-and-role-administration",
    "Administer users and roles",
    "Provision profiles and assign the minimum scoped role required.",
    "admin",
    ["platform_admin"],
    "/admin/users",
    "identity-and-access",
    [
      [
        "Find the user",
        "Confirm identity, employment/vendor kind, and active status.",
      ],
      [
        "Review current roles",
        "Compare assigned scopes with approved responsibilities.",
      ],
      [
        "Apply change",
        "Save the minimum required role and verify the audit record.",
      ],
      [
        "Verify new session",
        "Ask the user to sign in again and test the intended route.",
      ],
    ],
  ),
  processArticle(
    "doa-administration",
    "Maintain department DOA",
    "Create immutable department approval revisions and activate them deliberately.",
    "admin",
    ["platform_admin", "legal_admin", "procurement_admin"],
    "/admin/doa",
    "doa-governance",
    [
      [
        "Open active matrix",
        "Review source, effective date, thresholds, and named approvers.",
      ],
      [
        "Create revision",
        "Load assignments, change version and owners, then save a draft.",
      ],
      [
        "Validate",
        "Resolve gaps, overlaps, missing owners, and missing final approval.",
      ],
      ["Activate", "Confirm activation; the prior matrix becomes superseded."],
    ],
  ),
  processArticle(
    "purchase-request",
    "Create a purchase request",
    "Capture need, sourcing facts, line values, evidence, and route-ready justification.",
    "procurement",
    ["procurement_requester", "procurement_officer"],
    "/procurement/requests/new",
    "procure-to-pay",
    [
      [
        "Describe the requirement",
        "Select category, title, line items, quantities, and required date.",
      ],
      [
        "Explain the need",
        "Record alternatives, risk, budget context, and supporting evidence.",
      ],
      [
        "Review route preview",
        "Confirm sourcing and approval implications before saving.",
      ],
      [
        "Save and submit",
        "Save a governed draft, then submit only after Procurement route confirmation.",
      ],
    ],
  ),
  processArticle(
    "procurement-approval",
    "Review procurement approval",
    "Make a named DOA decision using the complete request and sourcing record.",
    "procurement",
    ["procurement_approver", "procurement_finance", "procurement_admin"],
    "/procurement/approvals",
    "procure-to-pay",
    [
      [
        "Open assigned step",
        "Confirm the request is assigned to your identity.",
      ],
      [
        "Review evidence",
        "Check need, value, route, competition/exception, accreditation, and comments.",
      ],
      ["Decide", "Approve, reject, or return with a specific reason."],
    ],
  ),
  processArticle(
    "purchase-order-and-payment",
    "Issue PO and establish payment readiness",
    "Author a controlled PO and connect receipt, acceptance, and finance evidence.",
    "procurement",
    [
      "procurement_officer",
      "procurement_finance",
      "procurement_admin",
      "warehouse_procurement",
    ],
    "/procurement/purchase-orders",
    "procure-to-pay",
    [
      [
        "Author from approval",
        "Use the approved request and accredited vendor.",
      ],
      [
        "Approve and issue",
        "Complete required PO controls before supplier commitment.",
      ],
      [
        "Match receipt",
        "Confirm receipt and inspection evidence against PO lines.",
      ],
      [
        "Confirm acceptance",
        "Record business acceptance and finance readiness evidence.",
      ],
    ],
  ),
  processArticle(
    "vendor-invitation",
    "Invite and onboard a vendor",
    "Create a vendor identity and governed accreditation case.",
    "legal",
    ["legal_admin", "vendor_portal"],
    "/legal/invites/new",
    "vendor-accreditation",
    [
      [
        "Verify contact",
        "Confirm company and vendor email are not employee identities.",
      ],
      [
        "Create invitation",
        "Record category, jurisdiction, entity, risk, contract, and data handling facts.",
      ],
      [
        "Vendor activates account",
        "Use the secure invitation/reset link and enter the Vendor Portal.",
      ],
      [
        "Complete application",
        "Submit required profile, evidence, and declarations.",
      ],
    ],
  ),
  processArticle(
    "legal-accreditation-review",
    "Review vendor accreditation",
    "Review LGL004-aligned evidence, technology qualification, instruments, and final disposition.",
    "legal",
    ["legal_reviewer", "legal_compliance", "legal_admin", "vendor_portal"],
    "/legal",
    "vendor-accreditation",
    [
      [
        "Review application snapshot",
        "Confirm the submitted facts and policy version.",
      ],
      [
        "Review checklist evidence",
        "Approve, reject, or request correction for every requirement.",
      ],
      [
        "Complete instruments",
        "Execute required MNDA and service-provider instruments.",
      ],
      [
        "Record decision",
        "Approve only when gates and decision authority are satisfied.",
      ],
      ["Monitor renewal", "Track expiry and material changes."],
    ],
  ),
  processArticle(
    "warehouse-configuration",
    "Configure warehouse, areas, and bins",
    "Establish scannable, controlled storage before stock operations.",
    "warehouse",
    ["warehouse_admin", "warehouse_logistics_supervisor"],
    "/warehouse/storage",
    "warehouse-setup",
    [
      ["Create location", "Define the warehouse site."],
      ["Create storage area", "Set area purpose and restrictions."],
      ["Create bins", "Assign unique scannable bin codes."],
      ["Verify operation routes", "Permit only valid movement paths."],
    ],
  ),
  processArticle(
    "warehouse-receiving",
    "Receive, inspect, and put away stock",
    "Match a PO, capture traceability, inspect quality, and make accepted stock available.",
    "warehouse",
    [
      "warehouse_procurement",
      "warehouse_logistics_supervisor",
      "warehouse_operations",
      "warehouse_finance",
    ],
    "/warehouse/receiving",
    "receive-to-putaway",
    [
      [
        "Select PO and destination",
        "Confirm supplier, warehouse, and remaining quantities.",
      ],
      ["Record lines", "Scan product, quantity, serial/lot, and evidence."],
      [
        "Inspect",
        "Choose disposition and provide evidence/reason when required.",
      ],
      ["Put away", "Move accepted stock to a valid bin."],
      [
        "Verify ledger",
        "Confirm units, lots, stock levels, and valuation updated.",
      ],
    ],
  ),
  processArticle(
    "warehouse-events-and-returns",
    "Allocate, issue, and return event stock",
    "Preserve custody from business demand through event reconciliation.",
    "warehouse",
    [
      "warehouse_business_unit",
      "warehouse_marketing",
      "warehouse_operations",
      "warehouse_logistics_supervisor",
    ],
    "/warehouse/events",
    "allocation-event-return",
    [
      [
        "Create demand",
        "Record event owner, dates, location, and requested products.",
      ],
      [
        "Reserve and issue",
        "Allocate available stock and scan custody to the recipient.",
      ],
      [
        "Record outcome",
        "Enter consumed, returned, lost, or damaged quantities.",
      ],
      ["Inspect returns", "Restock accepted units and route exceptions."],
      ["Reconcile", "Confirm all issued quantity has a final outcome."],
    ],
  ),
  processArticle(
    "cycle-count",
    "Run a cycle count and adjustment",
    "Count physical stock and correct approved variance without direct edits.",
    "warehouse",
    ["warehouse_operations", "warehouse_finance", "warehouse_admin"],
    "/warehouse/cycle-counts",
    "cycle-count-adjustment",
    [
      ["Create draft", "Select bin and count scope."],
      ["Record physical count", "Enter observed quantity and evidence."],
      ["Review variance", "Determine cause, value, and approval requirement."],
      ["Post approved adjustment", "Use the stock-change approval workflow."],
      ["Confirm reconciliation", "Verify ledger and physical count agree."],
    ],
  ),
  processArticle(
    "pricing-and-reporting",
    "Review costing, pricing, and reports",
    "Govern landed-cost inputs, price changes, exports, and analytical use.",
    "warehouse",
    ["warehouse_pricing", "warehouse_finance", "warehouse_bi_analyst"],
    "/warehouse/pricing",
    "pricing-and-costing",
    [
      ["Confirm cost basis", "Review PO, freight, duty, and allocation basis."],
      ["Propose price", "Record value, effective date, and reason."],
      ["Review impact", "Finance validates valuation and margin impact."],
      [
        "Use governed report",
        "Export only authorized data and preserve report context.",
      ],
    ],
  ),
  processArticle(
    "exceptions-and-recovery",
    "Resolve failures and exceptions",
    "Determine saved state, retry safely, and escalate with useful evidence.",
    "core",
    KNOWLEDGE_ROLES.map((role) => role.id),
    "/",
    "exception-and-recovery",
    [
      [
        "Stop and verify",
        "Refresh the record; check status and activity before retrying.",
      ],
      [
        "Classify",
        "Identify validation, access, stale state, network, or policy failure.",
      ],
      [
        "Correct or retry",
        "Correct input or retry only an idempotent operation.",
      ],
      [
        "Escalate",
        "Provide role, route, time, record ID, expected outcome, and a safe screenshot.",
      ],
    ],
  ),
];

export const KNOWLEDGE_CONTENT: KnowledgeContent = {
  roles: KNOWLEDGE_ROLES,
  features: [],
  articles: [...roleArticles, ...procedureArticles],
  flows: KNOWLEDGE_FLOWS,
  glossary: [
    {
      term: "DOA",
      definition:
        "Delegation of Authority: the effective department matrix that assigns named approval responsibility by amount and category.",
      aliases: ["approval matrix", "delegation"],
    },
    {
      term: "Purchase request",
      definition:
        "A governed record of business need, value, sourcing facts, evidence, and requested approval.",
      aliases: ["PR", "request"],
    },
    {
      term: "Purchase order",
      definition:
        "The approved supplier commitment authored from an eligible purchase request.",
      aliases: ["PO"],
    },
    {
      term: "Accreditation",
      definition:
        "Legal and compliance determination that a vendor satisfies applicable evidence, risk, and instrument requirements.",
      aliases: ["vendor approval"],
    },
    {
      term: "Putaway",
      definition:
        "Controlled movement of accepted received stock into a valid storage bin.",
      aliases: ["put away"],
    },
    {
      term: "Cycle count",
      definition:
        "A physical inventory count used to identify and govern stock variance.",
      aliases: ["stock count"],
    },
    {
      term: "Idempotency",
      definition:
        "A transaction safeguard that prevents the same command from creating duplicate effects when retried.",
      aliases: ["duplicate protection"],
    },
    {
      term: "RLS",
      definition:
        "Row Level Security: database policy that restricts which rows an authenticated identity may read or change.",
      aliases: ["row security"],
    },
  ],
  futureFeatures: (
    [
      [
        "cms",
        "Admin article drafting and publishing",
        "Department-owned review, approval, effective dating, and version history.",
      ],
      [
        "context",
        "Contextual in-screen help",
        "Open the exact procedure from the operational control being used.",
      ],
      [
        "analytics",
        "Knowledge search analytics",
        "Identify unsuccessful searches and documentation gaps without storing sensitive query data.",
      ],
      [
        "feedback",
        "Article correction requests",
        "Let authenticated users report unclear or outdated guidance to its owner.",
      ],
      [
        "traceability",
        "Policy-to-procedure traceability",
        "Show which policy clause governs each workflow control.",
      ],
      [
        "walkthrough",
        "Guided sandbox walkthroughs",
        "Practice workflows with disposable data and progress checks.",
      ],
      [
        "language",
        "Multilingual documentation",
        "Publish governed translations with the same effective version.",
      ],
      [
        "offline",
        "Offline Knowledge Base",
        "Precache approved guidance for resilient warehouse access.",
      ],
      [
        "learning",
        "Role onboarding curricula",
        "Assign role-specific learning paths and completion records.",
      ],
      [
        "release",
        "Workflow-linked release notes",
        "Explain changed screens and procedures after each release.",
      ],
    ] satisfies Array<[string, string, string]>
  ).map(([id, title, value]) => ({
    id,
    title,
    value,
    status: "proposed" as const,
  })),
  evidence: KNOWLEDGE_EVIDENCE,
};

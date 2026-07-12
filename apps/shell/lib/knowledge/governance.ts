import type { GlossaryEntry, KnowledgeArticle } from "./types";

export interface GovernanceGuide {
  id: string;
  title: string;
  summary: string;
  source: string;
  owner: string;
  operationalControls: string[];
  evidence: string[];
  prohibitedWorkarounds: string[];
  roleIds: string[];
  flowIds: string[];
}

export interface HandbookReleaseNote {
  id: string;
  title: string;
  releasedAt: string;
  availability: "live" | "limited" | "coming_soon";
  summary: string;
  changedWorkflowIds: string[];
  affectedRoleIds: string[];
  administratorAction: string;
}

export const GOVERNANCE_GUIDES: GovernanceGuide[] = [
  {
    id: "policy-procurement",
    title: "Procurement policy and controlled sourcing",
    summary:
      "Apply the approved route, competition, exception, budget, and authority controls before commitment.",
    source:
      "mWell Procurement Policy and Procedures - Revised Modern Visual Updated",
    owner: "Procurement",
    operationalControls: [
      "Determine the route from total value and category",
      "Document required competition or an approved exception",
      "Confirm budget and the effective department DOA",
      "Issue a PO only after all required approvals",
    ],
    evidence: [
      "Business need and line values",
      "Quotations or exception justification",
      "Evaluation and award record",
      "Budget and named approval history",
    ],
    prohibitedWorkarounds: [
      "Do not split requirements to avoid a threshold",
      "Do not commit to a supplier before approval",
      "Do not substitute chat approval for the system decision",
    ],
    roleIds: [
      "procurement_requester",
      "procurement_officer",
      "procurement_approver",
      "procurement_finance",
      "procurement_admin",
    ],
    flowIds: ["procure-to-pay", "doa-governance"],
  },
  {
    id: "policy-vendor-accreditation",
    title: "Vendor accreditation and lifecycle control",
    summary:
      "Use risk-based evidence, declarations, instruments, remediation, approval, renewal, and suspension controls.",
    source: "LGL004-Vendor Accreditation Form 2.0",
    owner: "Legal",
    operationalControls: [
      "Capture the vendor's legal and ownership facts",
      "Apply the checklist for category and risk",
      "Resolve missing or rejected evidence",
      "Record authorized approval, conditions, expiry, renewal, or suspension",
    ],
    evidence: [
      "Submitted vendor profile and declarations",
      "Requirement-level reviewer dispositions",
      "Risk and conflict checks",
      "Decision, conditions, and validity dates",
    ],
    prohibitedWorkarounds: [
      "Do not award to an ineligible vendor",
      "Do not approve a checklist item without evidence",
      "Do not overwrite a submitted application snapshot",
    ],
    roleIds: [
      "vendor_portal",
      "legal_reviewer",
      "legal_compliance",
      "legal_admin",
      "procurement_officer",
    ],
    flowIds: ["vendor-accreditation", "procure-to-pay"],
  },
  {
    id: "policy-legal-instruments",
    title: "Legal instruments and technology-service safeguards",
    summary:
      "Complete the applicable confidentiality, data, security, and service instruments before an eligible engagement.",
    source: "[MNDA]- Tech Service Provider",
    owner: "Legal",
    operationalControls: [
      "Identify confidential information and data handling",
      "Use the approved instrument and version",
      "Record authorized counterparties and execution",
      "Escalate deviations for Legal review",
    ],
    evidence: [
      "Applicable risk answers",
      "Approved instrument version",
      "Execution status and signatories",
      "Approved deviations or conditions",
    ],
    prohibitedWorkarounds: [
      "Do not upload an altered unofficial template",
      "Do not mark an unsigned instrument complete",
      "Do not expose confidential evidence outside authorized roles",
    ],
    roleIds: [
      "vendor_portal",
      "legal_reviewer",
      "legal_compliance",
      "legal_admin",
    ],
    flowIds: ["vendor-accreditation"],
  },
  {
    id: "policy-operational-controls",
    title: "Segregation of duties, evidence, audit, and retention",
    summary:
      "Keep actions attributable, approvals independent, evidence durable, and history reviewable across Intra.",
    source:
      "Approved Mwell access, records-retention, and module operating controls",
    owner: "Platform",
    operationalControls: [
      "Use a unique identity and the minimum approved role",
      "Separate authoring, approval, custody, and reconciliation where required",
      "Preserve actor, time, reason, status, and evidence",
      "Restrict sensitive records and review access periodically",
    ],
    evidence: [
      "Access approval",
      "Status and decision history",
      "Evidence references and configuration version",
      "Exception, remediation, and review disposition",
    ],
    prohibitedWorkarounds: [
      "Do not share credentials",
      "Do not directly edit history or stock totals",
      "Do not use offline approval to bypass a blocked control",
    ],
    roleIds: [
      "platform_admin",
      "core_staff_only",
      "warehouse_admin",
      "procurement_admin",
      "legal_admin",
    ],
    flowIds: [
      "identity-and-access",
      "doa-governance",
      "exception-and-recovery",
    ],
  },
];

export const GOVERNANCE_ARTICLES: KnowledgeArticle[] = GOVERNANCE_GUIDES.map(
  (item) => ({
    id: item.id,
    slug: `governance/${item.id.replace(/^policy-/, "")}`,
    title: item.title,
    summary: item.summary,
    module:
      item.owner === "Legal"
        ? "legal"
        : item.owner === "Procurement"
          ? "procurement"
          : "admin",
    roles: item.roleIds,
    keywords: [
      "policy",
      "control",
      "evidence",
      "audit",
      "retention",
      item.source,
      ...item.operationalControls,
    ],
    sections: [
      {
        id: "source",
        title: "Governing source and owner",
        body: `${item.source}. Accountable content owner: ${item.owner}. Confirm the currently approved version before changing a control.`,
      },
      {
        id: "controls",
        title: "How the policy works in Intra",
        body: item.operationalControls.join("; "),
      },
      {
        id: "evidence",
        title: "Evidence that proves compliance",
        body: item.evidence.join("; "),
      },
      {
        id: "prohibited",
        title: "Workarounds that are not allowed",
        body: item.prohibitedWorkarounds.join("; "),
      },
    ],
    relatedArticleIds: item.roleIds.map((roleId) => `role-${roleId}`),
    flowIds: item.flowIds,
    liveRoutes: [],
    owner: item.owner,
    reviewedAt: "2026-07-13",
  }),
);

export const HANDBOOK_RELEASE_NOTES: HandbookReleaseNote[] = [
  {
    id: "release-operating-handbook",
    title: "Operating handbook and guided decisions",
    releasedAt: "2026-07-13",
    availability: "live",
    summary:
      "Adds task, role, feature, policy, administrator, and symptom-first recovery guidance with guided workflow decisions and reviewed evidence.",
    changedWorkflowIds: [
      "identity-and-access",
      "procure-to-pay",
      "vendor-accreditation",
      "receive-to-putaway",
      "quality-disposition",
      "event-fulfillment",
      "returns-reconciliation",
      "cycle-count-adjustment",
      "doa-governance",
      "exception-and-recovery",
    ],
    affectedRoleIds: [
      "core_staff_only",
      "platform_admin",
      "vendor_portal",
      "procurement_requester",
      "procurement_officer",
      "procurement_approver",
      "legal_reviewer",
      "legal_admin",
      "warehouse_operations",
      "warehouse_logistics_supervisor",
      "warehouse_admin",
    ],
    administratorAction:
      "Review role assignments, policy versions, department DOA, receiving routes, and evidence rules before directing users to the updated procedures.",
  },
  {
    id: "release-roadmap-boundary",
    title: "Roadmap capability boundary",
    releasedAt: "2026-07-13",
    availability: "limited",
    summary:
      "Roadmap profiles and capabilities are visible for planning but have no live authority, route, or transaction behavior until separately released.",
    changedWorkflowIds: ["administration-governance"],
    affectedRoleIds: [
      "platform_admin",
      "procurement_admin",
      "legal_admin",
      "warehouse_admin",
    ],
    administratorAction:
      "Do not assign planned roles or promise planned controls; use the current live role and feature registry for access decisions.",
  },
];

export const RELEASE_NOTE_ARTICLES: KnowledgeArticle[] =
  HANDBOOK_RELEASE_NOTES.map((item) => ({
    id: item.id,
    slug: `releases/${item.id.replace(/^release-/, "")}`,
    title: item.title,
    summary: item.summary,
    module: "admin",
    roles: item.affectedRoleIds,
    keywords: [
      "release notes",
      item.availability,
      "changed workflow",
      ...item.changedWorkflowIds,
    ],
    sections: [
      {
        id: "availability",
        title: "Availability",
        body: `${item.availability.replace("_", " ")}. Released ${item.releasedAt}.`,
      },
      {
        id: "workflows",
        title: "Changed workflows",
        body: item.changedWorkflowIds.join("; "),
      },
      {
        id: "roles",
        title: "Affected roles",
        body: item.affectedRoleIds.join("; "),
      },
      {
        id: "administrator-action",
        title: "Administrator action",
        body: item.administratorAction,
      },
    ],
    relatedArticleIds: item.affectedRoleIds.map((roleId) => `role-${roleId}`),
    flowIds: item.changedWorkflowIds.filter(
      (flowId) => flowId !== "administration-governance",
    ),
    liveRoutes: [],
    owner: "Product and Platform",
    reviewedAt: item.releasedAt,
  }));

export const OPERATIONS_GLOSSARY: GlossaryEntry[] = [
  {
    term: "Delegation of Authority",
    definition:
      "The effective, versioned department ladder that assigns named approval responsibility by value and scope.",
    aliases: ["DOA", "approval matrix", "delegation"],
  },
  {
    term: "Sourcing threshold",
    definition:
      "An approved value or category boundary that determines competition, evidence, and approval requirements.",
    aliases: ["procurement threshold", "quotation threshold"],
  },
  {
    term: "Accreditation",
    definition:
      "Legal and compliance determination that a vendor satisfies applicable evidence, risk, instrument, and authority requirements for a defined period.",
    aliases: ["vendor approval", "vendor qualification"],
  },
  {
    term: "Conditional approval",
    definition:
      "A time-bound approval with explicit conditions that remain visible and must be monitored or completed.",
    aliases: ["approved with conditions"],
  },
  {
    term: "Segregation of duties",
    definition:
      "Separation of incompatible responsibilities such as authoring, approving, custody, and reconciliation to reduce error and misuse.",
    aliases: ["SOD", "maker checker"],
  },
  {
    term: "Quality hold",
    definition:
      "A controlled status that prevents stock from becoming available until authorized disposition or return.",
    aliases: ["quarantine", "held stock"],
  },
  {
    term: "Variance",
    definition:
      "A difference between expected and observed quantity, value, evidence, or outcome that requires explanation and governed resolution.",
    aliases: ["discrepancy", "stock difference"],
  },
  {
    term: "Audit trail",
    definition:
      "The preserved actor, time, action, reason, status, evidence, and configuration context for a record.",
    aliases: ["activity history", "change history"],
  },
  {
    term: "Idempotency",
    definition:
      "A transaction safeguard that lets a safe retry return the same effect instead of creating a duplicate.",
    aliases: ["duplicate protection"],
  },
  {
    term: "Row Level Security",
    definition:
      "Database policy that limits which records an authenticated identity may read or change.",
    aliases: ["RLS", "row security"],
  },
];

import type { KnowledgeArticle, KnowledgeModule } from "./types";

export interface AdministratorGuide {
  id: string;
  title: string;
  summary: string;
  module: KnowledgeModule;
  route?: string;
  availability: "live" | "limited" | "coming_soon";
  roleIds: string[];
  prerequisites: string[];
  authority: string;
  configurationFields: string[];
  validation: string[];
  affectedUsers: string[];
  auditEffect: string;
  recovery: string;
  requiredReview: string;
  flowIds: string[];
}

const guide = (value: AdministratorGuide): AdministratorGuide => value;

export const ADMINISTRATOR_GUIDES: AdministratorGuide[] = [
  guide({
    id: "admin-users-roles",
    title: "Manage users and role assignments",
    summary:
      "Provision an attributable identity and grant only the approved duties and scope.",
    module: "admin",
    route: "/admin/users",
    availability: "live",
    roleIds: ["platform_admin"],
    prerequisites: [
      "Approved access request",
      "Verified user identity and department",
      "Named business owner",
    ],
    authority:
      "Only a Platform administrator may activate users or change role assignments; the requester cannot approve their own access.",
    configurationFields: [
      "Identity type",
      "Active status",
      "Department",
      "Module role",
      "Scope",
      "Effective date",
      "Approval reference",
    ],
    validation: [
      "Use a unique approved email",
      "Match each role to the user's current responsibility",
      "Reject conflicting or excess privileges",
    ],
    affectedUsers: [
      "The named user",
      "Their department owner",
      "Workflow owners whose queues depend on the role",
    ],
    auditEffect:
      "Records the administrator, time, previous assignment, new assignment, scope, and approval reference.",
    recovery:
      "Disable an incorrect assignment, restore the last approved minimum role, and require a new session. Never share another user's account.",
    requiredReview:
      "Department owner review before grant; periodic access and leaver review by Platform administration.",
    flowIds: ["identity-and-access"],
  }),
  guide({
    id: "admin-departments",
    title: "Maintain departments and accountable owners",
    summary:
      "Keep organizational scope, ownership, and workflow routing aligned with the approved operating structure.",
    module: "admin",
    availability: "limited",
    roleIds: ["platform_admin"],
    prerequisites: [
      "Approved organization change",
      "Named department owner",
      "Impact assessment for active users and requests",
    ],
    authority:
      "Platform administration maintains department records; Legal or the accountable executive confirms governance ownership where authority changes.",
    configurationFields: [
      "Department name and code",
      "Active status",
      "Accountable owner",
      "Default cost center",
      "Effective date",
    ],
    validation: [
      "Codes must be unique",
      "An active department needs an active owner",
      "Do not deactivate a department with unresolved work",
    ],
    affectedUsers: [
      "Department users",
      "DOA approvers",
      "Procurement requesters",
      "Reporting owners",
    ],
    auditEffect:
      "Preserves the old and new department definition and the actor who approved the change.",
    recovery:
      "Reactivate the prior valid definition or correct routing through a reviewed change. Do not move historical records to hide an ownership error.",
    requiredReview:
      "Department owner and Platform review; Legal review when the change alters delegated authority.",
    flowIds: ["identity-and-access", "doa-governance"],
  }),
  guide({
    id: "admin-doa",
    title: "Configure department Delegation of Authority",
    summary:
      "Create an editable, versioned approval ladder for each department without rewriting historical decisions.",
    module: "admin",
    route: "/admin/doa",
    availability: "live",
    roleIds: ["platform_admin", "legal_admin"],
    prerequisites: [
      "Approved department authority schedule",
      "Named approvers and alternates",
      "Effective date and policy owner",
    ],
    authority:
      "Platform administrators or Legal administrators may configure a department ladder; activation requires the designated governance review.",
    configurationFields: [
      "Department",
      "Amount band",
      "Category or exception scope",
      "Approver",
      "Sequence",
      "Effective dates",
      "Version note",
    ],
    validation: [
      "No gaps or overlaps between amount bands",
      "Every active band has an active named approver",
      "Final authority covers the highest permitted value",
    ],
    affectedUsers: [
      "Department requesters",
      "Named approvers",
      "Procurement",
      "Finance",
    ],
    auditEffect:
      "Creates a new immutable version; transactions retain the DOA version and approver used at decision time.",
    recovery:
      "Supersede an incorrect version with a corrected reviewed version. Do not edit or delete a ladder already used by a transaction.",
    requiredReview:
      "Legal or Platform governance review before activation and after any material change; Procurement may review the operational effect but cannot configure or activate the ladder.",
    flowIds: ["doa-governance", "procure-to-pay"],
  }),
  guide({
    id: "admin-procurement-thresholds",
    title: "Configure procurement thresholds and sourcing routes",
    summary:
      "Translate approved procurement policy into value, competition, exception, and approval routing controls.",
    module: "procurement",
    availability: "limited",
    roleIds: ["procurement_admin"],
    prerequisites: [
      "Approved procurement policy revision",
      "Effective date",
      "Mapped DOA and exception owners",
    ],
    authority:
      "Procurement administration authors configuration; the policy owner approves interpretation and Finance or Legal reviews affected controls.",
    configurationFields: [
      "Value threshold",
      "Required quotation count",
      "Sourcing route",
      "Exception type",
      "Approval requirement",
      "Effective date",
    ],
    validation: [
      "Thresholds cannot overlap",
      "Each route has an accountable owner",
      "Exceptions require reason and evidence",
      "Currency basis is explicit",
    ],
    affectedUsers: [
      "Requesters",
      "Procurement officers",
      "Approvers",
      "Finance",
      "Vendors",
    ],
    auditEffect:
      "Versions the rule set and records which version routed each request.",
    recovery:
      "Deactivate the faulty future rule, publish a reviewed correction, and assess open requests individually. Never lower a threshold to force approval.",
    requiredReview:
      "Procurement policy owner and affected Finance/Legal control owners before activation.",
    flowIds: ["procure-to-pay", "doa-governance"],
  }),
  guide({
    id: "admin-legal-checklist",
    title: "Configure vendor and Legal checklist requirements",
    summary:
      "Maintain risk-based accreditation evidence and instrument requirements from approved Legal sources.",
    module: "legal",
    availability: "limited",
    roleIds: ["legal_admin"],
    prerequisites: [
      "Approved LGL004 or Legal policy revision",
      "Requirement owner",
      "Applicability and risk rules",
    ],
    authority:
      "Legal administration configures requirements; the accountable Legal authority approves policy meaning and exceptions.",
    configurationFields: [
      "Requirement label",
      "Vendor/risk applicability",
      "Evidence type",
      "Mandatory status",
      "Expiry rule",
      "Reviewer role",
      "Instrument template version",
    ],
    validation: [
      "Every mandatory item has a reviewer",
      "Risk rules are deterministic",
      "Template version and effective date are recorded",
    ],
    affectedUsers: [
      "Vendor applicants",
      "Legal reviewers",
      "Compliance",
      "Procurement",
    ],
    auditEffect:
      "Preserves requirement and template versions against each submitted case.",
    recovery:
      "Publish a corrected checklist version and identify affected open cases. Never mark evidence complete without reviewer disposition.",
    requiredReview:
      "Legal policy owner, Compliance, and privacy/security owner when technology or personal-data requirements change.",
    flowIds: ["vendor-accreditation", "doa-governance"],
  }),
  guide({
    id: "admin-warehouse-structure",
    title: "Configure warehouses, locations, storage areas, and bins",
    summary:
      "Build a unique, scannable storage hierarchy before inventory transactions begin.",
    module: "warehouse",
    route: "/warehouse/storage",
    availability: "live",
    roleIds: ["warehouse_admin", "warehouse_logistics_supervisor"],
    prerequisites: [
      "Approved physical layout",
      "Named warehouse owner",
      "Storage and quality restrictions",
    ],
    authority:
      "Warehouse administration creates structure; the Logistics supervisor validates operational readiness and segregation.",
    configurationFields: [
      "Warehouse/location",
      "Storage area",
      "Bin code",
      "Active status",
      "Capacity",
      "Restriction",
      "Scan label",
    ],
    validation: [
      "Codes are unique and scannable",
      "Parent locations are active",
      "Restricted or quality-hold areas cannot be normal available stock",
    ],
    affectedUsers: [
      "Receiving",
      "Operations",
      "Quality control",
      "Cycle count teams",
      "Reporting",
    ],
    auditEffect:
      "Records structural changes and preserves inventory movement history against the original bin.",
    recovery:
      "Deactivate an unused incorrect bin or transfer stock through an approved movement before closure. Never delete a bin with history.",
    requiredReview:
      "Warehouse administrator and Logistics supervisor before receiving is enabled.",
    flowIds: [
      "warehouse-setup",
      "receive-to-putaway",
      "cycle-count-adjustment",
    ],
  }),
  guide({
    id: "admin-receiving-routes",
    title: "Configure receiving, inspection, and putaway routes",
    summary:
      "Define which receipts require inspection, evidence, traceability, hold, and destination controls.",
    module: "warehouse",
    route: "/warehouse/operation-routes",
    availability: "live",
    roleIds: ["warehouse_admin", "warehouse_logistics_supervisor"],
    prerequisites: [
      "Active warehouse hierarchy",
      "Product traceability rules",
      "Named inspection and exception owners",
    ],
    authority:
      "Warehouse administration configures routes; Logistics and Quality owners approve disposition and evidence rules.",
    configurationFields: [
      "Warehouse",
      "Product/category scope",
      "PO eligibility",
      "Inspection requirement",
      "Evidence requirement",
      "Serial/lot rule",
      "Default hold area",
    ],
    validation: [
      "Every route has a valid destination",
      "Required evidence cannot be bypassed",
      "Serialized/lot-controlled products retain traceability",
    ],
    affectedUsers: [
      "Receivers",
      "Quality control",
      "Putaway operators",
      "Warehouse Finance",
    ],
    auditEffect:
      "Records the route version applied to each receipt and inspection.",
    recovery:
      "Correct the route for future receipts and quarantine affected unverified stock for review. Do not relabel or directly edit the ledger.",
    requiredReview:
      "Warehouse administrator, Logistics supervisor, and Quality owner before activation.",
    flowIds: ["receive-to-putaway", "quality-disposition", "warehouse-setup"],
  }),
  guide({
    id: "admin-evidence-audit",
    title: "Govern evidence requirements and audit review",
    summary:
      "Define required proof, monitor exceptions, and review attributable activity without changing operational history.",
    module: "admin",
    availability: "limited",
    roleIds: [
      "platform_admin",
      "legal_admin",
      "procurement_admin",
      "warehouse_admin",
    ],
    prerequisites: [
      "Approved retention and evidence rules",
      "Scoped audit access",
      "Defined exception and escalation owners",
    ],
    authority:
      "Module administrators define approved requirements; authorized auditors review records read-only and operational owners resolve findings.",
    configurationFields: [
      "Evidence category",
      "Required file/data",
      "Retention",
      "Applicable action",
      "Exception owner",
      "Review cadence",
    ],
    validation: [
      "Sensitive evidence has restricted access",
      "Retention matches approved policy",
      "An exception never silently converts a missing requirement into complete",
    ],
    affectedUsers: [
      "All transaction actors",
      "Approvers",
      "Compliance",
      "Audit reviewers",
    ],
    auditEffect:
      "Preserves actor, timestamp, status transition, evidence reference, configuration version, and review disposition.",
    recovery:
      "Restore access or request replacement evidence through the governed record; preserve the original failure and remediation trail.",
    requiredReview:
      "Quarterly module-owner review and event-driven review after a policy, security, or material control change.",
    flowIds: [
      "identity-and-access",
      "doa-governance",
      "exception-and-recovery",
    ],
  }),
];

export const ADMINISTRATOR_ARTICLES: KnowledgeArticle[] =
  ADMINISTRATOR_GUIDES.map((item) => ({
    id: item.id,
    slug: `administration/${item.id.replace(/^admin-/, "")}`,
    title: item.title,
    summary: item.summary,
    module: item.module,
    availability: item.availability,
    roles: item.roleIds,
    keywords: [
      "administrator",
      "configuration",
      "governance",
      ...item.configurationFields,
      ...item.validation,
    ],
    sections: [
      {
        id: "prerequisites",
        title: "Before you change configuration",
        body: item.prerequisites.join(" "),
      },
      {
        id: "authority",
        title: "Authority and separation of duties",
        body: item.authority,
      },
      {
        id: "configuration",
        title: "Configuration fields",
        body: item.configurationFields.join("; "),
      },
      {
        id: "validation",
        title: "Validation before activation",
        body: item.validation.join("; "),
      },
      {
        id: "impact",
        title: "Affected users and audit effect",
        body: `${item.affectedUsers.join(", ")}. ${item.auditEffect}`,
      },
      {
        id: "recovery",
        title: "Rollback and safe recovery",
        body: item.recovery,
      },
      { id: "review", title: "Required review", body: item.requiredReview },
    ],
    relatedArticleIds: item.roleIds.map((roleId) => `role-${roleId}`),
    flowIds: item.flowIds,
    liveRoutes: item.availability === "live" && item.route ? [item.route] : [],
    owner:
      item.module === "admin"
        ? "Platform"
        : item.module[0]!.toUpperCase() + item.module.slice(1),
    reviewedAt: "2026-07-13",
  }));

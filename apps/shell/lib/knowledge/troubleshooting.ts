import type { KnowledgeArticle, KnowledgeModule } from "./types";

export interface TroubleshootingGuide {
  id: string;
  symptom: string;
  summary: string;
  module: KnowledgeModule;
  likelyCauses: string[];
  safeRecovery: string[];
  dataImpact: string;
  escalationOwner: string;
  escalationEvidence: string[];
  prohibitedWorkarounds: string[];
  roleIds: string[];
  flowIds: string[];
}

export const TROUBLESHOOTING_GUIDES: TroubleshootingGuide[] = [
  {
    id: "trouble-sign-in",
    symptom: "Sign-in fails or returns to the login page",
    summary:
      "Recover identity access without repeated submissions or shared credentials.",
    module: "core",
    likelyCauses: [
      "Incorrect approved identity or password",
      "Expired reset link",
      "Inactive user",
      "Browser session or network failure",
    ],
    safeRecovery: [
      "Check the visible error once",
      "Use Forgot password for the same approved email",
      "Open the newest reset link",
      "Ask Platform administration to verify active status",
    ],
    dataImpact:
      "A failed sign-in does not create an operational transaction; repeated attempts may trigger security controls.",
    escalationOwner: "Platform administrator",
    escalationEvidence: [
      "Time",
      "Login route",
      "Error text",
      "Approved email domain without password",
    ],
    prohibitedWorkarounds: [
      "Never share a password or one-time link",
      "Do not create a duplicate identity",
    ],
    roleIds: ["core_staff_only", "vendor_portal", "platform_admin"],
    flowIds: ["identity-and-access", "exception-and-recovery"],
  },
  {
    id: "trouble-access-denied",
    symptom: "A page, control, or record says access denied",
    summary:
      "Distinguish correct least-privilege behavior from an incorrect assignment.",
    module: "core",
    likelyCauses: [
      "Role lacks the capability",
      "Department or record scope differs",
      "Assignment changed while the session was open",
    ],
    safeRecovery: [
      "Confirm the route and required responsibility",
      "Sign out and back in after an approved role change",
      "Submit an access request with business owner approval",
    ],
    dataImpact:
      "The denied action should not write data; verify activity before retrying.",
    escalationOwner: "Platform administrator and department owner",
    escalationEvidence: [
      "Route",
      "Record ID",
      "Role",
      "Expected task",
      "Safe screenshot",
    ],
    prohibitedWorkarounds: [
      "Do not use another person's account",
      "Do not request an administrator role merely to complete one task",
    ],
    roleIds: ["core_staff_only", "platform_admin"],
    flowIds: ["identity-and-access", "exception-and-recovery"],
  },
  {
    id: "trouble-missing-data",
    symptom: "Expected request, vendor, PO, stock, event, or task is missing",
    summary:
      "Check scope, status, filters, and upstream completion before recreating a record.",
    module: "core",
    likelyCauses: [
      "Filter or search excludes the record",
      "Wrong department, warehouse, or role scope",
      "Upstream handoff is incomplete",
      "Session data is stale",
    ],
    safeRecovery: [
      "Clear filters and search by governed ID",
      "Refresh once",
      "Check upstream status and activity",
      "Ask the upstream owner to complete the system handoff",
    ],
    dataImpact:
      "Creating a replacement can duplicate obligations or stock; first prove the original does not exist.",
    escalationOwner: "Relevant module administrator",
    escalationEvidence: [
      "Record ID or source reference",
      "Expected queue",
      "Filters",
      "Upstream status",
      "Time",
    ],
    prohibitedWorkarounds: [
      "Do not recreate the record blindly",
      "Do not alter scope to expose unrelated data",
    ],
    roleIds: [
      "core_staff_only",
      "warehouse_operations",
      "procurement_officer",
      "legal_reviewer",
    ],
    flowIds: ["exception-and-recovery"],
  },
  {
    id: "trouble-upload",
    symptom: "Evidence upload fails or the attachment is not visible",
    summary: "Preserve the record while safely retrying an allowed file.",
    module: "core",
    likelyCauses: [
      "File type or size is not allowed",
      "Network interruption",
      "Session expired",
      "Upload completed but the view is stale",
    ],
    safeRecovery: [
      "Keep the source file unchanged",
      "Check type and size guidance",
      "Refresh the record and inspect attachments",
      "Retry once after connectivity returns",
      "Escalate if the file remains absent",
    ],
    dataImpact:
      "The transaction may be saved without the attachment or the file may already exist; inspect before retrying.",
    escalationOwner: "Module administrator",
    escalationEvidence: [
      "Record ID",
      "File name and type",
      "Approximate size",
      "Time",
      "Visible error",
    ],
    prohibitedWorkarounds: [
      "Do not upload passwords, secrets, or unrelated personal data",
      "Do not rename an unsafe file to bypass validation",
    ],
    roleIds: [
      "vendor_portal",
      "warehouse_operations",
      "procurement_requester",
      "legal_reviewer",
    ],
    flowIds: ["exception-and-recovery"],
  },
  {
    id: "trouble-offline-write",
    symptom: "Connection is lost while saving or submitting",
    summary: "Determine whether the write committed before any retry.",
    module: "core",
    likelyCauses: [
      "Network interruption",
      "Request timeout",
      "Browser or service interruption",
    ],
    safeRecovery: [
      "Stop clicking",
      "Restore connectivity",
      "Refresh the record from its queue",
      "Check status and activity",
      "Retry only when no committed effect is present and the action is safe",
    ],
    dataImpact:
      "The command may have committed even when the confirmation was not displayed; an unchecked retry can duplicate effects.",
    escalationOwner: "Module administrator, then Platform support",
    escalationEvidence: [
      "Record ID",
      "Action",
      "Time",
      "Status before and after refresh",
      "Network/error message",
    ],
    prohibitedWorkarounds: [
      "Do not repeatedly submit",
      "Do not create a second record",
      "Do not directly edit the database",
    ],
    roleIds: ["core_staff_only", "vendor_portal", "platform_admin"],
    flowIds: ["exception-and-recovery"],
  },
  {
    id: "trouble-rejected-request",
    symptom:
      "A request, accreditation item, or approval is rejected or returned",
    summary: "Use the recorded reason to revise or close the governed record.",
    module: "procurement",
    likelyCauses: [
      "Missing evidence",
      "Policy or budget failure",
      "Incorrect facts",
      "Risk or authority decision",
    ],
    safeRecovery: [
      "Read the decision reason and failed control",
      "Correct only the returned fields or evidence",
      "Preserve prior versions",
      "Resubmit through the displayed route or close when rejection is final",
    ],
    dataImpact:
      "The rejected version remains in history; revision creates a new attributable state.",
    escalationOwner: "Decision owner shown on the record",
    escalationEvidence: [
      "Record ID",
      "Decision reason",
      "Corrective evidence",
      "Policy or authority question",
    ],
    prohibitedWorkarounds: [
      "Do not clone the request to hide rejection",
      "Do not ask a different approver to bypass the decision",
    ],
    roleIds: [
      "procurement_requester",
      "procurement_officer",
      "vendor_portal",
      "legal_reviewer",
    ],
    flowIds: [
      "procure-to-pay",
      "vendor-accreditation",
      "exception-and-recovery",
    ],
  },
  {
    id: "trouble-quality-hold",
    symptom: "Stock remains on quality hold",
    summary:
      "Resolve evidence and disposition without making held stock available.",
    module: "warehouse",
    likelyCauses: [
      "Inspection evidence is incomplete",
      "Corrective action is pending",
      "Release authority has not decided",
      "Return-to-vendor route is incomplete",
    ],
    safeRecovery: [
      "Open the inspection and hold reason",
      "Attach permitted corrective evidence",
      "Route to the authorized Quality disposition owner",
      "Release, continue hold, or return only through the recorded decision",
    ],
    dataImpact:
      "Held units remain unavailable and must not be allocated, issued, or counted as usable stock.",
    escalationOwner:
      "Warehouse Logistics supervisor or authorized Quality owner",
    escalationEvidence: [
      "Receipt and product/serial/lot",
      "Hold reason",
      "Evidence",
      "Required disposition",
    ],
    prohibitedWorkarounds: [
      "Do not transfer held stock to an available bin",
      "Do not directly change availability",
    ],
    roleIds: [
      "warehouse_operations",
      "warehouse_logistics_supervisor",
      "warehouse_admin",
    ],
    flowIds: [
      "quality-disposition",
      "receive-to-putaway",
      "exception-and-recovery",
    ],
  },
  {
    id: "trouble-variance",
    symptom: "Received, returned, counted, or valued quantity does not match",
    summary: "Investigate custody and evidence before an approved correction.",
    module: "warehouse",
    likelyCauses: [
      "Counting or unit error",
      "Missing movement or event outcome",
      "Serial/lot mismatch",
      "Cost or receipt mismatch",
    ],
    safeRecovery: [
      "Stop movements for the affected scope",
      "Recount and inspect ledger/activity",
      "Record the variance reason and evidence",
      "Use the applicable approval and adjustment or reconciliation flow",
    ],
    dataImpact:
      "Inventory and valuation remain inconsistent until the governed correction posts; history must show both variance and resolution.",
    escalationOwner: "Warehouse Finance and Logistics supervisor",
    escalationEvidence: [
      "Product and location",
      "Expected and observed values",
      "Movement/activity history",
      "Count or receipt evidence",
    ],
    prohibitedWorkarounds: [
      "Do not edit stock totals",
      "Do not move stock to conceal a variance",
      "Do not post an unsupported adjustment",
    ],
    roleIds: [
      "warehouse_operations",
      "warehouse_finance",
      "warehouse_logistics_supervisor",
      "warehouse_admin",
    ],
    flowIds: [
      "cycle-count-adjustment",
      "returns-reconciliation",
      "exception-and-recovery",
    ],
  },
  {
    id: "trouble-stale-session",
    symptom: "The page is blank, keeps restoring, or shows an old record state",
    summary: "Restore a current session without losing or repeating work.",
    module: "core",
    likelyCauses: [
      "Expired authentication session",
      "Cached route state",
      "Record changed in another session",
      "Client error",
    ],
    safeRecovery: [
      "Note the route and record ID",
      "Refresh once",
      "Sign in again if prompted",
      "Reopen the record from its queue",
      "Verify activity before repeating an action",
    ],
    dataImpact:
      "Unsaved field edits may be lost; submitted actions may already be committed.",
    escalationOwner: "Platform administrator",
    escalationEvidence: [
      "Route",
      "Record ID",
      "Time",
      "Browser",
      "Visible state after refresh",
      "Console reference if support requests it",
    ],
    prohibitedWorkarounds: [
      "Do not hard-refresh repeatedly during submission",
      "Do not disable security controls or clear shared-device data without authorization",
    ],
    roleIds: ["core_staff_only", "vendor_portal", "platform_admin"],
    flowIds: ["identity-and-access", "exception-and-recovery"],
  },
];

export const TROUBLESHOOTING_ARTICLES: KnowledgeArticle[] =
  TROUBLESHOOTING_GUIDES.map((item) => ({
    id: item.id,
    slug: `troubleshooting/${item.id.replace(/^trouble-/, "")}`,
    title: item.symptom,
    summary: item.summary,
    module: item.module,
    availability: "live",
    roles: item.roleIds,
    keywords: [
      "problem",
      "error",
      "recovery",
      "failed",
      "missing",
      item.symptom,
      ...item.likelyCauses,
    ],
    sections: [
      {
        id: "causes",
        title: "What may have happened",
        body: item.likelyCauses.join("; "),
      },
      {
        id: "recovery",
        title: "Safe recovery",
        body: item.safeRecovery.join("; "),
      },
      { id: "data-impact", title: "Data impact", body: item.dataImpact },
      {
        id: "escalation",
        title: "When and how to escalate",
        body: `${item.escalationOwner}. Provide: ${item.escalationEvidence.join(", ")}.`,
      },
      {
        id: "prohibited",
        title: "Do not do this",
        body: item.prohibitedWorkarounds.join("; "),
      },
    ],
    relatedArticleIds: [
      "exceptions-and-recovery",
      ...item.roleIds.map((roleId) => `role-${roleId}`),
    ],
    flowIds: item.flowIds,
    liveRoutes: [],
    owner: item.escalationOwner,
    reviewedAt: "2026-07-13",
  }));

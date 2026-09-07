import type { KnowledgeFlow, KnowledgeFlowNode } from "./types";

export const VENDOR_APPLICATION_FLOW_ID = "vendor-application-submission";

// Source trace, not human review or publication metadata.
export const VENDOR_APPLICATION_FLOW_SOURCES = [
  "apps/shell/app/vendor/[[...slug]]/page.tsx",
  "modules/legal/src/LegalApp.tsx",
  "modules/legal/src/routes.ts",
  "modules/legal/src/vendorCaseWorkflow.ts",
  "modules/legal/src/pages/VendorApplicationPage.tsx",
  "modules/legal/src/pages/CaseDetailPage.tsx",
  "modules/legal/src/requirements/vendorAccreditationV2025.ts",
] as const;

type VendorNode<T = KnowledgeFlowNode> = T extends KnowledgeFlowNode ? Omit<T, "ownerRoleIds"> : never;
const node = (value: VendorNode): KnowledgeFlowNode =>
  ({ ...value, ownerRoleIds: ["vendor_portal"] });

export const VENDOR_APPLICATION_FLOW: KnowledgeFlow = {
  id: VENDOR_APPLICATION_FLOW_ID,
  title: "Vendor application, evidence and corrections",
  summary: "Prepare your own case, recover a stale draft, submit a signed version and follow Legal's correction request. Submission is not accreditation approval.",
  // Source-grounded guidance only; no new reviewed screen capture is claimed.
  availability: "limited",
  roles: ["vendor_portal"],
  startNodeId: "vendor-self-case",
  nodes: [
    node({ id: "vendor-self-case", type: "start", title: "Open your own accreditation case", articleId: "feature-vendor-cases", body: "From /vendor, open the case assigned to your vendor identity. The server enforces case ownership; an unavailable case does not grant access to another vendor's record." }),
    { id: "vendor-self-editable", type: "decision", ownerRoleIds: ["vendor_portal"], authorityRoleId: "vendor_portal", title: "Is this a draft or a requested correction?", articleId: "feature-vendor-application", body: "A draft is editable. A correction is editable only when Legal has recorded its correction request. Submitted and under-review versions stay read-only. Draft access still requires core.manage_own_accreditation_draft.", policyBasis: "applicationEditState in modules/legal/src/vendorCaseWorkflow.ts; vendor draft capability and server ownership checks." },
    node({ id: "vendor-self-readonly", type: "terminal", title: "Read-only case view complete", articleId: "feature-vendor-case-detail", body: "Read the actual case status and Legal's note. Ending this read-only viewing path does not change that status, escalate the case or approve accreditation. Do not overwrite a submitted snapshot or attempt Legal's review controls. A versioned correction request must precede further application edits.", terminalOutcome: "complete" }),
    node({ id: "vendor-self-prepare", type: "action", title: "Complete the application and evidence", articleId: "feature-vendor-application", body: "Open the case application. Complete the v.2025 entity, ownership, risk and declaration fields. For a correction, address Legal's note against its source version. Use Open document uploads to return to this case's checklist; upload against the applicable requirement with core.submit_documents. Uploading does not approve the evidence.", exception: "For a failed upload, retain the case reference and resolve the reported error before treating the requirement as supplied." }),
    { id: "vendor-self-current", type: "decision", ownerRoleIds: ["vendor_portal"], authorityRoleId: "vendor_portal", title: "Did the draft save at the expected version?", articleId: "feature-vendor-application", body: "Save the working copy with its retained draft version. A stale-version conflict is not a successful save.", policyBasis: "VendorApplicationPage saveDraft recovery and the versioned vendor application repository." },
    node({ id: "vendor-self-recover", type: "action", title: "Review the latest saved draft", articleId: "feature-vendor-application", body: "On a version conflict, load and review the latest saved content before reapplying changes. Do not blindly retry an old version. Discarding a working copy does not reset the concurrency cursor or permit reuse of a stale signature." }),
    { id: "vendor-self-ready", type: "decision", ownerRoleIds: ["vendor_portal"], authorityRoleId: "vendor_portal", title: "Are required fields and a fresh signature ready?", articleId: "feature-vendor-application", body: "Resolve the application validation messages and capture the authorized signatory signature. These checks prepare a submission; they do not decide accreditation or approve documents.", policyBasis: "validateV2025Application and submitApplication in VendorApplicationPage; the live submission RPC remains authoritative." },
    node({ id: "vendor-self-submit", type: "action", title: "Sign and submit the current version", articleId: "feature-vendor-application", body: "Submit to the same case with the expected version and fresh signature. The live submit_vendor_application RPC validates authority and the payload. If submission fails, read the error and review current state before retrying; do not assume Legal received it.", prerequisite: "Current case ownership and submission authority, complete application validation, and an authorized signatory signature." }),
    { id: "vendor-self-accepted", type: "decision", ownerRoleIds: ["vendor_portal"], authorityRoleId: "vendor_portal", title: "Did submission succeed?", articleId: "feature-vendor-application", body: "Only the successful submission response changes this form to its submitted read-only state. An error does not establish a handoff.", policyBasis: "submitApplication success and error branches in VendorApplicationPage." },
    node({ id: "vendor-self-legal", type: "handoff", title: "Await Legal review", articleId: "feature-vendor-case-detail", body: "Legal receives the submitted case. Read the status from your own vendor case; internal review, risk, instrument and disposition decisions remain with Legal, not the vendor." }),
    node({ id: "vendor-self-wait", type: "terminal", title: "Submitted for review, not approved", articleId: "feature-vendor-case-detail", body: "Retain the submitted record and monitor your case. If Legal requests a correction, reopen that same case, address the source-version note and submit a freshly signed revision through this process.", terminalOutcome: "complete" }),
  ],
  edges: [
    { from: "vendor-self-case", to: "vendor-self-editable" },
    { from: "vendor-self-editable", to: "vendor-self-prepare", label: "Draft or recorded correction", outcome: "success" },
    { from: "vendor-self-editable", to: "vendor-self-readonly", label: "No editable revision", outcome: "exception" },
    { from: "vendor-self-prepare", to: "vendor-self-current" },
    { from: "vendor-self-current", to: "vendor-self-ready", label: "Saved", outcome: "success" },
    { from: "vendor-self-current", to: "vendor-self-recover", label: "Conflict or save error", outcome: "exception" },
    { from: "vendor-self-recover", to: "vendor-self-prepare", label: "Review then reapply" },
    { from: "vendor-self-ready", to: "vendor-self-submit", label: "Ready", outcome: "success" },
    { from: "vendor-self-ready", to: "vendor-self-prepare", label: "Missing fields or signature", outcome: "exception" },
    { from: "vendor-self-submit", to: "vendor-self-accepted" },
    { from: "vendor-self-accepted", to: "vendor-self-legal", label: "Submitted", outcome: "success" },
    { from: "vendor-self-accepted", to: "vendor-self-recover", label: "Rejected submission or stale version", outcome: "exception" },
    { from: "vendor-self-legal", to: "vendor-self-wait" },
  ],
};

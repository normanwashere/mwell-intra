import type { KnowledgeModule } from "./types";

interface CapabilityGuidance {
  label: string;
  description: string;
}
const GUIDANCE: Record<string, CapabilityGuidance> = {
  "core:view_directory": { label: "View employee directory", description: "View the shared internal directory and basic employee profiles." },
  "core:manage_rbac": { label: "Manage users and roles", description: "Assign and remove approved role access while preserving the access audit trail." },
  "core:view_vendors": { label: "View vendor records", description: "View vendor identity, status, and permitted accreditation information." },
  "core:manage_vendors": { label: "Manage vendor records", description: "Create and maintain controlled vendor master information." },
  "core:manage_accreditation": { label: "Manage accreditation", description: "Administer accreditation cases, evidence, and governed lifecycle status." },
  "core:view_documents": { label: "View controlled documents", description: "Open documents the user is authorized to see." },
  "core:manage_documents": { label: "Manage controlled documents", description: "Classify, replace, and govern authorized document records." },
  "core:submit_documents": { label: "Submit vendor documents", description: "Upload evidence for the user's own vendor application." },
  "core:submit_accreditation": { label: "Submit accreditation", description: "Send the user's own vendor application for formal review." },
  "core:view_own_accreditation": { label: "View own accreditation", description: "View the vendor's own application, requests, and decision status." },
  "core:view_approvals": { label: "View approval history", description: "View approval records available to the user's assigned work." },
  "core:manage_approvals": { label: "Manage approval workflows", description: "Administer controlled approval records without bypassing named authority." },
  "core:record_approval": { label: "Record an approval decision", description: "Approve, reject, or return an assigned decision with a recorded reason." },
  "core:view_audit": { label: "View audit history", description: "Review attributable activity, decisions, and changes across authorized records." },
  "core:manage_notifications": { label: "Manage notifications", description: "Read and update the user's operational notifications." },

  "warehouse:view_dashboard": { label: "View warehouse dashboard", description: "View warehouse workload, inventory, and exception summaries." },
  "warehouse:receive_stock": { label: "Receive stock", description: "Record approved inbound quantities, traceability, evidence, and destinations." },
  "warehouse:manage_inventory": { label: "Manage inventory", description: "Perform authorized stock operations through the inventory ledger." },
  "warehouse:manage_products": { label: "Manage products", description: "Create and maintain product master and traceability settings." },
  "warehouse:manage_locations": { label: "Manage warehouses and bins", description: "Create and maintain controlled storage locations and scannable bins." },
  "warehouse:cycle_count": { label: "Perform cycle counts", description: "Count assigned stock and submit variances for governed resolution." },
  "warehouse:manage_returns": { label: "Manage returns", description: "Record returned custody, inspection, and reconciliation outcomes." },
  "warehouse:reserve_allocate": { label: "Reserve and allocate stock", description: "Reserve available inventory for authorized demand or events." },
  "warehouse:issue_items": { label: "Issue items", description: "Transfer custody of allocated items to an approved recipient." },
  "warehouse:transfer_stock": { label: "Transfer stock", description: "Move inventory between approved locations with ledger traceability." },
  "warehouse:view_finance": { label: "View warehouse finance", description: "View authorized valuation, costing, and reconciliation information." },
  "warehouse:view_analytics": { label: "View warehouse analytics", description: "View inventory movement, consumption, and utilization analysis." },
  "warehouse:view_procurement": { label: "View replenishment planning", description: "View reorder needs, supplier context, and stockout risk." },
  "warehouse:view_pricing": { label: "View pricing", description: "View authorized landed cost, price, and margin information." },
  "warehouse:set_pricing": { label: "Set pricing", description: "Record governed price revisions with effective dates and history." },
  "warehouse:manage_operation_routes": { label: "Manage operation routes", description: "Configure receiving, inspection, putaway, and issue routing rules." },
  "warehouse:inspect_quality": { label: "Inspect quality", description: "Record inspection evidence and a controlled stock disposition." },
  "warehouse:release_quality_hold": { label: "Release quality holds", description: "Release accepted stock from hold after required evidence and approval." },
  "warehouse:approve_stock_adjustment": { label: "Approve stock adjustments", description: "Approve or reject supported count and inventory adjustments." },
  "warehouse:view_exceptions": { label: "View warehouse exceptions", description: "View blocked, failed, or inconsistent warehouse transactions." },
  "warehouse:resolve_exceptions": { label: "Resolve warehouse exceptions", description: "Retry, correct, or close exceptions with a recorded resolution." },
  "warehouse:import_warehouse_data": { label: "Import warehouse data", description: "Run validated warehouse imports and review row-level outcomes." },

  "procurement:view_dashboard": { label: "View procurement dashboard", description: "View the user's procurement workload, status, and pending decisions." },
  "procurement:create_request": { label: "Create purchase requests", description: "Create and submit a purchase request with business need and line values." },
  "procurement:manage_rfp": { label: "Manage sourcing events", description: "Run RFQ or RFP activity and preserve comparable sourcing evidence." },
  "procurement:author_po": { label: "Author purchase orders", description: "Prepare a purchase order from an approved sourcing and award record." },
  "procurement:approve_request": { label: "Approve purchase requests", description: "Decide an assigned request tier within effective authority." },
  "procurement:approve_award": { label: "Approve sourcing awards", description: "Decide an assigned award after required competition and evaluation evidence." },
  "procurement:manage_vendors": { label: "Coordinate vendors", description: "Use eligible vendor records during sourcing and purchasing work." },
  "procurement:view_finance": { label: "Review procurement finance", description: "Review commercial values and payment-readiness evidence." },
  "procurement:admin": { label: "Administer procurement", description: "Configure and oversee procurement functions within approved policy." },

  "legal:view_dashboard": { label: "View legal dashboard", description: "View accreditation workload, evidence status, and pending decisions." },
  "legal:review_accreditation": { label: "Review accreditation", description: "Review submitted vendor identity, risk, declarations, and evidence." },
  "legal:manage_checklist": { label: "Manage requirement checklists", description: "Configure the evidence requirements used to review vendor applications." },
  "legal:approve_accreditation": { label: "Decide accreditation", description: "Approve, condition, reject, suspend, or return an accreditation case." },
  "legal:manage_documents": { label: "Manage legal documents", description: "Review and govern vendor instruments and supporting evidence." },
  "legal:manage_doa": { label: "Manage department authority", description: "Configure effective department approval ladders, limits, and approvers." },
  "legal:admin": { label: "Administer legal controls", description: "Configure and oversee legal and compliance functions within approved authority." },
};

const sentenceCase = (value: string) => {
  const words = value.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export function capabilityGuidance(
  capability: string,
  module?: KnowledgeModule | "core" | "warehouse" | "procurement" | "legal",
): CapabilityGuidance {
  const match = module ? GUIDANCE[`${module}:${capability}`] : undefined;
  if (match) return match;
  const label = sentenceCase(capability);
  return {
    label,
    description: `Use ${label.toLowerCase()} only within the user's assigned records and current workflow state.`,
  };
}

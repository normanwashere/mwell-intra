// Procurement demo seed — "Mwell operations, last 6 months".
//
// Pure, deterministic builder consumed by localStore's seedOnce(). Every date
// is computed relative to `now` so the demo never looks stale, and every
// approval ladder is built + advanced through the SAME policy helpers the UI
// uses (buildApprovalSteps / applyStepDecision) so seeded rows are exactly
// what a real click-through would have produced.
//
// Signatures are typed-style SVG data URLs (render fine in <img>, work in
// Node for tests — no canvas needed).

import type {
  ApprovalDecision,
  ApprovalSignature,
  ApprovalStep,
  ApproverTier,
  ProcurementRequest,
  ProcurementRequestLine,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderReceipt,
  RequestCategory,
  SourcingMethod,
} from './types';
import { applyStepDecision, buildApprovalSteps } from './policy';

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

function idGen(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}_seed_${(++n).toString().padStart(3, '0')}`;
}

function daysAgo(now: Date, days: number, hourOfDay = 10): string {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  d.setHours(hourOfDay, (days * 17) % 60, 0, 0);
  return d.toISOString();
}

function daysAhead(now: Date, days: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Typed-signature artifact as an SVG data URL (mirrors SignaturePad's look). */
export function svgSignature(signerName: string, signedAt: string): ApprovalSignature {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="160">` +
    `<rect width="600" height="160" fill="#ffffff"/>` +
    `<text x="300" y="92" font-family="'Segoe Script','Snell Roundhand','Apple Chancery',cursive" ` +
    `font-size="52" font-style="italic" fill="#0f172a" text-anchor="middle">${signerName}</text>` +
    `</svg>`;
  return {
    method: 'typed',
    dataUrl: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    signerName,
    signedAt,
    userAgent: 'seed | demo dataset',
  };
}

// Approvers per tier — matches the shell demo profiles.
const TIER_SIGNER: Record<ApproverTier, { name: string; email: string }> = {
  dept_head: { name: 'Marta Ramos', email: 'approver@mwell.demo' },
  procurement_head: { name: 'Liza Cruz', email: 'procurement@mwell.demo' },
  legal: { name: 'Andre Villanueva', email: 'legal@mwell.demo' },
  finance: { name: 'Elena Torres', email: 'finance.procurement@mwell.demo' },
  final_approver: { name: 'Diego Ang', email: 'cfo@mwell.demo' },
};

export interface ProcurementSeed {
  requests: ProcurementRequest[];
  purchaseOrders: PurchaseOrder[];
  approvals: ApprovalDecision[];
}

interface LadderSim {
  steps: ApprovalStep[];
  decisions: ApprovalDecision[];
  /** Terminal outcome after the simulated decisions (if any). */
  outcome: 'in_progress' | 'approved' | 'rejected';
  decidedAt?: string;
  decidedByEmail?: string;
  decisionNote?: string;
}

/**
 * Build a ladder for `input` and approve the first `approveCount` tiers
 * (spaced one day apart, oldest first). Optionally reject the tier after
 * that. Returns the mutated steps + the matching ApprovalDecision rows.
 */
function simulateLadder(opts: {
  requestId: string;
  category?: RequestCategory;
  amount: number;
  sourcingMethod: SourcingMethod;
  now: Date;
  /** Days ago the FIRST decision happened; each next tier is a day later. */
  startDaysAgo: number;
  approveCount: number;
  rejectNext?: { note: string };
  stepId: () => string;
}): LadderSim {
  let steps = buildApprovalSteps(
    { category: opts.category, amount: opts.amount, sourcingMethod: opts.sourcingMethod },
    opts.stepId,
  );
  const decisions: ApprovalDecision[] = [];
  let outcome: LadderSim['outcome'] = 'in_progress';
  let decidedAt: string | undefined;
  let decidedByEmail: string | undefined;
  let decisionNote: string | undefined;

  const decideOnce = (
    decision: 'approved' | 'rejected',
    dayOffset: number,
    note?: string,
  ): boolean => {
    const next = steps.find((s) => s.status === 'pending');
    if (!next) return false;
    const signer = TIER_SIGNER[next.tier];
    const at = daysAgo(opts.now, Math.max(0, opts.startDaysAgo - dayOffset), 11 + dayOffset);
    const signature = decision === 'approved' ? svgSignature(signer.name, at) : undefined;
    const result = applyStepDecision(steps, next.tier, decision, {
      email: signer.email,
      note,
      at,
      signature,
    });
    if (!result) return false;
    steps = result.steps;
    decisions.push({
      entityType: 'request',
      entityId: opts.requestId,
      decision,
      note,
      decidedAt: at,
      decidedByEmail: signer.email,
      tier: next.tier,
      stepId: next.id,
      signature,
    });
    if (result.terminal) {
      outcome = result.outcome === 'approved' ? 'approved' : 'rejected';
      decidedAt = at;
      decidedByEmail = signer.email;
      decisionNote = note;
    }
    return true;
  };

  for (let i = 0; i < opts.approveCount; i++) {
    if (!decideOnce('approved', i)) break;
  }
  if (opts.rejectNext && outcome === 'in_progress') {
    decideOnce('rejected', opts.approveCount, opts.rejectNext.note);
  }

  return { steps, decisions, outcome, decidedAt, decidedByEmail, decisionNote };
}

function linesOf(
  lineId: () => string,
  rows: Array<{ description: string; quantity: number; uom?: string; unitPrice?: number }>,
): ProcurementRequestLine[] {
  return rows.map((r) => ({ ...r, id: lineId() }));
}

function totalOf(lines: Array<{ quantity: number; unitPrice?: number }>): number {
  return lines.reduce((s, l) => s + l.quantity * (l.unitPrice ?? 0), 0);
}

// ---------------------------------------------------------------------------
// The seed itself
// ---------------------------------------------------------------------------

/** Build the full procurement demo dataset. Deterministic for a fixed `now`. */
export function buildProcurementSeed(now: Date = new Date()): ProcurementSeed {
  const reqId = idGen('req');
  const stepId = idGen('step');
  const lineId = idGen('rl');
  const poId = idGen('po');
  const poLineId = idGen('pl');
  const rcptId = idGen('rcpt');

  const requests: ProcurementRequest[] = [];
  const approvals: ApprovalDecision[] = [];
  const purchaseOrders: PurchaseOrder[] = [];
  const year = now.getFullYear();
  let poSeq = 0;
  const nextPoNumber = () => `PO-${year}-${(++poSeq).toString().padStart(4, '0')}`;

  const mkRequest = (opts: {
    title: string;
    description?: string;
    department: string;
    costCenter?: string;
    category: RequestCategory;
    sourcingMethod: SourcingMethod;
    requesterName: string;
    requesterEmail: string;
    vendorId?: string;
    vendorName?: string;
    neededByDays?: number;
    createdDaysAgo: number;
    lines: Array<{ description: string; quantity: number; uom?: string; unitPrice?: number }>;
    justification?: ProcurementRequest['justification'];
    /** Ladder simulation. Omit for drafts. */
    ladder?: { startDaysAgo: number; approveCount: number; rejectNote?: string };
  }): ProcurementRequest => {
    const id = reqId();
    const lines = linesOf(lineId, opts.lines);
    const estimatedAmount = totalOf(lines);
    let status: ProcurementRequest['status'] = 'draft';
    let approvalSteps: ApprovalStep[] | undefined;
    let submittedAt: string | undefined;
    let decidedAt: string | undefined;
    let decidedByEmail: string | undefined;
    let decisionNote: string | undefined;

    if (opts.ladder) {
      submittedAt = daysAgo(now, opts.ladder.startDaysAgo + 1, 9);
      const sim = simulateLadder({
        requestId: id,
        category: opts.category,
        amount: estimatedAmount,
        sourcingMethod: opts.sourcingMethod,
        now,
        startDaysAgo: opts.ladder.startDaysAgo,
        approveCount: opts.ladder.approveCount,
        rejectNext: opts.ladder.rejectNote ? { note: opts.ladder.rejectNote } : undefined,
        stepId,
      });
      approvalSteps = sim.steps;
      approvals.push(...sim.decisions);
      if (sim.outcome === 'approved') status = 'approved';
      else if (sim.outcome === 'rejected') status = 'rejected';
      else status = sim.decisions.length > 0 ? 'under_review' : 'submitted';
      decidedAt = sim.decidedAt;
      decidedByEmail = sim.decidedByEmail;
      decisionNote = sim.decisionNote;
    }

    const req: ProcurementRequest = {
      id,
      title: opts.title,
      description: opts.description,
      department: opts.department,
      costCenter: opts.costCenter,
      status,
      requesterName: opts.requesterName,
      requesterEmail: opts.requesterEmail,
      neededBy: opts.neededByDays !== undefined ? daysAhead(now, opts.neededByDays) : undefined,
      vendorId: opts.vendorId,
      vendorName: opts.vendorName,
      lines,
      createdAt: daysAgo(now, opts.createdDaysAgo, 9),
      submittedAt,
      decidedAt,
      decisionNote,
      decidedByEmail,
      estimatedAmount,
      category: opts.category,
      sourcingMethod: opts.sourcingMethod,
      justification: opts.justification,
      approvalSteps,
    };
    requests.push(req);
    return req;
  };

  const mkPO = (opts: {
    requestId?: string;
    vendorId: string;
    vendorName: string;
    status: PurchaseOrder['status'];
    origin?: 'procurement' | 'warehouse';
    createdDaysAgo: number;
    expectedDays?: number;
    notes?: string;
    actorEmail?: string;
    approvedDaysAgo?: number;
    lines: Array<{ description: string; quantity: number; uom?: string; unitPrice?: number; received?: number }>;
    /** Receipt events (append-only history). */
    receipts?: Array<{ daysAgo: number; byEmail: string; note?: string; closes?: boolean }>;
  }): PurchaseOrder => {
    const lines: PurchaseOrderLine[] = opts.lines.map((l) => ({
      id: poLineId(),
      description: l.description,
      quantity: l.quantity,
      uom: l.uom,
      unitPrice: l.unitPrice,
      receivedQuantity: l.received ?? 0,
    }));
    const approvedAt =
      opts.approvedDaysAgo !== undefined ? daysAgo(now, opts.approvedDaysAgo, 14) : undefined;
    const receipts: PurchaseOrderReceipt[] | undefined = opts.receipts?.map((r) => ({
      id: rcptId(),
      receivedAt: daysAgo(now, r.daysAgo, 15),
      receivedByEmail: r.byEmail,
      note: r.note,
      // Mirror the received quantities onto the receipt lines (single-receipt
      // demo simplification; multi-receipt POs split evenly).
      lines: lines
        .filter((l) => l.receivedQuantity > 0)
        .map((l) => ({
          lineId: l.id,
          description: l.description,
          quantity: Math.max(1, Math.round(l.receivedQuantity / (opts.receipts?.length ?? 1))),
        })),
      closedPo: r.closes ?? false,
    }));
    const po: PurchaseOrder = {
      id: poId(),
      poNumber: nextPoNumber(),
      requestId: opts.requestId,
      vendorId: opts.vendorId,
      vendorName: opts.vendorName,
      status: opts.status,
      origin: opts.origin ?? 'procurement',
      actorEmail: opts.actorEmail ?? 'procurement@mwell.demo',
      expectedDate: opts.expectedDays !== undefined ? daysAhead(now, opts.expectedDays) : undefined,
      notes: opts.notes,
      lines,
      createdAt: daysAgo(now, opts.createdDaysAgo, 13),
      updatedAt: daysAgo(now, Math.max(0, opts.createdDaysAgo - 1), 16),
      approvedAt,
      approvedByEmail: approvedAt ? 'cfo@mwell.demo' : undefined,
      approvalSignature: approvedAt ? svgSignature('Diego Ang', approvedAt) : undefined,
      receipts,
      total: totalOf(lines),
    };
    if (approvedAt) {
      approvals.push({
        entityType: 'purchase_order',
        entityId: po.id,
        decision: 'approved',
        decidedAt: approvedAt,
        decidedByEmail: 'cfo@mwell.demo',
        signature: po.approvalSignature,
      });
    }
    purchaseOrders.push(po);
    return po;
  };

  // ── Drafts ────────────────────────────────────────────────────────────────
  mkRequest({
    title: 'Q3 ECG ring restock — sizes 6 & 7',
    description: 'Low-stock alert on size 6/7 ECG rings; restock ahead of the LGU screening season.',
    department: 'Warehouse & Logistics',
    costCenter: 'CC-4100',
    category: 'medical',
    sourcingMethod: 'rfp',
    requesterName: 'Bea Santos',
    requesterEmail: 'logistics@mwell.demo',
    vendorId: 'ven-acme',
    vendorName: 'Acme Medical Supplies, Inc.',
    neededByDays: 30,
    createdDaysAgo: 2,
    lines: [
      { description: 'ECG ring — size 6', quantity: 60, uom: 'pc', unitPrice: 4200 },
      { description: 'ECG ring — size 7', quantity: 60, uom: 'pc', unitPrice: 4200 },
    ],
  });

  mkRequest({
    title: 'Ergonomic chairs for Pasig HQ ops floor',
    department: 'Facilities',
    costCenter: 'CC-2200',
    category: 'goods',
    sourcingMethod: 'small_purchase',
    requesterName: 'Marco Reyes',
    requesterEmail: 'ops@mwell.demo',
    neededByDays: 45,
    createdDaysAgo: 5,
    lines: [{ description: 'Ergonomic mesh chair', quantity: 10, uom: 'pc', unitPrice: 8500 }],
  });

  // ── Submitted, waiting at the FIRST tier ─────────────────────────────────
  mkRequest({
    title: 'Endpoint antivirus renewal (250 seats)',
    description: 'Annual renewal of the endpoint protection suite for all corporate devices.',
    department: 'IT',
    costCenter: 'CC-3300',
    category: 'it_software',
    sourcingMethod: 'rfq',
    requesterName: 'Jules Aquino',
    requesterEmail: 'bi@mwell.demo',
    vendorId: 'ven-techbridge',
    vendorName: 'TechBridge IT Solutions, Inc.',
    neededByDays: 21,
    createdDaysAgo: 3,
    lines: [{ description: 'Endpoint protection license (per seat, 12 mo)', quantity: 250, uom: 'seat', unitPrice: 720 }],
    justification: {
      need: 'Current licenses lapse in 3 weeks; unprotected endpoints breach our cyber-insurance terms.',
      risk: 'Coverage gap exposes patient-adjacent data to malware and voids the policy.',
    },
    ladder: { startDaysAgo: 1, approveCount: 0 },
  });

  mkRequest({
    title: 'Emergency aircon repair — server room',
    description: 'CRAC unit failure in the Pasig server room; temperature climbing.',
    department: 'Facilities',
    costCenter: 'CC-2200',
    category: 'services',
    sourcingMethod: 'emergency',
    requesterName: 'Marco Reyes',
    requesterEmail: 'ops@mwell.demo',
    neededByDays: 3,
    createdDaysAgo: 0,
    lines: [{ description: 'Emergency CRAC compressor replacement + labor', quantity: 1, uom: 'lot', unitPrice: 95000 }],
    justification: {
      need: 'Server room at 31°C and rising; hardware shutdown imminent.',
      alternatives: 'Portable coolers deployed as stopgap — insufficient overnight.',
      risk: 'Unplanned outage of the telehealth platform and warehouse systems.',
    },
    ladder: { startDaysAgo: 0, approveCount: 0 },
  });

  // ── Under review at specific tiers ───────────────────────────────────────
  // Legal tier pending (dept_head + procurement_head approved).
  mkRequest({
    title: 'Clinic fit-out — Cebu satellite site',
    description: 'Civil works, partitions and clinical-grade flooring for the new Cebu satellite clinic.',
    department: 'Clinic Operations',
    costCenter: 'CC-5100',
    category: 'construction',
    sourcingMethod: 'rfp',
    requesterName: 'Marta Ramos',
    requesterEmail: 'approver@mwell.demo',
    vendorId: 'ven-cornerstone',
    vendorName: 'Cornerstone Builders & Interiors Corp.',
    neededByDays: 90,
    createdDaysAgo: 12,
    lines: [
      { description: 'Civil + partition works', quantity: 1, uom: 'lot', unitPrice: 1450000 },
      { description: 'Clinical vinyl flooring (supply + install)', quantity: 380, uom: 'sqm', unitPrice: 2500 },
    ],
    justification: {
      need: 'Cebu satellite clinic committed to LGU partners for Q4 opening.',
      alternatives: 'Leasing a pre-fitted space was 40% costlier over 5 years.',
      risk: 'Missing the Q4 opening forfeits the LGU screening contract.',
    },
    ladder: { startDaysAgo: 9, approveCount: 2 },
  });

  // Finance tier pending (dept_head + procurement_head + legal approved).
  mkRequest({
    title: 'Nurse staffing agency contract — 12 months',
    description: 'Supplemental nursing manpower for mobile screening events nationwide.',
    department: 'Clinic Operations',
    costCenter: 'CC-5100',
    category: 'manpower',
    sourcingMethod: 'rfp',
    requesterName: 'Marta Ramos',
    requesterEmail: 'approver@mwell.demo',
    vendorId: 'ven-caregrid',
    vendorName: 'CareGrid Staffing Solutions, Inc.',
    neededByDays: 30,
    createdDaysAgo: 15,
    lines: [{ description: 'Registered nurse FTE (12-month deployment)', quantity: 8, uom: 'FTE', unitPrice: 228000 }],
    justification: {
      need: 'Screening calendar doubles in H2; internal nursing pool is fully allocated.',
      risk: 'Events run under-staffed → longer queues, missed screening targets.',
    },
    ladder: { startDaysAgo: 11, approveCount: 3 },
  });

  // Final approver (CFO/DOA) pending — everything else approved.
  mkRequest({
    title: 'Telehealth platform subscription — enterprise tier',
    description: 'Upgrade to the enterprise tier: SSO, audit exports, 99.9% SLA.',
    department: 'IT',
    costCenter: 'CC-3300',
    category: 'subscription',
    sourcingMethod: 'rfq',
    requesterName: 'Jules Aquino',
    requesterEmail: 'bi@mwell.demo',
    vendorId: 'ven-techbridge',
    vendorName: 'TechBridge IT Solutions, Inc.',
    neededByDays: 14,
    createdDaysAgo: 18,
    lines: [{ description: 'Enterprise tier subscription (annual)', quantity: 1, uom: 'yr', unitPrice: 950000 }],
    ladder: { startDaysAgo: 14, approveCount: 4 },
  });

  // ── Fully approved (feed the POs below) ──────────────────────────────────
  const reqBooth = mkRequest({
    title: 'Event booth — SM Megamall health fair',
    department: 'Marketing',
    costCenter: 'CC-6100',
    category: 'marketing',
    sourcingMethod: 'rfq',
    requesterName: 'Kai Mendoza',
    requesterEmail: 'marketing@mwell.demo',
    vendorId: 'ven-eventworks',
    vendorName: 'EventWorks Productions, Inc.',
    neededByDays: 20,
    createdDaysAgo: 25,
    lines: [
      { description: 'Booth construction + branding (6x6m)', quantity: 1, uom: 'lot', unitPrice: 185000 },
      { description: 'On-site staffing (3 days)', quantity: 1, uom: 'lot', unitPrice: 55000 },
    ],
    ladder: { startDaysAgo: 22, approveCount: 99 },
  });

  const reqRings = mkRequest({
    title: 'ECG ring replenishment — 200 units',
    description: 'Bulk replenishment across all ring sizes for H2 screening events.',
    department: 'Warehouse & Logistics',
    costCenter: 'CC-4100',
    category: 'medical',
    sourcingMethod: 'rfp',
    requesterName: 'Bea Santos',
    requesterEmail: 'logistics@mwell.demo',
    vendorId: 'ven-acme',
    vendorName: 'Acme Medical Supplies, Inc.',
    neededByDays: 10,
    createdDaysAgo: 45,
    lines: [{ description: 'ECG ring (assorted sizes 6–11)', quantity: 200, uom: 'pc', unitPrice: 8000 }],
    justification: {
      need: 'H2 screening calendar needs 200 additional rings across sizes.',
      risk: 'Ring shortage caps daily screening throughput at 60%.',
    },
    ladder: { startDaysAgo: 40, approveCount: 99 },
  });

  const reqRacking = mkRequest({
    title: 'Warehouse racking upgrade — Pasig',
    description: 'Selective pallet racking for the expanded device storage area.',
    department: 'Warehouse & Logistics',
    costCenter: 'CC-4100',
    category: 'capex',
    sourcingMethod: 'rfp',
    requesterName: 'Bea Santos',
    requesterEmail: 'logistics@mwell.demo',
    vendorId: 'ven-north-star',
    vendorName: 'North Star Logistics Corp.',
    neededByDays: 0,
    createdDaysAgo: 75,
    lines: [{ description: 'Selective pallet racking (supply + install)', quantity: 12, uom: 'bay', unitPrice: 62500 }],
    ladder: { startDaysAgo: 70, approveCount: 99 },
  });

  const reqShirts = mkRequest({
    title: 'Branded field-staff apparel — H2 batch',
    department: 'Marketing',
    costCenter: 'CC-6100',
    category: 'marketing',
    sourcingMethod: 'rfq',
    requesterName: 'Kai Mendoza',
    requesterEmail: 'marketing@mwell.demo',
    vendorId: 'ven-brightpath',
    vendorName: 'BrightPath Print & Signage',
    neededByDays: 35,
    createdDaysAgo: 8,
    lines: [
      { description: 'Staff shirt (assorted S–XL)', quantity: 300, uom: 'pc', unitPrice: 260 },
      { description: 'Field jacket (assorted S–XL)', quantity: 120, uom: 'pc', unitPrice: 350 },
    ],
    ladder: { startDaysAgo: 5, approveCount: 99 },
  });

  // ── Rejected ─────────────────────────────────────────────────────────────
  mkRequest({
    title: 'Executive offsite — Boracay leadership summit',
    department: 'HR & Admin',
    costCenter: 'CC-1100',
    category: 'services',
    sourcingMethod: 'rfq',
    requesterName: 'Kai Mendoza',
    requesterEmail: 'marketing@mwell.demo',
    neededByDays: 60,
    createdDaysAgo: 30,
    lines: [{ description: 'Venue + accommodation package (25 pax)', quantity: 1, uom: 'lot', unitPrice: 680000 }],
    ladder: {
      startDaysAgo: 26,
      approveCount: 2,
      rejectNote: 'Defer to Q1 next year — H2 budget is committed to the Cebu clinic fit-out.',
    },
  });

  // ── Purchase orders ──────────────────────────────────────────────────────
  // Draft PO from the approved apparel request.
  mkPO({
    requestId: reqShirts.id,
    vendorId: 'ven-brightpath',
    vendorName: 'BrightPath Print & Signage',
    status: 'draft',
    createdDaysAgo: 3,
    expectedDays: 30,
    notes: 'Awaiting final artwork sign-off from Marketing before issue.',
    lines: [
      { description: 'Staff shirt (assorted S–XL)', quantity: 300, uom: 'pc', unitPrice: 260 },
      { description: 'Field jacket (assorted S–XL)', quantity: 120, uom: 'pc', unitPrice: 350 },
    ],
  });

  // Pending approval — standalone consumables top-up.
  mkPO({
    vendorId: 'ven-acme',
    vendorName: 'Acme Medical Supplies, Inc.',
    status: 'pending_approval',
    createdDaysAgo: 2,
    expectedDays: 14,
    notes: 'Q3 clinic consumables top-up (repeat order pricing).',
    lines: [
      { description: 'Examination gloves (box of 100)', quantity: 400, uom: 'box', unitPrice: 450 },
      { description: 'Alcohol 70% (1L)', quantity: 260, uom: 'btl', unitPrice: 500 },
    ],
  });

  // Approved (signed) — awaiting issue.
  mkPO({
    vendorId: 'ven-acme',
    vendorName: 'Acme Medical Supplies, Inc.',
    status: 'approved',
    createdDaysAgo: 6,
    approvedDaysAgo: 4,
    expectedDays: 21,
    notes: 'Annual lab reagents supply agreement — release on schedule.',
    lines: [{ description: 'Lab reagent bundle (quarterly release)', quantity: 4, uom: 'release', unitPrice: 105000 }],
  });

  // Issued — event booth (linked to the approved request).
  mkPO({
    requestId: reqBooth.id,
    vendorId: 'ven-eventworks',
    vendorName: 'EventWorks Productions, Inc.',
    status: 'issued',
    createdDaysAgo: 20,
    approvedDaysAgo: 19,
    expectedDays: 12,
    lines: [
      { description: 'Booth construction + branding (6x6m)', quantity: 1, uom: 'lot', unitPrice: 185000 },
      { description: 'On-site staffing (3 days)', quantity: 1, uom: 'lot', unitPrice: 55000 },
    ],
  });

  // Issued + partially received — ECG rings (120 of 200 in).
  mkPO({
    requestId: reqRings.id,
    vendorId: 'ven-acme',
    vendorName: 'Acme Medical Supplies, Inc.',
    status: 'issued',
    createdDaysAgo: 38,
    approvedDaysAgo: 37,
    expectedDays: 7,
    notes: 'Split delivery agreed: 120 units advance batch, 80 to follow.',
    lines: [{ description: 'ECG ring (assorted sizes 6–11)', quantity: 200, uom: 'pc', unitPrice: 8000, received: 120 }],
    receipts: [
      { daysAgo: 9, byEmail: 'logistics@mwell.demo', note: 'Advance batch — 120 units, all serials scanned.' },
    ],
  });

  // Closed — racking fully delivered + installed.
  mkPO({
    requestId: reqRacking.id,
    vendorId: 'ven-north-star',
    vendorName: 'North Star Logistics Corp.',
    status: 'closed',
    createdDaysAgo: 65,
    approvedDaysAgo: 64,
    expectedDays: -20,
    lines: [{ description: 'Selective pallet racking (supply + install)', quantity: 12, uom: 'bay', unitPrice: 62500, received: 12 }],
    receipts: [
      { daysAgo: 22, byEmail: 'logistics@mwell.demo', note: 'All 12 bays installed and load-tested.', closes: true },
    ],
  });

  // Cancelled — superseded maintenance contract.
  mkPO({
    vendorId: 'ven-techbridge',
    vendorName: 'TechBridge IT Solutions, Inc.',
    status: 'cancelled',
    createdDaysAgo: 50,
    notes: 'Cancelled — legacy printers decommissioned under the new managed-print contract.',
    lines: [{ description: 'Legacy printer maintenance (annual)', quantity: 1, uom: 'yr', unitPrice: 45000 }],
  });

  // Warehouse-origin PO — raised from the warehouse procurement page.
  mkPO({
    vendorId: 'ven-acme',
    vendorName: 'Acme Medical Supplies, Inc.',
    status: 'issued',
    origin: 'warehouse',
    actorEmail: 'logistics@mwell.demo',
    createdDaysAgo: 4,
    approvedDaysAgo: 3,
    expectedDays: 10,
    notes: 'Reorder-point trigger: OTG bags below threshold.',
    lines: [{ description: 'OTG bag (courier-ready)', quantity: 50, uom: 'pc', unitPrice: 3000 }],
  });

  return { requests, purchaseOrders, approvals };
}

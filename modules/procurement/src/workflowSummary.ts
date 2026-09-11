import type { WorkflowSummaryProps } from '@intra/ui';
import type { ProcurementRequest, PurchaseOrder } from './types';
import { tierLabel } from './policy';

type Summary = Omit<WorkflowSummaryProps, 'children'>;

export function requestWorkflowSummary(
  request: Pick<ProcurementRequest, 'status' | 'approvalSteps' | 'compliance'>,
  submitGate: { allowed: boolean; blockers: string[] },
  hasLinkedPo: boolean,
): Summary {
  switch (request.status) {
    case 'cancelled':
      return { status: 'Cancelled', owner: 'No further request action', nextStep: 'Review the retained request and cancellation history.' };
    case 'rejected':
      return { status: 'Rejected', owner: 'Requester', nextStep: 'Review the rejection note, then revise the request for resubmission.', blocker: 'Approval was rejected; this request cannot proceed to a purchase order.', tone: 'warning' };
    case 'draft':
      return {
        status: 'Draft',
        owner: request.compliance?.routeConfirmed ? 'Requester' : 'Procurement / requester',
        nextStep: submitGate.allowed ? 'Requester reviews the request and submits for approval.' : 'Complete the request requirements and Procurement route confirmation before submission.',
        blocker: submitGate.allowed ? undefined : submitGate.blockers.join('; ') || 'Submission requirements are not verified.',
        tone: submitGate.allowed ? 'neutral' : 'warning',
      };
    case 'submitted':
    case 'under_review': {
      const pending = request.approvalSteps?.filter(step => step.status === 'pending').sort((a, b) => a.order - b.order)[0];
      return {
        status: request.status === 'submitted' ? 'Submitted' : 'Under review',
        owner: pending ? `${pending.label || tierLabel(pending.tier)} review` : 'Procurement',
        nextStep: pending ? 'The authorized reviewer handles the pending step in the approval inbox.' : 'Verify the current approval routing before taking further action.',
        blocker: pending ? 'A pending approval decision is required.' : 'No pending approval step is available in this record.',
        tone: pending ? 'neutral' : 'warning',
      };
    }
    case 'approved':
      return { status: 'Approved', owner: 'Procurement', nextStep: hasLinkedPo ? 'Review the linked purchase order for its current handoff and blockers.' : 'Review the approved request and vendor before authoring a purchase order.' };
    default:
      return { status: 'Status unrecognized', owner: 'Procurement', nextStep: 'Verify the request status before proceeding.', blocker: 'The next workflow step cannot be determined from this status.', tone: 'warning' };
  }
}

export function purchaseOrderWorkflowSummary(
  po: Pick<PurchaseOrder, 'status' | 'commitmentReadiness' | 'lifecycle' | 'receiptStatus' | 'paymentReadiness'>,
  context: { prerequisiteError?: string; prerequisiteBlockers?: string[]; closurePending?: boolean } = {},
): Summary {
  // PO closure is not evidence of financial settlement.
  if (po.status === 'closed') {
    const payment = po.paymentReadiness;
    if (payment?.evidenceStale || payment?.status === 'returned' || payment?.status === 'superseded' || payment?.status === 'draft') return {
      status: 'Closed', owner: 'Procurement / Finance',
      nextStep: 'Review and correct the linked payment evidence. PO closure does not confirm settlement.',
      blocker: payment.financeNote || 'Payment evidence needs correction or verification before further Finance action.', tone: 'warning',
    };
    const outstandingPayment = typeof payment?.invoiceAmount === 'number' && Number.isFinite(payment.invoiceAmount)
      && typeof payment.releasedAmount === 'number' && Number.isFinite(payment.releasedAmount)
      && payment.invoiceAmount > payment.releasedAmount;
    if (payment?.status === 'ready_for_finance' || payment?.status === 'accepted' || outstandingPayment) return {
      status: 'Closed', owner: 'Finance',
      nextStep: 'Review linked payment evidence, the remaining balance, and release requirements. PO closure and accepted evidence do not authorize payment release.',
      blocker: outstandingPayment ? 'The recorded invoice amount exceeds the recorded released amount.' : 'Payment review or release verification remains required.', tone: 'warning',
    };
    return {
      status: 'Closed', owner: 'Procurement / Finance',
      nextStep: 'Verify linked payment and settlement records. PO closure does not confirm settlement.',
      blocker: !payment ? 'Payment status is unavailable.' : context.prerequisiteError,
      tone: !payment || context.prerequisiteError ? 'warning' : 'neutral',
    };
  }
  if (po.status === 'cancelled') return { status: 'Cancelled', owner: 'No further PO action', nextStep: 'Review cancellation and retained downstream records; do not issue this PO.' };
  if (!['draft', 'pending_approval', 'approved', 'issued'].includes(po.status)) return { status: 'Status unrecognized', owner: 'Procurement', nextStep: 'Verify the purchase order status before proceeding.', blocker: 'The next workflow step cannot be determined from this status.', tone: 'warning' };
  if (context.prerequisiteError) return {
    status: po.status === 'issued' ? 'Issued / readiness unavailable' : 'Readiness unavailable',
    owner: 'Procurement',
    nextStep: po.status === 'issued' ? 'Retry the readiness read to verify the current handoff. This PO is already issued.' : 'Retry policy readiness before approval or issue.',
    blocker: context.prerequisiteError, tone: 'warning',
  };
  if (po.status !== 'issued') {
    const blockers = context.prerequisiteBlockers ?? po.commitmentReadiness?.blockers;
    const blocked = Boolean(blockers?.length) || po.commitmentReadiness?.ready !== true;
    return {
      status: po.status === 'approved' ? 'Approved' : po.status === 'pending_approval' ? 'Pending approval' : 'Draft',
      owner: blocked ? 'Procurement' : po.status === 'approved' ? 'Procurement' : 'Authorized award approver',
      nextStep: blocked ? 'Review the source award, vendor eligibility, and commitment controls.' : po.status === 'approved' ? 'Review the approved PO package before issuing to the vendor.' : 'Review the award and use the authorized approval action.',
      blocker: blockers?.length ? blockers.join('; ') : blocked ? 'Commitment readiness is not verified.' : undefined,
      tone: blocked ? 'warning' : 'neutral',
    };
  }
  if (context.closurePending) return { status: 'Closure awaiting review', owner: 'Independent final approver', nextStep: 'Review the governed closure request and its reason before approving.' };
  const payment = po.paymentReadiness;
  if (payment?.evidenceStale || payment?.status === 'returned' || payment?.status === 'superseded') return { status: 'Payment evidence needs correction', owner: 'Procurement / Finance', nextStep: 'Review the payment handoff and correct or replace the evidence before further release.', blocker: payment.financeNote || 'Payment evidence is returned, superseded, or stale.', tone: 'warning' };
  if (po.lifecycle && ['vendor_notice', 'replacement_rma', 'payment_hold'].includes(po.lifecycle.qualityRecoveryStatus)) return { status: 'Quality recovery open', owner: 'Procurement / Warehouse', nextStep: 'Review quality recovery and coordinate the vendor response.', blocker: po.lifecycle.qualityRecoveryStatus.replaceAll('_', ' '), tone: 'warning' };
  if (po.lifecycle?.acknowledgementStatus === 'pending' || po.lifecycle?.acknowledgementStatus === 'overdue') return { status: 'Awaiting vendor acknowledgement', owner: 'Vendor / Procurement follow-up', nextStep: 'Vendor acknowledges the issued package; Procurement follows up as needed.', blocker: po.lifecycle.acknowledgementStatus === 'overdue' ? 'Vendor acknowledgement is overdue.' : undefined, tone: po.lifecycle.acknowledgementStatus === 'overdue' ? 'warning' : 'neutral' };
  const outstanding = po.receiptStatus?.outstandingQuantity;
  if (typeof outstanding === 'number' && Number.isFinite(outstanding) && outstanding > 0) {
    const financeReview = payment?.status === 'accepted' || payment?.status === 'ready_for_finance';
    return {
      status: 'Receiving incomplete', owner: financeReview ? 'Warehouse / Finance' : 'Warehouse / Procurement',
      nextStep: financeReview ? 'Warehouse reviews outstanding receiving; Finance reviews the payment evidence and its accepted scope. Payment status alone does not authorize release.' : 'Review receiving and coordinate outstanding delivery or QC acceptance.',
      blocker: `${outstanding} units are not yet QC accepted.`, tone: 'warning',
    };
  }
  const rejected = po.receiptStatus?.rejectedOrQuarantinedQuantity;
  if (typeof rejected === 'number' && Number.isFinite(rejected) && rejected > 0) return { status: 'Receipt quality exception', owner: 'Warehouse / Procurement', nextStep: 'Review rejected or quarantined receipts and coordinate quality recovery.', blocker: 'Rejected or quarantined quantities remain recorded.', tone: 'warning' };
  if (payment?.status === 'ready_for_finance') return { status: 'Payment awaiting review', owner: 'Finance reviewer', nextStep: 'Review acceptance and payment evidence in the payment handoff.' };
  if (payment?.status === 'accepted') return { status: 'Payment evidence accepted', owner: 'Authorized Finance releaser', nextStep: 'Review the remaining balance and release requirements in the payment handoff. Accepted evidence alone does not authorize release.' };
  if (po.lifecycle?.closureStatus === 'ready') return { status: 'Closure ready for request', owner: 'Procurement', nextStep: 'Review completed obligations and enter a reason to request governed closure.' };
  if (po.lifecycle?.closureStatus === 'blocked') return { status: 'Closure blocked', owner: 'Procurement', nextStep: 'Review open monitoring items and downstream obligations before requesting closure.', blocker: 'The recorded lifecycle blocks closure.', tone: 'warning' };
  return {
    status: 'Issued', owner: 'Procurement',
    nextStep: 'Review receiving, acceptance, payment, and monitoring records to confirm the next handoff.',
    blocker: !po.receiptStatus || !po.paymentReadiness || !po.lifecycle ? 'Some downstream status is unavailable; completion is not verified.' : undefined,
    tone: !po.receiptStatus || !po.paymentReadiness || !po.lifecycle ? 'warning' : 'neutral',
  };
}

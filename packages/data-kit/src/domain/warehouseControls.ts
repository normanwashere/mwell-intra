export type OperationTypeCode =
  | 'receipt'
  | 'putaway'
  | 'transfer'
  | 'issue'
  | 'return'
  | 'vendor_return'
  | 'cycle_count'
  | 'adjustment';

export type ControlledLocationType = 'warehouse' | 'event_site' | 'vendor';

export interface OperationType {
  id: string;
  code: OperationTypeCode;
  label: string;
  active: boolean;
}

export interface OperationRoute {
  id: string;
  operationTypeId: string;
  sourceLocationTypes: ControlledLocationType[];
  destinationLocationTypes: ControlledLocationType[];
  requiresEvidence: boolean;
  requiresApproval: boolean;
  requiresOnline: boolean;
  active: boolean;
}

export type QualityDisposition =
  'pending' | 'accepted' | 'damaged' | 'hold' | 'vendor_return' | 'unavailable';

export interface QualityInspection {
  id: string;
  sourceType: 'receipt' | 'return';
  sourceId: string;
  productId: string;
  binId?: string;
  lotId?: string;
  serialNumber?: string;
  quantity: number;
  disposition: QualityDisposition;
  reason?: string;
  evidenceUrls: string[];
  inspectedBy: string;
  inspectedAt: string;
}

export interface InventoryHold {
  id: string;
  inspectionId: string;
  productId: string;
  locationId: string;
  binId?: string;
  lotId?: string;
  serialNumber?: string;
  quantity: number;
  status: 'active' | 'released' | 'vendor_return' | 'written_off';
  reason: string;
  createdBy: string;
  createdAt: string;
  releasedBy?: string;
  releasedAt?: string;
}

export interface VendorReturn {
  id: string;
  holdId: string;
  supplierId: string;
  sourceReceiptId?: string;
  sourceReturnId?: string;
  productId: string;
  lotId?: string;
  serialNumber?: string;
  quantity: number;
  reason: string;
  reference: string;
  status: 'draft' | 'ready' | 'handed_off' | 'completed' | 'cancelled';
  evidenceUrls: string[];
  createdBy: string;
  createdAt: string;
  handedOffBy?: string;
  handedOffAt?: string;
  completedAt?: string;
}

export interface WarehouseException {
  id: string;
  type: 'quality' | 'count_variance' | 'po_receipt' | 'scan_mismatch' | 'import';
  severity: 'P1' | 'P2' | 'P3';
  sourceType: string;
  sourceId: string;
  status: 'open' | 'in_progress' | 'resolved' | 'waived' | 'cancelled';
  ownerId?: string;
  dueAt?: string;
  resolution?: string;
  createdAt: string;
}

export interface StockChangeRequest {
  id: string;
  sourceType: 'cycle_count' | 'adjustment' | 'write_off';
  sourceId: string;
  productId: string;
  locationId: string;
  binId?: string;
  quantityDelta: number;
  unitCost: number;
  financialImpact: number;
  reason: string;
  evidenceUrls: string[];
  status: 'pending_supervisor' | 'pending_finance' | 'approved' | 'rejected';
  requestedBy: string;
  requestedAt: string;
}

export interface WarehouseTask {
  id: string;
  type: 'quality' | 'putaway' | 'cycle_count' | 'exception';
  sourceId: string;
  title: string;
  status: 'due' | 'blocked' | 'completed';
  assigneeId?: string;
  dueAt?: string;
  completedAt?: string;
}

export interface InventoryPosition {
  productId: string;
  locationId: string;
  binId?: string;
  onHand: number;
  committed: number;
  held: number;
  unavailable: number;
  available: number;
}

export interface PageQuery {
  cursor?: string;
  limit?: number;
  status?: string;
  search?: string;
}

export interface NormalizedPageQuery extends Omit<PageQuery, 'limit'> {
  limit: number;
}

export interface PageResult<T> {
  rows: T[];
  nextCursor?: string;
  total?: number;
}

export interface InspectQualityInput {
  idempotencyKey: string;
  sourceType: QualityInspection['sourceType'];
  sourceId: string;
  productId: string;
  binId?: string;
  lotId?: string;
  serialNumber?: string;
  quantity: number;
  disposition: Exclude<QualityDisposition, 'pending'>;
  reason?: string;
  evidenceUrls?: string[];
}

export interface ReleaseHoldInput {
  idempotencyKey: string;
  holdId: string;
  targetDisposition: Exclude<QualityDisposition, 'pending' | 'hold'>;
  reason: string;
  evidenceUrls?: string[];
}

export interface CreateVendorReturnInput {
  idempotencyKey: string;
  holdId: string;
  supplierId: string;
  reason: string;
  reference: string;
  evidenceUrls?: string[];
}

export interface UpdateOperationRouteInput {
  idempotencyKey: string;
  routeId: string;
  patch: Pick<
    OperationRoute,
    | 'sourceLocationTypes'
    | 'destinationLocationTypes'
    | 'requiresEvidence'
    | 'requiresApproval'
    | 'requiresOnline'
    | 'active'
  >;
}

export interface SubmitCycleCountInput {
  idempotencyKey: string;
  cycleCountId: string;
  reason: string;
  evidenceUrls?: string[];
}

export interface DecideStockChangeInput {
  idempotencyKey: string;
  requestId: string;
  decision: 'approved' | 'rejected';
  note?: string;
}

export interface ResolveExceptionInput {
  idempotencyKey: string;
  exceptionId: string;
  action: 'assign' | 'begin' | 'resolve' | 'waive' | 'cancel';
  ownerId?: string;
  resolution?: string;
  evidenceUrls?: string[];
}

export interface ProcurementPOHandoff {
  id: string;
  poNumber: string;
  vendorName: string;
  status: 'approved' | 'issued';
  expectedDate?: string;
  lines: Array<{
    id: string;
    productId?: string;
    description: string;
    quantity: number;
    receivedQuantity: number;
    uom?: string;
  }>;
}

export interface ReceiveProcurementPOInput {
  idempotencyKey: string;
  poId: string;
  locationId: string;
  binId?: string;
  lines: Array<{
    lineId: string;
    productId: string;
    quantity: number;
    lotCode?: string;
    expiryDate?: string;
    serialNumbers?: string[];
  }>;
  evidenceUrls?: string[];
}

export type ExpiryRisk = 'not_tracked' | 'expired' | 'warning' | 'ok';
export type StockChangeApprovalTier = 'logistics_supervisor' | 'finance';

export function availableAfterControls(input: {
  onHand: number;
  committed: number;
  held: number;
  unavailable: number;
}): number {
  return Math.max(0, input.onHand - input.committed - input.held - input.unavailable);
}

export function approvalTiersForStockChange(input: {
  quantityDelta: number;
  unitCost: number;
}): StockChangeApprovalTier[] {
  return Math.abs(input.quantityDelta * input.unitCost) > 10_000
    ? ['logistics_supervisor', 'finance']
    : ['logistics_supervisor'];
}

export function canTransitionInspection(from: QualityDisposition, to: QualityDisposition): boolean {
  const allowed: Record<QualityDisposition, readonly QualityDisposition[]> = {
    pending: ['accepted', 'damaged', 'hold', 'vendor_return', 'unavailable'],
    hold: ['accepted', 'damaged', 'vendor_return', 'unavailable'],
    accepted: [],
    damaged: [],
    vendor_return: [],
    unavailable: [],
  };
  return allowed[from].includes(to);
}

export function canActorApproveStockChange(requestedBy: string, actor: string): boolean {
  return requestedBy !== actor;
}

export function cycleCountSubmissionStatus(
  lines: ReadonlyArray<{ expected: number; counted: number }>,
): 'approved' | 'pending_approval' {
  if (lines.length === 0) {
    throw new Error('A cycle count must contain at least one line.');
  }
  return lines.every((line) => line.expected === line.counted)
    ? 'approved'
    : 'pending_approval';
}

export function stockChangeStatusAfterDecision(input: {
  currentStatus: Extract<
    StockChangeRequest['status'],
    'pending_supervisor' | 'pending_finance'
  >;
  decision: 'approved' | 'rejected';
  financialImpact: number;
  requestedBy: string;
  actor: string;
  note?: string;
}): StockChangeRequest['status'] {
  if (!canActorApproveStockChange(input.requestedBy, input.actor)) {
    throw new Error('The requester cannot approve their own stock change.');
  }
  if (input.decision === 'rejected') {
    if (!input.note?.trim()) throw new Error('A rejection note is required.');
    return 'rejected';
  }
  if (input.currentStatus === 'pending_finance') return 'approved';
  return input.financialImpact > 10_000 ? 'pending_finance' : 'approved';
}

export function expiryRisk(
  expiryDate: string | undefined,
  warningDays: number,
  today: string,
): ExpiryRisk {
  if (!expiryDate) return 'not_tracked';
  const days = Math.floor((Date.parse(expiryDate) - Date.parse(today)) / 86_400_000);
  if (days < 0) return 'expired';
  return days <= warningDays ? 'warning' : 'ok';
}

export function normalizePageQuery(query: PageQuery): NormalizedPageQuery {
  const requested = query.limit ?? 50;
  if (!Number.isInteger(requested) || requested < 1) {
    throw new Error('Page limit must be between 1 and 100.');
  }
  return {
    ...(query.cursor ? { cursor: query.cursor } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.search ? { search: query.search } : {}),
    limit: Math.min(requested, 100),
  };
}

import { userFacingError, WorkflowSummary, RecordCopyActions } from '@intra/ui';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useReturnHistoryAnchor } from './useReturnHistoryAnchor';
import type {
  CustomerReturnCase,
  DepartmentRequestOption,
  DepartmentStockRequest,
  FulfillmentAction,
  FulfillmentOrder,
  InventoryUnit,
  KitDefinition,
  Product,
  ReKitWorkOrder,
  ReturnResolution,
  StockLevel,
  StorageArea,
} from "@intra/data-kit";
import { classifyRecord, normalizeSafeHttpsUrl, readRecordVisibility, recordIsVisible, RECORD_VIEWS } from "@intra/data-kit";
import { useWarehouse } from "@/app/store";
import { receiptAcknowledgmentBlockReason } from "@/domain/fulfillmentAcknowledgment";
import { FLOOR_WORK_PATH, isFloorWork, isReleasedFollowUp } from "@/domain/workQueues";
import { isStockQuantity, resolveProductScan } from "@/domain/productScan";
import {
  Badge,
  EmptyState,
  Field,
  PageHeader,
  Sheet,
  useToast,
} from "@/components/ui";
import { Icon } from "@/components/Icon";
import { BarcodeScanner } from "@/components/camera/BarcodeScanner";
import { EvidenceCapture } from "@/components/camera/EvidenceCapture";
import { EvidenceGallery } from "@/components/EvidenceGallery";
import { StockConversionPanel } from "@/components/StockConversionPanel";
import { BulkOrderImportSheet } from "@/components/fulfillment/BulkOrderImportSheet";
import { OrderIntakeSheet } from "@/components/fulfillment/OrderIntakeSheet";
import { OrderReference, shortOrderReference } from "@/components/fulfillment/OrderReference";
import { hasReturnableOrderCustody } from './fulfillmentReturnEligibility';
import { downloadText } from "@/app/download";
import { fulfillmentOrdersToCsv } from "@/domain/orderIntakeOptions";
import { useSession } from "@/auth/session";
import { actorName } from "@/domain/format";
import { orderWorkflowSummary, requestWorkflowSummary, returnWorkflowSummary } from "@/domain/workflowSummary";
import './FulfillmentPage.css';

// Warehouse mutations confirm success as a boolean, not a returned order record.
export function fulfillmentAdvanceSuccessMessage(
  order: Pick<FulfillmentOrder, "externalReference" | "deliveryMethod">,
  action: FulfillmentAction,
): string {
  if (action === "allocate")
    return `${order.externalReference} allocation recorded. Next: Warehouse operator starts picking the reserved order lines.`;
  if (action === "start_picking")
    return `${order.externalReference} picking started. Next: Warehouse operator confirms scanned quantities, serials, bins, and pick evidence before packing.`;
  if (action === "release") {
    const outcome = `${order.externalReference} release recorded.`;
    if (order.deliveryMethod === "shipment")
      return `${outcome} Next: Courier / Warehouse delivery team tracks delivery, then records proof-of-delivery reference and evidence. Release does not confirm delivery.`;
    if (["internal_handover", "event_handover", "third_party_transfer"].includes(order.deliveryMethod))
      return `${outcome} Next: The recipient or another authorized staff member confirms receipt with a reference and proof. The releasing operator cannot confirm receipt.`;
    return `${outcome} Next: Warehouse supervisor must verify the delivery method and next handoff. Release does not confirm receipt.`;
  }
  return `${order.externalReference} update recorded. Next: Warehouse supervisor verifies the current order before further handoff.`;
}

export function returnResolutionSuccessMessage(resolution: Exclude<ReturnResolution, "pending">): string {
  const nextStep = {
    replacement: "Warehouse reviews the linked replacement order for allocation and fulfillment; Customer Service confirms receipt and records the customer reference and closure evidence.",
    re_kit: "Warehouse creates a re-kit work order using the approved kit definition and inspected components; Customer Service confirms the final disposition and records the customer reference and closure evidence.",
    refund: "Customer Service confirms the refund outcome using the recorded Finance reference and records the customer reference and closure evidence.",
    vendor_return: "Warehouse coordinates the supplier return using the recorded RMA; Customer Service confirms the final disposition and records the customer reference and closure evidence.",
    write_off: "Customer Service confirms the final disposition and records the customer reference and closure evidence. Quality Control must verify any separate stock disposition.",
  }[resolution];
  return `Return resolution recorded (${titleCase(resolution)}). Next: ${nextStep}`;
}

function useEvidencePending() {
  const pendingKeys = useRef(new Set<string>());
  const [pending, setPending] = useState(false);
  const onBusyChange = useCallback((key: string, busy: boolean) => {
    if (busy) pendingKeys.current.add(key);
    else pendingKeys.current.delete(key);
    setPending(pendingKeys.current.size > 0);
  }, []);
  return { pending, pendingKeys, onBusyChange };
}

function receiptAcknowledgmentUnavailable(
  order: FulfillmentOrder,
  warehouse: ReturnType<typeof useWarehouse>,
  profileId?: string,
) {
  return receiptAcknowledgmentBlockReason(order, {
    actorIds: [warehouse.actor, warehouse.identityId, profileId],
    can: warehouse.can,
    requests: warehouse.data?.departmentStockRequests,
  });
}

function requestDate(value: string, dateOnly = false) {
  const date = new Date(dateOnly ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return dateOnly
    ? date.toLocaleDateString("en-PH", { dateStyle: "medium" })
    : date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

type WorkspaceTab = "orders" | "requests" | "returns" | "kits" | "conversion";

const TABS: Array<{ id: WorkspaceTab; label: string; shortLabel: string }> = [
  { id: "orders", label: "Orders and events", shortLabel: "Demand" },
  { id: "requests", label: "Department requests", shortLabel: "Requests" },
  { id: "returns", label: "Return cases", shortLabel: "Returns" },
  { id: "kits", label: "Kits and re-kits", shortLabel: "Kits" },
  { id: "conversion", label: "Stock conversion", shortLabel: "Convert" },
];

const STATUS_TONE = {
  received: "slate",
  allocated: "brand",
  picking: "cyan",
  packing: "amber",
  ready: "emerald",
  released: "emerald",
  cancelled: "rose",
  pending_approval: "amber",
  approved: "brand",
  rejected: "rose",
  issued: "emerald",
  closed: "slate",
  submitted: "brand",
  inspecting: "amber",
  decision_required: "rose",
  resolved: "emerald",
  draft: "slate",
  active: "emerald",
  retired: "slate",
  inspection: "amber",
  completed: "emerald",
} as const;

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function maskContact(value?: string) {
  if (!value) return "Not provided";
  if (value.length <= 7) return `${value.slice(0, 2)}***${value.slice(-2)}`;
  return `${value.slice(0, 4)}****${value.slice(-3)}`;
}

function maskEmail(value?: string) {
  if (!value) return "Not provided";
  const [name, domain] = value.split("@");
  return domain ? `${name?.slice(0, 1) ?? ""}***@${domain}` : "Not provided";
}

function formatPhp(value: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    currencyDisplay: "code",
  }).format(value);
}

function fulfillmentItemClass(product: Product) {
  return (
    product.itemClass ??
    (product.category === "device" ? "sellable_sku" : "merchandise")
  );
}

function isFulfillmentProduct(
  product: Product,
  source: "ecommerce" | "event" | "third_party",
) {
  const itemClass = fulfillmentItemClass(product);
  if (source === "ecommerce") {
    return itemClass === "sellable_sku" || itemClass === "re_kitted_item";
  }
  return [
    "sellable_sku",
    "re_kitted_item",
    "merchandise",
    "event_material",
  ].includes(itemClass);
}

function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = STATUS_TONE[status as keyof typeof STATUS_TONE] ?? "slate";
  return <Badge tone={tone}>{label ?? titleCase(status)}</Badge>;
}

function PhysicalReturnReference({ id }: { id: string }) {
  const { canOpenRoute } = useWarehouse();
  return canOpenRoute('returns')
    ? <Link className="block min-h-11 min-w-11 w-fit max-w-full py-3 underline" to={`/returns#return-${encodeURIComponent(id)}`}>{id}</Link>
    : <span className="block space-y-1 py-2"><span className="block break-all">{id}</span><span className="block text-muted">Physical intake recorded. Warehouse returns team owns custody and inspection follow-up.</span></span>;
}

function HandoffRail({
  steps,
}: {
  steps: Array<{ owner: string; task: string }>;
}) {
  return (
    <ol
      className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3"
      aria-label="Department handoff"
    >
      {steps.map((step, index) => (
        <li key={step.owner} className="relative min-w-0 bg-surface px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-500/10 text-xs font-bold text-brand-700 dark:text-brand-300">
              {index + 1}
            </span>
            <span className="truncate text-sm font-semibold text-ink">
              {step.owner}
            </span>
          </div>
          <p className="mt-1 pl-8 text-xs leading-5 text-muted">{step.task}</p>
        </li>
      ))}
    </ol>
  );
}

function SummaryStrip({
  orders,
  requests,
  returns,
  reKits,
  floorMode = false,
}: {
  orders: FulfillmentOrder[];
  requests: number;
  returns: CustomerReturnCase[];
  reKits: ReKitWorkOrder[];
  floorMode?: boolean;
}) {
  const stats = floorMode
    ? [
        {
          label: "Waiting allocation",
          value: orders.filter((row) => row.status === "received").length,
        },
        {
          label: "Picking",
          value: orders.filter((row) =>
            ["allocated", "picking"].includes(row.status),
          ).length,
        },
        {
          label: "Packing",
          value: orders.filter((row) => row.status === "packing").length,
        },
        {
          label: "Ready for release",
          value: orders.filter((row) => row.status === "ready").length,
        },
      ]
    : [
        {
          label: "Orders in progress",
          value: orders.filter(
            (row) =>
              !["released", "completed", "cancelled"].includes(row.status),
          ).length,
        },
        {
          label: "Ready to release",
          value: orders.filter((row) => row.status === "ready").length,
        },
        { label: "Requests awaiting decision", value: requests },
        {
          label: "Open returns / re-kits",
          value:
            returns.filter((row) => row.status !== "resolved").length +
            reKits.filter(
              (row) => !["completed", "cancelled"].includes(row.status),
            ).length,
        },
      ];
  return (
    <dl className="grid grid-cols-2 border-y border-line bg-surface sm:grid-cols-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="min-w-0 border-line px-3 py-3 sm:border-r sm:last:border-r-0"
        >
          <dt className="text-xs leading-4 text-muted">{stat.label}</dt>
          <dd className="mt-1 font-display text-xl font-bold text-ink">
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function QueueCounters({
  label,
  counters,
  selected,
  onSelect,
  compactMobile = false,
}: {
  label: string;
  counters: Array<{ id: string; label: string; count: number }>;
  selected: string;
  onSelect: (id: string) => void;
  compactMobile?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`${compactMobile ? 'hidden sm:grid' : 'grid'} min-w-0 grid-cols-2 auto-rows-fr gap-px border-y border-line bg-line ${counters.length === 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3'} ${counters.length === 6 ? 'xl:grid-cols-6' : counters.length === 4 ? 'xl:grid-cols-4' : 'xl:grid-cols-5'}`}
    >
      {counters.map((counter) => (
        <button
          key={counter.id}
          type="button"
          aria-label={`${counter.label}: ${counter.count}`}
          aria-pressed={selected === counter.id}
          onClick={() => onSelect(counter.id)}
          className={`flex min-h-11 min-w-0 flex-col justify-between border-b-2 px-3 py-3 text-left transition focus-visible:relative focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 ${selected === counter.id ? "border-brand-500 bg-brand-50 dark:bg-brand-900" : "border-transparent bg-surface hover:bg-inset"}`}
        >
          <span className="block min-h-8 break-words text-xs leading-4 text-muted">
            {counter.label}
          </span>
          <span className="mt-1 block font-display text-xl font-bold tabular-nums text-ink">
            {counter.count}
          </span>
        </button>
      ))}
    </div>
  );
}

function matchesOrderStatus(order: FulfillmentOrder, filter: string) {
  if (filter === "all") return true;
  if (filter === "active" || filter === "floor_work") return isFloorWork(order);
  if (filter === "released") return isReleasedFollowUp(order);
  if (filter === "pick_queue")
    return ["allocated", "picking"].includes(order.status);
  return order.status === filter;
}

const ORDER_STATUSES = ['active', 'floor_work', 'all', 'pick_queue', 'received', 'allocated', 'picking', 'packing', 'ready', 'released', 'completed', 'cancelled'];
const ORDER_STATUS_FILTERS: Array<{ value: FulfillmentOrder['status']; label: string }> = [
  { value: 'received', label: 'Awaiting allocation' },
  { value: 'allocated', label: 'Awaiting picking' },
  { value: 'picking', label: 'Picking' },
  { value: 'packing', label: 'Awaiting packing' },
  { value: 'ready', label: 'Awaiting release' },
  { value: 'released', label: 'Released follow-up' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];
const REQUEST_STATUSES = ['all', 'draft', 'pending_approval', 'approved', 'rejected', 'allocated', 'issued', 'closed', 'cancelled'];

function ordersInRecordView(orders: FulfillmentOrder[], params: URLSearchParams) {
  if (params.get('uat') !== '1') return orders;
  const view = readRecordVisibility(params.get('records'));
  return orders.filter(order => recordIsVisible(classifyRecord(order), view));
}

// Keep read-only navigation in history; action sheets and unsaved drafts stay local.
function useFulfillmentNavigation() {
  const [params, setParams] = useSearchParams();
  const latestParams = useRef(params);
  useEffect(() => { latestParams.current = params; }, [params]);
  const update = (values: Record<string, string | undefined>, replace = false) => {
    // React Router does not queue search-param updates like React state setters.
    const next = new URLSearchParams(latestParams.current);
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, value);
    }
    latestParams.current = next;
    setParams(next, { replace });
  };
  return { params, update };
}

function scopedRecord<T extends { id: string }>(rows: T[], selector: string | null) {
  if (!selector || !/^[a-zA-Z0-9_-]{1,128}$/.test(selector)) return undefined;
  return rows.find((row) => row.id === selector);
}

function UnavailableRecordSheet({ kind, onClose }: { kind: string; onClose: () => void }) {
  return <Sheet open title={`${kind} unavailable`} onOpenChange={(open) => { if (!open) onClose(); }}>
    <p className="text-sm text-muted">This record is not available in your current warehouse view. Close this panel to return to the queue, or refresh to check again.</p>
  </Sheet>;
}

export function FulfillmentPage() {
  const warehouse = useWarehouse();
  const { data, role, can, actor, identityId } = warehouse;
  const [searchParams, setSearchParams] = useSearchParams();

  const canCreateOrder = can("request_fulfillment");
  const canRequestStock = can("request_stock");
  const canApproveRequest = [
    "warehouse_supervisor",
    "logistics_supervisor",
    "warehouse_admin",
  ].includes(role);
  const canExecute = can("issue_items");
  const canIntakeReturn = can("submit_return_case");
  const canManageReturns = can("manage_returns");
  const canReadConversion = canManageReturns || can("inspect_quality");
  const canReviewFinanceReturn = can("approve_stock_adjustment_finance");
  const canDefineKits =
    [
      "warehouse_supervisor",
      "logistics_supervisor",
      "warehouse_admin",
    ].includes(role) && can("manage_products");
  const isFloorOperator = role === "warehouse_operator";
  const visibleTabs = TABS.filter((item) => {
    if (item.id === 'conversion') return canReadConversion;
    if (!isFloorOperator) return true;
    return item.id === 'orders' ||
      (item.id === 'requests' && canRequestStock) ||
      (item.id === 'returns' && (canIntakeReturn || canManageReturns || canReviewFinanceReturn));
  });
  const preferredTab: WorkspaceTab =
    role === "business_unit" || role === "marketing"
      ? "requests"
      : role === "finance"
        ? "returns"
        : "orders";
  const fallbackTab = visibleTabs.some((item) => item.id === preferredTab)
    ? preferredTab
    : (visibleTabs[0]?.id ?? "orders");
  const requestedTab = searchParams.get("tab");
  const tab = visibleTabs.some((item) => item.id === requestedTab)
    ? (requestedTab as WorkspaceTab)
    : fallbackTab;

  useEffect(() => {
    if (searchParams.get("tab") === tab) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", tab);
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams, tab]);

  if (!data) return null;

  const selectTab = (nextTab: WorkspaceTab) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", nextTab);
    nextParams.delete("order");
    nextParams.delete("request");
    setSearchParams(nextParams);
  };

  return (
    <div className="hierarchy-preview hp-fulfillment space-y-3 [&>.page-header-band]:!py-2">
      <PageHeader
        title={isFloorOperator ? "Pick & Pack" : "Fulfillment"}
        subtitle={
          isFloorOperator
            ? undefined
            : "One controlled queue from demand through warehouse release"
        }
        icon="list"
      />

      {tab !== "orders" && tab !== "requests" && (
        <SummaryStrip
          orders={data.fulfillmentOrders}
          requests={
            data.departmentStockRequests.filter(
              (row) => row.status === "pending_approval",
            ).length
          }
          returns={data.customerReturnCases}
          reKits={data.reKitWorkOrders}
          floorMode={isFloorOperator}
        />
      )}

      {visibleTabs.length > 1 && (
        <div
          className="grid grid-flow-col auto-cols-[minmax(5.5rem,1fr)] gap-1 overflow-x-auto rounded-lg bg-inset p-1 sm:auto-cols-fr"
          role="tablist"
          aria-label="Fulfillment workspace"
        >
          {visibleTabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-label={item.label}
              aria-selected={tab === item.id}
              onClick={() => selectTab(item.id)}
              className={`min-h-11 rounded-lg px-2 py-2 text-sm font-semibold transition ${
                tab === item.id
                  ? "bg-surface text-brand-700 shadow-e1 dark:text-brand-300"
                  : "text-muted hover:text-ink"
              }`}
            >
              <span className="sm:hidden">{item.shortLabel}</span>
              <span className="hidden sm:inline">{item.label}</span>
              {(item.id === "orders" || item.id === "requests") && (
                <span
                  className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-inset px-1.5 text-xs tabular-nums text-ink"
                  title={
                    item.id === "orders"
                      ? "Active orders and events"
                      : "Requests awaiting a decision"
                  }
                  aria-hidden="true"
                >
                  {item.id === "orders"
                    ? ordersInRecordView(data.fulfillmentOrders, searchParams).filter((order) =>
                        matchesOrderStatus(order, "active"),
                      ).length
                    : data.departmentStockRequests.filter(
                        (request) => request.status === "pending_approval",
                      ).length}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {tab === "orders" && (
        <OrdersWorkspace
          products={data.products}
          locations={data.locations}
          events={data.events}
          orders={data.fulfillmentOrders}
          storageAreas={data.storageAreas}
          units={data.units}
          stockLevels={data.stockLevels}
          canCreate={canCreateOrder}
          canExecute={canExecute}
          actorIds={[actor, identityId]}
          floorMode={isFloorOperator}
        />
      )}
      {tab === "requests" && (
        <RequestsWorkspace
          products={data.products}
          requests={data.departmentStockRequests}
          canCreate={canRequestStock}
          canApprove={canApproveRequest}
          department={role === "business_unit" ? "business_unit" : role}
          options={data.departmentRequestOptions}
        />
      )}
      {tab === "returns" && (
        <ReturnsWorkspace
          products={data.products}
          orders={data.fulfillmentOrders}
          returns={data.customerReturnCases}
          bins={data.storageAreas.filter((area) => area.active)}
          canCreate={canIntakeReturn}
          resolutionMode={
            canManageReturns
              ? "warehouse"
              : canReviewFinanceReturn
                ? "finance"
                : "read_only"
          }
        />
      )}
      {tab === "conversion" && canReadConversion && <StockConversionPanel />}
      {tab === "kits" && (
        <KitsWorkspace
          products={data.products}
          definitions={data.kitDefinitions}
          workOrders={data.reKitWorkOrders}
          returnCases={data.customerReturnCases}
          locations={data.locations}
          bins={data.storageAreas.filter((area) => area.active)}
          canCreate={canDefineKits}
          canReKit={canManageReturns}
        />
      )}
    </div>
  );
}

function orderPickLocation(
  order: FulfillmentOrder,
  locations: Array<{ id: string; name: string }>,
  storageAreas: StorageArea[],
): string {
  const source = locations.find((row) => row.id === order.sourceLocationId);
  if (source) return source.name;
  const pickedLines = order.lines.filter((line) => line.pickedQuantity > 0);
  const labels = [...new Set(pickedLines.map((line) => line.pickBinId))].map((id) => {
    if (!id) return "Pick location not recorded";
    const bin = storageAreas.find((row) => row.id === id);
    if (!bin) return "Recorded bin unavailable";
    const location = locations.find((row) => row.id === bin.locationId);
    const label = bin.label && bin.label !== bin.code ? ` (${bin.label})` : "";
    return `${location?.name ?? "Location unavailable"} / ${bin.code}${label}`;
  });
  if (labels.length) return labels.join("; ");
  return ["received", "allocated", "picking"].includes(order.status)
    ? "Pending pick"
    : "Pick location not recorded";
}

function OrdersWorkspace({
  products,
  locations,
  events,
  orders,
  canCreate,
  canExecute,
  actorIds,
  storageAreas,
  units,
  stockLevels,
  floorMode,
}: {
  products: Product[];
  locations: Array<{ id: string; name: string; type?: string }>;
  events: Array<{ id: string; name: string }>;
  orders: FulfillmentOrder[];
  canCreate: boolean;
  canExecute: boolean;
  actorIds: string[];
  storageAreas: StorageArea[];
  units: InventoryUnit[];
  stockLevels: StockLevel[];
  floorMode: boolean;
}) {
  const warehouse = useWarehouse();
  const { createFulfillmentOrder, advanceFulfillmentOrder } = warehouse;
  const { profile } = useSession();
  const { params: orderSearchParams, update: updateNavigation } = useFulfillmentNavigation();
  const queueOrders = ordersInRecordView(orders, orderSearchParams);
  const uatMode = orderSearchParams.get('uat') === '1';
  const recordView = uatMode ? readRecordVisibility(orderSearchParams.get('records')) : 'all';
  const loadOnlyCount = orders.filter(order => classifyRecord(order).purpose === 'load-only').length;
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [density, setDensity] = useState('compact');
  const [workingId, setWorkingId] = useState<string>();
  const [pickOrder, setPickOrder] = useState<FulfillmentOrder>();
  const [packOrder, setPackOrder] = useState<FulfillmentOrder>();
  const [backorderOrder, setBackorderOrder] = useState<FulfillmentOrder>();
  const [cancelOrder, setCancelOrder] = useState<FulfillmentOrder>();
  const [acknowledgeOrder, setAcknowledgeOrder] = useState<FulfillmentOrder>();
  const [trackingOrder, setTrackingOrder] = useState<FulfillmentOrder>();
  const [floorNotice, setFloorNotice] = useState<{ orderId: string; reference: string; message: string }>();
  const orderSelector = orderSearchParams.get("order");
  const detailOrder = scopedRecord(orders, orderSelector);
  const setDetailOrder = (order?: FulfillmentOrder) => updateNavigation({ order: order?.id, request: undefined }, !order);
  const query = (orderSearchParams.get("q") ?? "").slice(0, 200);
  const setQuery = (value: string) => updateNavigation({ q: value.slice(0, 200) }, true);
  const requestedStatus = orderSearchParams.get("status") ?? (orderSearchParams.get("filter") === "floor_work" ? "floor_work" : "active");
  const statusFilter = ORDER_STATUSES.includes(requestedStatus) ? requestedStatus : "active";
  const setStatusFilter = (value: string) => updateNavigation({ status: value, filter: undefined });
  const channelOptions = [
    ...new Set(
      orders.map((order) => order.ecommerceChannel).filter(Boolean) as string[],
    ),
  ].sort();
  const requestedChannel = orderSearchParams.get("channel") ?? "all";
  const channelFilter = channelOptions.includes(requestedChannel) ? requestedChannel : "all";
  const setChannelFilter = (value: string) => updateNavigation({ channel: value });
  const filteredOrders = queueOrders.filter((order) => {
    const normalized = query.trim().toLowerCase();
    const matchesQuery =
      !normalized ||
      [
        order.externalReference,
        order.customerName,
        order.customerReference,
        order.courier,
        order.waybillNumber,
      ].some((value) => value?.toLowerCase().includes(normalized));
    const matchesStatus = matchesOrderStatus(order, statusFilter);
    const matchesChannel =
      channelFilter === "all" || order.ecommerceChannel === channelFilter;
    return matchesQuery && matchesStatus && matchesChannel;
  });
  const thirdPartyOrders = orders.filter((order) => order.source === "third_party");
  const thirdPartySales = formatPhp(thirdPartyOrders.reduce((sum, order) => sum + (order.grossSalesAmount ?? 0), 0));

  const advance = async (
    order: FulfillmentOrder,
    action: FulfillmentAction,
  ) => {
    setFloorNotice(undefined);
    setWorkingId(order.id);
    const ok = await advanceFulfillmentOrder({ orderId: order.id, action });
    setWorkingId(undefined);
    if (ok) {
      if (action === "allocate" || action === "start_picking") {
        setFloorNotice({ orderId: order.id, reference: order.externalReference, message: action === "allocate" ? "Allocation recorded." : "Picking started." });
      } else toast.success(fulfillmentAdvanceSuccessMessage(order, action));
    }
  };

  return (
    <section className="space-y-2" aria-labelledby="orders-title">
      <QueueCounters
        label="Order counters"
        compactMobile
        counters={[
          { id: "active", label: "Active work" },
          { id: "received", label: "Waiting allocation" },
          { id: "pick_queue", label: "Picking" },
          { id: "packing", label: "Packing" },
          { id: "ready", label: "Ready for release" },
          { id: "released", label: "Released follow-up" },
        ].map((counter) => ({
          ...counter,
          count: queueOrders.filter((order) => matchesOrderStatus(order, counter.id))
            .length,
        }))}
        selected={statusFilter === "floor_work" ? "active" : statusFilter}
        onSelect={(status) => {
          updateNavigation({ status, filter: undefined, q: undefined, channel: undefined });
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 sm:items-end">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4">
          <h2
            id="orders-title"
            className="sr-only font-display text-lg font-bold text-ink sm:not-sr-only"
          >
            Orders and event demand
          </h2>
          <Link to={FLOOR_WORK_PATH} className="inline-flex min-h-11 min-w-11 items-center text-sm text-brand-600 underline">Floor work</Link>
        </div>
        {uatMode && <div className="order-last flex w-full items-center justify-between gap-2 text-xs sm:order-none sm:w-auto">
          <span>{recordView === 'operational' ? `${loadOnlyCount} load-only fixture${loadOnlyCount === 1 ? '' : 's'} hidden` : `UAT: ${RECORD_VIEWS.find(view => view.value === recordView)?.label}`}</span>
          {recordView !== 'all' && <button type="button" aria-label={`Show all records (${orders.length})`} title={`Show all records (${orders.length})`} className="btn-ghost min-h-11 shrink-0 px-2 text-xs" onClick={() => updateNavigation({ records: 'all' })}>All records ({orders.length})</button>}
        </div>}
        {(
          <div className="flex flex-wrap items-center gap-2">
            <details className="relative">
              <summary className="min-h-11 cursor-pointer rounded-lg px-3 py-3 text-sm font-semibold text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500">Queue tools</summary>
              <div className="z-20 grid w-80 max-w-[calc(100vw-2rem)] gap-2 rounded-lg border border-line bg-surface p-2 shadow-e2 sm:absolute sm:right-0">
                <Field label="Order density" htmlFor="fulfillment-density">
                  <select id="fulfillment-density" className="input" value={density} onChange={event => setDensity(event.target.value)}>
                    <option value="compact">Compact</option>
                    <option value="comfortable">Comfortable</option>
                  </select>
                </Field>
                {uatMode && <Field label="UAT record view" htmlFor="fulfillment-record-view">
                  <select id="fulfillment-record-view" className="input" value={recordView} onChange={event => updateNavigation({ records: event.target.value })}>
                    {RECORD_VIEWS.map(view => <option key={view.value} value={view.value}>{view.label}</option>)}
                  </select>
                </Field>}
                {thirdPartyOrders.length > 0 && <p className="p-2 text-sm text-muted">Third-party event sales: <span className="font-semibold text-ink">{thirdPartySales}</span>. Finance owns settlement.</p>}
                <details className="hp-guidance">
                  <summary>Department handoff</summary>
                  <HandoffRail steps={[
                    { owner: "Sales, Operations, or Marketing", task: "Submit confirmed customer, event, or campaign demand." },
                    { owner: "Warehouse operator", task: "Allocate, scan, pick, pack, and release." },
                    { owner: "Courier and Finance", task: "Carry the waybill, sales value, refund, and settlement evidence." },
                  ]} />
                </details>
            {filteredOrders.length > 0 && (
              <button
                type="button"
                className="btn-outline w-full sm:w-auto"
                onClick={() =>
                  downloadText(
                    `mwell-intra-orders-${new Date().toISOString().slice(0, 10)}.csv`,
                    fulfillmentOrdersToCsv(filteredOrders, products),
                  )
                }
              >
                <Icon name="download" className="h-4 w-4" /> Export current view
              </button>
            )}
            {canCreate && (
                <button
                  type="button"
                  className="btn-outline w-full sm:w-auto"
                  onClick={() => setImportOpen(true)}
                >
                  <Icon name="upload" className="h-4 w-4" /> Import existing
                  tracker
                </button>
            )}
              </div>
            </details>
            {canCreate && (
                <button
                  type="button"
                  aria-label="New order / demand"
                  title="New order / demand"
                  className="btn-primary h-11 w-11 shrink-0 justify-center p-0 sm:w-auto sm:px-4"
                  onClick={() => setCreateOpen(true)}
                >
                  <Icon name="plus" className="h-4 w-4" />
                  <span className="hidden sm:inline">New order / demand</span>
                </button>
            )}
          </div>
        )}
      </div>
      <div className="hp-toolbar grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 border-y border-line py-2 md:grid-cols-[minmax(14rem,1fr)_minmax(24rem,1fr)]">
        <Field label="Search orders" htmlFor="fulfillment-search">
          <input
            id="fulfillment-search"
            className="input"
            type="search"
            placeholder="Order, customer, courier, or waybill"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Field>
        <button type="button" className="btn-outline min-h-11 md:hidden" aria-expanded={filtersOpen} aria-controls="fulfillment-secondary-filters" onClick={() => setFiltersOpen(open => !open)}>
          <Icon name="list" className="h-4 w-4" /> Filters
        </button>
        <div id="fulfillment-secondary-filters" className={`${filtersOpen ? 'grid' : 'hidden'} col-span-2 min-w-0 grid-cols-2 gap-2 md:col-span-1 md:grid`}>
        <Field label="Status" htmlFor="fulfillment-status-filter">
          <select
            id="fulfillment-status-filter"
            className="input"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="active">Active work ({queueOrders.filter((order) => matchesOrderStatus(order, 'active')).length})</option>
            <option value="floor_work">Floor work ({queueOrders.filter((order) => matchesOrderStatus(order, 'floor_work')).length})</option>
            <option value="all">All statuses ({queueOrders.length})</option>
            <option value="pick_queue">Allocated and picking ({queueOrders.filter((order) => matchesOrderStatus(order, 'pick_queue')).length})</option>
            {ORDER_STATUS_FILTERS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label} ({queueOrders.filter((order) => matchesOrderStatus(order, value)).length})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Channel" htmlFor="fulfillment-channel-filter">
          <select
            id="fulfillment-channel-filter"
            className="input"
            value={channelFilter}
            onChange={(event) => setChannelFilter(event.target.value)}
          >
            <option value="all">All channels</option>
            {channelOptions.map((channel) => (
              <option key={channel} value={channel}>
                {channel}
              </option>
            ))}
          </select>
        </Field>
        </div>
      </div>

      {floorNotice && !filteredOrders.some((order) => order.id === floorNotice.orderId) && (
        <p role="status" className="text-sm font-medium text-emerald-700 [overflow-wrap:anywhere] dark:text-emerald-300">
          {floorNotice.reference}: {floorNotice.message}
        </p>
      )}
      {filteredOrders.length === 0 ? (
        <EmptyState
          icon="cart"
          title={
            canExecute ? "No orders ready to pick" : "No fulfillment demand"
          }
          message={
            canExecute
              ? "Allocated ecommerce, event, and approved department orders will appear here for scanning and packing."
              : "Confirmed ecommerce, event, and approved department demand will appear here for Warehouse execution."
          }
        />
      ) : (
        <ul
          className="divide-y divide-line border-y border-line"
          data-density={density}
          aria-label="Fulfillment demand"
        >
          {filteredOrders.map((order) => (
            <li
              key={order.id}
              aria-label={`Order ${order.externalReference}`}
              className={`grid min-w-0 items-start gap-2 px-2 py-2 text-sm xl:gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.85fr)_minmax(18rem,1.3fr)] ${density === 'comfortable' ? 'xl:py-5' : 'xl:py-2'}`}
            >
              <div className="contents min-w-0 xl:block">
                <div className="min-w-0">
                  <OrderReference reference={order.externalReference} orderId={order.id} />
                </div>
                <div className="order-3 min-w-0 xl:order-none">
                  <p className="mt-0.5 text-sm text-muted">
                    {order.ecommerceChannel ?? titleCase(order.source)} ·{" "}
                    {order.lines.reduce((sum, line) => sum + line.quantity, 0)}{" "}
                    item(s)
                  </p>
                  {order.customerName && (
                    <p className="mt-1 truncate text-xs font-medium text-ink">
                      {order.customerName}
                      {order.paymentStatus
                        ? ` · ${titleCase(order.paymentStatus)}`
                        : ""}
                    </p>
                  )}
                  {order.grossSalesAmount !== undefined && <p className="mt-1 text-sm font-semibold text-emerald-700 dark:text-emerald-300">{formatPhp(order.grossSalesAmount)}</p>}
                </div>
              </div>
              <div className="order-4 grid min-w-0 grid-cols-2 gap-2 text-sm xl:order-none xl:grid-cols-1 xl:gap-1">
                <div>
                  <span className="block text-xs text-faint">Pick location</span>
                  <span className="font-medium text-ink [overflow-wrap:anywhere]">
                    {orderPickLocation(order, locations, storageAreas)}
                  </span>
                </div>
                <div>
                  <span className="block text-xs text-faint">Destination</span>
                  <span className="block truncate font-medium text-ink" title={order.deliveryAddress ? `${order.deliveryAddress.addressLine}, ${order.deliveryAddress.city}, ${order.deliveryAddress.province}` : order.requestingDepartment ?? order.handoverRecipientName}>
                    {order.deliveryAddress ? `${order.deliveryAddress.city}, ${order.deliveryAddress.province}` : order.requestingDepartment ?? order.handoverRecipientName ?? 'Not provided'}
                  </span>
                </div>
              </div>
              <div className="order-1 flex min-w-0 flex-wrap items-center gap-2 xl:order-none xl:flex-col xl:items-start">
                <StatusBadge status={order.status} label={orderWorkflowSummary(order, { actorIds, units }).status} />
                <time className="text-xs text-muted" dateTime={order.createdAt} title={requestDate(order.createdAt)}>
                  {Number.isFinite(Date.parse(order.createdAt)) ? `${Math.max(0, Math.floor((Date.now() - Date.parse(order.createdAt)) / 86_400_000))}d old` : 'Age unavailable'}
                </time>
              </div>
              <div className="order-2 flex min-w-0 flex-wrap items-center gap-2 xl:order-none">
              <button
                type="button"
                aria-label="View order details"
                title="View order details"
                className="btn-ghost h-11 w-11 shrink-0 justify-center p-0"
                onClick={() => setDetailOrder(order)}
              >
                <span className="sr-only">View order details</span>
                <Icon name="chevron" className="h-4 w-4" />
              </button>
              {floorNotice?.orderId === order.id && (
                <p role="status" className="mt-3 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                  {floorNotice.message}
                </p>
              )}
              {canExecute &&
                !["released", "completed", "cancelled"].includes(
                  order.status,
                ) && (
                  <div className="contents">
                    {order.status === "received" && (
                      <>
                        <ActionButton
                          busy={workingId === order.id}
                          onClick={() => void advance(order, "allocate")}
                        >
                          Allocate stock
                        </ActionButton>
                      </>
                    )}
                    {order.status === "allocated" && (
                      <ActionButton
                        busy={workingId === order.id}
                        onClick={() => void advance(order, "start_picking")}
                      >
                        Start picking
                      </ActionButton>
                    )}
                    {order.status === "picking" && (
                      <ActionButton onClick={() => { setFloorNotice(undefined); setPickOrder(order); }}>
                        Confirm scanned pick
                      </ActionButton>
                    )}
                    {order.status === "packing" && (
                      <ActionButton onClick={() => { setFloorNotice(undefined); setPackOrder(order); }}>
                        {order.deliveryMethod === "shipment"
                          ? "Pack and add waybill"
                          : "Prepare accountable handover"}
                      </ActionButton>
                    )}
                    {order.status === "ready" &&
                      (actorIds.includes(order.packedBy ?? "") ? (
                        <p className="w-full rounded-lg bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-800 dark:text-amber-300">
                          Awaiting release by a second warehouse operator.
                        </p>
                      ) : (
                        <ActionButton
                          busy={workingId === order.id}
                          onClick={() => void advance(order, "release")}
                        >
                          {order.deliveryMethod === "shipment"
                            ? "Release shipment"
                            : "Release handover"}
                        </ActionButton>
                      ))}
                    <details className="relative ml-auto" onKeyDown={event => {
                      if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); }
                    }}>
                      <summary aria-label="More order actions" title="More order actions" className="btn-ghost grid h-11 w-11 cursor-pointer list-none place-items-center p-0 [&::-webkit-details-marker]:hidden">
                        <span className="sr-only">More order actions</span><Icon name="dots" className="h-4 w-4" />
                      </summary>
                      <div className="absolute right-0 z-20 grid w-48 gap-1 rounded-md border border-line bg-surface p-2 shadow-e2">
                        {order.status === 'received' && <button type="button" className="btn-outline min-h-11" onClick={() => setBackorderOrder(order)}>Split backorder</button>}
                        <button type="button" className="btn-outline min-h-11" onClick={() => setCancelOrder(order)}>Cancel</button>
                      </div>
                    </details>
                  </div>
                )}
              {order.status === "released" &&
                order.deliveryMethod !== "shipment" && (
                  receiptAcknowledgmentUnavailable(order, warehouse, profile?.id) ? (
                    <p className="mt-3 text-sm text-muted">
                      {receiptAcknowledgmentUnavailable(order, warehouse, profile?.id)}
                    </p>
                  ) : (
                  <button
                    type="button"
                    className="btn-primary mt-4 w-full sm:w-auto"
                    onClick={() => setAcknowledgeOrder(order)}
                  >
                    Acknowledge receipt
                  </button>
                  )
                )}
              {canExecute &&
                order.status === "released" &&
                order.deliveryMethod === "shipment" &&
                order.shipmentStatus !== "delivered" && (
                  <button
                    type="button"
                    className="btn-primary mt-4 w-full sm:w-auto"
                    onClick={() => setTrackingOrder(order)}
                  >
                    Update delivery
                  </button>
                )}
              {order.deliveryFailureReason && (
                <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-700 dark:text-rose-300">
                  Delivery exception: {order.deliveryFailureReason}
                </p>
              )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <OrderIntakeSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        products={products}
        locations={locations}
        events={events}
        create={createFulfillmentOrder}
      />
      <BulkOrderImportSheet
        open={importOpen}
        onOpenChange={setImportOpen}
        products={products.filter((product) =>
          isFulfillmentProduct(product, "ecommerce"),
        )}
        locations={locations}
        existingReferences={orders.map((order) => order.externalReference)}
        create={createFulfillmentOrder}
      />
      <PickSheet
        key={pickOrder?.id}
        order={pickOrder}
        products={products}
        storageAreas={storageAreas}
        units={units}
        stockLevels={stockLevels}
        onClose={() => setPickOrder(undefined)}
      />
      <PackSheet
        key={packOrder?.id}
        order={packOrder}
        products={products}
        onPacked={(order) => setFloorNotice({
          orderId: order.id,
          reference: order.externalReference,
          message: `${order.deliveryMethod === 'shipment' ? 'Packing confirmed.' : 'Handover prepared.'} Awaiting release by an operator other than the packer.`,
        })}
        onClose={() => setPackOrder(undefined)}
      />
      <BackorderSheet
        key={backorderOrder?.id}
        order={backorderOrder}
        products={products}
        onClose={() => setBackorderOrder(undefined)}
      />
      <CancelOrderSheet
        order={cancelOrder}
        onClose={() => setCancelOrder(undefined)}
      />
      <AcknowledgeReceiptSheet
        key={acknowledgeOrder?.id}
        order={acknowledgeOrder}
        onClose={() => setAcknowledgeOrder(undefined)}
      />
      <ShipmentTrackingSheet
        key={trackingOrder?.id}
        order={trackingOrder}
        onClose={() => setTrackingOrder(undefined)}
      />
      <OrderDetailsSheet
        key={detailOrder?.id}
        order={detailOrder}
        orders={orders}
        returnCases={warehouse.data?.customerReturnCases ?? []}
        onOpenOrder={setDetailOrder}
        products={products}
        storageAreas={storageAreas}
        showCommercial={!floorMode}
        onClose={() => setDetailOrder(undefined)}
      />
      {orderSelector !== null && !detailOrder && <UnavailableRecordSheet kind="Order" onClose={() => setDetailOrder(undefined)} />}
    </section>
  );
}

function OrderDetailsSheet({
  order,
  orders,
  returnCases,
  onOpenOrder,
  products,
  storageAreas,
  showCommercial,
  onClose,
}: {
  order?: FulfillmentOrder;
  orders: FulfillmentOrder[];
  returnCases: CustomerReturnCase[];
  onOpenOrder: (order: FulfillmentOrder) => void;
  products: Product[];
  storageAreas: StorageArea[];
  showCommercial: boolean;
  onClose: () => void;
}) {
  const { data, actor, identityId, can, canOpenRoute } = useWarehouse();
  if (!order) return null;
  const request = data?.departmentStockRequests.find(item => item.fulfillmentOrderId === order.id);
  const internal = order.source === 'department_request';
  const milestones = [
    ['Recorded', order.createdAt], ['Picked', order.pickedAt], ['Packed', order.packedAt],
    ['Released', order.releasedAt], ['Recipient accepted', order.acknowledgedAt],
  ].filter((item): item is [string, string] => !!item[1]);
  const safeDeliveryLink = normalizeSafeHttpsUrl(order.deliveryLink);
  const address = order.deliveryAddress;
  const replacementCases = returnCases.filter((record) => record.replacementOrderId === order.id);
  const subtotal = order.lines.reduce(
    (sum, line) => sum + (line.unitPrice ?? 0) * line.quantity,
    0,
  );
  const discounts = order.lines.reduce(
    (sum, line) => sum + (line.discountAmount ?? 0),
    0,
  );
  const calculatedTotal =
    subtotal - discounts + (order.shippingFee ?? 0) + (order.otherFees ?? 0);
  const netOfVat = calculatedTotal / 1.12;
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Order details / ${shortOrderReference(order.externalReference)}`}
      description="Fulfillment record, controlled customer details, and shipment history."
      size="record"
    >
      <WorkflowSummary {...orderWorkflowSummary(order, { actorIds: [actor, identityId], units: data?.units })}>
        <a className="inline-flex min-h-11 items-center text-sm underline" href={order.status === 'released' && order.deliveryMethod === 'shipment' ? '#shipment-timeline-title' : '#order-lines-title'}>
          {order.status === 'released' && order.deliveryMethod === 'shipment' ? 'Review shipment timeline' : 'Review order lines'}
        </a>
        <RecordCopyActions reference={order.externalReference} href={`/warehouse/fulfillment?tab=orders&order=${encodeURIComponent(order.id)}`} />
        {can('manage_returns') && canOpenRoute('returns') && hasReturnableOrderCustody(order, data) && <Link className="inline-flex min-h-11 items-center gap-2 text-sm underline" to={`/returns?sourceOrderId=${encodeURIComponent(order.id)}`}>
          <Icon name="rotate" /> Receive physical return
        </Link>}
      </WorkflowSummary>
      <div className="order-record-layout grid min-w-0 items-start gap-5 md:grid-cols-2 [&>section]:min-w-0 [&>section]:border-b [&>section]:border-line [&>section]:pb-4">
        {data?.returns.some(record => record.sourceOrderId === order.id) && <section aria-label="Physical returns" className="space-y-2 text-sm">
          <h3 className="font-semibold">Physical returns</h3>
          {data.returns.filter(record => record.sourceOrderId === order.id).map(record => <p key={record.id} className="break-all">
            <PhysicalReturnReference id={record.id} />
          </p>)}
        </section>}
        <section aria-label="Operational summary" className="space-y-2 text-sm [overflow-wrap:anywhere]">
          <h3 className="font-semibold text-ink">Order summary</h3>
          <p className="font-semibold text-ink">{orderWorkflowSummary(order, { actorIds: [actor, identityId], units: data?.units }).status}</p>
          <OrderReference reference={order.externalReference} orderId={order.id} />
          <ul>{order.lines.map((line) => <li key={line.productId}>{line.quantity} x {products.find((product) => product.id === line.productId)?.name ?? line.productId}</li>)}</ul>
          <p className="break-words">Destination: {address ? `${address.addressLine}, ${address.city}, ${address.province} ${address.postalCode}` : order.requestingDepartment ?? "Not provided"}</p>
          {order.deliveryMethod === "shipment" && <p className="break-words">{order.courier ?? "Courier not provided"} / {order.waybillNumber ?? "Waybill not provided"}</p>}
        </section>
        <dl aria-label="Order information" className="order-information grid min-w-0 grid-cols-2 gap-x-4 gap-y-4 p-4 text-sm [overflow-wrap:anywhere]">
          <div>
            <dt className="text-xs text-faint">Channel</dt>
            <dd className="mt-1 font-semibold text-ink">
              {order.ecommerceChannel ?? titleCase(order.source)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-faint">{internal ? 'Request recorded' : 'Order date'}</dt>
            <dd className="mt-1 font-semibold text-ink">
              {internal ? new Date(request?.requestedAt ?? order.createdAt).toLocaleString('en-PH') : order.orderDate ?? "Not recorded"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-faint">Payment</dt>
            <dd className="mt-1 font-semibold text-ink">
              {internal ? 'Not applicable to internal requests' : order.paymentStatus
                ? titleCase(order.paymentStatus)
                : "Not provided"}
              {order.paymentMethod ? ` / ${order.paymentMethod}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-faint">Current status</dt>
            <dd className="mt-1 font-semibold text-ink">
              {orderWorkflowSummary(order, { actorIds: [actor, identityId], units: data?.units }).status}
            </dd>
          </div>
          {order.campaignName && (
            <div className="col-span-2">
              <dt className="text-xs text-faint">Campaign / event</dt>
              <dd className="mt-1 font-semibold text-ink">
                {order.campaignName}
              </dd>
            </div>
          )}
        </dl>

        {replacementCases.length > 0 && (
          <section aria-label="Replacement linkage" className="space-y-3 text-sm">
            <h3 className="font-semibold text-ink">Replacement linkage</h3>
            {replacementCases.map((record) => {
              const original = orders.find((candidate) => candidate.id === record.sourceOrderId);
              return (
                <div key={record.id} className="min-w-0 space-y-2">
                  <p className="break-all">Return case: <span>{record.id}</span></p>
                  <p>{titleCase(record.status)} / {titleCase(record.resolution)}</p>
                  <p className="break-words">{record.defectDescription}</p>
                  {original ? (
                    <button type="button" className="btn-outline max-w-full whitespace-normal text-left" onClick={() => onOpenOrder(original)}>
                      View original order {original.externalReference}
                    </button>
                  ) : (
                    <p className="break-all text-muted">Original order: {record.sourceOrderId ? `${record.sourceOrderId} (not available in this view)` : "Not linked"}</p>
                  )}
                </div>
              );
            })}
            {!address && (
              <p role="alert" className="text-amber-800 dark:text-amber-300">
                Replacement delivery address is not recorded. Ask Customer Service and a warehouse supervisor to confirm the destination before dispatch. The original order's address is not a confirmed replacement destination.
              </p>
            )}
          </section>
        )}

        {internal && <section aria-label="Department request details" className="space-y-3 text-sm">
          <h3 className="font-display text-base font-bold text-ink">Department request</h3>
          <dl className="grid grid-cols-2 gap-4 [overflow-wrap:anywhere]">
            <div><dt className="text-xs text-muted">Department</dt><dd>{request?.requestingDepartment ?? order.requestingDepartment ?? 'Not recorded'}</dd></div>
            <div><dt className="text-xs text-muted">Requested by</dt><dd>{request?.requestedByName ?? 'Name not available in this view'}</dd></div>
            <div><dt className="text-xs text-muted">Required date</dt><dd>{request?.requiredDate ?? 'Not recorded'}</dd></div>
            <div><dt className="text-xs text-muted">Cost center</dt><dd>{request?.costCenter ?? 'Not recorded'}</dd></div>
            <div className="col-span-2"><dt className="text-xs text-muted">Purpose</dt><dd>{request?.purpose ?? 'Original request details are not available in this view.'}</dd></div>
          </dl>
        </section>}

        {order.source === "ecommerce" && showCommercial && (
          <details aria-labelledby="commercial-title">
            <summary
              id="commercial-title"
              className="font-display text-base font-bold text-ink"
            >
              Payment and commercial summary
            </summary>
            <dl className="mt-2 grid grid-cols-2 gap-3 rounded-xl border border-line p-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-faint">Payment reference</dt>
                <dd className="mt-1 break-all font-semibold text-ink">
                  {order.paymentReference ?? "Not provided"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-faint">Payment date</dt>
                <dd className="mt-1 font-semibold text-ink">
                  {order.paymentDate ?? "Not provided"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-faint">RRN</dt>
                <dd className="mt-1 break-all font-semibold text-ink">
                  {order.paymentRrn ?? "Not provided"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-faint">Provider method</dt>
                <dd className="mt-1 font-semibold text-ink">
                  {order.paymentProviderMethod ?? "Not provided"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-faint">Provider status</dt>
                <dd className="mt-1 font-semibold text-ink">
                  {order.paymentProviderStatus ?? "Not provided"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-faint">Sales invoice</dt>
                <dd className="mt-1 break-all font-semibold text-ink">
                  {order.salesInvoiceNumber ?? "Not provided"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-faint">Subtotal</dt>
                <dd className="mt-1 font-semibold text-ink">
                  {formatPhp(subtotal)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-faint">Discounts</dt>
                <dd className="mt-1 font-semibold text-ink">
                  {formatPhp(discounts)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-faint">Shipping fee</dt>
                <dd className="mt-1 font-semibold text-ink">
                  {formatPhp(order.shippingFee ?? 0)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-faint">Other fees</dt>
                <dd className="mt-1 font-semibold text-ink">
                  {formatPhp(order.otherFees ?? 0)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-faint">Calculated total</dt>
                <dd className="mt-1 font-bold text-ink">
                  {formatPhp(calculatedTotal)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-faint">Net of VAT</dt>
                <dd className="mt-1 font-semibold text-ink">
                  {formatPhp(netOfVat)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-faint">VAT</dt>
                <dd className="mt-1 font-semibold text-ink">
                  {formatPhp(calculatedTotal - netOfVat)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-faint">
                  Imported total / variance
                </dt>
                <dd className="mt-1 font-semibold text-ink">
                  {order.reportedTotalAmount === undefined
                    ? "Not provided"
                    : `${formatPhp(order.reportedTotalAmount)} / ${formatPhp(order.reportedTotalAmount - calculatedTotal)}`}
                </dd>
              </div>
            </dl>
          </details>
        )}

        {order.source === "ecommerce" && (
          <section aria-labelledby="customer-title">
            <h3
              id="customer-title"
              className="font-display text-base font-bold text-ink"
            >
              Customer and delivery
            </h3>
            <div className="mt-2 rounded-xl border border-line p-4 text-sm">
              <p className="font-semibold text-ink">
                {order.customerName ?? "Customer not provided"}
              </p>
              <p className="mt-1 text-muted">
                {maskContact(order.customerContact)} ·{" "}
                {maskEmail(order.customerEmail)}
              </p>
              {order.customerReference && (
                <p className="mt-1 text-xs text-muted">
                  Customer reference: {order.customerReference}
                </p>
              )}
              <p className="mt-3 leading-6 text-ink">
                {address
                  ? `${address.addressLine}, ${address.city}, ${address.province} ${address.postalCode}`
                  : "Delivery address not provided"}
              </p>
              {order.deliveryArea && (
                <p className="mt-2 text-xs font-medium text-muted">
                  Area of delivery: {order.deliveryArea}
                </p>
              )}
            </div>
          </section>
        )}

        <section aria-labelledby="order-lines-title" className="md:col-span-2">
          <h3
            id="order-lines-title"
            className="font-display text-base font-bold text-ink"
          >
            Order lines
          </h3>
          <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line">
            {order.lines.map((line) => {
              const product = products.find(
                (candidate) => candidate.id === line.productId,
              );
              const bin = storageAreas.find(
                (candidate) => candidate.id === line.pickBinId,
              );
              return (
                <li key={line.productId} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">
                        {product?.name ?? line.productId}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        {product?.sku}
                        {line.variant ? ` · ${line.variant}` : ""}
                      </p>
                    </div>
                    <span className="font-display text-lg font-bold text-ink">
                      x{line.quantity}
                    </span>
                  </div>
                  {bin && (
                    <p className="mt-2 text-xs text-muted">
                      Picked from {bin.label ?? bin.code}
                    </p>
                  )}
              <p className="mt-2 text-sm text-muted">Picked: {line.pickedQuantity} of {line.quantity}</p>
              {!!line.bundleSetCodes?.length && <p className="mt-2 break-words text-sm text-muted">Bundle sets: {line.bundleSetCodes.join(', ')}</p>}
                  {(line.pickedSerialNumbers?.length ?? 0) > 0 && <details className="mt-2 text-sm"><summary className="cursor-pointer font-medium">Picked serials ({line.pickedSerialNumbers.length})</summary><ul className="mt-2 grid gap-1 break-all sm:grid-cols-2">{line.pickedSerialNumbers.map(serial => <li key={serial}>{serial}</li>)}</ul></details>}
                  {showCommercial && line.unitPrice !== undefined && (
                    <p className="mt-2 text-xs text-muted">
                      Unit price PHP {line.unitPrice.toLocaleString("en-PH")} ·
                      Discount PHP{" "}
                      {(line.discountAmount ?? 0).toLocaleString("en-PH")}
                    </p>
                  )}
                  {line.fulfillmentEvidenceUrl && (
                    <p className="mt-2 text-xs text-muted">
                      Pick evidence captured
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {order.deliveryMethod === "shipment" && (
          <section aria-labelledby="dispatch-title">
            <h3
              id="dispatch-title"
              className="font-display text-base font-bold text-ink"
            >
              Dispatch
            </h3>
            <dl className="mt-2 grid grid-cols-2 gap-3 rounded-xl border border-line p-4 text-sm">
              <div>
                <dt className="text-xs text-faint">Courier</dt>
                <dd className="mt-1 font-semibold text-ink">
                  {order.courier ?? "Pending packing"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-faint">Waybill</dt>
                <dd className="mt-1 break-all font-semibold text-ink">
                  {order.waybillNumber ?? "Pending packing"}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-faint">Delivery link</dt>
                <dd className="mt-1 break-all font-semibold text-ink">
                  {safeDeliveryLink ? (
                    <a
                      className="text-brand-600 underline"
                      href={safeDeliveryLink}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {safeDeliveryLink}
                    </a>
                  ) : order.deliveryLink ? (
                    <span
                      role="alert"
                      className="text-amber-700 dark:text-amber-300"
                    >
                      Invalid tracking link. Update packing details.
                    </span>
                  ) : (
                    ["ready", "released", "completed"].includes(order.status)
                      ? "No tracking link provided"
                      : "Pending packing"
                  )}
                </dd>
              </div>
            </dl>
          </section>
        )}

        {order.orderNotes && (
          <section aria-labelledby="order-notes-title">
            <h3
              id="order-notes-title"
              className="font-display text-base font-bold text-ink"
            >
              Order instructions
            </h3>
            <p className="mt-2 whitespace-pre-wrap text-sm text-ink [overflow-wrap:anywhere]">
              {order.orderNotes}
            </p>
          </section>
        )}

        {(order.proofOfDeliveryReference || order.proofOfDeliveryEvidenceUrl) && (
          <section aria-label="Proof of delivery" className="space-y-2">
            <h3 className="font-display text-base font-bold text-ink">Proof of delivery</h3>
            {order.proofOfDeliveryReference && <p className="break-words text-sm">{order.proofOfDeliveryReference}</p>}
            {order.proofOfDeliveryEvidenceUrl ? (
              <EvidenceGallery urls={[order.proofOfDeliveryEvidenceUrl]} />
            ) : <p className="text-sm text-muted">No proof-of-delivery evidence recorded.</p>}
          </section>
        )}
        {(order.acknowledgementReference || order.acknowledgementEvidenceUrl) && (
          <section aria-label="Recipient acknowledgment" className="space-y-2">
            <h3 className="font-display text-base font-bold text-ink">Recipient acknowledgment</h3>
            {order.acknowledgementReference && <p className="break-words text-sm">{order.acknowledgementReference}</p>}
            <EvidenceGallery urls={order.acknowledgementEvidenceUrl ? [order.acknowledgementEvidenceUrl] : []} />
          </section>
        )}
        <section aria-label="Order activity" className="space-y-3 text-sm">
          <h3 className="font-display text-base font-bold text-ink">Order activity</h3>
          <ol className="divide-y divide-line">{milestones.map(([label, at]) => <li key={label} className="flex flex-wrap justify-between gap-2 py-2"><span className="font-medium">{label}</span><time dateTime={at} className="text-muted">{new Date(at).toLocaleString('en-PH')}</time></li>)}</ol>
          {order.deliveryMethod !== 'shipment' && <dl className="grid grid-cols-2 gap-3"><div><dt className="text-xs text-muted">Handover recipient</dt><dd>{order.handoverRecipientName ?? 'Not recorded yet'}</dd></div><div><dt className="text-xs text-muted">Handover reference</dt><dd className="break-words">{order.handoverReference ?? 'Not recorded yet'}</dd></div></dl>}
        </section>
        {order.deliveryMethod === 'shipment' && <section aria-labelledby="shipment-timeline-title">
          <h3
            id="shipment-timeline-title"
            className="font-display text-base font-bold text-ink"
          >
            Shipment timeline
          </h3>
          {order.shipmentEvents.length === 0 ? (
            <p className="mt-2 rounded-xl border border-dashed border-line p-4 text-sm text-muted">
              No shipment events recorded yet.
            </p>
          ) : (
            <ol className="mt-2 border-l-2 border-line pl-4">
              {order.shipmentEvents.map((event, index) => (
                <li
                  key={`${event.status}-${event.occurredAt}-${index}`}
                  className="relative pb-4 last:pb-0"
                >
                  <span className="absolute -left-[1.34rem] top-1 h-2.5 w-2.5 rounded-full bg-brand-500 ring-4 ring-surface" />
                  <p className="font-semibold text-ink">
                    {titleCase(event.status)}
                  </p>
                  <p className="text-xs text-muted">
                    {new Date(event.occurredAt).toLocaleString("en-PH")}
                  </p>
                  {event.reason && (
                    <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">
                      {event.reason}
                    </p>
                  )}
                  {event.reference && (
                    <p className="mt-1 text-xs text-muted">
                      Reference: {event.reference}
                    </p>
                  )}
                  {event.evidenceUrl && (
                    <EvidenceGallery urls={[event.evidenceUrl]} className="mt-2" />
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>}
      </div>
    </Sheet>
  );
}

function ActionButton({
  children,
  busy,
  onClick,
}: {
  children: string;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="btn-primary min-h-11 flex-1 sm:flex-none"
      disabled={busy}
      onClick={onClick}
    >
      {busy ? "Saving..." : children}
    </button>
  );
}

function OrderReferenceDetails({ order }: { order: FulfillmentOrder }) {
  const [searchParams] = useSearchParams();
  const [expanded, setExpanded] = useState(false);
  const orderParams = new URLSearchParams(searchParams);
  orderParams.set('tab', 'orders');
  orderParams.set('order', order.id);
  orderParams.delete('request');
  return (
    <details className="min-w-0 text-sm" onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary className="min-h-11 cursor-pointer py-3 font-medium text-ink">Order reference</summary>
      <p className="select-text [overflow-wrap:anywhere] text-muted">{order.externalReference}</p>
      {expanded && <RecordCopyActions reference={order.externalReference} href={`/warehouse/fulfillment?${orderParams}`} />}
    </details>
  );
}

function PickSheet({
  order,
  products,
  storageAreas,
  units,
  stockLevels,
  onClose,
}: {
  order?: FulfillmentOrder;
  products: Product[];
  storageAreas: StorageArea[];
  units: InventoryUnit[];
  stockLevels: StockLevel[];
  onClose: () => void;
}) {
  const warehouse = useWarehouse();
  const { advanceFulfillmentOrder } = warehouse;
  const toast = useToast();
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [productCodes, setProductCodes] = useState<Record<string, string>>({});
  const [pickedQuantities, setPickedQuantities] = useState<Record<string, string>>({});
  const pendingCommand = useRef<Parameters<typeof advanceFulfillmentOrder>[0] | null>(null);
  const [binCodes, setBinCodes] = useState<Record<string, string>>({});
  const [pickEvidence, setPickEvidence] = useState<Record<string, string[]>>(
    {},
  );
  const evidence = useEvidencePending();
  const [validationError, setValidationError] = useState("");
  const validationErrorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (validationError) validationErrorRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [validationError]);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const [discardRequested, setDiscardRequested] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [queued, setQueued] = useState(false);
  if (!order) return null;
  const recommendedBin = (productId: string) => {
    const unitBin = units.find(
      (unit) =>
        unit.productId === productId &&
        unit.status === "in_stock" &&
        unit.binId &&
        (!order.sourceLocationId || unit.locationId === order.sourceLocationId),
    )?.binId;
    const stockBin = stockLevels.find(
      (level) =>
        level.productId === productId &&
        level.quantity > 0 &&
        level.binId &&
        (!order.sourceLocationId ||
          level.locationId === order.sourceLocationId),
    )?.binId;
    return storageAreas.find((area) => area.id === (unitBin ?? stockBin));
  };
  const captured = (productId: string) => (serials[productId] ?? "").split(/[\n,]/).map((value) => value.trim()).filter(Boolean);
  const verifiedBin = (productId: string) => {
    const suggestion = recommendedBin(productId);
    return suggestion && suggestion.active !== false &&
      (!order.sourceLocationId || suggestion.locationId === order.sourceLocationId) &&
      binCodes[productId]?.trim().toLowerCase() === suggestion.code.toLowerCase()
      ? suggestion : undefined;
  };
  const serialError = (productId: string, code: string, existing: string[]) => {
    const normalized = code.trim().toLowerCase();
    if (recommendedBin(productId) && !verifiedBin(productId)) return "Scan the correct source bin before scanning items.";
    if (existing.some((value) => value.toLowerCase() === normalized)) return `${code} was already scanned.`;
    const unit = units.find((row) => row.serialNumber.toLowerCase() === normalized);
    if (!unit) return `Unknown serial: ${code}.`;
    if (unit.productId !== productId) return "This serial belongs to a different product.";
    if (unit.status !== "in_stock") return "This serial is not accepted, available stock.";
    if (order.sourceLocationId && unit.locationId !== order.sourceLocationId) return "This serial is at a different warehouse.";
    if ((unit.binId ?? "") !== (verifiedBin(productId)?.id ?? "")) return "This serial is not in the verified source bin.";
    return "";
  };
  const requestClose = () => {
    if (queued || submitting.current || evidence.pendingKeys.current.size > 0) return;
    if (Object.values(serials).some(Boolean) || Object.values(productCodes).some(Boolean) || Object.values(pickedQuantities).some(Boolean) || Object.values(binCodes).some(Boolean) || Object.values(pickEvidence).some((urls) => urls.length)) {
      setDiscardRequested(true);
    } else onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current || evidence.pendingKeys.current.size > 0) return;
    for (const line of pendingCommand.current ? [] : order.lines) {
      const product = products.find((row) => row.id === line.productId);
      const suggestion = recommendedBin(line.productId);
      if (suggestion && !verifiedBin(line.productId)) {
        setValidationError(
          `Scan the source rack or bin for ${product?.name ?? line.productId} before scanning items.`,
        );
        return;
      }
      const capturedSerials = (serials[line.productId] ?? "")
        .split(/[\n,]/)
        .map((value) => value.trim())
        .filter(Boolean);
      if (product && !product.serialized) {
        if (resolveProductScan(products, productCodes[product.id] ?? "")?.id !== product.id) {
          setValidationError(`Scan the product barcode for ${product.name}.`);
          return;
        }
        const quantity = Number(pickedQuantities[product.id]);
        if (!isStockQuantity(quantity) || quantity !== line.quantity) {
          setValidationError(`Confirm exactly ${line.quantity} whole units for ${product.name}. Use split backorder for a partial pick.`);
          return;
        }
      }
      if (product?.serialized && capturedSerials.length !== line.quantity) {
        setValidationError(
          `Scan exactly ${line.quantity} serial number(s) for ${product.name}. ${capturedSerials.length} captured.`,
        );
        return;
      }
      for (const [index, code] of capturedSerials.entries()) {
        const error = serialError(line.productId, code, capturedSerials.slice(0, index));
        if (error) {
          setValidationError(error);
          return;
        }
      }
    }
    setValidationError("");
    setUnconfirmed(false);
    submitting.current = true;
    setSaving(true);
    try {
    pendingCommand.current ??= {
      orderId: order.id,
      action: "confirm_pick",
      pickedLines: order.lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        serialNumbers: (serials[line.productId] ?? "")
          .split(/[\n,]/)
          .map((value) => value.trim())
          .filter(Boolean),
        binId: verifiedBin(line.productId)?.id,
        evidenceUrl: pickEvidence[line.productId]?.[0],
      })),
    };
    const ok = await advanceFulfillmentOrder(pendingCommand.current);
    if (ok) {
      pendingCommand.current = null;
      toast.success("Scanned pick confirmed. Move the order to packing.");
      onClose();
      setSerials({});
      setBinCodes({});
      setPickEvidence({});
    } else { setQueued(warehouse.lastActionStatus === "queued"); setUnconfirmed(true); }
    } catch {
      setUnconfirmed(true);
      setValidationError("Pick confirmation was not acknowledged. Your capture is retained; verify the order before retrying.");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
      title={`Confirm pick / ${order.externalReference}`}
      description="Scan the source bin and items, then attach line evidence before confirming the pick."
      footer={
        <button
          type="submit"
          form="pick-order-form"
          className="btn-primary w-full"
          disabled={saving || evidence.pending}
        >
          {saving
            ? "Confirming..."
            : evidence.pending
              ? "Uploading evidence..."
              : "Confirm pick"}
        </button>
      }
    >
      {unconfirmed && queued && <p role="status" className="mb-3 text-sm">Pick confirmation is queued for sync, not yet committed. Captured details are retained.</p>}
      {discardRequested && (
        <div role="alert" className="mb-4 space-y-2 border border-line p-3">
          <p>Discard captured pick details?</p>
          <button type="button" className="btn-primary" onClick={() => setDiscardRequested(false)}>Keep capturing</button>
          <button type="button" className="btn-ghost" disabled={saving || evidence.pending} onClick={onClose}>Discard capture</button>
        </div>
      )}
      <form
        id="pick-order-form"
        aria-busy={saving || evidence.pending}
        className="space-y-4"
        onSubmit={(event) => void submit(event)}
      >
        {validationError && (
          <p
            ref={validationErrorRef}
            role="alert"
            className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200"
          >
            {validationError}
          </p>
        )}
        <OrderReferenceDetails order={order} />
        <fieldset disabled={saving || queued || unconfirmed} className="min-w-0 space-y-4">
        <details className="border-l-4 border-emerald-500 bg-emerald-500/10 px-4 text-sm">
          <summary className="min-h-11 cursor-pointer py-3 font-semibold text-ink">Quality checkpoint</summary>
          <p className="pb-3 text-muted">
            Only accepted, put-away stock is pickable. If packaging, seals, or a
            device condition looks wrong, stop the pick and route the item to
            Quality Control instead of substituting it informally.
          </p>
        </details>
        {order.lines.map((line) => {
          const product = products.find((row) => row.id === line.productId);
          const suggestion = recommendedBin(line.productId);
          return (
            <div
              key={line.productId}
              className="rounded-xl border border-line p-3"
            >
              <p className="font-semibold text-ink">
                {product?.name ?? line.productId}
              </p>
              <p className="text-xs text-muted">
                Required quantity: {line.quantity}
              </p>
              {suggestion ? (
                <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 dark:border-brand-800 dark:bg-brand-900/30">
                  <p className="text-xs font-semibold text-brand-800 dark:text-brand-200">
                    Pick location
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-ink">
                    {suggestion.label ?? suggestion.code}
                  </p>
                  <p className="font-mono text-xs text-muted">
                    {suggestion.code}
                  </p>
                </div>
              ) : (
                <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                  No put-away bin is recorded. Confirm the general stock area
                  and escalate repeated unbinned stock to the shift lead.
                </p>
              )}
              {suggestion && (
                <div className="mt-3 rounded-xl border-2 border-brand-300 bg-surface p-3 dark:border-brand-700">
                  <p className="text-sm font-semibold text-ink">
                    1. Scan source rack or bin
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Required before item scanning. Expected code:{" "}
                    <span className="font-mono font-semibold">
                      {suggestion.code}
                    </span>
                  </p>
                  <div className="mt-3">
                    <BarcodeScanner
                      label="Scan rack or bin"
                      manualLabel={`Scanned bin code for ${product?.name ?? line.productId}`}
                      manualActionLabel="Use bin"
                      disabled={saving || evidence.pending}
                      onDetected={(code) => {
                        if (code.trim().toLowerCase() !== suggestion.code.toLowerCase() || suggestion.active === false || (order.sourceLocationId && suggestion.locationId !== order.sourceLocationId)) {
                          setBinCodes((current) => ({ ...current, [line.productId]: "" }));
                          setValidationError(`Wrong source bin. Scan ${suggestion.code} for ${product?.name ?? line.productId}.`);
                          return;
                        }
                        setValidationError("");
                        setBinCodes((current) => ({
                          ...current,
                          [line.productId]: suggestion.code,
                        }));
                      }}
                    />
                  </div>
                  {binCodes[line.productId] && (
                    <p className="mt-2 text-xs text-muted">
                      Captured:{" "}
                      <span className="font-mono font-semibold text-ink">
                        {binCodes[line.productId]}
                      </span>
                    </p>
                  )}
                </div>
              )}
              {line.bundleSetCodes && line.bundleSetCodes.length > 0 && (
                <div
                  className="mt-2 flex flex-wrap gap-1"
                  aria-label="Bundle set codes"
                >
                  {line.bundleSetCodes.map((code) => (
                    <Badge key={code} tone="cyan">
                      Set {code}
                    </Badge>
                  ))}
                </div>
              )}
              {product?.serialized && (
                <div className="mt-3 rounded-xl border border-line bg-inset p-3">
                  <p className="text-sm font-semibold text-ink">
                    2. Scan serialized item
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Use the camera or manual fallback once for every required
                    unit.
                  </p>
                  <div className="mt-3">
                    <BarcodeScanner
                      label={`Scan serial for ${product.name}`}
                      manualLabel={`Enter serial for ${product.name}`}
                      manualActionLabel="Add serial"
                      mode="batch"
                      disabled={saving || evidence.pending || (Boolean(suggestion) && !verifiedBin(line.productId)) || captured(line.productId).length >= line.quantity}
                      onDetected={(code) => {
                        const error = serialError(line.productId, code, captured(line.productId));
                        if (error) { setValidationError(error); return; }
                        setValidationError("");
                        setSerials((current) => {
                          const existing = (current[line.productId] ?? "")
                            .split(/[\n,]/)
                            .map((value) => value.trim())
                            .filter(Boolean);
                          if (existing.some((value) => value.toLowerCase() === code.trim().toLowerCase()) || existing.length >= line.quantity) return current;
                          return {
                            ...current,
                            [line.productId]: [...existing, units.find((unit) => unit.serialNumber.toLowerCase() === code.trim().toLowerCase())!.serialNumber].join("\n"),
                          };
                        });
                      }}
                    />
                  </div>
                  <textarea
                    aria-label={`Scanned serial numbers for ${product.name}`}
                    className="input mt-3 min-h-24 font-mono"
                    value={serials[line.productId] ?? ""}
                    disabled={saving || evidence.pending || (Boolean(suggestion) && !verifiedBin(line.productId))}
                    onChange={(event) =>
                      setSerials((current) => ({
                        ...current,
                        [line.productId]: event.target.value,
                      }))
                    }
                    required
                  />
                </div>
              )}
              {product && !product.serialized && (
                <div className="mt-3 space-y-3 border-t border-line pt-3">
                  <BarcodeScanner
                    label={`Scan product for ${product.name}`}
                    manualLabel={`Product barcode for ${product.name}`}
                    manualActionLabel="Use product"
                    disabled={saving || evidence.pending || queued || unconfirmed || (Boolean(suggestion) && !verifiedBin(product.id))}
                    onDetected={(code) => {
                      if (resolveProductScan(products, code)?.id !== product.id) {
                        setProductCodes((current) => ({ ...current, [product.id]: "" }));
                        setValidationError(`Wrong or ambiguous product barcode. Scan ${product.name}.`);
                        return;
                      }
                      setValidationError("");
                      setProductCodes((current) => ({ ...current, [product.id]: code.trim() }));
                    }}
                  />
                  {productCodes[product.id] && <p className="text-sm text-muted">Product verified: {product.name}</p>}
                  <Field label="Picked quantity" htmlFor={`picked-quantity-${product.id}`}>
                    <input
                      id={`picked-quantity-${product.id}`}
                      aria-label={`Picked quantity for ${product.name}`}
                      type="number" inputMode="numeric" min={1} max={line.quantity} step={1}
                      className="input"
                      value={pickedQuantities[product.id] ?? ""}
                      disabled={saving || evidence.pending || queued || unconfirmed || !productCodes[product.id] || (Boolean(suggestion) && !verifiedBin(product.id))}
                      onChange={(event) => setPickedQuantities((current) => ({ ...current, [product.id]: event.target.value }))}
                    />
                  </Field>
                </div>
              )}
              <div className="mt-3 border-t border-line pt-3">
                <EvidenceCapture
                  reference={`fulfillment/${order.id}/pick/${line.productId}`}
                  value={pickEvidence[line.productId]}
                  onBusyChange={(busy) =>
                    evidence.onBusyChange(line.productId, busy)
                  }
                  maxPhotos={1}
                  label={`Attach pick evidence for ${product?.name ?? line.productId}`}
                  onChange={(urls) =>
                    setPickEvidence((current) => ({
                      ...current,
                      [line.productId]: urls,
                    }))
                  }
                />
                <p className="mt-2 text-xs text-muted">
                  Optional when the scan record is sufficient; attach a photo
                  for damaged packaging, bundle confirmation, or exceptions.
                </p>
              </div>
            </div>
          );
        })}
        </fieldset>
      </form>
    </Sheet>
  );
}

function PackSheet({
  order,
  products,
  onPacked,
  onClose,
}: {
  order?: FulfillmentOrder;
  products: Product[];
  onPacked: (order: FulfillmentOrder) => void;
  onClose: () => void;
}) {
  const warehouse = useWarehouse();
  const { advanceFulfillmentOrder } = warehouse;
  const toast = useToast();
  const supplies = products.filter(
    (product) => product.itemClass === "fulfillment_supply",
  );
  const [courier, setCourier] = useState("");
  const pendingCommand = useRef<Parameters<typeof advanceFulfillmentOrder>[0] | null>(null);
  const [waybill, setWaybill] = useState("");
  const [deliveryLink, setDeliveryLink] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientDepartment, setRecipientDepartment] = useState("");
  const [handoverReference, setHandoverReference] = useState("");
  const [handoverEvidence, setHandoverEvidence] = useState<string[]>([]);
  const evidence = useEvidencePending();
  const [packaging, setPackaging] = useState([
    { key: crypto.randomUUID(), productId: "", quantity: 1 },
  ]);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [discardRequested, setDiscardRequested] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [queued, setQueued] = useState(false);
  useEffect(() => {
    setCourier(order?.courier ?? "");
    setWaybill(order?.waybillNumber ?? "");
    setDeliveryLink(order?.deliveryLink ?? "");
  }, [order?.courier, order?.deliveryLink, order?.id, order?.waybillNumber]);
  useEffect(() => {
    if (!order || order.deliveryMethod === "shipment") return;
    setHandoverReference(
      order.handoverReference ??
        `HO-${order.externalReference}-${order.id.slice(-6).toUpperCase()}`,
    );
    setRecipientDepartment(
      order.handoverRecipientDepartment ?? order.requestingDepartment ?? "",
    );
  }, [order]);
  if (!order) return null;
  const shipment = order.deliveryMethod === "shipment";
  const requestClose = () => {
    if (queued || submitting.current || evidence.pendingKeys.current.size > 0) return;
    if (dirty || handoverEvidence.length || packaging.some((line) => line.productId)) setDiscardRequested(true);
    else onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current || evidence.pendingKeys.current.size > 0) return;
    if (!pendingCommand.current && shipment && !normalizeSafeHttpsUrl(deliveryLink)) {
      toast.error("Delivery tracking link must use a secure HTTPS URL.");
      return;
    }
    submitting.current = true;
    setSaving(true);
    setUnconfirmed(false);
    try {
    pendingCommand.current ??= {
      orderId: order.id,
      action: "confirm_pack",
      courier,
      waybillNumber: waybill,
      deliveryLink,
      handoverRecipientName: recipientName,
      handoverRecipientDepartment: recipientDepartment,
      handoverReference,
      handoverEvidenceUrl:
        handoverEvidence[0] ??
        `intra://handover/${order.id}/${handoverReference}`,
      packaging: packaging
        .filter((line) => line.productId)
        .map(({ productId, quantity }) => ({ productId, quantity })),
    };
    const ok = await advanceFulfillmentOrder(pendingCommand.current);
    if (ok) {
      pendingCommand.current = null;
      onPacked(order);
      onClose();
    } else { setQueued(warehouse.lastActionStatus === "queued"); setUnconfirmed(true); }
    } catch {
      setUnconfirmed(true);
      toast.error("Packing was not acknowledged. Your capture is retained; verify the order before retrying.");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
      title={`Pack order / ${order.externalReference}`}
      description={
        shipment
          ? "Confirm the courier, waybill, delivery link, and fulfillment supplies consumed."
          : "Identify the recipient. Intra generates the handover reference; a photo is optional unless an exception requires evidence."
      }
      footer={
        <button
          type="submit"
          form="pack-order-form"
          className="btn-primary w-full"
          disabled={saving || evidence.pending}
        >
          {saving
            ? "Saving..."
            : evidence.pending
              ? "Uploading evidence..."
              : "Confirm packing"}
        </button>
      }
    >
      {unconfirmed && queued && <p role="status">Packing queued for sync, not yet committed. Captured details are retained.</p>}
      {discardRequested && <div role="alert" className="mb-3 space-y-2">
        <p>Discard captured packing details?</p>
        <button type="button" className="btn-primary" onClick={() => setDiscardRequested(false)}>Keep capturing</button>
        <button type="button" className="btn-ghost" disabled={saving || evidence.pending} onClick={onClose}>Discard capture</button>
      </div>}
      <form
        id="pack-order-form"
        onChangeCapture={() => setDirty(true)}
        aria-busy={saving || evidence.pending}
        className="space-y-4"
        onSubmit={(event) => void submit(event)}
      >
        <fieldset disabled={saving || queued || unconfirmed} className="min-w-0 space-y-4">
        {shipment ? (
          <>
            <Field label="Courier" htmlFor="pack-courier">
              <input
                id="pack-courier"
                className="input"
                value={courier}
                onChange={(event) => setCourier(event.target.value)}
                required
              />
            </Field>
            <Field label="Waybill number" htmlFor="pack-waybill">
              <input
                id="pack-waybill"
                className="input"
                value={waybill}
                onChange={(event) => setWaybill(event.target.value)}
                required
              />
            </Field>
            <Field
              label="Delivery tracking link"
              htmlFor="pack-delivery-link"
              hint="Paste the courier page the customer and support team will use."
            >
              <input
                id="pack-delivery-link"
                className="input"
                type="url"
                pattern="https://.*"
                value={deliveryLink}
                onChange={(event) => setDeliveryLink(event.target.value)}
                required
              />
            </Field>
          </>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Recipient name" htmlFor="handover-recipient">
                <input
                  id="handover-recipient"
                  className="input"
                  value={recipientName}
                  onChange={(event) => setRecipientName(event.target.value)}
                  required
                />
              </Field>
              <Field label="Recipient department" htmlFor="handover-department">
                <input
                  id="handover-department"
                  className="input"
                  value={recipientDepartment}
                  onChange={(event) =>
                    setRecipientDepartment(event.target.value)
                  }
                  required
                />
              </Field>
            </div>
            <Field label="Handover reference" htmlFor="handover-reference">
              <input
                id="handover-reference"
                className="input"
                value={handoverReference}
                readOnly
                required
              />
            </Field>
            <div className="rounded-xl border border-line p-3">
              <EvidenceCapture
                reference={`fulfillment/${order.id}/handover`}
                value={handoverEvidence}
                onBusyChange={(busy) => evidence.onBusyChange("handover", busy)}
                maxPhotos={1}
                label="Attach handover photo (optional)"
                onChange={setHandoverEvidence}
              />
              <p className="mt-2 text-xs text-muted">
                A system audit record is always created. Add a photo for damaged
                packaging, disputed custody, or another exception.
              </p>
            </div>
          </>
        )}
        {supplies.length > 0 ? (
          <fieldset className="space-y-3">
            <legend className="label">Packaging materials consumed</legend>
            {packaging.map((line, index) => (
              <div
                key={line.key}
                className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-end"
              >
                <Field
                  label={`Packaging supply ${index + 1}`}
                  htmlFor={`pack-supply-${line.key}`}
                >
                  <select
                    id={`pack-supply-${line.key}`}
                    className="input"
                    value={line.productId}
                    onChange={(event) =>
                      setPackaging((current) =>
                        current.map((candidate) =>
                          candidate.key === line.key
                            ? { ...candidate, productId: event.target.value }
                            : candidate,
                        ),
                      )
                    }
                  >
                    <option value="">Select a supply</option>
                    {supplies.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label={`Packaging quantity ${index + 1}`}
                  htmlFor={`pack-supply-quantity-${line.key}`}
                >
                  <input
                    id={`pack-supply-quantity-${line.key}`}
                    className="input"
                    type="number"
                    min="1"
                    value={line.quantity}
                    onChange={(event) =>
                      setPackaging((current) =>
                        current.map((candidate) =>
                          candidate.key === line.key
                            ? {
                                ...candidate,
                                quantity: Number(event.target.value),
                              }
                            : candidate,
                        ),
                      )
                    }
                  />
                </Field>
                {packaging.length > 1 && (
                  <button
                    type="button"
                    className="btn-ghost min-h-11 px-3"
                    aria-label={`Remove packaging supply ${index + 1}`}
                    onClick={() =>
                      setPackaging((current) =>
                        current.filter(
                          (candidate) => candidate.key !== line.key,
                        ),
                      )
                    }
                  >
                    <Icon name="trash" />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="btn-outline w-full sm:w-auto"
              onClick={() =>
                setPackaging((current) => [
                  ...current,
                  { key: crypto.randomUUID(), productId: "", quantity: 1 },
                ])
              }
            >
              <Icon name="plus" /> Add another supply
            </button>
          </fieldset>
        ) : (
          <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
            No fulfillment supplies are configured. Add boxes, pouches, labels,
            or wrap in Inventory before tracking pack consumption.
          </p>
        )}
        </fieldset>
      </form>
    </Sheet>
  );
}

function BackorderSheet({
  order,
  products,
  onClose,
}: {
  order?: FulfillmentOrder;
  products: Product[];
  onClose: () => void;
}) {
  const { advanceFulfillmentOrder } = useWarehouse();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (order?.lines ?? []).map((line) => [
        line.productId,
        String(Math.max(1, line.quantity - 1)),
      ]),
    ),
  );
  if (!order) return null;
  const fulfilledLines = order.lines.map((line) => ({
    productId: line.productId,
    quantity: Number(quantities[line.productId]),
  }));
  const invalidQuantity = order.lines.some((line, index) => {
    const quantity = fulfilledLines[index]!.quantity;
    return (
      !quantities[line.productId]?.trim() ||
      !Number.isInteger(quantity) ||
      quantity < 0 ||
      quantity > line.quantity
    );
  });
  const validationMessage = invalidQuantity
    ? "Enter a whole fulfill-now quantity from zero to the original demand for every item."
    : !fulfilledLines.some((line) => line.quantity > 0)
      ? "At least one item must have a fulfill-now quantity."
      : !fulfilledLines.some(
            (line, index) => line.quantity < order.lines[index]!.quantity,
          )
        ? "At least one item must have a deferred quantity."
        : undefined;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || validationMessage) return;
    setSaving(true);
    const ok = await advanceFulfillmentOrder({
      orderId: order.id,
      action: "split_backorder",
      fulfilledLines,
    });
    setSaving(false);
    if (ok) {
      toast.success(
        "Available demand retained and the remainder moved to a backorder.",
      );
      onClose();
    }
  };
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Split backorder / ${order.externalReference}`}
      description="Keep the quantity Warehouse can fulfill now. The remainder stays visible as a linked backorder."
      footer={
        <button
          type="submit"
          form="split-backorder-form"
          className="btn-primary w-full"
          disabled={saving || Boolean(validationMessage)}
        >
          {saving ? "Splitting..." : "Create backorder"}
        </button>
      }
    >
      <form
        id="split-backorder-form"
        className="space-y-4"
        onSubmit={(event) => void submit(event)}
      >
        {order.lines.map((line) => (
          <Field
            key={line.productId}
            label={
              products.find((row) => row.id === line.productId)?.name ??
              line.productId
            }
            htmlFor={`backorder-${line.productId}`}
            hint={`Original demand: ${line.quantity}; deferred: ${invalidQuantity ? "-" : line.quantity - Number(quantities[line.productId])}`}
          >
            <input
              id={`backorder-${line.productId}`}
              name={`quantity-${line.productId}`}
              className="input"
              type="number"
              min="0"
              step="1"
              max={line.quantity}
              value={quantities[line.productId] ?? ""}
              onChange={(event) =>
                setQuantities((current) => ({
                  ...current,
                  [line.productId]: event.target.value,
                }))
              }
              disabled={saving}
              required
            />
          </Field>
        ))}
        {validationMessage && (
          <p
            role="status"
            className="text-sm text-amber-800 dark:text-amber-300"
          >
            {validationMessage}
          </p>
        )}
      </form>
    </Sheet>
  );
}

function CancelOrderSheet({
  order,
  onClose,
}: {
  order?: FulfillmentOrder;
  onClose: () => void;
}) {
  const { advanceFulfillmentOrder } = useWarehouse();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [disposition, setDisposition] = useState<
    "returned_to_stock" | "consumed"
  >("returned_to_stock");
  const [saving, setSaving] = useState(false);
  if (!order) return null;
  const prepared =
    ["packing", "ready"].includes(order.status) && order.packaging.length > 0;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const ok = await advanceFulfillmentOrder({
      orderId: order.id,
      action: "cancel",
      cancellationReason: reason,
      packagingDisposition: prepared ? disposition : undefined,
    });
    setSaving(false);
    if (ok) {
      toast.success(
        "Demand cancelled with its reason and stock commitment recorded.",
      );
      onClose();
      setReason("");
    }
  };
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Cancel demand / ${order.externalReference}`}
      description="Cancellation releases the reservation and preserves the operational reason."
      footer={
        <button
          type="submit"
          form="cancel-order-form"
          className="btn-primary w-full"
          disabled={saving}
        >
          {saving ? "Cancelling..." : "Confirm cancellation"}
        </button>
      }
    >
      <form
        id="cancel-order-form"
        className="space-y-4"
        onSubmit={(event) => void submit(event)}
      >
        <Field label="Cancellation reason" htmlFor="cancel-order-reason">
          <textarea
            id="cancel-order-reason"
            className="input min-h-24"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          />
        </Field>
        {prepared && (
          <Field label="Prepared packaging" htmlFor="packaging-disposition">
            <select
              id="packaging-disposition"
              className="input"
              value={disposition}
              onChange={(event) =>
                setDisposition(event.target.value as typeof disposition)
              }
            >
              <option value="returned_to_stock">
                Unused and returned to stock
              </option>
              <option value="consumed">Consumed or no longer reusable</option>
            </select>
          </Field>
        )}
      </form>
    </Sheet>
  );
}

function AcknowledgeReceiptSheet({
  order,
  onClose,
}: {
  order?: FulfillmentOrder;
  onClose: () => void;
}) {
  const warehouse = useWarehouse();
  const { advanceFulfillmentOrder } = warehouse;
  const { profile } = useSession();
  const toast = useToast();
  const [reference, setReference] = useState("");
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const evidence = useEvidencePending();
  const inFlight = useRef(false);
  const pendingCommand = useRef<
    Parameters<typeof advanceFulfillmentOrder>[0] | null
  >(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  if (!order) return null;
  const currentOrder = warehouse.data?.fulfillmentOrders.find(
    (candidate) => candidate.id === order.id,
  );
  const unavailable = currentOrder
    ? receiptAcknowledgmentUnavailable(currentOrder, warehouse, profile?.id)
    : "This order is no longer available. Refresh the queue before recording receipt.";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (
      inFlight.current ||
      evidence.pendingKeys.current.size > 0 ||
      unavailable
    )
      return;
    if (!reference.trim() || !evidenceUrls[0]) return;
    inFlight.current = true;
    setSaving(true);
    setError("");
    pendingCommand.current ??= {
      orderId: order.id,
      action: "acknowledge_receipt",
      acknowledgementReference: reference.trim(),
      acknowledgementEvidenceUrl: evidenceUrls[0],
    };
    try {
      const ok = await advanceFulfillmentOrder(pendingCommand.current);
      if (ok) {
        toast.success("Recipient acceptance recorded.");
        onClose();
      } else {
        setError(
          "Receipt was not confirmed. Your evidence is retained. Check the order status and your access before retrying; ask a warehouse supervisor if acknowledgment remains unavailable.",
        );
      }
    } catch {
      setError(
        "Receipt was not confirmed. Your evidence is retained. Check the order status and your access before retrying; ask a warehouse supervisor if acknowledgment remains unavailable.",
      );
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !inFlight.current) onClose();
      }}
      title={`Acknowledge receipt / ${order.externalReference}`}
      description="Record recipient acceptance, not warehouse release. The releasing operator cannot acknowledge receipt."
      footer={
        <button
          type="submit"
          form="acknowledge-order-form"
          className="btn-primary w-full"
          disabled={
            saving ||
            evidence.pending ||
            !!unavailable ||
            !reference.trim() ||
            evidenceUrls.length === 0
          }
        >
          {saving
            ? "Saving..."
            : evidence.pending
              ? "Uploading evidence..."
              : "Confirm receipt"}
        </button>
      }
    >
      <form
        id="acknowledge-order-form"
        aria-busy={saving || evidence.pending}
        className="space-y-4"
        onSubmit={(event) => void submit(event)}
      >
        <OrderReferenceDetails order={order} />
        <p className="break-words text-sm text-ink">
          Recipient: {order.handoverRecipientName ?? "Not recorded"}
          {order.handoverRecipientDepartment
            ? ` / ${order.handoverRecipientDepartment}`
            : ""}
        </p>
        {(unavailable || error) && (
          <p
            role="alert"
            className="text-sm text-amber-800 dark:text-amber-300"
          >
            {unavailable || error}
          </p>
        )}
        <fieldset
          disabled={
            saving ||
            evidence.pending ||
            !!pendingCommand.current ||
            !!unavailable
          }
          className="min-w-0 space-y-4"
        >
          <Field label="Acknowledgment reference" htmlFor="ack-reference">
            <input
              id="ack-reference"
              className="input"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              required
            />
          </Field>
          <EvidenceCapture
            label="Upload recipient acknowledgment evidence"
            value={evidenceUrls}
            onChange={setEvidenceUrls}
            onBusyChange={(busy) =>
              evidence.onBusyChange("acknowledgment", busy)
            }
            maxPhotos={1}
            reference={`acknowledgment-${order.id}`}
          />
        </fieldset>
      </form>
    </Sheet>
  );
}

function ShipmentTrackingSheet({
  order,
  onClose,
}: {
  order?: FulfillmentOrder;
  onClose: () => void;
}) {
  const { advanceFulfillmentOrder } = useWarehouse();
  const toast = useToast();
  const [action, setAction] = useState<
    | "mark_in_transit"
    | "record_delivery_failed"
    | "confirm_delivery"
    | "return_to_sender"
  >("mark_in_transit");
  const [reference, setReference] = useState("");
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const evidence = useEvidencePending();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  if (!order) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || evidence.pendingKeys.current.size > 0) return;
    if (action === "confirm_delivery" && evidenceUrls.length === 0) return;
    setSaving(true);
    const ok = await advanceFulfillmentOrder({
      orderId: order.id,
      action,
      trackingReference: reference || undefined,
      trackingEvidenceUrl: evidenceUrls[0] || undefined,
      deliveryFailureReason: reason || undefined,
    });
    setSaving(false);
    if (ok) {
      toast.success(
        action === "confirm_delivery"
          ? "Proof of delivery recorded."
          : "Shipment tracking updated.",
      );
      onClose();
    }
  };
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={"Delivery / " + order.externalReference}
      description="Record courier progression, failed attempts, redelivery, or proof of delivery."
      footer={
        <button
          type="submit"
          form="shipment-tracking-form"
          className="btn-primary w-full"
          disabled={
            saving ||
            evidence.pending ||
            (action === "confirm_delivery" && evidenceUrls.length === 0)
          }
        >
          {saving
            ? "Saving..."
            : evidence.pending
              ? "Uploading evidence..."
              : "Save delivery update"}
        </button>
      }
    >
      <form
        id="shipment-tracking-form"
        aria-busy={saving || evidence.pending}
        className="space-y-4"
        onSubmit={(event) => void submit(event)}
      >
        <Field label="Delivery outcome" htmlFor="shipment-action">
          <select
            id="shipment-action"
            className="input"
            value={action}
            onChange={(event) => setAction(event.target.value as typeof action)}
          >
            <option value="mark_in_transit">Dispatched / in transit</option>
            <option value="record_delivery_failed">Failed delivery</option>
            <option value="confirm_delivery">Delivered with proof</option>
            {order.shipmentStatus === "delivery_failed" && (
              <option value="return_to_sender">Return to sender</option>
            )}
          </select>
        </Field>
        {action === "confirm_delivery" && (
          <>
            <Field label="Proof-of-delivery reference" htmlFor="pod-reference">
              <input
                id="pod-reference"
                className="input"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                required
              />
            </Field>
            <EvidenceCapture
              label="Upload proof-of-delivery image"
              value={evidenceUrls}
              onBusyChange={(busy) => evidence.onBusyChange("delivery", busy)}
              maxPhotos={1}
              reference={`delivery-${order.id}`}
              onChange={setEvidenceUrls}
            />
            {evidenceUrls.length === 0 && (
              <p className="text-xs text-muted">
                A delivery photo or signed proof is required before this order
                can be marked delivered.
              </p>
            )}
          </>
        )}
        {(action === "record_delivery_failed" ||
          action === "return_to_sender") && (
          <Field label="Exception reason" htmlFor="delivery-reason">
            <textarea
              id="delivery-reason"
              className="input min-h-24"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
            />
          </Field>
        )}
      </form>
    </Sheet>
  );
}
function RequestsWorkspace({
  products,
  requests,
  canCreate,
  canApprove,
  department,
  options,
}: {
  products: Product[];
  requests: DepartmentStockRequest[];
  canCreate: boolean;
  canApprove: boolean;
  department: string;
  options: DepartmentRequestOption[];
}) {
  const warehouse = useWarehouse();
  const {
    createDepartmentStockRequest,
    decideDepartmentStockRequest,
    actor,
    identityId,
    source,
  } = warehouse;
  const { profile } = useSession();
  const requesterName = (id: string, projectedName?: string) => {
    if (projectedName?.trim()) return projectedName.trim();
    if (
      profile?.name &&
      [profile.id, profile.email, actor, identityId].includes(id)
    ) {
      return profile.name;
    }
    const knownName = source === "memory" ? actorName(id) : id;
    return knownName !== id ? knownName : "Name unavailable";
  };
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [workingId, setWorkingId] = useState<string>();
  const { params, update: updateNavigation } = useFulfillmentNavigation();
  const detailId = params.get("request");
  const setDetailId = (id?: string) => updateNavigation({ request: id, order: undefined }, !id);
  const [acknowledgeOrder, setAcknowledgeOrder] = useState<FulfillmentOrder>();
  const acknowledgmentRequestId = useRef<string | null>(null);
  const acknowledgmentTrigger = useRef<HTMLButtonElement | null>(null);
  const requestReceiptButton = useRef<HTMLButtonElement | null>(null);
  const requestBody = useRef<HTMLDivElement | null>(null);
  const requestQueue = useRef<HTMLElement | null>(null);
  const focusRequestTrigger = (id: string | null) => {
    const trigger = Array.from(requestQueue.current?.querySelectorAll<HTMLButtonElement>('[data-view-request]') ?? [])
      .find(button => button.dataset.viewRequest === id);
    trigger?.focus();
  };
  const closeRequest = () => {
    setDetailId(undefined);
    requestAnimationFrame(() => focusRequestTrigger(detailId));
  };
  const closeAcknowledgment = () => {
    const fromRequest = acknowledgmentRequestId.current;
    acknowledgmentRequestId.current = null;
    setAcknowledgeOrder(undefined);
    requestAnimationFrame(() => {
      if (fromRequest) (requestReceiptButton.current ?? requestBody.current)?.focus();
      else if (acknowledgmentTrigger.current?.isConnected) acknowledgmentTrigger.current.focus();
    });
  };
  useEffect(() => {
    // Browser history must not leave a receipt form attached to a departed request.
    const fromRequest = acknowledgmentRequestId.current;
    if (fromRequest && fromRequest !== detailId) {
      acknowledgmentRequestId.current = null;
      setAcknowledgeOrder(undefined);
      requestAnimationFrame(() => focusRequestTrigger(fromRequest));
    }
  }, [detailId]);
  const requestedStatus = params.get("requestStatus") ?? "all";
  const statusFilter = REQUEST_STATUSES.includes(requestedStatus) ? requestedStatus : "all";
  const setStatusFilter = (value: string) => updateNavigation({ requestStatus: value });
  const detailRequest = scopedRecord(requests, detailId);
  const linkedOrder = scopedRecord(warehouse.data?.fulfillmentOrders ?? [], detailRequest?.fulfillmentOrderId ?? null);
  const linkedOrderParams = new URLSearchParams(params);
  linkedOrderParams.set('tab', 'orders');
  linkedOrderParams.delete('request');
  if (linkedOrder) linkedOrderParams.set('order', linkedOrder.id);
  const filteredRequests = requests.filter(
    (request) => statusFilter === "all" || request.status === statusFilter,
  );
  const receiptAction = (request: DepartmentStockRequest, fromDetails = false) => {
    const order = warehouse.data?.fulfillmentOrders.find(candidate => candidate.id === request.fulfillmentOrderId);
    if (request.status !== 'issued' && order?.status !== 'released' && !order?.acknowledgedAt) return null;
    if (order?.acknowledgedAt) return (
      <p className="mt-3 border-t border-line pt-3 text-sm text-muted">
        Receipt acknowledged {requestDate(order.acknowledgedAt)}
        {order.acknowledgementReference && <span className="block [overflow-wrap:anywhere]">Reference: {order.acknowledgementReference}</span>}
      </p>
    );
    const unavailable = !order
      ? 'The delivery record for this request is unavailable. Refresh the page; if it is still missing, ask the warehouse lead to check the linked order.'
      : order.status === 'completed'
        ? 'This order is already completed. Check its receipt evidence with the warehouse lead before taking further action.'
        : receiptAcknowledgmentUnavailable(order, warehouse, profile?.id);
    return (
      <div className="mt-3 min-w-0 space-y-2 border-t border-line pt-3 text-sm">
        {order && <p className="text-muted [overflow-wrap:anywhere]">Order: {order.externalReference}</p>}
        {unavailable ? <p className="text-muted">{unavailable}</p> : (
          <button type="button" className="btn-primary min-h-11 w-full sm:w-auto"
            ref={fromDetails ? requestReceiptButton : undefined}
            onClick={(event) => {
              acknowledgmentTrigger.current = event.currentTarget;
              acknowledgmentRequestId.current = fromDetails ? request.id : null;
              setAcknowledgeOrder(order);
            }}>
            Acknowledge receipt
          </button>
        )}
      </div>
    );
  };
  const decide = async (id: string, decision: "approved" | "rejected") => {
    if (
      workingId ||
      !canApprove ||
      requests.find((request) => request.id === id)?.status !==
        "pending_approval"
    )
      return;
    setWorkingId(id);
    const ok = await decideDepartmentStockRequest({ requestId: id, decision });
    setWorkingId(undefined);
    if (ok) {
      setDetailId(undefined);
      toast.success(
        decision === "approved"
          ? "Request approved. Next: Warehouse reviews the fulfillment order, verifies available stock and quality holds, then allocates for picking."
          : "Request rejected. Next: Requester reviews the decision with the approver and prepares a new corrected request if still needed. The original request stays rejected.",
      );
    }
  };
  return (
    <section ref={requestQueue} className="space-y-4" aria-labelledby="requests-title">
      <QueueCounters
        label="Request counters"
        counters={[
          { id: "all", label: "All requests" },
          { id: "pending_approval", label: "Awaiting decision" },
          { id: "approved", label: "Approved" },
          { id: "allocated", label: "Allocated" },
          { id: "issued", label: "Issued" },
        ].map((counter) => ({
          ...counter,
          count: requests.filter(
            (request) => counter.id === "all" || request.status === counter.id,
          ).length,
        }))}
        selected={statusFilter}
        onSelect={setStatusFilter}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id="requests-title"
            className="font-display text-lg font-bold text-ink"
          >
            Department requests
          </h2>
          <p className="text-sm text-muted">
            Business purpose and cost treatment stay attached to every issue.
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            className="btn-primary w-full sm:w-auto"
            onClick={() => setOpen(true)}
          >
            <Icon name="plus" className="h-4 w-4" /> New stock request
          </button>
        )}
      </div>
      <HandoffRail
        steps={[
          {
            owner: "Requesting department",
            task: "States the purpose, cost center, and required date.",
          },
          {
            owner: "Authorized reviewer",
            task: "Approves or rejects the request; cannot decide their own request.",
          },
          {
            owner: "Warehouse operator",
            task: "Allocates, picks, and issues approved stock.",
          },
        ]}
      />
      {filteredRequests.length === 0 ? (
        <EmptyState
          icon="clipboard"
          title="No department requests"
          message="Approved internal demand will move into the fulfillment queue automatically."
        />
      ) : (
        <ul
          className="grid gap-3 lg:grid-cols-2"
          aria-label="Department stock requests"
        >
          {filteredRequests.map((request) => (
            <li key={request.id} className="card min-w-0 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="break-words font-semibold text-ink">
                    {request.purpose}
                  </p>
                  <p className="text-xs text-muted">
                    {titleCase(request.requestingDepartment)} ·{" "}
                    {request.costCenter}
                  </p>
                </div>
                <StatusBadge status={request.status} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-inset p-3 text-xs">
                <div>
                  <dt className="text-faint">Required</dt>
                  <dd className="font-medium text-ink">
                    {request.requiredDate}
                  </dd>
                </div>
                <div>
                  <dt className="text-faint">Treatment</dt>
                  <dd className="font-medium text-ink">
                    {titleCase(request.expenseTreatment)}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                className="btn-ghost mt-3 w-full justify-between sm:w-auto"
                data-view-request={request.id}
                onClick={() => setDetailId(request.id)}
              >
                View request <Icon name="chevron" className="h-4 w-4" />
              </button>
              {receiptAction(request)}
            </li>
          ))}
        </ul>
      )}
      {detailRequest && !acknowledgeOrder && (
        <Sheet
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen && !workingId) closeRequest();
          }}
          title="Review request"
          footer={
            canApprove && detailRequest.status === "pending_approval" ? (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="btn-outline"
                  disabled={Boolean(workingId)}
                  onClick={() => void decide(detailRequest.id, "rejected")}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={Boolean(workingId)}
                  onClick={() => void decide(detailRequest.id, "approved")}
                >
                  Approve
                </button>
              </div>
            ) : receiptAction(detailRequest, true)
          }
        >
          <div ref={requestBody} tabIndex={-1}>
          <WorkflowSummary {...requestWorkflowSummary(detailRequest, linkedOrder, { actorIds: [actor, identityId, profile?.id], units: warehouse.data?.units })}>
            {linkedOrder && <Link className="inline-flex min-h-11 items-center text-sm underline" to={`?${linkedOrderParams.toString()}`}>Open fulfillment order</Link>}
          </WorkflowSummary>
          <table
            className="mt-4 w-full table-fixed text-left text-sm"
            aria-label="Requested items"
          >
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="py-2">
                  Item
                </th>
                <th scope="col" className="w-24 py-2 text-right">
                  Quantity
                </th>
              </tr>
            </thead>
            <tbody>
              {detailRequest.lines.map((line, index) => {
                const product = products.find(
                  (candidate) => candidate.id === line.productId,
                );
                return (
                  <tr
                    key={`${line.productId}-${index}`}
                    className="border-b border-line"
                  >
                    <td className="break-words py-3 pr-3">
                      {product?.name ?? "Item unavailable"}
                      <span className="block text-xs text-muted">
                        {product?.sku}
                      </span>
                    </td>
                    <td className="py-3 text-right tabular-nums">
                      {line.quantity}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <section className="my-4" aria-labelledby="request-purpose-title">
            <h3
              id="request-purpose-title"
              className="text-sm font-semibold text-ink"
            >
              Purpose
            </h3>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">
              {detailRequest.purpose}
            </p>
          </section>
          <dl className="my-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            {[
              ["Department", titleCase(detailRequest.requestingDepartment)],
              ["Cost center", detailRequest.costCenter],
              ["Required date", requestDate(detailRequest.requiredDate, true)],
              ["Expense treatment", titleCase(detailRequest.expenseTreatment)],
              ["Requested by", requesterName(detailRequest.requestedBy, detailRequest.requestedByName)],
              ["Requested at", requestDate(detailRequest.requestedAt)],
              ...(detailRequest.approvedBy
                ? [["Approved by", requesterName(detailRequest.approvedBy, detailRequest.approvedByName)]]
                : []),
              ...(detailRequest.approvedAt
                ? [["Approved at", requestDate(detailRequest.approvedAt)]]
                : []),
            ].map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="break-words font-medium text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          <details className="border-t border-line pt-3 text-sm">
            <summary className="cursor-pointer font-medium text-muted">
              Audit details
            </summary>
            <dl className="mt-3 space-y-3">
              {[
                ["Request ID", detailRequest.id],
                ["Requester ID", detailRequest.requestedBy],
                ["Requested timestamp", detailRequest.requestedAt],
                ...(detailRequest.approvedBy
                  ? [["Approver ID", detailRequest.approvedBy]]
                  : []),
                ...(detailRequest.approvedAt
                  ? [["Approved timestamp", detailRequest.approvedAt]]
                  : []),
                ...(detailRequest.fulfillmentOrderId
                  ? [["Fulfillment order ID", detailRequest.fulfillmentOrderId]]
                  : []),
                ...detailRequest.lines.map((line, index) => [
                  `Item ${index + 1} ID`,
                  line.productId,
                ]),
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="break-all font-mono text-xs text-ink">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
          </div>
        </Sheet>
      )}
      {detailId !== null && !detailRequest && !acknowledgeOrder && <UnavailableRecordSheet kind="Request" onClose={closeRequest} />}
      <AcknowledgeReceiptSheet
        key={acknowledgeOrder?.id}
        order={acknowledgeOrder}
        onClose={closeAcknowledgment}
      />
      <CreateRequestSheet
        open={open}
        onOpenChange={setOpen}
        products={products}
        department={department}
        options={options}
        create={createDepartmentStockRequest}
      />
    </section>
  );
}

function CreateRequestSheet({
  open,
  onOpenChange,
  products,
  department,
  options,
  create,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  department: string;
  options: DepartmentRequestOption[];
  create: ReturnType<typeof useWarehouse>["createDepartmentStockRequest"];
}) {
  const toast = useToast();
  const [purpose, setPurpose] = useState("");
  const matchingOptions = options.filter(
    (option) => option.departmentCode === department,
  );
  const availableOptions =
    matchingOptions.length > 0 ? matchingOptions : options;
  const departmentOptions = Array.from(
    new Map(
      availableOptions.map((option) => [option.departmentCode, option]),
    ).values(),
  );
  const [departmentCode, setDepartmentCode] = useState(
    departmentOptions[0]?.departmentCode ?? department,
  );
  const [costCenter, setCostCenter] = useState("");
  const [requiredDate, setRequiredDate] = useState("");
  const [treatment, setTreatment] = useState<"expense" | "custody" | "sale">(
    "expense",
  );
  const eligibleProducts = products.filter((product) => {
    const itemClass =
      product.itemClass ??
      (product.category === "device" ? "sellable_sku" : "merchandise");
    return ["sellable_sku", "merchandise", "event_material"].includes(
      itemClass,
    );
  });
  const [lines, setLines] = useState(() => [
    {
      key: crypto.randomUUID(),
      productId: eligibleProducts[0]?.id ?? "",
      quantity: 1,
    },
  ]);
  const [saving, setSaving] = useState(false);
  const merchandiseSelected = lines.some((line) => {
    const selectedProduct = eligibleProducts.find(
      (product) => product.id === line.productId,
    );
    return (
      selectedProduct?.itemClass === "merchandise" ||
      (!selectedProduct?.itemClass && selectedProduct?.category !== "device")
    );
  });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const ok = await create({
      requestingDepartment: departmentCode,
      purpose,
      costCenter,
      requiredDate,
      expenseTreatment: merchandiseSelected ? "expense" : treatment,
      lines: lines.map(({ productId, quantity }) => ({ productId, quantity })),
    });
    setSaving(false);
    if (ok) {
      toast.success("Stock request submitted. Next: An authorized Warehouse / Procurement reviewer other than the requester approves or rejects it; approval creates fulfillment demand.");
      onOpenChange(false);
      setPurpose("");
      setCostCenter("");
      setRequiredDate("");
      setLines([
        {
          key: crypto.randomUUID(),
          productId: eligibleProducts[0]?.id ?? "",
          quantity: 1,
        },
      ]);
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Request warehouse stock"
      description="Your approver receives the business context before Warehouse sees demand."
      footer={
        <button
          type="submit"
          form="department-request-form"
          className="btn-primary w-full"
          disabled={
            saving || lines.some((line) => !line.productId || line.quantity < 1)
          }
        >
          {saving ? "Submitting..." : "Submit request"}
        </button>
      }
    >
      <form
        id="department-request-form"
        className="space-y-4"
        onSubmit={(event) => void submit(event)}
      >
        <Field label="Requesting department" htmlFor="request-department">
          <select
            id="request-department"
            className="input"
            value={departmentCode}
            onChange={(event) => {
              setDepartmentCode(event.target.value);
              setCostCenter("");
            }}
            required
          >
            {departmentOptions.map((option) => (
              <option key={option.departmentCode} value={option.departmentCode}>
                {option.departmentName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Business purpose" htmlFor="request-purpose">
          <textarea
            id="request-purpose"
            className="input min-h-24"
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            required
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cost center" htmlFor="request-cost-center">
            <select
              id="request-cost-center"
              className="input"
              value={costCenter}
              onChange={(event) => setCostCenter(event.target.value)}
              required
            >
              <option value="">Select a cost center</option>
              {availableOptions
                .filter((option) => option.departmentCode === departmentCode)
                .map((option) => (
                  <option
                    key={option.costCenterCode}
                    value={option.costCenterCode}
                  >
                    {option.costCenterCode} - {option.costCenterName}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Required date" htmlFor="request-date">
            <input
              id="request-date"
              className="input"
              type="date"
              value={requiredDate}
              onChange={(event) => setRequiredDate(event.target.value)}
              required
            />
          </Field>
        </div>
        <Field label="Expense treatment" htmlFor="request-treatment">
          <select
            id="request-treatment"
            className="input"
            value={treatment}
            disabled={merchandiseSelected}
            onChange={(event) =>
              setTreatment(event.target.value as typeof treatment)
            }
          >
            <option value="expense">Expense</option>
            <option value="custody">Custody</option>
            <option value="sale">Sale</option>
          </select>
        </Field>
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-ink">
            Requested items
          </legend>
          {lines.map((line, index) => (
            <div
              key={line.key}
              className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-[minmax(0,1fr)_7rem_3rem] sm:items-end"
            >
              <Field
                label={index === 0 ? "Product" : `Product ${index + 1}`}
                htmlFor={`request-product-${line.key}`}
              >
                <select
                  id={`request-product-${line.key}`}
                  className="input"
                  value={line.productId}
                  onChange={(event) => {
                    const productId = event.target.value;
                    setLines((current) =>
                      current.map((item) =>
                        item.key === line.key ? { ...item, productId } : item,
                      ),
                    );
                    const next = eligibleProducts.find(
                      (product) => product.id === productId,
                    );
                    if (
                      next?.itemClass === "merchandise" ||
                      (!next?.itemClass && next?.category !== "device")
                    ) {
                      setTreatment("expense");
                    }
                  }}
                >
                  {eligibleProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Quantity" htmlFor={`request-quantity-${line.key}`}>
                <input
                  id={`request-quantity-${line.key}`}
                  aria-label={
                    index === 0 ? "Quantity" : `Quantity for item ${index + 1}`
                  }
                  className="input"
                  type="number"
                  min="1"
                  value={line.quantity}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((item) =>
                        item.key === line.key
                          ? { ...item, quantity: Number(event.target.value) }
                          : item,
                      ),
                    )
                  }
                />
              </Field>
              <button
                type="button"
                className="btn-ghost min-h-11 px-3"
                aria-label={`Remove item ${index + 1}`}
                disabled={lines.length === 1}
                onClick={() =>
                  setLines((current) =>
                    current.filter((item) => item.key !== line.key),
                  )
                }
              >
                <Icon name="trash" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn-outline w-full"
            onClick={() =>
              setLines((current) => [
                ...current,
                {
                  key: crypto.randomUUID(),
                  productId: eligibleProducts[0]?.id ?? "",
                  quantity: 1,
                },
              ])
            }
          >
            <Icon name="plus" /> Add another item
          </button>
          {merchandiseSelected && (
            <p className="text-xs text-muted">
              This request includes merchandise, so the entire release is
              recorded as an expense.
            </p>
          )}
        </fieldset>
      </form>
    </Sheet>
  );
}

function ReturnsWorkspace({
  products,
  orders,
  returns,
  bins,
  canCreate,
  resolutionMode,
}: {
  products: Product[];
  orders: FulfillmentOrder[];
  returns: CustomerReturnCase[];
  bins: Array<{ id: string; code: string; label?: string }>;
  canCreate: boolean;
  resolutionMode: "warehouse" | "finance" | "read_only";
}) {
  const {
    createCustomerReturnCase,
    resolveCustomerReturnCase,
    closeCustomerReturnCase,
    data,
    can,
    canOpenRoute,
  } = useWarehouse();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<CustomerReturnCase>();
  const [closing, setClosing] = useState<CustomerReturnCase>();
  useReturnHistoryAnchor('return-case-', returns);
  return (
    <section className="space-y-4" aria-labelledby="returns-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id="returns-title"
            className="font-display text-lg font-bold text-ink"
          >
            Return cases
          </h2>
          <p className="text-sm text-muted">
            Customer intent stays separate from physical inspection and
            financial resolution.
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            className="btn-primary w-full sm:w-auto"
            onClick={() => setOpen(true)}
          >
            <Icon name="plus" className="h-4 w-4" /> New return case
          </button>
        )}
      </div>
      <HandoffRail
        steps={[
          {
            owner: "Customer service",
            task: "Records the order, serial, and reported defect.",
          },
          {
            owner: "Warehouse operator",
            task: "Receives, quarantines, and inspects the item.",
          },
          {
            owner: "Finance / supplier",
            task: "Completes refund, replacement, or vendor recovery.",
          },
        ]}
      />
      {returns.length === 0 ? (
        <EmptyState
          icon="rotate"
          title="No return cases"
          message="Customer service return requests will appear here for physical intake."
        />
      ) : (
        <ul
          className="grid gap-3 lg:grid-cols-2"
          aria-label="Customer return cases"
        >
          {returns.map((record) => (
            <li key={record.id} id={`return-case-${record.id}`} tabIndex={-1} className="card scroll-mt-24 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">
                    {products.find((row) => row.id === record.productId)
                      ?.name ?? record.productId}
                  </p>
                  <p className="text-xs text-muted">
                    {record.serialNumber ?? "Non-serialized item"}
                  </p>
                  <p className="mt-2 break-words text-sm text-ink">Original order: <strong>{orders.find(order => order.id === record.sourceOrderId)?.externalReference ?? (record.sourceOrderId ? `${record.sourceOrderId} (reference unavailable)` : 'Not linked')}</strong></p>
                </div>
                <StatusBadge status={record.status} />
              </div>
              <p className="mt-3 text-sm text-ink">
                {record.defectDescription}
              </p>
              <p className="mt-2 text-xs text-muted">
                Resolution: {titleCase(record.resolution)}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
              {can('manage_returns') && canOpenRoute('returns') && record.sourceOrderId && hasReturnableOrderCustody(orders.find(order => order.id === record.sourceOrderId), data, record) && (
                <Link className="inline-flex min-h-11 items-center gap-2 text-sm underline" to={`/returns?sourceOrderId=${encodeURIComponent(record.sourceOrderId)}&returnCaseId=${encodeURIComponent(record.id)}`}>
                  <Icon name="rotate" /> Receive physical return
                </Link>
              )}
              {data?.returns.filter(physical => physical.returnCaseId === record.id).map(physical => <p key={physical.id} className="basis-full break-all text-sm">
                Physical return: <PhysicalReturnReference id={physical.id} />
              </p>)}
              {resolutionMode !== "read_only" &&
                !["resolved", "closed"].includes(record.status) && (
                  <button
                    type="button"
                    className="btn-outline w-full sm:w-auto"
                    onClick={() => setSelected(record)}
                  >
                    {resolutionMode === "finance"
                      ? "Record refund"
                      : "Record resolution"}
                  </button>
                )}
              {canCreate && record.status === "resolved" && (
                <button
                  type="button"
                  className="btn-primary w-full sm:w-auto"
                  onClick={() => setClosing(record)}
                >
                  Close with customer
                </button>
              )}
              </div>
              {record.status === "closed" &&
                record.customerResolutionReference && (
                  <p className="mt-3 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                    Customer closure: {record.customerResolutionReference}
                  </p>
                )}
            </li>
          ))}
        </ul>
      )}
      <CreateReturnSheet
        open={open}
        onOpenChange={setOpen}
        products={products}
        orders={orders}
        create={createCustomerReturnCase}
      />
      <ResolveReturnSheet
        key={selected?.id}
        record={selected}
        bins={bins}
        resolve={resolveCustomerReturnCase}
        mode={resolutionMode === "finance" ? "finance" : "warehouse"}
        onClose={() => setSelected(undefined)}
      />
      <CloseReturnSheet
        record={closing}
        close={closeCustomerReturnCase}
        onClose={() => setClosing(undefined)}
      />
    </section>
  );
}

function CreateReturnSheet({
  open,
  onOpenChange,
  products,
  orders,
  create,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  orders: FulfillmentOrder[];
  create: ReturnType<typeof useWarehouse>["createCustomerReturnCase"];
}) {
  const toast = useToast();
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [serial, setSerial] = useState("");
  const [sourceOrder, setSourceOrder] = useState("");
  const [defect, setDefect] = useState("");
  const [saving, setSaving] = useState(false);
  const selected = products.find((row) => row.id === productId);
  const eligibleOrders = orders.filter((order) =>
    order.lines.some((line) => line.productId === productId),
  );
  const matchedOrder = orders.find((order) =>
    order.lines.some(
      (line) =>
        line.productId === productId &&
        line.pickedSerialNumbers?.includes(serial.trim()),
    ),
  );
  const captureSerial = (value: string) => {
    const next = value.trim();
    setSerial(next);
    const origin = orders.find((order) =>
      order.lines.some(
        (line) =>
          line.productId === productId &&
          line.pickedSerialNumbers?.includes(next),
      ),
    );
    setSourceOrder(origin?.id ?? "");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const ok = await create({
      productId,
      serialNumber: serial || undefined,
      sourceOrderId: sourceOrder || undefined,
      defectDescription: defect,
    });
    setSaving(false);
    if (ok) {
      toast.success("Return case submitted. Next: Warehouse returns team confirms physical intake, inspection, and quarantine before resolution. Finance records refunds; Customer Service confirms customer closure afterward.");
      onOpenChange(false);
      setSerial("");
      setSourceOrder("");
      setDefect("");
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Record customer return"
      description="Customer service records the reported issue; Warehouse confirms the physical condition."
      footer={
        <button
          type="submit"
          form="return-case-form"
          className="btn-primary w-full"
          disabled={saving}
        >
          {saving ? "Creating..." : "Create return case"}
        </button>
      }
    >
      <form
        id="return-case-form"
        className="space-y-4"
        onSubmit={(event) => void submit(event)}
      >
        <Field label="Product" htmlFor="return-product">
          <select
            id="return-product"
            className="input"
            value={productId}
            onChange={(event) => {
              setProductId(event.target.value);
              setSerial("");
              setSourceOrder("");
            }}
          >
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="space-y-2 rounded-xl border border-line bg-inset p-3">
          <div>
            <p className="label">Serial number</p>
            <p className="mt-1 text-xs text-muted">
              {selected?.serialized
                ? "Scan the returned unit. Intra will locate the order that released this exact serial."
                : "Optional for non-serialized stock."}
            </p>
          </div>
          <BarcodeScanner
            label="Scan returned serial"
            manualLabel="Enter returned serial"
            manualActionLabel="Use serial"
            onDetected={captureSerial}
          />
          {serial && (
            <p className="rounded-lg border border-line bg-surface px-3 py-2 text-xs text-muted">
              Captured serial:{" "}
              <span className="font-mono font-semibold text-ink">{serial}</span>
            </p>
          )}
          {matchedOrder ? (
            <p
              role="status"
              className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-800 dark:text-emerald-200"
            >
              Release found: {matchedOrder.externalReference} (
              {orderWorkflowSummary(matchedOrder).status})
            </p>
          ) : serial ? (
            <p
              role="alert"
              className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200"
            >
              No released order contains this serial. Verify the code or select
              the original order below.
            </p>
          ) : null}
        </div>
        <Field
          label="Original release order"
          htmlFor="return-order"
          hint="Filled automatically after a serial match; select manually only when the historical release has no serial record."
        >
          <select
            id="return-order"
            className="input"
            value={sourceOrder}
            onChange={(event) => setSourceOrder(event.target.value)}
          >
            <option value="">No release order matched</option>
            {eligibleOrders.map((order) => (
              <option key={order.id} value={order.id}>
                {order.externalReference} / {orderWorkflowSummary(order).status}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Defect description" htmlFor="return-defect">
          <textarea
            id="return-defect"
            className="input min-h-24"
            value={defect}
            onChange={(event) => setDefect(event.target.value)}
            required
          />
        </Field>
      </form>
    </Sheet>
  );
}

function ResolveReturnSheet({
  record,
  bins,
  resolve,
  mode,
  onClose,
}: {
  record?: CustomerReturnCase;
  bins: Array<{ id: string; code: string; label?: string }>;
  resolve: ReturnType<typeof useWarehouse>["resolveCustomerReturnCase"];
  mode: "warehouse" | "finance";
  onClose: () => void;
}) {
  const toast = useToast();
  const { data } = useWarehouse();
  const originalOrder = data?.fulfillmentOrders.find(
    (order) => order.id === record?.sourceOrderId,
  );
  const originalAddress = originalOrder?.deliveryAddress;
  const originalAvailable = !!(
    originalOrder?.customerName?.trim() &&
    originalOrder.customerContact?.trim() &&
    originalAddress?.addressLine?.trim() &&
    originalAddress.city?.trim() &&
    originalAddress.province?.trim() &&
    originalAddress.postalCode?.trim()
  );
  const [deliveryMode, setDeliveryMode] = useState<"original" | "new">(
    originalAvailable ? "original" : "new",
  );
  const [deliveryFields, setDeliveryFields] = useState({
    customerName: "",
    customerContactNumber: "",
    customerEmail: "",
    addressLine: "",
    city: "",
    province: "",
    postalCode: "",
    reason: "",
  });
  const [resolution, setResolution] = useState<
    Exclude<ReturnResolution, "pending">
  >(mode === "finance" ? "refund" : "replacement");
  const [binId, setBinId] = useState("");
  const [reference, setReference] = useState("");
  const [financeEvidenceUrl, setFinanceEvidenceUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const pendingCommand = useRef<Parameters<typeof resolve>[0] | null>(null);
  const deliveryValid =
    deliveryMode === "original"
      ? originalAvailable
      : Object.entries(deliveryFields).every(
          ([key, value]) => key === "customerEmail" || value.trim().length > 0,
        );
  if (!record) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current || (resolution === "replacement" && !deliveryValid))
      return;
    if (!(event.currentTarget as HTMLFormElement).reportValidity()) return;
    inFlight.current = true;
    setSaving(true);
    setError("");
    pendingCommand.current ??= {
      returnCaseId: record.id,
      resolution,
      quarantineBinId: binId || undefined,
      refundReference: resolution === "refund" ? reference : undefined,
      replacementOrderId: undefined,
      replacementDelivery:
        resolution !== "replacement"
          ? undefined
          : deliveryMode === "original"
            ? { mode: "original" }
            : {
                mode: "new",
                customerName: deliveryFields.customerName.trim(),
                customerContactNumber:
                  deliveryFields.customerContactNumber.trim(),
                customerEmail: deliveryFields.customerEmail.trim() || undefined,
                deliveryAddress: {
                  addressLine: deliveryFields.addressLine.trim(),
                  city: deliveryFields.city.trim(),
                  province: deliveryFields.province.trim(),
                  postalCode: deliveryFields.postalCode.trim(),
                },
                reason: deliveryFields.reason.trim(),
              },
      supplierReference:
        resolution === "vendor_return" ? reference || undefined : undefined,
      financeEvidenceUrl: ["refund", "write_off"].includes(resolution)
        ? financeEvidenceUrl || undefined
        : undefined,
    };
    try {
      const ok = await resolve(pendingCommand.current);
      if (ok) {
        toast.success(returnResolutionSuccessMessage(pendingCommand.current.resolution));
        onClose();
      } else {
        setError(
          "Resolution was not confirmed. The submitted details are retained. Check the return case before retrying the same submission.",
        );
      }
    } catch {
      setError(
        "Resolution was not confirmed. The submitted details are retained. Check the return case before retrying the same submission.",
      );
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  const needsBin = true;
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !inFlight.current) onClose();
      }}
      title={
        mode === "finance" ? "Record finance refund" : "Resolve return case"
      }
      size="wide"
      description="Review physical intake and Quality records before resolution. Replacement creates a linked fulfillment order automatically."
      footer={
        <button
          type="submit"
          form="resolve-return-form"
          className="btn-primary w-full"
          disabled={saving || (resolution === "replacement" && !deliveryValid)}
        >
          {saving ? "Saving..." : "Save resolution"}
        </button>
      }
    >
      <form
        id="resolve-return-form"
        className="space-y-4"
        onSubmit={(event) => void submit(event)}
      >
        <WorkflowSummary {...returnWorkflowSummary(record, { returns: data?.returns })} />
        <section aria-label="Return case context" className="border-y border-line py-4 text-sm [overflow-wrap:anywhere]">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div><dt className="text-xs text-muted">Original order</dt><dd className="font-semibold">{originalOrder?.externalReference ?? (record.sourceOrderId ? `${record.sourceOrderId} (reference unavailable)` : 'Not linked to an order')}</dd></div>
            <div><dt className="text-xs text-muted">Return case</dt><dd>{record.id}</dd></div>
            <div><dt className="text-xs text-muted">Item</dt><dd>{data?.products.find(product => product.id === record.productId)?.name ?? record.productId}</dd></div>
            <div><dt className="text-xs text-muted">Serial number</dt><dd>{record.serialNumber ?? 'Not recorded'}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs text-muted">Reported issue</dt><dd>{record.defectDescription}</dd></div>
          </dl>
        </section>
        {error && (
          <p
            role="alert"
            className="text-sm text-amber-800 dark:text-amber-300"
          >
            {userFacingError(error)}
          </p>
        )}
        <fieldset
          disabled={saving || !!pendingCommand.current}
          className="min-w-0 space-y-4"
        >
          <Field label="Resolution" htmlFor="return-resolution">
            <select
              id="return-resolution"
              className="input"
              value={resolution}
              disabled={mode === "finance"}
              onChange={(event) =>
                setResolution(event.target.value as typeof resolution)
              }
            >
              <option value="replacement">Replacement</option>
              {mode === "finance" && <option value="refund">Refund</option>}
              <option value="vendor_return">Vendor return</option>
              <option value="re_kit">Re-kit</option>
              <option value="write_off">Write off</option>
            </select>
          </Field>
          {resolution === "replacement" && (
            <section
              aria-label="Replacement delivery"
              className="space-y-3 border-y border-line py-3"
            >
              <h3 className="text-sm font-semibold text-ink">
                Replacement delivery
              </h3>
              <fieldset className="min-w-0 space-y-2">
                <legend className="sr-only">Delivery details source</legend>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="replacement-delivery-mode"
                    value="original"
                    checked={deliveryMode === "original"}
                    disabled={!originalAvailable}
                    onChange={() => setDeliveryMode("original")}
                  />
                  Original delivery details
                </label>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="replacement-delivery-mode"
                    value="new"
                    checked={deliveryMode === "new"}
                    onChange={() => setDeliveryMode("new")}
                  />
                  New delivery details
                </label>
              </fieldset>
              {!originalAvailable && (
                <p className="text-sm text-muted">
                  Original delivery details are unavailable or incomplete.
                  Confirm new recipient and address details with Customer
                  Service.
                </p>
              )}
              {deliveryMode === "original" &&
                originalOrder &&
                originalAddress && (
                  <div className="space-y-1 break-words text-sm">
                    <p>
                      {originalOrder.customerName} /{" "}
                      {maskContact(originalOrder.customerContact)}
                    </p>
                    <p>
                      {originalAddress.addressLine}, {originalAddress.city},{" "}
                      {originalAddress.province} {originalAddress.postalCode}
                    </p>
                  </div>
                )}
              {deliveryMode === "new" && (
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  {(
                    [
                      ["customerName", "Replacement recipient name", "text"],
                      [
                        "customerContactNumber",
                        "Replacement contact number",
                        "tel",
                      ],
                      [
                        "customerEmail",
                        "Replacement email (optional)",
                        "email",
                      ],
                      ["addressLine", "Replacement address line", "text"],
                      ["city", "Replacement city", "text"],
                      ["province", "Replacement province", "text"],
                      ["postalCode", "Replacement postal code", "text"],
                      ["reason", "Reason for new delivery details", "text"],
                    ] as const
                  ).map(([key, label, type]) => (
                    <Field
                      key={key}
                      label={label}
                      htmlFor={`replacement-${key}`}
                    >
                      <input
                        id={`replacement-${key}`}
                        className="input"
                        type={type}
                        value={deliveryFields[key]}
                        required={key !== "customerEmail"}
                        onChange={(event) =>
                          setDeliveryFields((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                      />
                    </Field>
                  ))}
                </div>
              )}
            </section>
          )}
          {needsBin && (
            <Field label="Quarantine bin" htmlFor="return-bin">
              <select
                id="return-bin"
                className="input"
                value={binId}
                onChange={(event) => setBinId(event.target.value)}
                required
              >
                <option value="">Select a controlled bin</option>
                {bins.map((bin) => (
                  <option key={bin.id} value={bin.id}>
                    {bin.code} / {bin.label ?? "Controlled storage"}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {["refund", "vendor_return"].includes(resolution) && (
            <Field
              label={
                resolution === "refund"
                  ? "Finance refund reference"
                  : "Supplier RMA reference"
              }
              htmlFor="return-reference"
              hint="Use the attributable Finance or supplier case reference."
            >
              <input
                id="return-reference"
                className="input"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                required
              />
            </Field>
          )}
          {["refund", "write_off"].includes(resolution) && (
            <Field
              label="Finance evidence URL"
              htmlFor="return-finance-evidence"
            >
              <input
                id="return-finance-evidence"
                className="input"
                type="url"
                value={financeEvidenceUrl}
                onChange={(event) => setFinanceEvidenceUrl(event.target.value)}
                required
              />
            </Field>
          )}
        </fieldset>
      </form>
    </Sheet>
  );
}

function CloseReturnSheet({
  record,
  close,
  onClose,
}: {
  record?: CustomerReturnCase;
  close: ReturnType<typeof useWarehouse>["closeCustomerReturnCase"];
  onClose: () => void;
}) {
  const toast = useToast();
  const [reference, setReference] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [saving, setSaving] = useState(false);
  if (!record) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const ok = await close({
      returnCaseId: record.id,
      customerResolutionReference: reference,
      customerClosureEvidenceUrl: evidenceUrl,
    });
    setSaving(false);
    if (ok) {
      toast.success("Customer closure recorded. No further customer-case handoff; Quality Control must verify any separate stock release. Customer closure does not release quarantined stock.");
      onClose();
    }
  };
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Close customer return"
      description="Customer Service confirms the customer received the refund, replacement, or final disposition."
      footer={
        <button
          type="submit"
          form="close-return-form"
          className="btn-primary w-full"
          disabled={saving}
        >
          {saving ? "Saving..." : "Confirm customer closure"}
        </button>
      }
    >
      <form
        id="close-return-form"
        className="space-y-4"
        onSubmit={(event) => void submit(event)}
      >
        <WorkflowSummary {...returnWorkflowSummary(record)} />
        <Field
          label="Customer resolution reference"
          htmlFor="customer-resolution-reference"
        >
          <input
            id="customer-resolution-reference"
            className="input"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            required
          />
        </Field>
        <Field
          label="Customer confirmation evidence URL"
          htmlFor="customer-closure-evidence"
        >
          <input
            id="customer-closure-evidence"
            className="input"
            type="url"
            value={evidenceUrl}
            onChange={(event) => setEvidenceUrl(event.target.value)}
            required
          />
        </Field>
      </form>
    </Sheet>
  );
}
function KitsWorkspace({
  products,
  definitions,
  workOrders,
  returnCases,
  locations,
  bins,
  canCreate,
  canReKit,
}: {
  products: Product[];
  definitions: KitDefinition[];
  workOrders: ReKitWorkOrder[];
  returnCases: CustomerReturnCase[];
  locations: Array<{ id: string; name: string }>;
  bins: Array<{ id: string; locationId: string; code: string; label?: string }>;
  canCreate: boolean;
  canReKit: boolean;
}) {
  const { createKitDefinition, createReKitWorkOrder, completeReKitWorkOrder } =
    useWarehouse();
  const [kitOpen, setKitOpen] = useState(false);
  const [reKitOpen, setReKitOpen] = useState(false);
  const [completionWork, setCompletionWork] = useState<ReKitWorkOrder>();
  const eligibleReturns = returnCases.filter(
    (row) => row.resolution === "re_kit",
  );
  const activeKits = definitions.filter((row) => row.status === "active");
  return (
    <section className="space-y-4" aria-labelledby="kits-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id="kits-title"
            className="font-display text-lg font-bold text-ink"
          >
            Kits and re-kits
          </h2>
          <p className="text-sm text-muted">
            Product owns the recipe; Warehouse owns physical assembly and
            lineage.
          </p>
        </div>
        <div className="grid w-full gap-2 sm:flex sm:w-auto">
          {canReKit && eligibleReturns.length > 0 && activeKits.length > 0 && (
            <button
              type="button"
              className="btn-outline"
              onClick={() => setReKitOpen(true)}
            >
              Create re-kit work order
            </button>
          )}
          {canCreate && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setKitOpen(true)}
            >
              <Icon name="plus" className="h-4 w-4" /> New kit definition
            </button>
          )}
        </div>
      </div>
      <HandoffRail
        steps={[
          {
            owner: "Product department",
            task: "Owns approved components, quantities, and version.",
          },
          {
            owner: "Warehouse supervisor",
            task: "Controls definition setup and exceptions.",
          },
          {
            owner: "Warehouse operator",
            task: "Scans components and preserves serial lineage.",
          },
        ]}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-bold text-ink">Definitions</h3>
          {definitions.length === 0 ? (
            <EmptyState
              icon="box"
              title="No kit definitions"
              message="Product-approved bundle recipes will appear here."
            />
          ) : (
            <ul className="space-y-2" aria-label="Kit definitions">
              {definitions.map((definition) => (
                <li key={definition.id} className="card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">
                        {definition.name}
                      </p>
                      <p className="text-xs text-muted">
                        Version {definition.version} ·{" "}
                        {definition.components.length} component type(s)
                      </p>
                      <p className="mt-1 text-xs font-medium text-ink">
                        Product approval: {definition.productApprovalReference}
                      </p>
                    </div>
                    <StatusBadge status={definition.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-sm font-bold text-ink">Re-kit work</h3>
          {workOrders.length === 0 ? (
            <EmptyState
              icon="rotate"
              title="No re-kit work"
              message="Eligible open-box returns can be assembled against an active recipe."
            />
          ) : (
            <ul className="space-y-2" aria-label="Re-kit work orders">
              {workOrders.map((work) => (
                <li key={work.id} className="card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">
                        {work.outputSerialNumber}
                      </p>
                      <p className="text-xs text-muted">
                        {titleCase(work.condition)} ·{" "}
                        {work.componentSerialNumbers.length} scanned
                        component(s)
                      </p>
                    </div>
                    <StatusBadge status={work.status} />
                  </div>
                  {canReKit &&
                    ["inspection", "ready"].includes(work.status) && (
                      <button
                        type="button"
                        className="btn-primary mt-3 w-full sm:w-auto"
                        onClick={() => setCompletionWork(work)}
                      >
                        Complete re-kit
                      </button>
                    )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <CreateKitSheet
        open={kitOpen}
        onOpenChange={setKitOpen}
        products={products}
        create={createKitDefinition}
      />
      {reKitOpen && canReKit && (
        <CreateReKitSheet
          open={reKitOpen}
          onOpenChange={setReKitOpen}
          returnCases={eligibleReturns}
          definitions={activeKits}
          create={createReKitWorkOrder}
        />
      )}
      <CompleteReKitSheet
        key={completionWork?.id}
        work={completionWork}
        locations={locations}
        bins={bins}
        complete={completeReKitWorkOrder}
        onClose={() => setCompletionWork(undefined)}
      />
    </section>
  );
}

function CompleteReKitSheet({
  work,
  locations,
  bins,
  complete,
  onClose,
}: {
  work?: ReKitWorkOrder;
  locations: Array<{ id: string; name: string }>;
  bins: Array<{ id: string; locationId: string; code: string; label?: string }>;
  complete: ReturnType<typeof useWarehouse>["completeReKitWorkOrder"];
  onClose: () => void;
}) {
  const toast = useToast();
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const eligibleBins = bins.filter((bin) => bin.locationId === locationId);
  const [binId, setBinId] = useState("");
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState("");
  if (!work) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!eligibleBins.some((bin) => bin.id === binId)) {
      setValidationError(
        "Scan an active destination bin in the selected warehouse.",
      );
      return;
    }
    setSaving(true);
    const ok = await complete({ workOrderId: work.id, locationId, binId });
    setSaving(false);
    if (ok) {
      toast.success("Re-kit completed and open-box stock posted.");
      onClose();
    }
  };
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Complete re-kit"
      description={`Post ${work.outputSerialNumber} as traceable open-box stock after inspection.`}
      footer={
        <button
          type="submit"
          form="complete-rekit-form"
          className="btn-primary w-full"
          disabled={saving || !binId}
        >
          {saving ? "Posting..." : "Post open-box stock"}
        </button>
      }
    >
      <form
        id="complete-rekit-form"
        className="space-y-4"
        onSubmit={(event) => void submit(event)}
      >
        {validationError && (
          <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">
            {validationError}
          </p>
        )}
        <Field label="Destination warehouse" htmlFor="rekit-location">
          <select
            id="rekit-location"
            className="input"
            value={locationId}
            onChange={(event) => {
              setLocationId(event.target.value);
              setBinId("");
            }}
            required
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </Field>
        <BarcodeScanner
          key={locationId}
          label="Scan destination rack or bin"
          manualLabel="Enter destination bin manually"
          manualActionLabel="Use destination bin"
          onDetected={(code) => {
            const bin = eligibleBins.find(
              (row) => row.code.toLowerCase() === code.trim().toLowerCase(),
            );
            setBinId(bin?.id ?? "");
            setValidationError(
              bin
                ? ""
                : "Scan an active destination bin in the selected warehouse.",
            );
          }}
        />
        <output
          aria-label="Captured destination bin"
          className="text-sm text-ink"
        >
          {eligibleBins.find((bin) => bin.id === binId)?.code ??
            "No destination bin captured"}
        </output>
      </form>
    </Sheet>
  );
}

function CreateKitSheet({
  open,
  onOpenChange,
  products,
  create,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  create: ReturnType<typeof useWarehouse>["createKitDefinition"];
}) {
  const toast = useToast();
  const [kitProductId, setKitProductId] = useState(products[0]?.id ?? "");
  const [name, setName] = useState("");
  const [productApprovalReference, setProductApprovalReference] = useState("");
  const [componentId, setComponentId] = useState(products[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [saving, setSaving] = useState(false);
  const component = products.find((row) => row.id === componentId);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const ok = await create({
      productId: kitProductId,
      name,
      components: [
        {
          productId: componentId,
          quantity,
          serializationPolicy:
            component?.serializationPolicy ??
            (component?.serialized ? "required" : "none"),
        },
      ],
      status: "active",
      ownerDepartment: "product",
      productApprovalReference,
    });
    setSaving(false);
    if (ok) {
      toast.success("Product-owned kit definition published.");
      onOpenChange(false);
      setName("");
      setProductApprovalReference("");
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Define a bundle or kit"
      description="This records Product's approved recipe. Warehouse uses it for scan validation."
      footer={
        <button
          type="submit"
          form="kit-definition-form"
          className="btn-primary w-full"
          disabled={saving}
        >
          {saving ? "Saving..." : "Save kit definition"}
        </button>
      }
    >
      <form
        id="kit-definition-form"
        className="space-y-4"
        onSubmit={(event) => void submit(event)}
      >
        <Field label="Kit product" htmlFor="kit-product">
          <select
            id="kit-product"
            className="input"
            value={kitProductId}
            onChange={(event) => setKitProductId(event.target.value)}
          >
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Definition name" htmlFor="kit-name">
          <input
            id="kit-name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </Field>
        <Field
          label="Product approval reference"
          htmlFor="kit-product-approval"
        >
          <input
            id="kit-product-approval"
            className="input"
            value={productApprovalReference}
            onChange={(event) =>
              setProductApprovalReference(event.target.value)
            }
            placeholder="Product decision, ticket, or approved specification"
            required
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
          <Field label="Component product" htmlFor="kit-component">
            <select
              id="kit-component"
              className="input"
              value={componentId}
              onChange={(event) => setComponentId(event.target.value)}
            >
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantity" htmlFor="kit-quantity">
            <input
              id="kit-quantity"
              className="input"
              type="number"
              min="1"
              value={quantity}
              onChange={(event) => setQuantity(Number(event.target.value))}
            />
          </Field>
        </div>
        <p className="rounded-lg bg-brand-500/10 p-3 text-sm text-brand-800 dark:text-brand-300">
          Owner: Product department. Physical execution: Warehouse operator.
        </p>
      </form>
    </Sheet>
  );
}

function CreateReKitSheet({
  open,
  onOpenChange,
  returnCases,
  definitions,
  create,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnCases: CustomerReturnCase[];
  definitions: KitDefinition[];
  create: ReturnType<typeof useWarehouse>["createReKitWorkOrder"];
}) {
  const toast = useToast();
  const { data, can } = useWarehouse();
  const [returnId, setReturnId] = useState(returnCases[0]?.id ?? "");
  const [definitionId, setDefinitionId] = useState(definitions[0]?.id ?? "");
  const [outputSerial, setOutputSerial] = useState("");
  const [componentSerials, setComponentSerials] = useState<string[]>([]);
  const [componentBins, setComponentBins] = useState<Record<string, string>>(
    {},
  );
  const sourceLocations =
    data?.locations.filter(
      (location) => location.type === "warehouse" && location.active !== false,
    ) ?? [];
  const [locationId, setLocationId] = useState(sourceLocations[0]?.id ?? "");
  const [sourceBinId, setSourceBinId] = useState("");
  const [validationError, setValidationError] = useState("");
  const [condition, setCondition] = useState<"open_box" | "reconditioned">(
    "open_box",
  );
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const definition = definitions.find(
    (row) => row.id === definitionId && row.status === "active",
  );
  const sourceBin = data?.storageAreas.find(
    (bin) =>
      bin.id === sourceBinId &&
      bin.locationId === locationId &&
      bin.active !== false,
  );
  const requiredComponents =
    definition?.components.filter((component) =>
      ["required", "asset_tag"].includes(component.serializationPolicy),
    ) ?? [];
  const requiredCount = requiredComponents.reduce(
    (sum, component) => sum + component.quantity,
    0,
  );
  const resetScans = () => {
    setOutputSerial("");
    setComponentSerials([]);
    setComponentBins({});
    setSourceBinId("");
    setValidationError("");
  };
  const outputError = (code: string) => {
    if (!code || /[\r\n,]/.test(code))
      return "Scan one output serial number at a time.";
    if (
      data?.products.some(
        (product) => product.sku === code || product.barcode === code,
      ) ||
      data?.storageAreas.some((bin) => bin.code === code)
    )
      return "Scan the new output serial label, not a product or bin barcode.";
    if (
      data?.units.some((unit) => unit.serialNumber === code) ||
      data?.reKitWorkOrders.some(
        (work) =>
          work.outputSerialNumber === code && work.status !== "cancelled",
      )
    )
      return "This output serial already exists. Scan a new output label.";
    return "";
  };
  const componentError = (
    code: string,
    captured: string[],
    binId = sourceBinId,
  ) => {
    const bin = data?.storageAreas.find(
      (row) =>
        row.id === binId &&
        row.locationId === locationId &&
        row.active !== false,
    );
    if (!bin)
      return "Scan an active source rack or bin in the selected warehouse first.";
    if (captured.includes(code))
      return "This component serial was already captured.";
    const unit = data?.units.find((row) => row.serialNumber === code);
    if (!unit)
      return "Serial not found. Scan a registered component serial or check the label.";
    const component = requiredComponents.find(
      (row) => row.productId === unit.productId,
    );
    if (!component)
      return "This product is not a serialized component in the selected kit recipe.";
    if (!["in_stock", "returned"].includes(unit.status))
      return "This component is not eligible for re-kitting. Check its stock and inspection status.";
    if (unit.locationId !== locationId || unit.binId !== bin.id)
      return "This component belongs to a different warehouse or bin. Check the source location.";
    if (
      data?.reKitWorkOrders.some(
        (work) =>
          !["cancelled", "completed"].includes(work.status) &&
          work.componentSerialNumbers.includes(code),
      )
    )
      return "This component is already assigned to another re-kit work order.";
    const count = captured.filter((serial) =>
      data?.units.some(
        (row) =>
          row.serialNumber === serial && row.productId === unit.productId,
      ),
    ).length;
    if (count >= component.quantity)
      return "The required quantity for this component is already captured.";
    return "";
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current || !can("manage_returns")) return;
    if (
      !definition ||
      !returnCases.some(
        (row) => row.id === returnId && row.resolution === "re_kit",
      )
    ) {
      setValidationError(
        "Select an eligible return and an active kit definition.",
      );
      return;
    }
    const error =
      outputError(outputSerial) ||
      componentSerials
        .map((serial, index) =>
          componentError(
            serial,
            componentSerials.slice(0, index),
            componentBins[serial],
          ),
        )
        .find(Boolean);
    if (error || !outputSerial || componentSerials.length !== requiredCount) {
      setValidationError(
        error ||
          `Capture the output serial and exactly ${requiredCount} component serial(s).`,
      );
      return;
    }
    inFlight.current = true;
    setSaving(true);
    try {
      const ok = await create({
        sourceReturnCaseId: returnId,
        kitDefinitionId: definitionId,
        outputSerialNumber: outputSerial,
        componentSerialNumbers: componentSerials,
        condition,
      });
      if (ok) {
        toast.success("Re-kit work order created for inspection.");
        onOpenChange(false);
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!inFlight.current) onOpenChange(next);
      }}
      title="Create re-kit work order"
      description="Reuse only inspected components and retain their serial lineage."
      footer={
        <button
          type="submit"
          form="rekit-form"
          className="btn-primary w-full"
          disabled={
            saving || !outputSerial || componentSerials.length !== requiredCount
          }
        >
          {saving ? "Creating..." : "Create work order"}
        </button>
      }
    >
      <form
        id="rekit-form"
        className="space-y-4"
        onSubmit={(event) => void submit(event)}
      >
        {validationError && (
          <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">
            {validationError}
          </p>
        )}
        <fieldset disabled={saving} className="min-w-0 space-y-4">
          <Field label="Source return case" htmlFor="rekit-return">
            <select
              id="rekit-return"
              className="input"
              value={returnId}
              onChange={(event) => {
                setReturnId(event.target.value);
                resetScans();
              }}
            >
              {returnCases.map((record) => (
                <option key={record.id} value={record.id}>
                  {record.serialNumber ?? record.id}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Active kit definition" htmlFor="rekit-definition">
            <select
              id="rekit-definition"
              className="input"
              value={definitionId}
              onChange={(event) => {
                setDefinitionId(event.target.value);
                resetScans();
              }}
            >
              {definitions.map((definition) => (
                <option key={definition.id} value={definition.id}>
                  {definition.name} v{definition.version}
                </option>
              ))}
            </select>
          </Field>
          <section className="space-y-3" aria-label="Output identity">
            <h3 className="text-sm font-semibold text-ink">
              Output:{" "}
              {data?.products.find(
                (product) => product.id === definition?.productId,
              )?.name ?? "Select a kit"}
            </h3>
            <BarcodeScanner
              key={`output-${returnId}-${definitionId}`}
              label="Scan output serial"
              manualLabel="Enter output serial manually"
              manualActionLabel="Use output serial"
              onDetected={(value) => {
                const code = value.trim();
                const error = outputError(code);
                setValidationError(error);
                if (!error) setOutputSerial(code);
              }}
            />
            <output
              aria-label="Captured output serial"
              className="block break-all font-mono text-sm"
            >
              {outputSerial || "No output serial captured"}
            </output>
          </section>
          <Field label="Source warehouse" htmlFor="rekit-source-location">
            <select
              id="rekit-source-location"
              className="input"
              value={locationId}
              onChange={(event) => {
                setLocationId(event.target.value);
                setSourceBinId("");
                setComponentSerials([]);
                setValidationError("");
              }}
            >
              {sourceLocations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </Field>
          <BarcodeScanner
            key={`bin-${returnId}-${definitionId}-${locationId}`}
            label="Scan source rack or bin"
            manualLabel="Enter re-kit source bin manually"
            manualActionLabel="Use source bin"
            onDetected={(code) => {
              const bin = data?.storageAreas.find(
                (row) =>
                  row.code.toLowerCase() === code.trim().toLowerCase() &&
                  row.locationId === locationId &&
                  row.active !== false,
              );
              setSourceBinId(bin?.id ?? "");
              setValidationError(
                bin
                  ? ""
                  : "Scan an active source rack or bin in the selected warehouse.",
              );
            }}
          />
          <p className="text-sm text-muted">
            Source bin: {sourceBin?.code ?? "Not captured"}
          </p>
          <section className="space-y-3" aria-label="Component identities">
            <h3 className="text-sm font-semibold text-ink">
              Components: {componentSerials.length} / {requiredCount}
            </h3>
            <ul className="space-y-1 text-sm text-muted">
              {requiredComponents.map((component) => (
                <li key={component.productId}>
                  {data?.products.find(
                    (product) => product.id === component.productId,
                  )?.name ?? "Component"}
                  : {component.quantity}
                </li>
              ))}
            </ul>
            <BarcodeScanner
              key={`components-${returnId}-${definitionId}-${locationId}-${sourceBinId}`}
              label="Scan component serial"
              manualLabel="Enter component serial manually"
              manualActionLabel="Add component"
              onDetected={(value) => {
                const code = value.trim();
                const error = componentError(code, componentSerials);
                setValidationError(error);
                if (!error) {
                  setComponentSerials((current) => [...current, code]);
                  setComponentBins((current) => ({
                    ...current,
                    [code]: sourceBinId,
                  }));
                }
              }}
            />
            <ul className="space-y-2" aria-label="Captured component serials">
              {componentSerials.map((serial) => (
                <li
                  key={serial}
                  className="flex min-w-0 items-center justify-between gap-2 border-b border-line py-2"
                >
                  <span className="break-all font-mono text-sm">{serial}</span>
                  <button
                    type="button"
                    className="btn-ghost shrink-0"
                    aria-label={`Remove component ${serial}`}
                    title="Remove component"
                    onClick={() => {
                      setComponentSerials((current) =>
                        current.filter((value) => value !== serial),
                      );
                      setValidationError("");
                    }}
                  >
                    <Icon name="trash" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <Field label="Condition" htmlFor="rekit-condition">
            <select
              id="rekit-condition"
              className="input"
              value={condition}
              onChange={(event) =>
                setCondition(event.target.value as typeof condition)
              }
            >
              <option value="open_box">Open box</option>
              <option value="reconditioned">Reconditioned</option>
            </select>
          </Field>
        </fieldset>
      </form>
    </Sheet>
  );
}

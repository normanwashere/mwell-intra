import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
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
import { useWarehouse } from "@/app/store";
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
import { BulkOrderImportSheet } from "@/components/fulfillment/BulkOrderImportSheet";
import { OrderIntakeSheet } from "@/components/fulfillment/OrderIntakeSheet";
import { downloadText } from "@/app/download";
import { fulfillmentOrdersToCsv } from "@/domain/orderIntakeOptions";

type WorkspaceTab = "orders" | "requests" | "returns" | "kits";

const TABS: Array<{ id: WorkspaceTab; label: string; shortLabel: string }> = [
  { id: "orders", label: "Orders and events", shortLabel: "Demand" },
  { id: "requests", label: "Department requests", shortLabel: "Requests" },
  { id: "returns", label: "Return cases", shortLabel: "Returns" },
  { id: "kits", label: "Kits and re-kits", shortLabel: "Kits" },
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

function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status as keyof typeof STATUS_TONE] ?? "slate";
  return <Badge tone={tone}>{titleCase(status)}</Badge>;
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

export function FulfillmentPage() {
  const warehouse = useWarehouse();
  const { data, role, roleLabel, can, actor, identityId } = warehouse;
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
  const canReviewFinanceReturn = can("approve_stock_adjustment_finance");
  const canDefineKits =
    [
      "warehouse_supervisor",
      "logistics_supervisor",
      "warehouse_admin",
    ].includes(role) && can("manage_products");
  const isFloorOperator = role === "warehouse_operator";
  const visibleTabs = isFloorOperator
    ? TABS.filter(
        (item) =>
          item.id === "orders" ||
          (item.id === "returns" &&
            (canIntakeReturn || canManageReturns || canReviewFinanceReturn)),
      )
    : TABS;
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
    setSearchParams(nextParams);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={isFloorOperator ? "Pick & Pack" : "Fulfillment"}
        subtitle={
          isFloorOperator
            ? `${roleLabel} queue for allocation, scanning, packing, and controlled release`
            : "One controlled queue from demand through warehouse release"
        }
        icon="list"
      />

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

      {visibleTabs.length > 1 && (
        <div
          className="grid grid-cols-2 gap-1 rounded-xl bg-inset p-1 sm:grid-cols-4"
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
          canAcknowledge={canCreateOrder || canRequestStock || canExecute}
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

function OrdersWorkspace({
  products,
  locations,
  events,
  orders,
  canCreate,
  canExecute,
  canAcknowledge,
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
  canAcknowledge: boolean;
  actorIds: string[];
  storageAreas: StorageArea[];
  units: InventoryUnit[];
  stockLevels: StockLevel[];
  floorMode: boolean;
}) {
  const { createFulfillmentOrder, advanceFulfillmentOrder } = useWarehouse();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [workingId, setWorkingId] = useState<string>();
  const [pickOrder, setPickOrder] = useState<FulfillmentOrder>();
  const [packOrder, setPackOrder] = useState<FulfillmentOrder>();
  const [backorderOrder, setBackorderOrder] = useState<FulfillmentOrder>();
  const [cancelOrder, setCancelOrder] = useState<FulfillmentOrder>();
  const [acknowledgeOrder, setAcknowledgeOrder] = useState<FulfillmentOrder>();
  const [trackingOrder, setTrackingOrder] = useState<FulfillmentOrder>();
  const [detailOrder, setDetailOrder] = useState<FulfillmentOrder>();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [channelFilter, setChannelFilter] = useState("all");
  const channelOptions = [
    ...new Set(
      orders.map((order) => order.ecommerceChannel).filter(Boolean) as string[],
    ),
  ].sort();
  const filteredOrders = orders.filter((order) => {
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
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "active"
        ? !["completed", "cancelled"].includes(order.status)
        : order.status === statusFilter);
    const matchesChannel =
      channelFilter === "all" || order.ecommerceChannel === channelFilter;
    return matchesQuery && matchesStatus && matchesChannel;
  });

  const advance = async (
    order: FulfillmentOrder,
    action: FulfillmentAction,
  ) => {
    setWorkingId(order.id);
    const ok = await advanceFulfillmentOrder({ orderId: order.id, action });
    setWorkingId(undefined);
    if (ok)
      toast.success(
        `${order.externalReference} moved to ${titleCase(action === "allocate" ? "allocated" : "picking")}.`,
      );
  };

  return (
    <section className="space-y-4" aria-labelledby="orders-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id="orders-title"
            className="font-display text-lg font-bold text-ink"
          >
            Orders and event demand
          </h2>
          <p className="text-sm text-muted">
            Ecommerce, event, and third-party demand through pick, pack,
            release, and settlement.
          </p>
        </div>
        {(canCreate || filteredOrders.length > 0) && (
          <div className="grid gap-2 sm:flex">
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
              <>
                <button
                  type="button"
                  className="btn-outline w-full sm:w-auto"
                  onClick={() => setImportOpen(true)}
                >
                  <Icon name="upload" className="h-4 w-4" /> Import existing
                  tracker
                </button>
                <button
                  type="button"
                  className="btn-primary w-full sm:w-auto"
                  onClick={() => setCreateOpen(true)}
                >
                  <Icon name="plus" className="h-4 w-4" /> New order / demand
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <HandoffRail
        steps={[
          {
            owner: "Sales, Operations, or Marketing",
            task: "Submit confirmed customer, event, or campaign demand.",
          },
          {
            owner: "Warehouse operator",
            task: "Allocate, scan, pick, pack, and release.",
          },
          {
            owner: "Courier and Finance",
            task: "Carry the waybill, sales value, refund, and settlement evidence.",
          },
        ]}
      />

      <div className="grid gap-2 rounded-xl border border-line bg-surface p-3 md:grid-cols-[minmax(14rem,1fr)_12rem_12rem]">
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
        <Field label="Status" htmlFor="fulfillment-status-filter">
          <select
            id="fulfillment-status-filter"
            className="input"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="active">Active work</option>
            <option value="all">All statuses</option>
            {[
              "received",
              "allocated",
              "picking",
              "packing",
              "ready",
              "released",
              "completed",
              "cancelled",
            ].map((status) => (
              <option key={status} value={status}>
                {titleCase(status)}
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

      {orders.some((order) => order.source === "third_party") && (
        <div className="flex flex-col gap-1 border-l-4 border-emerald-500 bg-emerald-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-ink">
              Third-party event sales
            </p>
            <p className="text-xs text-muted">
              Reported channel value for reconciliation; Finance remains the
              settlement owner.
            </p>
          </div>
          <p className="font-display text-xl font-bold text-ink">
            {new Intl.NumberFormat("en-PH", {
              style: "currency",
              currency: "PHP",
              currencyDisplay: "code",
            }).format(
              orders
                .filter((order) => order.source === "third_party")
                .reduce((sum, order) => sum + (order.grossSalesAmount ?? 0), 0),
            )}
          </p>
        </div>
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
          className={floorMode ? "space-y-3" : "grid gap-3 lg:grid-cols-2"}
          aria-label="Fulfillment demand"
        >
          {filteredOrders.map((order) => (
            <li
              key={order.id}
              aria-label={`Order ${order.externalReference}`}
              className="card min-w-0 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words font-semibold text-ink">
                    {order.externalReference}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
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
                  {order.grossSalesAmount !== undefined && (
                    <p className="mt-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      {new Intl.NumberFormat("en-PH", {
                        style: "currency",
                        currency: "PHP",
                        currencyDisplay: "code",
                      }).format(order.grossSalesAmount)}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <StatusBadge status={order.status} />
                  {order.deliveryMethod === "shipment" && (
                    <StatusBadge
                      status={order.shipmentStatus ?? "awaiting_dispatch"}
                    />
                  )}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-inset p-3 text-xs">
                <div>
                  <span className="block text-faint">Pick location</span>
                  <span className="font-medium text-ink">
                    {locations.find((row) => row.id === order.sourceLocationId)
                      ?.name ?? "Assign on allocation"}
                  </span>
                </div>
                <div>
                  <span className="block text-faint">
                    {order.deliveryMethod === "shipment"
                      ? "Courier / waybill"
                      : "Recipient / handover"}
                  </span>
                  <span className="font-medium text-ink">
                    {order.deliveryMethod === "shipment" && order.courier
                      ? `${order.courier} / ${order.waybillNumber}`
                      : order.handoverRecipientName
                        ? `${order.handoverRecipientName} / ${order.handoverReference}`
                        : "Pending preparation"}
                  </span>
                </div>
              </div>
              {order.lines.some((line) => line.bundleSetCodes?.length) && (
                <p className="mt-3 text-xs text-muted">
                  Bundle sets:{" "}
                  {order.lines
                    .flatMap((line) => line.bundleSetCodes ?? [])
                    .join(", ")}
                </p>
              )}
              <button
                type="button"
                className="btn-ghost mt-3 w-full justify-between sm:w-auto"
                onClick={() => setDetailOrder(order)}
              >
                View order details
                <Icon name="chevron" className="h-4 w-4" />
              </button>
              {canExecute &&
                !["released", "completed", "cancelled"].includes(
                  order.status,
                ) && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {order.status === "received" && (
                      <>
                        <ActionButton
                          busy={workingId === order.id}
                          onClick={() => void advance(order, "allocate")}
                        >
                          Allocate stock
                        </ActionButton>
                        <button
                          type="button"
                          className="btn-outline flex-1 sm:flex-none"
                          onClick={() => setBackorderOrder(order)}
                        >
                          Split backorder
                        </button>
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
                      <ActionButton onClick={() => setPickOrder(order)}>
                        Confirm scanned pick
                      </ActionButton>
                    )}
                    {order.status === "packing" && (
                      <ActionButton onClick={() => setPackOrder(order)}>
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
                    <button
                      type="button"
                      className="btn-outline flex-1 sm:flex-none"
                      onClick={() => setCancelOrder(order)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              {canAcknowledge &&
                order.status === "released" &&
                order.deliveryMethod !== "shipment" && (
                  <button
                    type="button"
                    className="btn-primary mt-4 w-full sm:w-auto"
                    onClick={() => setAcknowledgeOrder(order)}
                  >
                    Acknowledge receipt
                  </button>
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
        order={pickOrder}
        products={products}
        storageAreas={storageAreas}
        units={units}
        stockLevels={stockLevels}
        onClose={() => setPickOrder(undefined)}
      />
      <PackSheet
        order={packOrder}
        products={products}
        onClose={() => setPackOrder(undefined)}
      />
      <BackorderSheet
        order={backorderOrder}
        products={products}
        onClose={() => setBackorderOrder(undefined)}
      />
      <CancelOrderSheet
        order={cancelOrder}
        onClose={() => setCancelOrder(undefined)}
      />
      <AcknowledgeReceiptSheet
        order={acknowledgeOrder}
        onClose={() => setAcknowledgeOrder(undefined)}
      />
      <ShipmentTrackingSheet
        order={trackingOrder}
        onClose={() => setTrackingOrder(undefined)}
      />
      <OrderDetailsSheet
        order={detailOrder}
        products={products}
        storageAreas={storageAreas}
        showCommercial={!floorMode}
        onClose={() => setDetailOrder(undefined)}
      />
    </section>
  );
}

function OrderDetailsSheet({
  order,
  products,
  storageAreas,
  showCommercial,
  onClose,
}: {
  order?: FulfillmentOrder;
  products: Product[];
  storageAreas: StorageArea[];
  showCommercial: boolean;
  onClose: () => void;
}) {
  if (!order) return null;
  const address = order.deliveryAddress;
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
      title={`Order details / ${order.externalReference}`}
      description="Fulfillment record, controlled customer details, and shipment history."
    >
      <div className="space-y-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-line bg-inset p-4 text-sm">
          <div>
            <dt className="text-xs text-faint">Channel</dt>
            <dd className="mt-1 font-semibold text-ink">
              {order.ecommerceChannel ?? titleCase(order.source)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-faint">Order date</dt>
            <dd className="mt-1 font-semibold text-ink">
              {order.orderDate ?? "Not provided"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-faint">Payment</dt>
            <dd className="mt-1 font-semibold text-ink">
              {order.paymentStatus
                ? titleCase(order.paymentStatus)
                : "Not provided"}
              {order.paymentMethod ? ` / ${order.paymentMethod}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-faint">Current status</dt>
            <dd className="mt-1 font-semibold text-ink">
              {titleCase(order.status)}
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

        {order.source === "ecommerce" && showCommercial && (
          <section aria-labelledby="commercial-title">
            <h3
              id="commercial-title"
              className="font-display text-base font-bold text-ink"
            >
              Payment and commercial summary
            </h3>
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
          </section>
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

        <section aria-labelledby="order-lines-title">
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
                  {order.deliveryLink ? (
                    <a
                      className="text-brand-600 underline"
                      href={order.deliveryLink}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {order.deliveryLink}
                    </a>
                  ) : (
                    "Pending packing"
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
            <p className="mt-2 whitespace-pre-wrap rounded-xl border border-line bg-inset p-4 text-sm text-ink">
              {order.orderNotes}
            </p>
          </section>
        )}

        <section aria-labelledby="shipment-timeline-title">
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
                    <p className="mt-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                      Evidence attached
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
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
      className="btn-primary flex-1 sm:flex-none"
      disabled={busy}
      onClick={onClick}
    >
      {busy ? "Saving..." : children}
    </button>
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
  const { advanceFulfillmentOrder } = useWarehouse();
  const toast = useToast();
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [binCodes, setBinCodes] = useState<Record<string, string>>({});
  const [pickEvidence, setPickEvidence] = useState<Record<string, string[]>>(
    {},
  );
  const [validationError, setValidationError] = useState("");
  const [saving, setSaving] = useState(false);
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
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    for (const line of order.lines) {
      const product = products.find((row) => row.id === line.productId);
      const suggestion = recommendedBin(line.productId);
      if (suggestion && !binCodes[line.productId]?.trim()) {
        setValidationError(
          `Scan the source rack or bin for ${product?.name ?? line.productId} before scanning items.`,
        );
        return;
      }
      const capturedSerials = (serials[line.productId] ?? "")
        .split(/[\n,]/)
        .map((value) => value.trim())
        .filter(Boolean);
      if (product?.serialized && capturedSerials.length !== line.quantity) {
        setValidationError(
          `Scan exactly ${line.quantity} serial number(s) for ${product.name}. ${capturedSerials.length} captured.`,
        );
        return;
      }
    }
    setValidationError("");
    setSaving(true);
    const ok = await advanceFulfillmentOrder({
      orderId: order.id,
      action: "confirm_pick",
      pickedLines: order.lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        serialNumbers: (serials[line.productId] ?? "")
          .split(/[\n,]/)
          .map((value) => value.trim())
          .filter(Boolean),
        binId: storageAreas.find(
          (area) =>
            area.code.toLowerCase() ===
            (binCodes[line.productId] ?? "").trim().toLowerCase(),
        )?.id,
        evidenceUrl: pickEvidence[line.productId]?.[0],
      })),
    });
    setSaving(false);
    if (ok) {
      toast.success("Scanned pick confirmed. Move the order to packing.");
      onClose();
      setSerials({});
      setBinCodes({});
      setPickEvidence({});
    }
  };
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Confirm pick / ${order.externalReference}`}
      description="Scan the source bin and items, then attach line evidence before confirming the pick."
      footer={
        <button
          type="submit"
          form="pick-order-form"
          className="btn-primary w-full"
          disabled={saving}
        >
          {saving ? "Confirming..." : "Confirm pick"}
        </button>
      }
    >
      <form
        id="pick-order-form"
        className="space-y-4"
        onSubmit={(event) => void submit(event)}
      >
        {validationError && (
          <p
            role="alert"
            className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200"
          >
            {validationError}
          </p>
        )}
        <div className="border-l-4 border-emerald-500 bg-emerald-500/10 px-4 py-3 text-sm">
          <p className="font-semibold text-ink">Quality checkpoint</p>
          <p className="mt-1 text-muted">
            Only accepted, put-away stock is pickable. If packaging, seals, or a
            device condition looks wrong, stop the pick and route the item to
            Quality Control instead of substituting it informally.
          </p>
        </div>
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
                      onDetected={(code) =>
                        setBinCodes((current) => ({
                          ...current,
                          [line.productId]: code,
                        }))
                      }
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
                      onDetected={(code) =>
                        setSerials((current) => {
                          const existing = (current[line.productId] ?? "")
                            .split(/[\n,]/)
                            .map((value) => value.trim())
                            .filter(Boolean);
                          if (existing.includes(code)) return current;
                          return {
                            ...current,
                            [line.productId]: [...existing, code].join("\n"),
                          };
                        })
                      }
                    />
                  </div>
                  <textarea
                    aria-label={`Scanned serial numbers for ${product.name}`}
                    className="input mt-3 min-h-24 font-mono"
                    value={serials[line.productId] ?? ""}
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
              <div className="mt-3 border-t border-line pt-3">
                <EvidenceCapture
                  reference={`fulfillment/${order.id}/pick/${line.productId}`}
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
      </form>
    </Sheet>
  );
}

function PackSheet({
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
  const supplies = products.filter(
    (product) => product.itemClass === "fulfillment_supply",
  );
  const [courier, setCourier] = useState("");
  const [waybill, setWaybill] = useState("");
  const [deliveryLink, setDeliveryLink] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientDepartment, setRecipientDepartment] = useState("");
  const [handoverReference, setHandoverReference] = useState("");
  const [handoverEvidence, setHandoverEvidence] = useState<string[]>([]);
  const [packaging, setPackaging] = useState([
    { key: crypto.randomUUID(), productId: "", quantity: 1 },
  ]);
  const [saving, setSaving] = useState(false);
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
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const ok = await advanceFulfillmentOrder({
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
    });
    setSaving(false);
    if (ok) {
      toast.success(
        shipment
          ? "Packing confirmed. The shipment is ready for release."
          : "Handover prepared. A second operator must release it.",
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
          disabled={saving}
        >
          {saving ? "Saving..." : "Confirm packing"}
        </button>
      }
    >
      <form
        id="pack-order-form"
        className="space-y-4"
        onSubmit={(event) => void submit(event)}
      >
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
  if (!order) return null;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    const ok = await advanceFulfillmentOrder({
      orderId: order.id,
      action: "split_backorder",
      fulfilledLines: order.lines.map((line) => ({
        productId: line.productId,
        quantity: Number(form.get(`quantity-${line.productId}`)),
      })),
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
          disabled={saving}
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
            hint={`Original demand: ${line.quantity}`}
          >
            <input
              id={`backorder-${line.productId}`}
              name={`quantity-${line.productId}`}
              className="input"
              type="number"
              min="1"
              max={line.quantity}
              defaultValue={Math.max(1, line.quantity - 1)}
              required
            />
          </Field>
        ))}
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
  const { advanceFulfillmentOrder } = useWarehouse();
  const toast = useToast();
  const [reference, setReference] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [saving, setSaving] = useState(false);
  if (!order) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const ok = await advanceFulfillmentOrder({
      orderId: order.id,
      action: "acknowledge_receipt",
      acknowledgementReference: reference,
      acknowledgementEvidenceUrl: evidenceUrl,
    });
    setSaving(false);
    if (ok) {
      toast.success("Receipt acknowledged and the linked request closed.");
      onClose();
      setReference("");
      setEvidenceUrl("");
    }
  };
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Acknowledge receipt / ${order.externalReference}`}
      description="Confirm that the recipient or delivery destination accepted the released inventory."
      footer={
        <button
          type="submit"
          form="acknowledge-order-form"
          className="btn-primary w-full"
          disabled={saving}
        >
          {saving ? "Saving..." : "Confirm receipt"}
        </button>
      }
    >
      <form
        id="acknowledge-order-form"
        className="space-y-4"
        onSubmit={(event) => void submit(event)}
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
        <Field
          label="Acceptance evidence URL"
          htmlFor="ack-evidence"
          hint="Attach a signed handover, delivery proof, or recipient confirmation."
        >
          <input
            id="ack-evidence"
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
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  if (!order) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
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
            (action === "confirm_delivery" && evidenceUrls.length === 0)
          }
        >
          {saving ? "Saving..." : "Save delivery update"}
        </button>
      }
    >
      <form
        id="shipment-tracking-form"
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
  const { createDepartmentStockRequest, decideDepartmentStockRequest } =
    useWarehouse();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [workingId, setWorkingId] = useState<string>();
  const decide = async (id: string, decision: "approved" | "rejected") => {
    setWorkingId(id);
    const ok = await decideDepartmentStockRequest({ requestId: id, decision });
    setWorkingId(undefined);
    if (ok) toast.success(`Request ${decision}.`);
  };
  return (
    <section className="space-y-4" aria-labelledby="requests-title">
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
            owner: "Department approver",
            task: "Confirms budget and business need.",
          },
          {
            owner: "Warehouse operator",
            task: "Allocates, picks, and issues approved stock.",
          },
        ]}
      />
      {requests.length === 0 ? (
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
          {requests.map((request) => (
            <li key={request.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">{request.purpose}</p>
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
              {canApprove && request.status === "pending_approval" && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className="btn-outline"
                    disabled={workingId === request.id}
                    onClick={() => void decide(request.id, "rejected")}
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={workingId === request.id}
                    onClick={() => void decide(request.id, "approved")}
                  >
                    Approve
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
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
      toast.success("Stock request sent for approval.");
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
  } = useWarehouse();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<CustomerReturnCase>();
  const [closing, setClosing] = useState<CustomerReturnCase>();
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
            <li key={record.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">
                    {products.find((row) => row.id === record.productId)
                      ?.name ?? record.productId}
                  </p>
                  <p className="text-xs text-muted">
                    {record.serialNumber ?? "Non-serialized item"}
                  </p>
                </div>
                <StatusBadge status={record.status} />
              </div>
              <p className="mt-3 text-sm text-ink">
                {record.defectDescription}
              </p>
              <p className="mt-2 text-xs text-muted">
                Resolution: {titleCase(record.resolution)}
              </p>
              {resolutionMode !== "read_only" &&
                !["resolved", "closed"].includes(record.status) && (
                  <button
                    type="button"
                    className="btn-outline mt-4 w-full sm:w-auto"
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
                  className="btn-primary mt-4 w-full sm:w-auto"
                  onClick={() => setClosing(record)}
                >
                  Close with customer
                </button>
              )}
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
      toast.success("Return case sent to warehouse intake.");
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
              {titleCase(matchedOrder.status)})
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
                {order.externalReference} / {titleCase(order.status)}
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
  const [resolution, setResolution] = useState<
    Exclude<ReturnResolution, "pending">
  >(mode === "finance" ? "refund" : "replacement");
  const [binId, setBinId] = useState("");
  const [reference, setReference] = useState("");
  const [financeEvidenceUrl, setFinanceEvidenceUrl] = useState("");
  const [saving, setSaving] = useState(false);
  if (!record) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const ok = await resolve({
      returnCaseId: record.id,
      resolution,
      quarantineBinId: binId || undefined,
      refundReference: resolution === "refund" ? reference : undefined,
      replacementOrderId: undefined,
      supplierReference:
        resolution === "vendor_return" ? reference || undefined : undefined,
      financeEvidenceUrl: ["refund", "write_off"].includes(resolution)
        ? financeEvidenceUrl || undefined
        : undefined,
    });
    setSaving(false);
    if (ok) {
      toast.success("Return resolution recorded.");
      onClose();
    }
  };
  const needsBin = true;
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={
        mode === "finance" ? "Record finance refund" : "Resolve return case"
      }
      description="Quarantine the item first. Replacement creates a linked fulfillment order automatically."
      footer={
        <button
          type="submit"
          form="resolve-return-form"
          className="btn-primary w-full"
          disabled={saving}
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
          <Field label="Finance evidence URL" htmlFor="return-finance-evidence">
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
      toast.success("Customer closure recorded.");
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
      <CreateReKitSheet
        open={reKitOpen}
        onOpenChange={setReKitOpen}
        returnCases={eligibleReturns}
        definitions={activeKits}
        create={createReKitWorkOrder}
      />
      <CompleteReKitSheet
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
  if (!work) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
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
          disabled={saving}
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
        <Field label="Destination rack or bin" htmlFor="rekit-bin">
          <select
            id="rekit-bin"
            className="input"
            value={binId}
            onChange={(event) => setBinId(event.target.value)}
            required
          >
            <option value="">Select a scanned destination</option>
            {eligibleBins.map((bin) => (
              <option key={bin.id} value={bin.id}>
                {bin.code} / {bin.label ?? "Storage bin"}
              </option>
            ))}
          </select>
        </Field>
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
  const [returnId, setReturnId] = useState(returnCases[0]?.id ?? "");
  const [definitionId, setDefinitionId] = useState(definitions[0]?.id ?? "");
  const [outputSerial, setOutputSerial] = useState("");
  const [componentSerials, setComponentSerials] = useState("");
  const [condition, setCondition] = useState<"open_box" | "reconditioned">(
    "open_box",
  );
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const ok = await create({
      sourceReturnCaseId: returnId,
      kitDefinitionId: definitionId,
      outputSerialNumber: outputSerial,
      componentSerialNumbers: componentSerials
        .split(/[\n,]/)
        .map((value) => value.trim())
        .filter(Boolean),
      condition,
    });
    setSaving(false);
    if (ok) {
      toast.success("Re-kit work order created for inspection.");
      onOpenChange(false);
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Create re-kit work order"
      description="Reuse only inspected components and retain their serial lineage."
      footer={
        <button
          type="submit"
          form="rekit-form"
          className="btn-primary w-full"
          disabled={saving}
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
        <Field label="Source return case" htmlFor="rekit-return">
          <select
            id="rekit-return"
            className="input"
            value={returnId}
            onChange={(event) => setReturnId(event.target.value)}
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
            onChange={(event) => setDefinitionId(event.target.value)}
          >
            {definitions.map((definition) => (
              <option key={definition.id} value={definition.id}>
                {definition.name} v{definition.version}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Output serial number" htmlFor="rekit-output">
          <input
            id="rekit-output"
            className="input"
            value={outputSerial}
            onChange={(event) => setOutputSerial(event.target.value)}
            required
          />
        </Field>
        <Field
          label="Component serial numbers"
          htmlFor="rekit-components"
          hint="Enter one serial per line or separate with commas."
        >
          <textarea
            id="rekit-components"
            className="input min-h-24"
            value={componentSerials}
            onChange={(event) => setComponentSerials(event.target.value)}
            required
          />
        </Field>
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
      </form>
    </Sheet>
  );
}

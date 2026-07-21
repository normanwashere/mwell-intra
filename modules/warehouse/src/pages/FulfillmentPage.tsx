import { useState, type FormEvent } from "react";
import type {
  CustomerReturnCase,
  DepartmentStockRequest,
  FulfillmentAction,
  FulfillmentOrder,
  KitDefinition,
  Product,
  ReKitWorkOrder,
  ReturnResolution,
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
}: {
  orders: FulfillmentOrder[];
  requests: number;
  returns: CustomerReturnCase[];
  reKits: ReKitWorkOrder[];
}) {
  const stats = [
    {
      label: "Orders in progress",
      value: orders.filter(
        (row) => !["released", "cancelled"].includes(row.status),
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
        reKits.filter((row) => !["completed", "cancelled"].includes(row.status))
          .length,
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
  const { data, role, can } = warehouse;
  const [tab, setTab] = useState<WorkspaceTab>("orders");

  if (!data) return null;

  const canCreateOrder = can("request_fulfillment");
  const canRequestStock = can("request_stock");
  const canApproveRequest = [
    "warehouse_supervisor",
    "logistics_supervisor",
    "warehouse_admin",
  ].includes(role);
  const canExecute = can("issue_items");
  const canIntakeReturn = can("submit_return_case");
  const canDefineKits =
    [
      "warehouse_supervisor",
      "logistics_supervisor",
      "warehouse_admin",
    ].includes(role) && can("manage_products");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fulfillment"
        subtitle="One controlled queue from demand through warehouse release"
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
      />

      <div
        className="grid grid-cols-2 gap-1 rounded-xl bg-inset p-1 sm:grid-cols-4"
        role="tablist"
        aria-label="Fulfillment workspace"
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-label={item.label}
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
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

      {tab === "orders" && (
        <OrdersWorkspace
          products={data.products}
          locations={data.locations}
          events={data.events}
          orders={data.fulfillmentOrders}
          canCreate={canCreateOrder}
          canExecute={canExecute}
        />
      )}
      {tab === "requests" && (
        <RequestsWorkspace
          products={data.products}
          requests={data.departmentStockRequests}
          canCreate={canRequestStock}
          canApprove={canApproveRequest}
          department={role === "business_unit" ? "business_unit" : role}
        />
      )}
      {tab === "returns" && (
        <ReturnsWorkspace
          products={data.products}
          returns={data.customerReturnCases}
          bins={data.storageAreas.filter((area) => area.active)}
          canCreate={canIntakeReturn}
          resolutionMode={
            can("manage_returns")
              ? "warehouse"
              : can("approve_stock_adjustment_finance")
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
          canReKit={can("manage_returns")}
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
}: {
  products: Product[];
  locations: Array<{ id: string; name: string; type?: string }>;
  events: Array<{ id: string; name: string }>;
  orders: FulfillmentOrder[];
  canCreate: boolean;
  canExecute: boolean;
}) {
  const { createFulfillmentOrder, advanceFulfillmentOrder } = useWarehouse();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [workingId, setWorkingId] = useState<string>();
  const [pickOrder, setPickOrder] = useState<FulfillmentOrder>();
  const [packOrder, setPackOrder] = useState<FulfillmentOrder>();

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
        {canCreate && (
          <button
            type="button"
            className="btn-primary w-full sm:w-auto"
            onClick={() => setCreateOpen(true)}
          >
            <Icon name="plus" className="h-4 w-4" /> New fulfillment demand
          </button>
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

      {orders.length === 0 ? (
        <EmptyState
          icon="cart"
          title="No fulfillment demand"
          message="Confirmed ecommerce, event, and approved department demand will appear here for Warehouse execution."
        />
      ) : (
        <ul
          className="grid gap-3 lg:grid-cols-2"
          aria-label="Fulfillment demand"
        >
          {orders.map((order) => (
            <li
              key={order.id}
              aria-label={`Order ${order.externalReference}`}
              className="card min-w-0 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">
                    {order.externalReference}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {titleCase(order.source)} ·{" "}
                    {order.lines.reduce((sum, line) => sum + line.quantity, 0)}{" "}
                    item(s)
                  </p>
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
                <StatusBadge status={order.status} />
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
                  <span className="block text-faint">Courier / waybill</span>
                  <span className="font-medium text-ink">
                    {order.courier
                      ? `${order.courier} · ${order.waybillNumber}`
                      : "Pending packing"}
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
              {canExecute &&
                !["released", "cancelled"].includes(order.status) && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {order.status === "received" && (
                      <ActionButton
                        busy={workingId === order.id}
                        onClick={() => void advance(order, "allocate")}
                      >
                        Allocate stock
                      </ActionButton>
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
                        Pack and add waybill
                      </ActionButton>
                    )}
                    {order.status === "ready" && (
                      <ActionButton
                        busy={workingId === order.id}
                        onClick={() => void advance(order, "release")}
                      >
                        Release to courier
                      </ActionButton>
                    )}
                  </div>
                )}
            </li>
          ))}
        </ul>
      )}

      <CreateOrderSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        products={products}
        locations={locations}
        events={events}
        create={createFulfillmentOrder}
      />
      <PickSheet
        order={pickOrder}
        products={products}
        onClose={() => setPickOrder(undefined)}
      />
      <PackSheet
        order={packOrder}
        products={products}
        onClose={() => setPackOrder(undefined)}
      />
    </section>
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

function CreateOrderSheet({
  open,
  onOpenChange,
  products,
  locations,
  events,
  create,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  locations: Array<{ id: string; name: string; type?: string }>;
  events: Array<{ id: string; name: string }>;
  create: ReturnType<typeof useWarehouse>["createFulfillmentOrder"];
}) {
  const toast = useToast();
  const [reference, setReference] = useState("");
  const [source, setSource] = useState<"ecommerce" | "event" | "third_party">(
    "ecommerce",
  );
  const [customer, setCustomer] = useState("");
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [locationId, setLocationId] = useState(
    locations.find((row) => row.id)?.id ?? "",
  );
  const [bundleCodes, setBundleCodes] = useState("");
  const [eventId, setEventId] = useState("");
  const [thirdPartyLocationId, setThirdPartyLocationId] = useState("");
  const [grossSalesAmount, setGrossSalesAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const eligibleProducts = products.filter((product) =>
    isFulfillmentProduct(product, source),
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const ok = await create({
      source,
      externalReference: reference,
      customerReference: customer || undefined,
      requestingDepartment:
        source === "event" ? "operations_events" : "sales_ecommerce",
      eventId: source === "ecommerce" ? undefined : eventId,
      thirdPartyLocationId:
        source === "third_party" ? thirdPartyLocationId : undefined,
      grossSalesAmount:
        source === "third_party" ? Number(grossSalesAmount) : undefined,
      sourceLocationId: locationId || undefined,
      lines: [
        {
          productId,
          quantity,
          bundleSetCodes: bundleCodes
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        },
      ],
    });
    setSaving(false);
    if (ok) {
      toast.success("Demand added to the fulfillment queue.");
      onOpenChange(false);
      setReference("");
      setCustomer("");
      setBundleCodes("");
      setEventId("");
      setThirdPartyLocationId("");
      setGrossSalesAmount("");
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Create fulfillment demand"
      description="Record the source and ownership before demand becomes Warehouse work."
      footer={
        <button
          type="submit"
          form="create-order-form"
          className="btn-primary w-full"
          disabled={saving}
        >
          {saving ? "Creating..." : "Create demand"}
        </button>
      }
    >
      <form
        id="create-order-form"
        className="space-y-4"
        onSubmit={(event) => void submit(event)}
      >
        <Field label="Demand source" htmlFor="order-source">
          <select
            id="order-source"
            className="input"
            value={source}
            onChange={(event) => {
              const nextSource = event.target.value as typeof source;
              setSource(nextSource);
              setProductId(
                products.find((product) =>
                  isFulfillmentProduct(product, nextSource),
                )?.id ?? "",
              );
              setEventId("");
              setThirdPartyLocationId("");
              setGrossSalesAmount("");
            }}
          >
            <option value="ecommerce">Ecommerce order</option>
            <option value="event">Internal event fulfillment</option>
            <option value="third_party">Third-party event sale</option>
          </select>
        </Field>
        <Field label="Order reference" htmlFor="order-reference">
          <input
            id="order-reference"
            className="input"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            required
          />
        </Field>
        <Field label="Customer reference" htmlFor="customer-reference">
          <input
            id="customer-reference"
            className="input"
            value={customer}
            onChange={(event) => setCustomer(event.target.value)}
          />
        </Field>
        {source !== "ecommerce" && (
          <Field label="Event" htmlFor="order-event">
            <select
              id="order-event"
              className="input"
              value={eventId}
              onChange={(event) => setEventId(event.target.value)}
              required
            >
              <option value="">Select an event</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {source === "third_party" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Third-party inventory location"
              htmlFor="third-party-location"
            >
              <select
                id="third-party-location"
                className="input"
                value={thirdPartyLocationId}
                onChange={(event) =>
                  setThirdPartyLocationId(event.target.value)
                }
                required
              >
                <option value="">Select external location</option>
                {locations
                  .filter((location) => location.type !== "warehouse")
                  .map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Gross sales (PHP)" htmlFor="gross-sales">
              <input
                id="gross-sales"
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={grossSalesAmount}
                onChange={(event) => setGrossSalesAmount(event.target.value)}
                required
              />
            </Field>
          </div>
        )}
        <Field label="Source warehouse" htmlFor="order-location">
          <select
            id="order-location"
            className="input"
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
          >
            <option value="">Assign on allocation</option>
            {locations
              .filter((row) => row.type === "warehouse")
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
          <Field label="Product" htmlFor="order-product">
            <select
              id="order-product"
              className="input"
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              required
            >
              {eligibleProducts.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantity" htmlFor="order-quantity">
            <input
              id="order-quantity"
              className="input"
              type="number"
              min="1"
              value={quantity}
              onChange={(event) => setQuantity(Number(event.target.value))}
              required
            />
          </Field>
        </div>
        <Field
          label="Bundle set codes"
          htmlFor="bundle-codes"
          hint="Optional. Separate customer-facing sets with commas, for example OTG1, OTG2."
        >
          <input
            id="bundle-codes"
            className="input"
            value={bundleCodes}
            onChange={(event) => setBundleCodes(event.target.value)}
          />
        </Field>
      </form>
    </Sheet>
  );
}

function PickSheet({
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
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  if (!order) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
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
      })),
    });
    setSaving(false);
    if (ok) {
      toast.success("Scanned pick confirmed. Move the order to packing.");
      onClose();
      setSerials({});
    }
  };
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Confirm pick · ${order.externalReference}`}
      description="Confirm the full quantity and one serial per serialized unit."
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
        {order.lines.map((line) => {
          const product = products.find((row) => row.id === line.productId);
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
              {product?.serialized && (
                <Field
                  label="Scanned serial numbers"
                  htmlFor={`pick-${line.productId}`}
                  hint="Enter one per line or separate with commas."
                >
                  <textarea
                    id={`pick-${line.productId}`}
                    className="input mt-3 min-h-24"
                    value={serials[line.productId] ?? ""}
                    onChange={(event) =>
                      setSerials((current) => ({
                        ...current,
                        [line.productId]: event.target.value,
                      }))
                    }
                    required
                  />
                </Field>
              )}
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
  const [supplyId, setSupplyId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [saving, setSaving] = useState(false);
  if (!order) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const ok = await advanceFulfillmentOrder({
      orderId: order.id,
      action: "confirm_pack",
      courier,
      waybillNumber: waybill,
      packaging: supplyId ? [{ productId: supplyId, quantity }] : [],
    });
    setSaving(false);
    if (ok) {
      toast.success("Packing confirmed. The order is ready for release.");
      onClose();
    }
  };
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Pack order · ${order.externalReference}`}
      description="Record the courier, waybill, and fulfillment supplies consumed."
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
        {supplies.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
            <Field label="Packaging supply" htmlFor="pack-supply">
              <select
                id="pack-supply"
                className="input"
                value={supplyId}
                onChange={(event) => setSupplyId(event.target.value)}
              >
                <option value="">No tracked supply</option>
                {supplies.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Quantity" htmlFor="pack-supply-quantity">
              <input
                id="pack-supply-quantity"
                className="input"
                type="number"
                min="1"
                value={quantity}
                onChange={(event) => setQuantity(Number(event.target.value))}
              />
            </Field>
          </div>
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

function RequestsWorkspace({
  products,
  requests,
  canCreate,
  canApprove,
  department,
}: {
  products: Product[];
  requests: DepartmentStockRequest[];
  canCreate: boolean;
  canApprove: boolean;
  department: string;
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
  create,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  department: string;
  create: ReturnType<typeof useWarehouse>["createDepartmentStockRequest"];
}) {
  const toast = useToast();
  const [purpose, setPurpose] = useState("");
  const [costCenter, setCostCenter] = useState("");
  const [requiredDate, setRequiredDate] = useState("");
  const [treatment, setTreatment] = useState<"expense" | "custody" | "sale">(
    "expense",
  );
  const eligibleProducts = products.filter((product) => {
    const itemClass =
      product.itemClass ??
      (product.category === "device" ? "sellable_sku" : "merchandise");
    return itemClass === "sellable_sku" || itemClass === "merchandise";
  });
  const [productId, setProductId] = useState(eligibleProducts[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [saving, setSaving] = useState(false);
  const selectedProduct = eligibleProducts.find((row) => row.id === productId);
  const selectedItemClass =
    selectedProduct?.itemClass ??
    (selectedProduct?.category === "device" ? "sellable_sku" : "merchandise");
  const merchandiseSelected = selectedItemClass === "merchandise";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const ok = await create({
      requestingDepartment: department,
      purpose,
      costCenter,
      requiredDate,
      expenseTreatment: treatment,
      lines: [{ productId, quantity }],
    });
    setSaving(false);
    if (ok) {
      toast.success("Stock request sent for approval.");
      onOpenChange(false);
      setPurpose("");
      setCostCenter("");
      setRequiredDate("");
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
          disabled={saving}
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
          <input
            id="request-department"
            className="input"
            value={titleCase(department)}
            readOnly
          />
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
            <input
              id="request-cost-center"
              className="input"
              value={costCenter}
              onChange={(event) => setCostCenter(event.target.value)}
              required
            />
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
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
          <Field label="Product" htmlFor="request-product">
            <select
              id="request-product"
              className="input"
              value={productId}
              onChange={(event) => {
                const nextId = event.target.value;
                const next = eligibleProducts.find((row) => row.id === nextId);
                const nextClass =
                  next?.itemClass ??
                  (next?.category === "device"
                    ? "sellable_sku"
                    : "merchandise");
                setProductId(nextId);
                if (nextClass === "merchandise") setTreatment("expense");
              }}
            >
              {eligibleProducts.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantity" htmlFor="request-quantity">
            <input
              id="request-quantity"
              className="input"
              type="number"
              min="1"
              value={quantity}
              onChange={(event) => setQuantity(Number(event.target.value))}
            />
          </Field>
        </div>
      </form>
    </Sheet>
  );
}

function ReturnsWorkspace({
  products,
  returns,
  bins,
  canCreate,
  resolutionMode,
}: {
  products: Product[];
  returns: CustomerReturnCase[];
  bins: Array<{ id: string; code: string; label?: string }>;
  canCreate: boolean;
  resolutionMode: "warehouse" | "finance" | "read_only";
}) {
  const { createCustomerReturnCase, resolveCustomerReturnCase } =
    useWarehouse();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<CustomerReturnCase>();
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
                record.status !== "resolved" && (
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
            </li>
          ))}
        </ul>
      )}
      <CreateReturnSheet
        open={open}
        onOpenChange={setOpen}
        products={products}
        create={createCustomerReturnCase}
      />
      <ResolveReturnSheet
        record={selected}
        bins={bins}
        resolve={resolveCustomerReturnCase}
        mode={resolutionMode === "finance" ? "finance" : "warehouse"}
        onClose={() => setSelected(undefined)}
      />
    </section>
  );
}

function CreateReturnSheet({
  open,
  onOpenChange,
  products,
  create,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  create: ReturnType<typeof useWarehouse>["createCustomerReturnCase"];
}) {
  const toast = useToast();
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [serial, setSerial] = useState("");
  const [sourceOrder, setSourceOrder] = useState("");
  const [defect, setDefect] = useState("");
  const [saving, setSaving] = useState(false);
  const selected = products.find((row) => row.id === productId);
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
            onChange={(event) => setProductId(event.target.value)}
          >
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Serial number"
          htmlFor="return-serial"
          hint={
            selected?.serialized
              ? "Required for this serialized product."
              : "Optional for non-serialized stock."
          }
        >
          <input
            id="return-serial"
            className="input"
            value={serial}
            onChange={(event) => setSerial(event.target.value)}
            required={selected?.serialized}
          />
        </Field>
        <Field label="Original order reference" htmlFor="return-order">
          <input
            id="return-order"
            className="input"
            value={sourceOrder}
            onChange={(event) => setSourceOrder(event.target.value)}
          />
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
      replacementOrderId:
        resolution === "replacement" ? reference || undefined : undefined,
      supplierReference:
        resolution === "vendor_return" ? reference || undefined : undefined,
    });
    setSaving(false);
    if (ok) {
      toast.success("Return resolution recorded.");
      onClose();
    }
  };
  const needsBin = ["replacement", "refund", "re_kit"].includes(resolution);
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={
        mode === "finance" ? "Record finance refund" : "Resolve return case"
      }
      description="Record the physical and downstream outcome before closing the case."
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
                  {bin.code} · {bin.label ?? "Controlled storage"}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field
          label={
            mode === "finance"
              ? "Finance refund reference"
              : "Downstream reference"
          }
          htmlFor="return-reference"
          hint="Refund, replacement order, or supplier reference as applicable."
        >
          <input
            id="return-reference"
            className="input"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            required={resolution === "refund"}
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
                {bin.code} · {bin.label ?? "Storage bin"}
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

import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Product } from "@intra/data-kit";
import { useWarehouse } from "@/app/store";
import { Icon } from "@/components/Icon";
import { Field, Sheet, useToast } from "@/components/ui";
import {
  ECOMMERCE_CHANNELS,
  MAYA_REPORT_STATUSES,
  PAYMENT_METHODS,
  PH_CITY_PRESETS,
  cityPreset,
  paymentStatusFor,
} from "@/domain/orderIntakeOptions";

type Source = "ecommerce" | "event" | "third_party";

interface OrderLineDraft {
  key: string;
  productId: string;
  quantity: number;
  variant: string;
  unitPrice: string;
  discountAmount: string;
  bundleMode: boolean;
  bundleCodes: string;
}

function itemClass(product: Product) {
  return (
    product.itemClass ??
    (product.category === "device" ? "sellable_sku" : "merchandise")
  );
}

function eligible(product: Product, source: Source) {
  const value = itemClass(product);
  return source === "ecommerce"
    ? value === "sellable_sku" || value === "re_kitted_item"
    : [
        "sellable_sku",
        "re_kitted_item",
        "merchandise",
        "event_material",
      ].includes(value);
}

function newLine(products: Product[], source: Source): OrderLineDraft {
  const product = products.find((candidate) => eligible(candidate, source));
  return {
    key: crypto.randomUUID(),
    productId: product?.id ?? "",
    quantity: 1,
    variant: "",
    unitPrice: product?.price === undefined ? "" : String(product.price),
    discountAmount: "",
    bundleMode: false,
    bundleCodes: "",
  };
}

function generatedBundleCodes(reference: string, quantity: number) {
  const prefix =
    reference
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 18) || "ORDER";
  return Array.from(
    { length: Math.max(1, quantity) },
    (_, index) => `${prefix}-SET-${String(index + 1).padStart(2, "0")}`,
  ).join(", ");
}

function optionalMoney(value: string) {
  return value === "" ? undefined : Number(value);
}

function money(value: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    currencyDisplay: "code",
  }).format(value);
}

export function OrderIntakeSheet({
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
  const { can } = useWarehouse();
  const [source, setSource] = useState<Source>("ecommerce");
  const [reference, setReference] = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [channel, setChannel] = useState("");
  const [customerReference, setCustomerReference] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerContact, setCustomerContact] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [deliveryArea, setDeliveryArea] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentProviderStatus, setPaymentProviderStatus] = useState("paid");
  const [campaignName, setCampaignName] = useState("");
  const [salesInvoiceNumber, setSalesInvoiceNumber] = useState("");
  const [shippingFee, setShippingFee] = useState("");
  const [otherFees, setOtherFees] = useState("");
  const [reportedTotal, setReportedTotal] = useState("");
  const [courier, setCourier] = useState("");
  const [deliveryLink, setDeliveryLink] = useState("");
  const [waybillNumber, setWaybillNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [locationId, setLocationId] = useState(
    locations.find((location) => location.type === "warehouse")?.id ?? "",
  );
  const [eventId, setEventId] = useState("");
  const [thirdPartyLocationId, setThirdPartyLocationId] = useState("");
  const [grossSalesAmount, setGrossSalesAmount] = useState("");
  const [lines, setLines] = useState<OrderLineDraft[]>([
    newLine(products, "ecommerce"),
  ]);
  const [saving, setSaving] = useState(false);
  const ecommerce = source === "ecommerce";
  const paymentStatus = paymentStatusFor(paymentMethod, paymentProviderStatus);
  const availableProducts = products.filter((product) =>
    eligible(product, source),
  );
  const externalLocations = useMemo(
    () => locations.filter((location) => location.type !== "warehouse"),
    [locations],
  );
  const thirdPartyLocationMissing =
    source === "third_party" && externalLocations.length === 0;
  const canManageLocations = can("manage_locations");
  const totals = useMemo(() => {
    const subtotal = lines.reduce(
      (sum, line) => sum + Number(line.unitPrice || 0) * line.quantity,
      0,
    );
    const discount = lines.reduce(
      (sum, line) => sum + Number(line.discountAmount || 0),
      0,
    );
    const total =
      subtotal - discount + Number(shippingFee || 0) + Number(otherFees || 0);
    const netOfVat = total / 1.12;
    return { subtotal, discount, total, netOfVat, vat: total - netOfVat };
  }, [lines, otherFees, shippingFee]);

  const reset = () => {
    setReference("");
    setOrderDate("");
    setChannel("");
    setCustomerReference("");
    setCustomerName("");
    setCustomerContact("");
    setCustomerEmail("");
    setDeliveryArea("");
    setAddressLine("");
    setCity("");
    setProvince("");
    setPostalCode("");
    setPaymentMethod("cash");
    setPaymentReference("");
    setPaymentDate("");
    setPaymentProviderStatus("paid");
    setCampaignName("");
    setSalesInvoiceNumber("");
    setShippingFee("");
    setOtherFees("");
    setReportedTotal("");
    setCourier("");
    setDeliveryLink("");
    setWaybillNumber("");
    setNotes("");
    setEventId("");
    setThirdPartyLocationId("");
    setGrossSalesAmount("");
    setLines([newLine(products, source)]);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (thirdPartyLocationMissing) {
      toast.error(
        "Create demand is disabled because no external custody location exists.",
      );
      return;
    }
    if (ecommerce && paymentStatus === "blocked") {
      toast.error(
        "This online payment is not cleared in the Maya report. Keep it out of Warehouse allocation until it is paid or authorized.",
      );
      return;
    }
    const acceptedPaymentStatus =
      paymentStatus === "blocked" ? undefined : paymentStatus;
    setSaving(true);
    const ok = await create({
      source,
      externalReference: reference.trim(),
      orderDate: ecommerce ? orderDate || undefined : undefined,
      ecommerceChannel: ecommerce ? channel.trim() : undefined,
      customerReference: customerReference.trim() || undefined,
      customerName: ecommerce ? customerName.trim() : undefined,
      customerContact: ecommerce ? customerContact.trim() : undefined,
      customerEmail: ecommerce ? customerEmail.trim() || undefined : undefined,
      deliveryArea: ecommerce ? deliveryArea.trim() || undefined : undefined,
      deliveryAddress: ecommerce
        ? { addressLine, city, province, postalCode }
        : undefined,
      paymentStatus: ecommerce ? acceptedPaymentStatus : undefined,
      paymentMethod: ecommerce ? paymentMethod.trim() || undefined : undefined,
      paymentReference: ecommerce
        ? paymentReference.trim() || undefined
        : undefined,
      paymentDate: ecommerce ? paymentDate || undefined : undefined,
      paymentProviderStatus:
        ecommerce && paymentMethod === "online_payment"
          ? paymentProviderStatus.trim() || undefined
          : undefined,
      campaignName: ecommerce ? campaignName.trim() || undefined : undefined,
      salesInvoiceNumber: ecommerce
        ? salesInvoiceNumber.trim() || undefined
        : undefined,
      shippingFee: ecommerce ? optionalMoney(shippingFee) : undefined,
      otherFees: ecommerce ? optionalMoney(otherFees) : undefined,
      reportedTotalAmount: ecommerce ? optionalMoney(reportedTotal) : undefined,
      courier: ecommerce ? courier.trim() || undefined : undefined,
      deliveryLink: ecommerce ? deliveryLink.trim() || undefined : undefined,
      waybillNumber: ecommerce ? waybillNumber.trim() || undefined : undefined,
      orderNotes: notes.trim() || undefined,
      requestingDepartment: ecommerce ? "sales_ecommerce" : "operations_events",
      eventId: ecommerce ? undefined : eventId,
      thirdPartyLocationId:
        source === "third_party" ? thirdPartyLocationId : undefined,
      grossSalesAmount:
        source === "third_party" ? Number(grossSalesAmount) : undefined,
      sourceLocationId: locationId || undefined,
      lines: lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        variant: line.variant.trim() || undefined,
        unitPrice: ecommerce ? optionalMoney(line.unitPrice) : undefined,
        discountAmount: ecommerce
          ? optionalMoney(line.discountAmount)
          : undefined,
        bundleSetCodes: line.bundleMode
          ? line.bundleCodes
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean)
          : [],
      })),
    });
    setSaving(false);
    if (ok) {
      toast.success(
        ecommerce
          ? "Order added. The app now owns its fulfillment record."
          : "Demand added to the fulfillment queue.",
      );
      reset();
      onOpenChange(false);
    }
  };

  const sectionClass =
    "space-y-4 border-t border-line pt-5 first:border-0 first:pt-0";
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Create order or fulfillment demand"
      description={
        ecommerce
          ? "Capture the complete commercial and delivery record once. Warehouse, Finance, and customer support use this same order."
          : "Record the source and ownership before demand becomes Warehouse work."
      }
      footer={
        <div className="w-full space-y-2 md:flex md:items-center md:justify-between md:gap-4 md:space-y-0">
          {thirdPartyLocationMissing && (
            <p
              id="third-party-location-submit-reason"
              className="text-xs font-semibold leading-5 text-amber-700 dark:text-amber-300"
            >
              Create demand is disabled because no external custody location
              exists.
            </p>
          )}
          <button
            type="submit"
            form="order-intake-form"
            className="btn-primary w-full md:ml-auto md:w-auto md:min-w-36 md:shrink-0"
            disabled={saving || thirdPartyLocationMissing}
            aria-describedby={
              thirdPartyLocationMissing
                ? "third-party-location-submit-reason"
                : undefined
            }
          >
            {saving
              ? "Creating..."
              : ecommerce
                ? "Create order"
                : "Create demand"}
          </button>
        </div>
      }
    >
      <form
        id="order-intake-form"
        className="space-y-6"
        onSubmit={(event) => void submit(event)}
      >
        <section
          className={sectionClass}
          aria-labelledby="intake-order-heading"
        >
          <div>
            <h3
              id="intake-order-heading"
              className="font-display text-base font-bold text-ink"
            >
              Order
            </h3>
            <p className="text-xs text-muted">
              The source reference must remain unique across all channels.
            </p>
          </div>
          <Field label="Demand source" htmlFor="order-source">
            <select
              id="order-source"
              className="input"
              value={source}
              onChange={(event) => {
                const next = event.target.value as Source;
                setSource(next);
                setLines([newLine(products, next)]);
              }}
            >
              <option value="ecommerce">Ecommerce customer order</option>
              <option value="event">Approved internal event fulfillment</option>
              <option value="third_party">Third-party event sale</option>
            </select>
          </Field>
          {!ecommerce && (
            <div className="rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900 dark:border-brand-800 dark:bg-brand-950/30 dark:text-brand-100">
              <p className="font-semibold">
                This is event demand, not a department stock request.
              </p>
              <p className="mt-1 text-xs leading-5 opacity-80">
                For routine department supplies or merchandise, close this form
                and use the Department requests tab. That path generates the
                request reference, records the requestor department, and routes
                approval before Warehouse work begins.
              </p>
            </div>
          )}
          {source === "third_party" && (
            <section
              aria-labelledby="third-party-ownership-heading"
              className="rounded-lg border border-line bg-inset p-4"
            >
              <h4
                id="third-party-ownership-heading"
                className="text-sm font-bold text-ink"
              >
                Third-party event ownership
              </h4>
              <ul className="mt-2 grid gap-2 text-xs leading-5 text-muted sm:grid-cols-2">
                <li>Marketing owns and approves the event.</li>
                <li>
                  A Warehouse or Operations administrator controls external
                  custody locations.
                </li>
                <li>Operations records the sale and gross sales here.</li>
                <li>Finance closes settlement after the sale is recorded.</li>
              </ul>
            </section>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Order reference" htmlFor="order-reference">
              <input
                id="order-reference"
                className="input"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                required
              />
            </Field>
            {ecommerce && (
              <Field label="Order date" htmlFor="order-date">
                <input
                  id="order-date"
                  className="input"
                  type="date"
                  value={orderDate}
                  onChange={(event) => setOrderDate(event.target.value)}
                />
              </Field>
            )}
            {ecommerce && (
              <Field label="Sales channel" htmlFor="order-channel">
                <select
                  id="order-channel"
                  className="input"
                  value={channel}
                  onChange={(event) => setChannel(event.target.value)}
                  required
                >
                  <option value="">Select sales channel</option>
                  {ECOMMERCE_CHANNELS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {ecommerce && (
              <Field label="Campaign / event name" htmlFor="campaign-name">
                <input
                  id="campaign-name"
                  className="input"
                  value={campaignName}
                  onChange={(event) => setCampaignName(event.target.value)}
                />
              </Field>
            )}
            <Field
              label="Customer / requester reference"
              htmlFor="customer-reference"
            >
              <input
                id="customer-reference"
                className="input"
                value={customerReference}
                onChange={(event) => setCustomerReference(event.target.value)}
              />
            </Field>
          </div>
          {!ecommerce && (
            <Field label="Event" htmlFor="order-event">
              <select
                id="order-event"
                className="input"
                value={eventId}
                onChange={(event) => setEventId(event.target.value)}
                required
              >
                <option value="">Select an event</option>
                {events.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {source === "third_party" && (
            <>
              {thirdPartyLocationMissing ? (
                <section
                  aria-labelledby="external-location-empty-heading"
                  className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100"
                >
                  <div className="flex items-start gap-3">
                    <Icon
                      name="building"
                      className="mt-0.5 h-5 w-5 shrink-0"
                    />
                    <div className="min-w-0">
                      <h4
                        id="external-location-empty-heading"
                        className="text-sm font-bold"
                      >
                        No external custody location exists
                      </h4>
                      <p className="mt-1 text-xs leading-5">
                        {canManageLocations
                          ? "Add the event site as an external custody location before Operations records the sale."
                          : "Operations cannot create external custody locations. Ask a Warehouse or Operations administrator to add the event site; Marketing owns the event and coordinates the setup request."}
                      </p>
                      {canManageLocations ? (
                        <Link
                          to="/locations"
                          className="btn-outline mt-3 w-full justify-center bg-surface sm:w-auto"
                        >
                          <Icon name="building" className="h-4 w-4" /> Open
                          location management
                        </Link>
                      ) : (
                        <Link
                          to="/events"
                          className="btn-outline mt-3 w-full justify-center bg-surface sm:w-auto"
                        >
                          <Icon name="calendar" className="h-4 w-4" /> Open
                          Events to escalate setup
                        </Link>
                      )}
                    </div>
                  </div>
                </section>
              ) : (
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
                      {externalLocations.map((location) => (
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
                      onChange={(event) =>
                        setGrossSalesAmount(event.target.value)
                      }
                      required
                    />
                  </Field>
                </div>
              )}
            </>
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
                .filter((location) => location.type === "warehouse")
                .map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
            </select>
          </Field>
        </section>

        {ecommerce && (
          <section
            className={sectionClass}
            aria-labelledby="intake-customer-heading"
          >
            <div>
              <h3
                id="intake-customer-heading"
                className="font-display text-base font-bold text-ink"
              >
                Customer and delivery address
              </h3>
              <p className="text-xs text-muted">
                Only fulfillment-relevant customer data is collected.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Customer name" htmlFor="customer-name">
                <input
                  id="customer-name"
                  className="input"
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  required
                />
              </Field>
              <Field label="Contact number" htmlFor="customer-contact">
                <input
                  id="customer-contact"
                  className="input"
                  value={customerContact}
                  onChange={(event) => setCustomerContact(event.target.value)}
                  required
                />
              </Field>
              <Field label="Email" htmlFor="customer-email">
                <input
                  id="customer-email"
                  className="input"
                  type="email"
                  value={customerEmail}
                  onChange={(event) => setCustomerEmail(event.target.value)}
                />
              </Field>
            </div>
            <Field label="Street address" htmlFor="delivery-address">
              <input
                id="delivery-address"
                className="input"
                value={addressLine}
                onChange={(event) => setAddressLine(event.target.value)}
                required
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="City" htmlFor="delivery-city">
                <input
                  id="delivery-city"
                  className="input"
                  list="delivery-city-options"
                  value={city}
                  onChange={(event) => {
                    const value = event.target.value;
                    setCity(value);
                    const preset = cityPreset(value);
                    if (!preset) return;
                    setProvince(preset.province);
                    setPostalCode(preset.postalCode);
                    setDeliveryArea(preset.area);
                  }}
                  required
                />
                <datalist id="delivery-city-options">
                  {PH_CITY_PRESETS.map((preset) => (
                    <option key={preset.city} value={preset.city} />
                  ))}
                </datalist>
              </Field>
              <Field
                label="Province"
                htmlFor="delivery-province"
                hint="Suggested from the selected city; edit when the exact address differs."
              >
                <input
                  id="delivery-province"
                  className="input"
                  value={province}
                  onChange={(event) => setProvince(event.target.value)}
                  required
                />
              </Field>
              <Field
                label="Postal code"
                htmlFor="delivery-postal"
                hint="City-level suggestion. Confirm the exact barangay or district code."
              >
                <input
                  id="delivery-postal"
                  className="input"
                  value={postalCode}
                  onChange={(event) => setPostalCode(event.target.value)}
                  required
                />
              </Field>
            </div>
            <Field label="Area of delivery" htmlFor="delivery-area">
              <input
                id="delivery-area"
                className="input"
                placeholder="Metro Manila, provincial, service zone..."
                value={deliveryArea}
                onChange={(event) => setDeliveryArea(event.target.value)}
              />
            </Field>
          </section>
        )}

        <section
          className={sectionClass}
          aria-labelledby="intake-lines-heading"
        >
          <div className="flex items-end justify-between gap-3">
            <div>
              <h3
                id="intake-lines-heading"
                className="font-display text-base font-bold text-ink"
              >
                Items
              </h3>
              <p className="text-xs text-muted">
                One row per product or variant. Bundle codes keep serialized
                components together.
              </p>
            </div>
            <button
              type="button"
              className="btn-outline shrink-0"
              onClick={() =>
                setLines((current) => [...current, newLine(products, source)])
              }
            >
              <Icon name="plus" className="h-4 w-4" /> Add item
            </button>
          </div>
          {lines.map((line, index) => (
            <div
              key={line.key}
              className="space-y-3 rounded-xl border border-line bg-inset p-4"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-ink">
                  Item {index + 1}
                </p>
                {lines.length > 1 && (
                  <button
                    type="button"
                    className="btn-ghost min-h-11 px-3 text-rose-600"
                    aria-label={`Remove item ${index + 1}`}
                    onClick={() =>
                      setLines((current) =>
                        current.filter(
                          (candidate) => candidate.key !== line.key,
                        ),
                      )
                    }
                  >
                    <Icon name="x" className="h-4 w-4" /> Remove
                  </button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                <Field label="Product" htmlFor={`order-product-${line.key}`}>
                  <select
                    id={`order-product-${line.key}`}
                    className="input"
                    value={line.productId}
                    onChange={(event) => {
                      const product = products.find(
                        (candidate) => candidate.id === event.target.value,
                      );
                      setLines((current) =>
                        current.map((candidate) =>
                          candidate.key === line.key
                            ? {
                                ...candidate,
                                productId: event.target.value,
                                unitPrice:
                                  product?.price === undefined
                                    ? ""
                                    : String(product.price),
                              }
                            : candidate,
                        ),
                      );
                    }}
                    required
                  >
                    <option value="">Select product</option>
                    {availableProducts.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name} / {product.sku}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Quantity" htmlFor={`order-quantity-${line.key}`}>
                  <input
                    id={`order-quantity-${line.key}`}
                    className="input"
                    type="number"
                    min="1"
                    value={line.quantity}
                    onChange={(event) =>
                      setLines((current) =>
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
                    required
                  />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field
                  label="Variant / remark"
                  htmlFor={`order-variant-${line.key}`}
                >
                  <input
                    id={`order-variant-${line.key}`}
                    className="input"
                    value={line.variant}
                    onChange={(event) =>
                      setLines((current) =>
                        current.map((candidate) =>
                          candidate.key === line.key
                            ? { ...candidate, variant: event.target.value }
                            : candidate,
                        ),
                      )
                    }
                  />
                </Field>
                {ecommerce && (
                  <Field
                    label="Selling price (assigned)"
                    htmlFor={`order-price-${line.key}`}
                    hint="Loaded from the active Product price. Update Pricing before creating the order if this is incorrect."
                  >
                    <input
                      id={`order-price-${line.key}`}
                      className="input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unitPrice}
                      readOnly
                      required
                    />
                  </Field>
                )}
                {ecommerce && (
                  <Field
                    label="Line discount"
                    htmlFor={`order-discount-${line.key}`}
                  >
                    <input
                      id={`order-discount-${line.key}`}
                      className="input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.discountAmount}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((candidate) =>
                            candidate.key === line.key
                              ? {
                                  ...candidate,
                                  discountAmount: event.target.value,
                                }
                              : candidate,
                          ),
                        )
                      }
                    />
                  </Field>
                )}
              </div>
              <div className="rounded-xl border border-line bg-inset p-3">
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-ink">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-brand-600"
                    checked={line.bundleMode}
                    onChange={(event) =>
                      setLines((current) =>
                        current.map((candidate) =>
                          candidate.key === line.key
                            ? {
                                ...candidate,
                                bundleMode: event.target.checked,
                                bundleCodes: event.target.checked
                                  ? candidate.bundleCodes
                                  : "",
                              }
                            : candidate,
                        ),
                      )
                    }
                  />
                  This item is part of a customer bundle
                </label>
                <p className="mt-1 text-xs leading-5 text-muted">
                  Buying two standalone rings is not a bundle: leave this off.
                  Turn it on only when several component products form each
                  customer set.
                </p>
                {line.bundleMode && (
                  <div className="mt-3 space-y-2">
                    <Field
                      label="Bundle set IDs"
                      htmlFor={`order-bundles-${line.key}`}
                      hint={`Enter one ID per customer set. Quantity ${line.quantity} needs ${line.quantity} ID(s), and every component line in the same bundle must use the same IDs.`}
                    >
                      <input
                        id={`order-bundles-${line.key}`}
                        className="input"
                        value={line.bundleCodes}
                        onChange={(event) =>
                          setLines((current) =>
                            current.map((candidate) =>
                              candidate.key === line.key
                                ? {
                                    ...candidate,
                                    bundleCodes: event.target.value,
                                  }
                                : candidate,
                            ),
                          )
                        }
                        required
                      />
                    </Field>
                    <button
                      type="button"
                      className="btn-outline w-full sm:w-auto"
                      onClick={() =>
                        setLines((current) =>
                          current.map((candidate) =>
                            candidate.key === line.key
                              ? {
                                  ...candidate,
                                  bundleCodes: generatedBundleCodes(
                                    reference,
                                    line.quantity,
                                  ),
                                }
                              : candidate,
                          ),
                        )
                      }
                    >
                      <Icon name="plus" className="h-4 w-4" /> Generate{" "}
                      {line.quantity} set ID(s)
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </section>

        {ecommerce && (
          <>
            <section
              className={sectionClass}
              aria-labelledby="intake-payment-heading"
            >
              <div>
                <h3
                  id="intake-payment-heading"
                  className="font-display text-base font-bold text-ink"
                >
                  Payment and invoice
                </h3>
                <p className="text-xs text-muted">
                  Paid, authorized, and COD orders may enter warehouse
                  allocation.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Payment status"
                  htmlFor="payment-status"
                  hint="Derived from the payment method and Maya report; it cannot be manually overridden."
                >
                  <input
                    id="payment-status"
                    className="input"
                    value={
                      paymentStatus === "blocked"
                        ? "Not cleared for allocation"
                        : paymentStatus.replaceAll("_", " ")
                    }
                    readOnly
                  />
                </Field>
                <Field label="Payment method" htmlFor="payment-method">
                  <select
                    id="payment-method"
                    className="input"
                    value={paymentMethod}
                    onChange={(event) => setPaymentMethod(event.target.value)}
                    required
                  >
                    {PAYMENT_METHODS.map((method) => (
                      <option key={method.value} value={method.value}>
                        {method.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Payment reference / RRN"
                  htmlFor="payment-reference"
                  hint="Use the gateway RRN or billing reference. This is the single payment identifier."
                >
                  <input
                    id="payment-reference"
                    className="input"
                    value={paymentReference}
                    onChange={(event) =>
                      setPaymentReference(event.target.value)
                    }
                  />
                </Field>
                <Field label="Payment date" htmlFor="payment-date">
                  <input
                    id="payment-date"
                    className="input"
                    type="date"
                    value={paymentDate}
                    onChange={(event) => setPaymentDate(event.target.value)}
                  />
                </Field>
                {paymentMethod === "online_payment" && (
                  <Field
                    label="Maya report result"
                    htmlFor="provider-status"
                    hint="Only Paid or Authorized may enter Warehouse allocation. Pending, failed, and refunded records remain blocked."
                  >
                    <select
                      id="provider-status"
                      className="input"
                      value={paymentProviderStatus}
                      onChange={(event) =>
                        setPaymentProviderStatus(event.target.value)
                      }
                    >
                      {MAYA_REPORT_STATUSES.map((status) => (
                        <option key={status.value} value={status.value}>
                          {status.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field label="Sales invoice number" htmlFor="sales-invoice">
                  <input
                    id="sales-invoice"
                    className="input"
                    value={salesInvoiceNumber}
                    onChange={(event) =>
                      setSalesInvoiceNumber(event.target.value)
                    }
                  />
                </Field>
              </div>
            </section>
            <section
              className={sectionClass}
              aria-labelledby="intake-commercial-heading"
            >
              <div>
                <h3
                  id="intake-commercial-heading"
                  className="font-display text-base font-bold text-ink"
                >
                  Commercial summary
                </h3>
                <p className="text-xs text-muted">
                  The app calculates totals and VAT. Reported total is retained
                  only to flag migration differences.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Shipping fee" htmlFor="shipping-fee">
                  <input
                    id="shipping-fee"
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={shippingFee}
                    onChange={(event) => setShippingFee(event.target.value)}
                  />
                </Field>
                <Field label="Other fees" htmlFor="other-fees">
                  <input
                    id="other-fees"
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={otherFees}
                    onChange={(event) => setOtherFees(event.target.value)}
                  />
                </Field>
                <Field label="Reported tracker total" htmlFor="reported-total">
                  <input
                    id="reported-total"
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={reportedTotal}
                    onChange={(event) => setReportedTotal(event.target.value)}
                  />
                </Field>
              </div>
              <dl className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-inset p-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-faint">Subtotal</dt>
                  <dd className="font-semibold text-ink">
                    {money(totals.subtotal)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-faint">Discounts</dt>
                  <dd className="font-semibold text-ink">
                    {money(totals.discount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-faint">Order total</dt>
                  <dd className="font-bold text-ink">{money(totals.total)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-faint">Net of VAT</dt>
                  <dd className="font-semibold text-ink">
                    {money(totals.netOfVat)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-faint">VAT</dt>
                  <dd className="font-semibold text-ink">
                    {money(totals.vat)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-faint">Tracker variance</dt>
                  <dd
                    className={`font-semibold ${reportedTotal && Math.abs(Number(reportedTotal) - totals.total) > 0.01 ? "text-rose-600" : "text-ink"}`}
                  >
                    {reportedTotal
                      ? money(Number(reportedTotal) - totals.total)
                      : "Not compared"}
                  </dd>
                </div>
              </dl>
            </section>
            <section
              className={sectionClass}
              aria-labelledby="intake-dispatch-heading"
            >
              <div>
                <h3
                  id="intake-dispatch-heading"
                  className="font-display text-base font-bold text-ink"
                >
                  Dispatch preparation
                </h3>
                <p className="text-xs text-muted">
                  Optional at intake. Warehouse confirms these values before
                  release.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Courier" htmlFor="intake-courier">
                  <input
                    id="intake-courier"
                    className="input"
                    value={courier}
                    onChange={(event) => setCourier(event.target.value)}
                  />
                </Field>
                <Field
                  label="Tracking / waybill number"
                  htmlFor="intake-waybill"
                >
                  <input
                    id="intake-waybill"
                    className="input"
                    value={waybillNumber}
                    onChange={(event) => setWaybillNumber(event.target.value)}
                  />
                </Field>
              </div>
              <Field
                label="Delivery tracking link"
                htmlFor="intake-delivery-link"
              >
                <input
                  id="intake-delivery-link"
                  className="input"
                  type="url"
                  placeholder="https://..."
                  value={deliveryLink}
                  onChange={(event) => setDeliveryLink(event.target.value)}
                />
              </Field>
            </section>
          </>
        )}
        <section
          className={sectionClass}
          aria-labelledby="intake-notes-heading"
        >
          <h3
            id="intake-notes-heading"
            className="font-display text-base font-bold text-ink"
          >
            Notes
          </h3>
          <Field label="Order instructions" htmlFor="order-notes">
            <textarea
              id="order-notes"
              className="input min-h-24"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
        </section>
      </form>
    </Sheet>
  );
}

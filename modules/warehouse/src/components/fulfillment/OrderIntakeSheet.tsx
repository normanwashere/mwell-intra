import { useMemo, useState, type FormEvent } from "react";
import type { Product } from "@intra/data-kit";
import type { useWarehouse } from "@/app/store";
import { Icon } from "@/components/Icon";
import { Field, Sheet, useToast } from "@/components/ui";

type Source = "ecommerce" | "event" | "third_party";

interface OrderLineDraft {
  key: string;
  productId: string;
  quantity: number;
  variant: string;
  unitPrice: string;
  discountAmount: string;
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
  return {
    key: crypto.randomUUID(),
    productId: products.find((product) => eligible(product, source))?.id ?? "",
    quantity: 1,
    variant: "",
    unitPrice: "",
    discountAmount: "",
    bundleCodes: "",
  };
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
  const [paymentStatus, setPaymentStatus] = useState("paid");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentRrn, setPaymentRrn] = useState("");
  const [paymentProviderMethod, setPaymentProviderMethod] = useState("");
  const [paymentProviderStatus, setPaymentProviderStatus] = useState("");
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
  const availableProducts = products.filter((product) =>
    eligible(product, source),
  );
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
    setPaymentReference("");
    setPaymentDate("");
    setPaymentRrn("");
    setPaymentProviderMethod("");
    setPaymentProviderStatus("");
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
      paymentStatus: ecommerce
        ? (paymentStatus as "paid" | "authorized" | "cod")
        : undefined,
      paymentMethod: ecommerce ? paymentMethod.trim() || undefined : undefined,
      paymentReference: ecommerce
        ? paymentReference.trim() || undefined
        : undefined,
      paymentDate: ecommerce ? paymentDate || undefined : undefined,
      paymentRrn: ecommerce ? paymentRrn.trim() || undefined : undefined,
      paymentProviderMethod: ecommerce
        ? paymentProviderMethod.trim() || undefined
        : undefined,
      paymentProviderStatus: ecommerce
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
        bundleSetCodes: line.bundleCodes
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
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
        <button
          type="submit"
          form="order-intake-form"
          className="btn-primary w-full"
          disabled={saving}
        >
          {saving
            ? "Creating..."
            : ecommerce
              ? "Create order"
              : "Create demand"}
        </button>
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
              <option value="event">Internal event fulfillment</option>
              <option value="third_party">Third-party event sale</option>
            </select>
          </Field>
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
                <input
                  id="order-channel"
                  className="input"
                  placeholder="Shopify, Lazada, Shopee..."
                  value={channel}
                  onChange={(event) => setChannel(event.target.value)}
                  required
                />
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
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                  required
                />
              </Field>
              <Field label="Province" htmlFor="delivery-province">
                <input
                  id="delivery-province"
                  className="input"
                  value={province}
                  onChange={(event) => setProvince(event.target.value)}
                  required
                />
              </Field>
              <Field label="Postal code" htmlFor="delivery-postal">
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
                    onChange={(event) =>
                      setLines((current) =>
                        current.map((candidate) =>
                          candidate.key === line.key
                            ? { ...candidate, productId: event.target.value }
                            : candidate,
                        ),
                      )
                    }
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
                  <Field label="Unit price" htmlFor={`order-price-${line.key}`}>
                    <input
                      id={`order-price-${line.key}`}
                      className="input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unitPrice}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((candidate) =>
                            candidate.key === line.key
                              ? { ...candidate, unitPrice: event.target.value }
                              : candidate,
                          ),
                        )
                      }
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
              <Field
                label="Bundle set codes"
                htmlFor={`order-bundles-${line.key}`}
                hint="Optional, comma-separated. Example: OTG-001, OTG-002."
              >
                <input
                  id={`order-bundles-${line.key}`}
                  className="input"
                  value={line.bundleCodes}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((candidate) =>
                        candidate.key === line.key
                          ? { ...candidate, bundleCodes: event.target.value }
                          : candidate,
                      ),
                    )
                  }
                />
              </Field>
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
                <Field label="Payment status" htmlFor="payment-status">
                  <select
                    id="payment-status"
                    className="input"
                    value={paymentStatus}
                    onChange={(event) => setPaymentStatus(event.target.value)}
                  >
                    <option value="paid">Paid</option>
                    <option value="authorized">Authorized</option>
                    <option value="cod">Cash on delivery</option>
                  </select>
                </Field>
                <Field label="Payment method" htmlFor="payment-method">
                  <input
                    id="payment-method"
                    className="input"
                    value={paymentMethod}
                    onChange={(event) => setPaymentMethod(event.target.value)}
                  />
                </Field>
                <Field label="Payment reference" htmlFor="payment-reference">
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
                <Field label="RRN" htmlFor="payment-rrn">
                  <input
                    id="payment-rrn"
                    className="input"
                    value={paymentRrn}
                    onChange={(event) => setPaymentRrn(event.target.value)}
                  />
                </Field>
                <Field
                  label="Provider method"
                  htmlFor="payment-provider-method"
                >
                  <input
                    id="payment-provider-method"
                    className="input"
                    placeholder="Maya wallet, card, QR..."
                    value={paymentProviderMethod}
                    onChange={(event) =>
                      setPaymentProviderMethod(event.target.value)
                    }
                  />
                </Field>
                <Field label="Provider status" htmlFor="provider-status">
                  <input
                    id="provider-status"
                    className="input"
                    placeholder="Maya status or gateway result"
                    value={paymentProviderStatus}
                    onChange={(event) =>
                      setPaymentProviderStatus(event.target.value)
                    }
                  />
                </Field>
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

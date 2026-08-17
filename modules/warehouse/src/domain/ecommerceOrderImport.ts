import { parse } from "csv-parse/browser/esm/sync";
import type {
  CreateFulfillmentOrderInput,
  EcommercePaymentStatus,
  Product,
} from "@intra/data-kit";

interface CsvOrderRow {
  order_reference?: string;
  order_date?: string;
  channel?: string;
  customer_reference?: string;
  customer_name?: string;
  customer_contact?: string;
  customer_email?: string;
  delivery_area?: string;
  delivery_address?: string;
  city?: string;
  province?: string;
  postal_code?: string;
  payment_status?: string;
  payment_method?: string;
  payment_reference?: string;
  payment_date?: string;
  payment_rrn?: string;
  payment_provider_method?: string;
  payment_provider_status?: string;
  campaign_name?: string;
  sales_invoice_number?: string;
  product_sku?: string;
  variant?: string;
  quantity?: string;
  unit_price?: string;
  discount_amount?: string;
  shipping_fee?: string;
  other_fees?: string;
  reported_total_amount?: string;
  courier?: string;
  delivery_link?: string;
  waybill_number?: string;
  order_notes?: string;
  bundle_set_codes?: string;
}

export interface EcommerceImportRow {
  rowNumber: number;
  orderReference: string;
  orderDate?: string;
  ecommerceChannel: string;
  customerReference?: string;
  customerName: string;
  customerContact: string;
  customerEmail?: string;
  deliveryArea?: string;
  deliveryAddress: string;
  city: string;
  province: string;
  postalCode: string;
  paymentStatus: string;
  paymentMethod?: string;
  paymentReference?: string;
  paymentDate?: string;
  paymentRrn?: string;
  paymentProviderMethod?: string;
  paymentProviderStatus?: string;
  campaignName?: string;
  salesInvoiceNumber?: string;
  productId?: string;
  productName: string;
  productSku: string;
  variant?: string;
  quantity: number;
  unitPrice?: number;
  discountAmount?: number;
  shippingFee?: number;
  otherFees?: number;
  reportedTotalAmount?: number;
  courier?: string;
  deliveryLink?: string;
  waybillNumber?: string;
  orderNotes?: string;
  bundleSetCodes: string[];
  error?: string;
}

export type EcommerceOrderImport = Omit<
  CreateFulfillmentOrderInput,
  "actor" | "source" | "requestingDepartment" | "sourceLocationId"
>;

const READY_PAYMENT_STATUSES = new Set(["paid", "authorized", "cod"]);

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const TRACKER_HEADER_ALIASES: Record<string, keyof CsvOrderRow> = {
  order_no: "order_reference",
  order_number: "order_reference",
  date: "order_date",
  customer: "customer_name",
  contact_no: "customer_contact",
  contact_number: "customer_contact",
  email: "customer_email",
  area_of_delivery: "delivery_area",
  address: "delivery_address",
  zip: "postal_code",
  payment: "payment_status",
  payment_type: "payment_method",
  reference: "payment_reference",
  reference_number: "payment_reference",
  rrn: "payment_rrn",
  maya_method: "payment_provider_method",
  maya_status: "payment_provider_status",
  event_name: "campaign_name",
  sales_invoice_no: "sales_invoice_number",
  sku: "product_sku",
  remark_variant: "variant",
  price: "unit_price",
  qty: "quantity",
  discount: "discount_amount",
  discounts: "discount_amount",
  shipping_fees: "shipping_fee",
  other_fee: "other_fees",
  total_amount: "reported_total_amount",
  logistic_courier: "courier",
  tracking_no: "waybill_number",
  note: "order_notes",
  bundle_set_code: "bundle_set_codes",
};

function canonicalHeader(value: string) {
  const normalized = normalizeHeader(value);
  return TRACKER_HEADER_ALIASES[normalized] ?? normalized;
}

function optionalNumber(value?: string) {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function validIsoDate(value?: string) {
  if (!value?.trim()) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function orderHeaderSignature(record: CsvOrderRow) {
  return [
    record.order_date,
    record.channel,
    record.customer_reference,
    record.customer_name,
    record.customer_contact,
    record.customer_email,
    record.delivery_area,
    record.delivery_address,
    record.city,
    record.province,
    record.postal_code,
    record.payment_status,
    record.payment_method,
    record.payment_reference,
    record.payment_date,
    record.payment_rrn,
    record.payment_provider_method,
    record.payment_provider_status,
    record.campaign_name,
    record.sales_invoice_number,
    record.shipping_fee,
    record.other_fees,
    record.reported_total_amount,
    record.courier,
    record.delivery_link,
    record.waybill_number,
    record.order_notes,
  ]
    .map((value) => value?.trim().toLowerCase() ?? "")
    .join("|");
}

export function parseEcommerceOrderCsv(
  text: string,
  products: Product[],
  existingReferences: string[],
): EcommerceImportRow[] {
  const records = parse(text, {
    columns: (headers: string[]) => headers.map(canonicalHeader),
    bom: true,
    skip_empty_lines: true,
    trim: true,
  }) as CsvOrderRow[];
  const productBySku = new Map(
    products.map((product) => [product.sku.trim().toLowerCase(), product]),
  );
  const existing = new Set(
    existingReferences.map((value) => value.toLowerCase()),
  );
  const orderChannels = new Map<string, Set<string>>();
  const orderHeaders = new Map<string, Set<string>>();

  for (const record of records) {
    const reference = record.order_reference?.trim().toLowerCase();
    if (!reference) continue;
    const channels = orderChannels.get(reference) ?? new Set<string>();
    channels.add(record.channel?.trim().toLowerCase() ?? "");
    orderChannels.set(reference, channels);
    const headers = orderHeaders.get(reference) ?? new Set<string>();
    headers.add(orderHeaderSignature(record));
    orderHeaders.set(reference, headers);
  }

  return records.map((record, index) => {
    const orderReference = record.order_reference?.trim() ?? "";
    const productSku = record.product_sku?.trim() ?? "";
    const product = productBySku.get(productSku.toLowerCase());
    const quantity = Number(record.quantity);
    const paymentStatus = record.payment_status?.trim().toLowerCase() ?? "";
    const unitPrice = optionalNumber(record.unit_price);
    const discountAmount = optionalNumber(record.discount_amount);
    const shippingFee = optionalNumber(record.shipping_fee);
    const otherFees = optionalNumber(record.other_fees);
    const reportedTotalAmount = optionalNumber(record.reported_total_amount);
    const errors = [
      !orderReference ? "Order reference is required" : "",
      existing.has(orderReference.toLowerCase())
        ? "Order reference already exists"
        : "",
      !record.channel?.trim() ? "Channel is required" : "",
      (orderChannels.get(orderReference.toLowerCase())?.size ?? 0) > 1
        ? "Order has an inconsistent channel"
        : "",
      (orderHeaders.get(orderReference.toLowerCase())?.size ?? 0) > 1
        ? "Order has inconsistent order details across rows"
        : "",
      !validIsoDate(record.order_date) ? "Order date must use YYYY-MM-DD" : "",
      !validIsoDate(record.payment_date)
        ? "Payment date must use YYYY-MM-DD"
        : "",
      !record.customer_name?.trim() ? "Customer name is required" : "",
      !record.customer_contact?.trim() ? "Customer contact is required" : "",
      record.customer_email?.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.customer_email.trim())
        ? "Customer email is invalid"
        : "",
      !record.delivery_address?.trim() ? "Delivery address is required" : "",
      !record.city?.trim() ? "City is required" : "",
      !record.province?.trim() ? "Province is required" : "",
      !record.postal_code?.trim() ? "Postal code is required" : "",
      !READY_PAYMENT_STATUSES.has(paymentStatus)
        ? "Payment status must be paid, authorized, or COD"
        : "",
      !productSku ? "Product SKU is required" : "",
      productSku && !product ? "SKU was not found" : "",
      !Number.isInteger(quantity) || quantity < 1
        ? "Quantity must be a whole number of 1 or more"
        : "",
      record.unit_price?.trim() && (unitPrice === undefined || unitPrice < 0)
        ? "Unit price must be zero or more"
        : "",
      record.discount_amount?.trim() &&
      (discountAmount === undefined || discountAmount < 0)
        ? "Discount amount must be zero or more"
        : "",
      unitPrice !== undefined &&
      discountAmount !== undefined &&
      Number.isInteger(quantity) &&
      quantity > 0 &&
      discountAmount > unitPrice * quantity
        ? "Discount amount cannot exceed the line value"
        : "",
      record.shipping_fee?.trim() &&
      (shippingFee === undefined || shippingFee < 0)
        ? "Shipping fee must be zero or more"
        : "",
      record.other_fees?.trim() && (otherFees === undefined || otherFees < 0)
        ? "Other fees must be zero or more"
        : "",
      record.reported_total_amount?.trim() &&
      (reportedTotalAmount === undefined || reportedTotalAmount < 0)
        ? "Total amount must be zero or more"
        : "",
      record.delivery_link?.trim() &&
      !/^https?:\/\//i.test(record.delivery_link.trim())
        ? "Delivery link must start with http:// or https://"
        : "",
    ].filter(Boolean);
    return {
      rowNumber: index + 2,
      orderReference,
      orderDate: record.order_date?.trim() || undefined,
      ecommerceChannel: record.channel?.trim() ?? "",
      customerReference: record.customer_reference?.trim() || undefined,
      customerName: record.customer_name?.trim() ?? "",
      customerContact: record.customer_contact?.trim() ?? "",
      customerEmail: record.customer_email?.trim() || undefined,
      deliveryArea: record.delivery_area?.trim() || undefined,
      deliveryAddress: record.delivery_address?.trim() ?? "",
      city: record.city?.trim() ?? "",
      province: record.province?.trim() ?? "",
      postalCode: record.postal_code?.trim() ?? "",
      paymentStatus,
      paymentMethod: record.payment_method?.trim() || undefined,
      paymentReference: record.payment_reference?.trim() || undefined,
      paymentDate: record.payment_date?.trim() || undefined,
      paymentRrn: record.payment_rrn?.trim() || undefined,
      paymentProviderMethod:
        record.payment_provider_method?.trim() || undefined,
      paymentProviderStatus:
        record.payment_provider_status?.trim() || undefined,
      campaignName: record.campaign_name?.trim() || undefined,
      salesInvoiceNumber: record.sales_invoice_number?.trim() || undefined,
      productId: product?.id,
      productName: product?.name ?? "Unknown product",
      productSku,
      variant: record.variant?.trim() || undefined,
      quantity,
      unitPrice,
      discountAmount,
      shippingFee,
      otherFees,
      reportedTotalAmount,
      courier: record.courier?.trim() || undefined,
      deliveryLink: record.delivery_link?.trim() || undefined,
      waybillNumber: record.waybill_number?.trim() || undefined,
      orderNotes: record.order_notes?.trim() || undefined,
      bundleSetCodes: (record.bundle_set_codes ?? "")
        .split(/[|;]/)
        .map((value) => value.trim())
        .filter(Boolean),
      error: errors.join("; ") || undefined,
    };
  });
}

export function groupEcommerceImportRows(
  rows: EcommerceImportRow[],
): EcommerceOrderImport[] {
  const grouped = new Map<string, EcommerceImportRow[]>();
  for (const row of rows) {
    grouped.set(row.orderReference, [
      ...(grouped.get(row.orderReference) ?? []),
      row,
    ]);
  }
  return [...grouped.entries()].map(([externalReference, orderRows]) => {
    const first = orderRows[0]!;
    return {
      externalReference,
      ecommerceChannel: first.ecommerceChannel,
      orderDate: first.orderDate,
      customerReference: first.customerReference,
      customerName: first.customerName,
      customerContact: first.customerContact,
      customerEmail: first.customerEmail,
      deliveryArea: first.deliveryArea,
      deliveryAddress: {
        addressLine: first.deliveryAddress,
        city: first.city,
        province: first.province,
        postalCode: first.postalCode,
      },
      paymentStatus: first.paymentStatus as EcommercePaymentStatus,
      paymentMethod: first.paymentMethod,
      paymentReference: first.paymentReference,
      paymentDate: first.paymentDate,
      paymentRrn: first.paymentRrn,
      paymentProviderMethod: first.paymentProviderMethod,
      paymentProviderStatus: first.paymentProviderStatus,
      campaignName: first.campaignName,
      salesInvoiceNumber: first.salesInvoiceNumber,
      shippingFee: first.shippingFee,
      otherFees: first.otherFees,
      reportedTotalAmount: first.reportedTotalAmount,
      courier: first.courier,
      deliveryLink: first.deliveryLink,
      waybillNumber: first.waybillNumber,
      orderNotes: first.orderNotes,
      lines: orderRows.map((row) => ({
        productId: row.productId!,
        quantity: row.quantity,
        bundleSetCodes: row.bundleSetCodes,
        variant: row.variant,
        unitPrice: row.unitPrice,
        discountAmount: row.discountAmount,
      })),
    };
  });
}

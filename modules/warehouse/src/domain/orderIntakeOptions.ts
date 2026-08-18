export const ECOMMERCE_CHANNELS = [
  "Eshop",
  "Shopify",
  "Shopee",
  "Tiktok",
  "NU",
] as const;

export const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "online_payment", label: "Online payment (credit card / QR)" },
  { value: "billing", label: "Billing" },
] as const;

export const MAYA_REPORT_STATUSES = [
  { value: "paid", label: "Paid" },
  { value: "authorized", label: "Authorized" },
  { value: "pending", label: "Pending" },
  { value: "failed", label: "Failed" },
  { value: "refunded", label: "Refunded" },
] as const;

export const PH_CITY_PRESETS = [
  {
    city: "Caloocan",
    province: "Metro Manila",
    postalCode: "1400",
    area: "Metro Manila",
  },
  {
    city: "Makati",
    province: "Metro Manila",
    postalCode: "1200",
    area: "Metro Manila",
  },
  {
    city: "Mandaluyong",
    province: "Metro Manila",
    postalCode: "1550",
    area: "Metro Manila",
  },
  {
    city: "Manila",
    province: "Metro Manila",
    postalCode: "1000",
    area: "Metro Manila",
  },
  {
    city: "Muntinlupa",
    province: "Metro Manila",
    postalCode: "1770",
    area: "Metro Manila",
  },
  {
    city: "Paranaque",
    province: "Metro Manila",
    postalCode: "1700",
    area: "Metro Manila",
  },
  {
    city: "Pasay",
    province: "Metro Manila",
    postalCode: "1300",
    area: "Metro Manila",
  },
  {
    city: "Pasig",
    province: "Metro Manila",
    postalCode: "1600",
    area: "Metro Manila",
  },
  {
    city: "Quezon City",
    province: "Metro Manila",
    postalCode: "1100",
    area: "Metro Manila",
  },
  {
    city: "Taguig",
    province: "Metro Manila",
    postalCode: "1630",
    area: "Metro Manila",
  },
] as const;

export function cityPreset(value: string) {
  const normalized = value.trim().toLocaleLowerCase();
  return PH_CITY_PRESETS.find(
    (preset) => preset.city.toLocaleLowerCase() === normalized,
  );
}

export function paymentStatusFor(
  method: string,
  mayaStatus: string,
): "paid" | "authorized" | "cod" | "blocked" {
  if (method === "cash") return "cod";
  if (method === "billing") return "authorized";
  if (mayaStatus === "paid" || mayaStatus === "authorized") return mayaStatus;
  return "blocked";
}

export function trackerTemplateCsv() {
  return [
    [
      "order_reference",
      "order_date",
      "channel",
      "customer_reference",
      "customer_name",
      "customer_contact",
      "customer_email",
      "delivery_address",
      "city",
      "province",
      "postal_code",
      "delivery_area",
      "payment_status",
      "payment_method",
      "payment_reference",
      "payment_date",
      "product_sku",
      "quantity",
      "unit_price",
      "discount_amount",
      "bundle_set_codes",
      "shipping_fee",
      "other_fees",
      "courier",
      "waybill_number",
      "delivery_link",
      "order_notes",
    ].join(","),
    "SHOP-0001,2026-08-18,Shopify,CUST-0001,Juan Dela Cruz,09170000000,juan@example.com,12 Main Street,Pasig,Metro Manila,1600,Metro Manila,paid,online_payment,RRN-0001,2026-08-18,PRODUCT-SKU,1,0,0,,0,0,,,,",
  ].join("\r\n");
}

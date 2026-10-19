import type { ReceivingDraftClient } from "./receivingDrafts";

export interface ExternalOrderLine {
  id: string;
  product_id: string;
  quantity: number;
  uom: string;
  received_quantity: number;
}

export interface ExternalShipmentLine {
  po_line_id: string;
  quantity: number;
  serial_numbers: string[];
  lot_code?: string;
  expiry_date?: string;
}

export interface ExternalShipment {
  id: string;
  order_id: string;
  delivery_reference: string;
  actual_delivery_date: string;
  bin_id: string;
  evidence_urls: string[];
  notes: string;
  status: "draft" | "posted";
  receipt_id: string | null;
  version: number;
  created_by: string;
  lines: ExternalShipmentLine[];
}

export interface ExternalOrder {
  id: string;
  po_number: string | null;
  supplier_id: string;
  location_id: string;
  status: "draft" | "confirmed" | "returned";
  evidence_urls: string[];
  email_sender: string;
  email_date: string | null;
  notes: string;
  version: number;
  created_by: string;
  confirmed_by: string | null;
  review_note: string | null;
  created_at: string;
  lines: ExternalOrderLine[];
  shipments: ExternalShipment[];
}

export interface ExternalReceivingWorkspace {
  can_confirm: boolean;
  orders: ExternalOrder[];
  has_more?: boolean;
  next_offset?: number | null;
}

export type SaveExternalOrder = Pick<
  ExternalOrder,
  | "version"
  | "po_number"
  | "supplier_id"
  | "location_id"
  | "email_sender"
  | "email_date"
  | "notes"
  | "evidence_urls"
> & {
  action: "save_order";
  order_id: string;
  lines: Omit<ExternalOrderLine, "received_quantity">[];
};

export type SaveExternalShipment = Pick<
  ExternalShipment,
  | "order_id"
  | "version"
  | "delivery_reference"
  | "actual_delivery_date"
  | "bin_id"
  | "evidence_urls"
  | "notes"
  | "lines"
> & { action: "save_shipment"; shipment_id: string };

export type ExternalCommandInput =
  | SaveExternalOrder
  | SaveExternalShipment
  | {
      action: "confirm_order" | "return_order";
      order_id: string;
      version: number;
      review_note: string;
    }
  | {
      action: "post_shipment";
      order_id: string;
      shipment_id: string;
      version: number;
    };
export type ExternalCommand = ExternalCommandInput & {
  idempotency_key: string;
};
export interface ExternalCommandResult {
  order_id: string;
  shipment_id?: string;
  receipt_id?: string;
}

export class ExternalReceivingError extends Error {
  constructor(
    message: string,
    readonly uncertain = false,
  ) {
    super(message);
  }
}

const READ_CONNECTION_ERROR =
  "Could not connect to external receiving. Check your connection and retry.";
const COMMAND_CONNECTION_ERROR =
  "The action could not be confirmed. Check your connection and retry the saved action to check its outcome.";

function rpcErrorMessage(
  error: { message: string; code?: string },
  command = false,
): string {
  const code = error.code ?? "";
  if (["PGRST202", "PGRST106", "3F000", "42883"].includes(code)) {
    return "External receiving is not available in this environment yet. Contact support.";
  }
  if (/^(PGRST30[123]|28[A-Z0-9]{3})$/.test(code)) {
    return "Your session could not be verified. Sign in again to continue.";
  }
  // Application rejections contain actionable business guidance, not transport details.
  if (code === "P0001") return error.message;
  if (
    /permission denied|access denied|not authorized|row.level security|insufficient[_ ]privilege/i.test(
      error.message,
    )
  ) {
    return "You do not have access to external receiving. Contact your administrator.";
  }
  if (
    /^(PGRST00[0-3]|08[A-Z0-9]{3}|57P0[123]|57014)$/.test(code) ||
    /failed to fetch|networkerror|network request failed|fetch failed|\bload failed\b|timeout|timed out|connection.*(unavailable|failed|failure|lost|refused|closed)|service unavailable|bad gateway/i.test(
      error.message,
    )
  ) {
    return command ? COMMAND_CONNECTION_ERROR : READ_CONNECTION_ERROR;
  }
  return error.message;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string");
const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const nullableText = (value: unknown) =>
  value === null || typeof value === "string";
const textFields = (value: Record<string, unknown>, keys: string[]) =>
  keys.every((key) => typeof value[key] === "string");

function shipmentLine(value: unknown): boolean {
  return (
    record(value) &&
    typeof value.po_line_id === "string" &&
    integer(value.quantity) &&
    strings(value.serial_numbers) &&
    (value.lot_code === undefined || typeof value.lot_code === "string") &&
    (value.expiry_date === undefined || typeof value.expiry_date === "string")
  );
}

function shipment(value: unknown): boolean {
  return (
    record(value) &&
    textFields(value, [
      "id",
      "order_id",
      "delivery_reference",
      "actual_delivery_date",
      "bin_id",
      "notes",
      "created_by",
    ]) &&
    ["draft", "posted"].includes(String(value.status)) &&
    integer(value.version) &&
    nullableText(value.receipt_id) &&
    strings(value.evidence_urls) &&
    Array.isArray(value.lines) &&
    value.lines.every(shipmentLine)
  );
}

function order(value: unknown): boolean {
  return (
    record(value) &&
    textFields(value, [
      "id",
      "supplier_id",
      "location_id",
      "email_sender",
      "notes",
      "created_by",
      "created_at",
    ]) &&
    ["draft", "confirmed", "returned"].includes(String(value.status)) &&
    integer(value.version) &&
    ["po_number", "email_date", "confirmed_by", "review_note"].every((key) =>
      nullableText(value[key]),
    ) &&
    strings(value.evidence_urls) &&
    Array.isArray(value.shipments) &&
    value.shipments.every(shipment) &&
    Array.isArray(value.lines) &&
    value.lines.every(
      (line) =>
        record(line) &&
        textFields(line, ["id", "product_id", "uom"]) &&
        integer(line.quantity) &&
        line.quantity > 0 &&
        integer(line.received_quantity),
    )
  );
}

export async function loadExternalReceiving(
  client: ReceivingDraftClient,
  payload: { offset: number } | { order_id: string } = { offset: 0 },
): Promise<ExternalReceivingWorkspace> {
  let response;
  try {
    response = await client
      .schema("warehouse")
      .rpc("external_po_workspace", { payload });
  } catch {
    throw new ExternalReceivingError(READ_CONNECTION_ERROR);
  }
  const { data, error } = response;
  if (error) throw new ExternalReceivingError(rpcErrorMessage(error));
  if (
    !record(data) ||
    typeof data.can_confirm !== "boolean" ||
    !Array.isArray(data.orders) ||
    !data.orders.every(order) ||
    (data.has_more !== undefined && typeof data.has_more !== "boolean") ||
    (data.next_offset !== undefined &&
      data.next_offset !== null &&
      !integer(data.next_offset)) ||
    (data.has_more === true &&
      (!integer(data.next_offset) ||
        ("offset" in payload && data.next_offset <= payload.offset)))
  ) {
    throw new ExternalReceivingError(
      "External receiving returned an invalid workspace. Please reload.",
    );
  }
  return data as unknown as ExternalReceivingWorkspace;
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Clone before freezing so form edits can never alter an in-flight retry. */
export function freezeExternalCommand<T extends ExternalCommandInput>(
  input: T,
): T & { idempotency_key: string } {
  return freeze(
    JSON.parse(
      JSON.stringify({ ...input, idempotency_key: crypto.randomUUID() }),
    ) as T & { idempotency_key: string },
  );
}

export async function runExternalReceivingCommand(
  client: ReceivingDraftClient,
  payload: ExternalCommand,
): Promise<ExternalCommandResult> {
  let response;
  try {
    response = await client
      .schema("warehouse")
      .rpc("external_po_command", { payload });
  } catch {
    throw new ExternalReceivingError(COMMAND_CONNECTION_ERROR, true);
  }
  if (response.error) {
    // SQL errors acknowledge a rollback. Transport/gateway failures may arrive after a commit.
    const code = response.error.code ?? "";
    const definitive = /^(22|23|28|40|42|P0)[A-Z0-9]{3}$/.test(code);
    throw new ExternalReceivingError(
      rpcErrorMessage(response.error, true),
      !definitive,
    );
  }
  const result = response.data;
  if (
    !record(result) ||
    result.order_id !== payload.order_id ||
    ("shipment_id" in payload && result.shipment_id !== payload.shipment_id) ||
    (payload.action === "post_shipment" &&
      typeof result.receipt_id !== "string")
  ) {
    throw new ExternalReceivingError(
      "The saved action has not been verified. Retry to check its outcome.",
      true,
    );
  }
  return result as unknown as ExternalCommandResult;
}

export function shipmentPostingIssue(
  order: ExternalOrder,
  shipment: ExternalShipment,
  products: { id: string; serialized: boolean; expiryTracked?: boolean }[] = [],
): string | null {
  if (shipment.status === "posted") return "Already sent to Quality.";
  if (order.status !== "confirmed")
    return "Waiting for Operations Lead confirmation. This arrival is not available stock.";
  const totals = new Map<string, number>();
  for (const line of shipment.lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 0)
      return "Document correction required before posting.";
    totals.set(
      line.po_line_id,
      (totals.get(line.po_line_id) ?? 0) + line.quantity,
    );
  }
  if (![...totals.values()].some((quantity) => quantity > 0))
    return "Record a delivered quantity before posting.";
  for (const [id, quantity] of totals) {
    const line = order.lines.find((candidate) => candidate.id === id);
    if (!line || quantity > line.quantity - line.received_quantity) {
      return "Document correction required: excess or unidentified items stay in draft and are not available stock.";
    }
  }
  if (!shipment.evidence_urls.length)
    return "Delivery photo evidence is required before posting.";
  const serials = new Set<string>();
  for (const line of shipment.lines) {
    const productId = order.lines.find(
      (item) => item.id === line.po_line_id,
    )?.product_id;
    const product = products.find((item) => item.id === productId);
    if (product?.serialized && line.serial_numbers.length !== line.quantity)
      return "Record one serial number for every delivered unit before posting.";
    if (product && !product.serialized && line.serial_numbers.length)
      return "Quantity-tracked products must not include serial numbers.";
    if (product?.expiryTracked && !line.expiry_date)
      return "Record the expiry date before posting this product.";
    if (line.expiry_date && line.expiry_date < shipment.actual_delivery_date)
      return "Stock expired on arrival must remain in draft for review.";
    for (const serial of line.serial_numbers) {
      const normalized = serial.trim().toUpperCase();
      if (!normalized || normalized.length > 200 || serials.has(normalized))
        return "Each delivered unit needs a unique serial number.";
      serials.add(normalized);
    }
  }
  return null;
}

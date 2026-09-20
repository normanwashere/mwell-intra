export interface StockConversionPackaging {
  product_id: string;
  quantity: number;
  disposition: "consume" | "recover" | "discard";
}

export interface StockConversionUnit {
  serial_number: string;
  inspection_id: string;
  return_id?: string;
  allocation_id?: string;
  original_conversion_id?: string;
}

interface CommandEvidence {
  idempotency_key: string;
  evidence_urls: string[];
}

export type StockConversionCommand = CommandEvidence & (
  | {
      action: "approve_recipe";
      kit_definition_id: string;
      event_id: string;
      direction: "conversion" | "recovery";
      source_product_id: string;
      output_product_id: string;
      approval_reference: string;
      packaging: StockConversionPackaging[];
    }
  | {
      action: "create";
      recipe_id: string;
      event_id: string;
      source_location_id: string;
      source_bin_id: string;
      destination_location_id: string;
      destination_bin_id: string;
      units: StockConversionUnit[];
    }
  | { action: "approve"; batch_id: string; inspected_serial_numbers: string[] }
  | { action: "complete"; batch_id: string }
  | { action: "cancel"; batch_id: string; reason: string }
);

export interface StockConversionRecipe {
  id: string;
  kit_definition_id: string;
  kit_version: number;
  event_id: string;
  direction: "conversion" | "recovery";
  source_product_id: string;
  output_product_id: string;
  packaging: StockConversionPackaging[];
  approval_reference: string;
  approved_by: string;
  approved_at: string;
  evidence_urls: string[];
}

export interface StockConversionBatch {
  id: string;
  recipe_id: string;
  event_id: string;
  status: "inspection" | "ready" | "completed" | "cancelled";
  source_location_id: string;
  source_bin_id: string;
  destination_location_id: string;
  destination_bin_id: string;
  units: StockConversionUnit[];
  created_by: string;
  created_at: string;
  approved_by: string | null;
  completed_by: string | null;
}

export interface StockConversionWorkspace {
  recipes: StockConversionRecipe[];
  batches: StockConversionBatch[];
  recovery_available: boolean;
  candidates: (StockConversionUnit & { unit_id: string; product_id: string; location_id: string; bin_id: string })[];
}

export type StockConversionResult = StockConversionRecipe | StockConversionBatch;

export class StockConversionRejectedError extends Error {
  override name = "StockConversionRejectedError";
}

export function stockConversionCapability(action: "approve_recipe"): "decide_go_live";
export function stockConversionCapability(action: Exclude<StockConversionCommand["action"], "approve_recipe">): "manage_returns" | "inspect_quality";
export function stockConversionCapability(action: StockConversionCommand["action"]) {
  if (action === "approve_recipe") return "decide_go_live" as const;
  if (action === "approve") return "inspect_quality" as const;
  return "manage_returns" as const;
}

export function validateStockConversion(input: StockConversionCommand): string[] {
  const errors: string[] = [];
  if (!/^[A-Za-z0-9_-]{12,128}$/.test(input.idempotency_key)) errors.push("A stable idempotency key is required.");
  if ("output_serial_number" in input) errors.push("Output serial numbers cannot be replaced.");
  if (!input.evidence_urls.length || input.evidence_urls.some((value) => {
    try { const url = new URL(value); return url.protocol !== "https:" || !!url.username || !!url.password; }
    catch { return true; }
  })) errors.push("At least one HTTPS evidence reference is required.");
  if (input.action === "create") {
    if (![input.recipe_id, input.event_id, input.source_location_id, input.source_bin_id, input.destination_location_id, input.destination_bin_id].every((value) => value.trim())) errors.push("Recipe, event, source and destination bins are required.");
    if (!input.units.length || input.units.length > 100) errors.push("Select between 1 and 100 devices.");
    const serials = input.units.map((unit) => unit.serial_number.trim().toUpperCase());
    if (serials.some((serial) => !serial) || new Set(serials).size !== serials.length) errors.push("Each device serial must be selected once.");
    if (input.units.some((unit) => !unit.inspection_id.trim())) errors.push("Every device requires a saved inspection.");
    if (input.units.some((unit) => {
      const refs = [unit.return_id, unit.allocation_id, unit.original_conversion_id];
      return refs.some(Boolean) && !refs.every((value) => value?.trim());
    })) errors.push("Recovery requires return, allocation, and original conversion references for each device.");
  } else if (input.action === "approve_recipe") {
    if (![input.kit_definition_id, input.event_id, input.source_product_id, input.output_product_id, input.approval_reference].every((value) => value.trim())) errors.push("An explicit Product-approved recipe and event are required.");
    if (input.source_product_id === input.output_product_id) errors.push("Source and output products must be different.");
    if (input.packaging.some((row) => !row.product_id.trim() || !Number.isSafeInteger(row.quantity) || row.quantity <= 0 || !["consume", "recover", "discard"].includes(row.disposition)) || new Set(input.packaging.map((row) => row.product_id)).size !== input.packaging.length) errors.push("Packaging quantities must be positive whole units with one row per product.");
  } else {
    if (!input.batch_id.trim()) errors.push("A saved conversion batch is required.");
    if (input.action === "approve" && !input.inspected_serial_numbers.length) errors.push("Confirm every inspected device explicitly.");
    if (input.action === "cancel" && !input.reason.trim()) errors.push("Cancellation reason is required.");
  }
  return errors;
}

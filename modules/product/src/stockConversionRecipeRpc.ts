import type { useSession } from "@intra/auth";

export type RecipeClient = NonNullable<ReturnType<typeof useSession>["supabaseClient"]>;
export interface RecipePackaging { product_id: string; quantity: number; disposition: "consume" | "recover" | "discard" }
export interface RecipeApproval {
  action: "approve_recipe";
  idempotency_key: string;
  kit_definition_id: string;
  event_id: string;
  direction: "conversion" | "recovery";
  source_product_id: string;
  output_product_id: string;
  packaging: RecipePackaging[];
  approval_reference: string;
  evidence_urls: string[];
}
export interface RecipeKit {
  id: string; name: string; version: number; product_id: string; product_name: string;
  base_product_id: string; base_product_name: string; recovery_ready: boolean;
  packaging: { product_id: string; name: string; quantity: number }[];
}
export interface ApprovedRecipe extends Omit<RecipeApproval, "action" | "idempotency_key"> {
  id: string; kit_version: number; kit_name: string; event_name: string;
  source_product_name: string; output_product_name: string; approved_by: string; approved_at: string;
}
export interface RecipeWorkspace {
  kits: RecipeKit[];
  events: { id: string; name: string; status: string }[];
  recipes: ApprovedRecipe[];
}

export class RecipeApprovalRejected extends Error {}

export function isEvidenceUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && value.length <= 2048; }
  catch { return false; }
}

export function validateRecipeApproval(input: RecipeApproval): void {
  if (input.action !== "approve_recipe" || !/^[A-Za-z0-9:_-]{12,128}$/.test(input.idempotency_key)
    || !input.kit_definition_id?.trim() || !input.event_id?.trim()
    || !["conversion", "recovery"].includes(input.direction) || !input.approval_reference?.trim()
    || !input.source_product_id?.trim() || !input.output_product_id?.trim() || input.source_product_id === input.output_product_id
    || !Array.isArray(input.packaging) || new Set(input.packaging.map((p) => p.product_id)).size !== input.packaging.length
    || input.packaging.some((p) => !p.product_id?.trim() || !Number.isSafeInteger(p.quantity) || p.quantity <= 0
      || !(input.direction === "conversion" ? p.disposition === "consume" : ["recover", "discard"].includes(p.disposition)))
    || !Array.isArray(input.evidence_urls) || input.evidence_urls.length < 1 || input.evidence_urls.length > 20
    || !input.evidence_urls.every(isEvidenceUrl)) throw new RecipeApprovalRejected("Complete the recipe, packaging decision, approval reference and HTTPS evidence.");
}

export function recipeServiceMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "Recipe service could not be reached.";
  return /schema cache|could not find the function|does not exist/i.test(message)
    ? "Stock conversion approval is unavailable until the governed service migration is released. No approval was submitted."
    : message;
}

export async function loadRecipeWorkspace(client: RecipeClient): Promise<RecipeWorkspace> {
  const { data, error } = await client.schema("warehouse").rpc("stock_conversion_recipe_workspace", { payload: {} });
  if (error) throw new Error(error.message);
  if (!data || !Array.isArray(data.kits) || !Array.isArray(data.events) || !Array.isArray(data.recipes)) throw new Error("Recipe workspace response was incomplete. Refresh to retry.");
  return data as RecipeWorkspace;
}

export async function approveStockRecipe(client: RecipeClient, input: RecipeApproval): Promise<void> {
  validateRecipeApproval(input);
  // Product can send only the recipe-approval DTO, never operational commands.
  const payload = {
    action: input.action, idempotency_key: input.idempotency_key, kit_definition_id: input.kit_definition_id,
    event_id: input.event_id, direction: input.direction, source_product_id: input.source_product_id,
    output_product_id: input.output_product_id, approval_reference: input.approval_reference,
    evidence_urls: [...input.evidence_urls], packaging: input.packaging.map(({ product_id, quantity, disposition }) => ({ product_id, quantity, disposition })),
  };
  const { data, error } = await client.schema("warehouse").rpc("execute_stock_conversion", { payload });
  if (error) {
    const ErrorType = ["P0001", "22P02", "23502", "23503", "23505", "23514", "42501"].includes(error.code) ? RecipeApprovalRejected : Error;
    throw new ErrorType(error.message);
  }
  if (!data?.id) throw new Error("Approval response was incomplete. Retry the saved approval to recover its result.");
}

import type { useSession } from '@intra/auth';

export interface ReplenishmentRequestBinding {
  id: string;
  productId: string;
  quantity: number;
  rationale: string;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseReplenishmentBinding(value: unknown, id: string): ReplenishmentRequestBinding {
  const r = value as Record<string, unknown> | null;
  if (!uuid.test(id) || !r || r.id !== id || r.status !== 'accepted' || r.procurement_request_id !== null ||
    typeof r.product_id !== 'string' || !r.product_id.trim() || typeof r.recommended_quantity !== 'number' ||
    !Number.isSafeInteger(r.recommended_quantity) || r.recommended_quantity <= 0 ||
    typeof r.rationale !== 'string' || !r.rationale.trim()) {
    throw new Error('An unlinked, accepted replenishment recommendation is required.');
  }
  return { id, productId: r.product_id, quantity: r.recommended_quantity, rationale: r.rationale };
}

export async function readAcceptedReplenishment(
  client: NonNullable<ReturnType<typeof useSession>['supabaseClient']>,
  id: string,
  expected?: ReplenishmentRequestBinding,
): Promise<ReplenishmentRequestBinding> {
  if (!uuid.test(id)) throw new Error('Invalid replenishment reference.');
  const { data, error } = await client.schema('procurement').from('replenishment_recommendations')
    .select('id,status,product_id,recommended_quantity,rationale,procurement_request_id').eq('id', id).single();
  if (error) throw new Error('The accepted replenishment could not be verified.');
  const binding = parseReplenishmentBinding(data, id);
  if (expected && (binding.id !== expected.id || binding.productId !== expected.productId ||
    binding.quantity !== expected.quantity || binding.rationale !== expected.rationale)) {
    throw new Error('The accepted replenishment changed. Reopen it before completing the request.');
  }
  return binding;
}

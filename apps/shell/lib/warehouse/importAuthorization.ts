import type { User } from '@supabase/supabase-js';
import type { ShellSupabaseClient } from '@shell/lib/supabase/types';

export class ImportAuthorizationError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function authorizeWarehouseImport(
  client: ShellSupabaseClient,
): Promise<User> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    throw new ImportAuthorizationError('Authentication required.', 401);
  }
  const { data: allowed, error: capabilityError } = await client
    .schema('core')
    .rpc('has_cap', { p_module: 'warehouse', p_cap: 'import_warehouse_data' });
  if (capabilityError) throw new ImportAuthorizationError(capabilityError.message, 502);
  if (allowed !== true) {
    throw new ImportAuthorizationError('Not authorized: warehouse.import_warehouse_data', 403);
  }
  return data.user;
}

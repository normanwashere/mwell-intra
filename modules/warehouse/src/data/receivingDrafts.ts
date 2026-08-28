/** Live-only receiving progress. Auth identity and inventory authority stay on the server. */
export type ReceivingDraftJson =
  | null | boolean | number | string
  | ReceivingDraftJson[] | { [key: string]: ReceivingDraftJson };

export interface ReceivingDraftBody {
  version: 1;
  [key: string]: ReceivingDraftJson;
}

export interface ReceivingDraftRecord {
  poId: string;
  body: ReceivingDraftBody | null;
  /** Optimistic revision, independent of body.version. Retained after deletion. */
  version: number;
  updatedAt: string | null;
}

export interface ReceivingDraftClient {
  schema(name: 'warehouse'): {
    rpc(name: string, args: Record<string, unknown>): PromiseLike<{
      data: unknown;
      error: { message: string; code?: string } | null;
    }>;
  };
}

export class ReceivingDraftError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'ReceivingDraftError';
  }
}

export class ReceivingDraftConflictError extends ReceivingDraftError {
  constructor(readonly currentVersion: number) {
    super('Receiving progress changed in another session. Reload before saving or discarding.', 'conflict');
    this.name = 'ReceivingDraftConflictError';
  }
}

const encoder = new TextEncoder();
const credentialKeys = new Set([
  'password', 'passwd', 'pwd', 'accesstoken', 'refreshtoken', 'secret',
  'clientsecret', 'apikey', 'authorization', 'servicerolekey',
]);
const invalid = (message: string): never => {
  throw new ReceivingDraftError(message, 'invalid_input');
};

function isObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Bounds match SQL; the server also checks its normalized JSONB byte size. */
export function validateReceivingDraftBody(body: unknown): asserts body is ReceivingDraftBody {
  if (!isObject(body) || body.version !== 1) invalid('Receiving draft document version 1 is required.');
  let nodes = 0;
  const ancestors = new Set<object>();
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > 10000 || depth > 16) invalid('Receiving draft is too complex.');
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) invalid('Receiving draft numbers must be finite.');
      return;
    }
    if (typeof value === 'string') {
      if (encoder.encode(value).length > 8192 || value.includes('\u0000')) {
        invalid('Receiving draft contains an invalid or oversized string.');
      }
      return;
    }
    if (!Array.isArray(value) && !isObject(value)) invalid('Receiving draft must contain only JSON values.');
    const container = value as object;
    if (ancestors.has(container)) invalid('Receiving draft cannot contain circular references.');
    ancestors.add(container);
    if (Array.isArray(value)) {
      if (value.length > 1000) invalid('Receiving draft arrays may contain at most 1000 items.');
      for (const item of value) visit(item, depth + 1);
    } else {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length > 128) invalid('Receiving draft objects may contain at most 128 fields.');
      for (const [key, item] of entries) {
        if (encoder.encode(key).length > 128 || key.includes('\u0000')) invalid('Receiving draft field name is invalid.');
        if (credentialKeys.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
          invalid('Credentials must not be stored in receiving drafts.');
        }
        visit(item, depth + 1);
      }
    }
    ancestors.delete(container);
  };
  visit(body, 0);
  if (encoder.encode(JSON.stringify(body)).length > 65536) invalid('Receiving draft exceeds 64 KiB.');
}

function validatePoId(poId: string): void {
  if (typeof poId !== 'string' || !poId.trim() || poId.includes('\u0000') || encoder.encode(poId).length > 256) {
    invalid('A valid receiving draft PO identifier is required.');
  }
}

function isVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2147483647;
}

function validateExpectedVersion(version: number): void {
  if (!isVersion(version) || version === 2147483647) invalid('A valid expected receiving draft version is required.');
}

async function command(
  client: ReceivingDraftClient,
  name: string,
  poId: string,
  args: Record<string, unknown>,
): Promise<ReceivingDraftRecord> {
  validatePoId(poId);
  const { data, error } = await client.schema('warehouse').rpc(name, { p_po_id: poId, ...args });
  if (error) throw new ReceivingDraftError(error.message, error.code ?? 'rpc_error');
  if (isObject(data) && data.status === 'conflict' && isVersion(data.current_version)) {
    throw new ReceivingDraftConflictError(data.current_version);
  }
  if (!isObject(data) || data.status !== 'ok' || data.po_id !== poId || !isVersion(data.version)
    || !(data.updated_at === null || (typeof data.updated_at === 'string' && Number.isFinite(Date.parse(data.updated_at))))
    || (data.version === 0 && (data.body !== null || data.updated_at !== null))
    || (data.version > 0 && data.updated_at === null)) {
    throw new ReceivingDraftError('The receiving draft service returned an invalid record.', 'invalid_response');
  }
  if (data.body !== null) {
    try {
      validateReceivingDraftBody(data.body);
    } catch {
      throw new ReceivingDraftError('The receiving draft service returned an invalid document.', 'invalid_response');
    }
  }
  return { poId, body: data.body as ReceivingDraftBody | null, version: data.version, updatedAt: data.updated_at };
}

/** Missing draft: body=null, version=0, updatedAt=null. Discards retain a positive version. */
export function loadReceivingDraft(client: ReceivingDraftClient, poId: string): Promise<ReceivingDraftRecord> {
  return command(client, 'load_receiving_draft', poId, {});
}

export async function saveReceivingDraft(
  client: ReceivingDraftClient,
  poId: string,
  body: ReceivingDraftBody,
  expectedVersion: number,
): Promise<ReceivingDraftRecord> {
  validateReceivingDraftBody(body);
  validateExpectedVersion(expectedVersion);
  return command(client, 'save_receiving_draft', poId, { p_body: body, p_expected_version: expectedVersion });
}

/** Clear progress only after any receipt succeeds. A stale delete must never be retried blindly. */
export async function deleteReceivingDraft(
  client: ReceivingDraftClient,
  poId: string,
  expectedVersion: number,
): Promise<ReceivingDraftRecord> {
  validateExpectedVersion(expectedVersion);
  return command(client, 'delete_receiving_draft', poId, { p_expected_version: expectedVersion });
}

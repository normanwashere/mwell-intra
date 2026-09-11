export interface AuditRow {
  id: number;
  module: string | null;
  entity_type: string | null;
  entity_id: string | null;
  action: string | null;
  actor: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditQuery {
  query: string;
  module: string;
  from: string;
  to: string;
  before: number | null;
  snapshot: number | null;
}

export interface AuditPage {
  rows: AuditRow[];
  actors: Record<string, string>;
  next: number | null;
  snapshot: number | null;
  searchPending: boolean;
  scanned: number;
}

export const AUDIT_PAGE_SIZE = 50;
export const AUDIT_BATCH_SIZE = 250;
export const AUDIT_BATCH_BUDGET = 8;

export function parseAuditQuery(params: URLSearchParams): AuditQuery {
  const query = (params.get('q') ?? '').trim();
  const module = params.get('module') ?? '';
  const date = (key: string) => {
    const value = params.get(key) ?? '';
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) {
      throw new Error('Choose a valid date range.');
    }
    return value;
  };
  const cursor = (key: string) => {
    const value = params.get(key);
    if (value === null) return null;
    const number = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1) throw new Error('Invalid audit cursor.');
    return number;
  };
  if (query.length > 200 || module.length > 80 || [...query + module].some(character => character.charCodeAt(0) < 32)) throw new Error('Invalid audit filter.');
  const from = date('from');
  const to = date('to');
  if (from && to && from > to) throw new Error('Start date must not follow end date.');
  return { query, module, from, to, before: cursor('before'), snapshot: cursor('snapshot') };
}

// These readers must use the caller's session. A cursor is a position, never authority.
export interface AuditReader {
  events: (query: AuditQuery) => Promise<AuditRow[]>;
  actors: (ids: string[]) => Promise<Record<string, string>>;
}

function detailSearchText(value: unknown): string {
  if (Array.isArray(value)) return value.map(detailSearchText).join(' ');
  if (value && typeof value === 'object') return Object.entries(value).map(([key, child]) => `${key} ${detailSearchText(child)}`).join(' ');
  return String(value ?? '');
}

export async function readAuditPage(reader: AuditReader, query: AuditQuery): Promise<AuditPage> {
  const rows: AuditRow[] = [];
  const actors: Record<string, string> = {};
  const needle = query.query.toLocaleLowerCase();
  let before = query.before;
  let snapshot = query.snapshot;
  let scanned = 0;
  // Search all retained authorized batches, not just the first displayed page.
  // Literal matching avoids interpreting SQL/PostgREST operators or LIKE wildcards.
  for (let batchIndex = 0; batchIndex < AUDIT_BATCH_BUDGET; batchIndex++) {
    const batch = await reader.events({ ...query, before, snapshot });
    const firstRow = batch[0];
    const lastRow = batch[batch.length - 1];
    if (!firstRow || !lastRow) return { rows, actors, next: null, snapshot, searchPending: false, scanned };
    snapshot ??= firstRow.id;
    const names = await reader.actors([...new Set(batch.flatMap(row => row.actor ? [row.actor] : []))]);
    for (const row of batch) {
      scanned++;
      const haystack = [row.module, row.entity_type, row.entity_id, row.action,
        row.actor, names[row.actor ?? ''], detailSearchText(row.detail), JSON.stringify(row.detail ?? {})].join(' ').toLocaleLowerCase();
      if (needle && !haystack.includes(needle)) continue;
      const lastMatch = rows[rows.length - 1];
      if (rows.length === AUDIT_PAGE_SIZE && lastMatch) return { rows, actors, next: lastMatch.id, snapshot, searchPending: false, scanned };
      rows.push(row);
      const name = row.actor ? names[row.actor] : undefined;
      if (row.actor && name) actors[row.actor] = name;
    }
    const last = lastRow.id;
    if (before !== null && last >= before) throw new Error('Audit cursor did not advance.');
    before = last;
  }
  return { rows, actors, next: before, snapshot, searchPending: true, scanned };
}

export function auditPageCsv(page: AuditPage): string {
  const escape = (value: unknown) => {
    let text = String(value ?? '');
    // Quoting alone does not stop spreadsheet formula execution.
    if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [
    ['Time', 'Module', 'Action', 'Entity', 'Actor', 'Detail'],
    ...page.rows.map(row => [row.created_at, row.module, row.action,
      `${row.entity_type}:${row.entity_id}`, page.actors[row.actor ?? ''] ?? row.actor, JSON.stringify(row.detail ?? {})]),
  ].map(row => row.map(escape).join(',')).join('\r\n');
}

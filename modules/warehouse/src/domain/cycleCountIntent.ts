import type { CreateAndSubmitCycleCountInput, DataSource } from '@intra/data-kit';

export type CycleCountCommand = CreateAndSubmitCycleCountInput & {
  cycleCountId: string;
  requesterId: string;
};

export function cycleCountIntentKey(source: DataSource, identityId: string): string {
  return `warehouse.cycle-count-intent.v1:${source}:${encodeURIComponent(identityId)}`;
}

const invalid = () => new Error('Saved count could not be verified. Keep this browser data and contact support; no new count was sent.');

export function readCycleCountIntent(key: string): CycleCountCommand | null {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  return parseCycleCountIntent(key, raw);
}

function parseCycleCountIntent(key: string, raw: string): CycleCountCommand {
  try {
    const saved = JSON.parse(raw);
    const c = saved.command;
    if (saved.version !== 1 || !c || typeof c.cycleCountId !== 'string' || !c.cycleCountId.startsWith('cc-')
      || typeof c.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{12,128}$/.test(c.idempotencyKey)
      || typeof c.requesterId !== 'string' || !key.endsWith(`:${encodeURIComponent(c.requesterId)}`)
      || typeof c.actor !== 'string' || !c.actor || typeof c.locationId !== 'string' || !c.locationId
      || (c.binId !== undefined && typeof c.binId !== 'string')
      || !['merchandise', 'device'].includes(c.category) || typeof c.reason !== 'string'
      || !Array.isArray(c.evidenceUrls) || !c.evidenceUrls.length || !c.evidenceUrls.every((url: unknown) => typeof url === 'string' && url.length > 0)
      || !Array.isArray(c.lines) || !c.lines.length || !c.lines.every((line: CycleCountCommand['lines'][number]) =>
        line && typeof line.productId === 'string' && Number.isSafeInteger(line.expected) && line.expected >= 0
        && Number.isSafeInteger(line.counted) && line.counted >= 0
        && (line.serialNumbers === undefined || (Array.isArray(line.serialNumbers) && line.serialNumbers.every(serial => typeof serial === 'string')
          && line.serialNumbers.length === line.counted && new Set(line.serialNumbers).size === line.serialNumbers.length))
        && (line.lotCounts === undefined || (Array.isArray(line.lotCounts) && line.lotCounts.length > 0
          && line.lotCounts.every(lot => lot && (lot.lotId === null || typeof lot.lotId === 'string')
            && Number.isSafeInteger(lot.counted) && lot.counted >= 0)
          && new Set(line.lotCounts.map(lot => lot.lotId)).size === line.lotCounts.length
          && line.lotCounts.reduce((sum, lot) => sum + lot.counted, 0) === line.counted)))) {
      throw invalid();
    }
    return c;
  } catch {
    throw invalid();
  }
}

/** Store before any network attempt; never replace an unresolved command. */
export function retainCycleCountIntent(key: string, command: CycleCountCommand): CycleCountCommand {
  const retained = readCycleCountIntent(key);
  const raw = JSON.stringify({ version: 1, command });
  const copy = parseCycleCountIntent(key, raw);
  if (retained && JSON.stringify(retained) !== JSON.stringify(copy)) {
    throw new Error('A different saved count is unresolved. Reload to reconcile it before starting another count.');
  }
  if (!retained) localStorage.setItem(key, raw);
  const verified = readCycleCountIntent(key);
  if (!verified || JSON.stringify(verified) !== JSON.stringify(copy)) throw invalid();
  return verified;
}

export function completeCycleCountIntent(key: string, command: CycleCountCommand): void {
  const retained = readCycleCountIntent(key);
  if (!retained || JSON.stringify(retained) !== JSON.stringify(command)) throw invalid();
  localStorage.removeItem(key);
}

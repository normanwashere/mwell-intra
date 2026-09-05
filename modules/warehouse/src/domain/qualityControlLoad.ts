import type { InventoryHold, PageQuery, PageResult, QualityInspection, VendorReturn } from '@intra/data-kit';
import { loadCompleteControlQueue } from './controlQueues';

// Match the warehouse bootstrap deadline, independently of test wait limits.
export const QUALITY_CONTROL_LOAD_TIMEOUT_MS = 12_000;

export interface QualityControlLoaders {
  inspections: (query: PageQuery) => Promise<PageResult<QualityInspection>>;
  holds: (query: PageQuery) => Promise<PageResult<InventoryHold>>;
  vendorReturns: (query: PageQuery) => Promise<PageResult<VendorReturn>>;
}

export function loadQualityControlPopulation(loaders: QualityControlLoaders, signal: AbortSignal) {
  return new Promise<[QualityInspection[], InventoryHold[], VendorReturn[]]>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, result?: [QualityInspection[], InventoryHold[], VendorReturn[]]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(new Error('Quality queue load was cancelled.'));
    const timer = setTimeout(() => finish(new Error(
      'Quality controls are taking longer than expected. Check your connection and retry the quality queue.',
    )), QUALITY_CONTROL_LOAD_TIMEOUT_MS);
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    const complete = <T>(load: (query: PageQuery) => Promise<PageResult<T>>) =>
      loadCompleteControlQueue(async (query) => {
        if (settled) throw new Error('Quality queue load was cancelled.');
        const page = await load(query);
        // Repository reads cannot currently be aborted; stop further pages after invalidation.
        if (settled) throw new Error('Quality queue load was cancelled.');
        return page;
      });
    void Promise.all([
      complete(loaders.inspections), complete(loaders.holds), complete(loaders.vendorReturns),
    ]).then((result) => finish(undefined, result), (error: unknown) => finish(
      error instanceof Error ? error : new Error('Quality controls could not be loaded.'),
    ));
  });
}

// Demo-data lifecycle helpers (memory mode only).
//
// Every module persists its demo dataset in localStorage under a stable
// prefix. Reset = remove them all + reload; each store reseeds itself on the
// next mount (procurement/legal via ensure*Seed, warehouse via buildSeed).

const DEMO_KEY_PREFIXES = [
  'mwell-intra-warehouse:data', // warehouse snapshot (any version)
  'intra.procurement.', // requests / POs / approvals / seeded flag
  'intra.legal.', // cases / checklist / docs / timeline / invites / flags
] as const;

/** Remove all module demo data and hard-reload so stores reseed fresh. */
export function resetDemoData(): void {
  if (typeof window === 'undefined') return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && DEMO_KEY_PREFIXES.some((p) => key.startsWith(p))) {
        doomed.push(key);
      }
    }
    for (const key of doomed) window.localStorage.removeItem(key);
  } catch {
    /* storage disabled — reload still gives a clean in-memory run */
  }
  window.location.reload();
}

// Procurement module loading fallback (spec §1). Same chromeless skeleton as
// warehouse / legal / vendor so navigation between modules feels uniform.

import { ModuleLoadingSkeleton } from '@shell/components/ModuleLoadingSkeleton';

export default function ProcurementLoading() {
  return <ModuleLoadingSkeleton label="Loading procurement module…" />;
}

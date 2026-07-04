// Warehouse module loading fallback (spec §1). The warehouse mount is
// chromeless from the shell's perspective, so we paint a full-viewport skeleton
// that approximates the module's own AppShell — avoids a blank flash while the
// dynamic bundle for @intra/warehouse resolves.

import { ModuleLoadingSkeleton } from '@shell/components/ModuleLoadingSkeleton';

export default function WarehouseLoading() {
  return <ModuleLoadingSkeleton label="Loading warehouse module…" />;
}

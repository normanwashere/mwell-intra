// Vendor portal loading fallback (spec §1, ADR-002 #3). Mirrors the internal
// legal module skeleton so external vendors see the same polish.

import { ModuleLoadingSkeleton } from '@shell/components/ModuleLoadingSkeleton';

export default function VendorLoading() {
  return <ModuleLoadingSkeleton label="Loading vendor portal…" />;
}

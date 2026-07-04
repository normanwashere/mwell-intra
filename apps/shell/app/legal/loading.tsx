// Legal module loading fallback (spec §1). Chromeless skeleton for the shared
// LegalApp mount that internal legal_reviewer / compliance / admin users hit.

import { ModuleLoadingSkeleton } from '@shell/components/ModuleLoadingSkeleton';

export default function LegalLoading() {
  return <ModuleLoadingSkeleton label="Loading legal module…" />;
}

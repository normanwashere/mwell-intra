'use client';

// Procurement module route — gated placeholder. Requests → RFP → PO → approvals
// arrive in Step 3. Gated on `procurement:view_dashboard` (spec §4.2).

import { Guard } from '@intra/auth';
import { ModulePlaceholder } from '@/components/ModulePlaceholder';

export default function ProcurementPage() {
  return (
    <Guard module="procurement" cap="view_dashboard">
      <ModulePlaceholder
        title="Procurement"
        subtitle="Requests, RFPs, purchase orders & approvals."
        step="Step 3"
        icon="cart"
        bullets={[
          'Raise and track purchase requests',
          'Run RFPs and author purchase orders',
          'Award gated on vendor accreditation',
        ]}
      />
    </Guard>
  );
}

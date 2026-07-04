'use client';

// Warehouse module route — gated placeholder. The full parity port (offline
// PWA) lands in Step 2. Gated on `warehouse:view_dashboard` (spec §4.2).

import { Guard } from '@intra/auth';
import { ModulePlaceholder } from '@/components/ModulePlaceholder';

export default function WarehousePage() {
  return (
    <Guard module="warehouse" cap="view_dashboard">
      <ModulePlaceholder
        title="Warehouse"
        subtitle="Inventory, receiving, allocations & returns."
        step="Step 2"
        icon="box"
        bullets={[
          'Receiving, tagging & serialized tracking',
          'Allocations, issues & inter-site transfers',
          'Cycle counts, returns & offline-first PWA sync',
        ]}
      />
    </Guard>
  );
}

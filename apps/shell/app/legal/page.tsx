'use client';

// Legal module route — gated placeholder. Accreditation cases & document review
// arrive in Step 3. Gated on `legal:view_dashboard` (spec §4.2).

import { Guard } from '@intra/auth';
import { ModulePlaceholder } from '@/components/ModulePlaceholder';

export default function LegalPage() {
  return (
    <Guard module="legal" cap="view_dashboard">
      <ModulePlaceholder
        title="Legal"
        subtitle="Vendor accreditation & document review."
        step="Step 3"
        icon="clipboard"
        bullets={[
          'Review accreditation cases & checklists',
          'Approve vendor lifecycle status',
          'Manage compliance documents',
        ]}
      />
    </Guard>
  );
}

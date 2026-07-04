'use client';

// External vendor-tier route — gated placeholder. Vendors are `kind='vendor'`
// profiles whose RLS scopes every row to their own vendor_id (spec §5). Gated
// on the core `submit_documents` capability held by `core:vendor_portal`.

import { Guard } from '@intra/auth';
import { ModulePlaceholder } from '@/components/ModulePlaceholder';

export default function VendorPage() {
  return (
    <Guard module="core" cap="submit_documents">
      <ModulePlaceholder
        title="Vendor Portal"
        subtitle="Submit accreditation & documents for your organization."
        step="Step 3"
        icon="building"
        bullets={[
          'Submit accreditation requirements',
          'Upload and track required documents',
          'See only your own organization (RLS-scoped)',
        ]}
      />
    </Guard>
  );
}

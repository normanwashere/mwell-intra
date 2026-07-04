'use client';

// External vendor portal — mounts @intra/legal under `/vendor/*` for
// `kind='vendor'` sessions (spec §5, ADR-002 #3). LegalApp internally routes
// vendor-tier users to their own accreditation views (RLS-scoped by vendor_id).

import { LegalApp } from '@intra/legal';

export default function VendorCatchAllPage() {
  return <LegalApp basename="/vendor" />;
}

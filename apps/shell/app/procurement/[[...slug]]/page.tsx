'use client';

// Procurement module catch-all — mounts @intra/procurement under `/procurement/*`.
// Client routing is owned by react-router inside ProcurementApp (spec §13 Step 3a).

import { ProcurementApp } from '@intra/procurement';

export default function ProcurementCatchAllPage() {
  return <ProcurementApp basename="/procurement" />;
}

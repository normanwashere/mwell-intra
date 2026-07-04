'use client';

// Legal module catch-all — mounts @intra/legal under `/legal/*` for internal
// legal_reviewer/compliance/admin users (spec §13 Step 3b).

import { LegalApp } from '@intra/legal';

export default function LegalCatchAllPage() {
  return <LegalApp basename="/legal" />;
}

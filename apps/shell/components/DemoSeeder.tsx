'use client';

// Seeds the procurement + legal demo datasets on first load (memory mode
// only), so the home dashboard badges and module lists light up before the
// user ever opens a module. Renders nothing.
//
// The warehouse module needs no equivalent: its repository builds the full
// seed lazily on first read.

import { useEffect } from 'react';
import { useSession } from '@intra/auth';
import { ensureProcurementSeed } from '@intra/procurement';
import { ensureLegalSeed } from '@intra/legal';

export function DemoSeeder() {
  const { mode, loading } = useSession();

  useEffect(() => {
    if (loading || mode !== 'memory') return;
    ensureProcurementSeed();
    ensureLegalSeed();
  }, [loading, mode]);

  return null;
}

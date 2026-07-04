'use client';

// Warehouse module catch-all — mounts the full offline PWA under `/warehouse/*`.
// Client routing is owned by react-router inside WarehouseApp (spec §12 step 2).

import { WarehouseApp } from '@intra/warehouse';

export default function WarehouseCatchAllPage() {
  return <WarehouseApp basename="/warehouse" />;
}

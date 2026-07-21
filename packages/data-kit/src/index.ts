// @intra/data-kit — runtime-agnostic warehouse data layer (Step 1d).
//
// Ported from `mwell-intra-warehouse/src/data/*` + the `runAction` pipeline in
// `src/app/store.tsx`. Carries the offline guarantees (outbox + optimistic
// overlay) with zero React / Vite coupling so the warehouse module can reuse it
// on Next.js (spec §12 step 2; LLD §5 Ports & Adapters, §6 runAction, §7 Offline).

// --- Domain entity types (self-contained source of truth for data-kit) ---
export * from "./domain/types";

// --- Pure domain helpers the data layer depends on ---
export * from "./domain/stock";
export * from "./domain/allocations";
export * from "./domain/transfers";
export * from "./domain/purchaseOrders";
export * from "./domain/products";
export * from "./domain/storage";
export * from "./domain/warehouseControls";
export * from "./domain/wms";
export * from "./domain/imports";
export * from "./domain/metrics";

// --- Repository PORT + input DTOs + WarehouseData read model + toStockState ---
export * from "./repository";

// --- Adapters + factory ---
export * from "./inMemoryRepository";
export * from "./createRepository";

// --- Demo seed / profiles ---
export * from "./seed";

// --- Offline outbox (IndexedDB queue + WarehousePatch overlay type) ---
export * from "./outbox";

// --- Framework-agnostic mutation pipeline: runAction, replay/sync, applyOverlay,
//     isNetworkError, and the pure optimistic-overlay builders ---
export * from "./runAction";

// --- Live Supabase adapter (opt-in subpath) ---
// Kept as a subpath (not re-exported here) so callers that don't need Supabase
// don't pull the SDK into their bundle:
//   import { createSupabaseWarehouseRepository } from '@intra/data-kit/supabase';

// --- Live Supabase adapter (SupabaseRepository, factory, mappers, evidence helpers).
//     RPCs live in the `warehouse` schema and gate on `core.has_cap('warehouse', ...)`
//     (spec §4.2 / ADR-004 / `20260706092400_warehouse_rpcs.sql`). Client construction
//     is the host's responsibility — pass the client to `createRepository` or use
//     `createSupabaseWarehouseRepository(client)` directly. ---
export * from "./supabase";

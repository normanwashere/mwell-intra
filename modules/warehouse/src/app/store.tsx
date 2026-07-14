'use client';

// WarehouseProvider — the React binding over the framework-agnostic data-kit
// pipeline (spec §12 step 2, LLD §6/§7).
//
// In the source app this component OWNED the mutation pipeline (runAction,
// replay/sync, applyOverlay, and every optimistic overlay builder). Step 1d
// extracted all of that into `@intra/data-kit` as PURE functions whose side
// effects are injected. This provider is now a thin React seam: it wires
// `setData` → `applyOptimistic`, `useToast` → notifications, and the IndexedDB
// outbox counters → React state, then delegates to `runAction`/`syncNow`.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useToast } from '@intra/ui';
import {
  applyOverlay,
  createRepository,
  runAction as dkRunAction,
  syncNow as dkSyncNow,
  receiveOverlay,
  issueOverlay,
  returnOverlay,
  transferOverlay,
  relocateOverlay,
  adjustOverlay,
  allConflicts,
  allPending,
  pendingCount as outboxPendingCount,
  removeEntry as outboxRemove,
  DATA_STORAGE_KEY,
} from '@intra/data-kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AdjustStockInput,
  CancelAllocationInput,
  CancelPurchaseOrderInput,
  CreateEventInput,
  CreateVendorReturnInput,
  CreateLocationInput,
  CreateProductInput,
  CreatePurchaseOrderInput,
  CreateStorageAreaInput,
  CreateSupplierInput,
  CycleCountInput,
  DataSource,
  DecideStockChangeInput,
  InspectQualityInput,
  InventoryHold,
  InventoryPosition,
  IssueInput,
  OutboxEntry,
  QueueableMethod,
  PageQuery,
  PageResult,
  ReceiveAgainstPOInput,
  ReceiveStockInput,
  ReceiveProcurementPOInput,
  ProcurementPOHandoff,
  ReleaseHoldInput,
  ResolveExceptionInput,
  RelocateInput,
  ReserveInput,
  ReturnInput,
  Role,
  SetProductPriceInput,
  TransferInput,
  UpdateLocationInput,
  UpdateOperationRouteInput,
  UpdateProductInput,
  UpdateStorageAreaInput,
  UpdateSupplierInput,
  WarehouseData,
  WarehouseControlRepository,
  WarehouseException,
  WarehousePatch,
  WarehouseTask,
  VendorReturn,
  QualityInspection,
  StockChangeRequest,
  SubmitCycleCountInput,
} from '@intra/data-kit';
import {
  can as roleCan,
  ROLES,
  type Capability,
} from '@/auth/roles';
import {
  canOpenWarehouseRoute,
  STOCK_CHANGE_DECISION_CAPABILITIES,
  WAREHOUSE_MUTATION_CAPABILITIES,
} from '@/app/authorization';
import type { WarehouseRouteId } from '@/app/modules';

interface WarehouseContextValue {
  data: WarehouseData | null;
  loading: boolean;
  error: string | null;
  source: DataSource;
  /** Presentation metadata only; never authoritative in Supabase mode. */
  role: Role;
  roleCode: string;
  roleLabel: string;
  roleDescription: string;
  setRole: (role: Role) => void;
  capabilities: readonly Capability[];
  can: (capability: Capability) => boolean;
  canOpenRoute: (routeId: WarehouseRouteId) => boolean;
  actor: string;
  identityId: string;
  refresh: () => Promise<void>;
  /** Number of floor-op mutations queued offline, awaiting sync. */
  pendingSync: number;
  /** Conflicted outbox entries the user can retry or discard. */
  conflicts: OutboxEntry[];
  /** Discard a conflicted entry from the outbox. */
  discardConflict: (id: string) => Promise<void>;
  /** Manually trigger a replay of the outbox (e.g. user taps "Sync now"). */
  syncNow: () => Promise<void>;
  /**
   * Mutations resolve to `true` only after a real commit (or after being safely
   * queued for offline sync). On a hard failure they show an error toast and
   * resolve to `false` so callers never run success UI on top of a lost write.
   */
  receiveStock: (input: Omit<ReceiveStockInput, 'actor'>) => Promise<boolean>;
  reserve: (input: Omit<ReserveInput, 'actor'>) => Promise<boolean>;
  issue: (input: Omit<IssueInput, 'actor'>) => Promise<boolean>;
  recordReturn: (input: Omit<ReturnInput, 'actor'>) => Promise<boolean>;
  recordCycleCount: (input: Omit<CycleCountInput, 'actor'>) => Promise<boolean>;
  submitNewCycleCount: (
    input: Omit<CycleCountInput, 'actor'> &
      Pick<SubmitCycleCountInput, 'reason' | 'evidenceUrls'>,
  ) => Promise<boolean>;
  transfer: (input: Omit<TransferInput, 'actor'>) => Promise<boolean>;
  createPurchaseOrder: (
    input: Omit<CreatePurchaseOrderInput, 'actor'>,
  ) => Promise<boolean>;
  receiveAgainstPO: (
    input: Omit<ReceiveAgainstPOInput, 'actor'>,
  ) => Promise<boolean>;
  cancelPurchaseOrder: (
    input: Omit<CancelPurchaseOrderInput, 'actor'>,
  ) => Promise<boolean>;
  createEvent: (input: CreateEventInput) => Promise<boolean>;
  cancelAllocation: (
    input: Omit<CancelAllocationInput, 'actor'>,
  ) => Promise<boolean>;
  createSupplier: (input: CreateSupplierInput) => Promise<boolean>;
  updateSupplier: (input: UpdateSupplierInput) => Promise<boolean>;
  createLocation: (input: CreateLocationInput) => Promise<boolean>;
  updateLocation: (input: UpdateLocationInput) => Promise<boolean>;
  deleteLocation: (input: { locationId: string }) => Promise<boolean>;
  createStorageArea: (input: CreateStorageAreaInput) => Promise<boolean>;
  updateStorageArea: (input: UpdateStorageAreaInput) => Promise<boolean>;
  deleteStorageArea: (input: { storageAreaId: string }) => Promise<boolean>;
  relocate: (input: Omit<RelocateInput, 'actor'>) => Promise<boolean>;
  setProductPrice: (
    input: Omit<SetProductPriceInput, 'actor'>,
  ) => Promise<boolean>;
  createProduct: (input: Omit<CreateProductInput, 'actor'>) => Promise<boolean>;
  updateProduct: (input: Omit<UpdateProductInput, 'actor'>) => Promise<boolean>;
  adjustStock: (input: Omit<AdjustStockInput, 'actor'>) => Promise<boolean>;
  loadQualityInspections: (query: PageQuery) => Promise<PageResult<QualityInspection>>;
  loadHolds: (query: PageQuery) => Promise<PageResult<InventoryHold>>;
  loadVendorReturns: (query: PageQuery) => Promise<PageResult<VendorReturn>>;
  loadExceptions: (query: PageQuery) => Promise<PageResult<WarehouseException>>;
  loadStockChangeRequests: (query: PageQuery) => Promise<PageResult<StockChangeRequest>>;
  loadWarehouseTasks: (query: PageQuery) => Promise<PageResult<WarehouseTask>>;
  loadInventoryPositions: (query: PageQuery) => Promise<PageResult<InventoryPosition>>;
  inspectQuality: (input: InspectQualityInput) => Promise<boolean>;
  releaseHold: (input: ReleaseHoldInput) => Promise<boolean>;
  createVendorReturn: (input: CreateVendorReturnInput) => Promise<boolean>;
  updateOperationRoute: (input: UpdateOperationRouteInput) => Promise<boolean>;
  submitCycleCount: (input: SubmitCycleCountInput) => Promise<boolean>;
  decideStockChange: (input: DecideStockChangeInput) => Promise<boolean>;
  resolveException: (input: ResolveExceptionInput) => Promise<boolean>;
  loadReceivableProcurementPOs: () => Promise<ProcurementPOHandoff[]>;
  receiveProcurementPO: (input: ReceiveProcurementPOInput) => Promise<boolean>;
  /** Demo-only: clear the local dataset and reload with the fresh seed. */
  resetDemo: () => void;
}

const WarehouseContext = createContext<WarehouseContextValue | null>(null);

export const ROLE_KEY = 'mwell-intra-warehouse:role';

/**
 * The UI role is derived ONLY from the authenticated profile (JWT app_metadata
 * in Supabase mode, or the demo tile in memory mode). We intentionally do NOT
 * fall back to a `localStorage` value here — trusting a stored role would let a
 * user unlock routes/modules for a role their JWT doesn't carry.
 */
function loadInitialRole(initial: Role): Role {
  return initial;
}

export function WarehouseProvider({
  children,
  repo: injectedRepo,
  source: injectedSource,
  supabaseClient,
  initialRole = 'logistics_supervisor',
  roleCode: providedRoleCode,
  capabilities: providedCapabilities,
  actor: providedActor,
  identityId: providedIdentityId,
}: {
  children: ReactNode;
  repo?: WarehouseControlRepository;
  source?: DataSource;
  supabaseClient?: SupabaseClient<Record<string, unknown>, string>;
  initialRole?: Role;
  /** Runtime bundle code used only for display and audit context. */
  roleCode?: string;
  /** Fresh core.my_capabilities() projection for live authorization. */
  capabilities?: readonly Capability[];
  /** Overrides the default `${role}@mwell` actor (e.g. the signed-in user's email). */
  actor?: string;
  /** Auth profile id used for separation-of-duties comparisons. */
  identityId?: string;
}) {
  const created = useRef<{ repo: WarehouseControlRepository; source: DataSource } | null>(
    null,
  );
  if (!created.current) {
    created.current = injectedRepo
      ? { repo: injectedRepo, source: injectedSource ?? 'memory' }
      : createRepository({
          dataSource: injectedSource,
          supabaseClient,
        });
  }
  const repo = created.current.repo;
  const source = created.current.source;
  const toast = useToast();

  const [data, setData] = useState<WarehouseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRoleState] = useState<Role>(() => loadInitialRole(initialRole));
  const [pendingSync, setPendingSync] = useState(0);
  const [conflicts, setConflicts] = useState<OutboxEntry[]>([]);

  const actor = useMemo(
    () => providedActor ?? `${role}@mwell`,
    [providedActor, role],
  );
  const identityId = providedIdentityId ?? actor;
  const roleCode = providedRoleCode ?? role;
  const roleProfile = ROLES[role];
  const roleLabel =
    roleCode === role
      ? roleProfile.label
      : roleCode
          .split('_')
          .filter(Boolean)
          .map((part) => part[0]?.toUpperCase() + part.slice(1))
          .join(' ');
  const roleDescription =
    roleCode === role
      ? roleProfile.description
      : 'Runtime Warehouse access bundle managed by an administrator.';
  const capabilities = useMemo<readonly Capability[]>(
    () =>
      source === 'supabase'
        ? Array.from(new Set(providedCapabilities ?? []))
        : [...roleProfile.capabilities],
    [providedCapabilities, roleProfile.capabilities, source],
  );
  const capabilitySet = useMemo(() => new Set(capabilities), [capabilities]);
  const can = useCallback(
    (capability: Capability) =>
      source === 'supabase'
        ? capabilitySet.has(capability)
        : roleCan(role, capability),
    [capabilitySet, role, source],
  );

  const refreshPending = useCallback(async () => {
    setPendingSync(await outboxPendingCount());
    setConflicts(await allConflicts());
  }, []);

  // Only the very first load shows the full-screen loader. Post-mutation
  // refreshes update data silently so pages keep their local UI state.
  const refresh = useCallback(async () => {
    try {
      setData(await repo.getData());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data.');
    } finally {
      setLoading(false);
    }
  }, [repo]);

  useEffect(() => {
    void refresh();
    void refreshPending();
  }, [refresh, refreshPending]);

  // In-memory only: role is authoritative from the signed-in profile, so we
  // never persist it to localStorage (that would reintroduce a spoof vector).
  const setRole = useCallback((next: Role) => {
    setRoleState(next);
  }, []);

  /** Replay all pending entries in FIFO order, then refresh. */
  const syncNow = useCallback(async () => {
    const pending = await allPending();
    await dkSyncNow({ repo, actor, pending, refresh, refreshPending });
  }, [repo, actor, refresh, refreshPending]);

  // Replay on reconnect and once on mount (in case the app was closed offline).
  useEffect(() => {
    if (source !== 'supabase') return;
    const onOnline = () => void syncNow();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline);
      void syncNow();
      return () => window.removeEventListener('online', onOnline);
    }
  }, [source, syncNow]);

  const discardConflict = useCallback(
    async (id: string) => {
      await outboxRemove(id);
      await refreshPending();
    },
    [refreshPending],
  );

  /**
   * Runs a mutation via the data-kit pipeline. Queueable floor ops that fail
   * with a network error while in Supabase mode are enqueued + optimistically
   * overlaid (call resolves `true`); other failures toast + resolve `false`.
   */
  const runAction = useCallback(
    (
      method: QueueableMethod | 'other',
      fn: () => Promise<unknown>,
      overlay?: WarehousePatch,
      queueInput?: Record<string, unknown>,
    ): Promise<boolean> =>
      dkRunAction(
        {
          source,
          applyOptimistic: (o) =>
            setData((prev) => (prev ? applyOverlay(prev, o) : prev)),
          refresh,
          refreshPending,
          notifyQueuedOffline: (m) => toast.toast(m, 'info'),
          notifyError: (m) => toast.error(m),
        },
        method,
        fn,
        overlay,
        queueInput,
      ),
    [source, refresh, refreshPending, toast],
  );

  const runAuthorizedAction = useCallback(
    (
      required: Capability | readonly Capability[],
      method: QueueableMethod | 'other',
      fn: () => Promise<unknown>,
      overlay?: WarehousePatch,
      queueInput?: Record<string, unknown>,
    ): Promise<boolean> => {
      const requiredCapabilities = Array.isArray(required) ? required : [required];
      if (source === 'supabase' && !requiredCapabilities.some(can)) {
        toast.error(`Not authorized: warehouse.${requiredCapabilities.join('|')}`);
        return Promise.resolve(false);
      }
      return runAction(method, fn, overlay, queueInput);
    },
    [can, runAction, source, toast],
  );

  const resetDemo = useCallback(() => {
    try {
      window.localStorage.removeItem(DATA_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    window.location.reload();
  }, []);

  const canOpenRoute = useCallback(
    (routeId: WarehouseRouteId) => canOpenWarehouseRoute(routeId, can),
    [can],
  );

  const value: WarehouseContextValue = {
    data,
    loading,
    error,
    source,
    role,
    roleCode,
    roleLabel,
    roleDescription,
    setRole,
    capabilities,
    can,
    canOpenRoute,
    actor,
    identityId,
    refresh,
    pendingSync,
    conflicts,
    discardConflict,
    syncNow,
    receiveStock: (input) =>
      runAuthorizedAction(
        'receive_stock',
        'receiveStock',
        () => repo.receiveStock({ ...input, actor }),
        receiveOverlay(input, actor),
        input as Record<string, unknown>,
      ),
    reserve: (input) =>
      runAuthorizedAction(
        'reserve_allocate',
        'other',
        () => repo.reserve({ ...input, actor }),
      ),
    issue: (input) =>
      runAuthorizedAction(
        'issue_items',
        'issue',
        () => repo.issue({ ...input, actor }),
        issueOverlay(input, data),
        input as Record<string, unknown>,
      ),
    recordReturn: (input) =>
      runAuthorizedAction(
        'manage_returns',
        'recordReturn',
        () => repo.recordReturn({ ...input, actor }),
        returnOverlay(input, actor, data),
        input as Record<string, unknown>,
      ),
    recordCycleCount: (input) =>
      runAuthorizedAction(
        'cycle_count',
        'other',
        () => repo.recordCycleCount({ ...input, actor }),
      ),
    submitNewCycleCount: (input) =>
      runAuthorizedAction('cycle_count', 'other', async () => {
        const count = await repo.recordCycleCount({
          locationId: input.locationId,
          binId: input.binId,
          category: input.category,
          lines: input.lines,
          actor,
        });
        await repo.submitCycleCount({
          idempotencyKey: `submit-count-${count.id}`,
          cycleCountId: count.id,
          reason: input.reason,
          evidenceUrls: input.evidenceUrls,
        });
      }),
    transfer: (input) =>
      runAuthorizedAction(
        'transfer_stock',
        'transfer',
        () => repo.transfer({ ...input, actor }),
        transferOverlay(input, actor),
        input as Record<string, unknown>,
      ),
    createPurchaseOrder: (input) =>
      runAuthorizedAction('view_procurement', 'other', () =>
        repo.createPurchaseOrder({ ...input, actor }),
      ),
    receiveAgainstPO: (input) =>
      runAuthorizedAction('receive_stock', 'other', () =>
        repo.receiveAgainstPO({ ...input, actor }),
      ),
    cancelPurchaseOrder: (input) =>
      runAuthorizedAction('view_procurement', 'other', () =>
        repo.cancelPurchaseOrder({ ...input, actor }),
      ),
    createEvent: (input) =>
      runAuthorizedAction('reserve_allocate', 'other', () =>
        repo.createEvent(input),
      ),
    cancelAllocation: (input) =>
      runAuthorizedAction('reserve_allocate', 'other', () =>
        repo.cancelAllocation({ ...input, actor }),
      ),
    createSupplier: (input) =>
      runAuthorizedAction('view_procurement', 'other', () =>
        repo.createSupplier(input),
      ),
    updateSupplier: (input) =>
      runAuthorizedAction('view_procurement', 'other', () =>
        repo.updateSupplier(input),
      ),
    createLocation: (input) =>
      runAuthorizedAction('manage_locations', 'other', () =>
        repo.createLocation(input),
      ),
    updateLocation: (input) =>
      runAuthorizedAction('manage_locations', 'other', () =>
        repo.updateLocation(input),
      ),
    deleteLocation: (input) =>
      runAuthorizedAction('manage_locations', 'other', () =>
        repo.deleteLocation(input),
      ),
    createStorageArea: (input) =>
      runAuthorizedAction('manage_locations', 'other', () =>
        repo.createStorageArea(input),
      ),
    updateStorageArea: (input) =>
      runAuthorizedAction('manage_locations', 'other', () =>
        repo.updateStorageArea(input),
      ),
    deleteStorageArea: (input) =>
      runAuthorizedAction('manage_locations', 'other', () =>
        repo.deleteStorageArea(input),
      ),
    relocate: (input) =>
      runAuthorizedAction(
        WAREHOUSE_MUTATION_CAPABILITIES.relocate,
        'relocate',
        () => repo.relocate({ ...input, actor }),
        relocateOverlay(input, actor),
        input as Record<string, unknown>,
      ),
    setProductPrice: (input) =>
      runAuthorizedAction('set_pricing', 'other', () =>
        repo.setProductPrice({ ...input, actor }),
      ),
    createProduct: (input) =>
      runAuthorizedAction('manage_products', 'other', () =>
        repo.createProduct({ ...input, actor }),
      ),
    updateProduct: (input) =>
      runAuthorizedAction('manage_products', 'other', () =>
        repo.updateProduct({ ...input, actor }),
      ),
    adjustStock: (input) =>
      runAuthorizedAction(
        WAREHOUSE_MUTATION_CAPABILITIES.adjustStock,
        'adjustStock',
        () => repo.adjustStock({ ...input, actor }),
        adjustOverlay(input, actor),
        input as Record<string, unknown>,
      ),
    loadQualityInspections: (query) => repo.listQualityInspections(query),
    loadHolds: (query) => repo.listHolds(query),
    loadVendorReturns: (query) => repo.listVendorReturns(query),
    loadExceptions: (query) => repo.listExceptions(query),
    loadStockChangeRequests: (query) => repo.listStockChangeRequests(query),
    loadWarehouseTasks: (query) => repo.listWarehouseTasks(query),
    loadInventoryPositions: (query) => repo.listInventoryPositions(query),
    inspectQuality: (input) =>
      runAuthorizedAction(WAREHOUSE_MUTATION_CAPABILITIES.inspectQuality, 'other', () =>
        repo.inspectQuality(input),
      ),
    releaseHold: (input) =>
      runAuthorizedAction(WAREHOUSE_MUTATION_CAPABILITIES.releaseHold, 'other', () =>
        repo.releaseHold(input),
      ),
    createVendorReturn: (input) =>
      runAuthorizedAction(WAREHOUSE_MUTATION_CAPABILITIES.createVendorReturn, 'other', () =>
        repo.createVendorReturn(input),
      ),
    updateOperationRoute: (input) =>
      runAuthorizedAction('manage_operation_routes', 'other', () =>
        repo.updateOperationRoute(input),
      ),
    submitCycleCount: (input) =>
      runAuthorizedAction('cycle_count', 'other', () =>
        repo.submitCycleCount(input),
      ),
    decideStockChange: (input) =>
      runAuthorizedAction(STOCK_CHANGE_DECISION_CAPABILITIES, 'other', () =>
        repo.decideStockChange(input),
      ),
    resolveException: (input) =>
      runAuthorizedAction('resolve_exceptions', 'other', () =>
        repo.resolveException(input),
      ),
    loadReceivableProcurementPOs: () => repo.getReceivableProcurementPOs(),
    receiveProcurementPO: (input) =>
      runAuthorizedAction('receive_stock', 'other', () =>
        repo.receiveProcurementPO(input),
      ),
    resetDemo,
  };

  return (
    <WarehouseContext.Provider value={value}>
      {children}
    </WarehouseContext.Provider>
  );
}

export function useWarehouse(): WarehouseContextValue {
  const ctx = useContext(WarehouseContext);
  if (!ctx) {
    throw new Error('useWarehouse must be used within a WarehouseProvider');
  }
  return ctx;
}

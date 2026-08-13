"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@intra/auth";
import { WORK_DEMO_DATA } from "./seed";
import type {
  WorkData,
  WorkFilter,
  WorkItem,
  WorkCapability,
  WorkPriority,
  WorkSource,
} from "./types";

type UnknownRow = Record<string, unknown>;
type CapabilityProjection = Readonly<Record<string, readonly string[]>>;
const SOURCES = new Set<WorkSource>([
  "warehouse",
  "procurement",
  "legal",
  "events",
  "finance",
]);
const PRIORITIES = new Set<WorkPriority>(["critical", "high", "normal"]);
const text = (value: unknown, fallback = "") =>
  typeof value === "string" && value ? value : fallback;
const FILTER_LABELS: Record<WorkSource, string> = {
  warehouse: "Warehouse",
  procurement: "Procurement",
  legal: "Legal",
  events: "Events",
  finance: "Finance",
};

export function availableWorkFilters(allowedSources: readonly WorkSource[]) {
  return [
    { value: "all" as const, label: "All" },
    ...allowedSources.map((value) => ({ value, label: FILTER_LABELS[value] })),
  ];
}

export function filterWorkItems(
  items: readonly WorkItem[],
  filter: WorkFilter,
): WorkItem[] {
  return filter === "all"
    ? [...items]
    : items.filter((item) => item.source === filter);
}

export function scopeWorkItems(
  items: readonly WorkItem[],
  hasCapability: (module: WorkCapability["module"], capability: string) => boolean,
): WorkItem[] {
  return items.filter(
    (item) =>
      item.sourceRecordExists !== false &&
      (item.requiredCapabilities?.some((required) =>
        hasCapability(required.module, required.capability),
      ) ?? true),
  );
}

export function sortWorkItems(items: readonly WorkItem[]): WorkItem[] {
  const rank: Record<WorkPriority, number> = {
    critical: 0,
    high: 1,
    normal: 2,
  };
  return [...items].sort(
    (a, b) =>
      rank[a.priority] - rank[b.priority] ||
      (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"),
  );
}

function mapWorkItem(row: UnknownRow): WorkItem | null {
  const source = text(row.source) as WorkSource;
  const priority = text(row.priority, "normal") as WorkPriority;
  const id = text(row.id);
  const href = text(row.href);
  if (!id || !href || !SOURCES.has(source) || !PRIORITIES.has(priority))
    return null;
  return {
    id,
    source,
    priority,
    href,
    title: text(row.title, "Work item"),
    description: text(row.description),
    status: text(row.status, "open"),
    dueAt: text(row.due_at) || undefined,
    sourceRecordExists: row.source_record_exists !== false,
  };
}

export function useWorkData(
  hasCapability: (module: WorkCapability["module"], capability: string) => boolean,
) {
  const { mode, profile, supabaseClient, userCapabilities = {} } = useSession();
  const live = mode === "supabase" ? supabaseClient : null;
  const [data, setData] = useState<WorkData>(
    live ? { items: [], warnings: [] } : WORK_DEMO_DATA,
  );
  const [loading, setLoading] = useState(Boolean(live));
  const [error, setError] = useState<string | null>(null);
  const authorityRef = useRef(createWorkRequestAuthority());
  const refresh = useCallback(async () => {
    if (!live) {
      setData(WORK_DEMO_DATA);
      setLoading(false);
      return;
    }
    if (!profile) {
      setData({ items: [], warnings: [] });
      setLoading(false);
      return;
    }
    const token = authorityRef.current.begin(
      workRequestKey(profile.id, userCapabilities),
    );
    setLoading(true);
    const { data: rows, error: queryError } = await live
      .schema("core")
      .from("v_my_work")
      .select(
        "id,principal_id,source,title,description,status,priority,due_at,href,required_module,required_capability,source_record_exists",
      )
      .limit(500);
    if (!authorityRef.current.accepts(token)) return;
    if (queryError) {
      setError(queryError.message);
      setData({ items: [], warnings: [queryError.message] });
    } else {
      setError(null);
      setData({
        items: sortWorkItems(
          projectLiveWorkItems(
            (rows as UnknownRow[]) ?? [],
            profile.id,
            hasCapability,
          ),
        ),
        warnings: [],
      });
    }
    setLoading(false);
  }, [hasCapability, live, profile, userCapabilities]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const scopedItems = scopeWorkItems(data.items, hasCapability);
  return { data: { ...data, items: scopedItems }, loading, error, refresh };
}

export function workRequestKey(
  principalId: string,
  capabilities: CapabilityProjection,
) {
  const authority = Object.entries(capabilities)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([module, values]) =>
        `${module}:${[...new Set(values)].sort().join(",")}`,
    )
    .join("|");
  return `${principalId}:${authority}`;
}

export function createWorkRequestAuthority() {
  let generation = 0;
  let activeKey = "";
  return {
    begin(key: string) {
      activeKey = key;
      generation += 1;
      return { generation, key };
    },
    accepts(token: { generation: number; key: string }) {
      return token.generation === generation && token.key === activeKey;
    },
  };
}

export function projectLiveWorkItems(
  rows: readonly UnknownRow[],
  principalId: string,
  hasCapability: (
    module: WorkCapability["module"],
    capability: string,
  ) => boolean,
) {
  return rows.flatMap((row) => {
    if (
      text(row.principal_id) !== principalId ||
      row.source_record_exists === false
    ) {
      return [];
    }
    const module = text(row.required_module) as WorkCapability["module"];
    const capability = text(row.required_capability);
    if (!module || !capability || !hasCapability(module, capability)) return [];
    const item = mapWorkItem(row);
    return item
      ? [{ ...item, requiredCapabilities: [{ module, capability }] }]
      : [];
  });
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@intra/auth";
import { WORK_DEMO_DATA } from "./seed";
import type {
  WorkData,
  WorkFilter,
  WorkItem,
  WorkPriority,
  WorkSource,
} from "./types";

type UnknownRow = Record<string, unknown>;
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
  };
}

export function useWorkData() {
  const { mode, supabaseClient } = useSession();
  const live = mode === "supabase" ? supabaseClient : null;
  const [data, setData] = useState<WorkData>(
    live ? { items: [], warnings: [] } : WORK_DEMO_DATA,
  );
  const [loading, setLoading] = useState(Boolean(live));
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!live) {
      setData(WORK_DEMO_DATA);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: rows, error: queryError } = await live
      .schema("core")
      .from("v_my_work")
      .select("id,source,title,description,status,priority,due_at,href")
      .limit(500);
    if (queryError) {
      setError(queryError.message);
      setData({ items: [], warnings: [queryError.message] });
    } else {
      setError(null);
      setData({
        items: sortWorkItems(
          ((rows as UnknownRow[]) ?? [])
            .map(mapWorkItem)
            .filter((item): item is WorkItem => Boolean(item)),
        ),
        warnings: [],
      });
    }
    setLoading(false);
  }, [live]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { data, loading, error, refresh };
}

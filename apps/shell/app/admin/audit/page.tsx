"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Guard, useSession } from "@intra/auth";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  ModuleHero,
  Skeleton,
  useToast,
} from "@intra/ui";

interface ActivityRow {
  readonly id: number;
  readonly module: string;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly action: string;
  readonly actor: string;
  readonly detail: Record<string, unknown> | null;
  readonly created_at: string;
}

interface ActorRow {
  readonly id: string;
  readonly full_name: string | null;
  readonly email: string;
}

export default function AdminAuditPage() {
  return (
    <Guard module="core" cap="view_audit">
      <AdminAuditInner />
    </Guard>
  );
}

function AdminAuditInner() {
  const { mode, supabaseClient } = useSession();
  const toast = useToast();
  const core = useMemo(
    () => supabaseClient?.schema("core") ?? null,
    [supabaseClient],
  );
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [actors, setActors] = useState<Map<string, string>>(new Map());
  const [query, setQuery] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [loading, setLoading] = useState(mode === "supabase");

  const load = useCallback(async () => {
    if (!core || mode !== "supabase") {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [activityResult, actorResult] = await Promise.all([
      core
        .from("activity_log")
        .select("id,module,entity_type,entity_id,action,actor,detail,created_at")
        .order("created_at", { ascending: false })
        .limit(250),
      core.from("profiles").select("id,full_name,email"),
    ]);
    setLoading(false);
    if (activityResult.error || actorResult.error) {
      toast.error(
        activityResult.error?.message ??
          actorResult.error?.message ??
          "Unable to load audit history.",
      );
      return;
    }
    setRows((activityResult.data ?? []) as ActivityRow[]);
    setActors(
      new Map(
        ((actorResult.data ?? []) as ActorRow[]).map((actor) => [
          actor.id,
          actor.full_name ?? actor.email,
        ]),
      ),
    );
  }, [core, mode, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const modules = useMemo(
    () => Array.from(new Set(rows.map((row) => row.module))).sort(),
    [rows],
  );
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      if (moduleFilter !== "all" && row.module !== moduleFilter) return false;
      if (!normalized) return true;
      return [
        row.module,
        row.entity_type,
        row.entity_id,
        row.action,
        actors.get(row.actor) ?? row.actor,
        JSON.stringify(row.detail ?? {}),
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalized);
    });
  }, [actors, moduleFilter, query, rows]);

  const exportCsv = () => {
    const escape = (value: unknown) =>
      `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = [
      ["Time", "Module", "Action", "Entity", "Actor", "Detail"]
        .map(escape)
        .join(","),
      ...filtered.map((row) =>
        [
          row.created_at,
          row.module,
          row.action,
          `${row.entity_type}:${row.entity_id}`,
          actors.get(row.actor) ?? row.actor,
          JSON.stringify(row.detail ?? {}),
        ]
          .map(escape)
          .join(","),
      ),
    ].join("\n");
    const href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = href;
    link.download = `mwell-intra-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(href);
  };

  return (
    <div className="min-w-0 max-w-full space-y-6">
      <ModuleHero
        eyebrow="Platform governance"
        title="Audit history"
        description="Review retained administrative and cross-module changes by actor, record, and time."
        icon="shield"
        action={
          <Button variant="outline" onClick={exportCsv} disabled={!filtered.length}>
            Export CSV
          </Button>
        }
      />
      <Card className="p-4 sm:p-5">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_14rem]">
          <Field label="Search audit history" htmlFor="audit-search">
            <Input
              id="audit-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Actor, action, entity, reference"
            />
          </Field>
          <Field label="Module" htmlFor="audit-module">
            <select
              id="audit-module"
              className="input-base min-h-11 w-full"
              value={moduleFilter}
              onChange={(event) => setModuleFilter(event.target.value)}
            >
              <option value="all">All modules</option>
              {modules.map((moduleName) => (
                <option key={moduleName} value={moduleName}>
                  {moduleName}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="shield"
          title="No matching audit events"
          message="Administrative and governed workflow changes appear here."
        />
      ) : (
        <ol className="min-w-0 max-w-full space-y-3">
          {filtered.map((row) => (
            <li key={row.id} className="min-w-0 max-w-full">
              <Card className="min-w-0 max-w-full overflow-hidden p-4">
                <div className="flex min-w-0 max-w-full flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 max-w-full flex-1">
                    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                      <Badge tone="brand">{row.module}</Badge>
                      <h2 className="min-w-0 break-words font-semibold text-ink [overflow-wrap:anywhere]">
                        {row.action.replaceAll("_", " ")}
                      </h2>
                    </div>
                    <p
                      data-testid="audit-entity-reference"
                      className="mt-2 max-w-full break-words text-sm text-muted [overflow-wrap:anywhere]"
                    >
                      {row.entity_type}:{row.entity_id}
                    </p>
                  </div>
                  <time className="text-xs text-faint" dateTime={row.created_at}>
                    {new Date(row.created_at).toLocaleString("en-PH")}
                  </time>
                </div>
                <p className="mt-3 max-w-full break-words text-sm text-muted [overflow-wrap:anywhere]">
                  Actor: {actors.get(row.actor) ?? row.actor}
                </p>
                {row.detail && (
                  <pre
                    data-testid="audit-event-detail"
                    className="mt-3 max-h-48 w-full min-w-0 max-w-full overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-inset p-3 text-xs text-muted [overflow-wrap:anywhere]"
                  >
                    {JSON.stringify(row.detail, null, 2)}
                  </pre>
                )}
              </Card>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

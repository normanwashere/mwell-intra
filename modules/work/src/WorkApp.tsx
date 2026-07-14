"use client";

import { useState } from "react";
import { useSession } from "@intra/auth";
import {
  Badge,
  Card,
  EmptyState,
  HeroChipButton,
  Icon,
  ModuleHero,
  SegmentedControl,
  SignInPrompt,
  SkeletonList,
  relativeTime,
} from "@intra/ui";
import { filterWorkItems, sortWorkItems, useWorkData } from "./data";
import type { WorkFilter, WorkPriority } from "./types";

const PRIORITY_TONE: Record<WorkPriority, "rose" | "amber" | "slate"> = {
  critical: "rose",
  high: "amber",
  normal: "slate",
};
const FILTERS = [
  { value: "all", label: "All" },
  { value: "warehouse", label: "Warehouse" },
  { value: "procurement", label: "Procurement" },
  { value: "legal", label: "Legal" },
  { value: "events", label: "Events" },
  { value: "finance", label: "Finance" },
] as const;

export function WorkApp() {
  const { profile, loading: sessionLoading } = useSession();
  if (sessionLoading)
    return (
      <div aria-busy="true">
        <SkeletonList rows={6} />
      </div>
    );
  if (!profile) return <SignInPrompt module="My Work" basename="/work" />;
  if (profile.kind !== "employee") {
    return (
      <div
        role="alert"
        className="grid min-h-[60vh] place-items-center p-6 text-center"
      >
        <div className="max-w-sm space-y-3">
          <Icon name="lock" className="mx-auto h-8 w-8 text-faint" />
          <h1 className="font-display text-lg font-bold text-ink">
            No My Work access
          </h1>
          <p className="text-sm text-muted">
            My Work is an employee workspace. Use Vendor Portal for your
            organization&apos;s accreditation tasks.
          </p>
          <a href="/vendor" className="btn-primary">
            Open Vendor Portal
          </a>
        </div>
      </div>
    );
  }
  return <EmployeeWorkApp />;
}

function EmployeeWorkApp() {
  const { data, loading, error, refresh } = useWorkData();
  const [filter, setFilter] = useState<WorkFilter>("all");
  if (loading)
    return (
      <div aria-busy="true">
        <SkeletonList rows={6} />
      </div>
    );
  const visible = sortWorkItems(filterWorkItems(data.items, filter));
  const urgentCount = data.items.filter(
    (item) => item.priority !== "normal",
  ).length;
  return (
    <div className="space-y-6">
      <ModuleHero
        eyebrow="Personal queue"
        title="My Work"
        description="See every assignment and approval in one place, then complete it on the authoritative source record."
        icon="clipboard"
        action={
          <HeroChipButton href="/knowledge?topic=my-work" icon="info">
            How work is assigned
          </HeroChipButton>
        }
        accessory={
          <Badge tone={urgentCount ? "amber" : "emerald"}>
            {urgentCount} priority items
          </Badge>
        }
      />
      {error && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          <span>
            <strong>Queue unavailable.</strong> {error}
          </span>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => void refresh()}
          >
            <Icon name="rotate" className="h-4 w-4" /> Retry
          </button>
        </div>
      )}
      <div className="overflow-x-auto pb-1">
        <SegmentedControl
          ariaLabel="Filter work by source"
          options={[...FILTERS]}
          value={filter}
          onChange={(value) => setFilter(value as WorkFilter)}
        />
      </div>
      {visible.length === 0 ? (
        <EmptyState
          icon="check"
          title="No work in this view"
          message="You are caught up, or no source records are assigned to this account."
        />
      ) : (
        <section aria-label="Assigned work" className="space-y-3">
          {visible.map((item) => (
            <Card
              key={item.id}
              className="flex flex-col gap-4 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="brand">{item.source}</Badge>
                  <Badge tone={PRIORITY_TONE[item.priority]}>
                    {item.priority}
                  </Badge>
                  <span className="text-xs font-medium text-faint">
                    {item.status}
                  </span>
                </div>
                <h2 className="mt-2 font-display text-base font-bold text-ink">
                  {item.title}
                </h2>
                <p className="mt-1 text-sm text-muted">{item.description}</p>
                {item.dueAt && (
                  <p className="mt-2 text-xs font-semibold text-faint">
                    Due {relativeTime(item.dueAt)}
                  </p>
                )}
              </div>
              <a href={item.href} className="btn-primary shrink-0">
                Open source <Icon name="arrowRight" className="h-4 w-4" />
              </a>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}

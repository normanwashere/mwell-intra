"use client";
import { userFacingError, useListReturnPosition } from '@intra/ui';
import { deadlineLabel } from './deadline';
import { FollowupQueue } from './FollowupQueue';

import { useEffect, useState } from "react";
import { useWorkTracking } from './tracking';
import { INITIAL_WORK_VIEW, readWorkView, searchWork, writeWorkView, type WorkViewState } from './workView';
import { useSession } from "@intra/auth";
import {
  Badge,
  AccessDenied,
  Card,
  EmptyState,
  Icon,
  PageHeader,
  SignInPrompt,
  SkeletonList,
} from "@intra/ui";
import {
  availableWorkFilters,
  filterWorkItems,
  sortWorkItems,
  useWorkData,
} from "./data";
import type { WorkCapability, WorkFilter, WorkPriority, WorkSource } from "./types";

const PRIORITY_TONE: Record<WorkPriority, "rose" | "amber" | "slate"> = {
  critical: "rose",
  high: "amber",
  normal: "slate",
};
const ALL_SOURCES: readonly WorkSource[] = [
  'product', 'insights',
  "warehouse",
  "procurement",
  "legal",
  "events",
  "finance",
];

export function WorkApp({
  allowedSources = ALL_SOURCES,
  hasCapability = () => true,
}: {
  allowedSources?: readonly WorkSource[];
  hasCapability?: (module: WorkCapability["module"], capability: string) => boolean;
}) {
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
      <AccessDenied
        module="My Work"
        message="My Work is an employee workspace. Use Vendor Portal for your organization's accreditation tasks."
        returnHref="/vendor"
        returnLabel="Open Vendor Portal"
      />
    );
  }
  return <EmployeeWorkApp key={profile.id} allowedSources={allowedSources} hasCapability={hasCapability} />;
}

function EmployeeWorkApp({
  allowedSources,
  hasCapability,
}: {
  allowedSources: readonly WorkSource[];
  hasCapability: (module: WorkCapability["module"], capability: string) => boolean;
}) {
  const { data, loading, error, refresh } = useWorkData(hasCapability);
  const tracking = useWorkTracking(allowedSources);
  const { profile } = useSession();
  const [state, setState] = useState<WorkViewState>(INITIAL_WORK_VIEW);
  const returnPosition = useListReturnPosition(`work:${profile?.id}`, JSON.stringify(state), !loading && !tracking.loading);
  const sourceKey = allowedSources.join(',');
  useEffect(() => {
    const restore = () => setState(readWorkView(window.location.search, sourceKey.split(',') as WorkSource[]));
    restore();
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [sourceKey]);
  function update(patch: Partial<WorkViewState>, replace = false) {
    const next = { ...state, ...patch };
    setState(next);
    window.history[replace ? 'replaceState' : 'pushState'](null, '', writeWorkView(new URL(window.location.href), next));
  }
  if (loading)
    return (
      <div aria-busy="true">
        <SkeletonList rows={6} />
      </div>
    );
  const scopedItems = data.items.filter((item) =>
    allowedSources.includes(item.source),
  );
  const visible = searchWork(sortWorkItems(filterWorkItems(scopedItems, state.source)), state.search);
  const matchingTracking = searchWork(tracking.items.filter(item => (state.source === 'all' || item.source === state.source) && !scopedItems.some(assignment => assignment.href === item.href)), state.search);
  const tracked = matchingTracking.filter(item => item.bucket === state.view);
  const urgentCount = scopedItems.filter(
    (item) => item.priority !== "normal",
  ).length;
  return (
    <div ref={returnPosition.ref} onClickCapture={returnPosition.onClickCapture} className="hierarchy-preview hp-work space-y-6">
      <PageHeader
        eyebrow="Personal queue"
        title="My Work"
        subtitle="Your assignments and request handovers across departments."
        icon="clipboard"
        status={state.view === 'action' ? (
          <Badge tone={error || urgentCount ? "amber" : "slate"}>
            {error ? 'Queue unavailable' : `${urgentCount} priority items`}
          </Badge>
        ) : undefined}
      />
      <div className="hp-view-tabs grid grid-cols-3 gap-2 border-y border-line py-3" role="group" aria-label="Work views">
        {([
          ['action', 'Needs your action', error || tracking.loading || tracking.errors.length ? null : visible.length + matchingTracking.filter(item => item.bucket === 'action').length],
          ['waiting', 'Waiting on someone else', tracking.loading || tracking.errors.length ? null : matchingTracking.filter(item => item.bucket === 'waiting').length],
          ['completed', 'Recently completed', tracking.loading || tracking.errors.length ? null : matchingTracking.filter(item => item.bucket === 'completed').length],
        ] as const).map(([view, label, count]) => <button key={view} type="button" aria-label={label} aria-pressed={state.view === view} onClick={() => update({ view })} className={`flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-md border px-2 py-3 text-sm font-semibold sm:flex-row sm:justify-between sm:gap-3 sm:px-3 sm:text-left ${state.view === view ? 'border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-200' : 'border-transparent text-muted hover:bg-inset'}`}>
          <span className="hidden sm:inline">{label}</span><span className="sm:hidden">{view === 'action' ? 'Action' : view === 'waiting' ? 'Waiting' : 'Completed'}</span><span className="tnum">{count ?? '—'}</span>
        </button>)}
      </div>
      {error && state.view === 'action' && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"
        >
          <span>
            <strong>Queue unavailable.</strong> {userFacingError(error)}
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
      <div className="hp-toolbar grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-line pb-4 sm:grid-cols-[minmax(0,1fr)_14rem_auto]">
        <label className="col-span-2 min-w-0 text-sm font-medium text-muted sm:col-span-1">Search work
          <input className="input mt-1 w-full" type="search" maxLength={120} value={state.search} onChange={event => update({ search: event.target.value }, true)} placeholder="Record, status or next owner" />
        </label>
        <label className="min-w-0 text-sm font-medium text-muted">Module
          <select className="input mt-1 w-full" value={state.source} onChange={event => update({ source: event.target.value as WorkFilter })}>
            {availableWorkFilters(allowedSources).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <button type="button" className="btn-outline self-end" onClick={() => { void refresh(); void tracking.refresh(); }}><Icon name="rotate" className="h-4 w-4" />Refresh</button>
      </div>
      {state.view === 'action' && (!error && !tracking.loading && !tracking.errors.length && visible.length === 0 && tracked.length === 0 ? (
        <EmptyState
          icon="check"
          title="No work in this view"
          message="No matching assignments were returned. Other departments may still be working on your requests."
        />
      ) : visible.length > 0 ? (
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
                <h2 className="mt-2 break-words font-display text-base font-bold text-ink [overflow-wrap:anywhere]">
                  {item.title}
                </h2>
                <p className="mt-1 break-words text-sm text-muted [overflow-wrap:anywhere]">
                  {item.description}
                </p>
                <p className="mt-2 text-xs font-semibold text-muted">Next owner: You</p>
                {item.dueAt && (
                  <p className="mt-2 text-xs font-semibold text-faint">
                    {deadlineLabel(item.dueAt)}
                  </p>
                )}
              </div>
              <a href={item.href} aria-label={`Open record: ${item.title}`} className="btn-outline shrink-0">
                Open record <Icon name="arrowRight" className="h-4 w-4" />
              </a>
            </Card>
          ))}
        </section>
      ) : null)}
      {(state.view !== 'action' || tracked.length > 0 || tracking.errors.length > 0) && <section aria-label={state.view === 'waiting' ? 'Waiting records' : state.view === 'completed' ? 'Completed records' : 'Your request actions'} className="space-y-3">
        {state.view === 'action' && <h2 className="text-lg font-semibold">Your requests</h2>}
        <p className="text-sm text-muted">{tracking.coverage}</p>
        {tracking.loading && <p role="status">Loading request tracking...</p>}
        {tracking.errors.length > 0 && <div role="alert" className="border-l-2 border-amber-500 px-3 py-2 text-sm"><strong>Some tracking records could not be loaded.</strong> The list may be incomplete. <button className="btn-outline" onClick={() => void tracking.refresh()}>Retry tracking</button></div>}
        {!tracking.loading && !tracking.errors.length && !tracked.length && <EmptyState icon="clipboard" title="No matching tracked requests" message="This view only covers the request types listed above. Other work may still be in progress." />}
        {tracked.length > 0 && <div className="hp-request-columns hidden lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto]" aria-hidden="true"><span>Request / status</span><span>Responsible team / next step</span><span className="w-32">Record</span></div>}
        {tracked.map(item => <Card key={item.id} className="hp-request-row grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto]">
          <div className="min-w-0"><Badge tone="slate">{item.source}</Badge><h2 className="mt-2 break-words font-semibold [overflow-wrap:anywhere]">{item.title}</h2><p className="mt-1 text-sm text-muted">{item.status}</p></div>
          <div className="min-w-0 text-sm"><p className="font-semibold">{item.owner}</p><p className="mt-1 break-words text-muted [overflow-wrap:anywhere]">{item.nextStep}</p></div>
          <a className="btn-outline justify-self-start self-center lg:w-32" href={item.href} aria-label={`Open tracked request: ${item.title}`}>View request<Icon name="arrowRight" className="h-4 w-4" /></a>
        </Card>)}
      </section>}
      <FollowupQueue view={state.view} source={state.source} search={state.search} />
      <a className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted underline" href="/knowledge?article=feature-my-work"><Icon name="info" className="h-4 w-4" />How work is assigned</a>
    </div>
  );
}

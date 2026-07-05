'use client';

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge,
  Card,
  EmptyState,
  HeroChipButton,
  Icon,
  ModuleHero,
  SectionTitle,
  Sheet,
  StatCard,
  useToast,
} from '@intra/ui';
import { Guard, useSession } from '@intra/auth';
import type { ProcurementRequest } from '../types';
import { useProcurementRequests } from '../localStore';

export function ApprovalInboxPage() {
  const { rows, decide, loading } = useProcurementRequests();
  const { profile } = useSession();
  const { success, error } = useToast();
  const [active, setActive] = useState<ProcurementRequest | null>(null);
  const [decision, setDecision] = useState<'approved' | 'rejected' | null>(null);
  const [note, setNote] = useState('');

  const pending = useMemo(
    () => rows.filter((r) => r.status === 'submitted' || r.status === 'under_review'),
    [rows],
  );
  const decidedRecent = useMemo(
    () =>
      rows
        .filter((r) => r.status === 'approved' || r.status === 'rejected')
        .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''))
        .slice(0, 8),
    [rows],
  );

  function openDecision(req: ProcurementRequest, d: 'approved' | 'rejected') {
    setActive(req);
    setDecision(d);
    setNote('');
  }

  function submitDecision() {
    if (!active || !decision) return;
    const ok = decide(active.id, decision, { email: profile?.email, note });
    if (ok) {
      success(`Request ${decision}`);
      setActive(null);
      setDecision(null);
    } else {
      error('Could not save the decision.');
    }
  }

  return (
    <Guard module="procurement" cap="approve_request">
      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        <ModuleHero
          eyebrow="Approver,"
          title="Approval inbox"
          description="Review submitted purchase requests and act on them. Approvals unlock PO authoring; rejections send the request back to the requester with your note."
          icon="clipboard"
          action={
            <HeroChipButton href="/procurement" icon="arrowRight">
              Back to requests
            </HeroChipButton>
          }
          accessory={
            <>
              <div>
                <p className="text-xs uppercase tracking-wide text-brand-100/70">Waiting on you</p>
                <p className="tnum text-2xl font-extrabold">{pending.length}</p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-brand-100/70">Decided (last 8)</p>
                <p className="tnum text-2xl font-extrabold">{decidedRecent.length}</p>
              </div>
            </>
          }
        />

        <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Pending" value={pending.length} icon="rotate" tone="cyan" hint="Awaiting your decision" />
          <StatCard
            label="Total value"
            value={`₱${pending
              .reduce((s, r) => s + (r.estimatedAmount ?? 0), 0)
              .toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            icon="coins"
            tone="brand"
            hint="Sum of pending requests"
          />
          <StatCard
            label="Approved"
            value={rows.filter((r) => r.status === 'approved').length}
            icon="check"
            tone="emerald"
            hint="Cleared for PO"
          />
          <StatCard
            label="Rejected"
            value={rows.filter((r) => r.status === 'rejected').length}
            icon="x"
            tone="rose"
            hint="Sent back to requester"
          />
        </div>

        <div>
          <SectionTitle title="Pending requests" subtitle="Review the details, then approve or reject with a note." />
          {loading ? (
            <div className="h-32 animate-pulse rounded-2xl bg-inset" aria-hidden />
          ) : pending.length === 0 ? (
            <EmptyState
              icon="check"
              title="Inbox zero"
              message="No requests are waiting on you right now — new submissions land here automatically."
            />
          ) : (
            <ul className="space-y-3">
              {pending.map((r) => (
                <li key={r.id}>
                  <Card>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          to={`/requests/${r.id}`}
                          className="font-display text-base font-bold text-ink hover:underline"
                        >
                          {r.title}
                        </Link>
                        <p className="mt-0.5 text-xs text-muted">
                          {r.requesterName ?? r.requesterEmail ?? 'Requester'}
                          {r.department ? ` · ${r.department}` : ''}
                          {r.costCenter ? ` · ${r.costCenter}` : ''}
                          {r.neededBy ? ` · needed ${new Date(r.neededBy).toLocaleDateString()}` : ''}
                        </p>
                        {r.vendorName && (
                          <p className="mt-0.5 text-xs text-muted">
                            Preferred vendor: <span className="font-medium">{r.vendorName}</span>
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Badge tone="cyan">{r.status}</Badge>
                          <span className="text-xs text-muted">
                            {r.lines.length} line{r.lines.length === 1 ? '' : 's'}
                          </span>
                          <span className="tnum text-sm font-semibold text-ink">
                            ₱{(r.estimatedAmount ?? 0).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Link to={`/requests/${r.id}`} className="btn-ghost btn-sm">
                          <Icon name="search" className="h-4 w-4" />
                          Review
                        </Link>
                        <button
                          type="button"
                          onClick={() => openDecision(r, 'rejected')}
                          className="btn-outline btn-sm"
                        >
                          <Icon name="x" className="h-4 w-4" />
                          Reject
                        </button>
                        <button
                          type="button"
                          onClick={() => openDecision(r, 'approved')}
                          className="btn-primary btn-sm"
                        >
                          <Icon name="check" className="h-4 w-4" />
                          Approve
                        </button>
                      </div>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>

        {decidedRecent.length > 0 && (
          <div>
            <SectionTitle title="Recently decided" subtitle="Your last few approvals & rejections." />
            <ul className="space-y-2">
              {decidedRecent.map((r) => (
                <li key={r.id}>
                  <Card>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <Link to={`/requests/${r.id}`} className="font-semibold text-ink hover:underline">
                          {r.title}
                        </Link>
                        <p className="text-xs text-muted">
                          {new Date(r.decidedAt ?? r.createdAt).toLocaleString()}
                          {r.decisionNote ? ` — ${r.decisionNote}` : ''}
                        </p>
                      </div>
                      <Badge tone={r.status === 'approved' ? 'emerald' : 'rose'}>{r.status}</Badge>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Sheet
          open={Boolean(active && decision)}
          onOpenChange={(v) => {
            if (!v) {
              setActive(null);
              setDecision(null);
            }
          }}
          title={
            decision === 'approved'
              ? `Approve — ${active?.title ?? ''}`
              : `Reject — ${active?.title ?? ''}`
          }
        >
          <div className="space-y-3 p-1">
            <p className="text-sm text-muted">
              {decision === 'approved'
                ? 'Approving unlocks PO authoring against the preferred vendor.'
                : 'Rejecting sends the request back to the requester with your note.'}
            </p>
            <label htmlFor="approval-note" className="text-xs font-semibold uppercase tracking-wide text-faint">
              Note (optional)
            </label>
            <textarea
              id="approval-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="input"
              placeholder="Short reason or context…"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setActive(null);
                  setDecision(null);
                }}
                className="btn-ghost"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitDecision}
                className={decision === 'approved' ? 'btn-primary' : 'btn-outline text-rose-700 dark:text-rose-300'}
              >
                Confirm {decision}
              </button>
            </div>
          </div>
        </Sheet>
      </div>
    </Guard>
  );
}

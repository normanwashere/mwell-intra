"use client";

// Reviewer inbox (internal) + vendor application card (external).
//
// Internal: compact count filters keep the first case above the mobile
// bottom navigation; lifecycle administration is a separate workspace.
//
// Vendor (§2.1): the case list is replaced by a status-first application
// card — plain-language status + InfoTip, progress, tappable next actions,
// one primary CTA. Prior cycles collapse into a "Past accreditations"
// disclosure. The hero shrinks to eyebrow + company; boilerplate moves into
// an InfoTip next to the section title.

import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Badge,
  DataTable,
  EmptyState,
  Icon,
  InfoTip,
  ModuleHero,
  SectionTitle,
  type Column,
} from "@intra/ui";
import { Guard, useSession } from "@intra/auth";
import type {
  AccreditationCase,
  AccreditationDoc,
  CaseStatus,
  InboxBucket,
  RequirementChecklistItem,
  SignedInstrument,
} from "../types";
import { JURISDICTION_LABEL } from "../types";
import {
  computeCaseStatus,
  useAccreditationCases,
  useAccreditationDocs,
  useChecklist,
  useSignedInstruments,
  useVendorAliases,
} from "../localStore";
import {
  computeCaseProgress,
  deriveInboxBucket,
  INBOX_BUCKET_LABEL,
} from "../caseLogic";
import {
  CASE_STATUS_DOT,
  CASE_STATUS_LABEL,
  CASE_STATUS_TONE,
  formatDate,
  VENDOR_STATUS_EXPLAINER,
  VENDOR_STATUS_LABEL,
} from "../labels";
import { visibleCasesForVendor } from "../vendorAccess";
import { VendorLifecyclePanel } from "../components/VendorLifecyclePanel";

function columns(
  bucketOf: Map<string, InboxBucket | null>,
): Column<AccreditationCase>[] {
  return [
    {
      key: "vendorName",
      header: "Vendor",
      primary: true,
      render: (r) => (
        <div className="min-w-0">
          <span className="font-semibold text-ink">{r.vendorName}</span>
          {r.jurisdiction && (
            <span className="ml-2 inline-flex items-center rounded-full bg-inset px-2 py-0.5 text-[0.65rem] font-semibold text-muted">
              {r.jurisdiction === "OTHER" && r.originCountry
                ? r.originCountry
                : JURISDICTION_LABEL[r.jurisdiction]}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => {
        const s = computeCaseStatus(r);
        return <Badge tone={CASE_STATUS_TONE[s]}>{CASE_STATUS_LABEL[s]}</Badge>;
      },
    },
    {
      key: "bucket",
      header: "Waiting on",
      render: (r) => {
        const bucket = bucketOf.get(r.id);
        return bucket ? (
          <span className="text-sm text-muted">
            {INBOX_BUCKET_LABEL[bucket]}
          </span>
        ) : (
          <span className="text-sm text-faint">—</span>
        );
      },
    },
    { key: "category", header: "Category", render: (r) => r.category ?? "—" },
    {
      key: "submittedAt",
      header: "Submitted",
      render: (r) => formatDate(r.submittedAt),
    },
    {
      key: "expiresAt",
      header: "Expires",
      render: (r) => formatDate(r.expiresAt),
    },
  ];
}

type CaseFilter = "all" | InboxBucket;

export function AccreditationCasesPage() {
  const [workspace, setWorkspace] = useState<'cases' | 'lifecycle'>('cases');
  const { profile } = useSession();
  const { rows, loading } = useAccreditationCases();
  const { rows: allChecklist } = useChecklist();
  const { rows: allDocs } = useAccreditationDocs();
  const { rows: allSigned } = useSignedInstruments();
  const { rows: aliases } = useVendorAliases();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const isVendor = profile?.kind === "vendor";
  const filter = (params.get("filter") as CaseFilter) ?? "all";

  // Vendors see only their own case(s) — same matcher as the detail guard.
  const visible = useMemo(
    () => visibleCasesForVendor(profile, rows, aliases),
    [rows, profile, aliases],
  );

  const bucketOf = useMemo(() => {
    const map = new Map<string, InboxBucket | null>();
    for (const kase of visible) {
      const items = allChecklist.filter((i) => i.caseId === kase.id);
      const evidence = {
        docs: allDocs.filter((d) => d.caseId === kase.id),
        signed: allSigned.filter((s) => s.caseId === kase.id),
      };
      map.set(kase.id, deriveInboxBucket(kase, items, evidence));
    }
    return map;
  }, [visible, allChecklist, allDocs, allSigned]);

  const bucketCounts = useMemo(() => {
    const counts: Record<InboxBucket, number> = {
      waiting_on_vendor: 0,
      waiting_on_legal: 0,
      ready_for_decision: 0,
      renewal_due: 0,
    };
    for (const bucket of bucketOf.values()) {
      if (bucket) counts[bucket] += 1;
    }
    return counts;
  }, [bucketOf]);

  const filteredVisible = useMemo(() => {
    if (filter === "all") return visible;
    return visible.filter((r) => bucketOf.get(r.id) === filter);
  }, [visible, filter, bucketOf]);

  const applyFilter = (next: CaseFilter) => {
    if (next === "all") params.delete("filter");
    else params.set("filter", next);
    setParams(params, { replace: false });
  };

  // -------------------------------------------------------------------------
  // Vendor branch — status-first application card (§2.1)
  // -------------------------------------------------------------------------
  if (isVendor) {
    return (
      <VendorHome
        profileName={profile?.name ?? "Your organization"}
        cases={visible}
        loading={loading}
        allChecklist={allChecklist}
        allDocs={allDocs}
        allSigned={allSigned}
      />
    );
  }

  // -------------------------------------------------------------------------
  // Internal branch — reviewer inbox (§2.3)
  // -------------------------------------------------------------------------
  const waitingOnYou =
    bucketCounts.waiting_on_legal + bucketCounts.ready_for_decision;
  const lifecycleVendors = Array.from(
    new Map(
      visible.map((kase) => [
        kase.vendorId,
        { id: kase.vendorId, name: kase.vendorName },
      ]),
    ).values(),
  );

  return (
    <div className="space-y-3 md:space-y-4" data-testid="legal-case-workspace">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-bold text-ink">Vendor accreditation</h1>
          <p className="mt-1 text-sm text-muted">Case review, vendor follow-up, and renewals.</p>
        </div>
        <p className="text-sm text-muted">Waiting on you: <strong className="tnum text-ink">{waitingOnYou}</strong></p>
      </header>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Case queue filters">
        {(
          [
            {
              key: "waiting_on_vendor" as const,
              label: "Waiting on vendor",
              value: bucketCounts.waiting_on_vendor,
              hint: "Docs / signatures outstanding",
            },
            {
              key: "waiting_on_legal" as const,
              label: "Waiting on Legal",
              value: bucketCounts.waiting_on_legal,
              hint: "Evidence needs your review",
            },
            {
              key: "ready_for_decision" as const,
              label: "Ready for decision",
              value: bucketCounts.ready_for_decision,
              hint: "All required items approved",
            },
            {
              key: "renewal_due" as const,
              label: "Renewals",
              value: bucketCounts.renewal_due,
              hint: "Expiring within 30 days",
            },
          ] as const
        ).map((c) => {
          const active = filter === c.key;
          return (
            <button
              type="button"
              key={c.key}
              aria-pressed={active}
              aria-label={`${c.label}: ${c.value}`}
              title={c.hint}
              className={`min-h-11 min-w-0 rounded-md border px-3 py-2 text-left text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${active ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'border-line text-ink hover:bg-inset'}`}
              onClick={() => applyFilter(c.key)}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0 break-words font-medium">{c.label}</span>
                <strong className="tnum shrink-0">{c.value}</strong>
              </span>
              <span className="mt-0.5 block text-xs text-muted">{c.hint}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Legal workspace">
        <button type="button" className="btn-outline" aria-pressed={workspace === 'cases'} onClick={() => setWorkspace('cases')}>Accreditation cases</button>
        <button type="button" className="btn-outline" aria-pressed={workspace === 'lifecycle'} onClick={() => setWorkspace('lifecycle')}>Vendor lifecycle</button>
      </div>
      {workspace === 'lifecycle' && <VendorLifecyclePanel vendors={lifecycleVendors} />}

      <div hidden={workspace !== 'cases'}>
        <div className="mb-3 flex items-center justify-between gap-2 border-b border-line pb-2">
          <h2 className="font-display text-base font-bold text-ink">Accreditation cases</h2>
            <InfoTip
              label="About this list"
              content="All vendor cases across the pipeline. Select a count filter for what unblocks the case next; select a row to review. Approvals here unblock procurement PO awards."
            />
        </div>

        {filter !== "all" && (
          <div className="mb-3">
            <button
              type="button"
              onClick={() => applyFilter("all")}
              className="chip bg-brand-500/15 text-brand-700 hover:bg-brand-500/25 dark:text-brand-300"
            >
              {INBOX_BUCKET_LABEL[filter]}
              <span className="ml-1 tnum opacity-70">
                {bucketCounts[filter]}
              </span>
              <Icon name="x" className="ml-1 h-3 w-3" aria-hidden />
              <span className="sr-only">Clear filter</span>
            </button>
          </div>
        )}

        {loading ? (
          <div
            className="h-24 animate-pulse rounded-2xl bg-inset"
            aria-hidden
          />
        ) : filteredVisible.length === 0 ? (
          <EmptyState
            icon="building"
            title="No cases in this bucket"
            message={
              filter === "all"
                ? "Invite a vendor to start their onboarding — a case appears here once they submit."
                : "Nothing here right now. Select a count filter above to see other cases."
            }
            action={
              filter === "all" ? (
                <Guard module="legal" cap="manage_checklist" fallback={null}>
                  <Link to="/invites/new" className="btn-primary">
                    Invite vendor
                  </Link>
                </Guard>
              ) : undefined
            }
          />
        ) : (
          <DataTable
            rows={filteredVisible}
            columns={columns(bucketOf)}
            keyOf={(r) => r.id}
            onRowClick={(r) => navigate(`/cases/${r.id}`)}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vendor home — status-first application card (§2.1)
// ---------------------------------------------------------------------------

/** Active-case preference: open work first, then renewals, then terminal. */
const VENDOR_ACTIVE_PRIORITY: Record<CaseStatus, number> = {
  draft: 0,
  submitted: 1,
  under_review: 1,
  correction_requested: 0,
  renewal_due: 2,
  provisional: 2,
  approved: 3,
  rejected: 4,
  expired: 4,
};

function VendorHome({
  profileName,
  cases,
  loading,
  allChecklist,
  allDocs,
  allSigned,
}: {
  profileName: string;
  cases: AccreditationCase[];
  loading: boolean;
  allChecklist: RequirementChecklistItem[];
  allDocs: AccreditationDoc[];
  allSigned: SignedInstrument[];
}) {
  const ordered = useMemo(
    () =>
      [...cases].sort(
        (a, b) =>
          VENDOR_ACTIVE_PRIORITY[computeCaseStatus(a)] -
            VENDOR_ACTIVE_PRIORITY[computeCaseStatus(b)] ||
          new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime(),
      ),
    [cases],
  );
  const active = ordered[0];
  const past = ordered.slice(1);
  const [pastOpen, setPastOpen] = useState(false);

  return (
    <div className="space-y-6">
      {/* Compact hero: eyebrow + company only (§2.1 / §2.5 chrome dedupe). */}
      <ModuleHero
        eyebrow="Your accreditation"
        title={profileName}
        icon="building"
        className="!p-4 sm:!p-5"
      />

      <div className="mx-auto w-full max-w-[560px]">
        <SectionTitle
          title="Your application"
          action={
            <InfoTip
              label="About this page"
              content="Submit accreditation documents and track your review status here. Everything on this page is scoped to your organization only."
            />
          }
        />

        {loading ? (
          <div
            className="h-64 animate-pulse rounded-2xl bg-inset"
            aria-hidden
          />
        ) : !active ? (
          <EmptyState
            icon="building"
            title="No accreditation case yet"
            message="When Legal invites your organization, your application will appear here to fill out."
          />
        ) : (
          <VendorApplicationCard
            kase={active}
            items={allChecklist.filter((i) => i.caseId === active.id)}
            docs={allDocs.filter((d) => d.caseId === active.id)}
            signed={allSigned.filter((s) => s.caseId === active.id)}
          />
        )}

        {past.length > 0 && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setPastOpen((v) => !v)}
              aria-expanded={pastOpen}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted transition hover:text-ink"
            >
              <Icon
                name="chevron"
                className={`h-3.5 w-3.5 transition ${pastOpen ? "rotate-90" : ""}`}
              />
              Past accreditations ({past.length})
            </button>
            {pastOpen && (
              <ul className="mt-2 space-y-2">
                {past.map((k) => {
                  const s = computeCaseStatus(k);
                  return (
                    <li key={k.id}>
                      <Link
                        to={`/cases/${k.id}`}
                        className="card flex items-center justify-between gap-3 p-3.5 transition hover:bg-inset"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            aria-hidden
                            className={`h-2 w-2 shrink-0 rounded-full ${CASE_STATUS_DOT[s]}`}
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-ink">
                              {VENDOR_STATUS_LABEL[s]}
                            </span>
                            <span className="block text-xs text-muted">
                              Opened {formatDate(k.openedAt)}
                              {k.expiresAt
                                ? ` · expired ${formatDate(k.expiresAt)}`
                                : ""}
                            </span>
                          </span>
                        </span>
                        <Icon
                          name="chevron"
                          className="h-4 w-4 shrink-0 text-faint"
                          aria-hidden
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function VendorApplicationCard({
  kase,
  items,
  docs,
  signed,
}: {
  kase: AccreditationCase;
  items: RequirementChecklistItem[];
  docs: AccreditationDoc[];
  signed: SignedInstrument[];
}) {
  const status = computeCaseStatus(kase);
  const progress = useMemo(
    () => computeCaseProgress(items, { docs, signed }),
    [items, docs, signed],
  );
  const required = items.filter((i) => i.required);
  const requiredApproved = required.filter(
    (i) => i.decision === "approved",
  ).length;
  const oweDocs = progress.outstanding.filter((i) => !i.instrument).length;
  const oweSignatures = progress.outstanding.filter((i) => i.instrument).length;
  const pct = Math.round(progress.ratio * 100);

  const meta = [
    kase.submittedAt
      ? `Submitted ${formatDate(kase.submittedAt)}`
      : `Opened ${formatDate(kase.openedAt)}`,
    kase.category,
    kase.jurisdiction
      ? kase.jurisdiction === "OTHER" && kase.originCountry
        ? kase.originCountry
        : JURISDICTION_LABEL[kase.jurisdiction]
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  const cta =
    status === "approved"
      ? "View accreditation"
      : status === "rejected" || status === "expired"
        ? "View application"
        : "Continue application";

  return (
    <div className="card space-y-4 p-4 sm:p-5">
      {/* Status line: dot + plain language + explainer behind (i). */}
      <div>
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${CASE_STATUS_DOT[status]}`}
          />
          <p className="min-w-0 flex-1 font-display text-base font-bold leading-snug text-ink">
            {VENDOR_STATUS_LABEL[status]}
          </p>
          <InfoTip
            label="What this status means"
            content={VENDOR_STATUS_EXPLAINER[status]}
          />
        </div>
        <p className="mt-0.5 text-sm text-muted">
          Your accreditation application
        </p>
      </div>

      {/* Progress (reuses the caseLogic roll-up). */}
      <div>
        <div className="flex items-center justify-between gap-3 text-sm">
          <p className="font-semibold text-ink">
            <span className="tnum">
              {requiredApproved} of {required.length}
            </span>{" "}
            requirements approved
          </p>
          <p className="tnum text-muted">{pct}%</p>
        </div>
        <div
          role="progressbar"
          aria-label="Accreditation requirements approved"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-1.5 h-2 overflow-hidden rounded-full bg-inset"
        >
          <div
            className="h-full rounded-full bg-brand-600 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Next actions — tappable rows deep-linking into the case. */}
      {(oweDocs > 0 || oweSignatures > 0) && (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {oweDocs > 0 && (
            <li>
              <Link
                to={`/cases/${kase.id}`}
                className="flex min-h-11 items-center gap-2.5 px-3 py-2.5 text-sm font-semibold text-ink transition hover:bg-inset"
              >
                <Icon
                  name="clipboard"
                  className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300"
                />
                <span className="min-w-0 flex-1">
                  You still owe {oweDocs} document{oweDocs === 1 ? "" : "s"}
                </span>
                <Icon
                  name="chevron"
                  className="h-4 w-4 shrink-0 text-faint"
                  aria-hidden
                />
              </Link>
            </li>
          )}
          {oweSignatures > 0 && (
            <li>
              <Link
                to={`/cases/${kase.id}`}
                className="flex min-h-11 items-center gap-2.5 px-3 py-2.5 text-sm font-semibold text-ink transition hover:bg-inset"
              >
                <Icon
                  name="signature"
                  className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300"
                />
                <span className="min-w-0 flex-1">
                  {oweSignatures} agreement{oweSignatures === 1 ? "" : "s"}{" "}
                  awaiting your signature
                </span>
                <Icon
                  name="chevron"
                  className="h-4 w-4 shrink-0 text-faint"
                  aria-hidden
                />
              </Link>
            </li>
          )}
        </ul>
      )}

      {/* Meta demoted to one muted line. */}
      {meta && <p className="text-xs text-muted">{meta}</p>}

      <Link
        to={`/cases/${kase.id}`}
        className="btn-primary w-full justify-center"
      >
        {cta}
        <Icon name="arrowRight" className="h-4 w-4" />
      </Link>
    </div>
  );
}

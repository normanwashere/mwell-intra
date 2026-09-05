"use client";

import {
  Badge,
  Card,
  HeroChipButton,
  Icon,
  ModuleHero,
  SignInPrompt,
  SkeletonList,
  SkeletonStats,
} from "@intra/ui";
import { useSession } from "@intra/auth";
import { useCan } from "@intra/auth";
import { paymentUrgency } from './paymentUrgency';
import { summarizeFinanceData, useFinanceData, type FinanceSource } from "./data";
import { FinanceActivityTable } from "./components/FinanceActivityTable";
import { FinanceOverview } from "./components/FinanceOverview";
import { FinanceReviewQueue } from "./components/FinanceReviewQueue";
import { FinanceClosePanel } from "./components/FinanceClosePanel";

export function FinanceApp() {
  const { profile, mode, roleCapabilities, loading: sessionLoading } = useSession();
  const warehouseFinance = useCan('warehouse', 'view_finance');
  const procurementFinance = useCan('procurement', 'view_finance');
  const mayManageClose = useCan('warehouse', 'manage_finance_close');
  const { data, loading, error, refresh, retrySource, retryingSources = {}, manageCloseEntry, openCloseEvidence, isDemo, searchSources, loadEvidenceOptions } =
    useFinanceData();

  if (sessionLoading || (profile && loading)) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading Finance">
        <SkeletonStats />
        <SkeletonList rows={5} />
      </div>
    );
  }

  if (!profile) return <SignInPrompt module="Finance" basename="/finance" />;

  if (!warehouseFinance && !procurementFinance) {
    return (
      <div
        role="alert"
        className="grid min-h-[60vh] place-items-center p-6 text-center"
      >
        <div className="max-w-sm space-y-3">
          <Icon name="lock" className="mx-auto h-8 w-8 text-faint" />
          <h1 className="font-display text-lg font-bold text-ink">
            No Finance access
          </h1>
          <p className="text-sm text-muted">
            Your account needs Warehouse Finance or Procurement Finance access.
            Ask an administrator to assign the appropriate scoped role.
          </p>
          <a href="/" className="btn-primary">
            Back to dashboard
          </a>
        </div>
      </div>
    );
  }

  const summary = summarizeFinanceData(data);
  const failedSources = (Object.entries(data.sourceStates ?? {}) as [FinanceSource, string][])
    .filter(([, state]) => state === 'error').map(([source]) => source);
  const nextReview = paymentUrgency(data.payments).find(
    (item) => item.status === "ready_for_finance" || (item.status === 'accepted' && item.remainingAmount > 0),
  );

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-hidden">
      <ModuleHero
        eyebrow="Finance"
        title="Finance control center"
        description="Follow commitments from approved purchase order through receipt, reconciliation, and payment readiness."
        icon="coins"
        action={
          procurementFinance && nextReview ? (
            <HeroChipButton
              href={`/procurement/purchase-orders/${encodeURIComponent(nextReview.purchaseOrderId)}`}
              icon="arrowRight"
            >
              Review next payment pack
            </HeroChipButton>
          ) : procurementFinance ? (
            <HeroChipButton href="/procurement/purchase-orders" icon="cart">
              Open purchase orders
            </HeroChipButton>
          ) : (
            <HeroChipButton href="/warehouse/inventory" icon="box">
              Review inventory value
            </HeroChipButton>
          )
        }
        accessory={
          <div className="flex max-w-[14rem] flex-wrap justify-end gap-1.5">
            {isDemo && <Badge tone="amber">Demo memory</Badge>}
            {warehouseFinance && (
              <Badge tone="emerald">Warehouse Finance</Badge>
            )}
            {procurementFinance && (
              <Badge tone="brand">Procurement Finance</Badge>
            )}
          </div>
        }
      />

      {error && (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
        >
          <p className="min-w-0">
            <span className="font-semibold">
              Some Finance sources are unavailable.
            </span>{" "}
            <span className="break-words">{error}</span>
          </p>
          <button
            type="button"
            className="btn-ghost btn-sm shrink-0"
            disabled={Object.values(retryingSources).some(Boolean)}
            onClick={() => {
              if (failedSources.length) for (const source of failedSources) void retrySource(source);
              else void refresh();
            }}
          >
            <Icon name="rotate" className="h-4 w-4" /> Retry unavailable sources
          </button>
        </div>
      )}

      {data.totals && <p className="text-sm text-muted">Activity period: {data.totals.periodStart} to {data.totals.periodEnd}</p>}
      <FinanceOverview summary={summary} states={data.sourceStates} procurement={procurementFinance} warehouse={warehouseFinance} />
      {data.sourceStates?.inventory === 'error' && <button className="btn-outline" disabled={retryingSources.inventory} onClick={() => void retrySource('inventory')}>Retry inventory source</button>}

      <div className="grid min-w-0 max-w-full gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)] xl:items-start">
        {procurementFinance && (data.sourceStates?.payments === 'error' ? <p role="status">Payment queue unavailable. <button className="btn-outline" disabled={retryingSources.payments} onClick={() => void retrySource('payments')}>Retry payment source</button></p> : <FinanceReviewQueue items={data.payments} />)}
        <Card className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase text-faint">
              Control ownership
            </p>
            <h2 className="mt-1 font-display text-lg font-bold text-ink">
              Review and release from the governed PO
            </h2>
            <p className="mt-1 text-sm text-muted">
              Finance sees the combined trail and posts the payment reference on
              the approved pack. Procurement owns requests and POs; Warehouse
              owns receiving, inspection, counts, and custody.
            </p>
          </div>
          <div className="grid gap-2">
            {procurementFinance && (
              <a
                href="/procurement/purchase-orders"
                className="btn-ghost justify-between"
              >
                Procurement records{" "}
                <Icon name="arrowRight" className="h-4 w-4" />
              </a>
            )}
            {warehouseFinance && (
              <a
                href="/warehouse/inventory"
                className="btn-ghost justify-between"
              >
                Warehouse inventory{" "}
                <Icon name="arrowRight" className="h-4 w-4" />
              </a>
            )}
            {warehouseFinance && (
              <a
                href="/warehouse/approvals"
                className="btn-ghost justify-between"
              >
                Stock adjustment approvals{" "}
                <Icon name="arrowRight" className="h-4 w-4" />
              </a>
            )}
          </div>
        </Card>
      </div>

      {mode === 'supabase' && !mayManageClose && roleCapabilities?.warehouse?.includes('manage_finance_close') && <p role="status">Close actions require certification. <a className="underline" href="/onboarding">Complete Finance onboarding</a></p>}
      {data.sourceStates?.close === 'error' ? <p role="status">Close queue unavailable. <button className="btn-outline" disabled={retryingSources.close} onClick={() => void retrySource('close')}>Retry close source</button></p> : <FinanceClosePanel
        entries={data.closeEntries}
        searchSources={searchSources}
        loadEvidenceOptions={loadEvidenceOptions}
        manage={manageCloseEntry}
        openEvidence={openCloseEvidence}
        canManage={mayManageClose}
        currentActorId={profile.id}
      />}

      {data.sourceStates?.activity === 'error' ? <p role="status">Financial activity unavailable. <button className="btn-outline" disabled={retryingSources.activity} onClick={() => void retrySource('activity')}>Retry activity source</button></p> : <FinanceActivityTable activity={data.activity} canPrepare={mayManageClose} />}
    </div>
  );
}

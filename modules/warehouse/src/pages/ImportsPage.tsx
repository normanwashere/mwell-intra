import { useState, type DragEvent } from 'react';
import type { ImportIssue, ImportValidationResult, WarehouseImportKind } from '@intra/data-kit';
import { useWarehouse } from '@/app/store';
import { downloadText } from '@/app/download';
import { toCsv } from '@/domain/export';
import { Badge, Card, EmptyState, Field, PageHeader, SectionTitle } from '@/components/ui';

interface ImportJob {
  id: string;
  status: string;
  source_rows: number;
  accepted_rows: number;
  rejected_rows: number;
  duplicate_rows: number;
}

interface ImportEvidence {
  checksumSha256?: string;
  sourceFile?: string;
  uploaderId?: string;
  uploaderEmail?: string;
  correctedFrom?: string;
}

interface ValidationResponse {
  job: ImportJob;
  issues: ImportIssue[];
  preview: ImportValidationResult;
  evidence?: ImportEvidence;
  error?: string;
}

interface ReviewJob extends ImportJob {
  filename: string;
  checksum_sha256: string;
  created_by: string;
  created_by_email: string;
  corrected_from?: string | null;
}

const STEPS = ['Select template', 'Validate', 'Review', 'Apply / reconcile'];

export function ImportsPage() {
  const { source, identityId } = useWarehouse();
  const [kind, setKind] = useState<WarehouseImportKind>('locations_bins_v1');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ValidationResponse | null>(null);
  const [correctedFrom, setCorrectedFrom] = useState<string>();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [applied, setApplied] = useState(false);
  const [reviewerEmail, setReviewerEmail] = useState('');
  const [reviewJobs, setReviewJobs] = useState<ReviewJob[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const online = navigator.onLine;
  const live = source === 'supabase';

  const chooseFile = (next: File | null) => {
    setFile(next);
    setResult(null);
    setApplied(false);
    setError('');
  };

  const drop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    chooseFile(event.dataTransfer.files[0] ?? null);
  };

  const validate = async () => {
    if (!file || !online || !live) return;
    setWorking(true);
    setError('');
    try {
      const form = new FormData();
      form.set('action', 'validate');
      form.set('kind', kind);
      form.set('file', file);
      if (correctedFrom) form.set('corrected_from', correctedFrom);
      const response = await fetch('/api/warehouse/imports', { method: 'POST', body: form });
      const payload = await response.json() as ValidationResponse;
      if (!response.ok) throw new Error(payload.error || 'Import validation failed.');
      setResult(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Import validation failed.');
    } finally {
      setWorking(false);
    }
  };

  const apply = async () => {
    if (!result || result.preview.rejectedRows > 0 || result.preview.duplicateRows > 0 || !online) return;
    setWorking(true);
    setError('');
    try {
      const response = await fetch('/api/warehouse/imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'apply',
          job_id: result.job.id,
          idempotency_key: `apply-import-${result.job.id}-${Date.now()}`,
        }),
      });
      const payload = await response.json() as { error?: string; reviewer_email?: string };
      if (!response.ok) throw new Error(payload.error || 'Import apply failed.');
      setReviewerEmail(payload.reviewer_email ?? 'Authenticated reviewer');
      setApplied(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Import apply failed.');
    } finally {
      setWorking(false);
    }
  };

  const startCorrection = () => {
    if (!result) return;
    setCorrectedFrom(result.job.id);
    chooseFile(null);
  };

  const loadReviewQueue = async () => {
    if (!online || !live) return;
    setLoadingQueue(true);
    setError('');
    try {
      const response = await fetch('/api/warehouse/imports');
      const payload = await response.json() as { jobs?: ReviewJob[]; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Review queue could not be loaded.');
      setReviewJobs(payload.jobs ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Review queue could not be loaded.');
    } finally {
      setLoadingQueue(false);
    }
  };

  const reviewJob = (job: ReviewJob) => {
    setResult({
      job,
      issues: [],
      preview: {
        sourceRows: job.source_rows,
        acceptedRows: job.accepted_rows,
        rejectedRows: job.rejected_rows,
        duplicateRows: job.duplicate_rows,
        issues: [],
        normalizedRows: [],
      },
      evidence: {
        checksumSha256: job.checksum_sha256,
        sourceFile: job.filename,
        uploaderId: job.created_by,
        uploaderEmail: job.created_by_email,
        correctedFrom: job.corrected_from ?? undefined,
      },
    });
    setApplied(false);
    setError('');
  };

  const downloadErrors = () => {
    if (!result) return;
    downloadText(`warehouse-import-${result.job.id}-errors.csv`, toCsv(result.issues.map((issue) => ({
      row: issue.row, field: issue.field, code: issue.code, message: issue.message,
    }))));
  };

  const mayApply = Boolean(result && result.preview.rejectedRows === 0 && result.preview.duplicateRows === 0
    && result.evidence?.uploaderId !== identityId);

  return (
    <div className="space-y-4">
      <PageHeader title="Warehouse imports" icon="download" subtitle="Validate, review, and reconcile controlled cutover data" />
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Import steps">
        {STEPS.map((step, index) => <li key={step} className="rounded-lg bg-inset px-3 py-2 text-xs font-semibold text-muted"><span className="mr-2 text-brand-600">{index + 1}</span>{step}</li>)}
      </ol>

      {!online && <p role="alert" className="rounded-lg bg-amber-500/10 p-3 text-sm font-medium text-amber-800 dark:text-amber-200">Connect to the network before validating or applying an import.</p>}
      {!live && <p role="alert" className="rounded-lg bg-amber-500/10 p-3 text-sm font-medium text-amber-800 dark:text-amber-200">Imports require the live Supabase data source. Demo data cannot be import evidence.</p>}
      {error && <p role="alert" className="rounded-lg bg-rose-500/10 p-3 text-sm font-medium text-rose-700 dark:text-rose-300">{error}</p>}
      {correctedFrom && <p className="text-sm font-medium text-ink">Correction of {correctedFrom}. The original evidence remains immutable.</p>}

      <Card>
        <SectionTitle title="Reviewer queue" subtitle="Reopen ready jobs created by another administrator" />
        <button type="button" className="btn-outline w-full justify-center" disabled={!online || !live || loadingQueue} onClick={() => void loadReviewQueue()}>{loadingQueue ? 'Loading...' : 'Load review queue'}</button>
        {reviewJobs.length > 0 && <ul className="mt-3 divide-y divide-line" aria-label="Import review queue">{reviewJobs.map((job) => <li key={job.id} className="flex items-center justify-between gap-3 py-2.5"><div className="min-w-0"><p className="truncate text-sm font-semibold text-ink">{job.filename}</p><p className="text-xs text-faint">{job.accepted_rows} accepted · uploaded by {job.created_by_email}</p></div><button type="button" className="btn-primary btn-sm shrink-0" onClick={() => reviewJob(job)}>Review job</button></li>)}</ul>}
      </Card>

      <Card>
        <SectionTitle title="Select source" subtitle="CSV only · 10 MB · 10,000 data rows" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Template" htmlFor="import-kind">
            <select id="import-kind" className="input" value={kind} onChange={(event) => { setKind(event.target.value as WarehouseImportKind); chooseFile(null); }}>
              <option value="locations_bins_v1">Locations and bins v1</option>
              <option value="products_opening_stock_v1">Products and opening stock v1</option>
            </select>
          </Field>
          <div>
            <label
              aria-label="Import CSV drop zone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={drop}
              className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-brand-400 bg-brand-500/5 p-4 text-center focus-within:ring-2 focus-within:ring-brand-500"
            >
              <span className="text-sm font-semibold text-ink">{file?.name ?? 'Drop a CSV here'}</span>
              <span className="mt-1 text-xs text-faint">or choose a source file</span>
              <input className="sr-only" type="file" accept=".csv,text/csv" aria-label="Choose import CSV" onChange={(event) => chooseFile(event.target.files?.item(0) ?? null)} />
            </label>
          </div>
        </div>
        <button type="button" className="btn-primary mt-4 w-full justify-center" disabled={!file || !online || !live || working} onClick={() => void validate()}>{working ? 'Validating...' : 'Validate file'}</button>
      </Card>

      {result && (
        <>
          <Card>
            <SectionTitle title="Validation review" action={<Badge tone={result.job.status === 'ready' ? 'emerald' : 'rose'}>{result.job.status}</Badge>} />
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Import reconciliation">
              {[
                ['Source', result.preview.sourceRows], ['Accepted', result.preview.acceptedRows],
                ['Rejected', result.preview.rejectedRows], ['Duplicate', result.preview.duplicateRows],
              ].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-inset p-3"><dt className="text-xs text-faint">{label}</dt><dd className="mt-1 text-xl font-bold tabular-nums text-ink">{value}</dd></div>)}
            </dl>
            <p className="mt-3 text-center text-sm font-semibold text-ink">{result.preview.sourceRows} = {result.preview.acceptedRows} + {result.preview.rejectedRows} + {result.preview.duplicateRows}</p>
            <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
              <div><dt className="text-faint">Source file</dt><dd className="break-all text-ink">{result.evidence?.sourceFile ?? file?.name}</dd></div>
              <div><dt className="text-faint">Uploader</dt><dd className="break-all text-ink">{result.evidence?.uploaderEmail ?? 'Authenticated administrator'}</dd></div>
              <div className="sm:col-span-2"><dt className="text-faint">SHA-256 checksum</dt><dd className="break-all font-mono text-ink">{result.evidence?.checksumSha256 ?? 'Recorded by server'}</dd></div>
            </dl>
          </Card>

          {result.issues.length > 0 ? (
            <Card>
              <SectionTitle title="Resolve validation errors" subtitle="Apply is unavailable while any row is rejected or duplicated" />
              <ul className="divide-y divide-line" aria-label="Import errors">
                {result.issues.map((issue, index) => <li key={`${issue.row}-${issue.field}-${index}`} className="py-2.5 text-sm"><span className="font-semibold text-ink">Row {issue.row} · {issue.field}</span><span className="ml-2 text-muted">{issue.message}</span></li>)}
              </ul>
              <div className="mt-3 grid gap-2 sm:grid-cols-2"><button type="button" className="btn-outline justify-center" onClick={downloadErrors}>Download error CSV</button><button type="button" className="btn-primary justify-center" onClick={startCorrection}>Start correction</button></div>
            </Card>
          ) : applied ? (
            <EmptyState icon="check" title="Import applied" message={`Reviewed by ${reviewerEmail}. The accepted rows and immutable activity evidence are now committed.`} />
          ) : (
            <Card>
              <SectionTitle title="Reviewer decision" subtitle="Opening balances and master data are posted atomically" />
              <p className="text-sm text-muted">A different Warehouse Administrator must review and apply this job. The server rejects creator self-approval.</p>
              {mayApply ? <button type="button" className="btn-primary mt-4 w-full justify-center" disabled={working || !online} onClick={() => void apply()}>{working ? 'Applying...' : 'Apply import'}</button> : <p className="mt-3 rounded-lg bg-inset p-3 text-sm font-medium text-ink">Waiting for a separate reviewer.</p>}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

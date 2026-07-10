import { createHash, randomUUID } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { validateImportRows, type WarehouseImportKind } from '@intra/data-kit';
import { createSupabaseServerClient } from '@shell/lib/supabase/server';
import { SUPABASE_URL } from '@shell/lib/supabase/env';
import {
  authorizeWarehouseImport,
  ImportAuthorizationError,
} from '@shell/lib/warehouse/importAuthorization';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BUCKET = 'warehouse-imports';
const MAX_BYTES = 10 * 1024 * 1024;
const KINDS = new Set<WarehouseImportKind>([
  'locations_bins_v1',
  'products_opening_stock_v1',
]);

const errorResponse = (message: string, status: number) =>
  NextResponse.json({ error: message }, { status });

function adminClient() {
  const key = process.env.SUPABASE_SECRET_KEY?.trim()
    || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!SUPABASE_URL || !key) throw new ImportAuthorizationError('Import storage is not configured.', 503);
  return createClient(SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function parseCsv(source: string): Record<string, string>[] {
  if (source.includes('\uFFFD')) throw new Error('CSV must be valid UTF-8.');
  return parse(source, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    relax_column_count: false,
  }) as Record<string, string>[];
}

async function validationContext(client: ReturnType<typeof adminClient>) {
  const [{ data: locations, error: locationError }, { data: bins, error: binError }] =
    await Promise.all([
      client.schema('warehouse').from('locations').select('id'),
      client.schema('warehouse').from('storage_areas').select('location_id,code'),
    ]);
  if (locationError) throw new Error(locationError.message);
  if (binError) throw new Error(binError.message);
  return {
    knownLocationIds: (locations ?? []).map((row) => String(row.id)),
    knownBinKeys: (bins ?? []).map((row) => `${row.location_id}|${row.code}`),
  };
}

export async function GET() {
  try {
    const userClient = await createSupabaseServerClient('warehouse');
    if (!userClient) return errorResponse('Supabase is not configured.', 503);
    await authorizeWarehouseImport(userClient);
    const admin = adminClient();
    const { data: jobs, error } = await admin.schema('warehouse')
      .from('import_jobs')
      .select('id,status,source_rows,accepted_rows,rejected_rows,duplicate_rows,filename,checksum_sha256,created_by,created_by_email,corrected_from,created_at')
      .eq('status', 'ready')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return NextResponse.json({ jobs: jobs ?? [] });
  } catch (cause) {
    if (cause instanceof ImportAuthorizationError) return errorResponse(cause.message, cause.status);
    return errorResponse(cause instanceof Error ? cause.message : 'Import review queue failed.', 400);
  }
}

export async function POST(request: NextRequest) {
  try {
    const userClient = await createSupabaseServerClient('warehouse');
    if (!userClient) return errorResponse('Supabase is not configured.', 503);
    const user = await authorizeWarehouseImport(userClient);
    const admin = adminClient();
    const contentType = request.headers.get('content-type') ?? '';

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      if (form.get('action') !== 'validate') return errorResponse('Invalid import action.', 400);
      const kind = String(form.get('kind') ?? '') as WarehouseImportKind;
      if (!KINDS.has(kind)) return errorResponse('Invalid import kind.', 400);
      const file = form.get('file');
      if (!(file instanceof File)) return errorResponse('CSV file is required.', 400);
      if (file.size > MAX_BYTES) return errorResponse('CSV file exceeds the 10 MB limit.', 413);
      if (!file.name.toLowerCase().endsWith('.csv')) return errorResponse('Only CSV files are accepted.', 415);

      const source = await file.text();
      const rows = parseCsv(source);
      const context = kind === 'products_opening_stock_v1'
        ? await validationContext(admin)
        : undefined;
      const result = validateImportRows(kind, rows, context);
      const checksum = createHash('sha256').update(source, 'utf8').digest('hex');
      const storagePath = `${user.id}/${Date.now()}-${randomUUID()}.csv`;
      const { data: bucket } = await admin.storage.getBucket(BUCKET);
      if (!bucket) {
        const { error } = await admin.storage.createBucket(BUCKET, {
          public: false,
          fileSizeLimit: MAX_BYTES,
          allowedMimeTypes: ['text/csv', 'application/vnd.ms-excel'],
        });
        if (error && !/already exists/i.test(error.message)) throw new Error(error.message);
      }
      const { error: uploadError } = await admin.storage
        .from(BUCKET)
        .upload(storagePath, new Blob([source], { type: 'text/csv;charset=utf-8' }), {
          contentType: 'text/csv;charset=utf-8',
          upsert: false,
        });
      if (uploadError) throw new Error(uploadError.message);

      const status = result.rejectedRows > 0 ? 'invalid' : 'ready';
      const { data: job, error: jobError } = await admin.schema('warehouse')
        .from('import_jobs')
        .insert({
          import_kind: kind,
          schema_version: '1',
          filename: file.name,
          storage_path: storagePath,
          checksum_sha256: checksum,
          source_rows: result.sourceRows,
          accepted_rows: result.acceptedRows,
          rejected_rows: result.rejectedRows,
          duplicate_rows: result.duplicateRows,
          status,
          created_by: user.id,
          created_by_email: user.email ?? '',
          corrected_from: form.get('corrected_from') || null,
        })
        .select('id,status,source_rows,accepted_rows,rejected_rows,duplicate_rows')
        .single();
      if (jobError) throw new Error(jobError.message);
      if (result.issues.length > 0) {
        const { error } = await admin.schema('warehouse').from('import_errors').insert(
          result.issues.map((item) => ({
            import_job_id: job.id,
            row_number: Math.max(1, item.row),
            field_name: item.field,
            error_code: item.code,
            message: item.message,
          })),
        );
        if (error) throw new Error(error.message);
      }
      return NextResponse.json({
        job,
        issues: result.issues,
        preview: result,
        evidence: {
          checksumSha256: checksum,
          sourceFile: file.name,
          uploaderId: user.id,
          uploaderEmail: user.email ?? '',
          correctedFrom: form.get('corrected_from') || null,
        },
      }, { status: 201 });
    }

    const body = await request.json() as {
      action?: string;
      job_id?: string;
      idempotency_key?: string;
    };
    if (body.action !== 'apply' || !body.job_id || !body.idempotency_key) {
      return errorResponse('Apply requires job_id and idempotency_key.', 400);
    }
    const { data: job, error: jobError } = await admin.schema('warehouse')
      .from('import_jobs')
      .select('id,import_kind,schema_version,storage_path,checksum_sha256,status,created_by')
      .eq('id', body.job_id)
      .single();
    if (jobError || !job) return errorResponse('Import job not found.', 404);
    if (job.created_by === user.id) return errorResponse('Import creator cannot review or apply the same job.', 403);
    if (job.status !== 'ready') return errorResponse('Only ready import jobs can be applied.', 409);
    const { data: sourceFile, error: downloadError } = await admin.storage
      .from(BUCKET)
      .download(job.storage_path);
    if (downloadError || !sourceFile) throw new Error(downloadError?.message ?? 'Import source missing.');
    const source = await sourceFile.text();
    const checksum = createHash('sha256').update(source, 'utf8').digest('hex');
    if (checksum !== job.checksum_sha256) return errorResponse('Import source checksum mismatch.', 409);
    const kind = job.import_kind as WarehouseImportKind;
    const rows = parseCsv(source);
    const context = kind === 'products_opening_stock_v1'
      ? await validationContext(admin)
      : undefined;
    const result = validateImportRows(kind, rows, context);
    if (result.rejectedRows > 0) return errorResponse('Import source no longer validates.', 409);

    const { data, error } = await userClient.rpc('apply_import_job', {
      payload: {
        idempotency_key: body.idempotency_key,
        job_id: job.id,
        checksum_sha256: checksum,
        schema_version: job.schema_version,
        normalized_rows: result.normalizedRows,
      },
    });
    if (error) return errorResponse(error.message, 403);
    return NextResponse.json({
      result: data,
      reviewer_id: user.id,
      reviewer_email: user.email ?? '',
    });
  } catch (cause) {
    if (cause instanceof ImportAuthorizationError) {
      return errorResponse(cause.message, cause.status);
    }
    return errorResponse(cause instanceof Error ? cause.message : 'Warehouse import failed.', 400);
  }
}

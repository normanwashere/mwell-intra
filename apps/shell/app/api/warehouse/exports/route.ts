import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@shell/lib/supabase/server';
import {
  governedExportFilename,
  toCsv,
  type CsvRow,
  type WarehouseExportKind,
} from '@warehouse/domain/export';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const EXPORT_KINDS = new Set<WarehouseExportKind>([
  'inventory',
  'movements',
  'allocations',
  'inventory_position',
  'quality',
  'cycle_counts',
]);

type UntypedRow = Record<string, unknown>;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function asRows(value: unknown): UntypedRow[] {
  return Array.isArray(value) ? (value as UntypedRow[]) : [];
}

function csvValue(value: unknown): string | number {
  return typeof value === 'number' || typeof value === 'string' ? value : '';
}

async function buildExportRows(
  client: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  kind: WarehouseExportKind,
): Promise<CsvRow[]> {
  const reportingViews: Partial<Record<WarehouseExportKind, { table: string; projection: string }>> = {
    inventory_position: {
      table: 'inventory_position_v1',
      projection: 'product_id,location_id,bin_id,on_hand,committed,held,unavailable,available',
    },
    quality: {
      table: 'bi_quality_v1',
      projection: 'id,created_at,source_type,source_id,product_id,sku,location_id,bin_id,lot_id,serial_number,quantity,disposition,reason,active_hold_quantity',
    },
    cycle_counts: {
      table: 'bi_cycle_counts_v1',
      projection: 'id,cycle_count_id,location_id,bin_id,status,submitted_at,product_id,expected,counted,variance',
    },
  };
  const reportingView = reportingViews[kind];
  if (reportingView) {
    const { data, error } = await client
      .from(reportingView.table)
      .select(reportingView.projection)
      .limit(100000);
    if (error) throw new Error(error.message);
    return asRows(data).map((row) => Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, csvValue(value)]),
    ));
  }
  if (kind === 'movements') {
    const [movementsResult, productsResult] = await Promise.all([
      client
        .from('movements')
        .select(
          'created_at,type,product_id,quantity,from_location_id,to_location_id,serial_number,reference,actor',
        )
        .order('created_at', { ascending: false })
        .limit(100000),
      client.from('products').select('id,sku').limit(10000),
    ]);
    if (movementsResult.error) throw new Error(movementsResult.error.message);
    if (productsResult.error) throw new Error(productsResult.error.message);
    const skuById = new Map(
      asRows(productsResult.data).map((row) => [String(row.id), String(row.sku)]),
    );
    return asRows(movementsResult.data).map((row) => ({
      createdAt: csvValue(row.created_at),
      type: csvValue(row.type),
      sku: skuById.get(String(row.product_id)) ?? String(row.product_id ?? ''),
      quantity: csvValue(row.quantity),
      fromLocationId: csvValue(row.from_location_id),
      toLocationId: csvValue(row.to_location_id),
      serialNumber: csvValue(row.serial_number),
      reference: csvValue(row.reference),
      actor: csvValue(row.actor),
    }));
  }

  if (kind === 'allocations') {
    const [allocationsResult, productsResult, eventsResult] = await Promise.all([
      client
        .from('allocations')
        .select('event_id,product_id,quantity,status,promotional,created_at')
        .order('created_at', { ascending: false })
        .limit(100000),
      client.from('products').select('id,sku').limit(10000),
      client.from('events').select('id,name').limit(10000),
    ]);
    if (allocationsResult.error) throw new Error(allocationsResult.error.message);
    if (productsResult.error) throw new Error(productsResult.error.message);
    if (eventsResult.error) throw new Error(eventsResult.error.message);
    const skuById = new Map(
      asRows(productsResult.data).map((row) => [String(row.id), String(row.sku)]),
    );
    const eventById = new Map(
      asRows(eventsResult.data).map((row) => [String(row.id), String(row.name)]),
    );
    return asRows(allocationsResult.data).map((row) => ({
      event: eventById.get(String(row.event_id)) ?? String(row.event_id ?? ''),
      sku: skuById.get(String(row.product_id)) ?? String(row.product_id ?? ''),
      quantity: csvValue(row.quantity),
      status: csvValue(row.status),
      promotional: row.promotional === true ? 'yes' : 'no',
      createdAt: csvValue(row.created_at),
    }));
  }

  const [productsResult, stockResult, unitsResult] = await Promise.all([
    client
      .from('products')
      .select('id,sku,name,category,serialized,unit_cost')
      .order('sku')
      .limit(10000),
    client.from('stock_levels').select('product_id,quantity').limit(100000),
    client
      .from('inventory_units')
      .select('product_id,status')
      .eq('status', 'in_stock')
      .limit(100000),
  ]);
  if (productsResult.error) throw new Error(productsResult.error.message);
  if (stockResult.error) throw new Error(stockResult.error.message);
  if (unitsResult.error) throw new Error(unitsResult.error.message);
  const stockByProduct = new Map<string, number>();
  for (const row of asRows(stockResult.data)) {
    const id = String(row.product_id);
    stockByProduct.set(id, (stockByProduct.get(id) ?? 0) + Number(row.quantity ?? 0));
  }
  const unitsByProduct = new Map<string, number>();
  for (const row of asRows(unitsResult.data)) {
    const id = String(row.product_id);
    unitsByProduct.set(id, (unitsByProduct.get(id) ?? 0) + 1);
  }
  return asRows(productsResult.data).map((row) => {
    const id = String(row.id);
    const available = row.serialized === true
      ? unitsByProduct.get(id) ?? 0
      : stockByProduct.get(id) ?? 0;
    const unitCost = Number(row.unit_cost ?? 0);
    return {
      sku: csvValue(row.sku),
      name: csvValue(row.name),
      category: csvValue(row.category),
      available,
      unitCost,
      value: available * unitCost,
    };
  });
}

export async function POST(request: NextRequest) {
  const client = await createSupabaseServerClient('warehouse');
  if (!client) return jsonError('Supabase is not configured.', 503);
  const { data: verified, error: authError } = await client.auth.getUser();
  if (authError || !verified.user) return jsonError('Authentication required.', 401);

  let body: { kind?: string; corrected_from?: string };
  try {
    body = (await request.json()) as { kind?: string; corrected_from?: string };
  } catch {
    return jsonError('Invalid JSON request.', 400);
  }
  if (!body.kind || !EXPORT_KINDS.has(body.kind as WarehouseExportKind)) {
    return jsonError('Invalid warehouse export type.', 400);
  }
  const kind = body.kind as WarehouseExportKind;

  try {
    const rows = await buildExportRows(client, kind);
    const csv = toCsv(rows);
    const filename = governedExportFilename(kind);
    const id = `exp_${crypto.randomUUID().replaceAll('-', '')}`;
    const storagePath = `exports/${verified.user.id}/${id}.csv`;
    const bytes = new TextEncoder().encode(`\uFEFF${csv}`);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const checksum = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    const { error: uploadError } = await client.storage
      .from('warehouse-exports')
      .upload(storagePath, bytes, { contentType: 'text/csv', upsert: false });
    if (uploadError) throw new Error(uploadError.message);

    const { data: job, error: registerError } = await client.rpc(
      'register_export_job',
      {
        payload: {
          id,
          export_type: kind,
          filename,
          storage_path: storagePath,
          checksum_sha256: checksum,
          row_count: rows.length,
          corrected_from: body.corrected_from,
        },
      },
    );
    if (registerError) {
      await client.storage.from('warehouse-exports').remove([storagePath]);
      throw new Error(registerError.message);
    }

    const { data: prepared, error: prepareError } = await client.rpc(
      'prepare_export_download',
      { payload: { export_id: id } },
    );
    if (prepareError) throw new Error(prepareError.message);
    const download = prepared as unknown as {
      storage_path: string;
      filename: string;
      expires_in: number;
    };
    const { data: signed, error: signedError } = await client.storage
      .from('warehouse-exports')
      .createSignedUrl(download.storage_path, download.expires_in, {
        download: download.filename,
      });
    if (signedError) throw new Error(signedError.message);

    return NextResponse.json({ job, download_url: signed.signedUrl }, { status: 201 });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Warehouse export failed.';
    return jsonError(message, 403);
  }
}

export async function GET() {
  const client = await createSupabaseServerClient('warehouse');
  if (!client) return jsonError('Supabase is not configured.', 503);
  const { data: verified, error: authError } = await client.auth.getUser();
  if (authError || !verified.user) return jsonError('Authentication required.', 401);
  const { data, error } = await client
    .from('export_jobs')
    .select(
      'id,export_type,filename,checksum_sha256,row_count,status,created_by_email,created_at,reviewed_at,review_note,corrected_from',
    )
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return jsonError(error.message, 403);
  return NextResponse.json({ jobs: data ?? [] });
}

export async function PATCH(request: NextRequest) {
  const client = await createSupabaseServerClient('warehouse');
  if (!client) return jsonError('Supabase is not configured.', 503);
  const { data: verified, error: authError } = await client.auth.getUser();
  if (authError || !verified.user) return jsonError('Authentication required.', 401);

  let body: { export_id?: string; status?: string; review_note?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError('Invalid JSON request.', 400);
  }
  if (!body.export_id || !/^exp_[A-Za-z0-9_-]{12,}$/.test(body.export_id)) {
    return jsonError('A valid export ID is required.', 400);
  }
  if (body.status !== 'reviewed' && body.status !== 'correction_required') {
    return jsonError('Invalid export review status.', 400);
  }
  if (body.status === 'correction_required' && !body.review_note?.trim()) {
    return jsonError('A review note is required for corrections.', 400);
  }

  const { data, error } = await client.rpc('review_export_job', {
    payload: {
      export_id: body.export_id,
      status: body.status,
      review_note: body.review_note?.trim(),
    },
  });
  if (error) return jsonError(error.message, 403);
  return NextResponse.json({ job: data });
}

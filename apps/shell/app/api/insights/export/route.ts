import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@shell/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ExportRow = Record<string, unknown>;

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows: ExportRow[]) {
  const columns = [
    "id",
    "area",
    "label",
    "value",
    "unit",
    "target_direction",
    "target_min",
    "target_max",
    "data_status",
    "sample_count",
    "reporting_period_start",
    "reporting_period_end",
    "source_updated_at",
    "extracted_at",
  ];
  return [
    columns.join(","),
    ...rows.map((row) =>
      columns.map((column) => csvCell(row[column])).join(","),
    ),
  ].join("\r\n");
}

function exportFilename(now = new Date()) {
  return `mwell-intra-insights_snapshot-${now
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.[0-9]{3}Z$/, "Z")}.csv`;
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST() {
  const client = await createSupabaseServerClient("core");
  if (!client) return errorResponse("Supabase is not configured.", 503);

  const { data: verified, error: authError } = await client.auth.getUser();
  if (authError || !verified.user)
    return errorResponse("Authentication required.", 401);

  try {
    const { data, error } = await client
      .from("v_insights_snapshot")
      .select(
        "id,area,label,value,unit,target_direction,target_min,target_max,data_status,sample_count,reporting_period_start,reporting_period_end,source_updated_at,extracted_at",
      )
      .limit(500);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as ExportRow[];
    const csv = toCsv(rows);
    const bytes = new TextEncoder().encode(`\uFEFF${csv}`);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const checksum = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const id = `exp_${crypto.randomUUID().replaceAll("-", "")}`;
    const filename = exportFilename();
    const storagePath = `exports/${verified.user.id}/${id}.csv`;

    const { error: uploadError } = await client.storage
      .from("warehouse-exports")
      .upload(storagePath, bytes, { contentType: "text/csv", upsert: false });
    if (uploadError) throw new Error(uploadError.message);

    const { error: registerError } = await client.rpc(
      "register_insights_export",
      {
        payload: {
          id,
          filename,
          storage_path: storagePath,
          checksum_sha256: checksum,
          row_count: rows.length,
        },
      },
    );
    if (registerError) {
      await client.storage.from("warehouse-exports").remove([storagePath]);
      throw new Error(registerError.message);
    }

    const { data: prepared, error: prepareError } = await client
      .schema("warehouse")
      .rpc("prepare_export_download", { payload: { export_id: id } });
    if (prepareError) throw new Error(prepareError.message);
    const download = prepared as unknown as {
      storage_path: string;
      filename: string;
      expires_in: number;
    };
    const { data: signed, error: signedError } = await client.storage
      .from("warehouse-exports")
      .createSignedUrl(download.storage_path, download.expires_in, {
        download: download.filename,
      });
    if (signedError) throw new Error(signedError.message);

    return NextResponse.json(
      { export_id: id, row_count: rows.length, download_url: signed.signedUrl },
      { status: 201 },
    );
  } catch (cause) {
    return errorResponse(
      cause instanceof Error ? cause.message : "Insights export failed.",
      403,
    );
  }
}

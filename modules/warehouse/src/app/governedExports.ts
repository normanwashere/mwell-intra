import type { DataSource } from '@intra/data-kit';
import type { WarehouseExportKind } from '@/domain/export';

interface PreparedExport {
  filename: string;
  downloadUrl?: string;
  demoContent?: string;
}

interface ExportResponse {
  job?: { filename?: string };
  download_url?: string;
  error?: string;
}

export async function prepareWarehouseExport({
  source,
  kind,
  demoContent,
  request = fetch,
}: {
  source: DataSource;
  kind: WarehouseExportKind;
  demoContent: string;
  request?: typeof fetch;
}): Promise<PreparedExport> {
  if (source === 'memory') {
    return {
      filename: `demo-${kind}.csv`,
      demoContent,
    };
  }

  const response = await request('/api/warehouse/exports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind }),
  });
  const payload = (await response.json()) as ExportResponse;
  if (!response.ok || !payload.download_url || !payload.job?.filename) {
    throw new Error(payload.error || 'The governed export could not be prepared.');
  }
  return {
    filename: payload.job.filename,
    downloadUrl: payload.download_url,
  };
}

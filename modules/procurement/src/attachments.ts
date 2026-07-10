import type { RequestAttachment } from './types';

export const REQUEST_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const REQUEST_ATTACHMENT_BUCKET = 'procurement-requests';
export const REQUEST_ATTACHMENT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

export interface PendingRequestAttachment {
  file: File;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByEmail?: string;
  kind?: RequestAttachment['kind'];
}

interface StorageClient {
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        file: File,
        options: { contentType: string; upsert: boolean },
      ) => Promise<{ error: { message: string } | null }>;
      remove: (paths: string[]) => Promise<{ error: { message: string } | null }>;
    };
  };
}

export interface GovernedAccessClient {
  schema: (schema: string) => {
    rpc: (
      fn: string,
      args: { payload: { attachment_id: string } },
    ) => Promise<{
      data: {
        bucket: string;
        storage_path: string;
        filename: string;
        expires_in: number;
      } | null;
      error: { message: string } | null;
    }>;
  };
  storage: {
    from: (bucket: string) => {
      createSignedUrl: (
        path: string,
        expiresIn: number,
        options: { download: string },
      ) => Promise<{
        data: { signedUrl: string } | null;
        error: { message: string } | null;
      }>;
    };
  };
}

export function validateRequestAttachment(file: { type: string; size: number }): void {
  if (!REQUEST_ATTACHMENT_MIME_TYPES.has(file.type)) {
    throw new Error(
      `Unsupported file type (${file.type || 'unknown'}). Allowed: JPEG, PNG, WebP, PDF.`,
    );
  }
  if (file.size <= 0) throw new Error('The selected file is empty.');
  if (file.size > REQUEST_ATTACHMENT_MAX_BYTES) {
    throw new Error('File is larger than the 10 MB limit.');
  }
}

function safeFilename(filename: string): string {
  const basename = filename.split(/[\\/]/).pop() || 'attachment';
  const normalized = basename
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.]+/, '')
    .replace(/_+\./g, '.')
    .slice(0, 120);
  return normalized || 'attachment';
}

export function buildRequestAttachmentPath(
  requestId: string,
  attachmentId: string,
  filename: string,
): string {
  return `request/${requestId}/${attachmentId}-${safeFilename(filename)}`;
}

export function attachmentMetadataForRpc(
  attachment: RequestAttachment,
): Record<string, unknown> {
  return {
    id: attachment.id,
    filename: attachment.filename,
    mime_type: attachment.mimeType,
    size_bytes: attachment.sizeBytes,
    storage_path: attachment.storagePath,
    sha256: attachment.sha256,
    uploaded_at: attachment.uploadedAt,
    uploaded_by_email: attachment.uploadedByEmail,
    kind: attachment.kind,
  };
}

function newAttachmentId(): string {
  const value = globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `att_${value.replaceAll('-', '')}`;
}

async function sha256(file: File): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read attachment.'));
    reader.readAsDataURL(file);
  });
}

export async function materializeMemoryAttachments(
  pending: readonly PendingRequestAttachment[],
): Promise<RequestAttachment[]> {
  return Promise.all(
    pending.map(async (attachment) => {
      validateRequestAttachment(attachment.file);
      return {
        id: newAttachmentId(),
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        dataUrl: await readAsDataUrl(attachment.file),
        uploadedAt: new Date().toISOString(),
        uploadedByEmail: attachment.uploadedByEmail,
        kind: attachment.kind,
      };
    }),
  );
}

export async function removeUploadedRequestAttachments(
  client: StorageClient,
  paths: readonly string[],
): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await client.storage.from(REQUEST_ATTACHMENT_BUCKET).remove([...paths]);
  if (error) throw new Error(`Could not clean up uploaded attachment: ${error.message}`);
}

export async function uploadRequestAttachments(
  client: StorageClient,
  requestId: string,
  pending: readonly PendingRequestAttachment[],
): Promise<RequestAttachment[]> {
  const uploaded: RequestAttachment[] = [];
  try {
    for (const attachment of pending) {
      validateRequestAttachment(attachment.file);
      const id = newAttachmentId();
      const storagePath = buildRequestAttachmentPath(requestId, id, attachment.filename);
      const [{ error }, checksum] = await Promise.all([
        client.storage.from(REQUEST_ATTACHMENT_BUCKET).upload(storagePath, attachment.file, {
          contentType: attachment.mimeType,
          upsert: false,
        }),
        sha256(attachment.file),
      ]);
      if (error) throw new Error(`Could not upload ${attachment.filename}: ${error.message}`);
      uploaded.push({
        id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        storagePath,
        sha256: checksum,
        uploadedAt: new Date().toISOString(),
        uploadedByEmail: attachment.uploadedByEmail,
        kind: attachment.kind,
      });
    }
    return uploaded;
  } catch (error) {
    await removeUploadedRequestAttachments(
      client,
      uploaded.flatMap((attachment) => attachment.storagePath ? [attachment.storagePath] : []),
    ).catch(() => undefined);
    throw error;
  }
}

export async function createGovernedAttachmentUrl(
  client: GovernedAccessClient,
  attachmentId: string,
): Promise<{ url: string; filename: string }> {
  const prepared = await client.schema('procurement').rpc(
    'prepare_request_attachment_access',
    { payload: { attachment_id: attachmentId } },
  );
  if (prepared.error) throw new Error(prepared.error.message);
  if (!prepared.data?.storage_path) throw new Error('Attachment access was not prepared.');

  const expiresIn = Math.min(Math.max(prepared.data.expires_in || 60, 1), 60);
  const signed = await client.storage.from(prepared.data.bucket).createSignedUrl(
    prepared.data.storage_path,
    expiresIn,
    { download: prepared.data.filename },
  );
  if (signed.error) throw new Error(signed.error.message);
  if (!signed.data?.signedUrl) throw new Error('Signed attachment URL was not created.');
  return { url: signed.data.signedUrl, filename: prepared.data.filename };
}

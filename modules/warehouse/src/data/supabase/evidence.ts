import type { SessionValue } from '@intra/auth';
import { normalizeSafeHttpsUrl } from '@intra/data-kit';

/**
 * Durable evidence storage.
 *
 * In live (Supabase) mode photos are uploaded to a private `evidence` Storage
 * bucket and the returned object PATH is persisted in `evidence_urls`. This
 * keeps movement/receipt rows small (no base64) and lets evidence be viewed
 * later via signed URLs. In memory mode we fall back to an inline base64 data
 * URL so capture still works end-to-end for tests/demo.
 *
 * Stored values are intentionally indistinguishable from the caller's
 * perspective: a string per photo. Use `resolveEvidenceUrl` to turn a path into
 * a displayable URL.
 */

const BUCKET = 'evidence';
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

export type EvidenceSession = Pick<SessionValue, 'mode' | 'supabaseClient'>;

function isSafeRasterDataUrl(value: string): boolean {
  return /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value);
}

function isTrustedAppEvidencePath(value: string): boolean {
  return /^\/uat-evidence\/[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|webp|svg)$/i.test(value);
}

function storageObjectPath(value: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('/') || value.includes('\\')) {
    return null;
  }
  const path = value.startsWith('evidence/') ? value.slice('evidence/'.length) : value;
  const parts = path.split('/');
  if (parts.length < 2 || parts.some((part) => !part || part === '.' || part === '..')) {
    return null;
  }
  return path;
}

/**
 * Uploads one photo and returns the value to persist. Returns a base64 data URL
 * only in explicitly selected memory mode. Live storage failures never fall back.
 */
export async function uploadEvidence(
  dataUrl: string,
  reference: string,
  session: EvidenceSession,
): Promise<string> {
  if (!isSafeRasterDataUrl(dataUrl)) throw new Error('Evidence must be PNG, JPEG, WebP or GIF.');
  const base64 = dataUrl.split(',')[1] ?? '';
  const bytes = decodeBase64(base64);
  if (bytes.length > 8 * 1024 * 1024) throw new Error('Evidence exceeds 8 MiB.');
  if (session?.mode === 'memory') return dataUrl;
  const client = session?.supabaseClient;
  if (session?.mode !== 'supabase' || !client) throw new Error('Authenticated evidence storage is unavailable.');
  const mime = dataUrl.slice(5, dataUrl.indexOf(';')).toLowerCase();
  const ext = mime === 'image/jpeg' || mime === 'image/jpg' ? 'jpg' : mime.slice(6);
  const path = `${reference}/${crypto.randomUUID()}.${ext}`;
  if (!storageObjectPath(path)) throw new Error('Invalid evidence reference.');
  const { error } = await client.storage
    .from(BUCKET)
    .upload(path, bytes, {
      contentType: mime,
      upsert: false,
    });
  if (error) {
    throw new Error(`Evidence upload failed: ${error.message}`);
  }
  return path;
}

/** Upload every captured data URL; returns the persisted values in order. */
export async function uploadEvidenceBatch(
  dataUrls: string[],
  reference: string,
  session: EvidenceSession,
): Promise<string[]> {
  return Promise.all(dataUrls.map((u) => uploadEvidence(u, reference, session)));
}

/**
 * Resolves a persisted evidence value (a storage path or a data URL) into a URL
 * an <img> can render. Storage paths become short-lived signed URLs; data URLs
 * pass through. Returns null if a signed URL can't be created.
 */
export async function resolveEvidenceUrl(value: string, client: SessionValue['supabaseClient'] = null): Promise<string | null> {
  if (isSafeRasterDataUrl(value) || isTrustedAppEvidencePath(value)) return value;
  const storagePath = storageObjectPath(value);
  if (!storagePath) return normalizeSafeHttpsUrl(value);
  if (!client) return null;
  try {
    const { data, error } = await client.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    if (error) return null;
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Durable evidence storage helpers.
 *
 * In live (Supabase) mode photos are uploaded to a private `evidence` Storage
 * bucket and the returned object PATH is persisted in `evidence_urls`. This
 * keeps movement/receipt rows small (no base64) and lets evidence be viewed
 * later via signed URLs. When no client is provided (memory / demo mode) — or
 * the upload fails — we fall back to an inline base64 data URL so capture still
 * works end-to-end for tests and offline demo.
 *
 * Stored values are intentionally indistinguishable from the caller's
 * perspective: a string per photo. Use `resolveEvidenceUrl` to turn a path into
 * a displayable URL.
 *
 * Adaptation note (spec §12 step 2): the source file lived in
 * `src/data/supabase/evidence.ts` and reached for a singleton client via
 * `getSupabaseClient()` (which itself read `import.meta.env`). Inside
 * `@intra/data-kit` the client is INJECTED — pass the same client the app
 * already uses for auth/data. This keeps the package runtime-agnostic (Next.js,
 * Vite, Node, edge) and hoists env ownership to the host.
 */

const BUCKET = 'evidence';
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

function isDataUrl(s: string): boolean {
  return s.startsWith('data:');
}

function isStoragePath(s: string): boolean {
  return s.startsWith('evidence/') || s.includes('/storage/v1/object/');
}

/**
 * Uploads one photo and returns the value to persist. Returns the original
 * `dataUrl` unchanged when no client is available or the value isn't a data
 * URL, so the caller can always store a string per photo without branching.
 */
export async function uploadEvidence(
  client: SupabaseClient | null | undefined,
  dataUrl: string,
  reference: string,
): Promise<string> {
  if (!client || !isDataUrl(dataUrl)) {
    return dataUrl; // memory mode, or already a non-data value
  }
  const base64 = dataUrl.split(',')[1] ?? '';
  const mime = (dataUrl.match(/^data:(.+);/) ?? [])[1] ?? 'image/jpeg';
  const ext = mime === 'image/png' ? 'png' : 'jpg';
  const path = `${reference}/${crypto.randomUUID()}.${ext}`;
  const { error } = await client.storage
    .from(BUCKET)
    .upload(path, decodeBase64(base64), {
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
  client: SupabaseClient | null | undefined,
  dataUrls: string[],
  reference: string,
): Promise<string[]> {
  return Promise.all(dataUrls.map((u) => uploadEvidence(client, u, reference)));
}

/**
 * Resolves a persisted evidence value (a storage path or a data URL) into a URL
 * an <img> can render. Storage paths become short-lived signed URLs; data URLs
 * pass through. Returns null when a signed URL can't be created.
 */
export async function resolveEvidenceUrl(
  client: SupabaseClient | null | undefined,
  value: string,
): Promise<string | null> {
  if (isDataUrl(value)) return value;
  if (!isStoragePath(value) || !client) {
    // Unknown shape — best effort: treat as a direct URL.
    return value;
  }
  try {
    const path = value.startsWith('evidence/')
      ? value.slice('evidence/'.length)
      : value;
    const { data, error } = await client.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error) return null;
    return data.signedUrl;
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

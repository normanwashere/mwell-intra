import type { SupabaseClient } from '@supabase/supabase-js';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf',
};

/** Private warehouse evidence: persist the path, resolve access only when opening. */
export async function uploadEvidenceDocument(client: Pick<SupabaseClient, 'storage'> | null | undefined, file: File, reference: string): Promise<string> {
  const extension = EXTENSIONS[file.type];
  if (!extension) throw new Error('Unsupported file type. Choose JPEG, PNG, WebP or PDF.');
  if (file.size <= 0 || file.size > 4 * 1024 * 1024) throw new Error('Choose a non-empty file up to 4 MB.');
  if (!client) throw new Error('Private evidence uploads require a signed-in connection.');
  if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(reference)) throw new Error('Select a valid evidence record before uploading.');
  const path = `${reference}/${crypto.randomUUID()}.${extension}`;
  const { error } = await client.storage.from('evidence').upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(`Evidence upload failed: ${error.message}`);
  return path;
}

export async function resolveEvidenceDocument(client: Pick<SupabaseClient, 'storage'> | null | undefined, path: string): Promise<string> {
  if (!client || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(path) || path.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error('Evidence is unavailable for this record.');
  }
  const { data, error } = await client.storage.from('evidence').createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw new Error('Evidence access was denied or expired. Try opening it again.');
  return data.signedUrl;
}

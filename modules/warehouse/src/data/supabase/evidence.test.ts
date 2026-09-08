import { describe, expect, it, vi } from 'vitest';
import { resolveEvidenceUrl, uploadEvidence, type EvidenceSession } from './evidence';

describe('evidence storage boundary', () => {
  it.each(['svg+xml', 'heic', 'avif'])('rejects unsupported image/%s before storage', async mime => {
    await expect(uploadEvidence(`data:image/${mime};base64,eA==`, 'receipt/1', { mode: 'memory', supabaseClient: null })).rejects.toThrow('PNG, JPEG');
  });
  it.each(['png', 'jpeg', 'webp', 'gif'])('preserves image/%s content type and extension', async mime => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const client = { storage: { from: () => ({ upload }) } } as unknown as EvidenceSession['supabaseClient'];
    const path = await uploadEvidence(`data:image/${mime};base64,eA==`, 'receipt/1', { mode: 'supabase', supabaseClient: client });
    expect(path).toMatch(new RegExp(`\\.${mime === 'jpeg' ? 'jpg' : mime}$`));
    expect(upload.mock.calls[0]![2]).toEqual({ contentType: `image/${mime}`, upsert: false });
  });
  it('never treats missing configuration as memory', async () => {
    await expect(uploadEvidence('data:image/png;base64,eA==', 'receipt/1', undefined as unknown as EvidenceSession)).rejects.toThrow('Authenticated');
    expect(await resolveEvidenceUrl('receipt/1/photo.png')).toBeNull();
  });
  it('rejects over 8 MiB even in memory', async () => {
    const data = `data:image/png;base64,${btoa('x'.repeat(8 * 1024 * 1024 + 1))}`;
    await expect(uploadEvidence(data, 'receipt/1', { mode: 'memory', supabaseClient: null })).rejects.toThrow('8 MiB');
  });
});

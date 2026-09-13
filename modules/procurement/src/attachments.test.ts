import { describe, expect, it } from 'vitest';
import {
  attachmentMetadataForRpc,
  buildRequestAttachmentPath,
  createGovernedAttachmentUrl,
  uploadRequestAttachments,
  validateRequestAttachment,
} from './attachments';
import { vi } from 'vitest';

describe('procurement attachment governance', () => {
  const pending = () => (['spec', 'budget'] as const).map(kind => {
    const file = new File(['synthetic fixture'], `${kind}.pdf`, { type: 'application/pdf' });
    return { file, kind, filename: file.name, mimeType: file.type, sizeBytes: file.size };
  });
  it.each([false, true])('preserves generic partial-upload cleanup unless retention is explicit: %s', async retainOnFailure => {
    const upload = vi.fn().mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'Upload interrupted' } });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const client = { storage: { from: vi.fn(() => ({ upload, remove })) } };
    await expect(uploadRequestAttachments(client, 'req_fixture', pending(), retainOnFailure ? { retainOnFailure: true } : undefined)).rejects.toThrow('Upload interrupted');
    expect(upload).toHaveBeenCalledTimes(2);
    if (retainOnFailure) expect(remove).not.toHaveBeenCalled();
    else expect(remove).toHaveBeenCalledExactlyOnceWith([upload.mock.calls[0]![0]]);
    expect(upload.mock.calls[0]![2]).toEqual({ contentType: 'application/pdf', upsert: false });
  });
  it('runs the optional synchronous preflight before any Storage request', async () => {
    const upload = vi.fn(), remove = vi.fn();
    const client = { storage: { from: vi.fn(() => ({ upload, remove })) } };
    await expect(uploadRequestAttachments(client, 'req_fixture', pending(), { beforeUpload: () => { throw new Error('Context invalid'); }, retainOnFailure: true })).rejects.toThrow('Context invalid');
    expect(upload).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
  it('rejects unsupported types and files over 10 MB', () => {
    expect(() =>
      validateRequestAttachment({ type: 'text/html', size: 100 }),
    ).toThrow(/unsupported/i);
    expect(() =>
      validateRequestAttachment({ type: 'application/pdf', size: 10 * 1024 * 1024 + 1 }),
    ).toThrow(/10 MB/i);
  });

  it('builds a request-scoped path without unsafe filename characters', () => {
    expect(
      buildRequestAttachmentPath('req_abc', 'att_123', '../Budget Plan (final).pdf'),
    ).toBe('request/req_abc/att_123-Budget_Plan_final.pdf');
  });

  it('serializes only governed metadata and never file/base64 content', () => {
    const metadata = attachmentMetadataForRpc({
      id: 'att_123',
      filename: 'quote.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      storagePath: 'request/req_abc/att_123-quote.pdf',
      sha256: 'abc123',
      uploadedAt: '2026-07-10T00:00:00.000Z',
      uploadedByEmail: 'requester@mwell.com.ph',
      kind: 'quote',
    });

    expect(metadata).toEqual({
      id: 'att_123',
      filename: 'quote.pdf',
      mime_type: 'application/pdf',
      size_bytes: 2048,
      storage_path: 'request/req_abc/att_123-quote.pdf',
      sha256: 'abc123',
      uploaded_at: '2026-07-10T00:00:00.000Z',
      uploaded_by_email: 'requester@mwell.com.ph',
      kind: 'quote',
    });
    expect(metadata).not.toHaveProperty('dataUrl');
    expect(metadata).not.toHaveProperty('data_url');
    expect(metadata).not.toHaveProperty('file');
  });

  it('prepares audited access before creating a short-lived signed URL', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        bucket: 'procurement-requests',
        storage_path: 'request/req_abc/att_123-quote.pdf',
        filename: 'quote.pdf',
        expires_in: 60,
      },
      error: null,
    });
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://signed.example/quote' },
      error: null,
    });
    const client = {
      schema: vi.fn(() => ({ rpc })),
      storage: { from: vi.fn(() => ({ createSignedUrl })) },
    };

    await expect(createGovernedAttachmentUrl(client, 'att_123')).resolves.toEqual({
      url: 'https://signed.example/quote',
      filename: 'quote.pdf',
    });
    expect(rpc).toHaveBeenCalledWith('prepare_request_attachment_access', {
      payload: { attachment_id: 'att_123' },
    });
    expect(createSignedUrl).toHaveBeenCalledWith(
      'request/req_abc/att_123-quote.pdf',
      60,
      { download: 'quote.pdf' },
    );
  });
});

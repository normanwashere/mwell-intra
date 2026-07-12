import { describe, expect, it } from 'vitest';
import {
  attachmentMetadataForRpc,
  buildRequestAttachmentPath,
  createGovernedAttachmentUrl,
  validateRequestAttachment,
} from './attachments';
import { vi } from 'vitest';

describe('procurement attachment governance', () => {
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

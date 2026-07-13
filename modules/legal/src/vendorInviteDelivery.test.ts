import { describe, expect, it } from 'vitest';
import { resolveVendorInviteDelivery } from './vendorInviteDelivery';

const envelope = {
  invite: {
    id: 'invite-1',
    case_id: 'case-1',
    vendor_id: 'vendor-1',
    email: 'vendor@example.com',
    company_name: 'Example Vendor',
    created_at: '2026-07-13T00:00:00.000Z',
    status: 'sent',
  },
  case: { id: 'case-1' },
  vendor: { id: 'vendor-1' },
};

describe('resolveVendorInviteDelivery', () => {
  it('maps a delivered invite envelope', () => {
    expect(resolveVendorInviteDelivery({ ...envelope, delivery_status: 'sent' })).toMatchObject({
      inviteRow: envelope.invite,
      caseId: 'case-1',
      vendorId: 'vendor-1',
      deliveryStatus: 'sent',
    });
  });

  it('preserves the created case when email delivery fails', () => {
    expect(
      resolveVendorInviteDelivery({
        ...envelope,
        delivery_status: 'delivery_failed',
        delivery_error: 'SMTP rejected the recipient',
      }),
    ).toMatchObject({
      caseId: 'case-1',
      vendorId: 'vendor-1',
      deliveryStatus: 'delivery_failed',
      deliveryError: 'SMTP rejected the recipient',
    });
  });

  it('rejects a malformed response that cannot identify an invite', () => {
    expect(() => resolveVendorInviteDelivery({ error: 'bad response' })).toThrow(
      'valid invite record',
    );
  });
});

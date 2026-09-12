type DeliveryRow = Record<string, unknown> & {
  id?: unknown;
  case_id?: unknown;
  vendor_id?: unknown;
};

export interface VendorInviteDeliveryEnvelope extends DeliveryRow {
  invite?: DeliveryRow;
  case?: DeliveryRow;
  vendor?: DeliveryRow;
  delivery_status?: 'pending_delivery' | 'sent' | 'delivery_failed';
  delivery_error?: string;
}

export function vendorInviteDeliveryGuidance(diagnostic?: string) {
  if (/rate.?limit|sending limit|email quota/i.test(diagnostic ?? '')) {
    return 'The case is saved, but the email service has reached its sending limit. Ask your administrator to check the email service before retrying this invitation. Do not create another case.';
  }
  return 'The case is saved, but the invitation email was not sent. Check the vendor email address and ask your administrator to check email delivery before retrying this invitation. Do not create another case.';
}

export function resolveVendorInviteDelivery(payload: VendorInviteDeliveryEnvelope) {
  const inviteRow = payload.invite ?? payload;
  if (typeof inviteRow.id !== 'string') throw new Error('Vendor invitation service returned no valid invite record.');

  const caseId =
    typeof inviteRow.case_id === 'string'
      ? inviteRow.case_id
      : typeof payload.case?.id === 'string'
        ? payload.case.id
        : undefined;
  const vendorId =
    typeof inviteRow.vendor_id === 'string'
      ? inviteRow.vendor_id
      : typeof payload.vendor?.id === 'string'
        ? payload.vendor.id
        : undefined;

  return {
    inviteRow,
    caseId,
    vendorId,
    deliveryStatus: payload.delivery_status ??
      (inviteRow.status === 'sent' || inviteRow.status === 'accepted' ? 'sent' :
        inviteRow.status === 'delivery_failed' ? 'delivery_failed' : 'pending_delivery'),
    deliveryError: typeof inviteRow.delivery_error === 'string' ? inviteRow.delivery_error : payload.delivery_error,
  } as const;
}

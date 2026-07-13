type DeliveryRow = Record<string, unknown> & {
  id?: unknown;
  case_id?: unknown;
  vendor_id?: unknown;
};

export interface VendorInviteDeliveryEnvelope extends DeliveryRow {
  invite?: DeliveryRow;
  case?: DeliveryRow;
  vendor?: DeliveryRow;
  delivery_status?: 'sent' | 'delivery_failed';
  delivery_error?: string;
}

export function resolveVendorInviteDelivery(payload: VendorInviteDeliveryEnvelope) {
  const inviteRow = payload.invite ?? payload;
  if (typeof inviteRow.id !== 'string')
    throw new Error('Vendor invitation service returned no valid invite record.');

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
    deliveryStatus: payload.delivery_status ?? 'sent',
    deliveryError: payload.delivery_error,
  } as const;
}

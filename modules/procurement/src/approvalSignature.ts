import type { ApprovalSignature } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasRpcKeys(value: Record<string, unknown>): boolean {
  return ['signature_png', 'signer_name', 'signature_method', 'signed_at', 'signer_ua', 'user_agent']
    .some(key => Object.prototype.hasOwnProperty.call(value, key));
}

function isPngDataUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[0] !== value || match[1]!.length % 4 !== 0) return false;
  try {
    const bytes = atob(match[1]!);
    return bytes.startsWith('\x89PNG\r\n\x1a\n') && btoa(bytes) === match[1];
  } catch {
    return false;
  }
}

function storedTimestamp(value: unknown): string {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      !Number.isFinite(Date.parse(value))) return '';
  const date = value.slice(0, 10);
  return new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date ? value : '';
}

export function normalizeApprovalSignature(value: unknown): ApprovalSignature | undefined {
  if (!isRecord(value)) return undefined;
  // Choose one stored shape; never combine an image with another shape's signer.
  const snake = hasRpcKeys(value);
  const dataUrl = snake ? value.signature_png : value.dataUrl;
  const signerName = snake ? value.signer_name : value.signerName;
  const method = snake ? value.signature_method : value.method;
  const signedAt = snake ? value.signed_at : value.signedAt;
  const userAgent = snake ? (value.signer_ua ?? value.user_agent) : value.userAgent;
  if (!isPngDataUrl(dataUrl) || typeof signerName !== 'string' || !signerName.trim() ||
      (method !== 'drawn' && method !== 'typed')) return undefined;
  return {
    dataUrl, signerName, method,
    // Empty metadata remains unknown in the existing display model, not inferred.
    signedAt: storedTimestamp(signedAt),
    userAgent: typeof userAgent === 'string' ? userAgent : '',
  };
}

export function approvalSignatureForRpc(value: unknown): unknown {
  // Existing governed evidence passes through untouched; validation stays server-side.
  if (!isRecord(value) || hasRpcKeys(value)) return value;
  return {
    signature_png: value.dataUrl,
    signer_name: value.signerName,
    signature_method: value.method,
    signed_at: value.signedAt,
    signer_ua: value.userAgent,
  };
}

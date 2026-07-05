// Typed-signature seeding (UX-REVIEW-FULL-APP.md PR-15 / J2-4).
//
// The @intra/ui SignaturePad only commits a typed signature after an input /
// mode-switch event, so a prefilled "Full legal name" leaves the Confirm
// button dead until the user re-types. packages/ui is FROZEN, so instead the
// procurement decision sheets seed their own typed SignaturePayload from the
// profile name the moment the sheet opens. The pad still lets the signer
// draw or re-type — any pad commit replaces the seed.
//
// The PNG rendering below intentionally mirrors SignaturePad's typed-mode
// output (same canvas size, font stack, colors) so seeded and pad-committed
// artifacts look identical downstream (ladder chips, PO award block).

import type { SignaturePayload } from '@intra/ui';

const CANVAS_W = 600;
const CANVAS_H = 160;

const TYPED_FONT_STACK =
  '"Great Vibes", "Segoe Script", "Snell Roundhand", "Apple Chancery", "Lucida Handwriting", cursive';

/**
 * Build a typed SignaturePayload for `name`. Returns null for blank names or
 * non-browser environments (SSR) so callers can fall back to "pad required".
 */
export function makeTypedSignature(name: string | undefined): SignaturePayload | null {
  const signerName = name?.trim();
  if (!signerName) return null;
  if (typeof document === 'undefined') return null;

  const off = document.createElement('canvas');
  off.width = CANVAS_W;
  off.height = CANVAS_H;
  const ctx = off.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, off.width, off.height);
  ctx.fillStyle = '#0f172a';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = `italic 64px ${TYPED_FONT_STACK}`;
  ctx.fillText(signerName, off.width / 2, off.height / 2 + 6);

  const tzOffset = new Date().getTimezoneOffset();
  return {
    method: 'typed',
    dataUrl: off.toDataURL('image/png'),
    signerName,
    signedAt: new Date().toISOString(),
    userAgent:
      typeof navigator === 'undefined'
        ? 'unknown'
        : `${navigator.userAgent} | tzOffset=${tzOffset}`,
  };
}

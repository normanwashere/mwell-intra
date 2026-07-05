'use client';

// SignaturePad — DocuSign-style signature capture (spec §12, procurement §9).
//
// Two capture modes on a single control: DRAW (finger / mouse / pen on a HTML
// <canvas>) and TYPE (typed full name rendered in a script-like font). Both
// paths emit a stable `SignaturePayload` the caller persists next to the
// approval decision so we have a legally-attachable representation of intent.
//
// Runtime notes:
// - Renders only on the client (uses window / canvas). The wrapping page /
//   sheet is already a client component so this stays inside its tree.
// - The captured PNG is a data URL so the caller can inline it into an audit
//   log, a printable PO, or upload it to Storage without additional wiring.
// - Pointer events cover mouse, touch, and pen unified — no separate touch
//   handlers. Preventing default while drawing stops page scroll on phones.

import { useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Icon } from './Icon';

/** How the signer expressed intent. */
export type SignatureMethod = 'drawn' | 'typed';

/** Serialized signature attached to an approval / award decision. */
export interface SignaturePayload {
  readonly method: SignatureMethod;
  /** PNG rendering of the signature (data URL, ~600x160). */
  readonly dataUrl: string;
  /** Full legal name the signer confirmed. */
  readonly signerName: string;
  /** ISO timestamp captured at commit. */
  readonly signedAt: string;
  /** Best-effort audit fingerprint (browser + platform + timezone offset). */
  readonly userAgent: string;
}

interface SignaturePadProps {
  /** Prefilled full name (from profile). Signer can override. */
  defaultSignerName?: string;
  /** Called each time the pad is committed to a valid signature. */
  onChange: (sig: SignaturePayload | null) => void;
  /** Legal boilerplate shown under the pad (spec §9.3, RA 8792 e-sign). */
  consentLabel?: string;
  className?: string;
}

const CANVAS_W = 600;
const CANVAS_H = 160;

// The "typed" cursive is faked with a system font stack that has decent
// script-adjacent glyphs; when custom fonts are available (e.g. Great Vibes
// via next/font) they'll be picked up automatically because the CSS falls
// back through them.
const TYPED_FONT_STACK =
  '"Great Vibes", "Segoe Script", "Snell Roundhand", "Apple Chancery", "Lucida Handwriting", cursive';

/**
 * Interactive signature control. Emits `null` on clear so callers can
 * disable their Confirm button until a valid signature is present.
 */
export function SignaturePad({
  defaultSignerName = '',
  onChange,
  consentLabel = 'By signing you agree this is your electronic signature and it will be logged on the approval audit trail (RA 8792, DocuSign-equivalent intent).',
  className,
}: SignaturePadProps) {
  const [mode, setMode] = useState<SignatureMethod>('drawn');
  const [signerName, setSignerName] = useState(defaultSignerName);
  const [hasInk, setHasInk] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  // Reset ink when switching mode so we never commit a stale drawing after
  // the signer typed a name (or vice versa).
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.lineWidth = 2.25;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
    setHasInk(false);
    onChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const commit = useCallback(() => {
    if (!signerName.trim()) {
      onChange(null);
      return;
    }
    let dataUrl: string | null = null;
    if (mode === 'drawn') {
      if (!hasInk) {
        onChange(null);
        return;
      }
      dataUrl = canvasRef.current?.toDataURL('image/png') ?? null;
    } else {
      // Typed mode: render the signer's name onto an offscreen canvas so we
      // always store an image (same downstream contract as drawn).
      const off = document.createElement('canvas');
      off.width = CANVAS_W;
      off.height = CANVAS_H;
      const ctx = off.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, off.width, off.height);
        ctx.fillStyle = '#0f172a';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.font = `italic 64px ${TYPED_FONT_STACK}`;
        ctx.fillText(signerName.trim(), off.width / 2, off.height / 2 + 6);
        dataUrl = off.toDataURL('image/png');
      }
    }
    if (!dataUrl) {
      onChange(null);
      return;
    }
    const tzOffset = new Date().getTimezoneOffset();
    onChange({
      method: mode,
      dataUrl,
      signerName: signerName.trim(),
      signedAt: new Date().toISOString(),
      userAgent:
        typeof navigator === 'undefined'
          ? 'unknown'
          : `${navigator.userAgent} | tzOffset=${tzOffset}`,
    });
  }, [hasInk, mode, onChange, signerName]);

  // Re-commit whenever the signer name (typed mode) or ink state (drawn)
  // toggles from valid → invalid so the parent stays in sync without the
  // signer having to click a separate "confirm".
  useEffect(() => {
    if (mode === 'typed') commit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signerName, mode]);

  const clearInk = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
    onChange(null);
  };

  const toCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    // Map CSS pixels → the canvas' internal pixel space (CANVAS_W x CANVAS_H)
    // so the drawn line lands at the pointer regardless of layout width.
    return {
      x: ((e.clientX - rect.left) / rect.width) * c.width,
      y: ((e.clientY - rect.top) / rect.height) * c.height,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'drawn') return;
    e.preventDefault();
    (e.target as HTMLCanvasElement).setPointerCapture?.(e.pointerId);
    drawing.current = true;
    lastPoint.current = toCanvasPoint(e);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || mode !== 'drawn') return;
    e.preventDefault();
    const p = toCanvasPoint(e);
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!ctx || !lastPoint.current) return;
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastPoint.current = p;
    if (!hasInk) setHasInk(true);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'drawn') return;
    drawing.current = false;
    lastPoint.current = null;
    try {
      (e.target as HTMLCanvasElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* browsers that never captured — ignore */
    }
    // Commit lazily so the parent gets an updated dataUrl each stroke end.
    commit();
  };

  return (
    <div className={clsx('space-y-3', className)}>
      <div
        role="tablist"
        aria-label="Signature capture mode"
        className="inline-flex rounded-xl border border-line bg-surface p-1 text-xs font-semibold"
      >
        {(
          [
            { id: 'drawn', label: 'Draw', icon: 'edit' as const },
            { id: 'typed', label: 'Type', icon: 'clipboard' as const },
          ] as const
        ).map((opt) => (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={mode === opt.id}
            onClick={() => setMode(opt.id)}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition',
              mode === opt.id
                ? 'bg-brand-500/10 text-brand-700 dark:text-brand-300'
                : 'text-muted hover:text-ink',
            )}
          >
            <Icon name={opt.icon} className="h-3.5 w-3.5" />
            {opt.label}
          </button>
        ))}
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-faint">
          Full legal name
        </label>
        <input
          type="text"
          value={signerName}
          onChange={(e) => setSignerName(e.target.value)}
          placeholder="e.g. Marta Ramos"
          autoComplete="name"
          className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
        />
      </div>

      {mode === 'drawn' ? (
        <div className="space-y-2">
          <div className="relative overflow-hidden rounded-xl border border-line bg-white">
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={onPointerUp}
              className="block aspect-[15/4] w-full touch-none"
              aria-label="Draw signature"
            />
            {!hasInk && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 grid place-items-center text-xs italic text-faint"
              >
                Sign here with your finger, mouse or pen
              </div>
            )}
          </div>
          <div className="flex items-center justify-between text-xs text-muted">
            <span>Draw as you would on paper.</span>
            <button
              type="button"
              onClick={clearInk}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-500/10 dark:text-brand-300"
            >
              <Icon name="rotate" className="h-3.5 w-3.5" />
              Clear
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-white p-3">
          <p
            className="min-h-[80px] break-words text-center text-3xl leading-tight text-ink"
            style={{ fontFamily: TYPED_FONT_STACK, fontStyle: 'italic' }}
          >
            {signerName.trim() || (
              <span className="text-sm text-faint">
                Type your full legal name above.
              </span>
            )}
          </p>
        </div>
      )}

      <p className="text-[0.68rem] leading-snug text-faint">{consentLabel}</p>
    </div>
  );
}

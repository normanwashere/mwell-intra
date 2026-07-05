'use client';

// InfoTip — the app-wide "(i) explanations live behind a tooltip" primitive
// (UX-REVIEW-VENDOR-LEGAL.md §3.1, UX-REVIEW-FULL-APP.md tooltip inventory).
//
// Design rules it enforces:
//   • Headings carry nouns; explanations live behind (i). Pages stop carrying
//     permanent instructional copy — it moves here.
//   • Desktop: opens on hover AND keyboard focus. Touch: tap toggles, tap
//     outside / Escape closes. One InfoTip open at a time (module-level bus).
//   • Accessible: the trigger is a real <button> with aria-expanded +
//     aria-describedby pointing at the bubble (role="tooltip").
//
// Deliberately dependency-free (no Radix/floating-ui): fixed placement math
// with viewport clamping is plenty for a ≤320px bubble.

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { clsx } from 'clsx';
import { Icon } from './Icon';

/** Close whatever InfoTip is currently open (one-at-a-time behavior). */
let closeCurrent: (() => void) | null = null;

export interface InfoTipProps {
  /** The explanation shown in the bubble. Keep to 1–3 short sentences. */
  content: ReactNode;
  /**
   * Accessible label for the trigger (what is this info about?).
   * e.g. "About this page", "Why we track this".
   */
  label?: string;
  /** Bubble placement preference; flips automatically when clamped. */
  side?: 'top' | 'bottom';
  /** Extra classes for the trigger button. */
  className?: string;
  /**
   * Optional custom trigger content. Defaults to the (i) icon. The trigger
   * is always rendered as a button — pass text/icon children only.
   */
  children?: ReactNode;
}

/**
 * InfoTip — small (i) trigger + tooltip bubble.
 *
 * Usage:
 *   <SectionTitle title="Accreditation cases" action={<InfoTip content="…" />} />
 *   <InfoTip content="Sourcing method is suggested from category + amount." />
 */
export function InfoTip({
  content,
  label = 'More information',
  side = 'top',
  className,
  children,
}: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<'top' | 'bottom'>(side);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const bubbleId = useId();
  // Distinguishes tap-toggle (click) from hover so touch devices don't get a
  // bubble that closes the instant the synthetic mouseleave fires.
  const pinned = useRef(false);

  const close = useCallback(() => {
    pinned.current = false;
    setOpen(false);
  }, []);

  const show = useCallback(() => {
    if (closeCurrent && closeCurrent !== close) closeCurrent();
    closeCurrent = close;
    // Flip when the trigger is too close to the top of the viewport for a
    // top-side bubble (or bottom for bottom-side).
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect) {
      if (side === 'top' && rect.top < 120) setPlacement('bottom');
      else if (side === 'bottom' && window.innerHeight - rect.bottom < 120) {
        setPlacement('top');
      } else {
        setPlacement(side);
      }
    }
    setOpen(true);
  }, [close, side]);

  // Tap outside + Escape dismiss while open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        close();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return (
    <span ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? bubbleId : undefined}
        onClick={() => {
          if (open && pinned.current) {
            close();
          } else {
            pinned.current = true;
            show();
          }
        }}
        onMouseEnter={() => {
          if (!open) show();
        }}
        onMouseLeave={() => {
          if (!pinned.current) close();
        }}
        onFocus={() => {
          if (!open) show();
        }}
        onBlur={() => {
          if (!pinned.current) close();
        }}
        className={clsx(
          // ≥44px effective target via padding while the glyph stays small.
          'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-faint transition hover:bg-inset hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
          className,
        )}
      >
        {children ?? <Icon name="info" className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <span
          id={bubbleId}
          role="tooltip"
          className={clsx(
            'absolute left-1/2 z-40 w-max max-w-[min(20rem,80vw)] -translate-x-1/2 rounded-xl border border-line bg-surface px-3 py-2 text-left text-xs font-normal leading-snug text-muted shadow-pop',
            placement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}

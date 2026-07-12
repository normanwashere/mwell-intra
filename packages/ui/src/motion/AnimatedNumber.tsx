'use client';

// KPI count-up. Hydration-safe: the real formatted value is in the markup on
// both server and first client render; after mount the number springs from 0
// (or its previous value) to the target. Reduced motion renders statically.

import { useEffect, useRef } from 'react';
import { animate, useReducedMotion } from 'framer-motion';

export interface AnimatedNumberProps {
  value: number;
  /** Formatter applied on every animation frame (defaults to en-PH digits). */
  format?: (n: number) => string;
  /** Seconds. Defaults to 0.8. */
  duration?: number;
  className?: string;
}

const defaultFormat = (n: number) => Math.round(n).toLocaleString('en-PH');

export function AnimatedNumber({
  value,
  format = defaultFormat,
  duration = 0.8,
  className,
}: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (reduced) {
      node.textContent = format(value);
      previous.current = value;
      return;
    }
    const controls = animate(previous.current, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => {
        node.textContent = format(latest);
      },
    });
    previous.current = value;
    return () => controls.stop();
  }, [value, duration, format, reduced]);

  // Server + first client render agree on the final value (no CLS, no
  // hydration mismatch); the effect above takes over after mount.
  return (
    <span ref={ref} className={className}>
      {format(value)}
    </span>
  );
}

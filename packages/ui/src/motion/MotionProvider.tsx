'use client';

// LazyMotion keeps the framer-motion payload lean: components use the `m.*`
// primitives and the animation features load once here. `domMax` (rather than
// domAnimation) because the suite uses layout animations (active-pill nav)
// and drag gestures (dismissible sheets).

import { LazyMotion, domMax } from 'framer-motion';
import type { ReactNode } from 'react';

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domMax} strict>
      {children}
    </LazyMotion>
  );
}

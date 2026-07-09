'use client';

// Route-change transition: key the wrapper on the pathname and the page
// content fades/rises in. Replaces the CSS `animate-fade-in` div in the app
// shells. Exit animations are intentionally skipped (App Router unmounts the
// old tree synchronously) — the enter choreography is what reads as motion.

import { useReducedMotion } from 'framer-motion';
import * as m from 'framer-motion/m';
import type { ReactNode } from 'react';
import { pageVariants } from './tokens';

export interface PageTransitionProps {
  /** Typically the pathname — a new key restarts the entrance. */
  id: string;
  children: ReactNode;
  className?: string;
}

export function PageTransition({ id, children, className }: PageTransitionProps) {
  const reduced = useReducedMotion();
  if (reduced) {
    return <div className={className}>{children}</div>;
  }
  return (
    <m.div
      key={id}
      className={className}
      variants={pageVariants}
      initial="initial"
      animate="enter"
    >
      {children}
    </m.div>
  );
}

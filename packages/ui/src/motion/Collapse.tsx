'use client';

// Height-animated disclosure. Content mounts/unmounts with a spring height +
// fade so expanding rows / filter panels feel physical instead of popping.

import { AnimatePresence, useReducedMotion } from 'framer-motion';
import * as m from 'framer-motion/m';
import type { ReactNode } from 'react';
import { DURATION, EASE_OUT } from './tokens';

export interface CollapseProps {
  open: boolean;
  children: ReactNode;
  className?: string;
}

export function Collapse({ open, children, className }: CollapseProps) {
  const reduced = useReducedMotion();
  if (reduced) {
    return open ? <div className={className}>{children}</div> : null;
  }
  return (
    <AnimatePresence initial={false}>
      {open && (
        <m.div
          className={className}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: DURATION.base, ease: EASE_OUT }}
          style={{ overflow: 'hidden' }}
        >
          {children}
        </m.div>
      )}
    </AnimatePresence>
  );
}

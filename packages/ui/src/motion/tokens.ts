// Motion design tokens — one vocabulary for the whole suite.
//
// Durations are seconds (framer-motion convention). Springs are tuned for UI
// chrome: `snappy` for controls/chips, `gentle` for surfaces/sheets.

import type { Transition, Variants } from 'framer-motion';

export const DURATION = {
  fast: 0.15,
  base: 0.25,
  slow: 0.4,
} as const;

export const EASE_OUT: Transition['ease'] = [0.16, 1, 0.3, 1];

export const SPRING_SNAPPY: Transition = {
  type: 'spring',
  stiffness: 500,
  damping: 34,
  mass: 0.8,
};

export const SPRING_GENTLE: Transition = {
  type: 'spring',
  stiffness: 260,
  damping: 30,
  mass: 1,
};

/** Container that staggers its children (pair with `staggerItem`). */
export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.045, delayChildren: 0.02 },
  },
};

/** Child entrance used inside `staggerContainer`. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.base, ease: EASE_OUT },
  },
};

/** Page-level entrance (route transitions).
 *  Avoid opacity:0 on `initial` — if LazyMotion features load late the page
 *  must still be readable (blank-shell bug when `m` was imported wrong). */
export const pageVariants: Variants = {
  initial: { y: 6 },
  enter: {
    y: 0,
    transition: { duration: DURATION.base, ease: EASE_OUT },
  },
  exit: { opacity: 0, transition: { duration: DURATION.fast } },
};

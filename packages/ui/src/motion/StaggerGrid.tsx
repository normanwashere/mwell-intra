'use client';

// Staggered entrance for KPI grids / card lists. Replaces the CSS `.stagger`
// helper with a spring-based, reduced-motion-aware version. Children animate
// once on mount; layout is otherwise untouched (the wrapper takes className).

import { useReducedMotion } from 'framer-motion';
import * as m from 'framer-motion/m';
import type { ReactNode } from 'react';
import { staggerContainer, staggerItem } from './tokens';

export interface StaggerGridProps {
  children: ReactNode;
  className?: string;
  /** Render each direct child inside its own animated cell. */
  as?: 'div' | 'ul' | 'section';
  'aria-label'?: string;
  role?: string;
}

export function StaggerGrid({
  children,
  className,
  as = 'div',
  'aria-label': ariaLabel,
  role,
}: StaggerGridProps) {
  const reduced = useReducedMotion();
  const Tag = m[as];
  if (reduced) {
    const Plain = as;
    return (
      <Plain className={className} aria-label={ariaLabel} role={role}>
        {children}
      </Plain>
    );
  }
  return (
    <Tag
      className={className}
      aria-label={ariaLabel}
      role={role}
      variants={staggerContainer}
      initial="hidden"
      animate="show"
    >
      {children}
    </Tag>
  );
}

/** One animated cell inside a StaggerGrid. */
export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <m.div className={className} variants={staggerItem}>
      {children}
    </m.div>
  );
}

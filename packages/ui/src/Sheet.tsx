'use client';

// Sheet v2 — Radix Dialog + gesture dismiss. Bottom sheets get a drag handle
// and can be flicked/dragged down to close (mirrors native mobile sheets);
// pointer-based drag works with mouse too. Falls back to the plain CSS
// animation path when reduced motion is preferred.

import * as Dialog from '@radix-ui/react-dialog';
import { clsx } from 'clsx';
import { useRef, type ReactNode } from 'react';
import { useDragControls, useReducedMotion, type PanInfo } from 'framer-motion';
import * as m from 'framer-motion/m';
import { Icon } from './Icon';
import { SPRING_GENTLE } from './motion/tokens';

type SheetSide = 'adaptive' | 'bottom' | 'right' | 'center';

const CONTENT_CLASS: Record<SheetSide, string> = {
  adaptive:
    'adaptive-content fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] rounded-t-2xl bg-surface shadow-e3 ring-1 ring-line ' +
    'flex flex-col pb-safe md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-[min(92vw,36rem)] ' +
    'md:max-h-[min(46rem,88dvh)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:pb-0',
  bottom:
    'sheet-content fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] rounded-t-2xl bg-surface shadow-e3 ring-1 ring-line ' +
    'flex flex-col pb-safe',
  right:
    'drawer-content fixed inset-y-0 right-0 z-50 w-full max-w-sm bg-surface shadow-e3 ring-1 ring-line ' +
    'flex flex-col safe-top',
  center:
    'modal-content fixed left-1/2 top-1/2 z-50 w-[min(92vw,32rem)] max-h-[90vh] -translate-x-1/2 ' +
    '-translate-y-1/2 rounded-xl bg-surface shadow-e3 ring-1 ring-line flex flex-col',
};

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  side?: SheetSide;
  children: ReactNode;
  /** Sticky footer actions. */
  footer?: ReactNode;
  trigger?: ReactNode;
}

/** Accessible bottom-sheet / drawer / modal built on Radix Dialog. */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  side = 'adaptive',
  children,
  footer,
  trigger,
}: SheetProps) {
  const reduced = useReducedMotion();
  const dragging = useRef(false);
  const dragControls = useDragControls();
  const draggable = side === 'bottom' && !reduced;

  const onDragEnd = (_: unknown, info: PanInfo) => {
    dragging.current = false;
    // Dismiss on a decisive flick OR when dragged past a third of the sheet.
    if (info.velocity.y > 500 || info.offset.y > 140) {
      onOpenChange(false);
    }
  };

  const body = (
    <>
      {(side === 'bottom' || side === 'adaptive') && (
        <div
          aria-hidden
          onPointerDown={
            draggable ? (e) => dragControls.start(e) : undefined
          }
          className={clsx(
            // Generous hit area around the visual handle for the drag gesture.
            'shrink-0 pb-1 pt-2.5 md:hidden',
            draggable && 'cursor-grab touch-none active:cursor-grabbing',
          )}
        >
          <div className="mx-auto h-1.5 w-10 rounded-full bg-line" />
        </div>
      )}
      <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-1.5 md:px-6 md:pb-4 md:pt-5">
        <div className="min-w-0">
          <Dialog.Title className="font-display text-lg font-bold text-ink">
            {title}
          </Dialog.Title>
          {description && (
            <Dialog.Description className="mt-0.5 text-sm text-muted">
              {description}
            </Dialog.Description>
          )}
        </div>
        <Dialog.Close
          className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-lg bg-inset text-muted transition hover:bg-line hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          aria-label="Close"
        >
          <Icon name="x" />
        </Dialog.Close>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 md:px-6 md:pb-6">{children}</div>
      {footer && (
        <div className="relative z-10 shrink-0 border-t border-line bg-surface px-5 py-3 md:px-6 md:py-4">
          <div className="md:flex md:justify-end [&>button]:md:min-w-36 [&>button]:md:w-auto">
            {footer}
          </div>
        </div>
      )}
    </>
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-brand-900/50 backdrop-blur-sm" />
        <Dialog.Content
          className={clsx(CONTENT_CLASS[side])}
          {...(description ? {} : { 'aria-describedby': undefined })}
          asChild={draggable}
        >
          {draggable ? (
            <m.div
              drag="y"
              dragControls={dragControls}
              dragListener={false}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              dragMomentum={false}
              onDragStart={() => {
                dragging.current = true;
              }}
              onDragEnd={onDragEnd}
              transition={SPRING_GENTLE}
            >
              {body}
            </m.div>
          ) : (
            body
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

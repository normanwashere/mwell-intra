'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { Icon } from './Icon';

type SheetSide = 'bottom' | 'right' | 'center';

const CONTENT_CLASS: Record<SheetSide, string> = {
  bottom:
    'sheet-content fixed inset-x-0 bottom-0 z-50 max-h-[92vh] rounded-t-3xl bg-surface shadow-e3 ring-1 ring-line ' +
    'flex flex-col pb-safe',
  right:
    'drawer-content fixed inset-y-0 right-0 z-50 w-full max-w-sm bg-surface shadow-e3 ring-1 ring-line ' +
    'flex flex-col safe-top',
  center:
    'modal-content fixed left-1/2 top-1/2 z-50 w-[min(92vw,32rem)] max-h-[90vh] -translate-x-1/2 ' +
    '-translate-y-1/2 rounded-3xl bg-surface shadow-e3 ring-1 ring-line flex flex-col',
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
  side = 'bottom',
  children,
  footer,
  trigger,
}: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-brand-900/50 backdrop-blur-sm" />
        <Dialog.Content
          className={clsx(CONTENT_CLASS[side])}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          {side === 'bottom' && (
            <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-line" />
          )}
          <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
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
              className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-full bg-inset text-muted transition hover:bg-line hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              aria-label="Close"
            >
              <Icon name="x" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
          {footer && (
            <div className="relative z-10 shrink-0 border-t border-line bg-surface px-5 py-3">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

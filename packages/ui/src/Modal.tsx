"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { clsx } from "clsx";
import { useRef, type ReactNode, type RefObject } from "react";
import { Icon } from "./Icon";

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  overlayClassName?: string;
  showClose?: boolean;
}

/** Focus-contained modal surface for dialogs that provide their own layout. */
export function Modal({
  open,
  onOpenChange,
  title,
  children,
  initialFocusRef,
  className,
  overlayClassName,
  showClose = true,
}: ModalProps) {
  const returnFocusRef = useRef<HTMLElement | null>(null);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={clsx(
            "fixed inset-0 z-40 bg-brand-900/50 backdrop-blur-sm",
            overlayClassName,
          )}
        />
        <Dialog.Content
          aria-describedby={undefined}
          className={clsx(
            "fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[min(calc(100vw-2rem),32rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-line bg-surface shadow-e3 focus:outline-none",
            className,
          )}
          onOpenAutoFocus={(event) => {
            returnFocusRef.current =
              document.activeElement as HTMLElement | null;
            if (!initialFocusRef?.current) return;
            event.preventDefault();
            initialFocusRef.current.focus();
          }}
          onCloseAutoFocus={(event) => {
            if (!returnFocusRef.current?.isConnected) return;
            event.preventDefault();
            returnFocusRef.current.focus();
          }}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {showClose && (
            <Dialog.Close
              type="button"
              aria-label={`Close ${title}`}
              className="absolute right-2 top-2 z-10 grid min-h-11 min-w-11 place-items-center rounded-lg bg-surface text-muted transition hover:bg-inset hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <Icon name="x" />
            </Dialog.Close>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

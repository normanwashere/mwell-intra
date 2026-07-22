'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AnimatePresence, useReducedMotion } from 'framer-motion';
import * as m from 'framer-motion/m';
import { clsx } from 'clsx';
import { Icon, type IconName } from './Icon';
import { SPRING_SNAPPY } from './motion/tokens';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastRecord {
  id: number;
  message: string;
  tone: ToastTone;
  count: number;
}

interface ToastContextValue {
  toast: (message: string, tone?: ToastTone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const TOAST_TONE_STYLES: Record<ToastTone, { cls: string; icon: IconName }> = {
  success: { cls: 'border-emerald-500/30 bg-emerald-700 text-white', icon: 'check' },
  error: { cls: 'border-rose-500/30 bg-rose-700 text-white', icon: 'alert' },
  info: { cls: 'border-brand-500/30 bg-brand-700 text-white', icon: 'info' },
};

export const TOAST_DISMISS_CLASS =
  'pointer-events-auto grid h-12 w-12 shrink-0 place-items-center rounded-lg text-white transition hover:bg-white/10';

export const TOAST_STACK_CLASS =
  'pointer-events-none fixed inset-x-0 top-[calc(4.75rem+env(safe-area-inset-top))] z-[60] flex max-h-[calc(100dvh-var(--shell-mobile-nav-clearance,5.5rem)-6rem)] flex-col items-center gap-3 overflow-y-auto px-3 sm:top-auto sm:bottom-0 sm:items-end sm:max-h-[calc(100dvh-2rem)] sm:px-6 sm:pb-6';

export const MAX_VISIBLE_TOASTS = 3;

export const TOAST_MOTION_STATES = {
  initial: { opacity: 0, scale: 0.98 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.98 },
} as const;

export function coalesceToastQueue(
  current: readonly ToastRecord[],
  incoming: ToastRecord,
  limit = MAX_VISIBLE_TOASTS,
): ToastRecord[] {
  const duplicate = current.find(
    (item) => item.message === incoming.message && item.tone === incoming.tone,
  );
  const next = duplicate
    ? current.map((item) =>
        item.id === duplicate.id ? { ...item, count: item.count + 1 } : item,
      )
    : [...current, incoming];
  return next.slice(-Math.max(1, limit));
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const toastsRef = useRef<ToastRecord[]>([]);
  const counter = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const reduced = useReducedMotion();

  const remove = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    const next = toastsRef.current.filter((item) => item.id !== id);
    toastsRef.current = next;
    setToasts(next);
  }, []);

  const toast = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const normalizedMessage = message.trim();
      if (!normalizedMessage) return;
      const candidate = {
        id: ++counter.current,
        message: normalizedMessage,
        tone,
        count: 1,
      };
      const next = coalesceToastQueue(toastsRef.current, candidate);
      const active = next.find(
        (item) => item.message === normalizedMessage && item.tone === tone,
      );
      const id = active?.id ?? candidate.id;
      const removed = toastsRef.current.filter(
        (item) => !next.some((nextItem) => nextItem.id === item.id),
      );
      for (const item of removed) {
        const timer = timers.current.get(item.id);
        if (timer) clearTimeout(timer);
        timers.current.delete(item.id);
      }
      const existingTimer = timers.current.get(id);
      if (existingTimer) clearTimeout(existingTimer);
      timers.current.set(id, setTimeout(() => remove(id), 3800));
      toastsRef.current = next;
      setToasts(next);
    },
    [remove],
  );

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (m: string) => toast(m, 'success'),
      error: (m: string) => toast(m, 'error'),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className={TOAST_STACK_CLASS}
        role="region"
        aria-label="Notifications"
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => {
            const tone = TOAST_TONE_STYLES[t.tone] ?? TOAST_TONE_STYLES.info;
            return (
              <m.div
                key={t.id}
                role="status"
                initial={reduced ? false : TOAST_MOTION_STATES.initial}
                animate={TOAST_MOTION_STATES.animate}
                exit={reduced ? undefined : TOAST_MOTION_STATES.exit}
                transition={SPRING_SNAPPY}
                className={clsx(
                  'pointer-events-none flex w-full max-w-sm items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm font-medium shadow-e3',
                  tone.cls,
                )}
              >
                <Icon name={tone.icon} className="h-5 w-5 shrink-0" />
                <span className="min-w-0 flex-1 break-words">{t.message}</span>
                {t.count > 1 && (
                  <span className="shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-xs" aria-label={`Repeated ${t.count} times`}>
                    {t.count}
                  </span>
                )}
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => remove(t.id)}
                  className={TOAST_DISMISS_CLASS}
                >
                  <Icon name="x" className="h-4 w-4" />
                </button>
              </m.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

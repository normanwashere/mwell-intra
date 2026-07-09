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

type ToastTone = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  toast: (message: string, tone?: ToastTone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_STYLES: Record<ToastTone, { cls: string; icon: IconName }> = {
  success: { cls: 'border-emerald-500/30 bg-emerald-600 text-white', icon: 'check' },
  error: { cls: 'border-rose-500/30 bg-rose-600 text-white', icon: 'alert' },
  info: { cls: 'border-brand-500/30 bg-brand-700 text-white', icon: 'info' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const reduced = useReducedMotion();

  const remove = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = ++counter.current;
      setToasts((prev) => [...prev, { id, message, tone }]);
      timers.current.set(id, setTimeout(() => remove(id), 3800));
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
        className="pointer-events-none fixed inset-x-0 top-[calc(4.75rem+env(safe-area-inset-top))] z-[60] flex flex-col items-center gap-2 px-4 sm:top-auto sm:bottom-0 sm:pb-6"
        role="region"
        aria-label="Notifications"
      >
        <AnimatePresence mode="popLayout">
          {toasts.map((t) => {
            const tone = TONE_STYLES[t.tone] ?? TONE_STYLES.info;
            return (
              <m.div
                key={t.id}
                role="status"
                layout
                initial={reduced ? false : { opacity: 0, y: 16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduced ? undefined : { opacity: 0, y: 8, scale: 0.98 }}
                transition={SPRING_SNAPPY}
                className={clsx(
                  'pointer-events-auto flex w-full max-w-sm items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm font-medium shadow-e3',
                  tone.cls,
                )}
              >
                <Icon name={tone.icon} className="h-5 w-5 shrink-0" />
                <span className="flex-1">{t.message}</span>
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => remove(t.id)}
                  className="rounded-lg p-0.5 opacity-80 transition hover:bg-white/10 hover:opacity-100"
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

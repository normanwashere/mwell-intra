import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { clsx } from 'clsx';
import { Icon, type IconName } from './Icon';

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
  success: { cls: 'bg-emerald-600 text-white', icon: 'check' },
  error: { cls: 'bg-rose-600 text-white', icon: 'alert' },
  info: { cls: 'bg-brand-700 text-white', icon: 'info' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = ++counter.current;
      setToasts((prev) => [...prev, { id, message, tone }]);
      setTimeout(() => remove(id), 3800);
    },
    [remove],
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
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-4 pb-24 sm:pb-6"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((t) => {
          const tone = TONE_STYLES[t.tone] ?? TONE_STYLES.info;
          return (
            <div
              key={t.id}
              role="status"
              className={clsx(
                'pointer-events-auto flex w-full max-w-sm animate-toast-in items-center gap-2.5 rounded-2xl px-4 py-3 text-sm font-medium shadow-pop',
                tone.cls,
              )}
            >
              <Icon name={tone.icon} className="h-5 w-5 shrink-0" />
              <span className="flex-1">{t.message}</span>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => remove(t.id)}
                className="opacity-80 hover:opacity-100"
              >
                <Icon name="x" className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

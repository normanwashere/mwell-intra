import { useCallback, useEffect, useState } from 'react';
import { Icon } from './Icon';
import { Logo } from './Logo';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function useRegisterSW(): {
  needRefresh: [boolean, (v: boolean) => void];
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
} {
  const needRefresh = useState(false);
  const [, setNeedRefresh] = needRefresh;
  const [registration, setRegistration] =
    useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    let active = true;
    let observed: ServiceWorkerRegistration | null = null;
    let onUpdateFound: (() => void) | null = null;

    const watchRegistration = (reg: ServiceWorkerRegistration) => {
      if (!active) return;
      observed = reg;
      setRegistration(reg);
      if (reg.waiting && navigator.serviceWorker.controller) {
        setNeedRefresh(true);
      }
      onUpdateFound = () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (
            active &&
            worker.state === 'installed' &&
            navigator.serviceWorker.controller
          ) {
            setNeedRefresh(true);
          }
        });
      };
      reg.addEventListener('updatefound', onUpdateFound);
      void reg.update().catch(() => undefined);
    };

    void navigator.serviceWorker.ready.then(watchRegistration).catch(() => undefined);

    return () => {
      active = false;
      if (observed && onUpdateFound) {
        observed.removeEventListener('updatefound', onUpdateFound);
      }
    };
  }, [setNeedRefresh]);

  const updateServiceWorker = useCallback(
    async (reloadPage = true) => {
      if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
        return;
      }
      const reg =
        registration ??
        (await navigator.serviceWorker.getRegistration()) ??
        (await navigator.serviceWorker.ready);
      reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
      reg.waiting?.postMessage('SKIP_WAITING');
      setNeedRefresh(false);
      if (reloadPage) window.location.reload();
    },
    [registration, setNeedRefresh],
  );

  return {
    needRefresh,
    updateServiceWorker,
  };
}

/**
 * Renders the update-available toast from the Serwist service worker and an
 * install-app banner driven by the `beforeinstallprompt` event.
 */
export function PwaPrompts() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  };

  return (
    <>
      {installEvent && (
        <div className="fixed inset-x-3 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-[70] mx-auto max-w-sm rounded-2xl bg-surface p-4 shadow-e3 ring-1 ring-line md:bottom-6">
          <div className="flex items-center gap-3">
            <Logo className="h-7 w-auto" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-ink">
                Install Intra Warehouse
              </p>
              <p className="text-xs text-muted">
                Add to your home screen for offline access.
              </p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="btn-ghost flex-1"
              onClick={() => setInstallEvent(null)}
            >
              Not now
            </button>
            <button
              type="button"
              className="btn-primary flex-1"
              onClick={() => void install()}
            >
              <Icon name="download" className="h-4 w-4" /> Install
            </button>
          </div>
        </div>
      )}

      {needRefresh && (
        <div className="fixed inset-x-3 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-[70] mx-auto flex max-w-sm items-center gap-3 rounded-2xl bg-brand-700 p-3 text-white shadow-pop md:bottom-6">
          <Icon name="info" className="h-5 w-5 shrink-0" />
          <p className="flex-1 text-sm font-medium">A new version is available.</p>
          <button
            type="button"
            className="min-h-11 rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/25"
            onClick={() => void updateServiceWorker(true)}
          >
            Reload
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setNeedRefresh(false)}
            className="grid h-11 w-11 place-items-center rounded-full opacity-80 hover:bg-white/10 hover:opacity-100"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
      )}
    </>
  );
}

import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { Logo } from './Logo';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Service-worker registration seam. The source app used Vite's
// `virtual:pwa-register/react`, which does not exist under Next.js. PWA
// re-establishment is a LATER task (Serwist under the shell — see index.ts note);
// until then this returns an inert shape so the install-prompt UX still works and
// the "update available" toast is simply never triggered.
//
// TODO(parent/next agent): replace this with the shell's real SW registration
// (Serwist `useRegisterSW` equivalent) so update prompts fire again.
function useRegisterSW(): {
  needRefresh: [boolean, (v: boolean) => void];
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
} {
  const state = useState(false);
  return {
    needRefresh: state,
    updateServiceWorker: async () => {},
  };
}

/**
 * Renders the "update available" toast (from the service worker) and an
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
        <div className="fixed inset-x-3 bottom-24 z-[70] mx-auto max-w-sm rounded-2xl bg-surface p-4 shadow-e3 ring-1 ring-line md:bottom-6">
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
            <button type="button" className="btn-primary flex-1" onClick={() => void install()}>
              <Icon name="download" className="h-4 w-4" /> Install
            </button>
          </div>
        </div>
      )}

      {needRefresh && (
        <div className="fixed inset-x-3 bottom-24 z-[70] mx-auto flex max-w-sm items-center gap-3 rounded-2xl bg-brand-700 p-3 text-white shadow-pop md:bottom-6">
          <Icon name="info" className="h-5 w-5 shrink-0" />
          <p className="flex-1 text-sm font-medium">A new version is available.</p>
          <button
            type="button"
            className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25"
            onClick={() => void updateServiceWorker(true)}
          >
            Reload
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setNeedRefresh(false)}
            className="opacity-80 hover:opacity-100"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
      )}
    </>
  );
}

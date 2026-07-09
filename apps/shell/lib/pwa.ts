/** Brand theme color used by the web app manifest and PWA chrome. */
export const PWA_THEME_COLOR = '#004f9d';

/**
 * Install/update banner UX is handled inside the Warehouse module by
 * `PwaPrompts` (`beforeinstallprompt` + service-worker reload). The shell
 * only registers Serwist via `SerwistProvider` in `app/providers.tsx`.
 */
export const PWA_INSTALL_UX_OWNER = 'warehouse/PwaPrompts';

// Root layout (spec §1, §5). Imports the design-system tokens/classes ONCE,
// wires the brand fonts as CSS variables, applies a no-flash theme bootstrap,
// and wraps the app in the client `Providers` (session + toasts).

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Inter, JetBrains_Mono, Poppins } from 'next/font/google';
import '@intra/ui/styles.css';
import './globals.css';
import { Providers } from './providers';
import { ChromeGate } from '@shell/components/ChromeGate';
import { ThemeScript } from '@shell/components/ThemeScript';
import { PWA_THEME_COLOR } from '@shell/lib/pwa';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

// mWell brand typeface (mwell.com.ph). Drives display + body via the shared
// Tailwind preset (`--font-poppins`).
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-poppins',
  display: 'swap',
});

const jbMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jbmono',
  display: 'swap',
});

const APP_NAME = 'Mwell Intra';

export const metadata: Metadata = {
  applicationName: APP_NAME,
  title: {
    default: APP_NAME,
    template: '%s · Mwell Intra',
  },
  description:
    'Mwell Intra — one internal operating system for Warehouse, Procurement and Legal.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: APP_NAME,
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: PWA_THEME_COLOR,
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${poppins.variable} ${inter.variable} ${jbMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body>
        <Providers>
          <ChromeGate>{children}</ChromeGate>
        </Providers>
      </body>
    </html>
  );
}

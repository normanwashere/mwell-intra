// Root layout (spec §1, §5). Imports the design-system tokens/classes ONCE,
// wires the brand fonts as CSS variables, applies a no-flash theme bootstrap,
// and wraps the app in the client `Providers` (session + toasts).

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Inter, Plus_Jakarta_Sans } from 'next/font/google';
import '@intra/ui/styles.css';
import './globals.css';
import { Providers } from './providers';
import { AppShell } from '@/components/AppShell';
import { ThemeScript } from '@/components/ThemeScript';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Mwell Intra',
    template: '%s · Mwell Intra',
  },
  description:
    'Mwell Intra — one internal operating system for Warehouse, Procurement and Legal.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f7fb' },
    { media: '(prefers-color-scheme: dark)', color: '#060f1b' },
  ],
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
      className={`${inter.variable} ${jakarta.variable}`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}

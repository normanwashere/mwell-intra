'use client';

// Global 404 (spec §1, dead-end prevention polish). Rendered by Next when a
// route can't be matched or when a segment calls `notFound()`. Client component
// so we can use the design-system primitives and next/link cleanly, and so the
// suite chrome (ChromeGate → AppShell in RootLayout) still frames the message.

import Link from 'next/link';
import { EmptyState, Icon, PageHeader } from '@intra/ui';

export default function NotFound() {
  return (
    <div>
      <PageHeader
        title="Page not found"
        subtitle="The link you followed may be broken, or the page may have moved."
      />
      <EmptyState
        icon="search"
        title="We couldn't find that page"
        message="Head back to your dashboard to pick a module you can access."
        action={
          <Link href="/" className="btn-primary">
            <Icon name="grid" className="h-4 w-4" />
            Return to dashboard
          </Link>
        }
      />
    </div>
  );
}

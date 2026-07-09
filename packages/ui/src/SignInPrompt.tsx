'use client';

// SignInPrompt — the signed-out state for module apps (T3 auth-flow fix).
//
// Module apps (procurement / legal / warehouse) used to show their "your
// account doesn't include a … role" copy to signed-OUT visitors, which is
// wrong: the visitor may well hold the role once authenticated. This renders
// a "sign in to continue" state whose CTA deep-links back to the page the
// user was trying to reach via /login?redirect=….

import { useEffect, useState } from 'react';
import { Icon } from './Icon';

export interface SignInPromptProps {
  /** Human module name for the heading (e.g. "Procurement"). */
  module: string;
  /** Mount basename, used as the redirect fallback before hydration. */
  basename?: string;
}

export function SignInPrompt({ module, basename = '/' }: SignInPromptProps) {
  // The exact deep-link (path + query) is only known on the client; start
  // with the basename so server + first client render match.
  const [redirect, setRedirect] = useState(basename);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setRedirect(window.location.pathname + window.location.search);
    }
  }, []);

  return (
    <div className="grid min-h-[60vh] place-items-center bg-app p-6 text-center">
      <div className="max-w-sm space-y-3">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-500/10 text-brand-700 dark:text-brand-300">
          <Icon name="lock" className="h-6 w-6" />
        </span>
        <h1 className="text-lg font-bold text-ink">Sign in to continue</h1>
        <p className="text-sm text-muted">
          {module} is available to signed-in users. Sign in and you&apos;ll land
          right back here.
        </p>
        <a
          href={`/login?redirect=${encodeURIComponent(redirect)}`}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-app"
        >
          <Icon name="lock" className="h-4 w-4" />
          Sign in
        </a>
      </div>
    </div>
  );
}

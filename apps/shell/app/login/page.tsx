"use client";

// Sign-in (spec §5). Email + password via useSession().signInWithPassword.
// In memory mode it matches an injected demo profile by email; quick-fill chips
// make the demo profiles one tap away. On success we route to the dashboard.

import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import * as m from "framer-motion/m";
import { Button, Card, Field, Icon, Input } from "@intra/ui";
import { useSession } from "@intra/auth";
import { MwellIntraLogo } from "@shell/components/MwellIntraLogo";
import { authorizedPostLoginPath } from "@shell/lib/navigation";

/** Only allow local same-origin paths in ?redirect to prevent open-redirect. */
function safeRedirect(candidate: string | null): string {
  if (!candidate) return "/";
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return "/";
  if (candidate === "/warehouse") return "/warehouse/";
  return candidate;
}

function replaceDocument(path: string): void {
  window.location.replace(path);
}

export default function LoginPage() {
  const {
    profile,
    userRoles,
    userCapabilities,
    mode,
    signingIn,
    authError,
    memoryProfiles,
    signInWithPassword,
    resetPassword,
  } = useSession();
  const searchParams = useSearchParams();
  const redirectTo = safeRedirect(searchParams?.get("redirect") ?? null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    if (!profile || redirecting) return;
    setRedirecting(true);
    replaceDocument(
      authorizedPostLoginPath(
        redirectTo,
        { mode, userRoles, userCapabilities },
        profile.kind,
      ),
    );
  }, [mode, profile, redirectTo, redirecting, userCapabilities, userRoles]);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setNotice(null);
    const formData = new FormData(e.currentTarget);
    const submittedEmail = String(formData.get("email") ?? email).trim();
    const submittedPassword = String(formData.get("password") ?? password);
    setEmail(submittedEmail);
    setPassword(submittedPassword);
    const ok = await signInWithPassword(submittedEmail, submittedPassword);
    if (!ok) setRedirecting(false);
  };

  const onReset = async () => {
    setNotice(null);
    if (!email.trim()) {
      setNotice("Enter your email above first.");
      return;
    }
    try {
      await resetPassword(email);
      setNotice("If that email exists, a reset link is on its way.");
    } catch {
      // authError surfaces the failure message.
    }
  };

  return (
    <main className="relative flex min-h-[calc(100dvh-2rem)] flex-col items-center justify-center px-4 py-8">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -left-24 top-0 h-72 w-72 rounded-full bg-brand-500/8 blur-3xl" />
        <div className="absolute -right-16 bottom-0 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />
      </div>

      <m.div
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-md space-y-4"
      >
        <div className="hero-surface relative overflow-hidden rounded-3xl p-6 text-center">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-1 rounded-l-3xl bg-gradient-to-b from-brand-500 to-brand-700"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-6 -top-6 text-brand-500 opacity-[0.08]"
          >
            <Icon name="lock" className="h-32 w-32" />
          </div>
          <div className="relative">
            <MwellIntraLogo
              className="justify-center"
              logoClassName="h-9"
              labelClassName="text-[0.68rem]"
            />
            <h1 className="mt-1 font-display text-display text-ink">Sign in</h1>
            <p className="mt-1.5 text-sm text-muted">
              {mode === "supabase"
                ? "Use your Mwell email and password."
                : "Demo mode — pick a profile below or use its email."}
            </p>
          </div>
        </div>

        <Card>
          <form method="post" onSubmit={onSubmit} className="grid gap-4">
            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@mwell.com"
                required
              />
            </Field>
            <Field label="Password" htmlFor="password">
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  mode === "memory" ? "any value in demo mode" : "••••••••"
                }
                required
              />
            </Field>

            {authError && (
              <p
                className="text-sm font-medium text-rose-600 dark:text-rose-300"
                role="alert"
              >
                {authError}
              </p>
            )}
            {notice && (
              <p
                className="text-sm font-medium text-emerald-700 dark:text-emerald-300"
                role="status"
              >
                {notice}
              </p>
            )}

            <Button
              type="submit"
              disabled={!hydrated || signingIn || redirecting}
              className="w-full"
            >
              <Icon name="lock" className="h-4 w-4" />
              {!hydrated
                ? "Preparing…"
                : signingIn || redirecting
                  ? "Signing in…"
                  : "Sign in"}
            </Button>

            {mode === "supabase" && (
              <button
                type="button"
                onClick={() => void onReset()}
                className="inline-flex min-h-11 items-center justify-center text-center text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
              >
                Forgot your password?
              </button>
            )}
          </form>
        </Card>

        {mode === "memory" && memoryProfiles.length > 0 && (
          <Card>
            <details className="group">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="text-[0.68rem] font-semibold uppercase tracking-wide text-faint">
                    Demo profiles
                  </span>
                  <span className="chip bg-amber-500/15 text-amber-800 dark:text-amber-300">
                    {memoryProfiles.length}
                  </span>
                </span>
                <Icon
                  name="chevron"
                  className="h-4 w-4 shrink-0 text-faint transition group-open:rotate-180"
                />
              </summary>
              <p className="mt-2 text-xs text-muted">
                Tap a tile to prefill the form. Passwords are ignored in demo
                mode.
              </p>
              <ul className="mt-3 grid gap-1.5">
                {memoryProfiles.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setEmail(p.email);
                        setPassword("demo");
                      }}
                      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl bg-inset px-3 py-2.5 text-left transition hover:bg-line active:scale-[0.99]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-ink">
                          {p.name ?? p.email}
                        </span>
                        <span className="block truncate text-xs text-muted">
                          {p.title ?? p.email}
                        </span>
                      </span>
                      <Icon
                        name="arrowRight"
                        className="h-4 w-4 shrink-0 text-faint"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          </Card>
        )}

        <p className="text-center text-xs text-faint">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center justify-center hover:underline"
          >
            Back to home
          </Link>
        </p>
      </m.div>
    </main>
  );
}

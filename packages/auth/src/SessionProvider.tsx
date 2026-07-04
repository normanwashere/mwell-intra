'use client';

// SessionProvider — dual-mode session context (spec §5, LLD §10).
//
// The live contract is JWT-only via an INJECTED Supabase client (never
// constructed here, so this stays portable across Next.js RSC/client
// boundaries — the shell in Step 1f owns client creation and env). The `memory`
// mode preserves the warehouse demo/tests flow with an injected profile list.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { UserRoles } from '@intra/rbac';
import { parseUserRolesFromClaims, profileFromUser } from './claims';
import type {
  AuthMode,
  MemoryProfile,
  SessionProfile,
  SessionValue,
} from './contracts';

/** Config for the live JWT contract. The client is injected by the caller. */
export interface SupabaseAuthConfig {
  readonly mode: 'supabase';
  /** An already-constructed Supabase client (browser/SSR-appropriate). */
  readonly client: SupabaseClient;
  /** Path Supabase redirects to after a reset email (default `/reset-password`). */
  readonly resetRedirectPath?: string;
}

/** Config for the demo/tests contract. Profiles drive `can()` locally. */
export interface MemoryAuthConfig {
  readonly mode: 'memory';
  readonly profiles: readonly MemoryProfile[];
}

/** Discriminated provider config — `mode` selects the backend (spec §5). */
export type AuthConfig = SupabaseAuthConfig | MemoryAuthConfig;

const SessionContext = createContext<SessionValue | undefined>(undefined);

export function SessionProvider({
  children,
  config,
}: {
  children: ReactNode;
  config: AuthConfig;
}) {
  const mode: AuthMode = config.mode;
  const client: SupabaseClient | null =
    config.mode === 'supabase' ? config.client : null;
  const memoryProfiles = useMemo<MemoryProfile[]>(
    () => (config.mode === 'memory' ? [...config.profiles] : []),
    [config],
  );
  const resetRedirectPath =
    config.mode === 'supabase'
      ? config.resetRedirectPath ?? '/reset-password'
      : '/reset-password';

  const [profile, setProfile] = useState<SessionProfile | null>(null);
  const [userRoles, setUserRoles] = useState<Partial<UserRoles>>({});
  // Supabase mode restores asynchronously; memory mode is ready immediately.
  const [loading, setLoading] = useState(mode === 'supabase');
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Project a verified user (or clear). Roles ALWAYS come from the fresh JWT
  // `app_metadata`, so a stale/tampered client value can never elevate access.
  const applyUser = useCallback((user: User | null) => {
    if (user) {
      setProfile(profileFromUser(user));
      setUserRoles(parseUserRolesFromClaims(user.app_metadata));
    } else {
      setProfile(null);
      setUserRoles({});
    }
  }, []);

  useEffect(() => {
    if (!client) return;
    let active = true;

    client.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        applyUser(data.session?.user ?? null);
        setLoading(false);
      })
      .catch(() => {
        // Couldn't confirm a live session — treat as signed out (least privilege).
        if (!active) return;
        applyUser(null);
        setLoading(false);
      });

    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      applyUser(session?.user ?? null);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [client, applyUser]);

  const signInWithPassword = useCallback(
    async (email: string, password: string) => {
      setAuthError(null);
      if (!client) {
        // MEMORY mode: match an injected demo profile by email (password is a
        // demo formality — real authorization is the scoped roles it carries).
        const normalized = email.trim().toLowerCase();
        const matched = memoryProfiles.find(
          (p) => p.email.toLowerCase() === normalized,
        );
        if (!matched) {
          setAuthError('No demo profile matches that email.');
          return;
        }
        setProfile({
          id: matched.id,
          email: matched.email,
          kind: matched.kind,
          name: matched.name,
          title: matched.title,
          vendorId: matched.vendorId,
        });
        setUserRoles(matched.roles);
        return;
      }
      setSigningIn(true);
      try {
        const { data, error } = await client.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        applyUser(data.user ?? null);
      } catch (e) {
        applyUser(null);
        setAuthError(
          e instanceof Error ? e.message : 'Sign-in failed. Please try again.',
        );
      } finally {
        setSigningIn(false);
      }
    },
    [client, memoryProfiles, applyUser],
  );

  const signOut = useCallback(async () => {
    setAuthError(null);
    if (client) {
      try {
        await client.auth.signOut();
      } catch {
        // Clear locally regardless of a network/server error.
      }
    }
    setProfile(null);
    setUserRoles({});
  }, [client]);

  const resetPassword = useCallback(
    async (email: string) => {
      setAuthError(null);
      if (!client) {
        setAuthError('Password reset is unavailable in demo mode.');
        return;
      }
      const redirectTo =
        typeof window !== 'undefined'
          ? `${window.location.origin}${resetRedirectPath}`
          : undefined;
      const { error } = await client.auth.resetPasswordForEmail(
        email.trim(),
        redirectTo ? { redirectTo } : undefined,
      );
      if (error) {
        setAuthError(error.message);
        throw new Error(error.message);
      }
    },
    [client, resetRedirectPath],
  );

  const changePassword = useCallback(
    async (password: string) => {
      if (!client) throw new Error('Password change is unavailable in demo mode.');
      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters.');
      }
      const { error } = await client.auth.updateUser({ password });
      if (error) throw new Error(error.message);
    },
    [client],
  );

  const value = useMemo<SessionValue>(
    () => ({
      profile,
      userRoles,
      mode,
      loading,
      signingIn,
      authError,
      memoryProfiles,
      signInWithPassword,
      signOut,
      resetPassword,
      changePassword,
    }),
    [
      profile,
      userRoles,
      mode,
      loading,
      signingIn,
      authError,
      memoryProfiles,
      signInWithPassword,
      signOut,
      resetPassword,
      changePassword,
    ],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

/** Read the current session. Throws if used outside a `<SessionProvider>`. */
export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used within a <SessionProvider>.');
  }
  return ctx;
}

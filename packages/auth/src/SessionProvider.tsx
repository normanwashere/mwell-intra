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
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import type { UserRoles } from '@intra/rbac';
import {
  parseUserCapabilitiesFromClaims,
  parseUserRolesFromClaims,
  profileFromUser,
} from './claims';
import type {
  AuthMode,
  MemoryProfile,
  SessionProfile,
  SessionValue,
  UserCapabilities,
} from './contracts';

type SupabaseAuthClient = SupabaseClient<Record<string, unknown>, string>;

/** Config for the live JWT contract. The client is injected by the caller. */
export interface SupabaseAuthConfig {
  readonly mode: 'supabase';
  /**
   * An already-constructed Supabase client (browser/SSR-appropriate). Schema is
   * intentionally unconstrained so callers may pin any DB schema (e.g. `core`);
   * auth only uses the schema-independent `.auth` surface.
   */
  readonly client: SupabaseAuthClient;
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

/** Storage key for the memory-mode session snapshot (tab-scoped). */
const MEMORY_SESSION_KEY = 'intra.memory-session.v1';

export function SessionProvider({
  children,
  config,
}: {
  children: ReactNode;
  config: AuthConfig;
}) {
  const mode: AuthMode = config.mode;
  const client: SupabaseAuthClient | null =
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
  const [userCapabilities, setUserCapabilities] = useState<UserCapabilities>({});
  // Always start `loading=true` so first server render matches first client
  // render — hydration-safe. We flip to false after we've consulted
  // sessionStorage (memory) or the supabase session (live).
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // MEMORY-mode session persistence (fixes: hard-nav / F5 / deep-link losing
  // the session). We keep the actor in sessionStorage so it lives for the tab
  // (matches "sign-in for this session" UX) without leaking across tabs/users.
  useEffect(() => {
    if (mode !== 'memory') return;
    if (typeof window === 'undefined') {
      setLoading(false);
      return;
    }
    try {
      const raw = window.sessionStorage.getItem(MEMORY_SESSION_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as {
          profileId: string;
          roles: Partial<UserRoles>;
        };
        const match = memoryProfiles.find((p) => p.id === stored.profileId);
        if (match) {
          setProfile({
            id: match.id,
            email: match.email,
            kind: match.kind,
            name: match.name,
            title: match.title,
            vendorId: match.vendorId,
          });
          setUserRoles(stored.roles);
        }
      }
    } catch {
      // Corrupt entry — ignore; fall through to signed-out.
    }
    setLoading(false);
  }, [mode, memoryProfiles]);

  // Project a verified user (or clear). Roles ALWAYS come from the fresh JWT
  // `app_metadata`, so a stale/tampered client value can never elevate access.
  const applyUser = useCallback((
    user: User | null,
    capabilities: UserCapabilities = {},
  ) => {
    if (user) {
      setProfile(profileFromUser(user));
      setUserRoles(parseUserRolesFromClaims(user.app_metadata));
      setUserCapabilities(capabilities);
    } else {
      setProfile(null);
      setUserRoles({});
      setUserCapabilities({});
    }
  }, []);

  const loadLiveCapabilities = useCallback(async (): Promise<UserCapabilities> => {
    if (!client) return {};
    const { data, error } = await client.schema('core').rpc('my_capabilities');
    if (error) throw error;
    return parseUserCapabilitiesFromClaims(data);
  }, [client]);

  useEffect(() => {
    if (!client) return;
    let active = true;

    const verifyAndApplyUser = async (session: Session | null) => {
      if (!session) {
        applyUser(null);
        return;
      }
      try {
        const { data, error } = await client.auth.getUser();
        if (error) throw error;
        const user = data.user ?? null;
        if (!user) {
          applyUser(null);
          return;
        }
        const capabilities = await loadLiveCapabilities();
        applyUser(user, capabilities);
      } catch {
        applyUser(null);
      }
    };

    client.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        return verifyAndApplyUser(data.session ?? null);
      })
      .catch(() => {
        // Couldn't confirm a live session — treat as signed out (least privilege).
        if (!active) return;
        applyUser(null);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      void verifyAndApplyUser(session);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [client, applyUser, loadLiveCapabilities]);

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
          return false;
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
        // Persist for the tab so F5 / deep-links keep the demo session.
        if (typeof window !== 'undefined') {
          try {
            window.sessionStorage.setItem(
              MEMORY_SESSION_KEY,
              JSON.stringify({ profileId: matched.id, roles: matched.roles }),
            );
          } catch {
            /* storage quota / disabled — best effort */
          }
        }
        return true;
      }
      setSigningIn(true);
      try {
        const { error } = await client.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        const { data: verified, error: verifyError } =
          await client.auth.getUser();
        if (verifyError) throw verifyError;
        const user = verified.user ?? null;
        if (!user) {
          throw new Error('Sign-in succeeded, but no session was restored.');
        }
        const capabilities = await loadLiveCapabilities();
        applyUser(user, capabilities);
        return true;
      } catch (e) {
        applyUser(null);
        setAuthError(
          e instanceof Error ? e.message : 'Sign-in failed. Please try again.',
        );
        return false;
      } finally {
        setSigningIn(false);
      }
    },
    [client, memoryProfiles, applyUser, loadLiveCapabilities],
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
    setUserCapabilities({});
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.removeItem(MEMORY_SESSION_KEY);
      } catch {
        /* ignore */
      }
    }
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
      userCapabilities,
      mode,
      supabaseClient: client,
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
      userCapabilities,
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

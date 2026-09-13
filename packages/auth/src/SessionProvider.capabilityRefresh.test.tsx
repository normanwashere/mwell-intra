import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionProvider, useSession } from './SessionProvider';
import { useCan } from './Guard';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const snapshot = {
  roleCapabilities: { warehouse: ['view_inventory', 'receive_stock'] },
  userCapabilities: { warehouse: ['view_inventory', 'receive_stock'] },
};

function setup() {
  const user = {
    id: 'verified-operator', email: 'operator@example.test',
    app_metadata: { roles: { warehouse: ['operations', 'warehouse_operator'] } },
    user_metadata: {}, aud: 'authenticated', created_at: '2026-09-14T00:00:00Z',
  };
  const session: Session = {
    user, access_token: 'test-token', refresh_token: 'test-refresh',
    expires_in: 3600, token_type: 'bearer',
  };
  let listener!: (event: string, session: Session | null) => void;
  const rpc = vi.fn().mockResolvedValue({ data: snapshot, error: null });
  const client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
      signInWithPassword: vi.fn().mockResolvedValue({ data: { session }, error: null }),
      onAuthStateChange: vi.fn((callback) => {
        listener = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
    },
    schema: vi.fn().mockReturnValue({ rpc }),
  };
  render(<SessionProvider config={{ mode: 'supabase', client: client as unknown as SupabaseClient }}><Probe /></SessionProvider>);
  return { rpc, client, session, emit: (value = session, event = 'TOKEN_REFRESHED') => listener(event, value), signOut: () => listener('SIGNED_OUT', null) };
}

function Probe() {
  const session = useSession();
  const allowed = useCan('warehouse', 'receive_stock');
  const [signedIn, setSignedIn] = useState('idle');
  return <>
    <span data-testid="status">{session.capabilityStatus}</span>
    <span data-testid="identity">{session.profile?.id ?? 'signed-out'}</span>
    <span data-testid="roles">{session.userRoles.warehouse?.join(',')}</span>
    <span data-testid="authority">{allowed ? 'allowed' : 'blocked'}</span>
    <button onClick={() => void session.refreshCapabilities()}>Retry access</button>
    <button onClick={() => void session.signInWithPassword('operator@example.test', 'test-only-password').then(ok => setSignedIn(ok ? 'verified' : 'failed'))}>Sign in</button>
    <span data-testid="sign-in-result">{signedIn}</span>
  </>;
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('bounded capability verification', () => {
  it.each(['SIGNED_IN', 'TOKEN_REFRESHED'])('keeps baseline same-user %s authority clearing distinct from confirmed denial', async (event) => {
    const { rpc, emit } = setup();
    await waitFor(() => expect(screen.getByTestId('authority').textContent).toContain('allowed'));
    const next = deferred<{ data: typeof snapshot; error: null }>();
    rpc.mockImplementationOnce(() => next.promise);
    act(() => emit(undefined, event));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('identity').textContent).toContain('verified-operator');
    expect(screen.getByTestId('roles').textContent).toContain('warehouse_operator');
    expect(screen.getByTestId('status').textContent).toContain('pending');
    expect(screen.getByTestId('authority').textContent).toContain('blocked');
    await act(async () => next.resolve({ data: snapshot, error: null }));
    expect(screen.getByTestId('status').textContent).toContain('ready');
    expect(screen.getByTestId('authority').textContent).toContain('allowed');
  });

  it.each(['rejected', 'malformed'] as const)('reports a %s focus snapshot as unavailable with no write authority', async (failure) => {
    const { rpc } = setup();
    await waitFor(() => expect(screen.getByTestId('authority').textContent).toContain('allowed'));
    if (failure === 'rejected') rpc.mockRejectedValueOnce(new Error('offline'));
    else rpc.mockResolvedValueOnce({ data: { roleCapabilities: snapshot.roleCapabilities, userCapabilities: [] }, error: null });
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(screen.getByTestId('authority').textContent).toContain('blocked'));
    expect(screen.getByTestId('identity').textContent).toContain('verified-operator');
    expect(screen.getByTestId('roles').textContent).toContain('warehouse_operator');
    expect(screen.getByTestId('status').textContent).toContain('error');
    fireEvent.click(screen.getByText('Retry access'));
    await waitFor(() => expect(screen.getByTestId('authority').textContent).toContain('allowed'));
    expect(screen.getByTestId('status').textContent).toContain('ready');
  });

  it('keeps a successful empty snapshot as ready and denied', async () => {
    const { rpc, emit } = setup();
    await waitFor(() => expect(screen.getByTestId('authority').textContent).toContain('allowed'));
    rpc.mockResolvedValueOnce({ data: { roleCapabilities: {}, userCapabilities: {} }, error: null });
    act(() => emit());
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toContain('ready'));
    expect(screen.getByTestId('authority').textContent).toContain('blocked');
  });

  it('ends a stalled refresh after eight seconds and ignores its late successful snapshot', async () => {
    const { rpc, emit } = setup();
    await waitFor(() => expect(screen.getByTestId('authority').textContent).toContain('allowed'));
    vi.useFakeTimers();
    const next = deferred<{ data: typeof snapshot; error: null }>();
    rpc.mockImplementationOnce(() => next.promise);
    act(() => emit());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(rpc).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(8000));
    expect(screen.getByTestId('status').textContent).toContain('error');
    expect(screen.getByTestId('authority').textContent).toContain('blocked');
    await act(async () => next.resolve({ data: snapshot, error: null }));
    expect(screen.getByTestId('status').textContent).toContain('error');
    expect(screen.getByTestId('authority').textContent).toContain('blocked');
  });

  it('does not allow a stale explicit retry to overwrite a newer denial', async () => {
    const { rpc, emit } = setup();
    await waitFor(() => expect(screen.getByTestId('authority').textContent).toContain('allowed'));
    const old = deferred<{ data: typeof snapshot; error: null }>();
    rpc.mockImplementationOnce(() => old.promise);
    fireEvent.click(screen.getByText('Retry access'));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    rpc.mockResolvedValueOnce({ data: { roleCapabilities: {}, userCapabilities: {} }, error: null });
    act(() => emit());
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(3));
    await act(async () => old.resolve({ data: snapshot, error: null }));
    expect(screen.getByTestId('status').textContent).toContain('ready');
    expect(screen.getByTestId('authority').textContent).toContain('blocked');
  });

  it('does not restore identity or authority after sign-out while pending', async () => {
    const { rpc, emit, signOut } = setup();
    await waitFor(() => expect(screen.getByTestId('authority').textContent).toContain('allowed'));
    const next = deferred<{ data: typeof snapshot; error: null }>();
    rpc.mockImplementationOnce(() => next.promise);
    act(() => emit());
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    act(() => signOut());
    await act(async () => next.resolve({ data: snapshot, error: null }));
    expect(screen.getByTestId('identity').textContent).toContain('signed-out');
    expect(screen.getByTestId('authority').textContent).toContain('blocked');
  });

  it('does not let a focus event supersede an error-state token check and strand it pending', async () => {
    const { rpc, client, emit } = setup();
    await waitFor(() => expect(screen.getByTestId('authority').textContent).toContain('allowed'));
    rpc.mockRejectedValueOnce(new Error('snapshot unavailable'));
    fireEvent.click(screen.getByText('Retry access'));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'));
    vi.useFakeTimers();
    rpc.mockImplementationOnce(() => new Promise(() => {}));
    act(() => emit());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    client.auth.getSession.mockRejectedValueOnce(new Error('offline'));
    act(() => window.dispatchEvent(new Event('focus')));
    await act(async () => vi.advanceTimersByTimeAsync(8000));
    expect(screen.getByTestId('status').textContent).toContain('error');
    expect(screen.getByTestId('authority').textContent).toContain('blocked');
  });

  it('keeps verified authority during a ready manual refresh, but clears it on failure and blocks during retry', async () => {
    const { rpc } = setup();
    await waitFor(() => expect(screen.getByTestId('authority').textContent).toBe('allowed'));
    const failed = deferred<unknown>();
    rpc.mockImplementationOnce(() => failed.promise);
    fireEvent.click(screen.getByText('Retry access'));
    expect(screen.getByTestId('status').textContent).toBe('ready');
    expect(screen.getByTestId('authority').textContent).toBe('allowed');
    await act(async () => failed.resolve({ data: null, error: { message: 'unavailable' } }));
    expect(screen.getByTestId('status').textContent).toBe('error');
    expect(screen.getByTestId('authority').textContent).toBe('blocked');
    const recovery = deferred<unknown>();
    rpc.mockImplementationOnce(() => recovery.promise);
    fireEvent.click(screen.getByText('Retry access'));
    expect(screen.getByTestId('status').textContent).toBe('pending');
    expect(screen.getByTestId('authority').textContent).toBe('blocked');
    await act(async () => recovery.resolve({ data: snapshot, error: null }));
    expect(screen.getByTestId('status').textContent).toBe('ready');
    expect(screen.getByTestId('authority').textContent).toBe('allowed');
  });

  it.each(['session', 'identity', 'snapshot'] as const)('bounds a stalled focus %s read without accepting its late result', async (stage) => {
    const { rpc, client, session } = setup();
    await waitFor(() => expect(screen.getByTestId('authority').textContent).toContain('allowed'));
    vi.useFakeTimers();
    const next = deferred<unknown>();
    if (stage === 'session') client.auth.getSession.mockImplementationOnce(() => next.promise as never);
    else if (stage === 'identity') client.auth.getUser.mockImplementationOnce(() => next.promise as never);
    else rpc.mockImplementationOnce(() => next.promise);
    act(() => window.dispatchEvent(new Event('focus')));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByTestId('status').textContent).toContain('ready');
    expect(screen.getByTestId('authority').textContent).toContain('allowed');
    await act(async () => vi.advanceTimersByTimeAsync(8000));
    expect(screen.getByTestId('status').textContent).toContain('error');
    expect(screen.getByTestId('authority').textContent).toContain('blocked');
    await act(async () => next.resolve({ data: stage === 'session' ? { session } : stage === 'identity' ? { user: session.user } : snapshot, error: null }));
    expect(screen.getByTestId('status').textContent).toContain('error');
    expect(screen.getByTestId('authority').textContent).toContain('blocked');
  });

  it.each(['rejected', 'malformed'] as const)('reports sign-in verification false when the capability read is %s', async (failure) => {
    const { rpc } = setup();
    await waitFor(() => expect(screen.getByTestId('authority').textContent).toContain('allowed'));
    if (failure === 'rejected') rpc.mockRejectedValueOnce(new Error('offline'));
    else rpc.mockResolvedValueOnce({ data: null, error: null });
    fireEvent.click(screen.getByText('Sign in'));
    await waitFor(() => expect(screen.getByTestId('sign-in-result').textContent).toBe('failed'));
    expect(screen.getByTestId('status').textContent).toBe('error');
    expect(screen.getByTestId('authority').textContent).toBe('blocked');
  });

  it('bounds the post-sign-in identity check and rejects its late response', async () => {
    const { client, session } = setup();
    await waitFor(() => expect(screen.getByTestId('authority').textContent).toContain('allowed'));
    vi.useFakeTimers();
    const next = deferred<unknown>();
    client.auth.getUser.mockImplementationOnce(() => next.promise as never);
    fireEvent.click(screen.getByText('Sign in'));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByTestId('status').textContent).toBe('pending');
    await act(async () => vi.advanceTimersByTimeAsync(8000));
    expect(screen.getByTestId('status').textContent).toBe('error');
    expect(screen.getByTestId('sign-in-result').textContent).toBe('failed');
    await act(async () => next.resolve({ data: { user: session.user }, error: null }));
    expect(screen.getByTestId('authority').textContent).toBe('blocked');
    expect(screen.getByTestId('status').textContent).toBe('error');
  });

  it('marks a different verified identity discovered on focus as pending rather than denied', async () => {
    const { rpc, client, session } = setup();
    await waitFor(() => expect(screen.getByTestId('authority').textContent).toBe('allowed'));
    const user = { ...session.user, id: 'second-operator' };
    client.auth.getSession.mockResolvedValueOnce({ data: { session: { ...session, user } }, error: null });
    client.auth.getUser.mockResolvedValueOnce({ data: { user }, error: null });
    const next = deferred<unknown>();
    rpc.mockImplementationOnce(() => next.promise);
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(screen.getByTestId('identity').textContent).toBe('second-operator'));
    expect(screen.getByTestId('status').textContent).toBe('pending');
    expect(screen.getByTestId('authority').textContent).toBe('blocked');
    await act(async () => next.resolve({ data: snapshot, error: null }));
    expect(screen.getByTestId('status').textContent).toBe('ready');
  });

  it.each(['rejected', 'malformed', 'identity'] as const)('keeps auth-event verification failed after a %s read', async (failure) => {
    const { rpc, client, emit } = setup();
    await waitFor(() => expect(screen.getByTestId('authority').textContent).toBe('allowed'));
    if (failure === 'rejected') rpc.mockRejectedValueOnce(new Error('offline'));
    else if (failure === 'malformed') rpc.mockResolvedValueOnce({ data: null, error: null });
    else client.auth.getUser.mockRejectedValueOnce(new Error('offline'));
    act(() => emit(undefined, 'SIGNED_IN'));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'));
    expect(screen.getByTestId('authority').textContent).toBe('blocked');
    expect(screen.getByTestId('identity').textContent).toBe(failure === 'identity' ? 'signed-out' : 'verified-operator');
  });

  it('immediately clears the old account on a different-user auth event', async () => {
    const { client, session, emit } = setup();
    await waitFor(() => expect(screen.getByTestId('authority').textContent).toBe('allowed'));
    const user = { ...session.user, id: 'different-account' };
    const next = deferred<unknown>();
    client.auth.getUser.mockImplementationOnce(() => next.promise as never);
    act(() => emit({ ...session, user }, 'SIGNED_IN'));
    expect(screen.getByTestId('authority').textContent).toBe('blocked');
    expect(screen.getByTestId('identity').textContent).toBe('signed-out');
    await act(async () => next.resolve({ data: { user }, error: null }));
  });
});

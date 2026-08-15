import { afterEach, describe, expect, it, vi } from 'vitest';

const createClient = vi.fn(() => ({ kind: 'admin-client' }));

vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('@shell/lib/supabase/env', () => ({
  SUPABASE_URL: 'https://uatref123.supabase.co',
}));

describe('createSupabaseAdminClient', () => {
  afterEach(() => {
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    createClient.mockClear();
  });

  it('prefers the current Supabase server secret and disables browser auth behavior', async () => {
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_current';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'legacy-service-role';
    const { createSupabaseAdminClient } = await import('@shell/lib/supabase/admin');

    expect(createSupabaseAdminClient()).toEqual({ kind: 'admin-client' });
    expect(createClient).toHaveBeenCalledWith(
      'https://uatref123.supabase.co',
      'sb_secret_current',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      },
    );
  });

  it('supports the legacy server key during migration', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'legacy-service-role';
    const { createSupabaseAdminClient } = await import('@shell/lib/supabase/admin');

    createSupabaseAdminClient();

    expect(createClient).toHaveBeenCalledWith(
      'https://uatref123.supabase.co',
      'legacy-service-role',
      expect.any(Object),
    );
  });

  it('does not create an elevated client without a server credential', async () => {
    const { createSupabaseAdminClient } = await import('@shell/lib/supabase/admin');

    expect(createSupabaseAdminClient()).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createRepository } from './createRepository';

describe('createRepository production boundary', () => {
  it('fails closed when Supabase is explicitly selected without an adapter', () => {
    expect(() => createRepository({ dataSource: 'supabase' })).toThrow(
      /supabase repository requires/i,
    );
  });

  it('does not hide Supabase adapter construction failures behind memory mode', () => {
    const failure = new Error('schema is not exposed');

    expect(() =>
      createRepository({
        dataSource: 'supabase',
        supabase: { url: 'https://example.supabase.co', anonKey: 'anon-key' },
        createSupabaseRepository: vi.fn(() => {
          throw failure;
        }),
      }),
    ).toThrow(failure);
  });
});

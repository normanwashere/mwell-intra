import type { ShellSupabaseClient } from './supabase/types';
import { AUDIT_BATCH_SIZE, type AuditReader, type AuditRow } from './adminAuditQuery';

export function sessionAuditReader(client: ShellSupabaseClient, signal?: AbortSignal): AuditReader {
  const core = client.schema('core');
  return {
    async events(query) {
      let read = core.from('activity_log')
        .select('id,module,entity_type,entity_id,action,actor,detail,created_at')
        .order('id', { ascending: false }).limit(AUDIT_BATCH_SIZE);
      if (query.module) read = read.eq('module', query.module);
      if (query.from) read = read.gte('created_at', `${query.from}T00:00:00+08:00`);
      if (query.to) {
        const nextDay = new Date(`${query.to}T00:00:00Z`);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        read = read.lt('created_at', `${nextDay.toISOString().slice(0, 10)}T00:00:00+08:00`);
      }
      if (query.before !== null) read = read.lt('id', query.before);
      if (query.snapshot !== null) read = read.lte('id', query.snapshot);
      if (signal) read = read.abortSignal(signal);
      const { data, error } = await read;
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
    async actors(ids) {
      if (!ids.length) return {};
      let read = core.from('profiles').select('id,full_name,email').in('id', ids);
      if (signal) read = read.abortSignal(signal);
      const { data, error } = await read;
      if (error) throw error;
      return Object.fromEntries((data ?? []).map(row => [row.id, [row.full_name, row.email].filter(Boolean).join(' | ')]));
    },
  };
}

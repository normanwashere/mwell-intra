import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/** History rows arrive after route navigation; native fragment scrolling can run too early. */
export function useReturnHistoryAnchor(prefix: string, records: readonly { id: string }[] | undefined) {
  const { hash, key } = useLocation();
  const handled = useRef('');
  useEffect(() => {
    const navigation = `${key}:${hash}`;
    if (handled.current === navigation || !hash.startsWith(`#${prefix}`)) return;
    let id: string;
    try { id = decodeURIComponent(hash.slice(1)); } catch { return; }
    if (!records?.some(record => `${prefix}${record.id}` === id)) return;
    const target = document.getElementById(id);
    if (!target) return;
    handled.current = navigation;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'center' });
  }, [hash, key, prefix, records]);
}

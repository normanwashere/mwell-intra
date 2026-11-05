"use client";

import { useEffect } from 'react';
import { useSession } from '@intra/auth';
import { purgePrivateResponseCaches } from '@shell/lib/publicCachePolicy';

export function SessionCacheBoundary() {
  const { profile } = useSession();
  useEffect(() => {
    if (typeof caches === 'undefined') return;
    void purgePrivateResponseCaches(caches, window.location.origin).catch(() => {
      console.warn('Old offline responses could not be cleared. Private data remains network-only.');
    });
  }, [profile?.id]);
  return null;
}

'use client';

// Surfaces `intra:storage-full` events (dispatched by the module localStorage
// writers when a write hits the browser quota) as a visible toast, so a large
// attachment/evidence file can never silently drop a record on reload.

import { useEffect } from 'react';
import { useToast } from '@intra/ui';

export function StorageFullToast() {
  const { error } = useToast();
  useEffect(() => {
    const onFull = () =>
      error(
        'Storage is full — that change was not saved. Remove large attachments/photos or reset demo data.',
      );
    window.addEventListener('intra:storage-full', onFull as EventListener);
    return () =>
      window.removeEventListener('intra:storage-full', onFull as EventListener);
  }, [error]);
  return null;
}

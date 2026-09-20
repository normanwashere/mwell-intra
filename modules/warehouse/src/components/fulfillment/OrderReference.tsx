import { Icon, RecordCopyActions } from '@intra/ui';
import { useState } from 'react';

export function shortOrderReference(reference: string) {
  return reference.length > 32 ? `${reference.slice(0, 16)}...${reference.slice(-10)}` : reference;
}

export function OrderReference({ reference, orderId }: { reference: string; orderId: string }) {
  const [expanded, setExpanded] = useState(false);
  const short = shortOrderReference(reference);
  return <div className="min-w-0 text-sm">
    {short === reference ? <p className="break-words font-semibold text-ink">{reference}</p> : <details className="min-w-0" onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary aria-label="Full order reference" title="Full order reference" className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm text-brand-700 underline dark:text-brand-300 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 break-words font-semibold">{short}</span><Icon name="info" className="h-4 w-4 shrink-0" /><span className="sr-only">Full order reference</span>
      </summary>
      {expanded && <>
        <p className="select-text break-all py-2">{reference}</p>
        <RecordCopyActions reference={reference} href={`/warehouse/fulfillment?tab=orders&order=${encodeURIComponent(orderId)}`} />
      </>}
    </details>}
  </div>;
}

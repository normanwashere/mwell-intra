'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { EventsApp } from '@intra/events';

export default function EventsPage() {
  const params = useParams<{ slug?: string[] }>();
  const searchParams = useSearchParams();
  return <EventsApp eventId={params.slug?.[0]} openCreate={searchParams.get('create') === '1'} />;
}

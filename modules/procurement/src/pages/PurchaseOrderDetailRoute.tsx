'use client';

import { useParams } from 'react-router-dom';
import { useAcceptanceWorkItem } from '../localStore';
import { AcceptanceWorkItemView } from './AcceptanceWorkItemPage';
import { PODetailPage } from './PODetailPage';

export function PurchaseOrderDetailRoute({
  canViewFullDetail,
}: {
  canViewFullDetail: boolean;
}) {
  const { id = '' } = useParams();
  const acceptance = useAcceptanceWorkItem(id);

  if (canViewFullDetail) return <PODetailPage />;
  if (acceptance.loading || acceptance.item) {
    return <AcceptanceWorkItemView controller={acceptance} />;
  }

  // Source requesters can still complete service or milestone acceptance in
  // the full detail view. PODetailPage independently verifies ownership.
  return <PODetailPage />;
}

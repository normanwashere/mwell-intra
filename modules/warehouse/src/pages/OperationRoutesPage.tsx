import { useEffect, useState } from 'react';
import type { ControlledLocationType, OperationRoute } from '@intra/data-kit';
import { useWarehouse } from '@/app/store';
import { can } from '@/auth/roles';
import { Badge, EmptyState, PageHeader, Sheet } from '@/components/ui';

const LOCATION_TYPES: ControlledLocationType[] = ['warehouse', 'event_site', 'vendor'];
const POLICY_FIELDS: Array<{ text: string; field: 'requiresEvidence' | 'requiresApproval' | 'requiresOnline' | 'active' }> = [
  { text: 'Evidence required', field: 'requiresEvidence' },
  { text: 'Approval required', field: 'requiresApproval' },
  { text: 'Online required', field: 'requiresOnline' },
  { text: 'Active', field: 'active' },
];
const label = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

export function OperationRoutesPage() {
  const { data, role, updateOperationRoute } = useWarehouse();
  const [selected, setSelected] = useState<OperationRoute | null>(null);
  const [draft, setDraft] = useState<OperationRoute | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(selected ? { ...selected, sourceLocationTypes: [...selected.sourceLocationTypes], destinationLocationTypes: [...selected.destinationLocationTypes] } : null), [selected]);
  if (!data) return null;
  const routes = data.operationRoutes ?? [];
  const mayEdit = can(role, 'manage_operation_routes');
  const isLastActive = (route: OperationRoute) =>
    selected?.id === route.id &&
    selected.active &&
    routes.filter(
      (other) =>
        other.operationTypeId === route.operationTypeId && other.active,
    ).length === 1;
  const toggleLocation = (field: 'sourceLocationTypes' | 'destinationLocationTypes', value: ControlledLocationType) => {
    if (!draft) return;
    const values = draft[field].includes(value) ? draft[field].filter((item) => item !== value) : [...draft[field], value];
    setDraft({ ...draft, [field]: values });
  };
  const save = async () => {
    if (!draft || draft.sourceLocationTypes.length === 0 || draft.destinationLocationTypes.length === 0) return;
    setSaving(true);
    try {
      const ok = await updateOperationRoute({
        idempotencyKey: `operation-route-${draft.id}-${Date.now()}`,
        routeId: draft.id,
        patch: {
          sourceLocationTypes: draft.sourceLocationTypes,
          destinationLocationTypes: draft.destinationLocationTypes,
          requiresEvidence: draft.requiresEvidence,
          requiresApproval: draft.requiresApproval,
          requiresOnline: draft.requiresOnline,
          active: draft.active,
        },
      });
      if (ok) setSelected(null);
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Operation routes" icon="transfer" subtitle="Control allowed movement paths, evidence, approvals, and connectivity" />
      {routes.length === 0 ? <EmptyState icon="transfer" title="No operation routes configured" /> : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface" aria-label="Operation routes">
          {routes.map((route) => (
            <li key={route.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-ink">{label(route.operationTypeId.replace(/^operation-/, '').replace(/^route-/, '').replace(/-default$/, ''))}</p><Badge tone={route.active ? 'emerald' : 'slate'}>{route.active ? 'Active' : 'Inactive'}</Badge></div>
                <p className="mt-1 break-words text-sm text-muted">{route.sourceLocationTypes.map(label).join(', ')} → {route.destinationLocationTypes.map(label).join(', ')}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-faint"><span>{route.requiresEvidence ? 'Evidence required' : 'Evidence optional'}</span><span>·</span><span>{route.requiresApproval ? 'Approval required' : 'No approval'}</span><span>·</span><span>{route.requiresOnline ? 'Online required' : 'Offline allowed'}</span></div>
                {!route.active && <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">Inactive routes cannot be selected for new warehouse work.</p>}
              </div>
              {mayEdit && <button type="button" className="btn-primary btn-sm justify-center" onClick={() => setSelected(route)}>Edit route</button>}
            </li>
          ))}
        </ul>
      )}

      <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }} title="Edit operation route" description={selected ? label(selected.operationTypeId) : undefined} footer={<button type="button" className="btn-primary w-full justify-center" disabled={!draft || draft.sourceLocationTypes.length === 0 || draft.destinationLocationTypes.length === 0 || saving} onClick={() => void save()}>{saving ? 'Saving...' : 'Save route'}</button>}>
        {draft && <div className="space-y-4">
          {(['sourceLocationTypes', 'destinationLocationTypes'] as const).map((field) => <fieldset key={field}><legend className="label">{field === 'sourceLocationTypes' ? 'Source types' : 'Destination types'}</legend><div className="grid grid-cols-3 gap-2">{LOCATION_TYPES.map((value) => <label key={value} className="flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-sm text-ink"><input type="checkbox" checked={draft[field].includes(value)} onChange={() => toggleLocation(field, value)} />{label(value)}</label>)}</div></fieldset>)}
          <div className="space-y-2">
            {POLICY_FIELDS.map(({ text, field }) => <label key={field} className="flex min-h-11 items-center justify-between rounded-lg bg-inset px-3 text-sm font-medium text-ink"><span>{text}</span><input type="checkbox" aria-label={text} checked={draft[field]} disabled={field === 'active' && isLastActive(draft)} onChange={(event) => setDraft({ ...draft, [field]: event.target.checked })} /></label>)}
          </div>
          {isLastActive(draft) && <p className="text-sm text-amber-700 dark:text-amber-300">The last active route for an operation type cannot be disabled.</p>}
        </div>}
      </Sheet>
    </div>
  );
}

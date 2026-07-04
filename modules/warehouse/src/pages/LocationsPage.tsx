import { useMemo, useState } from 'react';
import { useWarehouse } from '@/app/store';
import type { Location } from '@/domain/types';
import {
  Badge,
  Card,
  EmptyState,
  Field,
  PageHeader,
  Sheet,
  useToast,
} from '@/components/ui';
import { Icon } from '@/components/Icon';

const TYPE_META: Record<Location['type'], { label: string; tone: 'brand' | 'accent' | 'amber' | 'slate' }> = {
  warehouse: { label: 'Warehouse', tone: 'brand' },
  event_site: { label: 'Event site', tone: 'accent' },
  vendor: { label: 'Vendor', tone: 'slate' },
};

export function LocationsPage() {
  const { data, createLocation, updateLocation, deleteLocation } = useWarehouse();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<Location['type']>('warehouse');
  const [id, setId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const locations = useMemo(
    () => [...(data?.locations ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );

  const openAdd = () => {
    setEditing(null);
    setName('');
    setType('warehouse');
    setId('');
    setError(null);
    setOpen(true);
  };

  const openEdit = (l: Location) => {
    setEditing(l);
    setName(l.name);
    setType(l.type);
    setId(l.id);
    setError(null);
    setOpen(true);
  };

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    if (editing) {
      const ok = await updateLocation({ locationId: editing.id, name: name.trim(), type });
      if (!ok) return;
      toast.success(`Updated ${name.trim()}`);
    } else {
      const ok = await createLocation({ id: id.trim() || undefined, name: name.trim(), type });
      if (!ok) return;
      toast.success(`Added ${name.trim()}`);
    }
    setOpen(false);
    setName('');
    setId('');
    setType('warehouse');
    setEditing(null);
  };

  const remove = async (l: Location) => {
    const ok = await deleteLocation({ locationId: l.id });
    if (!ok) return;
    toast.success(`Removed ${l.name}`);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Locations"
        subtitle="Warehouses & event sites"
        action={
          <button type="button" className="btn-primary btn-sm" onClick={openAdd}>
            <Icon name="plus" /> Add
          </button>
        }
      />

      {locations.length === 0 ? (
        <Card>
          <EmptyState icon="building" title="No locations yet" message="Add a warehouse or event site." />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {locations.map((l) => {
            const meta = TYPE_META[l.type] ?? { label: l.type, tone: 'amber' as const };
            return (
              <Card key={l.id} className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">{l.name}</p>
                    <p className="font-mono text-xs text-faint">{l.id}</p>
                  </div>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-ghost btn-sm flex-1 justify-center"
                    onClick={() => openEdit(l)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn-outline btn-sm text-rose-500"
                    aria-label={`Delete ${l.name}`}
                    onClick={() => void remove(l)}
                  >
                    <Icon name="x" />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={editing ? 'Edit location' : 'Add location'}
        footer={
          <button type="button" className="btn-primary w-full justify-center" onClick={() => void submit()}>
            {editing ? 'Save' : 'Add'}
          </button>
        }
      >
        <div className="space-y-3">
          <Field label="Name" htmlFor="loc-name">
            <input
              id="loc-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Davao Hub"
            />
          </Field>
          {!editing && (
            <Field
              label="ID (optional)"
              htmlFor="loc-id"
              hint="Leave blank to auto-generate. Used in barcodes & references."
            >
              <input
                id="loc-id"
                className="input"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="e.g. loc-davao"
              />
            </Field>
          )}
          <Field label="Type" htmlFor="loc-type">
            <select
              id="loc-type"
              className="input"
              value={type}
              onChange={(e) => setType(e.target.value as Location['type'])}
            >
              <option value="warehouse">Warehouse</option>
              <option value="event_site">Event site</option>
              <option value="vendor">Vendor</option>
            </select>
          </Field>
          {error && (
            <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">
              {error}
            </p>
          )}
        </div>
      </Sheet>
    </div>
  );
}

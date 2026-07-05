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
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    setConfirmDelete(false);
    setOpen(true);
  };

  const openEdit = (l: Location) => {
    setEditing(l);
    setName(l.name);
    setType(l.type);
    setId(l.id);
    setError(null);
    setConfirmDelete(false);
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
    setOpen(false);
    setEditing(null);
    setConfirmDelete(false);
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
              /* Row = target (WH-21): the card opens the edit sheet; Delete
                 lives inside it behind a confirm. Type replaces the raw id
                 as the secondary line (WH-22). */
              <button
                key={l.id}
                type="button"
                onClick={() => openEdit(l)}
                className="card block w-full space-y-2 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-e3"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate font-semibold text-ink">{l.name}</p>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 dark:text-brand-300">
                  Edit <Icon name="chevron" className="h-3.5 w-3.5" />
                </span>
              </button>
            );
          })}
        </div>
      )}

      <Sheet
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setConfirmDelete(false);
        }}
        title={editing ? 'Edit location' : 'Add location'}
        description={editing ? `Reference id: ${editing.id}` : undefined}
        footer={
          <div className="space-y-2">
            <button type="button" className="btn-primary w-full justify-center" onClick={() => void submit()}>
              {editing ? 'Save' : 'Add'}
            </button>
            {editing &&
              (confirmDelete ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-ghost flex-1 justify-center"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Keep location
                  </button>
                  <button
                    type="button"
                    className="btn-outline flex-1 justify-center text-rose-500"
                    onClick={() => editing && void remove(editing)}
                  >
                    Confirm delete
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn-ghost w-full justify-center text-rose-500"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Icon name="x" className="h-4 w-4" /> Delete location…
                </button>
              ))}
          </div>
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

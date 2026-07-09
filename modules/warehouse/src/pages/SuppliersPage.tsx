import { useState } from 'react';
import { useWarehouse } from '@/app/store';
import type { Supplier } from '@/domain/types';
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

export function SuppliersPage() {
  const { data, createSupplier, updateSupplier } = useWarehouse();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [name, setName] = useState('');
  const [leadTime, setLeadTime] = useState(14);
  const [error, setError] = useState<string | null>(null);

  if (!data) return null;

  const poCount = (supplierId: string) =>
    data.purchaseOrders.filter((po) => po.supplierId === supplierId).length;
  const skuCount = (supplierId: string) =>
    new Set(
      data.lots.filter((l) => l.supplierId === supplierId).map((l) => l.productId),
    ).size;

  const openAdd = () => {
    setEditing(null);
    setName('');
    setLeadTime(14);
    setError(null);
    setOpen(true);
  };

  const openEdit = (s: Supplier) => {
    setEditing(s);
    setName(s.name);
    setLeadTime(s.leadTimeDays);
    setError(null);
    setOpen(true);
  };

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Supplier name is required.');
      return;
    }
    if (editing) {
      const ok = await updateSupplier({
        supplierId: editing.id,
        name: name.trim(),
        leadTimeDays: leadTime,
      });
      if (!ok) return;
      toast.success(`Updated ${name.trim()}`);
    } else {
      const ok = await createSupplier({ name: name.trim(), leadTimeDays: leadTime });
      if (!ok) return;
      toast.success(`Added ${name.trim()}`);
    }
    setOpen(false);
    setName('');
    setLeadTime(14);
    setEditing(null);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Suppliers"
        icon="building"
        subtitle="Supplier information & lead times"
        action={
          <button type="button" className="btn-primary btn-sm" onClick={openAdd}>
            <Icon name="plus" className="h-4 w-4" /> Add supplier
          </button>
        }
      />

      {data.suppliers.length === 0 ? (
        <EmptyState icon="building" title="No suppliers yet" />
      ) : (
        <ul className="grid gap-2 lg:grid-cols-2" aria-label="Suppliers">
          {data.suppliers.map((s) => (
            <li key={s.id}>
              <Card className="flex items-center justify-between gap-3 !p-4">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">{s.name}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge tone="brand">{s.leadTimeDays}d lead</Badge>
                    <Badge tone="slate">{skuCount(s.id)} SKUs</Badge>
                    <Badge tone="slate">{poCount(s.id)} POs</Badge>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  aria-label={`Edit ${s.name}`}
                  onClick={() => openEdit(s)}
                >
                  <Icon name="box" className="h-4 w-4" /> Edit
                </button>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={editing ? 'Edit supplier' : 'Add supplier'}
        description="Capture sourcing partner details."
        footer={
          <button type="button" className="btn-primary w-full" onClick={() => void submit()}>
            Save supplier
          </button>
        }
      >
        <div className="space-y-3">
          <Field label="Supplier name" htmlFor="sup-name" error={error ?? undefined}>
            <input
              id="sup-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. MetroPrint Apparel"
            />
          </Field>
          <Field label="Lead time (days)" htmlFor="sup-lead">
            <input
              id="sup-lead"
              type="number"
              min={0}
              className="input"
              value={leadTime}
              onChange={(e) => setLeadTime(Number(e.target.value))}
            />
          </Field>
        </div>
      </Sheet>
    </div>
  );
}

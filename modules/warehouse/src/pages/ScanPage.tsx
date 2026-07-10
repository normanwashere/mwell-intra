import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useWarehouse } from '@/app/store';
import { can, type Capability } from '@/auth/roles';
import { BarcodeScanner } from '@/components/camera/BarcodeScanner';
import { Field, PageHeader, useToast } from '@/components/ui';
import { Icon, type IconName } from '@/components/Icon';

const ACTIONS: Array<{ label: string; to: string; icon: IconName; capabilities: Capability[] }> = [
  { label: 'Receive', to: '/receiving', icon: 'truck', capabilities: ['receive_stock'] },
  { label: 'Issue', to: '/allocations', icon: 'tag', capabilities: ['issue_items'] },
  { label: 'Return', to: '/returns', icon: 'rotate', capabilities: ['manage_returns'] },
  { label: 'Count', to: '/cycle-counts', icon: 'clipboard', capabilities: ['cycle_count'] },
  { label: 'Put away', to: '/storage', icon: 'pin', capabilities: ['receive_stock', 'transfer_stock'] },
  { label: 'Transfer', to: '/inventory', icon: 'rotate', capabilities: ['transfer_stock'] },
  { label: 'Lookup', to: '/inventory', icon: 'search', capabilities: ['manage_inventory'] },
];

export function ScanPage() {
  const { data, role } = useWarehouse();
  const navigate = useNavigate();
  const toast = useToast();
  const [manual, setManual] = useState('');
  const actions = ACTIONS.filter((action) => action.capabilities.some((capability) => can(role, capability)));
  const lookup = (code: string) => {
    const product = data?.products.find((item) => item.barcode === code || item.sku.toLowerCase() === code.toLowerCase());
    if (!product) return toast.error(`No product matches "${code}"`);
    navigate(`/inventory/${product.id}`);
  };
  return (
    <div className="space-y-5">
      <PageHeader title="Scan" icon="scan" subtitle="Choose an operation or find stock" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Scan operations">
        {actions.map((action) => (
          <Link key={action.label} to={action.to} className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl border border-line bg-surface p-3 text-sm font-semibold text-ink">
            <Icon name={action.icon} className="h-5 w-5 text-brand-600" />{action.label}
          </Link>
        ))}
      </div>
      <BarcodeScanner onDetected={lookup} label="Scan product" />
      <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (manual.trim()) lookup(manual.trim()); }}>
        <Field label="Enter barcode or SKU manually" htmlFor="manual-scan">
          <input id="manual-scan" className="input" value={manual} onChange={(event) => setManual(event.target.value)} />
        </Field>
        <button type="submit" className="btn-primary min-h-11">Find</button>
      </form>
    </div>
  );
}

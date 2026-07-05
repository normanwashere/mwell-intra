'use client';

import type { FormEvent } from 'react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Button,
  Field,
  HeroChipButton,
  Icon,
  Input,
  ModuleHero,
  Textarea,
  useToast,
} from '@intra/ui';
import { Guard, useSession } from '@intra/auth';
import { useProcurementRequests, useProcurementVendors } from '../localStore';

interface LineDraft {
  key: string;
  description: string;
  quantity: string;
  uom: string;
  unitPrice: string;
}

function blankLine(): LineDraft {
  return {
    key: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
    description: '',
    quantity: '1',
    uom: 'ea',
    unitPrice: '',
  };
}

function toNumber(v: string): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function CreateRequestPage() {
  const navigate = useNavigate();
  const { success, error } = useToast();
  const { add } = useProcurementRequests();
  const vendors = useProcurementVendors();
  const { profile } = useSession();

  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [costCenter, setCostCenter] = useState('');
  const [neededBy, setNeededBy] = useState('');
  const [description, setDescription] = useState('');
  const [vendorId, setVendorId] = useState<string>('');
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [submitting, setSubmitting] = useState(false);

  const total = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const q = toNumber(l.quantity) ?? 0;
        const p = toNumber(l.unitPrice) ?? 0;
        return sum + q * p;
      }, 0),
    [lines],
  );

  const canSubmit = title.trim().length > 0 && lines.some((l) => l.description.trim());

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== key)));
  }

  async function handleSubmit(event: FormEvent, andSubmit = false) {
    event.preventDefault();
    if (!canSubmit) {
      error('Give the request a title and at least one line item.');
      return;
    }
    setSubmitting(true);
    try {
      const cleanLines = lines
        .filter((l) => l.description.trim())
        .map((l) => ({
          description: l.description.trim(),
          quantity: toNumber(l.quantity) ?? 1,
          uom: l.uom.trim() || 'ea',
          unitPrice: toNumber(l.unitPrice),
        }));
      const vendor = vendors.find((v) => v.id === vendorId);
      const created = add({
        title: title.trim(),
        description: description.trim() || undefined,
        department: department.trim() || undefined,
        costCenter: costCenter.trim() || undefined,
        neededBy: neededBy.trim() || undefined,
        vendorId: vendor?.id,
        vendorName: vendor?.legalName,
        requesterName: profile?.name,
        requesterEmail: profile?.email,
        lines: cleanLines,
      });
      if (andSubmit) {
        // Submit right away — jump straight into review queue.
        navigate(`/requests/${created.id}?submit=1`);
      } else {
        success('Draft request saved');
        navigate(`/requests/${created.id}`);
      }
    } catch (e) {
      error(e instanceof Error ? e.message : 'Could not save the draft.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Guard module="procurement" cap="create_request">
      <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
        <ModuleHero
          eyebrow="New request"
          title="Draft a purchase request"
          description="Add line items, target vendor (optional), and cost center. Submit when ready — an approver picks it up in their inbox."
          icon="cart"
          action={
            <HeroChipButton icon="x" href="/procurement">
              Cancel
            </HeroChipButton>
          }
        />

        <form className="space-y-6" onSubmit={(e) => handleSubmit(e, false)}>
          <section className="card space-y-4 p-4 sm:p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title" htmlFor="title">
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. PPE restock — Q3 activation"
                  required
                />
              </Field>
              <Field label="Needed by" htmlFor="neededBy">
                <Input
                  id="neededBy"
                  type="date"
                  value={neededBy}
                  onChange={(e) => setNeededBy(e.target.value)}
                />
              </Field>
              <Field label="Department" htmlFor="department">
                <Input
                  id="department"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  placeholder="Marketing"
                />
              </Field>
              <Field label="Cost center" htmlFor="costCenter">
                <Input
                  id="costCenter"
                  value={costCenter}
                  onChange={(e) => setCostCenter(e.target.value)}
                  placeholder="MKT-2026-EV"
                />
              </Field>
            </div>

            <Field label="Business justification" htmlFor="description">
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Why is this needed? Delivery constraints, references, links to prior POs…"
              />
            </Field>

            <Field label="Preferred vendor (optional)" htmlFor="vendor">
              <select
                id="vendor"
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                className="input"
              >
                <option value="">— none / open to bids —</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.legalName}
                    {v.accreditationStatus !== 'approved'
                      ? ` · (${v.accreditationStatus})`
                      : ''}
                  </option>
                ))}
              </select>
            </Field>
          </section>

          <section className="card space-y-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-base font-bold text-ink">Line items</h2>
                <p className="text-xs text-muted">
                  Add each SKU/service with quantity + unit price. Estimated total updates live.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLines((prev) => [...prev, blankLine()])}
                className="btn-outline btn-sm"
              >
                <Icon name="plus" className="h-4 w-4" />
                Add line
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] table-fixed text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-faint">
                  <tr>
                    <th className="w-2/5 py-2 pr-3">Description</th>
                    <th className="w-16 py-2 pr-3">Qty</th>
                    <th className="w-20 py-2 pr-3">UoM</th>
                    <th className="w-24 py-2 pr-3">Unit ₱</th>
                    <th className="w-24 py-2 pr-3 text-right">Line ₱</th>
                    <th className="w-8" aria-hidden />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const q = toNumber(l.quantity) ?? 0;
                    const p = toNumber(l.unitPrice) ?? 0;
                    return (
                      <tr key={l.key} className="border-t border-line align-top">
                        <td className="py-2 pr-3">
                          <input
                            aria-label={`Line ${i + 1} description`}
                            className="input"
                            value={l.description}
                            onChange={(e) => updateLine(l.key, { description: e.target.value })}
                            placeholder="ECG Ring Size 8 (10 pcs)"
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            aria-label={`Line ${i + 1} quantity`}
                            className="input"
                            type="number"
                            min="0"
                            step="1"
                            value={l.quantity}
                            onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            aria-label={`Line ${i + 1} unit of measure`}
                            className="input"
                            value={l.uom}
                            onChange={(e) => updateLine(l.key, { uom: e.target.value })}
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            aria-label={`Line ${i + 1} unit price`}
                            className="input"
                            type="number"
                            min="0"
                            step="0.01"
                            value={l.unitPrice}
                            onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })}
                            placeholder="0.00"
                          />
                        </td>
                        <td className="py-2 pr-3 text-right tnum font-semibold text-ink">
                          {(q * p).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td className="py-2">
                          <button
                            type="button"
                            onClick={() => removeLine(l.key)}
                            disabled={lines.length === 1}
                            aria-label={`Remove line ${i + 1}`}
                            className="grid h-8 w-8 place-items-center rounded-lg text-faint transition hover:bg-inset hover:text-rose-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-faint"
                          >
                            <Icon name="x" className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line">
                    <td colSpan={4} className="py-2 pr-3 text-right text-xs uppercase tracking-wide text-faint">
                      Estimated total
                    </td>
                    <td className="py-2 pr-3 text-right tnum text-base font-extrabold text-ink">
                      ₱{total.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <Link to="/" className="btn-ghost">
              Cancel
            </Link>
            <Button
              type="submit"
              variant="outline"
              disabled={submitting || !canSubmit}
            >
              {submitting ? 'Saving…' : 'Save draft'}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={submitting || !canSubmit}
              onClick={(e) => handleSubmit(e as unknown as FormEvent, true)}
            >
              {submitting ? 'Submitting…' : 'Save & submit for approval'}
            </Button>
          </div>
        </form>
      </div>
    </Guard>
  );
}

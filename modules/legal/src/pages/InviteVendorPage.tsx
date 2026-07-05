'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  Field,
  HeroChipButton,
  Icon,
  Input,
  ModuleHero,
  useToast,
} from '@intra/ui';
import { Guard, useSession } from '@intra/auth';
import { useAccreditationCases, useVendorInvites } from '../localStore';

export function InviteVendorPage() {
  const navigate = useNavigate();
  const { profile } = useSession();
  const { success, error } = useToast();
  const { invite } = useVendorInvites();
  const { addCase } = useAccreditationCases();
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState('');
  const [autoCreate, setAutoCreate] = useState(true);
  const [busy, setBusy] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!companyName.trim() || !email.trim()) {
      error('Company name and email are required.');
      return;
    }
    setBusy(true);
    try {
      const inv = invite({
        email: email.trim(),
        companyName: companyName.trim(),
        category: category.trim() || undefined,
        actor: profile?.email,
      });
      if (autoCreate) {
        const vendorId = `ven-${inv.id}`;
        const kase = addCase(
          vendorId,
          companyName.trim(),
          category.trim() || undefined,
          profile?.email,
        );
        success(`Invite sent — draft case opened for ${companyName.trim()}`);
        navigate(`/cases/${kase.id}`);
      } else {
        success(`Invite sent to ${email.trim()}`);
        navigate('/');
      }
    } catch (e) {
      error(e instanceof Error ? e.message : 'Could not send the invite.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Guard module="legal" cap="manage_checklist">
      <div className="mx-auto max-w-2xl space-y-6">
        <ModuleHero
          eyebrow="Invite vendor"
          title="Onboard a new vendor"
          description="Send an accreditation invite. The vendor gets a signup link and, once they accept, a case appears in the review pipeline."
          icon="building"
          action={
            <HeroChipButton href="/legal" icon="arrowRight">
              Back to cases
            </HeroChipButton>
          }
        />

        <Card>
          <form className="space-y-4" onSubmit={submit}>
            <Field label="Company name" htmlFor="companyName">
              <Input
                id="companyName"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Acme Medical Supplies, Inc."
                required
              />
            </Field>
            <Field label="Vendor contact email" htmlFor="email">
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ops@acme.com"
                required
              />
            </Field>
            <Field label="Primary category (optional)" htmlFor="category">
              <Input
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Medical devices, consumables"
              />
            </Field>

            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={autoCreate}
                onChange={(e) => setAutoCreate(e.target.checked)}
                className="mt-1"
              />
              <span>
                <span className="font-semibold">Also open an accreditation case now</span>
                <span className="block text-xs text-muted">
                  Recommended — a draft case is created with the default requirement checklist ready for review once the vendor uploads.
                </span>
              </span>
            </label>

            <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
              <Link to="/" className="btn-ghost">
                Cancel
              </Link>
              <Button type="submit" variant="primary" disabled={busy}>
                <Icon name="plus" className="h-4 w-4" />
                {busy ? 'Sending…' : 'Send invite'}
              </Button>
            </div>

            <p className="text-xs text-muted">
              Preview build: this doesn&apos;t actually send an email. In production the invite lands in the vendor&apos;s inbox with a magic-link that spawns their profile + this case.
            </p>
          </form>
        </Card>
      </div>
    </Guard>
  );
}

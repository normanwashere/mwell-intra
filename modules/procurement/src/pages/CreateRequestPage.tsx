'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Field, Input, PageHeader, Textarea, useToast } from '@intra/ui';
import { Guard } from '@intra/auth';

export function CreateRequestPage() {
  const navigate = useNavigate();
  const { success, error } = useToast();
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [description, setDescription] = useState('');
  const [estimatedAmount, setEstimatedAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      error('Title is required');
      return;
    }
    setSubmitting(true);
    try {
      // Stub: wire to procurement.create_request RPC in Step 3d.
      await new Promise((resolve) => setTimeout(resolve, 400));
      success('Request saved (stub)');
      navigate('/');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Guard module="procurement" cap="create_request">
      <div className="mx-auto max-w-2xl space-y-6 p-4 md:p-6">
        <PageHeader
          title="New purchase request"
          subtitle="Draft a request for procurement review."
        />

        <form className="space-y-4" onSubmit={handleSubmit}>
          <Field label="Title" htmlFor="title">
            <Input
              id="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. PPE restock — Q3 activation"
              required
            />
          </Field>

          <Field label="Department" htmlFor="department">
            <Input
              id="department"
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              placeholder="Marketing"
            />
          </Field>

          <Field label="Description" htmlFor="description">
            <Textarea
              id="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              placeholder="What is needed, quantities, delivery timeline…"
            />
          </Field>

          <Field label="Estimated amount (PHP)" htmlFor="estimatedAmount">
            <Input
              id="estimatedAmount"
              type="number"
              min="0"
              step="0.01"
              value={estimatedAmount}
              onChange={(event) => setEstimatedAmount(event.target.value)}
              placeholder="0.00"
            />
          </Field>

          <div className="flex flex-wrap gap-3 pt-2">
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save draft'}
            </Button>
            <Link to="/" className="btn-ghost">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </Guard>
  );
}

import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { Sheet } from '@intra/ui';
import { EvidenceCapture } from './EvidenceCapture';

const state = vi.hoisted(() => {
  const sign = vi.fn();
  const upload = vi.fn();
  const from = vi.fn(() => ({ createSignedUrl: sign, upload }));
  return { sign, upload, from, client: { storage: { from } }, actor: 'receiver-A' };
});
vi.mock('@intra/auth', () => ({
  useSession: () => ({ mode: 'supabase', supabaseClient: state.client, profile: { id: state.actor } }),
}));

const stored = 'inspection/owned/0/photo.png';
const signed = 'https://storage.example/private-photo.png?token=synthetic-test-only';
const viewButton = () => screen.getByRole('button', { name: /view.*evidence photo/i });

describe('EvidenceCapture pre-submit preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.actor = 'receiver-A';
    state.sign.mockResolvedValue({ data: { signedUrl: signed }, error: null });
    state.upload.mockResolvedValue({ data: {}, error: null });
  });

  it('opens the existing lightbox by keyboard and keeps nested Sheet focus and submission independent', async () => {
    const change = vi.fn();
    const submit = vi.fn();
    function Form() {
      const [open, setOpen] = useState(false);
      return <>
        <button onClick={() => setOpen(true)}>Inspect</button>
        <Sheet open={open} onOpenChange={setOpen} title="Inspection">
          <form onSubmit={event => { event.preventDefault(); submit(); }}>
            <EvidenceCapture reference="inspection/owned" value={[stored]} onChange={change} />
            <button type="submit">Submit inspection</button>
          </form>
        </Sheet>
      </>;
    }
    const user = userEvent.setup();
    render(<Form />);
    const opener = screen.getByRole('button', { name: 'Inspect' });
    await user.click(opener);
    const sheet = await screen.findByRole('dialog', { name: 'Inspection' });
    await screen.findByRole('img', { name: 'Evidence' });
    const trigger = viewButton();
    expect(trigger).toHaveClass('aspect-square');
    expect(trigger.className).toContain('[&_img]:!object-contain');
    for (const dismissal of ['escape', 'close', 'backdrop'] as const) {
      trigger.focus();
      await user.keyboard(dismissal === 'close' ? ' ' : '{Enter}');
      const preview = await screen.findByRole('dialog', { name: 'Evidence photo' });
      const close = within(preview).getByRole('button', { name: 'Close' });
      await waitFor(() => expect(close).toHaveFocus());
      expect(within(preview).getByRole('img')).toHaveClass('object-contain');
      expect((await axe(preview)).violations).toHaveLength(0);
      expect(screen.queryByRole('button', { name: 'Submit inspection' })).not.toBeInTheDocument();
      await user.tab();
      expect(close).toHaveFocus();
      await user.tab({ shift: true });
      expect(close).toHaveFocus();
      await user.click(within(preview).getByRole('img'));
      expect(preview).toBeVisible();
      if (dismissal === 'escape') await user.keyboard('{Escape}');
      else if (dismissal === 'close') await user.click(close);
      else await user.click(within(preview).getByTestId('evidence-lightbox-backdrop'));
      await waitFor(() => expect(preview).not.toBeInTheDocument());
      expect(sheet).toBeVisible();
      await waitFor(() => expect(trigger).toHaveFocus());
    }
    expect(change).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(state.upload).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(sheet).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('previews an uploaded private path without reuploading, publishing signed tokens, or removing it', async () => {
    const change = vi.fn();
    const user = userEvent.setup();
    render(<EvidenceCapture reference="inspection/owned" onChange={change} />);
    await user.upload(screen.getByLabelText('Capture photo evidence', { selector: 'input' }),
      new File(['synthetic'], 'inspection.png', { type: 'image/png' }));
    await screen.findByRole('img', { name: 'Evidence' });
    const persisted = change.mock.calls[0]![0][0];
    expect(persisted).toMatch(/^inspection\/owned\/0\/[\w-]+\.png$/);
    expect(state.from).toHaveBeenCalledWith('evidence');
    expect(state.sign).toHaveBeenCalledWith(persisted, 3600);
    await user.click(viewButton());
    const preview = await screen.findByRole('dialog', { name: 'Evidence photo' });
    expect(within(preview).getByRole('img')).toHaveAttribute('src', signed);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('synthetic-test-only');
    expect(change).toHaveBeenCalledExactlyOnceWith([persisted]);
    expect(state.upload).toHaveBeenCalledOnce();
    await user.click(within(preview).getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Remove photo' }));
    expect(change).toHaveBeenLastCalledWith([]);
    expect(state.upload).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('disables pending private previews and reports signing denial without exposing a URL', async () => {
    let finish!: (value: unknown) => void;
    state.sign.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    render(<EvidenceCapture value={[stored]} onChange={vi.fn()} />);
    expect(viewButton()).toBeDisabled();
    await act(async () => finish({ data: null, error: { message: 'Denied' } }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Evidence unavailable');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each(['actor', 'reference', 'value'] as const)('closes a preview when %s ownership changes', async change => {
    const props = { reference: 'inspection/owned', value: [stored], onChange: vi.fn() };
    const user = userEvent.setup();
    const view = render(<EvidenceCapture {...props} />);
    await screen.findByRole('img', { name: 'Evidence' });
    await user.click(viewButton());
    await screen.findByRole('dialog', { name: 'Evidence photo' });
    state.sign.mockResolvedValue({ data: null, error: { message: 'Denied' } });
    if (change === 'actor') state.actor = 'receiver-B';
    view.rerender(<EvidenceCapture {...props}
      reference={change === 'reference' ? 'inspection/other' : props.reference}
      value={change === 'value' ? [] : props.value} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole('img')).not.toBeInTheDocument());
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('makes a failed image unavailable instead of opening a broken preview', async () => {
    render(<EvidenceCapture value={[stored]} onChange={vi.fn()} />);
    fireEvent.error(await screen.findByRole('img', { name: 'Evidence' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Evidence unavailable');
    expect(screen.queryByRole('button', { name: /view.*evidence photo/i })).not.toBeInTheDocument();
  });
});

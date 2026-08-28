import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { EvidenceAttachment, useEvidenceAttachment } from '@intra/ui';

const document = { reference: 'custody/A/proof.pdf', filename: 'proof.pdf' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function Harness({ target = 'A', upload, submit = vi.fn() }: {
  target?: string;
  upload: (file: File) => Promise<typeof document>;
  submit?: (value: string) => void;
}) {
  const attachment = useEvidenceAttachment(target);
  return <form onSubmit={(event) => {
    event.preventDefault();
    if (attachment.canSubmit(true)) submit(attachment.reference);
  }} aria-label="Evidence form">
    <EvidenceAttachment attachment={attachment} upload={upload} recordLabel={target} />
    <button disabled={!attachment.canSubmit(true)}>Submit</button>
  </form>;
}
function pick(file = new File(['proof'], 'proof.pdf', { type: 'application/pdf' })) {
  fireEvent.change(screen.getByLabelText('Upload evidence'), { target: { files: [file] } });
}

it.each([
  new File(['<svg/>'], 'image.svg', { type: 'image/svg+xml' }),
  new File([], 'empty.pdf', { type: 'application/pdf' }),
  new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.pdf', { type: 'application/pdf' }),
])('rejects invalid evidence before uploading: $name', (file) => {
  const upload = vi.fn();
  render(<Harness upload={upload} />);
  pick(file);
  expect(upload).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
});

it('gates submission while pending and retries a rejected upload', async () => {
  const pending = deferred<typeof document>();
  const upload = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(document);
  const submit = vi.fn();
  render(<Harness upload={upload} submit={submit} />);
  pick();
  fireEvent.submit(screen.getByRole('form'));
  expect(submit).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('Uploading');
  await act(async () => pending.reject(new Error('Access denied')));
  expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
  fireEvent.click(screen.getByRole('button', { name: 'Retry upload' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled());
  fireEvent.submit(screen.getByRole('form'));
  expect(submit).toHaveBeenCalledWith(document.reference);
});

it('ignores late upload completion after a record switch, including A to B to A', async () => {
  const pending = deferred<typeof document>();
  const upload = vi.fn().mockReturnValue(pending.promise);
  const view = render(<Harness target="A" upload={upload} />);
  pick();
  view.rerender(<Harness target="B" upload={upload} />);
  view.rerender(<Harness target="A" upload={upload} />);
  await act(async () => pending.resolve(document));
  expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
  expect(screen.queryByText(document.filename)).not.toBeInTheDocument();
});

it('preserves an upload across same-record rerenders and never resurrects removed evidence', async () => {
  const pending = deferred<typeof document>();
  const upload = vi.fn().mockReturnValue(pending.promise);
  const view = render(<Harness upload={upload} />);
  pick();
  view.rerender(<Harness upload={upload} />);
  expect(screen.getByRole('status')).toHaveTextContent('Uploading');
  fireEvent.click(screen.getByRole('button', { name: 'Remove evidence' }));
  await act(async () => pending.resolve(document));
  expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
});

it.each(['http://example.com/file.pdf', 'evidence/private.pdf', 'javascript:alert(1)', 'https://user:password@example.com/file.pdf'])('rejects unsafe manual references: %s', (value) => {
  render(<Harness upload={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(/Evidence URL/), { target: { value } });
  expect(screen.getByRole('alert')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EvidenceCapture } from './EvidenceCapture';

function file(name: string) {
  return new File(['x'], name, { type: 'image/png' });
}

describe('EvidenceCapture', () => {
  it('adds captured photos as durable base64 data URLs', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<EvidenceCapture onChange={onChange} />);

    const input = screen.getByLabelText(/capture photo evidence/i, {
      selector: 'input',
    });
    await user.upload(input, [file('a.png'), file('b.png')]);

    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0] as string[];
      expect(last).toHaveLength(2);
      expect(last.every((u) => u.startsWith('data:image/png;base64,'))).toBe(true);
    });
    expect(screen.getAllByRole('img', { name: /evidence/i })).toHaveLength(2);
  });

  it('removes a photo and reports the shortened list', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<EvidenceCapture onChange={onChange} />);

    const input = screen.getByLabelText(/capture photo evidence/i, {
      selector: 'input',
    });
    await user.upload(input, [file('a.png')]);
    await waitFor(() => screen.getByRole('button', { name: /remove photo/i }));
    await user.click(screen.getByRole('button', { name: /remove photo/i }));

    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

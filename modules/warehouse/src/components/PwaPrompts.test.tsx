import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { Sheet } from '@intra/ui';
import { PwaPrompts } from './PwaPrompts';

const postMessage = vi.fn();
const reload = vi.fn();
const update = vi.fn();

function Harness() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>Open recommendation</button>
    <PwaPrompts />
    <Sheet open={open} onOpenChange={setOpen} title="Recommend replenishment" description="Selected inventory product">
      <label htmlFor="rationale">Rationale</label>
      <textarea id="rationale" />
      <button type="button">Save recommendation</button>
    </Sheet>
  </>;
}

function installEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  const prompt = vi.fn().mockResolvedValue(undefined);
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) });
  act(() => { window.dispatchEvent(event); });
  return { event, prompt };
}

beforeEach(() => {
  vi.clearAllMocks();
  update.mockResolvedValue(undefined);
  const registration = { waiting: { postMessage }, update, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const serviceWorker = { controller: {}, ready: Promise.resolve(registration), getRegistration: vi.fn().mockResolvedValue(registration) };
  vi.stubGlobal('navigator', new Proxy(navigator, {
    has: (target, key) => key === 'serviceWorker' || Reflect.has(target, key),
    get: (target, key) => key === 'serviceWorker' ? serviceWorker : Reflect.get(target, key, target),
  }));
  // jsdom's Location.reload is non-configurable. Substitute only the location
  // read through window, keeping real DOM events and the shared Sheet intact.
  const location = { ...window.location, reload };
  vi.stubGlobal('window', new Proxy(window, {
    get: (target, key) => key === 'location' ? location : Reflect.get(target, key, target),
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PWA prompts below shared modal surfaces', () => {
  it('keeps a waiting-worker update below the Sheet without reloading or escaping modal focus', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const message = await screen.findByText('A new version is available.');
    const banner = message.closest('.fixed');
    expect(banner).toHaveClass('z-30');
    expect(banner).not.toHaveClass('z-[70]');
    expect(update).toHaveBeenCalledTimes(1);
    const opener = screen.getByRole('button', { name: 'Open recommendation' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Recommend replenishment' });
    expect(dialog).toHaveClass('z-50');
    expect(document.querySelector('.fixed.z-40')).toBeInTheDocument();
    expect(banner?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Rationale'), 'Planned replenishment');
    for (let i = 0; i < 5; i += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    expect(await axe(dialog)).toHaveNoViolations();
    expect(reload).not.toHaveBeenCalled(); expect(postMessage).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(opener).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('A new version is available.')).not.toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled(); expect(postMessage).not.toHaveBeenCalled();
  });

  it('keeps install below the Sheet and preserves its independent Not now dismissal', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByText('A new version is available.');
    const { event, prompt } = installEvent();
    expect(event.defaultPrevented).toBe(true);
    const banner = screen.getByText('Install Intra Warehouse').closest('.fixed');
    expect(banner).toHaveClass('z-30'); expect(banner).not.toHaveClass('z-[70]');
    await user.click(screen.getByRole('button', { name: 'Open recommendation' }));
    const dialog = screen.getByRole('dialog', { name: 'Recommend replenishment' });
    expect(dialog).toHaveClass('z-50');
    expect(document.querySelector('.fixed.z-40')).toBeInTheDocument();
    expect(banner?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Rationale'), 'Mobile draft');
    expect(screen.getByLabelText('Rationale')).toHaveValue('Mobile draft');
    expect(await axe(dialog)).toHaveNoViolations();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByText('Install Intra Warehouse')).not.toBeInTheDocument();
    expect(screen.getByText('A new version is available.')).toBeInTheDocument();
    expect(prompt).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('retains both existing SKIP_WAITING messages and reloads only after explicit Reload', async () => {
    const user = userEvent.setup();
    render(<PwaPrompts />);
    const button = await screen.findByRole('button', { name: 'Reload' });
    expect(reload).not.toHaveBeenCalled(); expect(postMessage).not.toHaveBeenCalled();
    await user.click(button);
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(postMessage.mock.calls).toEqual([[{ type: 'SKIP_WAITING' }], ['SKIP_WAITING']]);
    expect(screen.queryByText('A new version is available.')).not.toBeInTheDocument();
  });

  it.each(['accepted', 'dismissed'] as const)('invokes install only on click and clears the prompt after %s choice', async outcome => {
    const user = userEvent.setup();
    render(<PwaPrompts />);
    await screen.findByText('A new version is available.');
    const { prompt } = installEvent(outcome);
    expect(prompt).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(screen.queryByText('Install Intra Warehouse')).not.toBeInTheDocument());
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled(); expect(postMessage).not.toHaveBeenCalled();
  });
});

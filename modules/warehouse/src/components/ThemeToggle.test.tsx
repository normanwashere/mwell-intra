import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@/app/theme';
import { ThemeToggle } from './ThemeToggle';

beforeEach(() => {
  document.documentElement.classList.remove('dark');
  window.localStorage.clear();
});

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe('ThemeToggle', () => {
  it('toggles the dark class on the document and persists the choice', async () => {
    const user = userEvent.setup();
    renderToggle();

    const toggle = screen.getByRole('switch');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    await user.click(toggle);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    // Unified suite-wide key (SH-8): warehouse writes the shell's 'intra-theme'.
    expect(window.localStorage.getItem('intra-theme')).toBe('dark');
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    await user.click(toggle);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(window.localStorage.getItem('intra-theme')).toBe('light');
  });

  it('migrates a legacy warehouse theme choice to the unified key', async () => {
    window.localStorage.setItem('mwell-intra-warehouse:theme', 'dark');
    const user = userEvent.setup();
    renderToggle();
    // Legacy 'dark' honored on first paint.
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    await user.click(screen.getByRole('switch'));
    expect(window.localStorage.getItem('intra-theme')).toBe('light');
    expect(window.localStorage.getItem('mwell-intra-warehouse:theme')).toBeNull();
  });

  it('exposes an accessible label that reflects the next action', () => {
    renderToggle();
    expect(
      screen.getByRole('switch', { name: /switch to dark mode/i }),
    ).toBeInTheDocument();
  });
});

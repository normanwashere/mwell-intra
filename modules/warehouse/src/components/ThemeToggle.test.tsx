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
    expect(window.localStorage.getItem('mwell-intra-warehouse:theme')).toBe('dark');
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    await user.click(toggle);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(window.localStorage.getItem('mwell-intra-warehouse:theme')).toBe('light');
  });

  it('exposes an accessible label that reflects the next action', () => {
    renderToggle();
    expect(
      screen.getByRole('switch', { name: /switch to dark mode/i }),
    ).toBeInTheDocument();
  });
});

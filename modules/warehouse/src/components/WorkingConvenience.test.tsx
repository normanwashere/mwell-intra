import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecordCopyActions, useListReturnPosition } from '@intra/ui';

afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks(); });

describe('record copy controls', () => {
  it('copies only the reference or canonical record link, never submits a surrounding form', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const submit = vi.fn();
    render(<form onSubmit={submit}><RecordCopyActions reference="PO-001" href="/procurement/purchase-orders/one" /></form>);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy reference' })); });
    expect(writeText).toHaveBeenLastCalledWith('PO-001');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy record link' })); });
    expect(writeText).toHaveBeenLastCalledWith(window.location.origin+'/procurement/purchase-orders/one');
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Record link copied.');
  });
  it('explains denied clipboard access without reporting success', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } });
    render(<RecordCopyActions reference="PO-001" href="/procurement/purchase-orders/one" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy reference' })); });
    expect(screen.getByRole('status')).toHaveTextContent('Could not copy.');
  });
  it('does not copy an external destination', async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<RecordCopyActions reference="PO-001" href="https://unrelated.example/" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy record link' })); });
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe('list return position', () => {
  it('waits for rows and restores a one-time checkpoint for the same user and view', () => {
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(650);
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callback(0); return 1; });
    const first = renderHook(() => useListReturnPosition('user-a', 'waiting-search', true));
    act(() => first.result.current.remember()); first.unmount();
    expect([...Object.keys(sessionStorage)].join()).not.toContain('waiting-search');
    const restored = renderHook(({ready}) => useListReturnPosition('user-a', 'waiting-search', ready), {initialProps:{ready:false}});
    expect(scroll).not.toHaveBeenCalled();
    restored.rerender({ready:true});
    expect(scroll).toHaveBeenCalledWith({top:650,behavior:'instant'});
    expect(sessionStorage.length).toBe(0);
  });
  it('does not apply another user or filter checkpoint', () => {
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const first = renderHook(() => useListReturnPosition('user-a', 'waiting', true));
    act(() => first.result.current.remember());first.unmount();
    renderHook(() => useListReturnPosition('user-b', 'waiting', true));
    renderHook(() => useListReturnPosition('user-a', 'action', true));
    expect(scroll).not.toHaveBeenCalled();
  });
});

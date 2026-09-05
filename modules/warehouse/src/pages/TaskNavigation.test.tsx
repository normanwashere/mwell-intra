import { expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';
import { TasksPage } from './TasksPage';
import { QualityPage } from './QualityPage';
import { StorageAreasPage } from './StorageAreasPage';
import { CycleCountsPage } from './CycleCountsPage';
import { ExceptionsPage } from './ExceptionsPage';
import { parseTaskStatus, tasksReturnPath, sourcePathForTask } from '@/domain/taskNavigation';
import type { WarehouseTask } from '@intra/data-kit';

function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output>; }
function RoutedPages() {
  return <><Location /><Routes>
    <Route path="/tasks" element={<TasksPage />} />
    <Route path="/quality" element={<QualityPage />} />
    <Route path="/storage" element={<StorageAreasPage />} />
    <Route path="/cycle-counts" element={<CycleCountsPage />} />
    <Route path="/exceptions" element={<ExceptionsPage />} />
  </Routes></>;
}

it.each(['blocked', 'completed'] as const)('WE07 preserves selected %s through all four actual source pages and Back to tasks', async (status) => {
  const repo = makeRepo();
  const rows: WarehouseTask[] = [
    { id: 'task-quality', type: 'quality', sourceId: 'missing-quality&status=due', title: 'Quality source', status },
    { id: 'task-count', type: 'cycle_count', sourceId: 'missing-count', title: 'Count source', status },
    { id: 'task-putaway', type: 'putaway', sourceId: 'missing-putaway', title: 'Putaway source', status },
    { id: 'task-exception', type: 'exception', sourceId: 'missing-exception', title: 'Exception source', status },
  ];
  vi.spyOn(repo, 'listWarehouseTasks').mockResolvedValue({ rows });
  renderWithProviders(<RoutedPages />, { repo, route: '/tasks' });
  await userEvent.click(await screen.findByRole('tab', { name: status === 'blocked' ? 'Blocked' : 'Completed' }));
  expect(screen.getByTestId('location')).toHaveTextContent(`/tasks?status=${status}`);
  for (const [index, label] of ['quality', 'count', 'putaway', 'exception'].entries()) {
    const link = await screen.findByRole('link', { name: `Open ${label} source` });
    const source = new URL(link.getAttribute('href')!, 'https://local.test');
    expect(source.searchParams.get('source')).toBe(rows[index]!.sourceId);
    expect(source.searchParams.get('taskStatus')).toBe(status);
    await userEvent.click(link);
    const back = await screen.findByRole('link', { name: 'Back to tasks' });
    expect(back).toHaveAttribute('href', `/tasks?status=${status}`);
    expect(screen.getByTestId('location')).toHaveTextContent(encodeURIComponent(rows[index]!.sourceId));
    await userEvent.click(back);
    expect(await screen.findByRole('list', { name: `${status} tasks` })).toBeVisible();
    expect(screen.getByRole('tab', { name: status === 'blocked' ? 'Blocked' : 'Completed' })).toHaveAttribute('aria-selected', 'true');
  }
});

it.each(['due', 'blocked', 'completed', 'invalid', 'https://evil.test', ''])('WE07 initializes and remounts status from URL %s', async (value) => {
  const status = parseTaskStatus(value);
  const repo = makeRepo();
  vi.spyOn(repo, 'listWarehouseTasks').mockResolvedValue({ rows: [] });
  const route = `/tasks?status=${encodeURIComponent(value)}`;
  const first = renderWithProviders(<RoutedPages />, { repo, route });
  expect(await screen.findByText(`No ${status} tasks`)).toBeVisible();
  first.unmount();
  renderWithProviders(<RoutedPages />, { repo, route });
  expect(await screen.findByText(`No ${status} tasks`)).toBeVisible();
});

it('WE07 only propagates a validated enum, never a redirect URL or replacement source', () => {
  for (const value of [null, '', 'invalid', '//evil.test', 'completed&source=other', 'BLOCKED']) {
    const params = new URLSearchParams({ taskStatus: value ?? '', source: 'stale-source', returnTo: 'https://evil.test' });
    expect(tasksReturnPath(params)).toBe('/tasks?status=due');
  }
  const task: WarehouseTask = { id: 'old-task', type: 'quality', sourceId: 'stale/id?x=1&taskStatus=due', title: 'Old source', status: 'completed' };
  const url = new URL(sourcePathForTask(task, 'completed'), 'https://local.test');
  expect([...url.searchParams.keys()]).toEqual(['source', 'taskStatus']);
  expect(url.searchParams.get('source')).toBe(task.sourceId);
  expect(tasksReturnPath(url.searchParams)).toBe('/tasks?status=completed');
});

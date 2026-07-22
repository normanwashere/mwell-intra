import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DataTable, type Column } from './DataTable';

describe('DataTable sorting semantics', () => {
  it('places aria-sort on the column header instead of its button', () => {
    const columns: Column<{ id: string }>[] = [
      {
        key: 'id',
        header: 'Reference',
        render: (row) => row.id,
        sortable: true,
        sortValue: (row) => row.id,
      },
    ];
    const markup = renderToStaticMarkup(
      <DataTable
        ariaLabel="Activity"
        columns={columns}
        rows={[{ id: 'A-1' }]}
        keyOf={(row) => row.id}
      />,
    );

    expect(markup).toMatch(/<th[^>]*aria-sort="none"/);
    expect(markup).not.toMatch(/<button[^>]*aria-sort=/);
  });

  it.each([
    ['asc', 'ascending'],
    ['desc', 'descending'],
  ] as const)('exposes the controlled %s state on the column header', (sortDir, ariaSort) => {
    const columns: Column<{ id: string }>[] = [
      {
        key: 'id',
        header: 'Reference',
        render: (row) => row.id,
        sortable: true,
      },
    ];
    const markup = renderToStaticMarkup(
      <DataTable
        columns={columns}
        rows={[{ id: 'A-1' }]}
        keyOf={(row) => row.id}
        sortKey="id"
        sortDir={sortDir}
      />,
    );

    expect(markup).toMatch(new RegExp(`<th[^>]*aria-sort="${ariaSort}"`));
    expect(markup).not.toMatch(/<button[^>]*aria-sort=/);
  });
});

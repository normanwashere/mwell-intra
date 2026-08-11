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

  it('uses a sibling row-action button instead of nesting controls in a button row', () => {
    const columns: Column<{ id: string }>[] = [
      {
        key: 'id',
        header: 'Reference',
        primary: true,
        render: (row) => <a href={`/records/${row.id}`}>{row.id}</a>,
      },
    ];
    const markup = renderToStaticMarkup(
      <DataTable
        ariaLabel="Records"
        columns={columns}
        rows={[{ id: 'A-1' }]}
        keyOf={(row) => row.id}
        onRowClick={() => undefined}
        rowActionLabel={(row) => `Open ${row.id}`}
      />,
    );

    expect(markup).not.toMatch(/<(tr|div)[^>]*role="button"/);
    expect(markup.match(/aria-label="Open A-1"/g)).toHaveLength(2);
  });
});

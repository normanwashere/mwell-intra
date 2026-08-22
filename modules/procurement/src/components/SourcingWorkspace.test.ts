import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToastProvider } from '@intra/ui';
import { SourcingWorkspace } from './SourcingWorkspace';

describe('SourcingWorkspace', () => {
  it('keeps governed sourcing unavailable without a database client', () => {
    const html = renderToStaticMarkup(createElement(ToastProvider, {
      children: createElement(SourcingWorkspace, {
        requestId: 'request-1',
        method: 'rfq',
        canManage: true,
        canApprove: false,
        client: null,
        vendors: [],
      }),
    }));

    expect(html).toContain('Connect to the live database to operate governed sourcing.');
    expect(html).not.toContain('Approved insufficient-bids exception is attached');
  });
});

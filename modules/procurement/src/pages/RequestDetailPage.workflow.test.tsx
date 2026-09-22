import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ProcurementRequest, PurchaseOrder } from '../types';
import { RequestDetailPage } from './RequestDetailPage';
import { normalizeApprovalSignature } from '../approvalSignature';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

let request: ProcurementRequest;
let readError: string | undefined;
let linkedOrders: PurchaseOrder[] = [];
const submit = vi.fn();
const cancel = vi.fn();
vi.mock('@intra/auth', () => ({
  Guard: ({ children }: { children: React.ReactNode }) => children,
  useCan: () => false,
  useSession: () => ({ profile: { id: 'viewer', email: 'viewer@example.test' }, mode: 'demo' }),
}));
vi.mock('@intra/ui', async () => ({
  ...await vi.importActual('@intra/ui'),
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock('../localStore', () => ({
  useProcurementRequests: () => ({ rows: [request], loading: false, error: readError, submit, cancel, refresh: vi.fn() }),
  usePurchaseOrders: () => ({ rows: linkedOrders, add: vi.fn() }),
  useProcurementVendors: () => [],
  useApprovalHistory: () => [],
}));

beforeEach(() => {
  readError = undefined;
  linkedOrders = [];
  submit.mockClear(); cancel.mockClear();
  request = { id: 'request-kept', title: 'Request record', status: 'draft', category: 'goods', lines: [], attachments: [], createdAt: '2026-09-01T00:00:00Z' } as unknown as ProcurementRequest;
});
function renderPage(search = '') {
  return renderToStaticMarkup(<MemoryRouter initialEntries={['/requests/request-kept' + search]}><Routes><Route path="/requests/:id" element={<RequestDetailPage />} /></Routes></MemoryRouter>);
}
it.each([
  ['draft', 'Procurement / requester'],
  ['rejected', 'Review the rejection note'],
  ['cancelled', 'No further request action'],
  ['under_review', 'No pending approval step'],
  ['unexpected', 'Status unrecognized'],
])('renders the %s summary without mutation or an unauthorized primary action', (status, text) => {
  request.status = status as ProcurementRequest['status'];
  const html = renderPage();
  expect(html).toContain('Next responsibility');
  expect(html).toContain(text);
  expect(html).toContain('<h1');
  expect(html).not.toContain('hero-surface');
  expect(html).toContain('href="/procurement" class="btn-ghost btn-sm"');
  expect(html).not.toContain('>Submit for approval<');
  expect(submit).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
});
it('retains the linked purchase order ID in the existing action', () => {
  request.status = 'approved';
  linkedOrders = [{ id: 'po-kept', requestId: request.id, poNumber: 'PO-KEPT', createdAt: request.createdAt }] as PurchaseOrder[];
  const html = renderPage();
  expect(html).toContain('href="/purchase-orders/po-kept"');
  expect(html).toContain('Review the linked purchase order');
});
it('shows read failure recovery without presenting stale request status as current', () => {
  readError = 'Request read failed';
  request.status = 'approved';
  const html = renderPage();
  expect(html).toContain('Request unavailable');
  expect(html).toContain('Request read failed');
  expect(html).toContain('Retry request');
  expect(html).toContain('href="/procurement"');
  expect(html).not.toContain('Author purchase order');
});
it.each([undefined, 'Read failed'])('keeps whitelisted list filters on the back link when read error is %s', failure => {
  readError = failure;
  const html = renderPage('?fromFilter=approved&fromQ=0001&fromShown=100&fromOwner=mine&returnTo=https://evil.test');
  expect(html).toContain('href="/procurement?filter=approved&amp;q=0001&amp;owner=mine&amp;shown=100"');
  expect(html).not.toContain('evil.test');
});

it('keeps the competitive sourcing introduction stage-neutral until the sourcing state is loaded', () => {
  request.compliance = { routeConfirmed: true } as ProcurementRequest['compliance'];
  request.route = { procurementMode: 'competitive_bidding', solicitationType: 'rfq', governanceTier: 'standard' } as ProcurementRequest['route'];
  const html = renderPage();
  expect(html).toContain('Competitive sourcing');
  expect(html).toContain('Preparation, responses, evaluation, and award follow the recorded sourcing stage.');
  expect(html).not.toContain('Close the response window, document commercial and technical evidence');
  expect(submit).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
});

const signaturePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
it.each(['governed', 'legacy'])('renders the saved %s signature in the actual approval row', shape => {
  request.approvalSteps = [{
    id: 'signed-step', order: 1, tier: 'dept_head', status: 'approved',
    signature: normalizeApprovalSignature(shape === 'governed'
      ? { signature_png: signaturePng, signer_name: 'Synthetic reviewer', signature_method: 'typed', signed_at: '2026-09-22T11:00:00Z' }
      : { dataUrl: signaturePng, signerName: 'Synthetic reviewer', method: 'typed', signedAt: '2026-09-22T11:00:00Z' }),
  }];
  const html = renderPage();
  expect(html).toContain('e-signed by Synthetic reviewer');
  expect(html).toContain('alt="Signature of Synthetic reviewer"');
  expect(html).toContain(`src="${signaturePng}"`);
  expect(html).not.toContain('Signature of undefined');
  expect(submit).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
});

it('keeps the recorded decision visible without rendering an invalid signature image', () => {
  request.approvalSteps = [{
    id: 'signed-step', order: 1, tier: 'dept_head', status: 'approved', note: 'Saved approval note',
    signature: normalizeApprovalSignature({ signature_png: 'https://example.invalid/signature.png', signer_name: 'Synthetic reviewer', signature_method: 'typed' }),
  }];
  const html = renderPage();
  expect(html).toContain('Saved approval note');
  expect(html).not.toContain('Signature of');
  expect(html).not.toContain('example.invalid/signature.png');
});

it.each([320, 360, 390, 1440])('keeps real approval rows and attachment actions within the %spx page', async width => {
  const shellRequire = createRequire(new URL('../../../../apps/shell/package.json', import.meta.url));
  const { chromium } = shellRequire('@playwright/test');
  const postcss = shellRequire('postcss');
  const tailwind = shellRequire('tailwindcss');
  const preset = shellRequire('@intra/config/tailwind/preset');
  const email = 'intra.test.procurement.lead@mwell.com.ph';
  request.status = 'under_review';
  request.approvalSteps = [{
    id: 'signed-step', order: 1, tier: 'procurement_head', status: 'approved',
    label: 'Procurement Head - Synthetic UAT Procurement Lead', decidedByEmail: email,
    decidedAt: '2026-09-22T11:00:00Z', note: 'Recorded approval for this synthetic request.',
    signature: normalizeApprovalSignature({ signature_png: signaturePng, signer_name: 'Synthetic UAT Procurement Lead', signature_method: 'typed', signed_at: '2026-09-22T11:00:00Z' }),
  }];
  request.attachments = [{
    id: 'attachment-layout', kind: 'spec', filename: 'SYNTHETIC-d9e41f7c-long-specification-evidence.pdf',
    mimeType: 'application/pdf', sizeBytes: 640, uploadedByEmail: email,
    uploadedAt: '2026-09-22T11:00:00Z', storagePath: 'synthetic/request/spec.pdf',
  }];
  const markup = `<main class="shell-content workspace-hierarchy p-4">${renderPage()}</main>`;
  const read = (file: string) => readFileSync(new URL(`../../../../${file}`, import.meta.url), 'utf8');
  const styles = read('packages/ui/src/styles.css') + read('apps/shell/app/globals.css') + read('apps/shell/app/hierarchy-preview.css');
  const css = (await postcss([tailwind({ presets: [preset], content: [{ raw: markup, extension: 'html' }] })]).process(styles, { from: undefined })).css;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 768, hasTouch: width < 768, offline: true });
    const page = await context.newPage();
    await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--font-poppins:system-ui;--font-jbmono:monospace}${css}</style>${markup}`);
    await page.locator('img[alt="Signature of Synthetic UAT Procurement Lead"]').waitFor();
    expect(await page.evaluate(() => window.innerWidth)).toBe(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.locator('img[alt="Signature of Synthetic UAT Procurement Lead"]').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    const offenders = await page.locator('main p, main button, main img').evaluateAll((elements: HTMLElement[]) => elements.filter(element => {
      const box = element.getBoundingClientRect();
      return box.right > document.documentElement.clientWidth + 1 || box.left < -1 || (element.tagName === 'P' && element.scrollWidth > element.clientWidth + 1);
    }).map(element => ({ tag: element.tagName, text: element.textContent, width: element.clientWidth, scrollWidth: element.scrollWidth })));
    expect(offenders).toEqual([]);
    const download = page.getByRole('button', { name: `Download ${request.attachments[0]!.filename}`, exact: true });
    const box = await download.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(await download.evaluate((element: HTMLElement) => {
      const box = element.getBoundingClientRect();
      const metadata = element.parentElement!.firstElementChild!.getBoundingClientRect();
      return metadata.right <= box.left + 1 || metadata.bottom <= box.top + 1;
    })).toBe(true);
    if (process.env.PROCUREMENT_LAYOUT_EVIDENCE_DIR) {
      mkdirSync(process.env.PROCUREMENT_LAYOUT_EVIDENCE_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.PROCUREMENT_LAYOUT_EVIDENCE_DIR, `request-${width}.png`), fullPage: true });
    }
    expect(submit).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    await context.close();
  } finally { await browser.close(); }
}, 30_000);

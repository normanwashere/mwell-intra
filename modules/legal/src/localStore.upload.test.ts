import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
import ts from 'typescript';

const source = await readFile(new URL('./localStore.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('store.ts', source, ts.ScriptTarget.Latest, true);
const functions = ['storageSafeSegment', 'uploadLiveAccreditationDocument'].map(name => {
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!node) throw new Error(`Missing production helper ${name}`);
  return node.getText(ast);
}).join('\n');
const compiled = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const upload = new Function(`${compiled};return uploadLiveAccreditationDocument`)() as (client: unknown, input: unknown) => Promise<string | undefined>;
const bytes = Uint8Array.from([37, 80, 68, 70, 45, 49, 0, 128, 255]);
const base64 = Buffer.from(bytes).toString('base64');
const input = { caseId: 'case-A', vendorId: 'vendor-A', filename: 'synthetic.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length, dataUrl: `data:application/pdf;base64,${base64}` };
function client() {
  const send = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn(() => ({ upload: send }));
  return { value: { storage: { from } }, send, from };
}
afterEach(() => vi.unstubAllGlobals());

it.each(['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])('uploads exact local bytes and %s MIME without fetching', async mimeType => {
  const h = client();
  const fetch = vi.fn(() => { throw new Error('Network conversion forbidden'); });
  vi.stubGlobal('fetch', fetch);
  const path = await upload(h.value, { ...input, mimeType, dataUrl: `data:${mimeType};base64,${base64}` });
  expect(path).toMatch(/^vendor\/vendor-A\/legal\/accreditation\/case-A\/.+_synthetic.pdf$/);
  expect(h.from).toHaveBeenCalledWith('documents');
  const blob = h.send.mock.calls[0]![1] as Blob;
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  expect(blob.type).toBe(mimeType);
  expect(h.send.mock.calls[0]![2]).toEqual({ contentType: mimeType, upsert: false });
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  { dataUrl: 'https://foreign.test/document.pdf' },
  { dataUrl: 'blob:https://foreign.test/id' },
  { dataUrl: 'data:application/pdf,not-base64' },
  { dataUrl: 'data:application/pdf;base64,%%%=' },
  { dataUrl: 'data:application/pdf;base64,AA=A' },
  { dataUrl: 'data:application/pdf;base64,AB==' },
  { dataUrl: 'data:image/png;base64,AA==' },
  { mimeType: 'text/html', dataUrl: 'data:text/html;base64,AA==' },
  { sizeBytes: -1 }, { sizeBytes: 1.5 }, { sizeBytes: bytes.length + 1 },
  { sizeBytes: 10 * 1024 * 1024 + 1 },
])('rejects malformed or inconsistent local input before Storage: %j', async invalid => {
  const h = client();
  const fetch = vi.fn().mockRejectedValue(new Error('Network conversion forbidden'));
  vi.stubGlobal('fetch', fetch);
  await expect(upload(h.value, { ...input, ...invalid })).rejects.toThrow();
  expect(h.send).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it('preserves the existing storage-path-only branch without uploading', async () => {
  const h = client();
  expect(await upload(h.value, { ...input, dataUrl: undefined, storagePath: 'existing/owned.pdf' })).toBe('existing/owned.pdf');
  expect(await upload(h.value, { ...input, dataUrl: '', storagePath: 'existing/owned.pdf' })).toBe('existing/owned.pdf');
  expect(h.send).not.toHaveBeenCalled();
});

it('accepts the existing 10 MB maximum and preserves upload errors without retries', async () => {
  const h = client();
  const data = Buffer.alloc(10 * 1024 * 1024, 42);
  await upload(h.value, { ...input, sizeBytes: data.length, dataUrl: `data:application/pdf;base64,${data.toString('base64')}` });
  expect((h.send.mock.calls[0]![1] as Blob).size).toBe(data.length);
  h.send.mockReset().mockResolvedValue({ error: { message: 'Storage policy denied upload' } });
  await expect(upload(h.value, input)).rejects.toThrow('Storage policy denied upload');
  expect(h.send).toHaveBeenCalledTimes(1);
});

it('executes the actual upload helper in Chromium under the unchanged production CSP', async () => {
  const require = createRequire(new URL('../../../apps/shell/package.json', import.meta.url));
  const { chromium } = require('@playwright/test');
  const config = await readFile(new URL('../../../apps/shell/next.config.mjs', import.meta.url), 'utf8');
  const configAst = ts.createSourceFile('config.mjs', config, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declaration = configAst.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations])
    .find(node => node.name.getText(configAst) === 'contentSecurityPolicy');
  expect(declaration?.initializer).toBeDefined();
  const csp = new Function('isDev', 'controlledRpcTestOrigin', `return ${declaration!.initializer!.getText(configAst)}`)(false, '') as string;
  expect(csp).toContain("connect-src 'self' https://*.supabase.co wss://*.supabase.co;");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const requests: string[] = [];
  await context.route('**/*', (route: { request(): { url(): string }; fulfill(options: unknown): Promise<void>; abort(): Promise<void> }) => {
    const url = route.request().url(); requests.push(url);
    return url === 'https://fixture.test/' ? route.fulfill({ contentType: 'text/html', headers: { 'Content-Security-Policy': csp }, body: '<main>Local document upload</main>' }) : route.abort();
  });
  try {
    const page = await context.newPage();
    await page.goto('https://fixture.test/');
    expect(await page.evaluate("fetch('data:application/pdf;base64,AA==').then(()=>false,()=>true)")).toBe(true);
    const errors: string[] = [];
    page.on('console', (message: { type(): string; text(): string }) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addScriptTag({ content: `${compiled}\nglobalThis.runUpload = uploadLiveAccreditationDocument;` });
    const result = await page.evaluate(`(async () => {
      const calls = [];
      const client = { storage: { from(bucket) { return { async upload(path, blob, options) {
        calls.push({ bucket, path, bytes: [...new Uint8Array(await blob.arrayBuffer())], type: blob.type, options }); return { error: null };
      } }; } } };
      try { await globalThis.runUpload(client, ${JSON.stringify(input)}); return { calls, error: null }; }
      catch { return { calls, error: 'Upload failed under CSP' }; }
    })()`);
    expect(result.error).toBeNull();
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0].bytes).toEqual([...bytes]);
    expect(result.calls[0].type).toBe('application/pdf');
    expect(errors).toEqual([]);
    expect(requests).toEqual(['https://fixture.test/']);
  } finally { await context.close(); await browser.close(); }
}, 20000);

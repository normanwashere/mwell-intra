import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { expect, it } from 'vitest';

it('reads 400,000 one-byte response chunks within a 96 MiB V8 heap', () => {
  const bundled = buildSync({ entryPoints: [fileURLToPath(new URL('./transport.ts', import.meta.url))], bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'node22', write: false }).outputFiles[0]!.text;
  const script = `${bundled}\n(async () => {
    const { z } = require('zod');
    let index = 0;
    const size = 400000;
    const body = new ReadableStream({ pull(controller) {
      if (index >= size) { controller.close(); return; }
      controller.enqueue(Uint8Array.of(index === 0 || index === size - 1 ? 34 : 120));
      index++;
    } });
    const value = await module.exports.fetchReportingJson('https://reporting.example.test', '/api/reporting/v1/changes', 'synthetic-token', z.string(), async () => new Response(body, { headers: { 'Content-Type': 'application/json' } }));
    if (value.length !== size - 2) throw new Error('Incomplete response');
    process.stdout.write('fragmentation-pass');
  })().catch(() => { process.exitCode = 1; });`;
  const child = spawnSync(process.execPath, ['--max-old-space-size=96', '--input-type=commonjs'], { input: script, encoding: 'utf8', timeout: 45000, maxBuffer: 64 * 1024, windowsHide: true });
  expect(child.error, child.stderr).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  expect(child.stdout).toBe('fragmentation-pass');
}, 60000);

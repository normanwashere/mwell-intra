import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('executor regressions run when ignored audit outputs are unavailable', () => {
  const preload = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { fileURLToPath } from 'node:url';
    const read = fs.promises.readFile;
    fs.promises.readFile = async (file, ...args) => {
      const name = String(file instanceof URL ? fileURLToPath(file) : file).replaceAll('\\\\', '/');
      if (name.includes('/outputs/')) throw Object.assign(new Error('Ignored audit outputs unavailable'), { code: 'ENOENT' });
      return read(file, ...args);
    };
    syncBuiltinESMExports();
  `;
  const env = { ...process.env, SUPABASE_SERVICE_ROLE_KEY: '', WMS_ROLE_DATABASE_URL: '', WMS_ROLE_PASSWORD: '' };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [
    '--import', `data:text/javascript,${encodeURIComponent(preload)}`,
    '--test', '--test-reporter=tap', fileURLToPath(new URL('./wms-role-provision-live.test.mjs', import.meta.url)),
  ], { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    env });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /# fail 0/);
});

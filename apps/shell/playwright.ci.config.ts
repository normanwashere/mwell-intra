import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const runtime = process.env.PLAYWRIGHT_CI_RUNTIME;
if (runtime !== 'memory' && runtime !== 'controlled') {
  throw new Error('PLAYWRIGHT_CI_RUNTIME must explicitly select memory or controlled');
}
if (!process.version.startsWith('v22.')) throw new Error('CI E2E runtimes require Node 22');

const controlledSpecs = [
  'policy-procurement-controlled-rpc.spec.ts',
  'task-8-exception-workspace.spec.ts',
  'task-9-po-lifecycle.spec.ts',
  'task-10-controlled-authority-journey.spec.ts',
  'vendor-case-layout.spec.ts',
].map(file => `**/${file}`);
const ignored = base.testIgnore === undefined ? [] : Array.isArray(base.testIgnore) ? base.testIgnore : [base.testIgnore];
const port = Number(process.env.PORT ?? 3000);
const authPort = Number(process.env.CONTROLLED_SUPABASE_PORT ?? 54321);
const controlled = runtime === 'controlled';
const environment = {
  NEXT_PUBLIC_ALLOW_DEMO_IN_PROD: 'true',
  NEXT_PUBLIC_DATA_SOURCE: controlled ? 'controlled_rpc' : 'memory',
  NEXT_PUBLIC_SUPABASE_URL: controlled ? `http://127.0.0.1:${authPort}` : '',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: controlled ? 'controlled-rpc-anon-key' : '',
  NEXT_PUBLIC_ENABLE_SW: 'false',
  MWELL_E2E_AUTH_MODE: controlled ? 'controlled_rpc' : 'memory',
  MWELL_CONTROLLED_RPC_TEST: controlled ? '1' : '0',
  MWELL_MEMORY_SIMULATION_TEST: controlled ? '0' : '1',
};
// Test-side RPC interception and the server build must agree on the endpoint.
// All values are synthetic and loopback-only; no live project credentials.
Object.assign(process.env, environment);

export default defineConfig({
  ...base,
  testMatch: controlled ? controlledSpecs : base.testMatch,
  testIgnore: controlled ? ignored : [...ignored, ...controlledSpecs],
  outputDir: `test-results/${runtime}`,
  reporter: [
    ['github'], ['list'],
    ['json', { outputFile: `playwright-report/${runtime}/results.json` }],
    ['html', { outputFolder: `playwright-report/${runtime}/html`, open: 'never' }],
  ],
  use: { ...base.use, baseURL: `http://localhost:${port}` },
  webServer: [
    ...(controlled ? [{
      command: 'node ../../scripts/controlled-supabase-auth-server.mjs',
      port: authPort, timeout: 30_000, reuseExistingServer: false,
      env: { CONTROLLED_SUPABASE_PORT: String(authPort) },
    }] : []),
    {
      command: `pnpm build && pnpm start --port ${port}`,
      port, timeout: 120_000, reuseExistingServer: false,
      stdout: 'pipe', stderr: 'pipe', env: environment,
    },
  ],
});

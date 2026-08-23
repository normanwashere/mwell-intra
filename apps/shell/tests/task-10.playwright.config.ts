import { defineConfig } from '@playwright/test';
import base from '../playwright.config';

const port = Number(process.env.PORT ?? 3100);
const authPort = Number(process.env.CONTROLLED_SUPABASE_PORT ?? 54321);
const node = process.env.TASK10_NODE_PATH ?? 'C:\\Users\\NormanArisDeocareza\\.cache\\node-runtimes\\node-v22.17.0-win-x64\\node.exe';
const pnpm = process.env.COREPACK_PNPM_PATH ?? 'C:\\Users\\NormanArisDeocareza\\.cache\\node-runtimes\\node-v22.17.0-win-x64\\node_modules\\corepack\\dist\\pnpm.js';
const quote = (value: string) => `"${value}"`;

export default defineConfig({
  ...base,
  testDir: '.',
  timeout: 90_000,
  webServer: [
    {
      command: `${quote(node)} ../../scripts/controlled-supabase-auth-server.mjs`,
      cwd: '..',
      port: authPort,
      timeout: 30_000,
      reuseExistingServer: false,
    },
    {
      command: `${quote(node)} ${quote(pnpm)} build && ${quote(node)} ${quote(pnpm)} start --port ${port}`,
      cwd: '..',
      port,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        NEXT_PUBLIC_ALLOW_DEMO_IN_PROD: 'true',
        NEXT_PUBLIC_DATA_SOURCE: 'controlled_rpc',
        NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${authPort}`,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'controlled-rpc-anon-key',
        NEXT_PUBLIC_ENABLE_SW: 'false',
        MWELL_CONTROLLED_RPC_TEST: '1',
      },
    },
  ],
  use: { ...base.use, baseURL: `http://localhost:${port}`, trace: 'off' },
});

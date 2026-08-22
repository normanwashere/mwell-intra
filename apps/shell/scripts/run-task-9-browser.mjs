import net from 'node:net';
import { spawn } from 'node:child_process';

const findFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.unref();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close((error) => error ? reject(error) : resolve(port));
  });
});

const authPort = await findFreePort();
const shellPort = await findFreePort();
const env = { ...process.env, PORT: String(shellPort), CONTROLLED_SUPABASE_PORT: String(authPort), NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${authPort}` };
const pnpmEntrypoint = process.env.COREPACK_PNPM_PATH ?? 'C:\\Users\\NormanArisDeocareza\\.cache\\node-runtimes\\node-v22.17.0-win-x64\\node_modules\\corepack\\dist\\pnpm.js';
const child = spawn(process.execPath, [pnpmEntrypoint, 'exec', 'playwright', 'test', '--config=playwright.controlled-rpc.config.ts'], { stdio: 'inherit', env });
child.on('exit', (code) => process.exitCode = code ?? 1);

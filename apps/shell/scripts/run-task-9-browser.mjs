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
const env = { ...process.env, PORT: String(shellPort), CONTROLLED_SUPABASE_PORT: String(authPort), NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${authPort}`, TASK9_NODE_PATH: process.execPath };
const pnpmEntrypoint = process.env.COREPACK_PNPM_PATH ?? 'C:\\Users\\NormanArisDeocareza\\.cache\\node-runtimes\\node-v22.17.0-win-x64\\node_modules\\corepack\\dist\\pnpm.js';
process.stdout.write(`Task 9 controlled browser: app=${shellPort} auth=${authPort}\n`);
const child = spawn(process.execPath, [pnpmEntrypoint, 'exec', 'playwright', 'test', '--config=playwright.controlled-rpc.config.ts'], { stdio: 'inherit', env });
const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
});
process.stdout.write(`Task 9 controlled browser exit=${exitCode}\n`);
process.exitCode = exitCode;

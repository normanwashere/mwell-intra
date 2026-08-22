import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const handbookPath = path.join(root, 'docs', 'manual', 'index.html');
const portFlag = process.argv.indexOf('--port');
const port = Number(portFlag >= 0 ? process.argv[portFlag + 1] : 3018);

if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Use a valid TCP port after --port.');

const handbook = await readFile(handbookPath);
const server = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  if (!['GET', 'HEAD'].includes(request.method || '') || url.pathname !== '/') {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(request.method === 'HEAD' ? undefined : handbook);
});

server.listen(port, '127.0.0.1', () => process.stdout.write(`Standalone handbook available at http://127.0.0.1:${port}/\n`));

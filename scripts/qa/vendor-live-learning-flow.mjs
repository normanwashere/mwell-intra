import { run } from './scoped-live-learning-flow.mjs';
run(process.env,true).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(() => {
  process.stderr.write('Vendor learning flow stopped. Check explicit vendor GO/environment or redacted result; no automatic retry.\n');
  process.exitCode=1;
});

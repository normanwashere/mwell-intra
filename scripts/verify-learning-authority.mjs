import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const testPaths = [
  "./verify-learning-authority.test.mjs",
  "./verify-learning-authority-lifecycle.test.mjs",
].map((path) => fileURLToPath(new URL(path, import.meta.url)));
const result = spawnSync(process.execPath, ["--test", ...testPaths], {
  encoding: "utf8",
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
} else {
  process.stdout.write("Learning authority contract verified.\n");
}

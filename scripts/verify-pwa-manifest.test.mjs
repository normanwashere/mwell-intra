import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the PWA manifest describes Intra as a whole and permits tablet landscape", async () => {
  const source = await readFile(
    new URL("../apps/shell/app/manifest.ts", import.meta.url),
    "utf8",
  );
  for (const moduleName of [
    "Warehouse",
    "Procurement",
    "Legal",
    "Finance",
    "Events",
    "Product",
    "Insights",
    "Administration",
  ]) {
    assert.match(source, new RegExp(moduleName));
  }
  assert.doesNotMatch(source, /orientation:\s*['"]portrait['"]/);
});

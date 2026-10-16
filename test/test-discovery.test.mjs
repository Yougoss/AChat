import assert from "node:assert/strict";
import test from "node:test";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverTestFiles } from "../scripts/test-discovery.mjs";

test("discovers root and nested .test.mjs files without Playwright specs", async () => {
  const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
  const testRoot = resolve(repositoryRoot, "test");
  const files = await discoverTestFiles(testRoot);
  const relativeFiles = files.map((file) => relative(repositoryRoot, file));

  assert.ok(relativeFiles.includes("test/app-runtime.test.mjs"));
  assert.ok(relativeFiles.includes("test/services/task-status.test.mjs"));
  assert.ok(files.length >= 40);
  assert.ok(relativeFiles.every((file) => file.endsWith(".test.mjs")));
  assert.ok(!relativeFiles.includes("test/e2e/status-unread.spec.ts"));
});

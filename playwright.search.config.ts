import { defineConfig } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";

const searchDataDir = path.join(
  process.cwd(),
  ".superpowers",
  "sdd",
  "2026-10-15-achat-poc-v1",
  `task-9-e2e-data-${process.pid}-${randomUUID()}`,
);
process.env.ACHAT_TASK9_E2E_DATA_DIR = searchDataDir;

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "search.spec.ts",
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  globalTeardown: "./scripts/e2e-search-teardown.mjs",
  use: {
    baseURL: "http://127.0.0.1:3010",
    browserName: "chromium",
  },
  webServer: {
    command: "node --experimental-strip-types scripts/e2e-search-prepare-and-start.mjs",
    env: {
      ...process.env,
      ACHAT_DATA_DIR: searchDataDir,
    },
    url: "http://127.0.0.1:3010",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});

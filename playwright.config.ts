import { defineConfig } from "@playwright/test";
import path from "node:path";

const e2eDataDir = process.env.ACHAT_E2E_DATA_DIR ?? path.join(
  process.cwd(),
  ".superpowers",
  "sdd",
  "2026-10-15-achat-poc-v1",
  "task-10-e2e-data",
);

export default defineConfig({
  testDir: "./test/e2e",
  testIgnore: ["search.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3010",
    browserName: "chromium",
  },
  webServer: {
    command: "node --experimental-strip-types scripts/e2e-prepare-and-start.mjs",
    env: {
      ...process.env,
      ACHAT_DATA_DIR: e2eDataDir,
      PI_CODING_AGENT_DIR: path.join(e2eDataDir, "pi-agent"),
    },
    url: "http://127.0.0.1:3010",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});

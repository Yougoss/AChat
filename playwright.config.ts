import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3010",
    browserName: "chromium",
  },
  webServer: {
    command: "node --experimental-strip-types scripts/e2e-prepare-and-start.mjs",
    url: "http://127.0.0.1:3010",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});

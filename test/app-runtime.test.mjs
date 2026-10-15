import assert from "node:assert/strict";
import { homedir } from "node:os";
import path from "node:path";
import test from "node:test";

let runtimeModule;
try {
  runtimeModule = await import("../src/server/app-runtime.ts");
} catch (error) {
  if (
    error?.code === "ERR_MODULE_NOT_FOUND" &&
    String(error.message).includes("app-runtime.ts")
  ) {
    runtimeModule = {};
  } else {
    throw error;
  }
}

test("getAppRuntime returns the process-owned singleton without starting it", async () => {
  assert.equal(typeof runtimeModule.getAppRuntime, "function");
  const first = await runtimeModule.getAppRuntime();
  const second = await runtimeModule.getAppRuntime();
  assert.strictEqual(second, first);
});

test("AppRuntime starts its services once across repeated calls", async () => {
  assert.equal(typeof runtimeModule.createAppRuntime, "function");
  let starts = 0;
  const runtime = runtimeModule.createAppRuntime({
    async start() {
      starts += 1;
    },
  });

  await Promise.all([runtime.start(), runtime.start()]);
  await runtime.start();

  assert.equal(starts, 1);
});

test("stopping an AppRuntime prevents later work from starting", async () => {
  assert.equal(typeof runtimeModule.createAppRuntime, "function");
  let starts = 0;
  let stops = 0;
  const runtime = runtimeModule.createAppRuntime({
    async start() {
      starts += 1;
    },
    async stop() {
      stops += 1;
    },
  });

  await runtime.start();
  await runtime.stop();

  await assert.rejects(runtime.start(), /stopped/i);
  await runtime.stop();
  assert.equal(starts, 1);
  assert.equal(stops, 1);
});

test("resolveDataDir defaults to ~/.achat and honors ACHAT_DATA_DIR", () => {
  assert.equal(typeof runtimeModule.resolveDataDir, "function");
  assert.equal(
    runtimeModule.resolveDataDir({}),
    path.join(homedir(), ".achat"),
  );
  assert.equal(
    runtimeModule.resolveDataDir({ ACHAT_DATA_DIR: "/tmp/achat-test" }),
    "/tmp/achat-test",
  );
});

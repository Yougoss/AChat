import assert from "node:assert/strict";
import test from "node:test";
import { listCopilotModels } from "../../src/server/pi/model-runtime.ts";

test("projects Copilot models in Pi runtime order with live auth state", async () => {
  const runtime = {
    getModels(providerId) {
      assert.equal(providerId, "github-copilot");
      return [
        { provider: "github-copilot", id: "model-b", name: "Model B" },
        { provider: "github-copilot", id: "model-a", name: "Model A" },
      ];
    },
    getProviderAuthStatus(providerId) {
      assert.equal(providerId, "github-copilot");
      return { configured: true };
    },
  };

  assert.deepEqual(await listCopilotModels(runtime), [
    {
      provider: "github-copilot",
      modelId: "model-b",
      name: "Model B",
      authState: "authenticated",
    },
    {
      provider: "github-copilot",
      modelId: "model-a",
      name: "Model A",
      authState: "authenticated",
    },
  ]);
});

test("creates Pi runtime resources only when its lifecycle starts", async () => {
  const { createPiRuntimeLifecycle } = await import("../../src/server/pi/model-runtime.ts");
  const calls = [];
  const lifecycle = createPiRuntimeLifecycle({
    createRuntime: async (options) => {
      calls.push(options);
      return { dispose() { calls.push("disposed"); } };
    },
    agentDir: "/shared/pi-agent",
  });

  assert.deepEqual(calls, []);
  await lifecycle.start();
  assert.equal(calls[0].agentDir, "/shared/pi-agent");
  await lifecycle.stop();
  assert.equal(calls.at(-1), "disposed");
});

import assert from "node:assert/strict";
import test from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { loginProvider, submitProviderLoginInput } from "../../src/server/pi/model-runtime.ts";

function createCredentialStore() {
  const values = new Map();
  return {
    async read(providerId) {
      return values.get(providerId);
    },
    async list() {
      return [...values].map(([providerId, credential]) => ({
        providerId,
        type: credential.type,
      }));
    },
    async modify(providerId, fn) {
      const next = await fn(values.get(providerId));
      if (next !== undefined) values.set(providerId, next);
      return values.get(providerId);
    },
    async delete(providerId) {
      values.delete(providerId);
    },
  };
}

test("streams a fake Copilot device-code login through Pi and persists its credential", async () => {
  const credentials = createCredentialStore();
  const runtime = await ModelRuntime.create({ credentials, refreshOnCreate: false });
  runtime.registerNativeProvider({
    id: "github-copilot",
    name: "Fake GitHub Copilot",
    auth: {
      oauth: {
        name: "Fake device-code login",
        async login(interaction) {
          interaction.notify({
            type: "device_code",
            userCode: "FAKE-CODE",
            verificationUri: "https://example.invalid/device",
          });
          const input = await interaction.prompt({
            type: "manual_code",
            message: "Enter the fake device code",
          });
          return {
            type: "oauth",
            refresh: `refresh-${input}`,
            access: `access-${input}`,
            expires: Date.now() + 60_000,
          };
        },
        async refresh(credential) {
          return credential;
        },
        async toAuth(credential) {
          return { apiKey: credential.access };
        },
      },
    },
    getModels() {
      return [{
        id: "fake-model",
        name: "Fake model",
        api: "openai-completions",
        provider: "github-copilot",
        baseUrl: "https://example.invalid",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1000,
        maxTokens: 100,
      }];
    },
    async stream() {
      throw new Error("Not used in the auth test");
    },
    async streamSimple() {
      throw new Error("Not used in the auth test");
    },
  });

  const events = [];
  const iterator = loginProvider("github-copilot", runtime)[Symbol.asyncIterator]();
  try {
    while (true) {
      const { value, done } = await iterator.next();
      if (done) break;
      events.push(value);
      if (value.type === "prompt_request") {
        assert.equal(
          submitProviderLoginInput("github-copilot", value.token, "accepted"),
          true,
        );
      }
    }
  } finally {
    await iterator.return?.();
  }

  assert.ok(events.some((event) => event.type === "device_code"));
  assert.ok(events.some((event) => event.type === "success"));
  assert.equal((await credentials.read("github-copilot")).access, "access-accepted");
  assert.equal(runtime.getProviderAuthStatus("github-copilot").configured, true);
});

test("rejects login callbacks whose provider or token does not match", async () => {
  assert.equal(submitProviderLoginInput("github-copilot", "other-provider-token", "code"), false);
  await assert.rejects(async () => {
    for await (const _event of loginProvider("another-provider", {
      login: async () => { throw new Error("must not run"); },
    })) {
      // The provider is rejected before login is called.
    }
  }, /unsupported provider/i);
});

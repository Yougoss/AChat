import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AuthEvent as PiAuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import {
  getAgentDir,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { AppRuntimeLifecycle } from "../app-runtime.ts";

export interface ModelOption {
  provider: "github-copilot";
  modelId: string;
  name: string;
  authState: "authenticated" | "unauthenticated";
}

export type ProviderLoginEvent =
  | PiAuthEvent
  | {
      type: "prompt_request";
      message: string;
      placeholder: string | null;
      token: string;
    }
  | {
      type: "select_request";
      message: string;
      options: readonly { id: string; label: string; description?: string }[];
      token: string;
    }
  | { type: "success" }
  | { type: "error"; message: string }
  | { type: "cancelled" };

type ModelRuntimeForListing = Pick<
  ModelRuntime,
  "getModels" | "getProviderAuthStatus"
>;

type ModelRuntimeForLogin = Pick<ModelRuntime, "login" | "logout">;

type RuntimeLifecycleOptions = {
  agentDir?: string;
  createRuntime?: (options: { agentDir: string }) => Promise<{
    dispose?: () => void | Promise<void>;
  }>;
};

let sharedRuntime: ModelRuntime | undefined;
let sharedRuntimePromise: Promise<ModelRuntime> | undefined;

async function createSharedRuntime(): Promise<ModelRuntime> {
  const agentDir = getAgentDir();
  return ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: path.join(agentDir, "models.json"),
    refreshOnCreate: false,
  });
}

export async function getPiModelRuntime(): Promise<ModelRuntime> {
  if (sharedRuntime) return sharedRuntime;
  sharedRuntimePromise ??= createSharedRuntime();
  try {
    sharedRuntime = await sharedRuntimePromise;
    return sharedRuntime;
  } catch (error) {
    sharedRuntimePromise = undefined;
    throw error;
  }
}

export function createPiRuntimeLifecycle(
  options: RuntimeLifecycleOptions = {},
): AppRuntimeLifecycle {
  let runtime: unknown;
  let startPromise: Promise<void> | undefined;
  return {
    async start() {
      if (runtime) return;
      startPromise ??= (async () => {
        if (options.createRuntime) {
          runtime = await options.createRuntime({
            agentDir: options.agentDir ?? getAgentDir(),
          });
          return;
        }
        runtime = await getPiModelRuntime();
      })();
      try {
        await startPromise;
      } catch (error) {
        startPromise = undefined;
        throw error;
      }
    },
    async stop() {
      await startPromise;
      if (!runtime) return;
      const stopped = runtime;
      runtime = undefined;
      startPromise = undefined;
      if (
        typeof stopped === "object"
        && stopped !== null
        && "dispose" in stopped
        && typeof stopped.dispose === "function"
      ) {
        await stopped.dispose();
      }
      if (stopped === sharedRuntime) {
        sharedRuntime = undefined;
        sharedRuntimePromise = undefined;
      }
    },
  };
}

export async function listCopilotModels(
  runtime?: ModelRuntimeForListing,
): Promise<ModelOption[]> {
  const activeRuntime = runtime ?? await getPiModelRuntime();
  const authState = activeRuntime.getProviderAuthStatus("github-copilot").configured
    ? "authenticated"
    : "unauthenticated";
  return activeRuntime.getModels("github-copilot").map((model) => ({
    provider: "github-copilot",
    modelId: model.id,
    name: model.name,
    authState,
  }));
}

export async function listAuthProviders(
  runtime?: Pick<ModelRuntime, "getProvider" | "getProviderAuthStatus">,
) {
  const activeRuntime = runtime ?? await getPiModelRuntime();
  const providerId = "github-copilot";
  const provider = activeRuntime.getProvider(providerId);
  if (!provider) return [];
  return [{
    providerId,
    name: provider.name,
    authState: activeRuntime.getProviderAuthStatus(providerId).configured
      ? "authenticated" as const
      : "unauthenticated" as const,
  }];
}

const pendingPrompts = new Map<
  string,
  { providerId: string; resolve: (value: string) => void; reject: (error: Error) => void }
>();

export function submitProviderLoginInput(
  providerId: string,
  token: string,
  input: string,
): boolean {
  if (providerId !== "github-copilot" || !token.startsWith(`${providerId}-`)) {
    return false;
  }
  const pending = pendingPrompts.get(token);
  if (!pending || pending.providerId !== providerId) return false;
  pendingPrompts.delete(token);
  pending.resolve(input);
  return true;
}

class AsyncEventQueue implements AsyncIterableIterator<ProviderLoginEvent> {
  private values: ProviderLoginEvent[] = [];
  private waiters: Array<(result: IteratorResult<ProviderLoginEvent>) => void> = [];
  private closed = false;

  push(event: ProviderLoginEvent): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: event, done: false });
    else this.values.push(event);
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  next(): Promise<IteratorResult<ProviderLoginEvent>> {
    const value = this.values.shift();
    if (value) return Promise.resolve({ value, done: false });
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  async return(): Promise<IteratorResult<ProviderLoginEvent>> {
    this.close();
    return { value: undefined, done: true };
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<ProviderLoginEvent> {
    return this;
  }
}

function isCancellation(error: unknown): boolean {
  return error instanceof Error && /cancel|abort/i.test(error.message);
}

export async function* loginProvider(
  providerId: string,
  runtime?: ModelRuntimeForLogin,
  signal?: AbortSignal,
): AsyncIterable<ProviderLoginEvent> {
  if (providerId !== "github-copilot") {
    throw new Error(`Unsupported provider: ${providerId}`);
  }
  const activeRuntime = runtime ?? await getPiModelRuntime();
  const queue = new AsyncEventQueue();
  const abortController = new AbortController();
  const pendingTokens = new Set<string>();
  const abort = () => abortController.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();

  const rejectPending = (message: string) => {
    for (const token of pendingTokens) {
      const pending = pendingPrompts.get(token);
      if (pending) {
        pendingPrompts.delete(token);
        pending.reject(new Error(message));
      }
    }
    pendingTokens.clear();
  };

  const loginPromise = activeRuntime.login(
    providerId,
    "oauth",
    {
      signal: abortController.signal,
      prompt: (prompt: AuthPrompt) => new Promise<string>((resolve, reject) => {
        const token = `${providerId}-${randomUUID()}`;
        pendingTokens.add(token);
        const cleanup = () => prompt.signal?.removeEventListener("abort", onAbort);
        const settle = (settlePrompt: () => void) => {
          pendingPrompts.delete(token);
          pendingTokens.delete(token);
          cleanup();
          settlePrompt();
        };
        const onAbort = () => pendingPrompts.get(token)?.reject(new Error("Login cancelled"));
        pendingPrompts.set(token, {
          providerId,
          resolve: (value) => {
            settle(() => resolve(value));
          },
          reject: (error) => {
            settle(() => reject(error));
          },
        });
        if (prompt.signal?.aborted) {
          onAbort();
          return;
        }
        prompt.signal?.addEventListener("abort", onAbort, { once: true });
        if (prompt.type === "select") {
          queue.push({
            type: "select_request",
            message: prompt.message,
            options: prompt.options,
            token,
          });
        } else {
          queue.push({
            type: "prompt_request",
            message: prompt.message,
            placeholder: prompt.type === "manual_code" ? prompt.placeholder ?? null : prompt.placeholder ?? null,
            token,
          });
        }
      }),
      notify: (event) => queue.push(event),
    },
  )
    .then(() => queue.push({ type: "success" }))
    .catch((error: unknown) => {
      if (isCancellation(error)) queue.push({ type: "cancelled" });
      else queue.push({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      rejectPending("Login finished");
      signal?.removeEventListener("abort", abort);
      queue.close();
    });

  try {
    for await (const event of queue) yield event;
  } finally {
    if (!abortController.signal.aborted) abortController.abort();
    rejectPending("Login cancelled");
    await loginPromise;
  }
}

export async function logoutProvider(
  providerId: string,
  runtime?: ModelRuntimeForLogin,
): Promise<void> {
  if (providerId !== "github-copilot") {
    throw new Error(`Unsupported provider: ${providerId}`);
  }
  await (runtime ?? await getPiModelRuntime()).logout(providerId);
}

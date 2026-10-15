import { homedir } from "node:os";
import path from "node:path";

export interface AppRuntimeLifecycle {
  start?: () => Promise<void>;
  stop?: () => Promise<void>;
}

export interface AppRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
}

type RuntimeState = "idle" | "starting" | "started" | "stopping" | "stopped";

export function createAppRuntime(
  lifecycle: AppRuntimeLifecycle = {},
): AppRuntime {
  let state: RuntimeState = "idle";
  let startPromise: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;

  return {
    start(): Promise<void> {
      if (state === "stopping" || state === "stopped") {
        return Promise.reject(new Error("AppRuntime is stopped"));
      }
      if (state === "started") {
        return Promise.resolve();
      }
      if (startPromise) {
        return startPromise;
      }

      state = "starting";
      startPromise = Promise.resolve()
        .then(() => lifecycle.start?.())
        .then(
          () => {
            if (state === "starting") {
              state = "started";
            }
          },
          (error: unknown) => {
            if (state === "starting") {
              state = "idle";
            }
            startPromise = undefined;
            throw error;
          },
        );
      return startPromise;
    },
    stop(): Promise<void> {
      if (stopPromise) {
        return stopPromise;
      }

      state = "stopping";
      stopPromise = (async () => {
        if (startPromise) {
          await startPromise.catch(() => undefined);
        }
        try {
          await lifecycle.stop?.();
        } finally {
          state = "stopped";
        }
      })();
      return stopPromise;
    },
  };
}

let processRuntime: AppRuntime | undefined;

export function getAppRuntime(): Promise<AppRuntime> {
  processRuntime ??= createAppRuntime();
  return Promise.resolve(processRuntime);
}

export function resolveDataDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.resolve(env.ACHAT_DATA_DIR || path.join(homedir(), ".achat"));
}

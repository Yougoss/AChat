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

interface AppRuntimeController {
  runtime: AppRuntime;
  registerLifecycle(lifecycle: AppRuntimeLifecycle): void;
}

type RuntimeState = "idle" | "starting" | "started" | "stopping" | "stopped";

function createAppRuntimeController(
  lifecycles: AppRuntimeLifecycle[] = [],
): AppRuntimeController {
  let state: RuntimeState = "idle";
  let startPromise: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;
  const registeredLifecycles = [...lifecycles];

  const runtime: AppRuntime = {
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
        .then(async () => {
          for (const lifecycle of registeredLifecycles) {
            await lifecycle.start?.();
          }
        })
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
          for (let index = registeredLifecycles.length - 1; index >= 0; index -= 1) {
            await registeredLifecycles[index].stop?.();
          }
        } finally {
          state = "stopped";
        }
      })();
      return stopPromise;
    },
  };

  return {
    runtime,
    registerLifecycle(lifecycle: AppRuntimeLifecycle): void {
      if (state !== "idle") {
        throw new Error("Cannot register lifecycle after AppRuntime startup");
      }
      registeredLifecycles.push(lifecycle);
    },
  };
}

export function createAppRuntime(
  lifecycle: AppRuntimeLifecycle | AppRuntimeLifecycle[] = {},
): AppRuntime {
  return createAppRuntimeController(Array.isArray(lifecycle) ? lifecycle : [lifecycle]).runtime;
}

let processRuntimeController: AppRuntimeController | undefined;

function getProcessRuntimeController(): AppRuntimeController {
  processRuntimeController ??= createAppRuntimeController();
  return processRuntimeController;
}

export function getAppRuntime(): Promise<AppRuntime> {
  return Promise.resolve(getProcessRuntimeController().runtime);
}

export function registerAppRuntimeLifecycle(
  lifecycle: AppRuntimeLifecycle,
): void {
  getProcessRuntimeController().registerLifecycle(lifecycle);
}

export function resolveDataDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.resolve(env.ACHAT_DATA_DIR || path.join(homedir(), ".achat"));
}

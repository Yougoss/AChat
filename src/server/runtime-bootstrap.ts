import { existsSync } from "node:fs";
import type { AppRuntimeLifecycle, AppRuntime } from "./app-runtime.ts";
import {
  getAppRuntime,
  registerAppRuntimeLifecycle,
} from "./app-runtime.ts";
import { createDatabaseLifecycle, type DatabaseLifecycle } from "./db/client.ts";
import { createRecoveryLifecycle, type RecoveryLifecycle } from "./lifecycle/recovery.ts";
import { createPiRuntimeLifecycle } from "./pi/model-runtime.ts";
import { createWorkQueueLifecycle, type WorkQueueLifecycle } from "./scheduler/work-queue.ts";

export interface RuntimeLifecycleDependencies {
  registerLifecycle: (lifecycle: AppRuntimeLifecycle) => void;
  databaseLifecycle: AppRuntimeLifecycle;
  piRuntimeLifecycle: AppRuntimeLifecycle;
  recoveryLifecycle?: AppRuntimeLifecycle;
  workQueueLifecycle: AppRuntimeLifecycle;
}

export function registerAchatRuntimeLifecycles(
  dependencies: RuntimeLifecycleDependencies,
): void {
  dependencies.registerLifecycle(dependencies.databaseLifecycle);
  dependencies.registerLifecycle(dependencies.piRuntimeLifecycle);
  if (dependencies.recoveryLifecycle) {
    dependencies.registerLifecycle(dependencies.recoveryLifecycle);
  }
  dependencies.registerLifecycle(dependencies.workQueueLifecycle);
}

let processDatabaseLifecycle: DatabaseLifecycle | undefined;
let processPiRuntimeLifecycle: AppRuntimeLifecycle | undefined;
let processRecoveryLifecycle: RecoveryLifecycle | undefined;
let processQueueLifecycle: WorkQueueLifecycle | undefined;
let processLifecyclesRegistered = false;

function registerProcessLifecycles(): void {
  if (processLifecyclesRegistered) return;
  processDatabaseLifecycle ??= createDatabaseLifecycle();
  processPiRuntimeLifecycle ??= createPiRuntimeLifecycle();
  processQueueLifecycle ??= createWorkQueueLifecycle({
    databaseLifecycle: processDatabaseLifecycle,
  });
  processRecoveryLifecycle ??= createRecoveryLifecycle({
    getDatabase: () => processDatabaseLifecycle!.getDatabase(),
    runWorkItem: (workItemId) =>
      processQueueLifecycle!.getWorkQueue().runTaskWorkItem(workItemId),
    hasSessionFile: existsSync,
  });
  registerAchatRuntimeLifecycles({
    registerLifecycle: registerAppRuntimeLifecycle,
    databaseLifecycle: processDatabaseLifecycle,
    piRuntimeLifecycle: processPiRuntimeLifecycle,
    recoveryLifecycle: processRecoveryLifecycle,
    workQueueLifecycle: processQueueLifecycle,
  });
  processLifecyclesRegistered = true;
}

export async function startAchatRuntime(): Promise<AppRuntime> {
  registerProcessLifecycles();
  const runtime = await getAppRuntime();
  await runtime.start();
  return runtime;
}

export function getAchatDatabase(): ReturnType<DatabaseLifecycle["getDatabase"]> {
  if (!processDatabaseLifecycle) throw new Error("AChat runtime has not been started");
  return processDatabaseLifecycle.getDatabase();
}

export function getAchatWorkQueue(): ReturnType<WorkQueueLifecycle["getWorkQueue"]> {
  if (!processQueueLifecycle) throw new Error("AChat runtime has not been started");
  return processQueueLifecycle.getWorkQueue();
}

export function getAchatRecoveryService(): ReturnType<
  RecoveryLifecycle["getRecoveryService"]
> {
  if (!processRecoveryLifecycle) throw new Error("AChat runtime has not been started");
  return processRecoveryLifecycle.getRecoveryService();
}

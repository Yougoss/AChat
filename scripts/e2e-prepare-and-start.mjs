import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, migrate } from "../src/server/db/client.ts";
import { createGroupTaskRepository } from "../src/server/db/repositories/group-task-repository.ts";
import { createEventRepository } from "../src/server/db/repositories/event-repository.ts";
import { createRunRepository } from "../src/server/db/repositories/run-repository.ts";
import { createWorkItemRepository } from "../src/server/db/repositories/work-item-repository.ts";
import { seedContact, seedProject } from "../test/db/helpers.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(
  projectRoot,
  ".superpowers",
  "sdd",
  "2026-10-15-achat-poc-v1",
  "task-7-e2e-data",
);
rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true, mode: 0o700 });

const db = openDatabase(path.join(dataDir, "achat.sqlite"));
try {
  migrate(db);
  seedProject(db);
  seedContact(db, "contact-1");
  const groups = createGroupTaskRepository(db);
  const { group, task } = groups.createGroupWithTask({
    group: { id: "group-1", name: "Status test group", description: "E2E status and unread" },
    task: { id: "task-1", projectId: "project-1", description: "Verify live status", status: "open" },
  });
  groups.addGroupMember(group.id, "contact-1");
  groups.addTaskMember(task.id, "contact-1");
  const item = createWorkItemRepository(db).createWorkItem({
    id: "work-item-1",
    taskId: task.id,
    contactId: "contact-1",
    title: "Live completion",
    status: "running",
  });
  const run = createRunRepository(db).createRun({
    id: "run-1",
    taskId: task.id,
    workItemId: item.id,
    contactId: "contact-1",
    attempt: 1,
    status: "running",
    startedAt: "2026-10-16T02:00:00.000Z",
  });
  createEventRepository(db).appendEvent({
    id: "run-1-started",
    entityType: "run",
    entityId: run.id,
    type: "run.started",
    payload: {
      runId: run.id,
      taskId: task.id,
      workItemId: item.id,
      contactId: item.contactId,
    },
    idempotencyKey: "run-1-started",
    createdAt: run.startedAt,
  });
} finally {
  db.close();
}

const nextCli = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextCli, "dev", "-H", "127.0.0.1", "-p", "3010"], {
  cwd: projectRoot,
  env: {
    ...process.env,
    ACHAT_DATA_DIR: dataDir,
    NEXT_TELEMETRY_DISABLED: "1",
  },
  stdio: "inherit",
});
let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  child.kill(signal);
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
child.on("error", (error) => {
  console.error(error);
  stop();
});
child.on("exit", (code) => {
  rmSync(dataDir, { recursive: true, force: true });
  process.exitCode = code ?? 1;
});

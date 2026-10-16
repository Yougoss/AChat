import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, migrate } from "../src/server/db/client.ts";
import { createGroupTaskRepository } from "../src/server/db/repositories/group-task-repository.ts";
import { createEventRepository } from "../src/server/db/repositories/event-repository.ts";
import { createMessageRepository } from "../src/server/db/repositories/message-repository.ts";
import { createRunRepository } from "../src/server/db/repositories/run-repository.ts";
import { createSessionRepository } from "../src/server/db/repositories/session-repository.ts";
import { createWorkItemRepository } from "../src/server/db/repositories/work-item-repository.ts";
import { seedContact, seedProject } from "../test/db/helpers.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.ACHAT_DATA_DIR || path.join(
  projectRoot,
  ".superpowers",
  "sdd",
  "2026-10-15-achat-poc-v1",
  `task-e2e-data-${process.pid}-${randomUUID()}`,
);
let dataDirCleaned = false;
function cleanDataDir() {
  if (dataDirCleaned) return;
  dataDirCleaned = true;
  rmSync(dataDir, { recursive: true, force: true });
}
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
mkdirSync(process.env.PI_CODING_AGENT_DIR || path.join(dataDir, "pi-agent"), {
  recursive: true,
  mode: 0o700,
});
if (existsSync(path.join(dataDir, "achat.sqlite"))) {
  throw new Error(`Refusing to reuse an existing E2E database: ${dataDir}`);
}

const db = openDatabase(path.join(dataDir, "achat.sqlite"));
try {
  migrate(db);
  seedProject(db);
  seedContact(db, "contact-1");
  seedContact(db, "developer");
  seedContact(db, "tester");
  db.prepare("UPDATE contacts SET name = ? WHERE id = ?").run("Developer", "developer");
  db.prepare("UPDATE contacts SET name = ? WHERE id = ?").run("Test", "tester");
  const groups = createGroupTaskRepository(db);
  const messages = createMessageRepository(db);
  const sessions = createSessionRepository(db);
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

  const demo = groups.createGroupWithTask({
    group: { id: "group-demo", name: "Feature", description: "Developer and Test demonstration" },
    task: { id: "task-demo", projectId: "project-1", description: "", status: "open" },
  });
  for (const contactId of ["developer", "tester"]) {
    groups.addGroupMember(demo.group.id, contactId);
    groups.addTaskMember(demo.task.id, contactId);
  }
  messages.createConversation({
    id: "conversation-demo",
    groupId: demo.group.id,
    taskId: demo.task.id,
    contactId: null,
    kind: "task",
  });

  const feature = groups.createGroupWithTask({
    group: { id: "group-feature", name: "Feature triage", description: "Feature bug search fixture" },
    task: {
    id: "task-feature",
    projectId: "project-1",
    description: "Investigate the Feature bug and verify a fix.",
    status: "open",
    },
  });
  for (const contactId of ["developer", "tester"]) {
    groups.addGroupMember(feature.group.id, contactId);
    groups.addTaskMember(feature.task.id, contactId);
  }
  const featureConversation = messages.createConversation({
    id: "conversation-feature",
    groupId: feature.group.id,
    taskId: feature.task.id,
    contactId: null,
    kind: "task",
  });
  messages.appendMessage({
    id: "feature-bug",
    conversationId: featureConversation.id,
    role: "user",
    content: "Feature bug: the input edge case is reproducible.",
    createdAt: "2026-10-16T03:00:00.000Z",
  });

  const recovery = groups.createGroupWithTask({
    group: {
    id: "group-recovery",
    name: "Recovery fixture",
    description: "Interrupted work must be retried explicitly.",
    },
    task: {
    id: "task-recovery",
    projectId: "project-1",
    description: "Reopen the interrupted task only when the user retries it.",
    status: "open",
    },
  });
  groups.addGroupMember(recovery.group.id, "contact-1");
  groups.addTaskMember(recovery.task.id, "contact-1");
  const recoveryConversation = messages.createConversation({
    id: "conversation-recovery",
    groupId: recovery.group.id,
    taskId: recovery.task.id,
    contactId: null,
    kind: "task",
  });
  const recoverySessionFile = path.join(
    dataDir,
    "sessions",
    "contact-1",
    "task",
    `${recovery.task.id}.jsonl`,
  );
  mkdirSync(path.dirname(recoverySessionFile), { recursive: true, mode: 0o700 });
  writeFileSync(recoverySessionFile, "{\"type\":\"test-session\"}\n", { mode: 0o600 });
  sessions.createSessionMapping({
    id: "recovery-mapping",
    contactId: "contact-1",
    taskId: recovery.task.id,
    conversationId: recoveryConversation.id,
    kind: "task",
    piSessionId: "pi-recovery-session",
    sessionFile: recoverySessionFile,
  });
  const recoveryItem = createWorkItemRepository(db).createWorkItem({
    id: "recovery-work-item",
    taskId: recovery.task.id,
    contactId: "contact-1",
    title: "Resume recovery check",
    status: "running",
  });
  const recoveryRun = createRunRepository(db).createRun({
    id: "recovery-run",
    taskId: recovery.task.id,
    workItemId: recoveryItem.id,
    contactId: "contact-1",
    attempt: 1,
    status: "running",
    startedAt: "2026-10-16T02:00:00.000Z",
  });
  createEventRepository(db).appendEvent({
    id: "recovery-run-started",
    entityType: "run",
    entityId: recoveryRun.id,
    type: "run.started",
    payload: {
    runId: recoveryRun.id,
    taskId: recovery.task.id,
    workItemId: recoveryItem.id,
    contactId: "contact-1",
    },
    idempotencyKey: "recovery-run-started",
    createdAt: recoveryRun.startedAt,
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
    PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR || path.join(dataDir, "pi-agent"),
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
process.on("exit", cleanDataDir);
child.on("error", (error) => {
  console.error(error);
  stop();
});
child.on("exit", (code) => {
  cleanDataDir();
  process.exitCode = code ?? 1;
});

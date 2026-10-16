import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, migrate } from "../src/server/db/client.ts";
import { createGroupTaskRepository } from "../src/server/db/repositories/group-task-repository.ts";
import { createMessageRepository } from "../src/server/db/repositories/message-repository.ts";
import { seedContact, seedProject } from "../test/db/helpers.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.ACHAT_TASK9_E2E_DATA_DIR ?? path.join(
  projectRoot,
  ".superpowers",
  "sdd",
  "2026-10-15-achat-poc-v1",
  `task-9-e2e-data-${process.pid}-${randomUUID()}`,
);
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
let cleaned = false;
function cleanDataDir() {
  if (cleaned) return;
  cleaned = true;
  rmSync(dataDir, { recursive: true, force: true });
}

const db = openDatabase(path.join(dataDir, "achat.sqlite"));
try {
  migrate(db);
  seedProject(db);
  seedContact(db, "contact-1");
  seedContact(db, "contact-2");

  const groups = createGroupTaskRepository(db);
  const messages = createMessageRepository(db);
  const one = groups.createGroupWithTask({
    group: { id: "group-search", name: "AChat Task Result", description: "Search E2E task" },
    task: {
      id: "task-search",
      projectId: "project-1",
      description: "Find a visible search result",
      status: "open",
    },
  });
  groups.addTaskMember(one.task.id, "contact-1");
  const taskConversation = messages.createConversation({
    id: "conversation-search",
    groupId: one.group.id,
    taskId: one.task.id,
    contactId: null,
    kind: "task",
  });
  messages.appendMessage({
    id: "task-search-hit",
    conversationId: taskConversation.id,
    role: "user",
    content: "orchid-search-token lands on this visible task message",
    createdAt: "2026-10-16T10:00:00.000Z",
  });

  const two = groups.createGroupWithTask({
    group: { id: "group-restricted", name: "Restricted Task", description: "Not a contact member" },
    task: {
      id: "task-restricted",
      projectId: "project-1",
      description: "This task belongs to another contact",
      status: "open",
    },
  });
  groups.addTaskMember(two.task.id, "contact-2");
  const restrictedConversation = messages.createConversation({
    id: "conversation-restricted",
    groupId: two.group.id,
    taskId: two.task.id,
    contactId: null,
    kind: "task",
  });
  messages.appendMessage({
    id: "restricted-search-hit",
    conversationId: restrictedConversation.id,
    role: "user",
    content: "orchid-search-token unauthorized preview for contact two",
    createdAt: "2026-10-16T11:00:00.000Z",
  });
  const privateConversation = messages.createConversation({
    id: "private-contact-two",
    groupId: null,
    taskId: null,
    contactId: "contact-2",
    kind: "private",
  });
  messages.appendMessage({
    id: "private-restricted-hit",
    conversationId: privateConversation.id,
    role: "user",
    content: "orchid-search-token unauthorized private preview",
    createdAt: "2026-10-16T12:00:00.000Z",
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
process.on("SIGHUP", () => stop("SIGHUP"));
process.on("exit", cleanDataDir);
child.on("error", (error) => {
  console.error(error);
  stop();
});
child.on("exit", (code) => {
  cleanDataDir();
  process.exitCode = code ?? 1;
});

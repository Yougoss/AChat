import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { seedContact, seedGroupTask, seedProject } from "../db/helpers.mjs";
import { migrate, openDatabase } from "../../src/server/db/client.ts";
import { createMessageRepository } from "../../src/server/db/repositories/message-repository.ts";
import { createRunRepository } from "../../src/server/db/repositories/run-repository.ts";
import { createWorkItemRepository } from "../../src/server/db/repositories/work-item-repository.ts";

test("group messages refresh returns run-keyed process summaries for the task conversation", async (t) => {
  const previousDataDir = process.env.ACHAT_DATA_DIR;
  const dataDir = path.join(process.cwd(), ".test-support", `group-process-details-${process.pid}`);
  mkdirSync(dataDir, { recursive: true });
  process.env.ACHAT_DATA_DIR = dataDir;
  t.after(async () => {
    if (previousDataDir === undefined) delete process.env.ACHAT_DATA_DIR;
    else process.env.ACHAT_DATA_DIR = previousDataDir;
    try {
      const { getAchatDatabase } = await import("../../src/server/runtime-bootstrap.ts");
      getAchatDatabase().close();
    } catch {
      // Runtime startup may not have opened the database if the route failed early.
    }
    rmSync(dataDir, { recursive: true, force: true });
  });

  const db = openDatabase(path.join(dataDir, "achat.sqlite"));
  migrate(db);
  seedProject(db);
  seedContact(db);
  const { group, task } = seedGroupTask(db);
  const conversation = createMessageRepository(db).createConversation({
    id: "task-conversation-1",
    groupId: group.id,
    taskId: task.id,
    contactId: null,
    kind: "task",
  });
  const workItem = createWorkItemRepository(db).createWorkItem({
    id: "work-1",
    taskId: task.id,
    contactId: "contact-1",
    title: "Implement the feature",
    status: "completed",
  });
  createRunRepository(db).createRun({
    id: "run-1",
    taskId: task.id,
    workItemId: workItem.id,
    contactId: "contact-1",
    attempt: 1,
    status: "running",
    startedAt: "2026-10-16T10:00:00.000Z",
  });
  createMessageRepository(db).appendMessage({
    id: "assistant-1",
    conversationId: conversation.id,
    role: "assistant",
    content: "Feature is implemented.",
    metadata: { runId: "run-1" },
    createdAt: "2026-10-16T10:01:00.000Z",
  });
  db.close();

  const { GET } = await import("../../src/app/api/groups/[groupId]/messages/route.ts");
  const response = await GET(
    new Request("http://localhost/api/groups/group-1/messages"),
    { params: Promise.resolve({ groupId: "group-1" }) },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.messages.find(({ id }) => id === "assistant-1").metadata.runId, "run-1");
  assert.deepEqual(body.processSummaries["run-1"], { messageCount: 1, models: [] });
  assert.deepEqual(Object.keys(body.processSummaries), ["run-1"]);
});

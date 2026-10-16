import { createTestDatabase, seedContact, seedProject, seedGroupTask } from "../db/helpers.mjs";
import { createGroupTaskRepository } from "../../src/server/db/repositories/group-task-repository.ts";
import { createMessageRepository } from "../../src/server/db/repositories/message-repository.ts";
import { createSessionRepository } from "../../src/server/db/repositories/session-repository.ts";
import { createWorkItemRepository } from "../../src/server/db/repositories/work-item-repository.ts";
import { createRunRepository } from "../../src/server/db/repositories/run-repository.ts";

export function createExecutionFixture({ description = "Implement the shared feature" } = {}) {
  const db = createTestDatabase();
  seedProject(db);
  seedContact(db, "developer");
  seedContact(db, "tester");
  seedContact(db, "reviewer");
  db.prepare("UPDATE contacts SET name = ? WHERE id = ?").run("Developer", "developer");
  db.prepare("UPDATE contacts SET name = ? WHERE id = ?").run("Tester", "tester");
  db.prepare("UPDATE contacts SET name = ? WHERE id = ?").run("Reviewer", "reviewer");
  const { group, task: seededTask } = seedGroupTask(db);
  db.prepare("UPDATE tasks SET description = ? WHERE id = ?").run(description, seededTask.id);

  const groupTasks = createGroupTaskRepository(db);
  for (const contactId of ["developer", "tester", "reviewer"]) {
    groupTasks.addGroupMember(group.id, contactId);
    groupTasks.addTaskMember(seededTask.id, contactId);
  }
  const task = groupTasks.getTask(seededTask.id);
  const messages = createMessageRepository(db);
  const conversation = messages.createConversation({
    id: "task-conversation",
    groupId: group.id,
    taskId: task.id,
    contactId: null,
    kind: "task",
  });
  const sessions = createSessionRepository(db);
  const sourceMapping = sessions.createSessionMapping({
    id: "developer-mapping",
    contactId: "developer",
    taskId: task.id,
    conversationId: conversation.id,
    kind: "task",
    piSessionId: "pi-developer-task",
    sessionFile: "sessions/developer/task/task-1.jsonl",
  });
  const testerMapping = sessions.createSessionMapping({
    id: "tester-mapping",
    contactId: "tester",
    taskId: task.id,
    conversationId: conversation.id,
    kind: "task",
    piSessionId: "pi-tester-task",
    sessionFile: "sessions/tester/task/task-1.jsonl",
  });
  const sourceWorkItem = createWorkItemRepository(db).createWorkItem({
    id: "developer-work-item",
    taskId: task.id,
    contactId: "developer",
    title: "Original task",
    status: "running",
  });
  const sourceRun = createRunRepository(db).createRun({
    id: "developer-run",
    taskId: task.id,
    workItemId: sourceWorkItem.id,
    contactId: "developer",
    attempt: 1,
    status: "running",
    startedAt: "2026-10-16T01:00:00.000Z",
  });

  return {
    db,
    group,
    task,
    conversation,
    sourceMapping,
    testerMapping,
    sourceWorkItem,
    sourceRun,
    groupTasks,
    messages,
    sessions,
    context: {
      sourceAgentId: "developer",
      sourceContactId: "developer",
      taskId: task.id,
      sourcePiSessionId: sourceMapping.piSessionId,
      sourceRunId: sourceRun.id,
      handoffDepth: 0,
    },
  };
}

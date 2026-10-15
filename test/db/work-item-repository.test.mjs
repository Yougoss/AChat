import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase, seedContact, seedProject } from "./helpers.mjs";
import { createGroupTaskRepository } from "../../src/server/db/repositories/group-task-repository.ts";
import { createWorkItemRepository } from "../../src/server/db/repositories/work-item-repository.ts";

test("persists work items independently from run attempts", (t) => {
  const db = createTestDatabase();
  t.after(() => db.close());
  seedProject(db);
  seedContact(db);
  const { task } = createGroupTaskRepository(db).createGroupWithTask({
    group: { id: "group-1", name: "Planning", description: "Plan" },
    task: { id: "task-1", projectId: "project-1", description: "Task", status: "open" },
  });
  const repository = createWorkItemRepository(db);
  const item = repository.createWorkItem({
    id: "work-item-1",
    taskId: task.id,
    contactId: "contact-1",
    title: "Implement database",
    status: "pending",
  });

  assert.deepEqual(repository.getWorkItem(item.id), item);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM runs").get().count, 0);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createExecutionFixture } from "../pi/task-execution-fixtures.mjs";
import { createWorkItemRepository } from "../../src/server/db/repositories/work-item-repository.ts";

const handoffModule = await import("../../src/server/services/handoff-service.ts")
  .catch(() => ({}));

function requireHandoffService(t) {
  assert.equal(typeof handoffModule.createHandoffService, "function",
    "createHandoffService must persist structured handoffs");
  return handoffModule.createHandoffService;
}

function handoffInput(toolCallId = "tool-call-1") {
  return {
    recipientAgentId: "tester",
    instruction: "Run the focused integration suite.",
    expectedOutput: "A passing test report",
    toolCallId,
  };
}

test("commits a handoff message and recipient work item atomically before enqueueing", async (t) => {
  const createHandoffService = requireHandoffService(t);
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  const enqueueCalls = [];
  const service = createHandoffService(fixture.db, {
    idFactory: (() => {
      const ids = ["handoff-1", "handoff-message", "tester-work-item", "handoff-event"];
      return () => ids.shift();
    })(),
    now: () => "2026-10-16T02:00:00.000Z",
    enqueueWorkItem: (workItemId) => {
      assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM handoffs").get().count, 1);
      assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM messages").get().count, 1);
      assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM work_items").get().count, 2);
      enqueueCalls.push(workItemId);
    },
  });

  const result = await service.enqueueHandoff(fixture.context, handoffInput());

  assert.deepEqual(result, { handoffId: "handoff-1", status: "queued" });
  assert.deepEqual(enqueueCalls, ["tester-work-item"]);
  const workItem = createWorkItemRepository(fixture.db).getWorkItem("tester-work-item");
  assert.equal(workItem.contactId, "tester");
  assert.equal(workItem.taskId, fixture.task.id);
  assert.equal(workItem.status, "pending");
  const message = fixture.messages.getMessage("handoff-message");
  assert.equal(message.role, "handoff");
  assert.match(message.content, /@Tester/);
  assert.match(message.content, /Run the focused integration suite/);
});

test("rejects nonmember recipients without creating messages or work items", async (t) => {
  const createHandoffService = requireHandoffService(t);
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  let enqueued = false;
  const service = createHandoffService(fixture.db, {
    enqueueWorkItem: () => { enqueued = true; },
  });
  fixture.db.prepare("DELETE FROM task_members WHERE task_id = ? AND contact_id = 'reviewer'")
    .run(fixture.task.id);

  await assert.rejects(
    service.enqueueHandoff(fixture.context, { ...handoffInput(), recipientAgentId: "reviewer" }),
    /recipient|member/i,
  );
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM handoffs").get().count, 0);
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM messages").get().count, 0);
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM work_items").get().count, 1);
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM events").get().count, 0);
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM trace_records").get().count, 0);
  assert.equal(enqueued, false);
});

test("makes duplicate source Pi session and tool-call requests idempotent", async (t) => {
  const createHandoffService = requireHandoffService(t);
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  const enqueued = [];
  const service = createHandoffService(fixture.db, {
    idFactory: (() => {
      let id = 0;
      return () => `generated-${++id}`;
    })(),
    enqueueWorkItem: (id) => enqueued.push(id),
  });

  const first = await service.enqueueHandoff(fixture.context, handoffInput("same-tool-call"));
  const duplicate = await service.enqueueHandoff(fixture.context, handoffInput("same-tool-call"));

  assert.deepEqual(duplicate, first);
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM handoffs").get().count, 1);
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM messages").get().count, 1);
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM work_items").get().count, 2);
  assert.deepEqual(enqueued, ["generated-3"]);
});

test("rolls back every handoff write when the database transaction fails", async (t) => {
  const createHandoffService = requireHandoffService(t);
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  fixture.db.exec(`
    CREATE TRIGGER fail_handoff_insert
    BEFORE INSERT ON handoffs
    BEGIN SELECT RAISE(ABORT, 'synthetic transaction failure'); END
  `);
  let enqueued = false;
  const service = createHandoffService(fixture.db, {
    enqueueWorkItem: () => { enqueued = true; },
  });

  await assert.rejects(
    service.enqueueHandoff(fixture.context, handoffInput()),
    /synthetic transaction failure/,
  );
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM handoffs").get().count, 0);
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM messages").get().count, 0);
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM work_items").get().count, 1);
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM events").get().count, 0);
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM trace_records").get().count, 0);
  assert.equal(enqueued, false);
});

test("persists awaiting_user at handoff depth eight without a recipient item", async (t) => {
  const createHandoffService = requireHandoffService(t);
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  let enqueued = false;
  const service = createHandoffService(fixture.db, {
    idFactory: () => "depth-event",
    enqueueWorkItem: () => { enqueued = true; },
  });

  const result = await service.enqueueHandoff(
    { ...fixture.context, handoffDepth: 8 },
    handoffInput(),
  );

  assert.deepEqual(result, {
    status: "awaiting_user",
    reason: "handoff_depth_limit",
    eventId: "depth-event",
  });
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM work_items").get().count, 1);
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM handoffs").get().count, 0);
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM messages").get().count, 0);
  const event = fixture.db.prepare(`
    SELECT type, payload_json AS payload
    FROM events WHERE entity_type = 'task' AND entity_id = ?
  `).get(fixture.task.id);
  assert.equal(event.type, "awaiting_user");
  assert.match(event.payload, /handoff_depth_limit/);
  assert.equal(enqueued, false);
});

test("allows the eighth recipient handoff and records depth eight on its work item", async (t) => {
  const createHandoffService = requireHandoffService(t);
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  const ids = ["handoff-8", "message-8", "work-item-8", "event-8"];
  const service = createHandoffService(fixture.db, {
    idFactory: () => ids.shift(),
  });

  const result = await service.enqueueHandoff(
    { ...fixture.context, handoffDepth: 7 },
    handoffInput("tool-call-8"),
  );

  assert.deepEqual(result, { handoffId: "handoff-8", status: "queued" });
  assert.equal(createWorkItemRepository(fixture.db).getWorkItem("work-item-8").handoffDepth, 8);
});

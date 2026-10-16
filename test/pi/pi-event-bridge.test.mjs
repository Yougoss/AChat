import assert from "node:assert/strict";
import test from "node:test";
import { createExecutionFixture } from "./task-execution-fixtures.mjs";
import { createEventRepository } from "../../src/server/db/repositories/event-repository.ts";
import { createPiEventBridge } from "../../src/server/pi/pi-event-bridge.ts";

test("projects tool cancellation durably and keeps the event linked to the task-session trace", async (t) => {
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  let listener;
  const bridge = createPiEventBridge({
    db: fixture.db,
    run: fixture.sourceRun,
    scope: {
      id: fixture.sourceMapping.id,
      contactId: fixture.sourceMapping.contactId,
      taskId: fixture.sourceMapping.taskId,
      kind: "task",
      piSessionId: fixture.sourceMapping.piSessionId,
    },
    idFactory: (() => {
      let next = 0;
      return () => `bridge-event-${++next}`;
    })(),
    now: () => "2026-10-16T02:00:00.000Z",
  });
  bridge.subscribe({
    subscribe(callback) {
      listener = callback;
      return () => {};
    },
  });

  listener({
    type: "tool_execution_start",
    toolName: "bash",
    toolCallId: "cancelled-call",
    args: { command: "long-running command" },
  });
  listener({
    type: "tool_execution_cancel",
    toolName: "bash",
    toolCallId: "cancelled-call",
  });
  await bridge.flush();

  assert.deepEqual(
    createEventRepository(fixture.db).listEventsForEntity("run", fixture.sourceRun.id)
      .map(({ type }) => type),
    ["tool.started", "tool.cancelled"],
  );
  const traceEvents = fixture.db.prepare(`
    SELECT type, payload_json AS payload
    FROM trace_records
    WHERE mapping_id = ? AND type = 'achat_event'
    ORDER BY sequence
  `).all(fixture.sourceMapping.id);
  assert.deepEqual(traceEvents.map(({ type }) => type), ["achat_event", "achat_event"]);
  assert.equal(JSON.parse(traceEvents[1].payload).type, "tool.cancelled");
  assert.equal(JSON.parse(traceEvents[1].payload).payload.eventId, "bridge-event-2");
});

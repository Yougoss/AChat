import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { createExecutionFixture } from "../pi/task-execution-fixtures.mjs";
import { createEventRepository } from "../../src/server/db/repositories/event-repository.ts";
import { createUnreadRepository } from "../../src/server/db/repositories/unread-repository.ts";
import { createRunRepository } from "../../src/server/db/repositories/run-repository.ts";
import { UnreadBadge } from "../../src/components/UnreadBadge.tsx";
import { markGroupRunsRead } from "../../src/server/services/message-service.ts";

test("increments group unread exactly once when a run completes, regardless of completion notices", (t) => {
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  const unread = createUnreadRepository(fixture.db);

  assert.equal(unread.countUnreadRuns(fixture.group.id), 0);
  assert.equal(createRunRepository(fixture.db).getRun(fixture.sourceRun.id).status, "running");
  assert.equal(unread.countUnreadRuns(fixture.group.id), 0);

  createRunRepository(fixture.db).completeRun(fixture.sourceRun.id, "2026-10-16T02:01:00.000Z");
  const events = createEventRepository(fixture.db);
  events.appendEvent({
    id: "completion-notice",
    entityType: "run",
    entityId: fixture.sourceRun.id,
    type: "final_message",
    payload: { runId: fixture.sourceRun.id, text: "The requested work is complete." },
    idempotencyKey: "completion-notice",
    createdAt: "2026-10-16T02:01:00.000Z",
  });
  events.appendEvent({
    id: "run-completed-event",
    entityType: "run",
    entityId: fixture.sourceRun.id,
    type: "run.completed",
    payload: { runId: fixture.sourceRun.id },
    idempotencyKey: "run-completed-event",
    createdAt: "2026-10-16T02:01:00.000Z",
  });

  assert.equal(unread.countUnreadRuns(fixture.group.id), 1);
  assert.throws(
    () => createRunRepository(fixture.db).completeRun(fixture.sourceRun.id, "2026-10-16T02:02:00.000Z"),
    /not running|completed/i,
  );
  assert.equal(unread.countUnreadRuns(fixture.group.id), 1);
});

test("group read advances the persisted run cursor independently from message reads", (t) => {
  const fixture = createExecutionFixture();
  t.after(() => fixture.db.close());
  const unread = createUnreadRepository(fixture.db);
  createRunRepository(fixture.db).completeRun(fixture.sourceRun.id, "2026-10-16T02:01:00.000Z");

  assert.equal(unread.countUnreadRuns(fixture.group.id), 1);
  markGroupRunsRead(fixture.db, fixture.group.id);
  assert.equal(unread.countUnreadRuns(fixture.group.id), 0);
  assert.equal(unread.getGroupRunReadCursor(fixture.group.id), unread.listRunCompletions(fixture.group.id)[0].cursor);
  fixture.db.prepare(`
    INSERT INTO unread_cursors (contact_id, conversation_id, updated_at)
    VALUES ('developer', ?, '2026-10-16T02:02:00.000Z')
  `).run(fixture.conversation.id);
  assert.equal(unread.getGroupRunReadCursor(fixture.group.id), 1);
});

test("renders large unread counts with a 99+ cap and an accessible label", () => {
  const markup = renderToStaticMarkup(React.createElement(UnreadBadge, { count: 105 }));
  assert.match(markup, />99\+</);
  assert.match(markup, /aria-label="105 unread runs"/);
});

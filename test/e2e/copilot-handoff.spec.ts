import assert from "node:assert/strict";
import path from "node:path";
import Database from "better-sqlite3";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  fauxAssistantMessage,
  fauxProvider,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { expect, test } from "@playwright/test";
import { createGroupMessageService } from "../../src/server/services/handoff-service.ts";
import { createHandoffService } from "../../src/server/services/handoff-service.ts";
import { createTraceQueryService } from "../../src/server/services/trace-query-service.ts";
import { createSessionRepository } from "../../src/server/db/repositories/session-repository.ts";
import { createWorkQueue } from "../../src/server/scheduler/work-queue.ts";

const dataDir = process.env.ACHAT_E2E_DATA_DIR ?? path.join(
  process.cwd(),
  ".superpowers",
  "sdd",
  "2026-10-15-achat-poc-v1",
  "task-10-e2e-data",
);

function openE2eDatabase() {
  assert.ok(dataDir, "Playwright must provide an isolated ACHAT_E2E_DATA_DIR");
  return new Database(path.join(dataDir, "achat.sqlite"));
}

test("local launch explains project registration, Copilot setup, and the browser/server boundary", async ({ page }) => {
  await page.route("**/api/contacts", (route) =>
    route.fulfill({ json: { contacts: [] } }));
  await page.route("**/api/models", (route) =>
    route.fulfill({ json: { models: [] } }));
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Start with a local project root." }))
    .toBeVisible();
  await expect(page.getByText(/sign in to GitHub Copilot using Pi's shared login/i))
    .toBeVisible();
  await expect(page.getByText(/selected project's shared root.*not a filesystem sandbox/i))
    .toBeVisible();
  await expect(page.getByText(/closing the browser disconnects live updates but does not stop Pi execution/i))
    .toBeVisible();
});

test("Developer and Test complete a Feature through explicit, contact-isolated handoffs", async ({ page }) => {
  const db = openE2eDatabase();
  const faux = fauxProvider({
    provider: "github-copilot",
    models: [{ id: "offline-demo-model", name: "Offline demo model" }],
  });
  const fauxModel = faux.getModel("offline-demo-model");
  assert.ok(fauxModel);
  let queueCalls = 0;
  try {
    await page.route("**/api/models", (route) =>
      route.fulfill({ json: { models: [] } }));
    await page.goto("/groups/group-demo");

    await expect(page.getByRole("heading", { name: "Feature" })).toBeVisible();
    await expect(page.getByText("No task description yet. Add one before the first work trigger."))
      .toBeVisible();
    await expect(page.getByText("No work has been dispatched. Mention a member with @contact or use @all."))
      .toBeVisible();

    const itemCountBefore = Number((db.prepare(
      "SELECT COUNT(*) AS count FROM work_items WHERE task_id = 'task-demo'",
    ).get() as { count: number }).count);
    const runCountBefore = Number((db.prepare(
      "SELECT COUNT(*) AS count FROM runs WHERE task_id = 'task-demo'",
    ).get() as { count: number }).count);

    await page.getByRole("textbox", { name: "Message task members" })
      .fill("@Developer implement the Feature and ask Test to verify it.");
    await page.getByRole("button", { name: "Send to group" }).click();
    await expect(page.locator("p.form-error[role='alert']"))
      .toContainText(/task description is required/i);
    assert.equal(Number((db.prepare(
      "SELECT COUNT(*) AS count FROM work_items WHERE task_id = 'task-demo'",
    ).get() as { count: number }).count), itemCountBefore);
    assert.equal(Number((db.prepare(
      "SELECT COUNT(*) AS count FROM runs WHERE task_id = 'task-demo'",
    ).get() as { count: number }).count), runCountBefore);
    assert.equal(queueCalls, 0, "a blank description must not prompt a model session");
    assert.equal(faux.state.callCount, 0, "a blank description must not make a faux provider request");

    db.prepare("UPDATE tasks SET description = ? WHERE id = ?")
      .run("Implement the Feature, verify the fix, and report completion.", "task-demo");
    await page.route("**/api/groups/group-demo/messages", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      const body = route.request().postDataJSON() as { content: string };
      const result = await createGroupMessageService(db).sendGroupMessage("group-demo", body);
      await route.fulfill({ status: 201, json: result });
    });
    await page.reload();
    await expect(page.getByText("Implement the Feature, verify the fix, and report completion."))
      .toBeVisible();
    await page.getByRole("textbox", { name: "Message task members" })
      .fill("@Developer implement the Feature and ask Test to verify it.");
    await page.getByRole("button", { name: "Send to group" }).click();

    const sourceItem = db.prepare(`
      SELECT id FROM work_items
      WHERE task_id = 'task-demo' AND contact_id = 'developer'
      ORDER BY created_at DESC, id DESC LIMIT 1
    `).get() as { id: string } | undefined;
    assert.ok(sourceItem, "the explicit @Developer message should create Developer work");

    let queue: ReturnType<typeof createWorkQueue>;
    let handoffSequence = 0;
    const sessions = createSessionRepository(db);
    const handoffs = createHandoffService(db, {
      idFactory: () => `demo-handoff-${++handoffSequence}`,
      enqueueWorkItem: (workItemId) => queue.enqueueWorkItem(workItemId),
    });
    let eventSequence = 0;
    let clock = Date.now() + 2_000;
    queue = createWorkQueue({
      db,
      idFactory: () => `demo-run-event-${++eventSequence}`,
      now: () => new Date(clock++).toISOString(),
      createContactSession: async (contactId, options) => {
        queueCalls += 1;
        let mapping = sessions.getSessionMappingForContact(contactId, options.taskId);
        if (!mapping) {
          const conversation = db.prepare(`
            SELECT id FROM conversations WHERE kind = 'task' AND task_id = ?
            ORDER BY created_at, id LIMIT 1
          `).get(options.taskId) as { id: string } | undefined;
          assert.ok(conversation);
          mapping = sessions.createSessionMapping({
            id: `demo-mapping-${contactId}`,
            contactId,
            taskId: options.taskId,
            conversationId: conversation.id,
            kind: "task",
            piSessionId: `pi-${contactId}-feature`,
            sessionFile: path.join(dataDir!, "sessions", contactId, "feature.jsonl"),
          });
        }
        const recipientAgentId = options.handoffDepth === 0 || options.handoffDepth === 2
          ? "tester"
          : "developer";
        const scriptedText = options.handoffDepth === 0
          ? "Developer progress: Feature implementation is ready for testing."
          : options.handoffDepth === 1
            ? "Test found a bug: empty input was not handled; handing the reproduction back."
            : options.handoffDepth === 2
              ? "Developer fixed the empty-input bug and requested a retest."
              : "Test passed after the fix. @user, the Feature is complete.";
        const handoff = options.handoffDepth < 3
          ? {
              recipientAgentId,
              instruction: options.handoffDepth === 0
                ? "Test the Feature and report any bug."
                : options.handoffDepth === 1
                  ? "Fix the empty-input bug reported by Test."
                  : "Retest the fixed Feature and report pass or fail.",
              expectedOutput: options.handoffDepth === 1
                ? "A fix and a summary of the changed behavior."
                : "A focused test result and any reproduction steps.",
            }
          : undefined;
        const listeners = new Set<(event: unknown) => void>();
        const emit = (event: unknown) => {
          for (const listener of listeners) listener(event);
        };
        const session = {
          messages: [],
          subscribe(listener: (event: unknown) => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          async prompt(promptText: string) {
            faux.setResponses([fauxAssistantMessage(scriptedText)]);
            const response = await faux.provider.streamSimple(fauxModel, {
              messages: [{ role: "user", content: promptText, timestamp: Date.now() }],
            } as unknown as TranscriptContext).result();
            const finalText = response.content
              .filter((block) => block.type === "text")
              .map((block) => block.text)
              .join("");
            emit({
              type: "message_update",
              assistantMessageEvent: { type: "text_delta", delta: finalText },
            });
            emit({
              type: "tool_execution_start",
              toolName: "read",
              toolCallId: `demo-read-${options.handoffDepth}`,
              args: { path: "src/feature.ts" },
            });
            emit({
              type: "tool_execution_end",
              toolName: "read",
              toolCallId: `demo-read-${options.handoffDepth}`,
              result: [{ type: "text", text: "Feature source inspected." }],
              isError: false,
            });
            if (handoff) {
              emit({
                type: "tool_execution_start",
                toolName: "delegate_to_member",
                toolCallId: `demo-delegate-${options.handoffDepth}`,
                args: { recipientAgentId, instruction: handoff.instruction },
              });
              const run = db.prepare(
                "SELECT id FROM runs WHERE work_item_id = ? ORDER BY attempt DESC LIMIT 1",
              ).get(options.workItemId) as { id: string };
              const sourceAgent = db.prepare(
                "SELECT agent_id AS agentId FROM contacts WHERE id = ?",
              ).get(contactId) as { agentId: string };
              await handoffs.enqueueHandoff({
                sourceAgentId: sourceAgent.agentId,
                sourceContactId: contactId,
                taskId: options.taskId,
                sourcePiSessionId: mapping!.piSessionId,
                sourceRunId: run.id,
                handoffDepth: options.handoffDepth,
              }, {
                ...handoff,
                toolCallId: `demo-delegate-${options.handoffDepth}`,
              });
              emit({
                type: "tool_execution_end",
                toolName: "delegate_to_member",
                toolCallId: `demo-delegate-${options.handoffDepth}`,
                result: [{ type: "text", text: `Queued to ${recipientAgentId}.` }],
                isError: false,
              });
            }
            const message = {
              role: "assistant",
              content: [{ type: "text", text: finalText }],
            };
            emit({ type: "message_end", message });
            emit({ type: "agent_end", aborted: false });
          },
          abort() {},
          dispose() {},
        };
        return session as unknown as AgentSession;
      },
    });

    await queue.start();
    await queue.enqueueWorkItem(sourceItem.id);
    await queue.drain();
    assert.equal(queueCalls, 4, "the deterministic provider should complete all four handoff steps");
    assert.equal(faux.state.callCount, 4, "each contact run should use the local faux provider");

    await page.reload();
    await expect(page.getByRole("heading", { name: "Feature" })).toBeVisible();
    await expect(page.getByText("@Developer → @Test: Test the Feature and report any bug."))
      .toBeVisible();
    await expect(page.getByText("@Test → @Developer: Fix the empty-input bug reported by Test."))
      .toBeVisible();
    await expect(page.getByText("@Developer → @Test: Retest the fixed Feature and report pass or fail."))
      .toBeVisible();
    const conversation = page.getByRole("list", { name: "Feature conversation" });
    await expect(conversation.getByText(/Test found a bug: empty input was not handled/))
      .toBeVisible();
    await expect(conversation.getByText(/Test passed after the fix\. @user, the Feature is complete\./))
      .toBeVisible();
    await expect(page.getByRole("heading", { name: "Runs" })).toBeVisible();
    await expect(page.getByText("Feature source inspected.").first()).toBeVisible();

    const developerTask = await page.request.get(
      "/api/contacts/developer/sessions?taskId=task-demo",
    );
    const testerTask = await page.request.get(
      "/api/contacts/tester/sessions?taskId=task-demo",
    );
    assert.equal(developerTask.status(), 200);
    assert.equal(testerTask.status(), 200);
    const developerSessionRefs = (await developerTask.json()).items[0].sessionRefs as string[];
    const testerSessionRefs = (await testerTask.json()).items[0].sessionRefs as string[];
    assert.deepEqual(developerSessionRefs, ["pi-developer-feature"]);
    assert.deepEqual(testerSessionRefs, ["pi-tester-feature"]);
    assert.notDeepEqual(developerSessionRefs, testerSessionRefs);

    const traceQueries = createTraceQueryService(db);
    const developerTrace = await traceQueries.readContactSession(
      "developer",
      "pi-developer-feature",
      { taskId: "task-demo" },
    );
    const testerTrace = await traceQueries.readContactSession(
      "tester",
      "pi-tester-feature",
      { taskId: "task-demo" },
    );
    assert.ok(developerTrace.items.length > 0);
    assert.ok(testerTrace.items.length > 0);
    const runIds = db.prepare(`
      SELECT id, contact_id AS contactId FROM runs WHERE task_id = 'task-demo'
    `).all() as Array<{ id: string; contactId: string }>;
    const developerRunIds = runIds.filter(({ contactId }) => contactId === "developer")
      .map(({ id }) => id);
    const testerRunIds = runIds.filter(({ contactId }) => contactId === "tester")
      .map(({ id }) => id);
    const tracedRuns = (items: typeof developerTrace.items) => items.flatMap(({ type, payload }) => {
      if (type !== "achat_event" || typeof payload !== "object" || payload === null) return [];
      const event = payload as { type?: unknown; payload?: unknown };
      if (event.type !== "run.started" || typeof event.payload !== "object" || event.payload === null) {
        return [];
      }
      const run = event.payload as { runId?: unknown; contactId?: unknown };
      return typeof run.runId === "string" && typeof run.contactId === "string"
        ? [{ runId: run.runId, contactId: run.contactId }]
        : [];
    });
    assert.equal(developerRunIds.length, 2);
    assert.equal(testerRunIds.length, 2);
    assert.deepEqual(
      tracedRuns(developerTrace.items),
      developerRunIds.map((runId) => ({ runId, contactId: "developer" })),
    );
    assert.deepEqual(
      tracedRuns(testerTrace.items),
      testerRunIds.map((runId) => ({ runId, contactId: "tester" })),
    );
    assert.ok(developerTrace.items.every(({ sessionRef }) => sessionRef === "pi-developer-feature"));
    assert.ok(testerTrace.items.every(({ sessionRef }) => sessionRef === "pi-tester-feature"));
    await assert.rejects(
      traceQueries.readContactSession("developer", "pi-tester-feature"),
      /not authorized/i,
    );
    const traces = db.prepare("SELECT payload_json FROM trace_records").all() as Array<{
      payload_json: string;
    }>;
    assert.ok(traces.every(({ payload_json }) =>
      !/\bAuthorization\b|\bBearer\s+\S+|(?:access|refresh|api)[_-]?token\s*:/i.test(payload_json)));
  } finally {
    db.close();
  }
});

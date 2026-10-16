import assert from "node:assert/strict";
import path from "node:path";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { expect, test } from "@playwright/test";
import { createRecoveryService } from "../../src/server/lifecycle/recovery.ts";
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

test("an interrupted run waits for an explicit retry, and Feature bug search opens its message", async ({ page }) => {
  const db = openE2eDatabase();
  let retryRequests = 0;
  try {
    await page.route("**/api/models", (route) =>
      route.fulfill({ json: { models: [] } }));
    await page.goto("/groups/group-recovery");
    await expect(page.getByRole("heading", { name: "Recovery fixture" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Run status" })
      .getByText("interrupted", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry interrupted work" })).toBeVisible();

    const initialRuns = Number((db.prepare(
      "SELECT COUNT(*) AS count FROM runs WHERE task_id = 'task-recovery'",
    ).get() as { count: number }).count);
    assert.equal(initialRuns, 1, "startup recovery must not replay interrupted work");

    await page.route("**/api/tasks/task-recovery/retry", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      retryRequests += 1;
      const queue = createWorkQueue({
        db,
        idFactory: (() => {
          let id = 0;
          return () => `manual-retry-event-${++id}`;
        })(),
        createContactSession: async () => {
          const listeners = new Set<(event: unknown) => void>();
          return {
            messages: [],
            subscribe(listener: (event: unknown) => void) {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
            async prompt() {
              const message = {
                role: "assistant",
                content: [{ type: "text", text: "Explicit retry completed without replaying prior side effects." }],
              };
              for (const listener of listeners) {
                listener({
                  type: "message_update",
                  assistantMessageEvent: {
                    type: "text_delta",
                    delta: "Explicit retry completed without replaying prior side effects.",
                  },
                });
                listener({ type: "message_end", message });
                listener({ type: "agent_end", aborted: false });
              }
            },
            abort() {},
            dispose() {},
          } as unknown as AgentSession;
        },
      });
      const recovery = createRecoveryService(db, {
        runWorkItem: (workItemId) => queue.runTaskWorkItem(workItemId),
        hasSessionFile: existsSync,
      });
      try {
        const runs = await recovery.retryInterruptedWork("task-recovery");
        await route.fulfill({ status: 200, json: { runs } });
      } catch (error) {
        await route.fulfill({
          status: 409,
          json: { error: error instanceof Error ? error.message : "Retry failed" },
        });
      }
    });
    await page.getByRole("button", { name: "Retry interrupted work" }).click();
    await expect(page.getByRole("list", { name: "Recovery fixture conversation" })
      .getByText("Explicit retry completed without replaying prior side effects.", { exact: true }))
      .toBeVisible();
    assert.equal(retryRequests, 1, "retry should only start after the explicit user action");
    assert.equal(Number((db.prepare(
      "SELECT COUNT(*) AS count FROM runs WHERE task_id = 'task-recovery'",
    ).get() as { count: number }).count), initialRuns + 1);

    await page.goto("/contacts/developer");
    await page.getByRole("searchbox", { name: "Search messages and tasks" }).fill("Feature bug");
    await page.getByRole("button", { name: "Search" }).click();
    const result = page.getByRole("link", { name: /Feature triage/ });
    await expect(result).toContainText("1 matching message");
    await expect(result).toContainText("Feature bug: the input edge case is reproducible.");
    await result.click();
    await expect(page).toHaveURL(/\/groups\/group-feature#message-feature-bug$/);
    await expect(page.locator("#message-feature-bug")).toBeInViewport();
  } finally {
    db.close();
  }
});

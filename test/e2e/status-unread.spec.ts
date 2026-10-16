import assert from "node:assert/strict";
import { expect, test } from "@playwright/test";
import path from "node:path";
import Database from "better-sqlite3";
import { createEventRepository } from "../../src/server/db/repositories/event-repository.ts";
import { createRunRepository } from "../../src/server/db/repositories/run-repository.ts";
import { createWorkItemRepository } from "../../src/server/db/repositories/work-item-repository.ts";
import { createUnreadRepository } from "../../src/server/db/repositories/unread-repository.ts";

const dataDir = path.join(
  process.cwd(),
  ".superpowers",
  "sdd",
  "2026-10-15-achat-poc-v1",
  "task-7-e2e-data",
);

test("live completion updates execution and unread independently, and group read persists", async ({ page }) => {
  await page.route("**/api/contacts", (route) => route.fulfill({
    json: {
      contacts: [{
        id: "contact-1",
        name: "Builder",
        description: "E2E contact",
        modelProvider: "github-copilot",
        modelId: "test-model",
      }],
    },
  }));
  await page.route("**/api/models", (route) => route.fulfill({ json: { models: [] } }));
  await page.goto("/groups/group-1");

  await expect(page.getByRole("heading", { name: "Status test group" })).toBeVisible();
  await expect(page.getByText("Live activity connected")).toBeVisible();
  await expect(page.getByText("Running", { exact: true })).toBeVisible();
  await expect(page.getByLabel("No unread runs")).toBeVisible();

  const db = new Database(path.join(dataDir, "achat.sqlite"));
  try {
    createRunRepository(db).completeRun("run-1", "2026-10-16T02:01:00.000Z");
    createWorkItemRepository(db).updateWorkItemStatus(
      "work-item-1",
      "completed",
      "2026-10-16T02:01:00.000Z",
    );
    createEventRepository(db).appendEvent({
      id: "run-1-completed",
      entityType: "run",
      entityId: "run-1",
      type: "run.completed",
      payload: {
        runId: "run-1",
        taskId: "task-1",
        workItemId: "work-item-1",
        contactId: "contact-1",
      },
      idempotencyKey: "run-1-completed",
      createdAt: "2026-10-16T02:01:00.000Z",
    });
  } finally {
    db.close();
  }

  await expect(page.getByLabel("1 unread runs")).toBeVisible();
  await expect(page.getByText("completed", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("open", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Mark runs read" }).click();
  await expect(page.getByLabel("No unread runs")).toBeVisible();
  const readDb = new Database(path.join(dataDir, "achat.sqlite"));
  try {
    assert.equal(createUnreadRepository(readDb).getGroupRunReadCursor("group-1"), 1);
  } finally {
    readDb.close();
  }
});

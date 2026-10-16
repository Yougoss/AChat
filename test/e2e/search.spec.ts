import assert from "node:assert/strict";
import { expect, test } from "@playwright/test";

test("contact-scoped search excludes unauthorized content and opens the matching message", async ({ page }) => {
  await page.route("**/api/contacts", (route) => route.fulfill({
    json: {
      contacts: [
        {
          id: "contact-1",
          name: "Builder",
          description: "Task member",
          modelProvider: "github-copilot",
          modelId: "test-model",
        },
        {
          id: "contact-2",
          name: "Reviewer",
          description: "Other contact",
          modelProvider: "github-copilot",
          modelId: "test-model",
        },
      ],
    },
  }));
  await page.route("**/api/models", (route) => route.fulfill({ json: { models: [] } }));
  await page.goto("/contacts/contact-1");

  await page.getByRole("searchbox", { name: "Search messages and tasks" }).fill("orchid-search-token");
  await page.getByRole("button", { name: "Search" }).click();
  const result = page.getByRole("link", { name: /AChat Task Result/ });
  await expect(result).toContainText("1 matching message");
  await expect(result).toContainText("orchid-search-token lands on this visible task message");
  await expect(page.getByText(/unauthorized preview|unauthorized private preview/i)).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Restricted Task/ })).toHaveCount(0);

  const response = await page.request.get(
    "/api/search?q=orchid-search-token&contactId=contact-1",
  );
  assert.equal(response.status(), 200);
  const { results } = await response.json() as {
    results: Array<{ ownerId: string; messageId: string; matchingMessageCount: number }>;
  };
  assert.deepEqual(results.map(({ ownerId, messageId, matchingMessageCount }) => ({
    ownerId,
    messageId,
    matchingMessageCount,
  })), [{
    ownerId: "group-search",
    messageId: "task-search-hit",
    matchingMessageCount: 1,
  }]);

  await result.click();
  await expect(page).toHaveURL(/\/groups\/group-search#message-task-search-hit$/);
  await expect(page.locator("#message-task-search-hit")).toBeInViewport();
});

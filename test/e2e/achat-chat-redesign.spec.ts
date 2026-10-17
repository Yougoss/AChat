import { expect, test, type Page } from "@playwright/test";

const contact = {
  id: "contact-1",
  name: "Ada",
  description: "Private assistant",
  modelProvider: "github-copilot",
  modelId: "offline-model",
};

const assistantMessage = {
  id: "assistant-reply",
  role: "assistant",
  content: "The requested change is ready.",
  metadata: {},
  createdAt: "2026-10-16T10:01:00.000Z",
};

async function mockWorkspace(page: Page) {
  await page.route("**/api/conversations", (route) => route.fulfill({
    json: {
      items: [
        {
          kind: "contact",
          id: "contact-1",
          title: "Ada",
          preview: "The requested change is ready.",
          updatedAt: "2026-10-16T10:01:00.000Z",
          href: "/contacts/contact-1",
          avatarText: "A",
          unreadCount: 0,
        },
        {
          kind: "task",
          id: "group-demo",
          title: "Feature",
          preview: "Task discussion",
          updatedAt: "2026-10-16T10:00:00.000Z",
          href: "/groups/group-demo",
          avatarText: "F",
          unreadCount: 0,
        },
      ],
    },
  }));
  await page.route("**/api/models", (route) => route.fulfill({
    json: {
      models: [{
        provider: "github-copilot",
        modelId: "offline-model",
        name: "Offline model",
      }],
    },
  }));
  await page.route("**/api/contacts/contact-1", (route) => route.fulfill({
    json: { contact },
  }));
  await page.route("**/api/contacts/contact-1/messages", (route) => route.fulfill({
    json: {
      messages: [
        {
          id: "user-message",
          role: "user",
          content: "Please inspect the change.",
          createdAt: "2026-10-16T10:00:00.000Z",
        },
        assistantMessage,
      ],
      processSummaries: {
        "assistant-reply": { messageCount: 1, models: ["offline-model"] },
      },
    },
  }));
  await page.route("**/api/contacts/contact-1/messages/assistant-reply/process", (route) =>
    route.fulfill({
      json: {
        events: [{
          id: "event-read",
          kind: "tool_result",
          label: "Read source file",
          detail: "src/app/page.tsx",
          createdAt: "2026-10-16T10:00:30.000Z",
        }],
      },
    }));
}

test("root, mobile list return, and task information remain accessible", async ({ page }) => {
  await mockWorkspace(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("html")).toHaveCSS("scroll-behavior", "auto");

  await expect(page.getByRole("navigation", { name: "Conversation list" })).toBeVisible();
  await expect(page.getByRole("main", { name: "No conversation selected" })).toBeVisible();
  await page.getByRole("link", { name: /Feature/ }).click();
  await expect(page.getByRole("heading", { name: "Feature" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Conversation list" })).not.toBeVisible();

  const backLink = page.getByRole("link", { name: "Back to conversations" });
  await expect(backLink).toBeVisible();
  await backLink.click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("navigation", { name: "Conversation list" })).toBeVisible();

  await page.getByRole("link", { name: /Feature/ }).click();
  const taskInformation = page.locator(".task-information > summary");
  await expect(taskInformation).toBeVisible();
  await expect(taskInformation).toHaveAttribute("aria-label", "Task information");
  await backLink.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Add task description" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Refresh activity" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(taskInformation).toBeFocused();
  await expect(taskInformation).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await expect(page.locator(".task-information")).toHaveAttribute("open", "");
  await expect(page.getByRole("heading", { name: "Run history" })).toBeVisible();
});

test("private process details and contact settings remain available", async ({ page }) => {
  await mockWorkspace(page);
  await page.goto("/");
  await page.getByRole("link", { name: /Ada/ }).click();
  await expect(page.getByRole("heading", { name: "Ada" })).toBeVisible();

  const processToggle = page.locator(".process-details-toggle");
  await processToggle.focus();
  await expect(processToggle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(processToggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Read source file")).toBeVisible();

  await page.getByRole("link", { name: "Contact settings" }).click();
  await expect(page.getByRole("heading", { name: "Ada" })).toBeVisible();
  await expect(page.getByText("Current model")).toBeVisible();
  await expect(page.getByText("Provider access", { exact: true })).toBeVisible();
});

test("project settings preserve required fields and server validation errors", async ({ page }) => {
  await mockWorkspace(page);
  await page.route("**/api/contacts/contact-1/task-draft", (route) => route.fulfill({
    json: { draft: { name: "Task from conversation", description: "Please inspect the change." } },
  }));
  await page.route("**/api/projects", (route) => route.request().method() === "GET"
    ? route.fulfill({ json: { projects: [] } })
    : route.fulfill({
        status: 400,
        json: { error: "The selected directory does not exist." },
      }));
  await page.goto("/");
  await page.getByRole("link", { name: /Ada/ }).click();
  await page.getByRole("button", { name: "Draft a task from this conversation" }).click();
  await page.getByRole("link", { name: "Register a project" }).click();
  await expect(page).toHaveURL("/settings/projects");

  await expect(page.getByRole("heading", { name: "Registered projects" })).toBeVisible();
  await expect(page.getByLabel("Project name")).toHaveAttribute("required", "");
  await expect(page.getByLabel("Existing directory path")).toHaveAttribute("required", "");
  await page.getByLabel("Project name").fill("Missing project");
  await page.getByLabel("Existing directory path").fill("/does/not/exist");
  await page.getByRole("button", { name: "Register project" }).click();
  await expect(page.locator(".form-error[role='alert']")).toHaveText("The selected directory does not exist.");
});

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
  await page.route("**/api/contacts/contact-1/sessions?*", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    if (cursor) await new Promise((resolve) => setTimeout(resolve, 400));
    return route.fulfill({
      json: cursor
        ? {
            items: [{
              taskId: "task-evidence-2",
              title: "Second evidence page",
              lastActivity: "2026-10-16T10:00:00.000Z",
              status: "completed",
              sessionRefs: [],
            }],
          }
        : {
            items: [{
              taskId: "task-evidence-1",
              title: "First evidence page",
              lastActivity: "2026-10-16T10:00:00.000Z",
              status: "completed",
              sessionRefs: ["pi-session-1"],
            }],
            nextCursor: "page-2",
          },
    });
  });
}

test("root, mobile list return, and task information remain accessible", async ({ page }) => {
  await mockWorkspace(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator("html")).toHaveCSS("scroll-behavior", "auto");

  await expect(page.getByRole("navigation", { name: "Conversation list" })).toBeVisible();
  await expect(page.getByRole("main", { name: "No conversation selected" })).toBeVisible();
  await expect(page.getByRole("main", { name: "No conversation selected" })).toBeEmpty();
  await expect(page.getByRole("heading", { name: "Conversations" })).toBeVisible();
  await expect(page.getByRole("link", { name: /dispatch desk/i })).toHaveCount(0);
  expect(await page.locator(".workspace-shell").evaluate((shell) => {
    const styles = getComputedStyle(shell);
    return {
      columns: styles.gridTemplateColumns.split(" ")[0],
      list: styles.getPropertyValue("--list").trim(),
      paper: styles.getPropertyValue("--paper").trim(),
      thread: styles.getPropertyValue("--thread").trim(),
      ink: styles.getPropertyValue("--ink").trim(),
      muted: styles.getPropertyValue("--muted").trim(),
      line: styles.getPropertyValue("--line").trim(),
      green: styles.getPropertyValue("--green").trim(),
      outgoing: styles.getPropertyValue("--outgoing").trim(),
      incoming: styles.getPropertyValue("--incoming").trim(),
      code: styles.getPropertyValue("--code").trim(),
    };
  })).toEqual({
    columns: "280px",
    list: "#2d2f30",
    paper: "#202223",
    thread: "#1b1d1e",
    ink: "#f1f2f1",
    muted: "#a0a4a4",
    line: "#3e4142",
    green: "#07c160",
    outgoing: "#173d2d",
    incoming: "#303334",
    code: "#292b2c",
  });
  const title = page.getByRole("heading", { name: "Conversations" });
  const search = page.getByRole("search");
  const filters = page.getByRole("group", { name: "Filter conversations" });
  const list = page.getByRole("navigation", { name: "Conversation list" });
  await expect(title).toBeVisible();
  expect(await title.evaluate((element, selectors) => {
    const next = element.closest(".roster-heading")?.nextElementSibling;
    return next?.matches(selectors.search)
      && next.nextElementSibling?.matches(selectors.filters)
      && next.nextElementSibling.nextElementSibling?.matches(selectors.list);
  }, {
    search: ".workspace-search",
    filters: ".conversation-filters",
    list: ".contact-roster",
  })).toBe(true);

  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.screenshot({ path: test.info().outputPath("task-1-root-1440x900.png") });
  await page.setViewportSize({ width: 390, height: 844 });
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
  await expect(taskInformation).not.toHaveAttribute("aria-label");
  await expect(taskInformation).toHaveAccessibleName(/Task information/);
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
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("link", { name: /Ada/ }).click();
  await expect(page.getByRole("heading", { name: "Ada" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to conversations" })).toBeHidden();
  const contactHeader = page.locator(".conversation-header");
  await expect(contactHeader).toContainText("Private contact channel");
  await expect(contactHeader).not.toContainText("Private assistant");
  await expect(contactHeader.getByRole("link", { name: "Contact settings" })).toHaveCount(1);
  await expect(page.locator(".conversation-thread")).toHaveCSS("background-color", "rgb(27, 29, 30)");
  await expect(page.locator(".message-user")).toHaveCSS("background-color", "rgb(23, 61, 45)");
  await expect(page.locator(".message-assistant")).toHaveCSS("background-color", "rgb(48, 51, 52)");
  await expect(page.locator(".process-details-card")).toHaveCSS("background-color", "rgb(41, 43, 44)");
  const evidenceDisclosure = page.locator("details.contact-session-evidence");
  await expect(evidenceDisclosure).toBeVisible();
  await expect(evidenceDisclosure).not.toHaveAttribute("open", "");
  await expect(evidenceDisclosure).toContainText("Session evidence");
  const conversationThread = page.locator(".conversation-thread");
  await expect(conversationThread).toContainText("The requested change is ready.");
  await expect(conversationThread).toContainText("Session evidence");
  await expect(conversationThread).toHaveCSS("overflow-y", "auto");
  const composer = page.locator(".message-composer");
  expect(await composer.evaluate((form) => form.parentElement?.lastElementChild === form)).toBe(true);
  const composerBox = await composer.boundingBox();
  const contentBox = await page.locator(".workspace-content").boundingBox();
  expect(composerBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  expect(composerBox!.y + composerBox!.height).toBeGreaterThan(contentBox!.y + contentBox!.height - 80);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.screenshot({ path: test.info().outputPath("task-1-contact-1440x900.png") });

  await evidenceDisclosure.locator(":scope > summary").click();
  await expect(page.getByRole("heading", { name: "Evidence from your sessions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "First evidence page" })).toBeVisible();
  const expandedComposerBox = await composer.boundingBox();
  expect(expandedComposerBox).not.toBeNull();
  expect(expandedComposerBox!.y + expandedComposerBox!.height).toBeGreaterThan(contentBox!.y + contentBox!.height - 80);
  await page.screenshot({ path: test.info().outputPath("task-1-contact-evidence-open-1440x900.png") });
  await page.getByText("Pi session references (1)").click();
  await expect(page.getByText("pi-session-1")).toBeVisible();
  const loadMore = page.getByRole("button", { name: "Load more results" });
  await loadMore.click();
  await expect(page.getByRole("button", { name: "Loading…" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Second evidence page" })).toBeVisible();

  await page.setViewportSize({ width: 650, height: 844 });
  await expect(page.getByRole("navigation", { name: "Conversation list" })).toBeVisible();
  expect(await page.locator(".workspace-shell").evaluate((shell) =>
    Number.parseFloat(getComputedStyle(shell).gridTemplateColumns))).toBe(220);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("navigation", { name: "Conversation list" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Back to conversations" })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });

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

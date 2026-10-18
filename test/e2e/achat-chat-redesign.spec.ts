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
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.screenshot({ path: test.info().outputPath("task-3-root-1440x900.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("navigation", { name: "Conversation list" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("task-3-root-390x844.png") });
  await page.setViewportSize({ width: 650, height: 844 });
  await expect.poll(() => page.locator(".workspace-shell").evaluate((shell) =>
    Number.parseFloat(getComputedStyle(shell).gridTemplateColumns))).toBe(220);
  await page.setViewportSize({ width: 1440, height: 900 });
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
  await page.setViewportSize({ width: 1440, height: 900 });
  const taskHeader = page.locator(".conversation-header");
  await expect(taskHeader.getByRole("heading", { name: "Feature" })).toBeVisible();
  await expect(taskHeader).toContainText("Task group");
  await expect(taskHeader.getByRole("button", { name: "Task information" })).toHaveCount(1);
  const taskInformation = taskHeader.getByRole("button", { name: "Task information" });
  await expect(page.locator(".task-information-drawer")).toHaveCount(0);
  await expect(taskHeader).not.toContainText("Private assistant");
  await page.screenshot({ path: test.info().outputPath("task-3-task-closed-1440x900.png") });

  await page.setViewportSize({ width: 650, height: 844 });
  await expect(page.getByRole("navigation", { name: "Conversation list" })).toBeVisible();
  await expect.poll(() => page.locator(".workspace-shell").evaluate((shell) =>
    Number.parseFloat(getComputedStyle(shell).gridTemplateColumns))).toBe(220);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("navigation", { name: "Conversation list" })).toBeHidden();
  await expect(backLink).toBeVisible();
  const participantSubtitle = taskHeader.locator(".conversation-subtitle");
  const participantMarkup = await participantSubtitle.evaluate((element) => element.innerHTML);
  await participantSubtitle.evaluate((element) => {
    element.textContent = `Task group · ${"Persisted participant name ".repeat(8)}`;
  });
  const participantBox = await participantSubtitle.boundingBox();
  const taskActionBox = await taskInformation.boundingBox();
  expect(participantBox).not.toBeNull();
  expect(taskActionBox).not.toBeNull();
  expect(participantBox!.x + participantBox!.width).toBeLessThanOrEqual(taskActionBox!.x);
  await expect(participantSubtitle).toHaveCSS("text-overflow", "ellipsis");
  await expect(participantSubtitle).toHaveCSS("white-space", "nowrap");
  await participantSubtitle.evaluate((element, markup) => {
    element.innerHTML = markup;
  }, participantMarkup);
  await page.screenshot({ path: test.info().outputPath("task-3-task-closed-390x844.png") });
  await backLink.focus();
  await page.keyboard.press("Tab");
  await expect(taskInformation).toBeFocused();
  await expect(taskInformation).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("complementary", { name: "Task information" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Run history" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("task-3-task-drawer-390x844.png") });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: test.info().outputPath("task-3-task-drawer-1440x900.png") });
});

test("workspace primary action hover uses v6 green while non-workspace hover stays coral", async ({ page }) => {
  await mockWorkspace(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByRole("button", { name: "Close new contact form" })).toBeVisible();
  await page.getByRole("button", { name: "Close new contact form" }).click();
  await expect(page.getByRole("button", { name: "Add contact" })).toBeVisible();
  await page.evaluate(() => {
    const workspaceButton = document.createElement("button");
    workspaceButton.className = "button button-primary";
    workspaceButton.textContent = "Workspace action fixture";
    document.querySelector(".workspace-shell .workspace-content")?.append(workspaceButton);

    const externalButton = document.createElement("button");
    externalButton.className = "button button-primary";
    externalButton.textContent = "External action fixture";
    document.body.append(externalButton);
  });

  const workspaceButton = page.getByRole("button", { name: "Workspace action fixture" });
  await workspaceButton.hover();
  await expect(workspaceButton).toHaveCSS("background-color", "rgb(7, 193, 96)");

  const externalButton = page.getByRole("button", { name: "External action fixture" });
  await externalButton.hover();
  await expect(externalButton).toHaveCSS("background-color", "rgb(183, 83, 68)");
});

test("keeps contact and group composers at the conversation-panel bottom during errors", async ({ page }) => {
  await mockWorkspace(page);
  await page.route("**/api/contacts/contact-1/messages", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 503, json: { error: "Contact message failed" } });
      return;
    }
    await route.fallback();
  });
  await page.route("**/api/groups/group-demo/messages", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 503, json: { error: "Group message failed" } });
      return;
    }
    await route.fallback();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("link", { name: /Ada/ }).click();
  await page.getByRole("textbox", { name: "Message Ada" }).fill("Trigger the contact error.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".form-error[role='alert']")).toHaveText("Contact message failed");

  const assertComposerAtBottom = async () => {
    const panel = page.locator(".conversation-panel");
    const composer = panel.locator(".message-composer");
    expect(await composer.evaluate((form) => form.parentElement?.lastElementChild === form)).toBe(true);
    const panelBox = await panel.boundingBox();
    const composerBox = await composer.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(composerBox).not.toBeNull();
    expect(composerBox!.y + composerBox!.height).toBeGreaterThan(panelBox!.y + panelBox!.height - 80);
  };
  await assertComposerAtBottom();

  await page.goto("/groups/group-demo");
  await page.getByRole("textbox", { name: "Message task members" }).fill("Trigger the group error.");
  await page.getByRole("button", { name: "Send to group" }).click();
  await expect(page.locator(".form-error[role='alert']")).toHaveText("Group message failed");
  await assertComposerAtBottom();
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
  await expect(page.locator(".message-assistant")).toHaveCSS("background-color", "rgb(32, 34, 35)");
  await expect(page.locator(".process-details-summary")).toHaveCSS("background-color", "rgb(32, 34, 35)");
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
  await page.screenshot({ path: test.info().outputPath("task-3-private-1440x900.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: test.info().outputPath("task-3-private-390x844.png") });
  await page.setViewportSize({ width: 1440, height: 900 });

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
  await expect(page.locator(".process-event").first()).toHaveCSS("background-color", "rgb(41, 43, 44)");

  await page.getByRole("link", { name: "Contact settings" }).click();
  await expect(page.getByRole("heading", { name: "Ada" })).toBeVisible();
  await expect(page.getByText("Current model")).toBeVisible();
  await expect(page.getByText("Provider access", { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("task-3-contact-settings-1440x900.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: test.info().outputPath("task-3-contact-settings-390x844.png") });
  await page.setViewportSize({ width: 1440, height: 900 });
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
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.screenshot({ path: test.info().outputPath("task-3-project-registration-1440x900.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: test.info().outputPath("task-3-project-registration-390x844.png") });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel("Project name").fill("Missing project");
  await page.getByLabel("Existing directory path").fill("/does/not/exist");
  await page.getByRole("button", { name: "Register project" }).click();
  await expect(page.locator(".form-error[role='alert']")).toHaveText("The selected directory does not exist.");
  await page.screenshot({ path: test.info().outputPath("task-3-project-registration-validation-1440x900.png") });
});

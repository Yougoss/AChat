# AChat Chat Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current AChat workbench presentation with the approved conversation-first layout while preserving POC behavior and exposing scoped, sanitized Pi process details in expandable replies.

**Architecture:** Keep existing routes and domain workflows. Add a server projection for contact/task process details and a conversation-list projection, then build shared conversation primitives and restyle the existing shell, chat, settings, and task controls around them. Reuse SQLite records, Pi traces, current API conventions, and existing dependencies.

**Tech Stack:** Next.js App Router, React 19, TypeScript, SQLite (`better-sqlite3`), Pi trace records, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-16-achat-chat-redesign.md`

## Global Constraints

- Insert a centered time separator between adjacent messages when their timestamp gap is at least five minutes.
- Every message sent by the user uses one consistent default avatar marked “我”; avatar editing/upload is out of scope.
- The process card is collapsed by default to preserve the chat rhythm.
- Do not expose model reasoning/thinking blocks, raw provider requests/responses, credentials, or content outside the contact/task scope.
- Show available Pi usage only; omit unavailable fields rather than inventing zeroes or sample values.
- Preserve explicit `@contact`/`@all` dispatch semantics and all existing POC actions.
- Do not add dependencies, change existing route paths/business semantics, or add a theme-preference system; the root page's new empty-chat state is intentional.
- Contact/task process queries must enforce ownership and mapping scope on the server.

## Review Focus

- A private assistant reply with no matching Pi trace must render without fabricated usage; test missing trace/partial usage in Task 1.
- A task process query for another group's run must return a not-found/authorization response without leaking event data; test in Task 1.
- Equal-to-five-minute and shorter message gaps must be separated differently; test in Task 3.
- Long or credential-shaped tool output must remain safe and inspectable; test sanitization and disclosure behavior in Tasks 1 and 3.
- Narrow layouts must preserve a route back to the conversation list; test in Task 5.

---

### Task 1: Project scoped process details

**Files:**
- Create: `src/server/services/process-details-service.ts`
- Create: `src/app/api/contacts/[contactId]/messages/[messageId]/process/route.ts`
- Create: `src/app/api/groups/[groupId]/runs/[runId]/process/route.ts`
- Modify: `src/app/api/contacts/[contactId]/messages/route.ts`
- Modify: `src/app/api/groups/[groupId]/messages/route.ts`
- Modify: `src/server/services/message-service.ts`
- Test: `test/services/process-details-service.test.mjs`
- Test: `test/services/message-service.test.mjs`
- Test: `test/api/process-details-routes.test.mjs`

**Interfaces:**
- Produce `ProcessSummary`: assistant `messageCount`, `models`, and optional usage totals (`input`, `output`, `cacheRead`, `cacheWrite`, `cost`).
- Produce `ProcessEvent`: stable `id`, `createdAt`, `kind`, display `label`, safe `detail`, and optional `model`/`durationMs`.
- Produce `ProcessDetails`: `{ summary: ProcessSummary; events: ProcessEvent[] }`.
- Persist `metadata.processTraceRange = { afterSequence: number; throughSequence: number }` on each private assistant message from the trace records emitted for that exact prompt.
- Existing contact/group message responses add process summaries keyed by assistant message ID or run ID. The two new GET detail routes return `ProcessDetails`.
- Consume existing `pi_session_mappings`, append-only `trace_records`, run `events`, message metadata, and current trace sanitizer. Associate task records by persisted run ID and call ID; associate private assistant records by the persisted sequence range within the contact's private mapping, never by text-only matching.

- [ ] **Step 1: Write failing service tests** for task-run event ordering and usage aggregation, exact private trace-range linkage (including identical reply text), absent/partial usage, and long/sensitive output sanitization.
- [ ] **Step 2: Run the service test file** with `node --test test/services/process-details-service.test.mjs`; verify failures identify the missing service/behavior.
- [ ] **Step 3: Implement the scoped process projection** in `process-details-service.ts`, using sanitized trace payloads and visible run events only.
- [ ] **Step 4: Write failing route tests** for valid task/contact detail responses, unknown IDs, and cross-task/cross-contact access.
- [ ] **Step 5: Implement the summary fields and scoped detail GET routes**; preserve current error response conventions and avoid raw provider trace output.
- [ ] **Step 6: Run focused service/API tests and the full `npm test` suite.**
- [ ] **Step 7: Commit** as `feat: expose scoped conversation process details`.

### Task 2: Build the conversation-first workspace

**Files:**
- Create: `src/server/services/conversation-list-service.ts`
- Create: `src/app/api/conversations/route.ts`
- Modify: `src/components/WorkspaceShell.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/components/ProjectSelector.tsx`
- Test: `test/services/conversation-list-service.test.mjs`
- Test: `test/components/workspace-shell.test.mjs`
- Test: `test/api/conversation-list-route.test.mjs`

**Interfaces:**
- Produce `ConversationListItem`: `{ kind: "contact" | "task"; id; title; preview; updatedAt; href; avatarText; unreadCount }`.
- `GET /api/conversations` returns `{ items: ConversationListItem[] }`, ordered by latest visible conversation activity.
- `WorkspaceShell` consumes this list and retains contact/model data needed by its existing create-contact flow.

- [ ] **Step 1: Write failing list-service tests** for mixed contact/task ordering, empty conversations, previews, unread counts, and no cross-contact task leakage.
- [ ] **Step 2: Run the focused service test** and verify it fails because the list projection is missing.
- [ ] **Step 3: Implement the conversation-list projection and GET route** using existing DB relationships and route IDs.
- [ ] **Step 4: Write failing shell tests** for recent/contact/task filtering, active links, the add-contact action, and the root empty-main state.
- [ ] **Step 5: Implement the two-pane shell**: conversation list on the left, selected content on the right, no icon rail, and no setup copy in the root empty state.
- [ ] **Step 6: Route project registration through the project-selection flow** when no registered project is available; remove the persistent registered-project footer shortcut without deleting the settings route.
- [ ] **Step 7: Run the focused service, API, and component tests.**
- [ ] **Step 8: Commit** as `feat: add conversation-first workspace`.

### Task 3: Add shared conversation message primitives

**Files:**
- Create: `src/components/ConversationTimeline.tsx`
- Create: `src/components/ProcessDetailsCard.tsx`
- Modify: `src/components/ContactChat.tsx`
- Modify: `src/app/api/contacts/[contactId]/messages/route.ts`
- Modify: `src/app/globals.css`
- Test: `test/components/conversation-timeline.test.mjs`
- Test: `test/components/process-details-card.test.mjs`
- Test: `test/components/contact-chat.test.mjs`

**Interfaces:**
- `ConversationTimeline` accepts ordered visible messages, sender labels, and optional per-message process summaries; it adds centered timestamps at the spec's five-minute/day boundary.
- `ProcessDetailsCard` accepts a `ProcessSummary`, a detail URL, and the visible reply text; it starts collapsed, fetches `ProcessDetails` on first expansion, exposes loading/error/retry states, and renders safe chronological events.
- Consume Task 1's summary/detail contract. Keep contact message send/draft/task creation behavior unchanged.

- [ ] **Step 1: Write failing timeline tests** for user/contact avatars, same-avatar consistency, exactly-five-minute separation, shorter-gap suppression, and day-boundary dates.
- [ ] **Step 2: Write failing process-card tests** for collapsed initial state, summary metrics, lazy detail loading, event order, missing usage, loading/error/retry, and long-output disclosure.
- [ ] **Step 3: Run component tests** and verify they fail for the missing shared components/behaviors.
- [ ] **Step 4: Implement the shared timeline and process card** with semantic controls and visibly sanitized content.
- [ ] **Step 5: Update contact messages** to use the approved chat layout, user avatar, timestamps, and an expandable process card on assistant replies.
- [ ] **Step 6: Run focused component tests and all existing contact chat/message tests.**
- [ ] **Step 7: Commit** as `feat: render contact replies with process details`.

### Task 4: Redesign task conversations and task information

**Files:**
- Modify: `src/app/groups/[groupId]/page.tsx`
- Modify: `src/components/GroupConversation.tsx`
- Modify: `src/components/TaskStatusPanel.tsx`
- Modify: `src/components/RunProcessView.tsx`
- Modify: `src/app/api/groups/[groupId]/messages/route.ts`
- Modify: `src/app/globals.css`
- Test: `test/components/group-conversation.test.mjs`
- Test: `test/components/task-status-panel.test.mjs`
- Test: `test/api/group-process-details.test.mjs`

**Interfaces:**
- Consume Task 1's per-run process summary/detail URLs and Task 3's `ConversationTimeline`/`ProcessDetailsCard`.
- Pass `processSummaries: Record<runId, ProcessSummary>` from the server page and refresh it from `GET /api/groups/:groupId/messages`; render the process card only on the last assistant reply for a run to avoid duplicate run details.
- When an assistant reply and a structured handoff share a `sourceRunId`, display the persisted `@recipient` and handoff instruction/context with that reply; never synthesize a file path or review detail absent from stored data.
- Keep approval, retry, read/unread, live updates, task-description editing, and explicit-mention dispatch behavior available.
- Task information opens an accessible panel/disclosure containing task status, approvals, retry, and run state; do not show the legacy execution ledger as a permanent second column.

- [ ] **Step 1: Write failing group-conversation tests** for the shared user avatar, five-minute timestamps, one process card per run, same-run handoff recipient/instruction pairing, and preserved explicit mention behavior.
- [ ] **Step 2: Write failing task-information tests** proving status, approval decisions, and retry controls remain reachable and functional from the task-info control.
- [ ] **Step 3: Run the focused tests** and verify they fail for the missing chat presentation/panel behavior.
- [ ] **Step 4: Implement the task conversation layout** and move status/approval/run controls into task information without changing server-side authorization or dispatch semantics.
- [ ] **Step 5: Run focused group/API tests plus existing approval, retry, unread, and handoff tests.**
- [ ] **Step 6: Commit** as `feat: move task execution details into chat`.

### Task 5: Align settings, responsive states, and acceptance checks

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/settings/contacts/[contactId]/page.tsx`
- Modify: `src/app/settings/projects/page.tsx`
- Modify: `src/components/SearchBox.tsx`
- Modify: relevant components and page tests from Tasks 2–4
- Test: `test/e2e/achat-chat-redesign.spec.ts`

**Interfaces:**
- Consume the conversation shell and shared components from Tasks 2–4.
- Keep the current route set and existing forms/actions; the product default is the approved dark theme and no theme preference UI is added.

- [ ] **Step 1: Write failing responsive/accessibility tests** for mobile list-to-chat/back navigation, keyboard disclosure controls, labeled task information, and unchanged settings flows.
- [ ] **Step 2: Run the focused tests** and verify the missing mobile navigation/accessibility behavior.
- [ ] **Step 3: Restyle the existing settings and search surfaces** with the approved conversation visual language, retaining validation/errors and all settings actions.
- [ ] **Step 4: Implement mobile list/chat navigation** with an explicit back-to-list control; respect reduced-motion preferences and retain visible focus indicators.
- [ ] **Step 5: Add and run the focused Playwright acceptance flow** covering root empty state, private chat, task chat, process disclosure, task information, and project/contact settings navigation.
- [ ] **Step 6: Run `npm test`, `npm run typecheck`, `npm run lint`, and the targeted Playwright test; address regressions.**
- [ ] **Step 7: Commit** as `feat: finish responsive chat redesign`.

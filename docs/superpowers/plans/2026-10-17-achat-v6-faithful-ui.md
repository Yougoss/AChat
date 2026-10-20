# AChat V6-Faithful UI Implementation Plan

> **Status:** Implementation complete; merged locally into `feature/achat-ui-redesign-20261016`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Completed steps are checked.

**Goal:** Correct the running AChat UI to match the approved v6 conversation mockup and the applicable earlier interaction sketches without changing POC behavior.

**Architecture:** Keep routes, data contracts, and server behavior. Restyle the current two-pane shell and compose its existing chat/list/settings components into the exact compact hierarchy shown by the sketches. Rework the task-information control as the v2 side drawer and keep approvals in the task conversation.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-achat-v6-faithful-ui-design.md` (supplemental authority over conflicting visual choices in `docs/superpowers/specs/2026-10-16-achat-chat-redesign.md`).

## Global Constraints

- Use a two-pane conversation workspace: a 280px conversation list beside the active content on desktop; use 220px for the list at widths up to 650px; hide it at widths up to 480px while retaining an explicit back-to-list control in an active conversation.
- Do not add a left icon rail, a brand masthead, a large workspace heading, a permanent task/status column, or a second page-level conversation heading.
- Each v6 conversation row contains an avatar, the actual conversation name, and the latest visible-message preview. Do not add a row timestamp.
- The active conversation starts with a compact header: the actual contact or task name and its conversation type/participant subtitle on the left, and its `Contact settings` or `Task information` action on the right.
- Ordinary user messages are right-aligned with the same default “我” avatar; contact messages are left-aligned with the contact avatar. A reply/process card is left-aligned, has a green left border, a maximum width of `min(92%, 760px)`, reply text first, and a compact process summary/disclosure beneath it.
- Use v6 dark tokens exactly: list `#2d2f30`, paper `#202223`, thread `#1b1d1e`, ink `#f1f2f1`, muted `#a0a4a4`, line `#3e4142`, green `#07c160`, outgoing `#173d2d`, incoming `#303334`, and code `#292b2c`; use `"Inter", "PingFang SC", "Microsoft YaHei", sans-serif` where available. Do not add a product theme setting.
- Center timestamp separators when adjacent messages are at least five minutes apart, and show a date boundary when the date changes.
- Task information opens the v2 right-side panel for task goal, participants, status/unread state, and explicit retry. Approval requests remain actionable items in the task conversation.
- Render only persisted names, roles, messages, recipients, tool context, paths, usage, and events. Do not invent sample people, role labels, content, or metrics.
- Preserve current routes, explicit `@contact`/`@all` dispatch, search, filters, unread/read behavior, settings, project registration, live updates, approvals, retries, and server authorization.
- Keep existing English product copy for controls and operational states; use data-driven conversation and participant names.
- Do not add dependencies, routes, theme preferences, user-profile features, or new backend behavior.
- Keep process details collapsed by default; preserve chronological visible events, scoped access, sanitization, loading/errors/retry, and usage omission.

## Review Focus

- A contact/task with no preview uses the existing empty-preview copy and still shows the correct conversation name; test list labels and selected state in Task 1.
- A conversation name, participant, or description containing long text must not widen the 280px list or overlap header actions; test at desktop and narrow widths in Task 1/3.
- A task with no explicit role metadata must show participant names without invented role labels; test in Task 3.
- An assistant reply with no trace or partial usage remains a correctly positioned reply card without fabricated metrics; keep Task 2 component tests.
- At 480px and below the list is hidden but the active conversation has a usable return control; test in Task 3.

---

### Task 1: Match the shell, conversation list, and contact header

**Files:**
- Modify: `src/components/WorkspaceShell.tsx`
- Modify: `src/components/ContactChat.tsx`
- Modify: `src/app/globals.css`
- Test: `test/components/workspace-shell.test.mjs`
- Test: `test/components/contact-chat.test.mjs`
- Test: `test/e2e/achat-chat-redesign.spec.ts`

**Interfaces:**
- Consume the current `ConversationListItem` from `src/server/services/conversation-list-service.ts`; do not change its API or route.
- Preserve the existing `WorkspaceShell` props (`activeContactId`, `activeGroupId`, `children`) and contact creation/search/filter behavior.
- The contact header uses `visibleContact.name`, the contact-channel subtitle, and the existing settings route; it must not promote `description` to a large page heading or add another brand/title layer.

- [x] **Step 1: Write failing shell tests** asserting one compact list heading/add action, search then filters then rows, rows with actual avatar/name/preview and no timestamp, empty-preview copy, long conversation names staying within the row, no masthead/dispatch-desk label, and the root blank main area. Extend the E2E coverage to assert the blank root and active contact route.
- [x] **Step 2: Run the focused shell test** with `node --experimental-strip-types --import ./.test-support/register-tsx-loader.mjs --test test/components/workspace-shell.test.mjs`; confirm the missing ordering, naming, or masthead assertions fail.
- [x] **Step 3: Write failing contact-header tests** asserting the actual contact name is the compact title, the subtitle identifies the private channel, and contact settings is the single header action.
- [x] **Step 4: Run the contact component test** with the same loader and `test/components/contact-chat.test.mjs`; confirm it fails on the current oversized header structure.
- [x] **Step 5: Implement the shell and contact header** with only the hierarchy above; remove branding/extra heading content and do not add list timestamps.
- [x] **Step 6: Restyle shell/header tokens and geometry** to the spec's exact v6 palette and font stack, 280px desktop list, 220px list through 650px, 690px desktop/640px narrow minimum height, 58px chat header, compact list rows, 9px outer radius, and reference typography. Keep the two-pane structure and existing routes.
- [x] **Step 7: Run both focused component tests**; expect all shell and contact-header assertions to pass.
- [x] **Step 8: Capture a 1440×900 browser screenshot** of the root and active contact views for visual comparison with v6; correct any structural mismatch before committing.
- [x] **Step 9: Run the targeted Playwright flow** with `node scripts/run-e2e.mjs --config=playwright.config.ts test/e2e/achat-chat-redesign.spec.ts`; expect the root blank pane and active contact header flow to pass.
- [x] **Step 10: Run `git diff --check` and commit** as `fix: match approved conversation shell`.

### Task 2: Make replies and process details one mockup-shaped card

**Files:**
- Modify: `src/components/ConversationTimeline.tsx`
- Modify: `src/components/ProcessDetailsCard.tsx`
- Modify: `src/app/globals.css`
- Test: `test/components/conversation-timeline.test.mjs`
- Test: `test/components/process-details-card.test.mjs`
- Test: `test/components/contact-chat.test.mjs`
- Test: `test/components/group-conversation.test.mjs`

**Interfaces:**
- Consume the current `TimelineMessage`, `TimelineHandoff`, `ProcessSummary`, and `ProcessDetails` contracts without changing their server-side semantics.
- A visible assistant reply owns one reply card: sender name and reply text at the top, persisted handoff context within that reply when paired, and the existing `ProcessDetailsCard` summary/disclosure below.
- User messages remain right-aligned bubbles with the “我” avatar; contact/member messages remain left-aligned with the sender avatar/name.

- [x] **Step 1: Write failing timeline tests** that assert outgoing message placement/avatar, assistant sender name inside the reply card, reply text above the process bar, and paired handoff context inside its originating reply.
- [x] **Step 2: Run `test/components/conversation-timeline.test.mjs`, `test/components/contact-chat.test.mjs`, and `test/components/group-conversation.test.mjs`** with the TSX loader; confirm the current message-role/body/process structure fails the new assertions.
- [x] **Step 3: Write or extend process-card layout tests** for collapsed initial state, an assistant reply with no trace, summary/model/available usage in the compact footer, unavailable or partial usage without fabricated metrics, and expansion showing chronological sanitized events.
- [x] **Step 4: Implement the shared reply-card structure** without changing timestamp calculations, process URLs, fetching, privacy filtering, or handoff identity rules.
- [x] **Step 5: Match v6 geometry**: incoming/outgoing bubbles at `min(72%, 580px)`, reply card at `min(92%, 760px)` (97% is allowed at widths up to 650px), 3px accent border, compact reply body and process bar, centered timestamp chip, 13px thread item gap, and `18px clamp(12px, 3vw, 32px)` thread padding.
- [x] **Step 6: Run the focused timeline, process-card, contact, and group tests**; expect all to pass with no fabricated usage or event content.
- [x] **Step 7: Capture 1440×900 private and task conversation screenshots** and compare sender-name placement, card width, message alignment, timestamps, and composer against v6/v5/v4.
- [x] **Step 8: Run `git diff --check` and commit** as `fix: match approved reply card layout`.

### Task 3: Match task information, settings, and responsive states

**Files:**
- Modify: `src/components/GroupConversation.tsx`
- Modify: `src/components/TaskStatusPanel.tsx`
- Modify: `src/components/RunProcessView.tsx`
- Modify: `src/app/settings/contacts/[contactId]/page.tsx`
- Modify: `src/app/settings/projects/page.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/components/WorkspaceShell.tsx`
- Test: `test/components/group-conversation.test.mjs`
- Test: `test/components/task-status-panel.test.mjs`
- Test: `test/components/workspace-shell.test.mjs`
- Test: `test/e2e/achat-chat-redesign.spec.ts`

**Interfaces:**
- Consume Task 2's shared timeline/reply-card structure. Keep group, task, member, run, approval, unread, and process-summary data contracts unchanged.
- `GroupConversation` owns task-information open/close state and consumes existing approvals. `TaskStatusPanel` receives the existing task/run state plus explicit open/close callbacks and renders the task drawer, not a permanent panel above the timeline.
- The task header uses `group.name`, a compact task-group/participant subtitle from actual member data, and one `Task information` action. Roles appear only if explicitly stored.
- Render pending approval actions as task-conversation cards as in v2; render task goal, participant/status/unread details, run state, and retry in the right drawer.

- [x] **Step 1: Write failing task-view tests** asserting the compact task-name/participant header, names without inferred roles when metadata is absent, long participant text not overlapping header actions, no member strip or permanent status panel, drawer closed by default, and task status/retry reachable from the header action.
- [x] **Step 2: Write failing approval tests** asserting pending approval cards remain visible and actionable in the task conversation with the existing approval ID and decision payload.
- [x] **Step 3: Write a failing responsive test** asserting a 220px list at 650px and, at 390px, a hidden list plus a working back-to-list control from an active chat.
- [x] **Step 4: Run the focused group, task-status, and workspace-shell component tests** with the TSX loader; confirm current top-of-page panel placement, approval placement, and narrow-screen behavior fail the target assertions.
- [x] **Step 5: Implement the v2 task-information drawer** at the right edge below the 58px header (`width: min(310px, 80%)`), with task goal, participants, status/unread, runs, and explicit retry. Keep its open state controlled by the group header action.
- [x] **Step 6: Place approval cards in the task thread** and remove the separate member strip and permanent top status disclosure; preserve task-description edit, live activity, unread/read, approval authorization, and retry behavior.
- [x] **Step 7: Restyle contact settings and project registration** as compact v2 cards inside the same shell without changing their forms, routes, validation, or submit actions.
- [x] **Step 8: Implement the tested responsive states**: 220px list at widths through 650px; at 480px and below hide the list for an active chat and show the explicit back-to-list control; keep visible keyboard focus and reduced-motion behavior.
- [x] **Step 9: Run the targeted Playwright flow** with `node scripts/run-e2e.mjs --config=playwright.config.ts test/e2e/achat-chat-redesign.spec.ts`; expect root, contact, task, process disclosure, task-info drawer, settings, project validation, and mobile return flows to pass.
- [x] **Step 10: Capture and inspect 1440×900 and 390×844 screenshots** for root, private chat, task chat with drawer closed/open, contact settings, and project registration against the latest matching mockups. Fix structural mismatches before completion.
- [x] **Step 11: Run `npm test`, `npm run typecheck`, `npm run lint`, targeted Playwright, and `git diff --check`; expect all tests/checks to pass.**
- [x] **Step 12: Commit** as `fix: align task and settings views with approved sketches`.

## Execution notes

- Tasks are sequential because they share `globals.css` and UI contracts; do not run implementation agents in parallel.
- Implement with TDD and inspect the specified screenshots before each task is accepted. Do not make extra visual changes outside the listed sketch correspondence.
- Keep test/build artifacts out of commits; screenshot captures are review artifacts, not product assets.

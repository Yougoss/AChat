# AChat UI: Faithful Mockup Correction

**Status:** Approved by user; implemented and verified
**Supersedes:** The visual interpretation in `2026-10-16-achat-chat-redesign.md` wherever the running UI conflicts with the approved interaction sketches. It does not replace that document's data-safety, runtime, and POC behavior requirements.

## Intent

Correct the current AChat interface so its actual layout, conversation naming, message placement, and visual hierarchy match the approved interaction sketches. This is a faithful implementation task, not a new visual exploration. The primary failure to correct is that the merged UI does not look or read like the approved chat screens even though some of their behaviors exist.

## Source of truth

The sketches are local-only design artifacts from the original `AChat` worktree and are not included in this repository. Their approved requirements are recorded below so implementation does not depend on machine-specific paths or guessing from older sketches.

Use the following source order, newest first. A newer sketch wins whenever an older sketch differs:

1. `chat-timestamps-v6.html` — authoritative conversation shell, list, header, message alignment, card sizing, timestamp separators, and dark palette.
2. `handoff-details-v5.html` — handoff recipient, changed-file context, and review-focus presentation.
3. `avatar-and-process-v4.html` — private-chat shape and the shared “我” avatar.
4. `process-details-v3.html` — visible process-event ordering and detail presentation.
5. `poc-layout-v2.html` — page map, blank initial state, contact settings, project registration, and task-information drawer.
6. `waiting-home-entry.html` — no separate introductory home screen.
7. `poc-pages-and-layout.html` — historical page context only; its three-column icon rail and other conflicts are superseded by v2 and later sketches.

The mockups contain sample names, messages, times, paths, model IDs, and usage values solely to illustrate placement. Render the corresponding values from AChat's persisted data. Never hard-code sample people, role labels, task content, file paths, events, or usage numbers.

## Required visual structure

- Use a two-pane conversation workspace: a 280px conversation list beside the active content on desktop; use 220px for the list at widths up to 650px; hide it at widths up to 480px while retaining an explicit back-to-list control in an active conversation.
- Do not add a left icon rail, a brand masthead, a large workspace heading, a permanent task/status column, or a second page-level conversation heading. The list begins with its compact “Conversations” heading and add-contact action, followed by search, the `Recent` / `Contacts` / `Tasks` filters, and conversation rows.
- Each v6 conversation row contains an avatar, the actual conversation name, and the latest visible-message preview. Do not add a row timestamp: it is absent from v6 and is superseded from older sketches.
- The active conversation starts with a compact header: the actual contact or task name and its conversation type/participant subtitle on the left, and its `Contact settings` or `Task information` action on the right. Do not substitute a generic brand/workspace title for the conversation name.
- The message thread fills the space below the header and above the composer. It uses the v6 muted dark thread background and green accent, not the current blue/coral theme. Match v6's compact typography, spacing, borders, and card proportions rather than applying a new design system.
- Ordinary user messages are right-aligned with the same default “我” avatar; contact messages are left-aligned with the contact avatar. Use the conversation name as the sender where the sketch does so. A reply/process card is left-aligned, with a green left border, a maximum width of `min(92%, 760px)`, reply text first, and a compact process summary/disclosure beneath it.
- The composer remains fixed to the bottom of the conversation column. Keep existing message-send and explicit-mention dispatch behavior.
- Use the dark palette and default dark appearance shown by v6. Its light/dark switch is a mockup comparison control, not a request to add a product theme setting.
- Center timestamp separators when adjacent messages are at least five minutes apart, and show a date boundary when the date changes. The accepted five-minute behavior from the earlier design remains in force.

## v6 visual measurements

Treat these as reference measurements for the implementation rather than broad stylistic inspiration:

- Dark colors: conversation-list background `#2d2f30`; main paper `#202223`; thread background `#1b1d1e`; primary text `#f1f2f1`; muted text `#a0a4a4`; borders `#3e4142`; accent `#07c160`; outgoing-message background `#173d2d`; incoming-message background `#303334`; process-event/code background `#292b2c`. Dark avatar tiles use `#48534e` with `#e7eee9` text.
- The framed reference workspace has a 690px minimum height, a 280px list column, a 1px border, 9px corner radius, and a restrained outer shadow. The header is at least 58px high with `10px 17px` padding.
- The list title is 14px bold; row title and preview are 11px and 9px; contact avatars are 36px square. Search and filter text are 10px and 9px.
- The thread uses a 13px item gap and `18px clamp(12px, 3vw, 32px)` padding. The outgoing/incoming bubble is at most `min(72%, 580px)`, with 11px text and 9px 12px padding. A reply card is `min(92%, 760px)`, with a 3px green left border; its body uses 11px text and `10px 12px 9px` padding. The process bar uses 9px text and `7px 11px` padding.
- At 650px and below, use a 220px list and a 640px minimum workspace height; the reply card may use 97% width. At 480px and below, the list is hidden while the explicit return-to-list action remains available.
- Use `"Inter", "PingFang SC", "Microsoft YaHei", sans-serif` as the reference font stack where available.

## POC pages and interactions

- `/` keeps the conversation list visible and an intentionally blank main pane until a conversation is selected; do not show onboarding or setup instructions.
- Private chat, task-group chat, contact settings, and project registration keep their existing routes and actions. Settings and project registration use the compact card layout shown in v2, within the two-pane shell.
- The task-group header names the task and identifies the task-group conversation and actual participants. Show actual contact names; show a role only when explicit role data exists. Do not infer roles from names, task descriptions, or sample copy.
- `Task information` opens the v2 right-side disclosure panel for task goal, participants, status/unread state, and explicit retry. Do not render a permanent status panel above the message history or as a second column.
- Approval requests remain visible as actionable items in the task conversation, as in v2. Preserve their exact existing approval scope and allow the user to approve or deny; do not change authorization or dispatch semantics.
- Pair a persisted structured handoff with its matching assistant reply only when they share the persisted run. Show only persisted recipient, instruction, changed-file context, and review focus; never synthesize missing details.
- Process details are collapsed by default. On expansion, show the associated user-visible input, assistant messages, tool calls/results, and relevant failures in chronological order. Keep the existing lazy loading, retry/error states, scoped trace access, sanitization, and usage omission rules. Do not expose reasoning, credentials, raw provider request/response data, or invented usage.
- Keep the single default “我” avatar; upload/edit remains out of scope.

## Non-goals and preservation constraints

- Do not add routes, dependencies, user-profile features, theme preferences, or new backend behavior for this correction.
- Preserve search, recent/contact/task filtering, unread/read behavior, contact creation and model settings, task drafting/creation, project registration, live updates, approvals, retries, and all server-side authorization.
- Keep existing English product copy for controls and operational states; the sketches determine placement and hierarchy, not a broad localization change. Conversation and participant names remain data-driven.
- Keep keyboard focus, accessible labels/disclosure state, visible loading and error states, and mobile return navigation.

## Acceptance criteria

1. At desktop width, a screenshot of the conversation workspace visibly matches v6's two-pane proportions and hierarchy: compact list at left, named conversation header at top right, message thread in the middle, and composer at bottom. There is no icon rail, brand masthead, oversized title, or permanent task column.
2. The sidebar rows show the actual conversation name and latest visible-message preview in v6 order and omit a row timestamp.
3. Private and task headers show the actual conversation name in the title position and the proper conversation type/participant subtitle below it; the header action matches the conversation type.
4. User messages are right-aligned with the same “我” avatar; contact messages and reply cards are left-aligned with the actual sender avatar/name. The reply card and its collapsed process bar match v6's proportions and placement.
5. Timestamp boundaries, process-event ordering, usage omission, handoff pairing, and data-scope protections continue to work as already specified.
6. Task information opens as a disclosure; approvals remain actionable in the thread; retry and status remain available without a permanent status/ledger column.
7. The blank root, contact settings, project registration, search, filters, send/dispatch, unread/read, live updates, approval, and retry flows continue to work.
8. At widths up to 480px, an active conversation has an explicit way back to the hidden conversation list.
9. Review screenshots at desktop and narrow/mobile widths against the corresponding approved sketches before implementation is considered complete.

## Builder-owned implementation choices

The implementer may choose the smallest component/CSS changes that satisfy these requirements, reuse current routes and components, and add or adjust focused tests. Those choices must not change the visual hierarchy, displayed name placement, source priority, or preserved behavior above.

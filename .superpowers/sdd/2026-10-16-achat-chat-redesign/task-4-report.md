# Task 4 TDD report

## Scope

Redesigned task-group conversations to use the shared conversation timeline and per-run process cards, and moved execution controls and history behind an accessible task-information disclosure. Preserved the existing task-message, retry, approval, unread, live-update, description-editing, and explicit-mention flows.

## Red: failing tests before production edits

Added group-conversation tests for the shared `我` avatar, five-minute and date separators, one process card per run, persisted same-run handoff pairing and fragment anchors, orphan handoff rendering, process-summary refresh replacement, and explicit-mention dispatch. Reworked task-information tests to require reachable status, approvals, retry, and run history through the disclosure.

Ran the new focused component tests before changing production code. The expected failures showed that group messages had no shared avatars/timeline or run process cards and that status, approvals, and retry had no task-information disclosure. Existing orphan-handoff rendering and explicit-mention behavior passed, establishing behavior to preserve.

## Green: implementation

- The server group page now supplies `listGroupRunProcessSummaries(groupId)`; refresh replaces the displayed summaries with the `processSummaries` returned by the existing group messages API.
- The group conversation reuses `ConversationTimeline`; each run's card is attached only to its last assistant message and links to the existing group/run process endpoint.
- A structured handoff sharing that assistant run is shown verbatim in its process card with its original message ID retained as an anchor. Handoffs without a source-run assistant remain standalone. No file paths or review details are synthesized.
- Status, approvals, retry, read/unread state, and run history are contained in a keyboard-accessible native disclosure that is closed by default. The previous permanent status column and duplicated inline event ledger are removed.
- The prior run-stream integration assertion was updated to reflect that event details now load from the per-run process endpoint instead of appearing in the permanent run ledger.

## Verification

- Focused group/task-information tests: **7 passed, 0 failed**.
- Focused group/process API, approval, retry/status, unread, and handoff tests: **40 passed, 0 failed** after correcting a test fixture to create runs in the repository's required initial `running` state.
- `npm test`: **186 passed, 0 failed**.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `git diff --check`: passed.

## Resolved ambiguity

The task-information disclosure starts closed to keep the chat focused. A handoff paired with a run is displayed using only its persisted message content; if its source run has no assistant reply, it stays a separate message with its original fragment target.

## Commit

`feat: move task execution details into chat`

## Task 4 review finding fix

Removed the group messages GET route's run-event query, payload parsing, and `events` attachment from visible runs. Existing run rows and task execution status fields are unchanged, and process summaries continue to come from the scoped process-details service. Added a regression fixture with a sensitive tool-output sentinel and assertions that the response contains neither a run `events` field nor the raw payload.

### Verification

RED:

- Command: `node --experimental-strip-types --import ./.test-support/register-tsx-loader.mjs --test test/api/group-process-details.test.mjs`
- Output: `tests 1`, `pass 0`, `fail 1`; failed as expected because `body.runs[...].events` contained `provider-secret-output`.

GREEN:

- Command: `node --experimental-strip-types --import ./.test-support/register-tsx-loader.mjs --test test/api/group-process-details.test.mjs test/components/group-conversation.test.mjs test/components/task-status-panel.test.mjs`
- Output: `tests 9`, `pass 9`, `fail 0`, `cancelled 0`, `skipped 0`, `todo 0`.
- Test files: `test/api/group-process-details.test.mjs`, `test/components/group-conversation.test.mjs`, `test/components/task-status-panel.test.mjs`.
- Command: `npm run typecheck`
- Output: `tsc --noEmit` completed with exit code 0.
- Command: `git diff --check`
- Output: no errors; exit code 0.

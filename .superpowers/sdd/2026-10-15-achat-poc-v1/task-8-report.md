# Task 8 Report: Manual retry and interrupted-session reconciliation

## Implementation

- Added an ordered recovery lifecycle between database/Pi runtime startup and work-queue startup. It marks persisted `running` runs interrupted, synchronizes their work-item state, and associates interruption evidence with the existing contact/task Pi-session mapping and trace. Previously graceful interruptions are left intact and their event is trace-associated. Reconciliation never queues or prompts work.
- Added explicit retry via `POST /api/tasks/[taskId]/retry`. Requests may select `workItemIds`; omitting them selects eligible interrupted items in that task. The service rejects foreign-task, completed, ineligible, or unmapped items, requires the mapped JSONL file at runtime, and starts a new durable Run attempt through the existing queue/session factory. Prior run and trace evidence remains append-only.
- Added an explicit retry action to `TaskStatusPanel`, with disabled/loading and accessible error states, and refreshes task activity after success.
- Fixed `listWorkItemsForTask` to bind its task ID parameter; default retry uses this query.
- No schema migration was needed. Existing migrations and `.gitignore` were not changed.

## TDD and validation

**RED:** Wrote recovery, retry, JSONL reopen, and panel interaction tests before production changes. The initial focused run had 8 failures out of 10, including the expected missing recovery service/lifecycle ordering and missing UI action. During the GREEN iterations, additional setup issues (interrupted Runs must first be created as running, provider model fields belong to `agents`, and fake queues need unique IDs) and a real missing task-ID binding in the work-item list query were exposed and corrected.

**GREEN:** The focused recovery/session/panel suite passed **11/11** after implementation. Tests cover graceful and hard interruption, startup no-auto-replay, idempotent association, selected and default retry, new Run identity, retained original trace, completed/foreign-task rejection, missing JSONL protection, and reopening the mapped Pi JSONL with a fake runtime/session.

| Command | Result |
| --- | --- |
| `node --experimental-strip-types --import ./.test-support/register-tsx-loader.mjs --test test/lifecycle/recovery.test.mjs test/pi/session-reopen.integration.test.mjs test/components/task-status-panel.test.mjs` | 11 passed |
| `npm test` | 128 passed, 0 failed |
| `npx playwright test test/e2e/status-unread.spec.ts` | 1 passed |
| `npm run lint` | Passed |
| `npx tsc --noEmit` | Passed |
| `npm run build` | Passed |
| `git diff --check` | Passed |

The existing E2E expectation was updated to reflect startup reconciliation: the persisted active run appears interrupted after app startup; the test then creates a new active attempt and confirms completion/unread behavior.

## Pi session acceptance limitation

Session-reopen validation used the installed Pi `SessionManager` against a real test JSONL file, while injecting a fake runtime/provider and fake agent session; it confirmed the same session ID/file and prior conversation context were reopened, with no external provider call. A real Copilot login/model acceptance test was not run because the shared Copilot authentication is unconfigured. No credential files were inspected and no real provider request was made.

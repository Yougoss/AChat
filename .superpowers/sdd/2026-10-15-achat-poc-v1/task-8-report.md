# Task 8 Report: Manual retry and interrupted-session reconciliation

## Implementation

- Added an ordered recovery lifecycle between database/Pi runtime startup and work-queue startup. It marks persisted `running` runs interrupted, reconciles stale work-item state from terminal run history (including a retry reset interrupted before its next run and a run completed before its item update), and associates interruption evidence with the existing contact/task Pi-session mapping and trace. Previously graceful interruptions are left intact and their event is trace-associated. Reconciliation never queues or prompts work.
- Added explicit retry via `POST /api/tasks/[taskId]/retry`. Requests may select `workItemIds`; omitting them selects eligible interrupted items in that task. The service rejects foreign-task, completed, ineligible, or unmapped items, requires the mapped JSONL file at runtime, and starts a new durable Run attempt through the existing queue/session factory. Prior run and trace evidence remains append-only.
- Added an explicit retry action to `TaskStatusPanel`, with disabled/loading and accessible error states, and refreshes task activity after success.
- Fixed `listWorkItemsForTask` to bind its task ID parameter; default retry uses this query.
- Added typed task-not-found/retry-conflict errors so the retry API returns 404/409 for expected conditions and 500 for unexpected runtime/database failures.
- No schema migration was needed. Existing migrations and `.gitignore` were not changed.

## TDD and validation

**RED:** Wrote recovery, retry, JSONL reopen, and panel interaction tests before production changes. The initial focused run had 8 failures out of 10, including the expected missing recovery service/lifecycle ordering and missing UI action. The review-fix regression tests also failed first for the two crash windows and error classification. During the GREEN iterations, additional setup issues (interrupted Runs must first be created as running, provider model fields belong to `agents`, and fake queues need unique IDs) and a real missing task-ID binding in the work-item list query were exposed and corrected.

**GREEN:** The focused recovery/session/panel/API suite passed **16/16** after the review fixes. Tests cover graceful and hard interruption, startup no-auto-replay, retry crash-window repair, completed-run state repair, idempotent association, selected and default retry, new Run identity, retained original trace, completed/foreign-task rejection, missing JSONL protection, error-to-HTTP status mapping, and reopening the mapped Pi JSONL with a fake runtime/session.

| Command | Result |
| --- | --- |
| `node --experimental-strip-types --import ./.test-support/register-tsx-loader.mjs --test test/lifecycle/recovery.test.mjs test/pi/session-reopen.integration.test.mjs test/components/task-status-panel.test.mjs test/api/task-retry-route.test.mjs` | 16 passed |
| `npm test` | 131 passed, 0 failed |
| `npx playwright test test/e2e/status-unread.spec.ts` | 1 passed |
| `npm run lint` | Passed |
| `npx tsc --noEmit` | Passed |
| `npm run build` | Passed |
| `git diff --check` | Passed |

## Review follow-up

The independent review found two crash windows that could leave work items in stale states, and retry-route handling that mapped unexpected infrastructure errors to 409. Startup now restores work-item state from terminal run history without executing work, and typed errors distinguish expected 404/409 cases from unexpected 500s. Regression tests reproduced both crash windows and verified the status mapping; all review findings are addressed.

An intermediate build also caught that Next.js route modules cannot export arbitrary helpers. The error-to-status mapper was moved into `src/server/lifecycle/retry-errors.ts`; the final build passed.

The existing E2E expectation was updated to reflect startup reconciliation: the persisted active run appears interrupted after app startup; the test then creates a new active attempt and confirms completion/unread behavior.

## Pi session acceptance limitation

Session-reopen validation used the installed Pi `SessionManager` against a real test JSONL file, while injecting a fake runtime/provider and fake agent session; it confirmed the same session ID/file and prior conversation context were reopened, with no external provider call. A real Copilot login/model acceptance test was not run because the shared Copilot authentication is unconfigured. No credential files were inspected and no real provider request was made.

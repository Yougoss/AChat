# AChat POC v1 — Task 7 Report

## Result

Implemented durable run status, group unread/read cursors, persisted event replay and streaming, and exact-scope tool approvals. The existing Task 6 Pi event bridge was extended in place; Task 4 trace linkage and event projection were preserved. Migrations 001–005 were not edited; migration 006 is additive.

## Implementation

- Added a stable, append-only event cursor table in migration 006. Existing events are backfilled in creation order; appends persist the event and cursor transactionally and notify subscribers only after commit.
- Added event replay/live subscription and `/api/events` SSE reconnect support. Subscriptions replay persisted events before delivering later events, deduplicate by cursor, and unsubscribe on disconnect without deleting durable events.
- Added run/task status projection. An active tool can be reported stuck only after the 30-minute boundary with lifecycle evidence; terminal tool events close that lifecycle, while missing evidence remains unknown. Approval/input waits and streaming are kept distinct from completion.
- Used the existing run-completion and group cursor persistence to make unread counts idempotent and independent of message reads. Opening a group and the explicit read action advance the persisted run cursor.
- Added a task-session Pi approval extension and server approval service. Approval scope is derived and validated server-side against task, work item, run, session, tool call, and action. The request is persisted and emitted before the tool waits; only an explicit approval releases it. Denied, stale, or mismatched approvals do not execute the action. Browser requests submit only the decision; the approval ID is in the URL.
- Added accessible status, unread, and approval UI in the existing dispatch-workbench style, with explicit empty and error states.
- Adjusted `npm test` to select `test/**/*.test.mjs` so the Playwright `.spec.ts` is run by Playwright rather than Node's test runner.

## TDD evidence

Tests were added before the corresponding implementations and observed failing behavior:

- The initial focused behavior sweep was RED: 32 passed, 5 failed because Task 7 modules were not present.
- The added cancellation-projection test failed because `tool.cancelled` was not projected by the existing bridge; it passed after extending that bridge.
- The event-stream test failed because `createEventStreamService` was missing; it passed after implementing persisted replay and subscription.
- The duplicate approval-call test exposed a missing explicit duplicate guard (SQLite uniqueness surfaced instead); it passed after the service returned the intended rejection.
- A subsequent TypeScript run caught missing iterator `return(undefined)` arguments; they were fixed and TypeScript validation passed.

The final event-stream tests cover persistence-before-notification, replay/reconnect without gaps, and disconnect-only unsubscribe. Other focused coverage exercises exact approval scope, blocking/denial/stale/mismatch behavior, unread idempotence and cursor independence, the `99+` cap, distinct status projection, fake-clock stuck boundary, and unknown/approval/input/streaming cases.

## Verification

| Command | Result |
| --- | --- |
| `npx playwright test --config playwright.config.ts` | Passed: 1 test, 1 passed. The test verifies live completion updates status and unread independently and that group read persists the cursor. |
| `npm test` | Passed: 107 tests, 0 failures. |
| `npm run lint` | Passed, exit code 0. |
| `npx tsc --noEmit` | Passed, exit code 0. |
| `npm run build` | Passed. Next.js 16.3.8 compiled, type-checked, generated static pages, and reported the expected API and page routes. |
| `git diff --check` | Passed, no whitespace errors. |

The first full `npm test` attempt exposed that Node's auto-discovery was loading the Playwright spec as a Node test (114 passed, 1 failed with “Playwright Test did not expect test() to be called here”). The test script was narrowed to the `.test.mjs` unit/integration files; rerunning the full suite passed. An earlier E2E attempt was blocked because the Playwright browser was not installed; after installing the required browser, the E2E test passed, including the final persisted-cursor assertion.

Validation generated `.next/`, `next-env.d.ts`, `test-results/`, and `tsconfig.tsbuildinfo`; these were removed. The pre-existing untracked `node_modules/` directory was preserved.

## Scope and compatibility

No real Copilot request was used. Pi behavior was tested with fakes. No sibling repository or `.gitignore` was accessed. The Task 4 trace storage and Task 6 event bridge remain the single trace/projection path.

## Fix round 1

Addressed all three Important findings:

- Approval decisions revalidate the original server-bound task/work-item/run/Pi-session scope inside the decision transaction. A stale scope raises an explicit `Stale approval` error, removes the decision from the in-memory pending map, and does not resolve the blocked tool as approved. Regression tests independently make the run and work item terminal and verify each approval is rejected while its tool remains blocked.
- Stuck detection checks every unfinished tool start and reports `stuck` if any one has crossed 30 minutes, even when a newer unfinished call has not.
- Replaced shell-expanded `test/**/*.test.mjs` with recursive Node-based `.test.mjs` discovery. The runner invokes 40 discovered files, includes root-level `test/app-runtime.test.mjs`, includes nested service tests, and excludes the Playwright `.spec.ts`.

The deferred Low/Minor E2E fixture-path cleanup finding was not changed. Migrations 001–006 were not edited.

### TDD evidence

RED was observed before implementation:

| Command | RED evidence |
| --- | --- |
| `node --experimental-strip-types --import ./.test-support/register-tsx-loader.mjs --test test/services/approval-service.test.mjs test/services/task-status.test.mjs` | 7 passed, 3 failed: both stale-approval tests got no rejection, and the older qualifying tool was reported `not_stuck`. |
| `node --experimental-strip-types --import ./.test-support/register-tsx-loader.mjs --test test/test-discovery.test.mjs` | Failed with `ERR_MODULE_NOT_FOUND` for the not-yet-implemented `scripts/test-discovery.mjs`. |
| `npm test` (pre-fix) | Shell glob ran 110 tests (107 passed, 3 failed) and omitted the root-level `test/app-runtime.test.mjs`; its runtime tests therefore did not execute. |

After implementation, the focused regression command passed 10/10, and the discovery test passed 1/1. The direct discovery probe reported `discovered 40 files; root app-runtime: true; all .test.mjs: true; Playwright spec excluded: true`.

### Fix-round verification

| Command | Result |
| --- | --- |
| `npm test` | Passed: 116 tests, 0 failures. Output includes all five `test/app-runtime.test.mjs` cases. |
| `npx playwright test --config playwright.config.ts` | Passed: 1 test, 1 passed. |
| `npm run lint` | Passed, exit code 0. |
| `npx tsc --noEmit` | Passed, exit code 0. |
| `npm run build` | Passed; Next.js compiled, type-checked, generated pages, and reported the expected routes. |
| `git diff --check` | Passed, no whitespace errors. |

## Fix round 2

Addressed the stale-decision recovery finding without changing migrations or the previously fixed all-start stuck evaluation, recursive test discovery, or deferred E2E fixture cleanup. When the decision transaction finds that its bound run/work item/session is no longer active, it now atomically marks the approval denied, resolves its attention request, and appends the decision event. After that transaction commits, it removes the in-memory waiter and resolves the blocked tool as denied, then returns the explicit stale error to the decision caller. A retry cannot treat the request as pending or succeed.

### TDD evidence

The focused approval-service and approval-extension tests were extended first to cover stale run and work-item termination, denied waiter completion, non-execution of the intercepted action, closed persistent approval/attention state, and unsuccessful retry.

| Command | RED evidence |
| --- | --- |
| `node --experimental-strip-types --import ./.test-support/register-tsx-loader.mjs --test test/services/approval-service.test.mjs test/pi/approval-extension.integration.test.mjs` | Failed as expected: 4 passed, 3 failed. Both service tests received `unsettled` instead of `denied`; the extension test received `unsettled` instead of the blocked-tool result. These failures reproduced the unclosed waiter after an explicit stale error. |

After implementation, that focused command passed all 7 tests. The service tests verify terminal run and work-item cases, denied persistence, resolved attention, and retry rejection; the extension integration test verifies that the action remains unexecuted and the tool completes only as denied.

### Fix-round verification

| Command | Result |
| --- | --- |
| Focused approval-service and approval-extension tests (command above) | Passed: 7 tests, 0 failures. |
| `npm test` | Passed: 117 tests, 0 failures. |
| `npx playwright test --config playwright.config.ts` | Passed: 1 E2E test. |
| `npm run lint` | Passed, exit code 0. |
| `npx tsc --noEmit` | Passed, exit code 0. |
| `npm run build` | Passed; Next.js compiled, type-checked, generated pages, and reported the expected routes. |
| `git diff --check` | Passed, no whitespace errors. |

Generated build and Playwright artifacts were removed after validation; the pre-existing untracked `node_modules/` directory was preserved.

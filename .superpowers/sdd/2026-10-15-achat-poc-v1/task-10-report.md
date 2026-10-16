# Task 10: End-to-end POC demonstration and acceptance

## Status

**DONE_WITH_CONCERNS.** The deterministic demonstration and required validation
passed. Live GitHub Copilot acceptance remains blocked/unrun because the local
AChat endpoint was unavailable and the shared Copilot login was previously
reported unconfigured. No credential files were inspected, copied, or modified.

## What was delivered

- Added an offline Playwright demonstration of the Feature task:
  - An explicit `@Developer` message against a blank task description is rejected
    before it creates a work item/run or requests a model response.
  - After adding the description in the isolated test database, the deterministic
    faux-provider flow completes Developer → Test → Developer → Test, including
    the bug report, fix, retest pass, and `@user` completion.
  - The test checks run/process evidence, distinct task session references for
    Developer and Test, contact-scoped trace reads, and denial of a foreign
    contact's trace request.
- Added deterministic coverage for unread counts accumulating to two while
  work is active, evidence-based stuck status using a fixed old tool-start
  timestamp, explicit retry after interruption, and Feature/bug search
  navigation to the matching message.
- Added isolated E2E setup and runner commands. Test databases and Pi agent
  directories use per-run paths and are removed by the runner.
- Added first-run local guidance and `docs/local-run.md` covering startup,
  project-root boundaries, both demonstrations, deterministic validation, and
  the separate live-provider acceptance procedure.
- Preserved the loopback boundary (`npm run dev` binds to `127.0.0.1`). No
  runtime, database schema, credential flow, worktree, or dependency change was
  introduced.

## Acceptance evidence

The deterministic handoff E2E uses Pi's local faux provider under provider ID
`github-copilot`, with model ID `offline-demo-model`. It does not make an
external model request and is not counted as live Copilot acceptance.

The E2E checks generated `trace_records` through the test database and normal
trace-query service: each task session returns only its own mapped session
records, contact run-start events remain attributed to their owning contact,
and a foreign session read is rejected. The test also scans stored trace
payloads for authorization headers, bearer credentials, and token-shaped
fields. Existing unit coverage verifies credential redaction and that raw
provider traces are not included in ordinary search. No credentials or
authorization headers were included in this report.

Live availability was checked using the local endpoint at
`127.0.0.1:3000`; connection was refused. No selected live model ID or live
output evidence is available, and no provider request was made. The installed
Pi packages used by this POC are all version `1.2.0`; installed Next.js is
`16.3.8`, Playwright is `1.64.1`, Node.js is `v24.13.0`, and npm is `11.6.2`.

## Validation

All commands below completed successfully after the final test assertion
change:

- `npm test` — 140 passed, 0 failed.
- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm run build` — passed.
- `npm run test:e2e` — 4 Task 10 Playwright tests and 1 search Playwright test
  passed.
- `git diff --check` — passed.

## Limitations

The current UI has no control for editing a task description after task
creation. Accordingly, the deterministic E2E first verifies blank-description
blocking, then updates only its isolated test fixture before continuing the
Feature demonstration. A live demonstration must create the task with its
description already populated; it must not be represented as the same-task UI
edit flow.

Real Copilot acceptance is still required when the shared Pi `agentDir` login,
selected model, and local AChat service are available. The faux-provider run
does not substitute for that acceptance.

## Independent review round 1 — corrected brief follow-up

**Finding 1 — resolved:** the original deterministic flow edited its SQLite
fixture directly after proving that a blank description blocks dispatch. Added
`GroupTaskRepository.updateTaskDescription(taskId, description)`, which changes
only the task row and returns `undefined` for a missing task; added
`PATCH /api/tasks/{taskId}` with non-empty description and strict request-field
validation; and added accessible add/edit, save, and cancel controls in the
group conversation. Saving does not create or rewrite runs, Pi session
mappings, messages, or task events. The handoff E2E now proves blank-description
blocking first, saves from the UI through the real PATCH route, verifies the
persisted description and unchanged run/session counts, then proceeds with the
deterministic handoff. It no longer updates `tasks` directly.

### TDD evidence

- **RED repository/API:** ran
  `node --experimental-strip-types --import=./.test-support/register-tsx-loader.mjs --test test/db/group-task-repository.test.mjs test/api/task-description-route.test.mjs`.
  Result: 4 passed, 2 failed as expected — `updateTaskDescription is not a
  function` and the new task route module was missing.
- **RED UI/E2E:** ran
  `npm run test:e2e -- --grep='Developer and Test complete'`.
  Result: the handoff scenario failed because the expected **Add task
  description** control did not exist.
- **GREEN repository/API:** the same focused Node command passed all 6 tests
  (including history preservation, missing-task behavior, blank-description
  validation, and rejected extra request fields).
- **GREEN UI/E2E:** ran
  `npm run test:e2e -- --config=playwright.config.ts --grep='Developer and Test complete'`.
  Result: 1 passed. The test waits for PATCH 200 and verifies the persisted
  description before dispatch. An intermediate run exposed that the test
  advanced before the asynchronous save completed; the test was tightened to
  wait on the response and on the saved UI state before it passed.

### Live Copilot availability

Started `npm run dev` on AChat's loopback binding and queried the normal
`GET http://127.0.0.1:3000/api/models` runtime endpoint. It returned HTTP 200
and a Copilot model catalog, including `gpt-6-luna`, but every returned model
had `authState: "unauthenticated"`. The configured Pi agent directory resolved
to `/Users/luyxiong/.pi/agent`; only the path was checked. No credential files
were opened, copied, printed, or modified, and no provider prompt/request was
made. A selected, authenticated model could not be established, so live
Copilot acceptance remains **blocked/unrun**; the offline faux-provider output
is not counted as live acceptance. The service was stopped after the check.

Installed versions reported by npm: all seven installed
`@earendil-works/pi-*` packages (`pi-agent-core`, `pi-ai`, `pi-codemode`,
`pi-coding-agent`, `pi-mcp`, `pi-telemetry`, and `pi-tui`) are `1.2.0`;
Next.js is `16.3.8`; Playwright is `1.64.1`; Node.js is `v24.13.0`; npm is
`11.6.2`.

### Artifact, trace, and isolation review

- Reviewed the generated Playwright failure context from the expected RED run
  and the final `test-results/.last-run.json` (`passed`, zero failed tests).
  The final E2E runner stdout contained only test names/counts; no secret-like
  values were present in the inspected output.
- Reviewed a generated recovery Pi JSONL in the dedicated isolated
  `task-10-artifact-review` fixture: it was one line / 24 bytes, mode `0600`;
  scans for authorization headers, bearer values, and access/refresh/API token
  fields all returned false. This fixture was removed by its runner on stop.
- The passing handoff E2E reads persisted trace payloads and asserts no
  authorization header, bearer value, or token-shaped field; verifies
  Developer and Test can read only their own task-session trace records; and
  verifies a cross-contact session read is rejected. Existing redaction tests
  and ordinary-search trace-exclusion tests also passed.
- The regular Task 10 E2E runner used its isolated per-run database and empty
  Pi agent directory and removed those fixture directories after completion.

### Final validation after the fix

- `npm test` — 142 passed, 0 failed.
- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm run build` — passed.
- `npm run test:e2e` — 5 Playwright tests passed (4 Task 10 flows and 1
  contact-scoped search flow).
- `git diff --check` — passed.

**Round 1 status:** deterministic behavior and all requested code validations
are complete. Task 10 remains **DONE_WITH_CONCERNS** solely because the selected
live Copilot model was unauthenticated and the real acceptance was not run.

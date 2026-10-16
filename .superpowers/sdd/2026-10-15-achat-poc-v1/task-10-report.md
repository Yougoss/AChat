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

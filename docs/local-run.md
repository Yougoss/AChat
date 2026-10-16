# AChat POC v1: local run and acceptance

## Start the local service

Use Node.js 22.19 or newer. From `AChat/`, install the lockfile dependencies with
`npm ci` if they are not already installed, then run:

```sh
npm run dev
```

Open `http://127.0.0.1:3000`. The service binds to loopback; keep it local and do
not rebind it to a LAN interface. Node owns Pi execution, so closing a browser
only disconnects its live-update stream. Shutting down Node interrupts active
work; AChat does not automatically replay interrupted work on restart.

Register an existing project directory from **Registered projects** before
creating a task. A task uses the selected project's shared root. AChat validates
and records that root, but `cwd` is not a filesystem sandbox. The POC does not
create worktrees or silently copy the workspace.

Sign in to GitHub Copilot from a contact's settings and choose a model available
to that contact. AChat reuses Pi's configured `agentDir` login; it does not create
a separate OAuth credential store. GitHub Copilot is the only provider exposed
by the POC model and login UI.

## Demo A: Feature handoff

1. Create contacts named **Developer** and **Test** and select a GitHub Copilot
   model for each.
2. Create the **Feature** group/task in the registered project. Start with an
   empty task description and send an explicit `@Developer` request. The request
   must be rejected before work-item/run creation or a model request.
3. Add a task description, then explicitly mention **@Developer**. Follow the
   run/process panel for its run and tool evidence.
4. Confirm the structured handoff chain in the group conversation:
   **Developer → Test → Developer → Test**. Test reports the bug, Developer
   fixes it, and Test reports a pass and **@user** completion.
5. From each contact's private session query, verify that Developer and Test
   see their own independent task-session references and cannot read the other's
   trace.

**Current UI limitation:** the task description is read-only after a group/task
is created; there is not yet an edit control. The deterministic acceptance test
checks the empty-description rejection, updates only its isolated test fixture,
and then runs the described Feature through real AChat persistence, handoff,
queue, and trace services with scripted Pi sessions. For a live Copilot run,
create a task with its description already filled in; treat the blank-description
check and live-provider run as separate checks rather than claiming the current
UI edits the same task.

## Demo B: unread, stuck evidence, recovery, and search

The deterministic tests cover the following without waiting 30 minutes or
calling a provider:

- A completion adds one unread run while another run is active; a second
  completion accumulates a count of two. Marking runs read advances the
  completion cursor.
- A run is marked possibly stuck only when a `tool.started` event is still
  unfinished and its fixture timestamp is older than the threshold. The test
  uses a fixed old timestamp, not a sleep. Missing tool-start evidence remains
  unknown.
- A process-recovered interrupted item stays idle until the user selects
  **Retry interrupted work**. The E2E test verifies the run count before the
  click and uses a scripted session for the explicit retry.
- Searching **Feature bug** opens the group conversation at the matching
  message. Existing search E2E also verifies contact ACL filtering and that
  provider traces are not searchable.

## Run deterministic verification

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm run test:e2e
```

`npm run test:e2e` runs the Task 10 handoff, recovery, status/unread, and search
Playwright suites. It starts an isolated loopback server on port 3010 with a
temporary test data directory and empty Pi agent directory, then removes only
that generated fixture. Its scripted sessions are offline deterministic test
inputs; they do not count as live Copilot acceptance.

## Live GitHub Copilot acceptance

Run live acceptance separately from the deterministic suite, using the existing
Pi runtime, the user's configured Pi `agentDir`, and the selected contact model.
Record the model ID, installed Pi package/SDK versions, and concise non-secret
output evidence. Do not copy, inspect, or modify credential files, and do not
record auth headers, tokens, or other secrets in traces, logs, test output, or
this report. If the shared Copilot login or selected model is unavailable, mark
live acceptance **blocked/unrun**; deterministic tests are not a substitute.

## Local evidence boundaries

Provider request/response traces and Pi session files remain local and
contact-scoped. AChat redacts credential-shaped fields and authorization
headers, excludes raw provider traces from ordinary search, and does not export
trace data to a cloud service. Use non-sensitive project data until local
retention and encryption requirements have been decided.

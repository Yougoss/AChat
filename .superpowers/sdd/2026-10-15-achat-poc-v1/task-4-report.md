# AChat POC v1 — Task 4 report

## Result

Implemented local provider/session trace capture and the contact-scoped,
read-only `query_contact_sessions` tool.

Commit: `7f2e00ee53abafdf7c854447c6aa6e73343eba18`

- Added additive migration `004_trace_capture.sql`; migrations 001–003 were
  left unchanged. Trace rows are linked to DB-owned Pi session mappings and
  are not part of any FTS index.
- Captured Pi provider request payloads, HTTP response status, provider stream
  events, final assistant messages, selected Pi lifecycle/tool events, and
  explicitly linked AChat events. Provider-hook call IDs correlate each request
  with its provider events. Header/auth/secret-shaped fields are removed before
  persistence.
- Enforced local DB directory/file permissions of `0700`/`0600`.
- Added contact-scoped session and task summaries, newest-first stable cursor
  pagination, and chronological trace pagination. Session reads use the
  persisted contact/session mapping, reject other contacts explicitly, and
  enforce the optional `(contactId, taskId)` scope.
- Added the tool only to `contact_chat`. It has no contact-ID or file-path
  parameter and uses no `AgentSession` controls, task write APIs, or tools.
  Task sessions receive no query tool. The process session DB remains open
  while its registered sessions can use trace hooks and the query tool.

## TDD

### RED

The first focused run was made after writing the trace/query and integration
tests and before adding the missing trace/query implementation:

```text
npm test -- test/trace/trace-extension.test.mjs test/services/trace-query-service.test.mjs test/pi/query-contact-sessions.integration.test.mjs
```

It failed: the trace and service test modules could not import the absent
`trace-extension.ts`; the integration fixtures also initially used the
non-Copilot helper contact and failed the existing provider guard. The fixture
was corrected to seed a `github-copilot` contact. The next run showed the
trace-query service tests passing while the integration module exposed the
missing direct TypeBox schema dependency. That dependency was declared and the
implementation was completed.

### GREEN

Focused verification after implementation:

```text
npm test -- test/trace/trace-extension.test.mjs test/services/trace-query-service.test.mjs test/pi/query-contact-sessions.integration.test.mjs test/db/client.test.mjs
17 tests, 17 passed, 0 failed
```

Final requested verification:

```text
npm test
51 tests, 51 passed, 0 failed

npm run lint
passed

npx tsc --noEmit
passed (exit 0, no diagnostics)

npm run build
passed; Next.js production build completed

git diff --check
passed (exit 0, no output)
```

The build outputs and test-created session directories were removed after
verification. `node_modules/` remains untracked; npm updated its installed
tree while declaring the required TypeBox dependency.

## Round 1 fixes

Base: `7f2e00ee53abafdf7c854447c6aa6e73343eba18`.

### Changes

- Task-filtered `listContactSessions` now verifies the server-bound contact is
  a member of the requested task before listing. Existing but unauthorized
  tasks raise an explicit authorization error; nonexistent tasks retain a
  not-found error. The regression test invokes `list_sessions` through the
  read-only tool action and verifies the unauthorized request rejects instead
  of returning an empty success page.
- Trace sanitization now redacts bearer credentials and common credential
  parameters in URL query strings even when those values appear under
  innocuous property names. Tests use synthetic values only and verify the
  remaining non-credential query value is preserved.
- No AChat event producer was added; Task 6 remains responsible for wiring
  actual events through the existing trace API. No earlier migration was
  modified.

### TDD

#### RED

Initial focused run before implementation:

```text
npm test -- test/services/trace-query-service.test.mjs test/pi/query-contact-sessions.integration.test.mjs test/trace/trace-extension.test.mjs
12 tests: 10 passed, 2 failed
```

The tool action returned success for the nonmember's task-filtered request,
and the value-level redaction test showed the URL query credential persisted.
After splitting the value tests to isolate each case, the trace test file was
run with value redaction disabled to confirm both tests fail independently:

```text
npm test -- test/trace/trace-extension.test.mjs
5 tests: 3 passed, 2 failed
```

The bearer value in an innocuously named string and the `api_key` URL query
value each appeared in persisted trace JSON.

#### GREEN

Focused post-fix run:

```text
npm test -- test/services/trace-query-service.test.mjs test/pi/query-contact-sessions.integration.test.mjs test/trace/trace-extension.test.mjs
13 tests: 13 passed, 0 failed
```

Final validation:

```text
npm test
54 tests: 54 passed, 0 failed

npm run lint
passed

npx tsc --noEmit
passed (exit 0, no diagnostics)

npm run build
passed; Next.js production build completed

git diff --check
passed (exit 0, no output)
```

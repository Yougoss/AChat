# SDD ledger — plan: docs/superpowers/plans/2026-10-16-achat-chat-redesign.md

## Setup

- Workspace: `/Users/luyxiong/Documents/Code/AI_Task/20261014_AChat_Pi/AChat-ui-redesign` on `feature/achat-ui-redesign-20261016`.
- Plan: `docs/superpowers/plans/2026-10-16-achat-chat-redesign.md`.
- Spec: `docs/superpowers/specs/2026-10-16-achat-chat-redesign.md`.
- Baseline commit before Task 1: `03cb3a0`.
- Baseline: `npm test` passed (142 tests); `npm run typecheck` passed.
- The mockup companion was already stopped: its recorded PID did not exist, port 59584 had no listener, and the preview URL refused connection.

## Preflight plan scan

| Pair/task | Shared file or interface | Scan result |
|---|---|---|
| Task 1 ↔ Task 3 | Contact messages API response and `ProcessSummary`/`ProcessDetails` | Task 1 owns the data contract and summary; Task 3 consumes it through the shared card. No conflicting ownership. |
| Task 1 ↔ Task 4 | Group messages API response and per-run process details | Task 1 owns scoped run summary/detail APIs; Task 4 consumes them. Run/task scope must stay server-derived. |
| Task 2 ↔ Task 3 | Workspace shell and selected-contact route context | Task 2 owns the shell/list; Task 3 keeps chat content inside the existing route. No duplicate shell ownership. |
| Task 2 ↔ Task 4 | Workspace shell and selected-group route context | Task 2 owns navigation; Task 4 owns group content and task-info control. |
| Task 3 ↔ Task 4 | `ConversationTimeline`, `ProcessDetailsCard`, and `globals.css` | Task 3 produces shared message primitives; Task 4 consumes them. Both touch global CSS, so Task 4 must extend rather than overwrite Task 3 styles. |
| Task 3 ↔ Task 5 | `globals.css` and contact/settings visual tokens | Task 3 adds conversation styles; Task 5 performs final responsive/restyle pass after them. |
| Task 4 ↔ Task 5 | `globals.css`, task-info and responsive states | Task 4 owns functional task panel behavior; Task 5 owns final responsive/accessibility polish. |
| Task 1 self-check | Process service, routes, message metadata, tests | Service and route tests precede implementation; exact private trace ranges and task run IDs are specified. |
| Task 2 self-check | Conversation list API, root shell, project flow, tests | New list projection precedes shell; root empty state and existing add/project paths have explicit tests. |
| Task 3 self-check | Shared timeline/card and private chat tests | Summary/detail API is a prerequisite; tests pin 5-minute, avatar, collapsed-card, and error behavior. |
| Task 4 self-check | Task chat, task-info panel, run/approval tests | Shared components and process APIs are prerequisites; existing dispatch and control semantics are explicitly preserved. |
| Task 5 self-check | Settings/search styling, mobile, E2E | Depends on the final shell and chat layouts; test path matches Playwright's `test/e2e` directory. |

No plan/spec conflicts found.

## Rulings

- Ruling: Work in a new linked worktree on `feature/achat-ui-redesign-20261016` rather than the original checkout — the original contains unrelated uncommitted report/build artifacts; the new branch will be merged back after review. Cost if wrong: local integration/merge work.
- Ruling: Keep the worktree under the project parent instead of `/tmp` because implementation agents cannot access `/tmp`; this preserves branch isolation and makes the workspace readable to the agents. Cost if wrong: only the worktree's filesystem location changes.
- Ruling: Ship the approved dark appearance as the fixed default; the prototype theme switch was a comparison aid, not a requested preference setting. Cost if wrong: adding a theme preference later.
- Ruling: Keep existing English UI copy and use the approved “我” placeholder glyph for the user's avatar. Cost if wrong: localization/copy pass.
- Ruling: Keep process cards collapsed by default and put task status/approvals/retry in the task-information panel. Cost if wrong: one extra click to inspect details or status.
- Ruling: Add explicit back-to-list navigation on narrow screens rather than hiding the conversation list with no return path. Cost if wrong: small mobile-layout rework.
- Ruling: Use the five-minute separator threshold the user confirmed and show date boundaries separately. Cost if wrong: adjusting timestamp presentation.
- Ruling: Keep long tool results available but collapse them within the event row; show readable context without making a single output dominate the chat. Cost if wrong: tune the detail affordance after real output review.
- Ruling: Link private process records with a persisted per-message trace sequence range; do not infer identity from matching reply text. Cost if wrong: extra metadata/query work is localized to contact message persistence.
- Ruling: Expose message/run summaries as top-level `processSummaries` maps keyed by assistant message ID or run ID; place available aggregate totals under optional `summary.usage` and omit unavailable fields instead of fabricating zeroes.
- Ruling: Private trace boundaries are after-exclusive and through-inclusive; persist equal boundaries for mapped prompts that emit no trace records so those replies remain explicitly unlinked.
- Ruling: Serialize private prompts with a module-shared per-contact queue — the AChat local runtime is a single Node process, so this prevents overlapping trace ranges across per-request service instances without adding database locking. Cost if wrong: a future multi-process deployment would need a shared lock.
- Ruling: Task trace details require a matching persisted run event ID/type plus exact run, task, contact, Pi-session and call linkage; project only sanitized visible context/events, never provider request/response records or reasoning blocks.
- Ruling: Retain complete sanitized tool output in the API; the UI task owns collapsed presentation. No schema migration is needed because the existing message metadata JSON and trace tables hold the required linkage.
- Ruling: Pair structured handoff metadata with the assistant reply using `sourceRunId`/`runId`, and display only persisted recipient/instruction context; never invent changed-file context. Cost if wrong: a handoff may remain a separate message if the underlying data does not identify its source run.

## Task status

- Task 1: complete (commits `03cb3a0..12289df`, review clean; 2 findings addressed in fix round 1).
- Task 1: minor (deferred): prompt serialization is process-local; multi-process deployment would need shared synchronization.
- Task 2: complete (commits `12289df..31c3aa8`, review clean; 1 finding addressed in fix round 1).
- Task 2: minor (deferred): local POC has no human identity, so the conversation list cannot apply per-human membership filtering; add authenticated actor scope before multi-user deployment.
- Task 2: minor (deferred): private unread count remains zero because no private read-state exists; add one only after defining its semantics.
- Task 3: complete (commits `31c3aa8..d35aec9`, review clean).
- Task 4: fix round 1/5 (1 addressed, 0 open — unused raw run event payloads remained in the group messages API response; commits `185a5d2`..`a21e050`).
- Task 4: complete (commits `7dce04e`..`a21e050`, review clean).
- Task 4 initial review: identified an unused raw run-event response payload; scoped re-review confirmed the fix.
- Task 5: complete (settings/search polish, responsive list-to-chat navigation, accessibility checks, and targeted acceptance E2E; see `task-5-report.md`).

## Task 1 review findings

- Important (`message-service.ts`): private trace-sequence snapshots can overlap when concurrent requests target the same contact session, so one reply may include another prompt's trace. Fix by serializing the full private prompt/boundary operation per contact (or using equivalent exact per-prompt correlation), with a concurrency regression test across separate service instances.
- Important (`process-details-service.ts`, `trace-extension.ts`): string sanitization does not redact assignment-style secrets such as `OPENAI_API_KEY=...`; add targeted sanitization and tests for tool arguments/results.

## Task 2 review findings

- Important (`ProjectSelector.tsx`): after at least one project is registered, the selector no longer links to `/settings/projects`, and the persistent footer link was removed. Users therefore cannot register an additional project root. Keep a registration/manage-projects affordance within the project-selection flow and test it with a nonempty project list.

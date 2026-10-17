# Task 2 — Conversation-first workspace

## Result

Implemented the conversation list service and `GET /api/conversations`, replaced the root setup instructions with a blank main pane, and updated `WorkspaceShell` to show contact and task conversations with Recent / Contacts / Tasks filters. Contact and group pages use the same list and mark their matching links active. Contact creation and model selection remain available. Project registration is linked from the project selector only when the registered-project list is empty; the persistent sidebar project/settings shortcuts were removed. The existing settings routes remain.

The list returns the required `ConversationListItem` shape, sorts by latest visible message activity with stable fallbacks for empty conversations, scopes previews to the same conversation chosen by the existing contact/group routes, counts unread task run completions, and omits task groups without task members. The interface retains the existing English copy and now uses the dark default palette. No schema or dependency changes were needed.

## TDD evidence

Tests were written before production changes. The initial focused service RED was caused by the missing projection module:

```text
node --experimental-strip-types --import ./.test-support/register-tsx-loader.mjs --test test/services/conversation-list-service.test.mjs
```

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/luyxiong/Documents/Code/AI_Task/20261014_AChat_Pi/AChat-ui-redesign/src/server/services/conversation-list-service.ts' imported from /Users/luyxiong/Documents/Code/AI_Task/20261014_AChat_Pi/AChat-ui-redesign/test/services/conversation-list-service.test.mjs
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

The component RED command was:

```text
node --experimental-strip-types --import ./.test-support/register-tsx-loader.mjs --test test/components/workspace-shell.test.mjs test/components/project-selector.test.mjs
```

Its exact test summary was **5 tests, 1 pass, 4 fail**:

```text
✔ offers only the registered project roots supplied to the selector
✖ links to project registration from task selection when no projects are registered
✖ filters the shared conversation list by recent, contacts, and tasks
✖ marks contact and task routes active and opens the existing add-contact form
✖ renders the root route with a blank main pane and no setup instructions
ℹ tests 5
ℹ pass 1
ℹ fail 4
```

The first failing assertion expected `/Register a project/`; the existing selector rendered an empty project dropdown. The filtering and active-link tests could not find the task item, and the root test reported the old setup copy in `<main>`.

The API RED command was:

```text
node --experimental-strip-types --import ./.test-support/register-tsx-loader.mjs --test test/api/conversation-list-route.test.mjs
```

Its exact failure identified the absent route:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/luyxiong/Documents/Code/AI_Task/20261014_AChat_Pi/AChat-ui-redesign/src/app/api/conversations/route.ts' imported from /Users/luyxiong/Documents/Code/AI_Task/20261014_AChat_Pi/AChat-ui-redesign/test/api/conversation-list-route.test.mjs
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

A further regression test was added for duplicate private/task conversations. Before the correction it failed with:

```text
✖ uses only the private and task conversations selected by their existing routes
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ 'Do not leak the alternate private conversation'
- 'Visible private conversation'
```

The service was then restricted to the private conversation selected by the contact flow and the earliest task conversation selected by the group route. The regression passed.

Focused GREEN command:

```text
node --experimental-strip-types --import ./.test-support/register-tsx-loader.mjs --test test/services/conversation-list-service.test.mjs test/api/conversation-list-route.test.mjs test/components/workspace-shell.test.mjs test/components/project-selector.test.mjs
```

Exact result:

```text
✔ GET /api/conversations returns the scoped conversation item contract (32.223083ms)
✔ offers only the registered project roots supplied to the selector (3.108583ms)
✔ links to project registration from task selection when no projects are registered (0.278708ms)
✔ filters the shared conversation list by recent, contacts, and tasks (81.881ms)
✔ marks contact and task routes active and opens the existing add-contact form (19.073709ms)
✔ renders the root route with a blank main pane and no setup instructions (10.0635ms)
✔ orders private contacts and member task groups by their latest visible activity (13.484958ms)
✔ includes empty private and task conversations with blank previews and stable timestamps (5.724542ms)
✔ uses the latest message as each item's preview without crossing conversation scope (4.899083ms)
✔ uses only the private and task conversations selected by their existing routes (5.335ms)
✔ counts unread task completions and excludes tasks without members (4.738875ms)
ℹ tests 11
ℹ suites 0
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1072.035417
```

## Verification

- `npm test` — **168 passed, 0 failed**.
- `npm run typecheck` — exit 0 (`tsc --noEmit`).
- `npm run lint` — exit 0 (`eslint .`).
- `git diff --check` — exit 0.
- No database migration or package manifest/lockfile changes.

## Files

- Added `src/server/services/conversation-list-service.ts`
- Added `src/app/api/conversations/route.ts`
- Updated `src/components/WorkspaceShell.tsx`
- Updated `src/app/page.tsx`
- Updated `src/app/groups/[groupId]/page.tsx`
- Updated `src/components/ProjectSelector.tsx`
- Updated `src/app/globals.css`
- Added `test/services/conversation-list-service.test.mjs`
- Added `test/api/conversation-list-route.test.mjs`
- Added `test/components/workspace-shell.test.mjs`
- Updated `test/components/project-selector.test.mjs`
- Updated `.test-support/tsx-loader.mjs` and added `.test-support/next-navigation-mock.mjs` so the component tests can provide the App Router context.

## Uncertainties and recommendation

The existing schema has no private-chat unread cursor for the human workspace, so private contact items report `unreadCount: 0`; task unread counts use the persisted group run-completion cursor. If private unread badges are desired, add an explicit read-state contract before assigning a nonzero meaning.

The local POC has no authenticated human/actor identity in the list endpoint. The service therefore filters out tasks with no `task_members` and only returns task conversation previews from the route-selected conversation, but it cannot enforce a per-human membership check that the existing route contract does not identify. This is consistent with the current local operator model; before exposing the endpoint to multiple human users, add an authenticated actor scope and filter tasks to that actor’s membership.

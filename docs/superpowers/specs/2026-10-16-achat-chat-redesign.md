# AChat Conversation UI Redesign

**Status:** Approved visual direction; implementation choices below follow the user's approved mockup and stated preferences.

## Intent

Give AChat a familiar, conversation-first workspace for a person coordinating AI contacts and task groups. The main job is to let the person choose a conversation, read replies in context, and inspect the work behind a reply without making execution telemetry dominate the chat.

## Approved interaction and visual direction

- Use a WeChat-inspired two-pane desktop layout: a compact conversation list on the left and the selected conversation on the right. The initial `/` view shows the list and an empty conversation area, not an onboarding/marketing page.
- The list contains private contact conversations and task-group conversations, supports recent/contact/task filters and search, and retains the add-contact action. Do not add a functionless icon rail.
- Keep existing route behavior and POC actions. Contact settings are reached from the contact header; task status, approvals, and retry controls are available from task information; project registration is reachable from the task/project selection flow. Do not remove or weaken an existing workflow.
- Use the approved dark WeChat-like treatment as the product default. The mockup's light/dark switch was for visual comparison, not a requirement for a product theme preference.
- Private and task conversations use chat bubbles for ordinary messages. An AI reply is a compact expandable card with the reply text and a `Process details` disclosure.
- Every message sent by the user uses one consistent default avatar marked “我”. Avatar editing/upload is out of scope for this POC.
- Insert a centered time separator between adjacent messages when their timestamp gap is at least five minutes. Do not add a separator for shorter gaps. Show a date boundary when messages cross calendar days.
- Render task handoffs as conversational text that explicitly names the recipient and gives the changed-file/context summary needed for review (for example, `@小周` plus changed paths and review focus).

## Process details

- The collapsed card header shows `Process details`, the visible assistant-message count, and the model or models when known. Show available usage totals for input, output, cache read/write, and cost using Pi's captured usage; do not invent zeroes or sample values.
- Expanding the card shows user-visible input/context, assistant messages, tool calls and their sanitized results, and relevant failures, in chronological order. It must be detailed enough to inspect what happened; long tool output may be collapsed within its event row.
- Aggregate usage across assistant messages belonging to the same task run or private assistant response. Show duration only when the source provides it. Omit unavailable usage fields; if no usage was captured, show an explicit unavailable state rather than fabricated metrics.
- Do not expose model reasoning/thinking blocks, raw provider requests/responses, credentials, or content outside the contact/task scope. Use the existing trace sanitization and keep process queries constrained to the contact or task/run mapping.
- The process card is collapsed by default to preserve the chat rhythm. The approved mockup displayed it expanded only to review its contents.

## Preserved behavior and non-goals

- Preserve message send, explicit `@contact`/`@all` dispatch semantics, task drafting/creation, approvals, retry, unread/read, search, contact model settings, provider authentication, and registered project behavior.
- Keep existing routes; redesign their presentation rather than replacing the POC flows.
- Do not add avatar upload/edit, user profiles, new identity/authentication, a theme-preference system, or a new UI dependency.
- Keep the current English product copy for existing flows; use concise labels consistent with the existing application. The default user avatar glyph remains “我” as shown in the approved mockup.

## Responsive and accessibility requirements

- On narrow screens, show either the conversation list or the active conversation, with an explicit back-to-list control; do not merely hide navigation from an active conversation.
- Preserve keyboard focus visibility, semantic headings/labels, accessible disclosure state, and reduced-motion behavior.
- Loading, empty, and API-error states remain visible and actionable.

## Acceptance checks

1. `/` opens to a two-pane workspace with a conversation list and empty main panel.
2. A person can select both a private conversation and a task group from the list.
3. User messages show the same default avatar in private and task conversations.
4. Message timestamps follow the five-minute separator rule in both conversation types.
5. Assistant replies expose expandable, chronological process details with available Pi usage and sanitized tool outputs.
6. Task handoff text names the recipient and includes changed-file/context information.
7. Existing POC interactions remain available from the redesigned views and settings flows.
8. Contact/task process data cannot cross scope boundaries, and no reasoning or credential-bearing trace data is displayed.

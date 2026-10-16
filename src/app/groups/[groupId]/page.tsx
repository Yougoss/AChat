import { notFound } from "next/navigation";
import { GroupConversation } from "../../../components/GroupConversation.tsx";
import { WorkspaceShell } from "../../../components/WorkspaceShell.tsx";
import { createAgentRepository } from "../../../server/db/repositories/agent-repository.ts";
import { createGroupTaskRepository } from "../../../server/db/repositories/group-task-repository.ts";
import { createMessageRepository } from "../../../server/db/repositories/message-repository.ts";
import { createEventRepository } from "../../../server/db/repositories/event-repository.ts";
import { createUnreadRepository } from "../../../server/db/repositories/unread-repository.ts";
import { createAttentionRepository } from "../../../server/db/repositories/attention-repository.ts";
import { createApprovalService } from "../../../server/services/approval-service.ts";
import { createTaskStatusService } from "../../../server/services/task-status-service.ts";
import { markGroupRunsRead } from "../../../server/services/message-service.ts";
import { startAchatRuntime, getAchatDatabase } from "../../../server/runtime-bootstrap.ts";

export const dynamic = "force-dynamic";

interface GroupPageProps {
  params: Promise<{ groupId: string }>;
}

export default async function GroupPage({ params }: GroupPageProps) {
  const { groupId } = await params;
  await startAchatRuntime();
  const db = getAchatDatabase();
  const groups = createGroupTaskRepository(db);
  const group = groups.getGroup(groupId);
  const task = groups.getTaskByGroupId(groupId);
  if (!group || !task) notFound();
  markGroupRunsRead(db, groupId);
  const memberIds = groups.listTaskMembers(task.id);
  const contacts = createAgentRepository(db).listContacts()
    .filter((contact) => memberIds.includes(contact.id))
    .map(({ id, name }) => ({ id, name }));
  const conversation = db.prepare(`
    SELECT id FROM conversations WHERE kind = 'task' AND task_id = ?
    ORDER BY created_at, id LIMIT 1
  `).get(task.id) as { id: string } | undefined;
  const messages = conversation
    ? createMessageRepository(db).listMessages(conversation.id)
    : [];
  const runs = db.prepare(`
    SELECT runs.id, runs.task_id AS taskId, runs.work_item_id AS workItemId,
           runs.contact_id AS contactId, runs.attempt, runs.status,
           runs.started_at AS startedAt, runs.completed_at AS completedAt,
           contacts.name AS contactName, work_items.title
    FROM runs
    JOIN contacts ON contacts.id = runs.contact_id
    JOIN work_items ON work_items.id = runs.work_item_id
    WHERE runs.task_id = ?
    ORDER BY runs.started_at DESC, runs.id DESC
  `).all(task.id) as Array<{
    id: string;
    taskId: string;
    workItemId: string;
    contactId: string;
    attempt: number;
    status: "running" | "completed" | "failed" | "interrupted";
    startedAt: string;
    completedAt: string | null;
    contactName: string;
    title: string;
  }>;
  const eventRows = db.prepare(`
    SELECT id, entity_id AS runId, type, payload_json AS payload
    FROM events
    WHERE entity_type = 'run' AND json_extract(payload_json, '$.taskId') = ?
    ORDER BY created_at, id
  `).all(task.id) as Array<{ id: string; runId: string; type: string; payload: string }>;
  const runEvents = new Map<string, Array<{ id: string; type: string; payload: Record<string, unknown> }>>();
  for (const event of eventRows) {
    const payload = JSON.parse(event.payload) as Record<string, unknown>;
    const bucket = runEvents.get(event.runId) ?? [];
    bucket.push({ id: event.id, type: event.type, payload });
    runEvents.set(event.runId, bucket);
  }
  const taskStatusService = createTaskStatusService(db);
  const visibleRuns = runs.map((run) => ({
    ...run,
    ...taskStatusService.getRunExecutionStatus(run.id),
    events: (runEvents.get(run.id) ?? []).sort(
      (left, right) => Number(left.payload.eventSequence ?? 0) - Number(right.payload.eventSequence ?? 0),
    ),
  }));
  const pendingAttentionCount = createAttentionRepository(db)
    .listAttentionRequestsForTask(task.id)
    .filter(({ status }) => status === "open").length;
  const approvals = createApprovalService(db).listPendingApprovals(task.id);
  const unreadCount = createUnreadRepository(db).countUnreadRuns(groupId);
  const eventCursor = createEventRepository(db).getCurrentCursor();

  return (
    <WorkspaceShell>
      <GroupConversation
        group={group}
        task={task}
        messages={messages}
        runs={visibleRuns}
        contacts={contacts}
        taskStatus={task.status}
        unreadCount={unreadCount}
        pendingAttentionCount={pendingAttentionCount}
        approvals={approvals}
        eventCursor={eventCursor}
      />
    </WorkspaceShell>
  );
}

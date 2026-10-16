import { createGroupMessageService } from "../../../../../server/services/handoff-service.ts";
import { getAchatDatabase, startAchatRuntime } from "../../../../../server/runtime-bootstrap.ts";
import { getAchatWorkQueue } from "../../../../../server/runtime-bootstrap.ts";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

export async function GET(_request: Request, { params }: RouteContext): Promise<Response> {
  const { groupId } = await params;
  try {
    await startAchatRuntime();
    const db = getAchatDatabase();
    const group = db.prepare("SELECT id FROM groups WHERE id = ?").get(groupId);
    if (!group) return Response.json({ error: `Group not found: ${groupId}` }, { status: 404 });
    const task = db.prepare("SELECT id FROM tasks WHERE group_id = ?").get(groupId) as { id: string };
    const messages = db.prepare(`
      SELECT messages.id, messages.conversation_id AS conversationId, messages.role,
             messages.content, messages.metadata_json AS metadataJson,
             messages.created_at AS createdAt
      FROM messages JOIN conversations ON conversations.id = messages.conversation_id
      WHERE conversations.kind = 'task' AND conversations.task_id = ?
      ORDER BY messages.created_at, messages.id
    `).all(task.id).map((row) => {
      const message = row as {
        id: string;
        conversationId: string;
        role: string;
        content: string;
        metadataJson: string;
        createdAt: string;
      };
      return { ...message, metadata: JSON.parse(message.metadataJson) as Record<string, unknown> };
    });
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
    `).all(task.id);
    const events = db.prepare(`
      SELECT id, entity_id AS runId, type, payload_json AS payload
      FROM events
      WHERE entity_type = 'run' AND json_extract(payload_json, '$.taskId') = ?
      ORDER BY created_at, id
    `).all(task.id).map((row) => {
      const event = row as { id: string; runId: string; type: string; payload: string };
      return { ...event, payload: JSON.parse(event.payload) as Record<string, unknown> };
    });
    const visibleRuns = (runs as Array<{ id: string }>).map((run) => ({
      ...run,
      events: events.filter((event) => event.runId === run.id).sort(
        (left, right) => Number(left.payload.eventSequence ?? 0) - Number(right.payload.eventSequence ?? 0),
      ),
    }));
    return Response.json({ messages, runs: visibleRuns });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load group messages";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  const { groupId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "A JSON group message body is required" }, { status: 400 });
  }
  if (
    typeof body !== "object" || body === null
    || !("content" in body) || typeof body.content !== "string"
  ) {
    return Response.json({ error: "content must be a string" }, { status: 400 });
  }
  try {
    await startAchatRuntime();
    const queue = getAchatWorkQueue();
    const service = createGroupMessageService(getAchatDatabase(), {
      enqueueWorkItem: (workItemId) => queue.enqueueWorkItem(workItemId),
    });
    const result = await service.sendGroupMessage(groupId, { content: body.content });
    return Response.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send group message";
    return Response.json({ error: message }, {
      status: /cannot be empty|required/i.test(message)
        ? 400
        : message.startsWith("Group not found:") ? 404 : 500,
    });
  }
}

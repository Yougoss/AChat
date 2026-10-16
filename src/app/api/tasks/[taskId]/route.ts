import { createGroupTaskRepository } from "../../../../server/db/repositories/group-task-repository.ts";
import { getAchatDatabase, startAchatRuntime } from "../../../../server/runtime-bootstrap.ts";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  const { taskId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "A JSON task description is required" }, { status: 400 });
  }
  if (
    typeof body !== "object" || body === null || Array.isArray(body)
    || !("description" in body) || typeof body.description !== "string"
  ) {
    return Response.json({ error: "description must be a non-empty string" }, { status: 400 });
  }
  if (Object.keys(body).some((field) => field !== "description")) {
    return Response.json({ error: "Only description may be updated" }, { status: 400 });
  }
  if (!body.description.trim()) {
    return Response.json({ error: "Task description is required" }, { status: 400 });
  }

  try {
    await startAchatRuntime();
    const task = createGroupTaskRepository(getAchatDatabase())
      .updateTaskDescription(taskId, body.description);
    if (!task) return Response.json({ error: `Task not found: ${taskId}` }, { status: 404 });
    return Response.json({ task });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update task description";
    return Response.json({ error: message }, { status: 500 });
  }
}

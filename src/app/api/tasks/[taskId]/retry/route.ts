import { getAchatRecoveryService, startAchatRuntime } from "../../../../../server/runtime-bootstrap.ts";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  const { taskId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "A JSON retry request is required" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: "Retry request must be an object" }, { status: 400 });
  }
  const fields = Object.keys(body);
  if (fields.some((field) => field !== "workItemIds")) {
    return Response.json({ error: "Only workItemIds may be selected for retry" }, { status: 400 });
  }
  const selection = body as { workItemIds?: unknown };
  if (
    selection.workItemIds !== undefined
    && (!Array.isArray(selection.workItemIds)
      || selection.workItemIds.some((id) => typeof id !== "string" || !id))
  ) {
    return Response.json({ error: "workItemIds must contain non-empty strings" }, { status: 400 });
  }

  try {
    await startAchatRuntime();
    const runs = await getAchatRecoveryService()
      .retryInterruptedWork(taskId, selection.workItemIds as string[] | undefined);
    return Response.json({ runs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to retry interrupted work";
    return Response.json({ error: message }, {
      status: message.startsWith("Task not found:") ? 404 : 409,
    });
  }
}

import { getAchatDatabase, startAchatRuntime } from "../../../../server/runtime-bootstrap.ts";
import { createApprovalService } from "../../../../server/services/approval-service.ts";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ approvalId: string }>;
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  const { approvalId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "A JSON approval decision is required" }, { status: 400 });
  }
  if (
    typeof body !== "object"
    || body === null
    || Object.keys(body).length !== 1
    || !("decision" in body)
    || (body.decision !== "approve" && body.decision !== "deny")
  ) {
    return Response.json({
      error: "Only decision: approve or deny is accepted; scope is server-bound",
    }, { status: 400 });
  }
  try {
    await startAchatRuntime();
    const approval = await createApprovalService(getAchatDatabase())
      .decideToolApproval(approvalId, { decision: body.decision });
    return Response.json({ approval });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to record approval decision";
    return Response.json({ error: message }, {
      status: /stale|pending approval|not found|already/i.test(message) ? 409 : 400,
    });
  }
}

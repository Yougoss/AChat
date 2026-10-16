import { getAchatDatabase, startAchatRuntime } from "../../../../../server/runtime-bootstrap.ts";
import { markGroupRunsRead } from "../../../../../server/services/message-service.ts";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

export async function POST(_request: Request, { params }: RouteContext): Promise<Response> {
  const { groupId } = await params;
  try {
    await startAchatRuntime();
    const db = getAchatDatabase();
    markGroupRunsRead(db, groupId);
    return Response.json({ unreadCount: 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to mark group runs read";
    return Response.json({ error: message }, {
      status: message.startsWith("Group not found:") ? 404 : 500,
    });
  }
}

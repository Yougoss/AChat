import { getGroupRunProcessDetails } from "../../../../../../../server/services/process-details-service.ts";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ groupId: string; runId: string }>;
}

export async function GET(_request: Request, { params }: RouteContext): Promise<Response> {
  const { groupId, runId } = await params;
  try {
    return Response.json(await getGroupRunProcessDetails(groupId, runId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load process details";
    return Response.json({ error: message }, {
      status: /^(Group|Run) not found:/.test(message) ? 404 : 500,
    });
  }
}

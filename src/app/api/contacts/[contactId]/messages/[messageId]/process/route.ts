import { getContactMessageProcessDetails } from "../../../../../../../server/services/process-details-service.ts";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contactId: string; messageId: string }>;
}

export async function GET(_request: Request, { params }: RouteContext): Promise<Response> {
  const { contactId, messageId } = await params;
  try {
    return Response.json(await getContactMessageProcessDetails(contactId, messageId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load process details";
    return Response.json({ error: message }, {
      status: /^(Contact|Message) not found:/.test(message) ? 404 : 500,
    });
  }
}
